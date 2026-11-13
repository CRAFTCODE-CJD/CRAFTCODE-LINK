'use strict';
const {randomUUID}=require('node:crypto');
const {GroupStore}=require('./store.cjs'),M=require('./model.cjs');
const {GroupHandoff}=require('./transfer.cjs');
const {validPixels}=require('../direct/avatars.cjs');
const {VoiceDirectory}=require('./voice-directory.cjs');
const {TokenBucket}=require('../core/protocol.cjs'),{tr}=require('../native-language.cjs');
const offline=()=>Error(tr('Сервер группы недоступен.'));
const locked=()=>Error(tr('Идёт передача группы.'));
const wireLimit=39000;
const MAX_GROUPS=48,MAX_INVITES=16,MAX_INVITES_FROM_FRIEND=4;

class Groups {
  constructor(s,profileStore){
    this.s=s;this.store=new GroupStore(profileStore);this.handlers=new Map();this.pending=new Map();this.inviteRates=new Map();
    this.handoff=new GroupHandoff(this);this.directory=new VoiceDirectory(this);this.avatarReads=new Map();this.active=false;
  }
  start(){
    try{this.store.start(this.s.me);this.active=true;}
    catch(error){this.active=false;this.s.issue=error.message;}
  }
  changed(id){
    if(id&&!this.records.has(id))this.directory.remote.delete(id);
    this.s.update();this.s.groupChanged?.(id);
  }
  get records(){return this.store.records;}
  joinedCount(){return [...this.records.values()].filter(r=>!r.invite||r.accepted).length;}
  friend(id){return this.s.contact(id)?.state==='friend'&&!this.s.blocked(id)?this.s.contact(id):null;}
  fileAllowed(link){
    return !!(this.active&&!this.s.paused&&!this.s.strict&&link?.groups&&this.s.links.has(link)&&
      !link.socket.destroyed&&this.friend(link.card.id)?.devices.includes(link.card.device));
  }
  link(person,device){return this.s.linksTo(person).find(l=>this.fileAllowed(l)&&(!device||l.card.device===device));}
  host(id){
    const r=this.records.get(id);return r && this.active&&!this.s.paused&&!this.s.strict?{owner:r.owner,device:r.device,epoch:r.epoch}:null;
  }
  mine(r){return !!r && r.owner===this.s.me?.id && r.device===this.s.me.device && !!r.group;}
  authority(id){const r=this.records.get(id);return this.host(id)&&this.mine(r)&&!r.move?r.group:null;}
  access(id,channel,person,type='text'){const g=this.authority(id);return !!(g && (person===this.s.me.id || this.friend(person)) && M.access(g,channel,person,type));}
  voiceAccess(id,channel,person){
    const r=this.records.get(id);if(!this.host(id)||!r||r.move)return null;
    const local=this.mine(r), g=local?r.group:r.view;
    if(!g||g.transferring || !local && (person!==this.s.me.id || !this.link(r.owner,r.device)) || !M.access(g,channel,person,'voice'))return null;
    if(local&&person!==this.s.me.id&&!this.friend(person))return null;
    return {...this.host(id),name:M.member(g,person).name,channelName:g.channels.find(c=>c.id===channel).name};
  }
  localView(r,person,link){
    const view=M.project(r.group,person);
    if(link&&!link.groupPalettes){
      delete view.paletteVersion;
      if(M.extendedThemes.has(view.theme))view.theme=M.extendedThemes.get(view.theme);
    }
    if(link&&!link.groupAppearance){delete view.theme;delete view.avatarKey;delete view.appearanceVersion;}
    if(view.role==='owner')view.members=view.members.map(m=>({...m,onlineDevices:[...new Set(this.s.linksTo(m.id).filter(l=>this.fileAllowed(l)).map(l=>l.card.device))].slice(0,16)}));
    return {...view,transferring:!!r.move,online:true};
  }
  appearance(r){
    const mine=this.mine(r),view=mine?r.group:r.view;
    if(!view)return {};
    const avatar=mine?view.avatar:(r.badge?.key===view.avatarKey?r.badge?.pixels:null);
    return {theme:view.theme||'personal',...(avatar?{avatar,avatarRev:mine?M.avatarKey(avatar):r.badge.key}:{})};
  }
  snapshot(){
    const items=[],invites=[],transfers=[];
    if(!this.active||this.s.paused||this.s.strict)return {items,invites,transfers};
    for(const r of this.records.values()){
      const mine=this.mine(r), online=mine||!!this.link(r.owner,r.device);
      const meta={id:r.id,name:r.name,owner:r.owner,device:r.device,epoch:r.epoch,online};
      if(r.invite && !r.view && !mine){invites.push({...meta,fromName:this.friend(r.owner)?.name||''});continue;}
      if(r.view||mine)items.push({...meta,...this.appearance(r),role:mine?'owner':r.view.role,revision:mine?r.group.revision:r.view.revision,voiceRooms:online?this.directory.read(r):undefined});
      if(r.move?.side==='candidate' && r.move.phase==='offered')transfers.push({...meta,fromName:this.friend(r.owner)?.name||''});
    }
    return {items,invites,transfers};
  }
  register(kind,handler){this.handlers.set(kind,handler);}
  send(link,op,data){
    const packet={kind:'group',op,...data};
    return this.fileAllowed(link)&&Buffer.byteLength(JSON.stringify(packet))<=wireLimit && link.send(packet);
  }
  sendInvite(r,link){
    this.send(link,'invite',{id:r.id,name:r.name,epoch:r.epoch,nameRevision:r.nameRevision||1});
  }
  announce(l){
    if(!this.fileAllowed(l))return;
    for(const r of this.records.values()){
      if(this.mine(r)){
        if(M.member(r.group,l.card.id)){
          this.handoff.notice(r,l);
          this.sendInvite(r,l);
          this.send(l,'view',{id:r.id,view:this.localView(r,l.card.id,l)});
          this.directory.send(r,l);
        }
        else if(r.group.invites.some(x=>x.id===l.card.id&&x.until>Date.now()))
          this.sendInvite(r,l);
      }else if(r.owner===l.card.id && r.device===l.card.device && !r.invite)this.send(l,'sync',{id:r.id,epoch:r.epoch});
      this.handoff.reconnect(r,l);
    }
  }
  put(r){this.store.put(r);this.changed(r.id);}
  publish(r,old){
    this.put(r);
    this.directory.schedule(r.id);
    const ids=new Set([...r.group.members,...r.group.invites,...(old?.members||[]),...(old?.invites||[])].map(x=>x.id));
    for(const id of ids){
      if(id===this.s.me.id)continue;
      for(const l of this.s.linksTo(id)){
        if(!this.fileAllowed(l))continue;
        if(M.member(r.group,id))this.send(l,'view',{id:r.id,view:this.localView(r,id,l)});
        else if(r.group.invites.some(i=>i.id===id&&i.until>Date.now()))this.sendInvite(r,l);
        else this.send(l,'removed',{id:r.id,epoch:r.epoch});
      }
    }
  }
  modify(id,edit){
    const r=this.records.get(id);if(!this.mine(r)||!this.active||this.s.strict||this.s.paused)throw M.denied();
    if(r.move)throw locked();
    const group=structuredClone(r.group),result=edit(group);
    group.revision++;M.validateView(M.project(group,group.owner));
    const next={...r,group,name:group.name};
    if(r.name!==group.name)next.nameRevision=group.revision;
    this.publish(next,r.group);
    Promise.resolve(this.files?.reconcile(id,group)).catch(e=>{this.s.issue=e.message;this.changed(id);});
    return result;
  }
  appendFile(id,channel,person,nonce,file,caption=''){
    if(!this.access(id,channel,person))throw M.denied();
    return this.modify(id,g=>M.append(g,channel,person,nonce,caption,file));
  }
  removeFile(id,channel,person,fileId){
    if(!this.access(id,channel,person))throw M.denied();
    return this.modify(id,g=>{
      const row=g.messages[channel]?.find(m=>m.file?.id===fileId);
      if(!row || !M.staff(M.member(g,person)) && row.person!==person)throw M.denied();
      g.messages[channel]=g.messages[channel].filter(m=>m!==row);return true;
    });
  }
  async perform(r,person,device,action,args,link){
    if(!this.mine(r)||this.s.strict||this.s.paused||!this.active||person!==this.s.me.id&&!this.friend(person))throw M.denied();
    if(action==='open')return this.localView(r,person,link);
    if(action==='avatar-read'){
      if(!M.member(r.group,person)||!r.group.avatar||M.avatarKey(r.group.avatar)!==args.key)throw M.denied();
      return r.group.avatar;
    }
    if(r.move)throw locked();
    if(action==='history')return M.page(r.group,args.channel,person,args.before);
    if(action==='decline'){
      if(!r.group.invites.some(i=>i.id===person))return false;
      return this.modify(r.id,g=>{g.invites=g.invites.filter(i=>i.id!==person);return true;});
    }
    if(this.handlers.has(action)){
      if(!M.member(r.group,person))throw M.denied();
      return this.handlers.get(action)({group:r.group,person,device,args,link});
    }
    return this.modify(r.id,g=>M.change(g,person,action,args,id=>this.friend(id)));
  }
  async request(id,action,args={}){
    const r=this.records.get(id);if(!r||!this.active || this.s.strict || this.s.paused)throw M.denied();
    if(this.mine(r))return this.perform(r,this.s.me.id,this.s.me.device,action,args,null);
    const l=this.link(r.owner,r.device);if(!l)throw offline();
    if(this.pending.size>=64)throw M.full();
    const req=randomUUID();
    return new Promise((resolve,reject)=>{
      const done=(error,value)=>{clearTimeout(timer);this.pending.delete(req);if(error)reject(error);else resolve(value);};
      const timer=setTimeout(()=>done(offline()),15000);timer.unref();
      this.pending.set(req,{id,link:l,done,epoch:r.epoch});
      if(!this.send(l,'request',{id,epoch:r.epoch,req,action,args}))done(offline());
    });
  }
  async open(id){
    let r=this.records.get(id);if(!r || (!this.mine(r)&&!r.view))throw M.denied();
    if(this.mine(r))return {...this.localView(r,this.s.me.id),...this.appearance(r),voiceRooms:this.directory.read(r)};
    if(this.link(r.owner,r.device)){
      const v=await this.request(id,'open');this.cache(r.id,v);
      r=this.records.get(id);
    }
    if(!r?.view)throw M.denied();
    const online=!!this.link(r.owner,r.device);
    return {...r.view,...this.appearance(r),online,voiceRooms:online?this.directory.read(r):undefined};
  }
  // Keep the avatar out of routine history updates and the bounded membership
  // view. Fetch once per image from the pinned owner over the group link.
  refreshAvatar(r){
    const key=r?.view?.avatarKey,pending=r&&this.avatarReads.get(r.id);
    if(!key||r.badge?.key===key||pending?.key===key&&pending.epoch===r.epoch)return;
    const job={key,epoch:r.epoch};this.avatarReads.set(r.id,job);
    this.request(r.id,'avatar-read',{key}).then(pixels=>{
      const now=this.records.get(r.id);
      if(this.avatarReads.get(r.id)!==job||!now||now.owner!==r.owner||now.device!==r.device||now.epoch!==r.epoch||
        now.view?.avatarKey!==key||!validPixels(pixels)||M.avatarKey(pixels)!==key)return;
      this.put({...now,badge:{key,pixels}});
    }).catch(()=>{}).finally(()=>{if(this.avatarReads.get(r.id)===job)this.avatarReads.delete(r.id);});
  }
  cache(id,v){
    M.validateView(v);
    const r=this.records.get(id);
    if(!r || r.id!==v.id||r.epoch!==v.epoch||r.owner!==v.owner||r.device!==v.device||
      M.member(v,this.s.me.id)?.role!==v.role || this.mine(r) || (r.view?.revision||0)>v.revision)return;
    if(r.invite && !r.accepted)return;
    if(JSON.stringify(r.view)!==JSON.stringify(v)){
      const next={...r,view:v,name:v.name,invite:false,accepted:false};
      if(next.badge?.key!==v.avatarKey)delete next.badge;
      this.put(next);
    }
    this.refreshAvatar(this.records.get(id));
  }
  async receive(l,m){
    if(!this.fileAllowed(l)||!M.uuid(m.id))return;
    const r=this.records.get(m.id), pinned=r && r.owner===l.card.id && r.device===l.card.device;
    if(m.op==='voice-directory'){if(pinned)this.directory.accept(r,l,m);return;}
    if(m.op==='reply'){
      const p=this.pending.get(m.req);
      if(p && p.id===m.id && p.epoch===m.epoch && p.link===l){
        p.done(m.ok===true?null:Error(tr(m.error==='denied'?'Нет доступа к этому действию.':m.error==='full'?'Достигнут лимит группы.':m.error==='locked'?'Идёт передача группы.':'Некорректная команда.')),m.data);
      }
      return;
    }
    if(m.op.startsWith('handoff-'))return this.handoff.receive(l,m);
    if(m.op==='invite'){
      const nameRevision=m.nameRevision;
      if(!Number.isSafeInteger(m.epoch)||m.epoch<1||
        nameRevision!==undefined&&(!Number.isSafeInteger(nameRevision)||nameRevision<1))return;
      if(r){
        if(!pinned||!r.invite||r.view||r.epoch!==m.epoch)return;
        // Older hosts send only the name. A late legacy packet must not replace
        // a versioned name received on another connection to the same device.
        if(nameRevision===undefined ? r.nameRevision||r.name===m.name : nameRevision<=(r.nameRevision||0))return;
        const name=M.label(m.name);
        const rate=l.groupInviteUpdates??=new TokenBucket(2,16);
        if(rate.take())this.put({...r,name,nameRevision});
        return;
      }
      const invites=[...this.records.values()].filter(entry=>entry.invite&&!entry.accepted);
      if(invites.length>=MAX_INVITES||invites.filter(entry=>entry.owner===l.card.id).length>=MAX_INVITES_FROM_FRIEND)return;
      let rate=this.inviteRates.get(l.card.id);
      if(!rate){rate=new TokenBucket(1/15,MAX_INVITES_FROM_FRIEND);this.inviteRates.set(l.card.id,rate);}
      if(!rate.take())return;
      this.put({id:m.id,name:M.label(m.name),nameRevision,owner:l.card.id,device:l.card.device,epoch:m.epoch,invite:true,chain:[]});
      return;
    }
    if(m.op==='view'&&pinned){this.cache(m.id,m.view);return;}
    if(m.op==='removed'&&pinned&&r.epoch===m.epoch&&!r.move){this.store.remove(r.id);this.changed(r.id);return;}
    if(m.op==='sync'){
      // The old host can announce its durable fence before this device receives
      // the matching activation grant. Preserve the member's pending new route.
      if(r?.move?.side==='candidate' && r.move.phase==='prepared' && m.epoch===r.epoch+1)return;
      if(this.mine(r)&&r.epoch===m.epoch && M.member(r.group,l.card.id)){
        this.send(l,'view',{id:r.id,view:this.localView(r,l.card.id,l)});
        this.directory.send(r,l);
      }else if(r?.chain?.length&&m.epoch<r.epoch && (r.group?.members||r.view?.members||[]).some(p=>p.id===l.card.id)){
        this.handoff.notice(r,l);
      }else if(Number.isSafeInteger(m.epoch)&&m.epoch>0)this.send(l,'removed',{id:m.id,epoch:m.epoch});
      return;
    }
    if(m.op!=='request' || !M.uuid(m.req)||!Number.isInteger(m.epoch)||typeof m.action!=='string'||m.action.length>48||
      !m.args || typeof m.args!=='object'||Array.isArray(m.args))return;
    const rate=l.groupRequests??=new TokenBucket(20,40);
    if(!rate.take())return;
    const result={id:m.id,req:m.req,epoch:m.epoch};
    try{
      if(!r || r.epoch!==m.epoch)throw M.denied();
      const data=await this.perform(r,l.card.id,l.card.device,m.action,m.args,l);
      this.send(l,'reply',{...result,ok:true,data});
    }catch(e){
      const error=e.message===M.denied().message?'denied':e.message===M.full().message?'full':e.message===locked().message?'locked':'invalid';
      this.send(l,'reply',{...result,ok:false,error});
    }
  }
  async command(raw){
    if(!this.active||!this.s.me||this.s.paused||this.s.strict)throw M.denied();
    const op=raw.op.slice(6),id=raw.id;
    if(op==='state')return this.snapshot();
    if(op==='shared-with'){
      if(raw.profileId!==this.s.me.id||!this.friend(raw.person))throw M.denied();
      const shared=[];
      for(const record of this.records.values()){
        const view=this.mine(record)?record.group:record.view;
        if(view&&M.member(view,this.s.me.id)&&M.member(view,raw.person)){
          const {avatar}=this.appearance(record);shared.push({id:record.id,name:record.name,...(avatar?{avatar}:{})});
        }
      }
      return shared;
    }
    if(op==='create'){
      if(this.joinedCount()>=MAX_GROUPS)throw M.full();
      const g=M.create(raw.name,this.s.me);
      this.put({id:g.id,name:g.name,owner:g.owner,device:g.device,epoch:1,chain:[],group:g});return {id:g.id};
    }
    if(!M.uuid(id))throw M.invalid();
    const r=this.records.get(id);if(!r)throw M.denied();
    if(op==='open')return this.open(id);
    if(op==='answer'){
      if(!r.invite||typeof raw.accept!=='boolean')throw M.denied();
      if(!raw.accept){if(this.link(r.owner,r.device))await this.request(id,'decline').catch(()=>{});this.store.remove(id);this.changed(id);return true;}
      if(!r.accepted&&this.joinedCount()>=MAX_GROUPS)throw M.full();
      this.put({...r,accepted:true});
      try{await this.request(id,'join');}catch(error){
        const pending=this.records.get(id);
        if(pending?.invite&&pending.accepted)this.put({...pending,accepted:false});
        throw error;
      }
      return this.open(id);
    }
    if(op==='delete'){
      if(!this.authority(id))throw M.denied();
      for(const m of [...r.group.members,...r.group.invites])for(const l of this.s.linksTo(m.id))this.send(l,'removed',{id,epoch:r.epoch});
      this.store.remove(id);this.changed(id);await this.files?.reconcile(id,null);return true;
    }
    if(op==='transfer'||op==='transfer-cancel'||op==='transfer-answer')return this.handoff.command(r,op,raw);
    const args={...raw};delete args.op;delete args.id;
    if(op==='appearance'||op==='rename'){
      if(raw.profileId!==this.s.me.id)throw M.denied();
      delete args.profileId;
    }
    if(op==='rename'&&!this.mine(r)&&r.view?.renameVersion!==1)
      throw Error(tr('Обновите LINK на компьютере владельца, чтобы переименовать группу.'));
    const result=await this.request(id,op,args);
    if(op==='leave'){this.store.remove(id);this.changed(id);}
    return result;
  }
  lost(l){this.directory.lost(l);for(const p of [...this.pending.values()])if(p.link===l)p.done(offline());this.changed();}
  forget(person){
    this.inviteRates.delete(person);
    for(const r of [...this.records.values()]){
      if(this.mine(r)){
        if(r.move?.side==='source' && (r.move.person===person||M.member(r.group,person)))this.handoff.cancel(r,true);
        if(M.member(r.group,person)||r.group.invites.some(i=>i.id===person)){
          const latest=this.records.get(r.id),group=structuredClone(latest.group);
          M.removeMember(group,person);group.revision++;this.publish({...latest,group},latest.group);
        }
      }else if(r.owner===person && !r.move){
        this.store.remove(r.id);this.changed(r.id);
      }
    }
  }
  tick(){this.handoff.tick();}
  async close(){
    this.avatarReads.clear();
    this.inviteRates.clear();
    this.directory.close();
    this.active=false;for(const p of [...this.pending.values()])p.done(offline());
    this.handoff.close();try{await this.files?.close();}finally{this.store.close();}
  }
}
module.exports={Groups};
