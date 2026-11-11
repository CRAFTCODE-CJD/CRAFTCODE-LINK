'use strict';
const {randomUUID}=require('node:crypto');
const {ShelfStorage,BLOCK}=require('../files/storage.cjs');
const {FileWire,lost,uuid}=require('../files/file-wire.cjs');
const {MAX_FILE,validMeta}=require('../files/attachment-meta.cjs');
const {validateChat,exactKeys,TokenBucket}=require('../core/protocol.cjs');
const {tr}=require('../native-language.cjs');
const {removeSavedDownload}=require('../files/saved-download.cjs');

const unavailable=()=>Error(tr('Вложение недоступно. Попросите друга поделиться им снова.'));
const invalid=()=>Error(tr('Некорректная команда.'));
const actions={offer:[],clip:['kind','bytes'],withdraw:['messageId'],cancel:['messageId'],download:['messageId'],reveal:['messageId'],preview:['messageId'],played:['messageId']};
const validText=value=>typeof value==='string'&&value.length<=1024&&(!value||validateChat(value)===value);
const member=(r,device)=>r?.roster.find(p=>p.device===device);

class GameFiles{
  constructor(service,io){
    this.s=service;this.io=io;this.work=new Set();this.room=null;this.items=new Map();this.downloads=new Map();this.receipts=new Map();this.starts=new WeakMap();
    this.wire=new FileWire('game-file',link=>!!this.scope(link),(link,op,a)=>this.remote(link,op,a),link=>this.scope(link),
      (link,op,a)=>{if(op==='read'||op==='source')this.checkItem(this.items.get(a.id),op==='read'?link.card.device:a.reader);return true;});
  }
  track(job){
    this.work.add(job);
    const done=()=>this.work.delete(job);job.then(done,done);return job;
  }
  scope(link){
    const r=this.room,c=link?.card,p=member(r,c?.device);
    if(!r||!p||p.id!==c.id||!link.lanFiles||link.socket.destroyed||this.s.paused||this.s.strict||this.s.blocked(c.id)||
      !r.host&&p.slot!==1||!this.s.game.links(c.id).includes(link))return;
    const ticket=r.host?p.ticket:r.ticket;
    return uuid(ticket)?r.id+'/'+ticket:undefined;
  }
  supported(){return !!this.room && (this.room.host||!!this.scope(this.s.game.link(this.room.owner)));}
  require(profile,id){
    if(profile!==this.s.me?.id||id!==this.room?.id||!this.room)throw unavailable();
    if(!this.supported())throw Error(tr('Для вложений в LAN обновите LINK у организатора.'));
    return this.room;
  }
  reconcile(){
    const active=this.s.game.active;
    const r=this.io&&!this.s.paused&&!this.s.strict&&active&&!active.waiting&&member(active,this.s.me?.device)?active:null;
    if(r!==this.room){
      this.wire.close();
      for(const t of this.downloads.values())t.cancelled=true;
      if(this.shelf)this.track(this.shelf.close());
      this.downloads.clear();this.items.clear();this.receipts.clear();this.selecting=null;this.room=r;
      this.shelf=r?new ShelfStorage(this.io.downloads(),this.io.journal?.()):null;
    }
    if(!r)return;
    for(const item of this.items.values()){
      const author=member(r,item.device);
      if(!author||this.s.blocked(author.id)){
        item.offline=true;this.cancel(item.id);this.track(this.shelf.remove(item.id));
      }
      for(const [device,ticket] of item.audience){
        const p=member(r,device);
        if(!p||this.s.blocked(p.id)||p.ticket!==ticket){item.audience.delete(device);item.readers.delete(device);}
      }
    }
  }
  disconnected(link){
    this.wire.disconnected(link);
    for(const [id,t] of this.downloads)if(t.link===link)this.cancel(id,true);
    this.s.update();
  }
  state(entry){
    if(!entry.attachment)return entry;
    const item=this.items.get(entry.id),t=this.downloads.get(entry.id);
    const own=entry.device===this.s.me.device;
    const reachable=own||!!(item&&!item.offline&&this.scope(this.linkTo(item.device)));
    const state=item?.saved?'saved':!item||item.withdrawn?'withdrawn':t?'receiving':!reachable?'offline':item.failed?'failed':'offered';
    return {...entry,attachment:{...entry.attachment,state,played:item?.played===true,...(t?{pos:t.pos,bytesPerSecond:Math.round(t.pos*1000/Math.max(1,performance.now()-t.start))}:{})}};
  }
  linkTo(device){
    const r=this.room,p=r&&(r.host?member(r,device):r.owner);
    return p&&this.s.game.link(p);
  }
  round(link,op,args){return this.wire.request(link,op,args);}
  receive(link,msg){return this.track(this.wire.receive(link,msg));}
  add(author,id,attachment,text,time){
    const r=this.room;
    if(!author||this.s.blocked(author.id)||!uuid(id)||!validMeta(attachment)||!validText(text)||this.items.has(id)||
      r.messages.some(e=>e.id===id)||!Number.isSafeInteger(time))throw invalid();
    if(this.items.size>=80){
      const first=this.items.keys().next().value;this.cancel(first);this.track(this.shelf.remove(first));this.items.delete(first);
    }
    const item={id,device:author.device,attachment,audience:new Map(r.roster.map(p=>[p.device,p.ticket])),readers:new Map()};
    this.items.set(id,item);
    this.s.game.append({id,name:author.name,device:author.device,text,time,attachment});return item;
  }
  notify(op,args,except){
    for(const p of this.room.roster.slice(1)){
      if(p.device===except)continue;
      const link=this.s.game.link(p);
      if(this.scope(link))this.track(this.round(link,op,args).catch(()=>{}));
    }
  }
  publish(author,a){
    const time=Date.now();
    this.add(author,a.id,a.attachment,a.text,time);
    this.notify('entry',{id:a.id,attachment:a.attachment,text:a.text,time,device:author.device},author.device);
    return time;
  }
  async offer(profile,room,selection,caption='',kind,bytes){
    const r=this.require(profile,room),shelf=this.shelf;
    if(this.selecting===r)throw Error(tr('Дождитесь завершения операции.'));
    if(!validText(caption))throw invalid();
    this.selecting=r;let id;
    try{
      let meta;
      if(kind!==undefined)meta=shelf.clip(kind,bytes);
      else if(selection?.bytes)meta=shelf.memory(selection.name,selection.bytes);
      else{
        const path=selection?.filename??await this.io.choose();
        if(!path)return false;
        if(r!==this.require(profile,room))throw lost();
        meta=await shelf.offer(path,MAX_FILE);
      }
      let attachment;({id,...attachment}=meta);if(kind)attachment.clip=kind;
      if(r!==this.require(profile,room)||!validMeta(attachment))throw unavailable();
      const author=member(r,this.s.me.device),a={id,attachment,text:caption};
      if(r.host)this.publish(author,a);
      else{
        const item=this.add(author,id,attachment,caption,Date.now());
        try{await this.round(this.linkTo(r.owner.device),'offer',a);}
        catch(error){this.withdraw(item);throw error;}
        if(this.room!==r||this.s.paused||this.s.strict)throw lost();
      }
      return true;
    }catch(error){if(id)await shelf.remove(id);throw error;}
    finally{if(this.selecting===r)this.selecting=null;}
  }
  checkItem(item,reader){
    const r=this.room,p=member(r,reader),author=member(r,item?.device);
    if(!p||!author||this.items.get(item?.id)!==item||!item||item.withdrawn||item.offline||!item.audience.has(reader)||
      item.audience.get(reader)!==p.ticket||this.s.blocked(p.id)||this.s.blocked(author.id)||this.s.paused||this.s.strict)throw unavailable();
  }
  async read(item,reader,token,pos){
    this.checkItem(item,reader);
    if(!uuid(token)||!Number.isSafeInteger(pos)||pos<0||pos%BLOCK||pos>=Math.max(1,item.attachment.size))throw invalid();
    let cursor=item.readers.get(reader);
    if(!cursor||cursor.token!==token||cursor.until<Date.now()){
      if(pos||cursor?.busy)throw invalid();
      cursor={token,pos:0};item.readers.set(reader,cursor);
    }
    if(pos!==cursor.pos||cursor.busy)throw invalid();
    cursor.busy=true;cursor.until=Date.now()+60000;
    try{
      let data;
      if(item.device===this.s.me.device)data=item.attachment.size?await this.shelf.read(item.id,pos):'';
      else{
        if(!this.room.host)throw invalid();
        data=await this.round(this.linkTo(item.device),'source',{id:item.id,reader,token,pos});
      }
      this.checkItem(item,reader);
      if(item.readers.get(reader)!==cursor||typeof data!=='string'||data.length!==4*Math.ceil(Math.min(BLOCK,item.attachment.size-pos)/3))throw invalid();
      cursor.pos+=Math.min(BLOCK,item.attachment.size-pos);return data;
    }finally{cursor.busy=false;}
  }
  withdraw(item){
    if(this.items.get(item.id)!==item||item.withdrawn)return;
    item.withdrawn=true;item.readers.clear();this.cancel(item.id);this.track(this.shelf.remove(item.id));this.s.update();
  }
  async remote(link,op,a){
    const r=this.room,p=member(r,link.card.device);
    if(op==='offer' && r.host && exactKeys(a,['id','attachment','text'])){
      let rate=this.starts.get(link);if(!rate){rate=new TokenBucket(1,5);this.starts.set(link,rate);}
      if(!rate.take())throw invalid();
      return this.publish(p,a);
    }
    if(op==='entry'&&!r.host&&exactKeys(a,['id','attachment','text','time','device'])&&a.device!==this.s.me.device){
      this.add(member(r,a.device),a.id,a.attachment,a.text,a.time);return true;
    }
    const item=this.items.get(a.id);if(!item)throw unavailable();
    if(op==='read'&&r.host&&exactKeys(a,['id','pos','token']))return this.read(item,p.device,a.token,a.pos);
    if(op==='source'&&!r.host&&item.device===this.s.me.device&&exactKeys(a,['id','reader','pos','token']))return this.read(item,a.reader,a.token,a.pos);
    if(op==='withdraw'&&exactKeys(a,['id'])){
      if(r.host&&item.device!==p.device)throw invalid();
      this.withdraw(item);if(r.host)this.notify('withdraw',{id:item.id},p.device);return true;
    }
    throw invalid();
  }
  cancel(id,failed=false){
    const t=this.downloads.get(id);if(!t)return;
    t.cancelled=true;this.downloads.delete(id);
    if(failed)t.item.failed=true;
    if(t.local)this.track(t.shelf.cancel(t.local).catch(()=>{}));
    this.s.update();
  }
  async download(item){
    const r=this.room,reader=this.s.me.device;
    this.checkItem(item,reader);
    if(item.device===reader||item.saved||this.downloads.has(item.id)||this.downloads.size>=4||this.receipts.size>=4096)throw invalid();
    const t={shelf:this.shelf,link:this.linkTo(item.device),token:randomUUID(),start:performance.now(),item,pos:0};
    if(!this.scope(t.link))throw lost();
    const fresh=()=>{if(t.cancelled||r!==this.room||this.downloads.get(item.id)!==t||!this.scope(t.link))throw lost();this.checkItem(item,reader);};
    this.downloads.set(item.id,t);this.s.update();
    try{
      t.local=await t.shelf.begin(item.attachment,'LAN-'+r.id);
      fresh();
      do{
        const a={id:item.id,token:t.token,pos:t.pos};
        const data=r.host?await this.read(item,reader,t.token,t.pos):await this.round(t.link,'read',a);
        fresh();
        const next=await t.shelf.put(t.local,t.pos,data,(filename,identity)=>{
          fresh();this.receipts.set(item.id,{filename,identity,room:r.id,...item.attachment});
        });
        if(next.done){item.saved=t.local;break;}
        fresh();t.pos=next.pos;this.s.update();
      }while(true);
      return true;
    }catch(error){if(t.cancelled)return false;item.failed=true;throw error;}
    finally{
      if(t.local&&!item.saved)await t.shelf.cancel(t.local);
      if(this.downloads.get(item.id)===t)this.downloads.delete(item.id);this.s.update();
    }
  }
  async clearDownloads(id,through){
    const r=this.room;if(!r||r.id!==id)return;
    if(this.purging===r)throw Error(tr('Дождитесь завершения операции.'));
    const cutoff=through===null?-1:r.messages.findIndex(e=>e.id===through);
    if(through!==null&&cutoff<0)return;
    const keep=new Set(r.messages.slice(cutoff+1).map(e=>e.id));
    for(const key of this.downloads.keys())if(!keep.has(key))this.cancel(key);
    const pending=[...this.receipts].filter(([key])=>!keep.has(key));
    const result={removed:0,kept:0,failed:0};
    this.purging=r;
    try{
      for(const [key,receipt] of pending){
        const allow=()=>this.room===r&&!this.downloads.has(key)&&this.receipts.get(key)===receipt;
        try{
          const status=await removeSavedDownload(this.io.downloads(),receipt,allow);
          if(status==='removed'||status==='missing'){
            result.removed++;this.receipts.delete(key);
            const item=this.items.get(key);if(item?.saved){this.shelf.completed.delete(item.saved);delete item.saved;}
          }else result.kept++;
        }catch{result.failed++;}
      }
      return result;
    }finally{if(this.purging===r)this.purging=null;this.s.update();}
  }
  command(raw){
    const {action,room,profileId,messageId}=raw;
    if(!Object.hasOwn(actions,action)||!exactKeys(raw,['op','action','room','profileId',...actions[action]]))throw invalid();
    const r=this.require(profileId,room);
    if(action==='clip'&&!['voice','circle'].includes(raw.kind))throw invalid();
    if(action==='offer'||action==='clip')return this.track(this.offer(profileId,room,undefined,'',action==='clip'?raw.kind:undefined,raw.bytes));
    const item=this.items.get(messageId);if(!item)throw unavailable();
    if(action==='played'){
      if(item.device===this.s.me.device||!item.saved||!['voice','circle'].includes(item.attachment.clip)||
        !r.messages.some(e=>e.id===messageId&&e.device===item.device))throw invalid();
      item.played=true;this.s.update();return true;
    }
    if(action==='download')return this.track(this.download(item));
    if(action==='cancel'){this.cancel(messageId);return true;}
    if(action==='withdraw'){
      if(item.device!==this.s.me.device)throw invalid();
      this.withdraw(item);
      if(!r.host)return this.round(this.linkTo(r.owner.device),'withdraw',{id:item.id});
      this.notify('withdraw',{id:item.id});return true;
    }
    if(action==='reveal'&&item.saved)return this.io.reveal(this.shelf.location(item.saved));
    if(action==='preview'&&(item.saved||item.device===this.s.me.device&&!item.withdrawn))return this.track(this.shelf.preview(item.saved||item.id,item.attachment));
    throw unavailable();
  }
}
module.exports={GameFiles};
