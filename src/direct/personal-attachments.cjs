'use strict';
const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises');
const {exactKeys,TokenBucket}=require('../core/protocol.cjs');
const {ShelfStorage,BLOCK}=require('../files/storage.cjs');
const {MAX_FILE,validMeta}=require('../files/attachment-meta.cjs');
const {CameraConsent}=require('../files/camera-consent.cjs');
const {MAX_CLIP}=require('../files/chat-media.cjs');
const {FILE_CHUNK}=require('./links.cjs');
const {SNAPSHOT_PART}=require('./chat-store.cjs');
const {createHash}=require('node:crypto');
const {once}=require('node:events');
const {tr}=require('../native-language.cjs');

const v4=s=>typeof s==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
const invalid=()=>Error(tr('Некорректная команда.'));
const absent=()=>Error(tr('Вложение недоступно. Попросите друга поделиться им снова.'));
const offline=()=>Error(tr('Подключите устройство друга с поддержкой вложений.'));
const actions={offer:[],clip:['kind','bytes'],download:['messageId'],cancel:['messageId'],preview:['messageId'],
  reveal:['messageId'],withdraw:['messageId'],played:['messageId'],camera:['requestId'],'camera-end':['requestId']};

class PersonalAttachments {
  constructor(chats,io){
    this.chats=chats;this.io=io;this.camera=new CameraConsent();
    this.transfers=new Set();this.closing=new Set();this.starts=new WeakMap();this.pullAt=new WeakMap();
  }
  get available(){return !!this.io && this.chats.usable();}
  ready(link){return this.available && link?.filesCapable && this.chats.eligible(link);}
  peers(person){return this.chats.service.linksTo(person).filter(l=>this.ready(l));}
  fresh(t){
    const f=this.chats.friend(t.person);
    return this.transfers.has(t) && this.chats.owner===t.owner && f && t.epoch===this.chats.epoch(f) &&
      (!this.chats.service.strict || t.mode==='preview') && !this.chats.service.paused && (!t.link || this.ready(t.link));
  }
  task(person,mode,id,link){
    const f=this.chats.require(person);
    if([...this.transfers].filter(t=>t.mode===mode).length>=(mode==='select'?1:4))throw Error(tr('Дождитесь завершения операции.'));
    const t={person,mode,id,link,owner:this.chats.owner,epoch:this.chats.epoch(f),pos:0,started:performance.now(),abort:new AbortController(),
      store:new ShelfStorage(this.io.downloads(),this.io.journal?.())};
    this.transfers.add(t);return t;
  }
  end(t,notify=false){
    if(!this.transfers.delete(t))return t.closing;
    clearTimeout(t.timer);clearTimeout(t.next);t.abort.abort();
    t.closing=Promise.allSettled([t.store.close(),t.opening]);this.closing.add(t.closing);
    t.closing.finally(()=>this.closing.delete(t.closing));
    if(notify && this.chats.usable())this.chats.changed(t.person);
    return t.closing;
  }
  clear(person){
    if(person===undefined || person===this.cameraPerson){this.camera.reset();this.cameraPerson=null;}
    for(const t of this.transfers)if(person===undefined || person===t.person)this.end(t);
    return Promise.allSettled([...this.closing]);
  }
  disconnected(link){
    for(const t of this.transfers)if(t.link===link)this.end(t,t.mode==='download');
    if(link.card?.id && this.chats.usable())this.chats.changed(link.card.id);
  }
  row(person,id){
    const f=this.chats.require(person),row=this.chats.storage.message(person,this.chats.epoch(f),id);
    if(!row?.attachment)throw absent();
    return row;
  }
  describe(row){
    const kind=this.chats.storage.attachmentKind(row.seq),transfer=this.find(row.direction==='in'?'download':'send',row.person,row.id);
    const state=kind==='saved'?'saved':kind==='withdrawn'?'withdrawn':transfer?(row.direction==='in'?'receiving':'sending'):
      row.direction==='in' && !this.peers(row.person).some(l=>l.card.device===row.origin)?'offline':kind==='failed'?'failed':'offered';
    return {...row.attachment,state,played:row.played===true,...(transfer?{pos:transfer.pos,bytesPerSecond:Math.round(transfer.pos*1000/Math.max(1,performance.now()-transfer.started))}:{})};
  }
  find(mode,person,id,link){return [...this.transfers].find(t=>t.mode===mode && t.person===person && t.id===id && (!link || t.link===link));}
  async offer(person,kind,bytes,selection,caption=''){
    if(!this.available||this.chats.service.paused||this.chats.service.strict)throw offline();
    const t=this.task(person,'select'),storage=this.chats.storage,startedOffline=!this.peers(person).length;let staged;
    try{
      let selected,meta;
      if(selection?.bytes){
        meta=t.store.memory(selection.name,selection.bytes);
        selected={kind:'memory',bytes:selection.bytes};
      }else if(kind===undefined){
        const filename=selection?.filename ?? await this.io.choose();
        if(!filename||!this.fresh(t))return false;
        const st=await fs.stat(filename);
        if(st.size>MAX_FILE)throw Error(tr('Максимальный размер вложения в личном чате — 256 МиБ.'));
        t.opening=t.store.offer(filename,MAX_FILE);
        meta=await t.opening;selected={kind:'path',bytes:Buffer.from(filename)};
        if(!this.fresh(t))throw offline();
        if(startedOffline||!this.peers(person).length){
          staged=storage.startSnapshot(meta.id,meta.size);
          const hash=createHash('sha256');
          for(let pos=0;pos<meta.size;pos+=SNAPSHOT_PART){
            const part=await t.store.readBytes(meta.id,pos,SNAPSHOT_PART);
            if(!this.fresh(t))throw offline();
            hash.update(part);storage.stagePart(staged,pos,part);
          }
          if(hash.digest('hex')!==meta.sha)throw absent();
          selected={kind:'snapshot'};
        }
      }else{
        meta=t.store.clip(kind,bytes);selected={kind:'clip',bytes};
      }
      const {id,size,sha}=meta,attachment={name:meta.name.trim(),size,sha,...(kind?{clip:kind}:{})};
      if(!this.fresh(t))throw offline();
      if(!validMeta(attachment))throw invalid();
      this.chats.storage.enqueue(person,t.epoch,id,caption||attachment.name,attachment,selected);
      this.chats.queued.add(person);this.chats.changed(person);this.chats.flush(person);return true;
    }finally{
      try{if(staged&&this.chats.owner===t.owner)storage.dropStaged(staged);}finally{await this.end(t);}
    }
  }
  async mount(t,row){
    const local=this.chats.storage.attachmentData(row.seq);
    if(!local || !['path','clip','memory','saved','snapshot'].includes(local.kind))throw absent();
    if(local.kind==='saved'){t.store.completed.set(row.id,local.bytes.toString('utf8'));return row.id;}
    if(local.kind==='snapshot'){
      if(t.mode==='send'){t.snapshot=row.seq;return row.id;}
      if(row.attachment.size>MAX_CLIP)throw absent();
      const parts=[];for(let pos=0;pos<row.attachment.size;pos+=SNAPSHOT_PART)parts.push(this.chats.storage.snapshotPart(row.seq,pos));
      return t.store.memory(row.attachment.name,Buffer.concat(parts)).id;
    }
    let meta;
    if(local.kind==='memory')meta=t.store.memory(row.attachment.name,local.bytes);
    else if(local.kind==='clip')meta=t.store.clip(row.attachment.clip,local.bytes);
    else{
      t.opening=t.store.offer(local.bytes.toString('utf8'),row.attachment.size);meta=await t.opening;
    }
    if(!this.fresh(t)||meta.sha!==row.attachment.sha||meta.size!==row.attachment.size)throw absent();
    return meta.id;
  }
  packet(t,op,extra={}){
    return this.fresh(t) && t.link.send({kind:'friend-file',to:t.person,id:t.id,token:t.token,op,...extra});
  }
  async block(t,pos,length){
    if(!t.snapshot)return t.store.readBytes(t.file,pos,length);
    const base=pos-pos%SNAPSHOT_PART;
    if(t.base!==base){t.part=this.chats.storage.snapshotPart(t.snapshot,base);t.base=base;}
    return t.part.subarray(pos-base,pos-base+length);
  }
  progress(t,pos){
    t.pos=pos;
    if(!t.update||performance.now()-t.update>300){t.update=performance.now();this.chats.changed(t.person);}
  }
  failDownload(t){
    try{if(this.fresh(t)){
      const row=this.row(t.person,t.id);this.chats.storage.setAttachment(row.seq,'failed');
    }}catch{this.chats.storageIssue();}
    return this.end(t,true);
  }
  deadline(t){clearTimeout(t.timer);t.timer=setTimeout(()=>t.mode==='download'?this.failDownload(t):this.end(t),90000);t.timer.unref();}
  async download(person,row){
    if(row.direction!=='in'||['withdrawn','saved'].includes(this.chats.storage.attachmentKind(row.seq))||this.find('download',person,row.id))throw absent();
    const link=this.peers(person).find(l=>l.card.device===row.origin);
    if(!link)throw offline();
    const t=this.task(person,'download',row.id,link);t.token=randomUUID();t.chunk=link.fileChunks===true;t.size=row.attachment.size;
    try{
      t.opening=t.store.begin(row.attachment,'DM-'+person.slice(0,12));t.file=await t.opening;
      if(!this.packet(t,t.chunk?'get-chunk':'get',{pos:0}))throw offline();
      this.deadline(t);this.chats.changed(person);return true;
    }catch(e){const active=this.transfers.has(t);await this.end(t,true);if(active)throw e;return false;}
  }
  async serve(link,m){
    const person=link.card.id;
    let t=this.find('send',person,m.id,link);
    if(t && t.token!==m.token)return;
    if(!t){
      if(m.pos!==0)return;
      let rate=this.starts.get(link);
      if(!rate){rate=new TokenBucket(2,8);this.starts.set(link,rate);}
      if(!rate.take()){link.send({kind:'friend-file',to:person,id:m.id,token:m.token,op:'gone'});return;}
    }
    try{
      const row=this.row(person,m.id);
      if(row.direction!=='out')return;
      if(this.chats.storage.attachmentKind(row.seq)==='withdrawn'){
        link.send({kind:'friend-file',to:person,id:m.id,token:m.token,op:'revoked'});return;
      }
      if(!t){
        t=this.task(person,'send',m.id,link);t.token=m.token;t.chunk=m.op==='get-chunk';t.busy=true;this.deadline(t);
        t.file=await this.mount(t,row);
      }else{
        if(t.busy || t.pos!==m.pos || t.chunk!==(m.op==='get-chunk'))return;
        t.busy=true;
      }
      if(!this.fresh(t))return;
      const block=t.chunk?FILE_CHUNK:BLOCK;
      const data=row.attachment.size?(await this.block(t,m.pos,block)).toString('base64'):'';
      // Leave room in the shared socket for room signalling and other chats.
      while(this.fresh(t)&&t.chunk&&link.socket.writableNeedDrain&&link.socket.writableLength>128*1024)
        await once(link.socket,'drain',{signal:t.abort.signal});
      if(!this.packet(t,t.chunk?'chunk':'block',{pos:m.pos,data}))return;
      this.progress(t,Math.min(m.pos+block,row.attachment.size));
      if(t.pos===row.attachment.size)await this.end(t,true);else this.deadline(t);
    }catch{
      if(this.ready(link))link.send({kind:'friend-file',to:person,id:m.id,token:m.token,op:'gone'});
      if(t)await this.end(t);
    }finally{if(t)t.busy=false;}
  }
  async receive(link,m){
    if(!this.ready(link)||m.to!==this.chats.owner.id||!v4(m.id)||!v4(m.token))return;
    const base=['kind','to','id','token','op'];
    if((m.op==='get'||m.op==='get-chunk'&&link.fileChunks) && exactKeys(m,[...base,'pos']) && Number.isSafeInteger(m.pos) && m.pos>=0 && m.pos<=MAX_FILE && m.pos%(m.op==='get'?BLOCK:FILE_CHUNK)===0)return this.serve(link,m);
    const person=link.card.id;
    if(m.op==='stop' && exactKeys(m,base)){
      const t=this.find('send',person,m.id,link);if(t?.token===m.token)await this.end(t);return;
    }
    if(m.op==='revoked' && exactKeys(m,base)){
      const row=this.row(person,m.id);
      if(row.direction==='in' && row.origin===link.card.device && !['saved','withdrawn'].includes(this.chats.storage.attachmentKind(row.seq))){
        this.chats.storage.setAttachment(row.seq,'withdrawn');
        const t=this.find('download',person,m.id);if(t)this.end(t);
        this.chats.changed(person);
      }return;
    }
    const t=this.find('download',person,m.id);
    if(!t||t.link!==link||t.token!==m.token)return;
    if(m.op==='gone' && exactKeys(m,base)){await this.failDownload(t);return;}
    if(m.op!==(t.chunk?'chunk':'block')||!exactKeys(m,[...base,'pos','data'])||m.pos!==t.pos||t.busy||typeof m.data!=='string')return;
    t.busy=true;
    try{
      const expected=Math.min(t.chunk?FILE_CHUNK:BLOCK,t.size-t.pos);
      if(m.data.length!==4*Math.ceil(expected/3))throw invalid();
      const bytes=Buffer.from(m.data,'base64');if(bytes.length!==expected||bytes.toString('base64')!==m.data)throw invalid();
      const result=await t.store.putBytes(t.file,t.pos,bytes,(filename,identity)=>{
        if(!this.fresh(t))throw absent();
        this.chats.storage.saveDownload(this.row(person,t.id),filename,identity);
      });
      if(!this.fresh(t))return;
      this.progress(t,result.pos);
      if(result.done){
        await this.end(t,true);
      }else{
        this.deadline(t);
        const now=performance.now(),next=Math.max(now,this.pullAt.get(link)||0);
        this.pullAt.set(link,next+(t.chunk?15:35));
        t.next=setTimeout(()=>{if(!this.packet(t,t.chunk?'get-chunk':'get',{pos:t.pos}))this.end(t,true);},Math.max(0,next-now));
      }
    }catch{await this.failDownload(t);}finally{t.busy=false;}
  }
  async command(raw){
    const {action,id:person,messageId,requestId}=raw;
    if(!Object.hasOwn(actions,action) || !exactKeys(raw,['op','profileId','id','action',...actions[action]]))throw invalid();
    this.chats.require(person);
    if(!this.available)throw absent();
    if(action==='camera-end'){this.camera.cancel(requestId);return;}
    if(this.chats.service.paused || this.chats.service.strict && !['preview','reveal','withdraw','cancel','played'].includes(action))throw offline();
    if(action==='camera'){
      if(this.camera.promptOpen)return false;
      const owner=this.chats.owner;this.cameraPerson=person;
      return this.camera.ask(requestId,async()=>await this.io.askCamera() && owner===this.chats.owner && !!this.chats.friend(person)&&!this.chats.service.paused&&!this.chats.service.strict);
    }
    if(action==='offer')return this.offer(person);
    if(action==='clip'){
      if(!['voice','circle'].includes(raw.kind))throw invalid();
      return this.offer(person,raw.kind,raw.bytes);
    }
    if(!v4(messageId))throw invalid();
    const row=this.row(person,messageId);
    if(action==='played'){
      if(raw.profileId!==this.chats.owner.id||row.direction!=='in'||!['voice','circle'].includes(row.attachment.clip)||
        this.chats.storage.attachmentKind(row.seq)!=='saved')throw invalid();
      this.chats.storage.markAttachmentPlayed(row.seq);this.chats.changed(person);return true;
    }
    if(action==='download')return this.download(person,row);
    if(action==='withdraw'){
      if(row.direction!=='out')throw invalid();
      this.chats.storage.setAttachment(row.seq,'withdrawn');
      for(const t of this.transfers)if(t.id===messageId && t.person===person)this.end(t);
      for(const l of this.peers(person))l.send({kind:'friend-file',op:'revoked',to:person,id:messageId,token:randomUUID()});
      this.chats.changed(person);return true;
    }
    if(action==='cancel'){
      const t=this.find('download',person,messageId);
      if(t){this.packet(t,'stop');await this.end(t,true);}return true;
    }
    const local=this.chats.storage.attachmentData(row.seq);
    if(!local || local.kind==='withdrawn')throw absent();
    if(action==='reveal'){
      if(local.kind!=='saved')throw invalid();
      return this.io.reveal(local.bytes.toString('utf8'));
    }
    const t=this.task(person,'preview',messageId);
    try{
      const file=await this.mount(t,row),preview=await t.store.preview(file,row.attachment);
      if(!this.fresh(t))throw absent();
      return preview;
    }finally{await this.end(t);}
  }
}
module.exports={PersonalAttachments,validMeta};
