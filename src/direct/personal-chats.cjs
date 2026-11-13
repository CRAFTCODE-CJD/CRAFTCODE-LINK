'use strict';
const {randomUUID}=require('node:crypto');
const {exactKeys,validateChat,TokenBucket}=require('../core/protocol.cjs');
const {tr}=require('../native-language.cjs');
const {PersonalAttachments,validMeta}=require('./personal-attachments.cjs');
const {LEGACY_FILE_LIMIT}=require('../files/attachment-meta.cjs');
const {removeSavedDownload}=require('../files/saved-download.cjs');

const key=id=>typeof id==='string' && /^[a-f0-9]{64}$/.test(id);
const uuid=id=>typeof id==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
const invalid=()=>Error(tr('Некорректная команда.'));
const unavailable=()=>Error(tr('Локальная история личных чатов недоступна.'));
const publicRow=({id,direction,time,text,status,unread})=>({id,direction,time,text,status,...(direction==='in'?{unread}:{})});

class PersonalChats {
  constructor(service,storage,emit,attachmentIO){
    this.service=service;this.storage=storage;this.emit=emit;
    this.files=new PersonalAttachments(this,attachmentIO);
    this.attempts=new Map();this.inboundRates=new Map();this.previews=new Map();this.queued=new Set();
    this.globalRate=new TokenBucket(10,24);
    this.readOutbox=new Set();this.readRetry=new WeakMap();this.readRates=new WeakMap();
  }
  open(me){
    this.close();if(!this.storage)return;
    try{
      this.storage.open(me);this.owner={id:me.id,device:me.device};
      for(const id of this.storage.pendingContacts(this.service.profile.friends))this.queued.add(id);
      for(const id of this.storage.pendingReadContacts(this.service.profile.friends))this.readOutbox.add(id);
    }catch{this.close();}
  }
  close(){
    const cleanup=this.files.clear();
    this.storage?.close();this.owner=null;this.attempts.clear();this.inboundRates.clear();this.previews.clear();this.queued.clear();this.readOutbox.clear();
    return cleanup;
  }
  usable(){return !!(this.owner && this.owner.id===this.service.me?.id && this.owner.device===this.service.me.device);}
  friend(id){
    const f=key(id) && this.service.contact(id);
    return f?.state==='friend' && !this.service.blocked(id)?f:null;
  }
  epoch(f){return f.chatKey||String(f.added);}
  require(person){
    if(!this.usable())throw unavailable();
    if(person!==undefined){
      const f=this.friend(person);if(f)return f;
      throw Error(tr('Личные сообщения доступны только подтверждённым друзьям.'));
    }
  }
  changed(person,incoming=false){
    if(person===null)this.previews.clear();else this.previews.delete(person);
    this.emit({type:'direct-chat-updated',id:person,...(incoming?{incoming:true}:{})});this.service.update();
  }
  storageIssue(){
    const message=tr('Локальная история личных чатов недоступна.');
    if(this.service.issue!==message){this.service.issue=message;this.service.update();}
  }
  summary(f){
    if(!this.usable())return {unread:0,last:null};
    if(!this.previews.has(f.id)){
      try{
        const {unread,last}=this.storage.summary(f.id,this.epoch(f));
        this.previews.set(f.id,{unread,downloads:this.storage.hasDownloads(f.id),last:last?{...publicRow(last),...(last.attachment?.clip?{clip:last.attachment.clip}:{})}:null});
      }catch{this.storageIssue();return {unread:0,last:null};}
    }
    return this.previews.get(f.id);
  }
  footprint(){
    try{if(this.usable())return this.storage.stats();}catch{this.storageIssue();}
    return {bytes:0,messages:0};
  }
  history(person,before){
    const f=this.require(person);
    if(before!==undefined && !uuid(before))throw invalid();
    const {messages,hasMore}=this.storage.page(person,this.epoch(f),before);
    return {id:person,messages:messages.map(row=>row.attachment?{...publicRow(row),attachment:this.files.describe(row)}:publicRow(row)),unread:this.summary(f).unread,hasMore};
  }
  read(person,through,ids,foreground=true){
    const f=this.require(person);
    if(through!==undefined && !uuid(through))throw invalid();
    if(ids!==undefined && (through!==undefined||!Array.isArray(ids)||!ids.length||ids.length>128||!ids.every(uuid)))throw invalid();
    if(!foreground)return {readApplied:false};
    if(ids?this.storage.markVisible(person,this.epoch(f),ids):this.storage.markRead(person,this.epoch(f),through)){
      this.readOutbox.add(person);this.flush(person);this.changed(person);
    }
    return this.history(person);
  }
  discard(person){
    this.files.clear(person);
    this.attempts.delete(person);this.inboundRates.delete(person);this.queued.delete(person);this.previews.delete(person);
    this.readOutbox.delete(person);
    if(this.usable() && this.storage.clear(person))this.changed(person);
  }
  clear(person,deleteDownloads=false){
    this.require(person);
    if(deleteDownloads && this.purgeOwner===this.owner)throw Error(tr('Дождитесь завершения операции.'));
    if(person===undefined){
      this.files.clear();
      if(this.storage.clear())this.changed(null);
      this.queued.clear();this.attempts.clear();this.readOutbox.clear();
    }else this.discard(person);
    if(deleteDownloads)return this.purgeDownloads(person);
    return person===undefined?true:this.history(person);
  }
  async purgeDownloads(person){
    const owner=this.owner,summary={removed:0,kept:0,failed:0};
    this.purgeOwner=owner;
    try{
      for(const id of this.storage.downloadIds(person)){
        if(owner!==this.owner)throw unavailable();
        try{
          const receipt=this.storage.downloadReceipt(id);
          if(!receipt)continue;
          const allow=()=>this.owner===owner && !this.storage.referencesPath(receipt.filename);
          let state='inUse';
          if(allow()){
            const roots=this.files.io.downloadRoots?.()??[this.files.io.downloads()];
            state=await removeSavedDownload(roots,receipt,allow);
          }
          if(this.owner!==owner)throw unavailable();
          if(state!=='inUse')this.storage.forgetDownload(id);
          if(state==='removed')summary.removed++;
          else if(state!=='missing')summary.kept++;
        }catch{
          if(this.owner!==owner)throw unavailable();
          summary.failed++; // Keep this receipt so the user can retry.
        }
      }
      this.changed(person??null);
      return summary;
    }finally{if(this.purgeOwner===owner)this.purgeOwner=null;}
  }
  send(person,text,clientId){
    const f=this.require(person);
    if(this.service.strict)throw Error(tr('Личные сообщения LINK недоступны в строгом режиме.'));
    if(this.service.paused)throw Error(tr('Сначала войдите в профиль LINK.'));
    text=validateChat(text);
    if(clientId!==undefined && !uuid(clientId))throw invalid();
    if(this.storage.enqueue(person,this.epoch(f),clientId??randomUUID(),text)){
      this.queued.add(person);this.changed(person);
    }
    this.flush(person);return this.history(person);
  }
  eligible(link){
    return this.usable() && !this.service.paused && !this.service.strict && !this.service.hidden && link.contactStatus!=='offline' && this.service.links.has(link) &&
      !link.socket.destroyed && link.chatCapable===true && this.friend(link.card.id)?.devices.includes(link.card.device);
  }
  flush(person){
    try{this.deliver(person);this.sendReads(person);}catch{this.storageIssue();}
  }
  sendReads(person){
    if(!this.readOutbox.has(person)||!this.usable())return;
    const f=this.friend(person);if(!f)return;
    const epoch=this.epoch(f);
    if(!this.storage.hasPendingReads(person,epoch)){this.readOutbox.delete(person);return;}
    const now=Date.now();
    for(const link of this.service.linksTo(person)){
      if(!this.eligible(link)||!link.readReceipts||(this.readRetry.get(link)||0)>now)continue;
      const items=this.storage.readBatch(person,epoch,link.card.device);if(!items.length)continue;
      this.readRetry.set(link,now+2500);
      link.send({kind:'friend-read',to:person,origin:link.card.device,items});
    }
  }
  readPacket(link,m){
    if(!this.eligible(link)||!link.readReceipts||m.to!==this.owner.id||!exactKeys(m,['kind','to','origin','items'])||
      !Array.isArray(m.items)||!m.items.length||m.items.length>32||m.items.some(v=>!Array.isArray(v)||v.length!==2||!uuid(v[0])||!Number.isSafeInteger(v[1])||v[1]<1))return;
    const ack=m.kind==='friend-read-ack',person=link.card.id;
    if(m.origin!==(ack?link.card.device:this.owner.device))return;
    let rate=this.readRates.get(link);if(!rate){rate=new TokenBucket(4,12);this.readRates.set(link,rate);}if(!rate.take())return;
    const {accepted,changed}=this.storage.confirmReads(person,this.epoch(this.friend(person)),link.card.device,m.items,ack);
    if(ack){this.readRetry.delete(link);this.sendReads(person);}
    else if(accepted.length)link.send({kind:'friend-read-ack',to:person,origin:this.owner.device,items:accepted});
    if(changed)this.changed(person);
  }
  deliver(person){
    if(!this.queued.has(person) || !this.usable() || this.service.paused || this.service.strict)return;
    const f=this.friend(person);
    if(!f){this.queued.delete(person);return;}
    const links=this.service.linksTo(person).filter(l=>this.eligible(l));
    if(!links.length)return;
    const row=this.storage.oldest(person,this.epoch(f));
    if(!row){this.queued.delete(person);return;}
    let attempt=this.attempts.get(person);
    if(attempt?.id!==row.id){
      attempt={id:row.id,devices:new Map()};this.attempts.set(person,attempt);
    }
    const now=Date.now();
    const withdrawn=row.attachment && this.storage.attachmentKind(row.seq)==='withdrawn';
    for(const link of links){
      const shareFile=row.attachment&&link.filesCapable&&(row.attachment.size<=LEGACY_FILE_LIMIT||link.largeFiles);
      if(row.attachment && !shareFile && !withdrawn)continue;
      const device=link.card.device;
      if((attempt.devices.get(device)||0)>now)continue;
      attempt.devices.set(device,now+5000);
      const text=withdrawn && !shareFile?tr('Доступ отозван')+' · '+row.text:
        row.attachment && !link.captions?row.attachment.name:row.text;
      if(!link.send({kind:'friend-text',to:person,id:row.id,seq:row.seq,text,...(shareFile?{attachment:row.attachment}:{})}))attempt.devices.delete(device);
      else if(link.readReceipts)this.storage.expectRead(row.seq,device);
    }
  }
  tick(){for(const person of new Set([...this.queued,...this.readOutbox]))this.flush(person);}
  receive(link,m){
    if(!this.eligible(link) || m.to!==this.owner.id || !uuid(m.id) || !Number.isSafeInteger(m.seq) || m.seq<=0)return;
    const {id:person,device}=link.card,epoch=this.epoch(this.friend(person));
    if(m.kind==='friend-text-ack'){
      if(!exactKeys(m,['kind','to','origin','id','seq']) || m.origin!==this.owner.device)return;
      const attempt=this.attempts.get(person);
      if(attempt?.id!==m.id || !attempt.devices.has(device))return;
      if(this.storage.acknowledge(person,epoch,m.id,m.seq)){
        if(link.filesCapable && this.storage.attachmentKind(m.seq)==='withdrawn')link.send({kind:'friend-file',op:'revoked',to:person,id:m.id,token:randomUUID()});
        this.attempts.delete(person);this.changed(person);
        // Yield to the transport before sending the next ordered message.
        queueMicrotask(()=>this.flush(person));
      }
      return;
    }
    const hasFile=Object.hasOwn(m,'attachment');
    if(m.kind!=='friend-text'||!exactKeys(m,['kind','to','id','seq','text',...(hasFile?['attachment']:[])]))return;
    if(hasFile && (!link.filesCapable || !validMeta(m.attachment)))return;
    if(hasFile && m.text!==m.attachment.name && (!link.captions || typeof m.text!=='string' || m.text.length>1024))return;
    try{if(validateChat(m.text)!==m.text)return;}catch{return;}
    const result=this.storage.receive(person,epoch,device,m,()=>{
      let rate=this.inboundRates.get(person);
      if(!rate){rate=new TokenBucket(3,10);this.inboundRates.set(person,rate);}
      return rate.take() && this.globalRate.take();
    },link.readReceipts);
    if(result==='ignore')return;
    if(result==='new')this.changed(person,true);
    // Acknowledge a committed message, including an exact retry following a local clear.
    link.send({kind:'friend-text-ack',to:person,origin:device,id:m.id,seq:m.seq});
  }
}

