'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {sign,verify}=require('../direct/identity.cjs'),{tr}=require('../native-language.cjs');
const M=require('./model.cjs');
const BLOCK=12*1024,MAX=3*1024*1024,CHAIN=32;
const digest=b=>createHash('sha256').update(b).digest('hex');
const fields=(id,h)=>['LINK group authority v1',id,String(h.epoch),h.previous,h.from,h.owner,h.device,h.token,h.sha];
const validHop=(id,h)=>h && Number.isSafeInteger(h.epoch)&&h.epoch>1&&M.key(h.previous)&&M.key(h.from)&&M.key(h.owner)&&M.key(h.device)&&
  M.uuid(h.token)&&M.key(h.sha)&&typeof h.proof==='string'&&h.proof.length===88&&verify(h.from,fields(id,h),h.proof);
function nextGroup(old,h){
  const g=structuredClone(old),successor=M.member(g,h.owner),prior=M.member(g,g.owner);
  if(!successor||successor.role!=='admin'||!prior||prior.role!=='owner')throw M.denied();
  prior.role='admin';successor.role='owner';g.owner=h.owner;g.device=h.device;g.epoch=h.epoch;g.revision++;
  // Invitations were issued by the old server. The new server can issue fresh invitations.
  g.invites=[];return g;
}
function validateSnapshot(g,r){
  if(g.id!==r.id||g.owner!==r.owner||g.device!==r.device||g.epoch!==r.epoch||
    !g.messages||typeof g.messages!=='object'||Array.isArray(g.messages)||!Array.isArray(g.invites)||g.invites.length>32)throw M.invalid();
  M.validateView(M.project(g,g.owner));
  let count=0;
  for(const [id,rows] of Object.entries(g.messages)){
    if(!g.channels.some(c=>c.type==='text'&&c.id===id)||!Array.isArray(rows)||rows.length>500)throw M.invalid();
    const seen=new Set();
    for(const row of rows){
      if(!M.uuid(row.id)||!M.uuid(row.nonce)||!M.key(row.person)||!Number.isSafeInteger(row.at)||row.at<0||seen.has(row.id)||
        typeof row.text!=='string'||row.text.length>1200)throw M.invalid();
      M.label(row.name,80);seen.add(row.id);count++;
      if(row.file && (!M.uuid(row.file.id)||!M.key(row.file.sha)||typeof row.file.name!=='string'||!row.file.name||row.file.name.length>255||
        !Number.isSafeInteger(row.file.size)||row.file.size<0))throw M.invalid();
    }
  }
  if(count>12000)throw M.full();
}
class GroupHandoff {
  constructor(groups){this.g=groups;this.buffers=new Map();this.sending=new Map();this.validating=new Set();this.activating=new Set();}
  link(r){const x=r.move;return x&&this.g.link(x.person,x.device);}
  send(r,op,data={},l=this.link(r)){
    return !!l&&this.g.send(l,'handoff-'+op,{id:r.id,token:r.move?.token,...data});
  }
  checkFriends(members){
    const missing=members.filter(m=>m.id!==this.g.s.me.id&&!this.g.friend(m.id));
    if(missing.length)throw Error(tr('Для передачи подтвердите дружбу с участниками группы')+' · '+missing.map(m=>m.name).join(', '));
  }
  async command(r,op,a){
    if(op==='transfer'){
      if(!this.g.authority(r.id)||r.move||!M.key(a.person)||M.member(r.group,a.person)?.role!=='admin')throw M.denied();
      if((r.chain?.length||0)>=CHAIN)throw M.full();
      const online=new Map(this.g.s.linksTo(a.person).filter(l=>this.g.fileAllowed(l)).map(l=>[l.card.device,l]));
      if(!online.size)throw Error(tr('Администратор должен быть в сети.'));
      const l=a.device?online.get(a.device):online.size===1?[...online.values()][0]:null;
      if(!l)throw Error(tr('Выберите устройство администратора.'));
      const move={side:'source',phase:'offered',token:randomUUID(),person:a.person,device:l.card.device};
      const next={...r,move};this.g.publish(next);this.advertise(next,l);return true;
    }
    if(op==='transfer-cancel'){
      if(r.move?.side!=='source')throw M.denied();this.cancel(r,true);return true;
    }
    if(r.move?.side!=='candidate'||r.move.phase!=='offered'||typeof a.accept!=='boolean')throw M.denied();
    if(!a.accept){this.cancel(r,true);return true;}
    this.checkFriends(r.move.members);
    const next={...r,move:{...r.move,phase:'accepted'}};this.g.put(next);
    await this.authorize(next);this.advertise(next,this.link(next));return true;
  }
  async authorize(r){
    const x=r.move;
    await this.g.files?.allowHandoff({id:r.id,person:x.person,device:x.device,token:x.token});
  }
  cancel(r,inform){
    if(!r.move||r.move.side==='retired')return;
    if(inform)this.send(r,'cancel');const {move,...next}=r;
    if(inform && move.side==='candidate')next.rejectedToken=move.token;
    this.sending.delete(r.id);this.buffers.delete(r.id);
    if(this.g.mine(next))this.g.publish(next);else this.g.put(next);
    Promise.resolve(this.g.files?.cancelHandoff({id:r.id,token:move.token})).catch(()=>{});
  }
  notice(r,l){
    if(r.chain?.length)this.g.send(l,'handoff-notice',{id:r.id,chain:r.chain});
  }
  advertise(r,l){
    const x=r.move;if(!x||!l||l.card.id!==x.person||l.card.device!==x.device)return;
    if(x.side==='source'){
      if(x.phase==='offered')this.send(r,'offer',{epoch:r.epoch,members:r.group.members.map(m=>({id:m.id,name:m.name})),name:r.name},l);
      else this.begin(r,l).catch(e=>this.problem(r,e));
    }else if(x.side==='candidate'){
      if(x.phase==='offered')this.send(r,'status',{},l);
      else if(x.phase==='accepted')this.authorize(r).then(()=>{if(this.g.records.get(r.id)?.move?.token===x.token)this.send(r,'accepted',{},l);}).catch(e=>this.problem(r,e));
      else if(x.phase==='prepared')this.send(r,'prepared',{sha:x.sha},l);
    }else if(x.side==='retired')this.send(r,'commit',{hop:x.hop},l);
  }
  reconnect(r,l){
    if(this.g.mine(r)&&M.member(r.group,l.card.id))this.notice(r,l);
    if(r.move?.side==='retired' && r.move.audience?.includes(l.card.id))this.notice(r,l);
    this.advertise(r,l);
  }
  tick(){
    for(const r of this.g.records.values())if(r.move)this.advertise(r,this.link(r));
  }
  problem(r,error){
    if(this.g.records.get(r.id)?.move?.token!==r.move?.token)return;
    this.g.s.issue=String(error?.message||'').slice(0,200);this.g.changed(r.id);
  }
  async begin(r,l){
    if(r.move?.side!=='source'||r.move.phase!=='sending')return;
    let job=this.sending.get(r.id);
    if(!job){
      const bytes=Buffer.from(JSON.stringify(r.group));if(bytes.length>MAX)throw M.full();
      job={bytes,sha:digest(bytes),ready:false,token:r.move.token};this.sending.set(r.id,job);
      try{
        if(this.hasFiles(r.group) && !this.g.files)throw M.denied();
        await this.g.files?.prepareHandoff({group:r.group,person:r.move.person,device:r.move.device,token:r.move.token,link:l});
        job.ready=true;
      }catch(e){if(this.sending.get(r.id)===job)this.sending.delete(r.id);throw e;}
    }
    if(job.ready && this.g.records.get(r.id)?.move?.token===job.token)this.send(r,'start',{bytes:job.bytes.length,sha:job.sha},l);
  }
  hasFiles(g){return Object.values(g.messages).some(rows=>rows.some(r=>r.file));}
  applyNotice(r,l,m){
    if(!r||this.g.mine(r)||r.move?.side==='candidate'||!Array.isArray(m.chain)||m.chain.length>CHAIN)return;
    let owner=r.owner,device=r.device,epoch=r.epoch;
    const fresh=[];
    for(const h of m.chain){
      if(!Number.isSafeInteger(h?.epoch))return;if(h.epoch<=epoch)continue;
      if(h.epoch!==epoch+1||h.previous!==owner||h.from!==device||!validHop(r.id,h))return;
      fresh.push(h);owner=h.owner;device=h.device;epoch=h.epoch;
    }
    if(!fresh.length||!(l.card.id===owner&&l.card.device===device || l.card.id===r.owner&&l.card.device===r.device))return;
    const next={...r,owner,device,epoch,chain:[...(r.chain||[]),...fresh].slice(-CHAIN)};
    if(next.view)next.view={...next.view,owner,device,epoch,revision:0,channels:[],transferring:true};
    this.g.put(next);const newHost=this.g.link(owner,device);if(newHost)this.g.send(newHost,'sync',{id:r.id,epoch});
  }
  async receive(l,m){
    const r=this.g.records.get(m.id);if(!r)return;
    const op=m.op.slice(8);
    if(op==='notice')return this.applyNotice(r,l,m);
    if(!M.uuid(m.token))return;
    const x=r.move,fromOwner=l.card.id===r.owner&&l.card.device===r.device;
    if(op==='offer'&&fromOwner&&r.epoch===m.epoch&&!x&&r.view?.role==='admin'&&
      Array.isArray(m.members)&&m.members.length<=32&&m.members.every(v=>M.key(v?.id)&&typeof v.name==='string'&&v.name.length<=80)){
      if(r.rejectedToken===m.token){this.g.send(l,'handoff-cancel',{id:r.id,token:m.token});return;}
      this.g.put({...r,move:{side:'candidate',phase:'offered',person:r.owner,device:r.device,token:m.token,members:m.members}});return;
    }
    if(op==='commit' && this.g.mine(r) && r.chain?.at(-1)?.token===m.token && l.card.device===r.chain.at(-1).from){
      this.g.send(l,'handoff-ack',{id:r.id,token:m.token});return;
    }
    if(!x||x.token!==m.token||x.person!==l.card.id||x.device!==l.card.device){
      if(this.g.mine(r)&&['status','accepted','prepared'].includes(op))
        this.g.send(l,'handoff-cancel',{id:r.id,token:m.token});
      return;
    }
    if(op==='cancel' && x.side!=='retired'){
      // Once prepared, the source's signed commit or its authenticated cancel
      // determines the outcome. A candidate cannot abandon that durable copy.
      this.cancel(r,false);return;
    }
    if(x.side==='source'){
      if(op==='accepted'){
        const next=x.phase==='sending'?r:{...r,move:{...x,phase:'sending'}};
        if(next!==r)this.g.put(next);await this.begin(next,l);return;
      }
      const job=this.sending.get(r.id);
      if(op==='pull' && job?.ready && job.token===m.token && Number.isInteger(m.offset)&&m.offset>=0&&m.offset<job.bytes.length && m.offset%BLOCK===0){
        this.send(r,'chunk',{offset:m.offset,bytes:job.bytes.subarray(m.offset,m.offset+BLOCK).toString('base64')},l);return;
      }
      if(op==='prepared'&&x.phase==='sending'&&M.key(m.sha)&&m.sha===digest(Buffer.from(JSON.stringify(r.group)))){
        const hop={epoch:r.epoch+1,previous:r.owner,from:r.device,owner:x.person,device:x.device,token:x.token,sha:m.sha};
        hop.proof=sign(this.g.s.profile.device,fields(r.id,hop));
        const group=nextGroup(r.group,hop),view=M.project(group,this.g.s.me.id);
        const retired={id:r.id,name:r.name,owner:hop.owner,device:hop.device,epoch:hop.epoch,chain:[...(r.chain||[]),hop],
          view:{...view,transferring:true},...(group.avatar?{badge:{key:view.avatarKey,pixels:group.avatar}}:{}),
          move:{side:'retired',person:x.person,device:x.device,token:x.token,hop,audience:group.members.map(m=>m.id)}};
        this.g.put(retired);this.sending.delete(r.id);this.send(retired,'commit',{hop},l);
        for(const member of group.members)for(const link of this.g.s.linksTo(member.id))this.notice(retired,link);
      }
      return;
    }
    if(x.side==='retired'&&op==='ack'){
      await this.g.files?.retireHandoff({id:r.id,token:x.token});
      if(this.g.records.get(r.id)?.move?.token!==x.token)return;
      const {move,...done}=this.g.records.get(r.id);this.g.put(done);this.g.send(l,'sync',{id:r.id,epoch:r.epoch});return;
    }
    if(x.side!=='candidate')return;
    if(op==='start'&&x.phase==='accepted'&&M.key(m.sha)&&Number.isSafeInteger(m.bytes)&&m.bytes>0&&m.bytes<=MAX){
      if(this.validating.has(r.id))return;
      let b=this.buffers.get(r.id);
      if(!b||b.sha!==m.sha||b.data.length!==m.bytes){
        if(this.buffers.size>=4&&!b)return;
        b={sha:m.sha,data:Buffer.alloc(m.bytes),offset:0};this.buffers.set(r.id,b);
      }
      this.send(r,'pull',{offset:b.offset},l);return;
    }
    if(op==='chunk'&&x.phase==='accepted'){
      const b=this.buffers.get(r.id);if(!b||m.offset!==b.offset||typeof m.bytes!=='string'||m.bytes.length>BLOCK*4/3+4)return;
      const bytes=Buffer.from(m.bytes,'base64');
      if(bytes.toString('base64')!==m.bytes||bytes.length!==Math.min(BLOCK,b.data.length-b.offset))throw M.invalid();
      bytes.copy(b.data,b.offset);b.offset+=bytes.length;
      if(b.offset<b.data.length){this.send(r,'pull',{offset:b.offset},l);return;}
      this.validating.add(r.id);
      try{
        if(digest(b.data)!==b.sha)throw M.invalid();
        const group=JSON.parse(b.data);validateSnapshot(group,r);this.checkFriends(group.members);
        if(this.hasFiles(group)&&!this.g.files)throw M.denied();
        await this.g.files?.verifyHandoff({group,person:x.person,device:x.device,token:x.token,link:l});
        if(!this.g.active||this.g.records.get(r.id)?.move?.token!==x.token)return;
        const next={...r,move:{...x,phase:'prepared',staged:group,sha:b.sha}};this.g.put(next);this.send(next,'prepared',{sha:b.sha},l);
      }finally{this.buffers.delete(r.id);this.validating.delete(r.id);}
      return;
    }
    if(op==='commit'&&x.phase==='prepared'&&!this.activating.has(r.id)){
      const h=m.hop;
      if(!validHop(r.id,h)||h.token!==x.token||h.sha!==x.sha||h.epoch!==r.epoch+1||h.from!==r.device||h.previous!==r.owner||
        h.owner!==this.g.s.me.id||h.device!==this.g.s.me.device)throw M.denied();
      this.activating.add(r.id);
      try{
        const group=nextGroup(x.staged,h);
        await this.g.files?.activateHandoff({group,token:x.token});
        if(!this.g.active||this.g.records.get(r.id)?.move?.token!==x.token)return;
        const next={id:r.id,name:group.name,owner:h.owner,device:h.device,epoch:h.epoch,chain:[...(r.chain||[]),h],group};
        this.g.put(next);
        for(const member of group.members)for(const link of this.g.s.linksTo(member.id))this.notice(next,link);
        this.g.publish(next);this.g.send(l,'handoff-ack',{id:r.id,token:x.token});
      }finally{this.activating.delete(r.id);}
    }
  }
  close(){this.buffers.clear();this.sending.clear();this.validating.clear();this.activating.clear();}
}
module.exports={GroupHandoff,validateSnapshot};