function dispatch(service,raw,foreground){
  const {op,id,profileId}=raw;
  if(profileId!==undefined && profileId!==service.me?.id)throw Error(tr('Профиль LINK изменился. Откройте диалог снова.'));
  if(!service.me || service.paused)throw Error(tr('Сначала войдите в профиль LINK.'));
  const allowed=['op','profileId'];
  if(op==='chat-clear-all'||op==='chat-clear'){
    allowed.push('deleteDownloads');
    if(Object.hasOwn(raw,'deleteDownloads') && (typeof raw.deleteDownloads!=='boolean' || profileId!==service.me.id))throw invalid();
  }
  if(op==='chat-clear-all'){
    if(!exactKeys(raw,allowed))throw invalid();
    return service.chats.clear(undefined,raw.deleteDownloads);
  }
  if(!key(id))throw invalid();
  if(op==='chat-security'||op==='chat-verify'){
    if(profileId!==service.me.id)throw invalid();
    const fields=['op','profileId','id',...(op==='chat-verify'?['fingerprint','verified','devices']:[])];
    if(!exactKeys(raw,fields))throw invalid();
    const identity=require('./identity-verification.cjs');
    return op==='chat-security'?identity.security(service,id):identity.verifyContact(service,id,raw.fingerprint,raw.verified,raw.devices);
  }
  if(op==='chat-attachment'){
    if(profileId!==service.me.id)throw invalid();
    return service.chats.files.command(raw);
  }
  allowed.push('id');
  if(op==='chat-send')allowed.push('text','clientId');
  if(op==='chat-read')allowed.push('through','ids');
  if(op==='chat-history')allowed.push('before');
  if(!exactKeys(raw,allowed))throw invalid();
  switch(op){
    case 'chat-history':return service.chats.history(id,raw.before);
    case 'chat-read':return service.chats.read(id,raw.through,raw.ids,foreground);
    case 'chat-send':return service.chats.send(id,raw.text,raw.clientId);
    case 'chat-clear':return service.chats.clear(id,raw.deleteDownloads);
    default:throw invalid();
  }
}
function chatCommand(service,raw,foreground=true){
  try{return dispatch(service,raw,foreground);}catch(e){
    if(e.code==='ERR_SQLITE_ERROR' || ['ENOSPC','EIO','EACCES','EPERM'].includes(e.code)){
      throw Error(tr(raw.op==='chat-history'?'Локальная история личных чатов недоступна.':'Не удалось сохранить личную переписку на этом ПК.'));
    }
    throw e;
  }
}
module.exports={PersonalChats,chatCommand};
