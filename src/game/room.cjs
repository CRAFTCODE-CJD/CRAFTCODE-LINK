'use strict';
const { randomUUID } = require('node:crypto');
const { validateName, validateChat, TokenBucket } = require('../core/protocol.cjs');
const { tr } = require('../native-language.cjs');
const { isProbePort } = require('./path-check.cjs');
const LIMIT = 17;
const hex = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const uuid = s => typeof s === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s);
const validSlot = n => Number.isInteger(n) && n >= 1 && n <= LIMIT;
const { validPrefix, newRoomPrefix } = require('./subnet.cjs');
const fail = msg => { throw Error(tr(msg)); };
function readRoster(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > LIMIT) return null;
  if (list.some(p => !p || !hex(p.id) || !hex(p.device) || !validSlot(p.slot) || typeof p.name !== 'string' || !p.name.trim() || p.name.length>48)) return null;
  if (new Set(list.map(p=>p.id)).size!==list.length || new Set(list.map(p=>p.device)).size!==list.length || new Set(list.map(p=>p.slot)).size!==list.length || list[0].slot!==1) return null;
  return list.map(({id,device,slot,name,ready,probePort})=>({id,device,slot,name:validateName(name),ready:ready===true,
    ...(ready===true && (isProbePort(probePort)||probePort===0)?{probePort}:{})}));
}
class GameRoom {
  constructor({ self, links, changed, event, quiet, silent=()=>false }) {
    Object.assign(this,{self,links,changed,event,quiet,silent});
    this.joinRequests=new Map();this.asked=null;this.active=null;this.returnees=new Map();this.invitations=new Map();this.sent=new Map();this.limits=new Map();
    this.departures=new Map();
  }
  state() {
    const r=this.active;
    return {room:r && {id:r.id,title:r.title,prefix:r.prefix,host:r.host,roster:readRoster(r.roster)||[],messages:this.files?r.messages.map(e=>this.files.state(e)):r.messages,
      canShareFiles:!!this.files?.supported(),hasDownloads:!!this.files?.receipts.size,waiting:r.waiting},
      invitations:[...this.invitations.values()].map(({actionId,id,title,peer})=>({id:actionId,room:id,person:peer.id,device:peer.device,title,name:peer.name})),
      requests:[...this.joinRequests.values()].map(({actionId,card})=>({actionId,id:card.id,name:card.name,device:card.device})),asked:this.asked?.room,askedTitle:this.asked?.title,listed:!!r?.listed,invited:[...this.sent.keys()]};
  }
  link(peer){return this.links(peer.id).find(l=>l.card.device===peer.device);}
  send(peer,kind,fields={}){return this.link(peer)?.send({kind:'game-room',action:kind,room:this.active?.id,...fields})===true;}
  create(title,listed=true) {
    if(this.active) fail('Сначала выйдите из игровой LAN.');
    const {id,device,name}=this.self();
    const roomTitle=validateName(title);this.cancelAsk();
    this.active={id:randomUUID(),title:roomTitle,prefix:newRoomPrefix(),host:true,listed,
      roster:[{id,device,name,slot:1}],messages:[],waiting:false};
    this.invitations.clear();this.changed();
  }
  listing(card){
    const r=this.active;if(!r?.host || r.roster.some(p=>p.id===card.id))return null;
    const again=this.returnees.get(card.device)===card.id;
    return r.listed||again?{id:r.id,title:r.title,count:r.roster.length,again}:null;
  }
  setListed(value){
    if(!this.active?.host)fail('Доступно создателю комнаты.');
    this.active.listed=value;if(!value)for(const {card} of [...this.joinRequests.values()])this.review(card.device,false);
    this.changed();
  }
  ask(peer,offer){
    if(this.active||this.asked||!offer||offer.count>=LIMIT||!this.link(peer))fail('Эта комната уже недоступна.');
    const ticket=randomUUID();this.asked={peer,room:offer.id,title:offer.title,ticket,expires:Date.now()+30000};
    if(!this.send(peer,'ask',{room:offer.id,ticket})){this.asked=null;fail('Создатель сейчас недоступен.');}
    this.changed();
  }
  cancelAsk(){
    const req=this.asked;if(!req)return;
    this.asked=null;this.send(req.peer,'unask',{room:req.room,ticket:req.ticket});this.changed();
  }
  review(device,yes,actionId){
    const req=this.joinRequests.get(device);if(!req)return;
    if(actionId!==undefined && actionId!==req.actionId)return;
    this.joinRequests.delete(device);
    const ok=yes&&req.expires>Date.now()&&this.active?.listed&&this.active.roster.length<LIMIT&&!this.sent.has(req.card.id);
    if(ok){
      this.sent.set(req.card.id,{ticket:req.ticket,expires:req.expires,devices:new Set([device])});
      if(!this.send(req.card,'admit',{ticket:req.ticket}))this.sent.delete(req.card.id);
    }
    if(!ok)this.send(req.card,'refused',{ticket:req.ticket,room:req.room});
    this.changed();
  }
  returnOffer(card){
    const r=this.active;
    return r?.host && !r.roster.some(p=>p.id===card.id) && this.returnees.get(card.device)===card.id ?
      {id:r.id,title:r.title,count:r.roster.length}:null;
  }
  rejoin(peer,offer){
    if(this.active || !offer || offer.count>=LIMIT || !this.link(peer))fail('Эта комната уже недоступна.');
    this.cancelAsk();const ticket=randomUUID();
    this.active={id:offer.id,title:offer.title,owner:peer,host:false,roster:[],messages:[],waiting:true,ticket,expires:Date.now()+12000};
    if(!this.send(peer,'return',{ticket})){this.active=null;this.changed();fail('Создатель сейчас недоступен.');}
    this.changed();
  }
  seat(card,ticket){
    const r=this.active;
    if(r.roster.length>=LIMIT || r.roster.some(p=>p.id===card.id))return false;
    const slot=Array.from({length:LIMIT-1},(_,i)=>i+2).find(i=>!r.roster.some(p=>p.slot===i));
    r.roster.push({id:card.id,device:card.device,name:card.name,slot,ticket});
    this.returnees.delete(card.device);this.announce();return true;
  }
  invite(id) {
    const r=this.active;
    if(!r?.host || r.roster.length>=LIMIT || r.roster.some(p=>p.id===id))fail('Приглашение недоступно.');
    const links=this.links(id).filter(l=>!l.remoteRoom||l.remoteRoom.game);
    if(!links.length)fail('Друг сейчас недоступен.');
    if(this.sent.has(id)||this.sent.size>=32)fail('Приглашение уже отправлено или список заполнен.');
    const ticket=randomUUID(),expires=Date.now()+60000;
    this.sent.set(id,{ticket,expires,devices:new Set(links.map(l=>l.card.device))});
    for(const l of new Map(links.map(l=>[l.card.device,l])).values())l.send({kind:'game-room',action:'invite',room:r.id,title:r.title,ticket,expires});
    this.changed();
  }
  answer(id,yes) {
    // The UI holds a local handle to this particular offer, even if another
    // friend later advertises the same wire room ID.
    const inv=[...this.invitations.values()].find(entry=>entry.actionId===id);
    if(!inv || inv.expires<=Date.now())fail('Приглашение устарело.');
    if(yes && this.active)fail('Сначала выйдите из игровой LAN.');
    this.invitations.delete(inv.id);
    if(yes){
      this.cancelAsk();this.invitations.clear();
      this.active={id:inv.id,title:inv.title,host:false,owner:inv.peer,roster:[],messages:[],waiting:true,expires:inv.expires,ticket:inv.ticket};
    }
    if(!this.send(inv.peer,yes?'accept':'decline',{room:inv.id,ticket:inv.ticket}) && yes)this.active=null;
    this.changed();
  }
  adapterReady(ready,probePort){
    const r=this.active,me=r?.roster.find(p=>p.device===this.self()?.device);
    if(!me|| (!!me.ready===ready && me.probePort===probePort))return;
    me.probePort=probePort;
    me.ready=ready;if(r.host)this.announce();else{
      r.localReady=ready;r.localProbePort=probePort;
      this.send(r.owner,'ready',{ready,probePort,ticket:r.ticket});
    }
  }
  reconnected(link){
    const r=this.active,peer=link.card;
    if(!r || r.waiting)return;
    const member=r.roster.find(p=>p.id===peer.id && p.device===peer.device);
    if(!member)return;
    if(r.host)this.sendRoster(link,member);
    else if(member.slot===1){
      link.send({kind:'game-room',action:'ready',room:r.id,ticket:r.ticket,requestRoster:true,ready:r.localReady===true,probePort:r.localProbePort});
    }
  }
  sendRoster(link,member){
    const r=this.active;
    link?.send({kind:'game-room',action:'roster',room:r.id,ticket:member.ticket,list:readRoster(r.roster),prefix:r.prefix});
  }
  announce(){
    const r=this.active;
    for(const p of r.roster.slice(1))this.sendRoster(this.link(p),p);
    this.changed();
  }
  leave(notify=true){
    const r=this.active;
    if(r && notify){
      if(r.host){for(const {card,ticket} of this.joinRequests.values())this.send(card,'end',{ticket});
        for(const p of r.roster.slice(1))this.send(p,'end',{ticket:p.ticket});
        for(const [id,inv] of this.sent)for(const l of this.links(id))this.send(l.card,'end',{ticket:inv.ticket});}
      else {
        if(!r.waiting)this.departures.set(r.owner.device,{owner:r.owner.id,room:r.id,ticket:r.ticket,expires:Date.now()+30000});
        this.send(r.owner,'leave',{ticket:r.ticket});
      }
    }
    this.active=null;this.asked=null;this.joinRequests.clear();this.returnees.clear();this.sent.clear();this.limits.clear();
    this.event({type:'game-ended'});this.changed();
  }
  remove(id) {
    for(const [device,entry] of this.departures)if(entry.owner===id)this.departures.delete(device);
    if(this.asked?.peer.id===id)this.asked=null;
    for(const [device,req] of this.joinRequests)if(req.card.id===id)this.joinRequests.delete(device);
    for(const [device,person] of this.returnees)if(person===id)this.returnees.delete(device);
    const expelled=this.active?.host&&this.active.roster.slice(1).find(p=>p.id===id);if(expelled)this.send(expelled,'end',{ticket:expelled.ticket});
    this.sent.delete(id);
    for(const [k,v] of this.invitations)if(v.peer.id===id)this.invitations.delete(k);
    const r=this.active;
    if(r?.host && r.roster.slice(1).some(p=>p.id===id)){r.roster=r.roster.filter(p=>p.id!==id);this.announce();}
    else if(r && !r.host && r.owner.id===id)this.leave(false);
    this.changed();
  }
  tick(){
    const now=Date.now();let dirty=false;
    for(const [device,entry] of this.departures)if(entry.expires<=now)this.departures.delete(device);
    if(this.asked?.expires<=now){const name=this.asked.peer.name;this.cancelAsk();this.event({type:'game-notice',name,text:tr('Время ожидания ответа истекло.')});}
    for(const [key,req] of this.joinRequests)if(req.expires<=now){this.joinRequests.delete(key);dirty=true;}
    if(this.rosterDirty&&this.active?.host){this.rosterDirty=false;this.announce();}
    for(const map of [this.invitations,this.sent])for(const [id,v] of map)if(v.expires<=now){map.delete(id);dirty=true;}
    const r=this.active;
    if(r?.waiting && r.expires<=now)this.leave(false);
    else if(r && !r.waiting){
      const peers=r.host?r.roster.slice(1):[r.owner];
      for(const p of peers){
        if(this.link(p)){delete p.offlineAt;continue;}
        if(!p.offlineAt)p.offlineAt=now;
        if(now-p.offlineAt>=15000)this.remove(p.id);
      }
    }
    if(dirty)this.changed();
  }
  note(from,text){
    const r=this.active,event={id:randomUUID(),name:from.name,device:from.device,text,time:Date.now()};
    for(const p of r.roster.slice(1))this.send(p,'text',{entry:event});
    this.append(event);
  }
  append(entry){const list=this.active.messages;list.push(entry);if(list.length>80)list.shift();this.changed();}
  clearChat(room,through){
    if(!this.active||this.active.id!==room)return;
    const messages=this.active.messages;
    const end=messages.findIndex(entry=>entry.id===through);
    if(end<0)return;
    messages.splice(0,end+1);this.changed();
  }
  chat(text){
    const r=this.active;if(!r || r.waiting)fail('Игровая LAN ещё не подключена.');
    text=validateChat(text);if(text.length>1000)fail('Максимальная длина сообщения — 1000 символов.');
    if(r.host)this.note(r.roster[0],text);
    else if(!this.send(r.owner,'say',{text}))fail('Создатель сейчас недоступен.');
  }
  receive(card,m){
    if(!uuid(m.room))return;
    const r=this.active, action=m.action;
    const owner=r && !r.host && r.id===m.room && r.owner.id===card.id && r.owner.device===card.device;
    if(action==='roster' && m.ticket!==undefined && (!owner || r.ticket!==m.ticket)){
      if(!uuid(m.ticket))return;
      const left=this.departures.get(card.device);
      const voluntary=left?.owner===card.id && left.room===m.room && left.ticket===m.ticket && left.expires>Date.now();
      this.send(card,voluntary?'leave':'end',{room:m.room,ticket:m.ticket});return;
    }
    if(action==='ready' && m.requestRoster===true){
      if(!uuid(m.ticket) || typeof m.ready!=='boolean')return;
      const seat=r?.host && r.id===m.room && r.roster.slice(1).find(p=>p.id===card.id && p.device===card.device && p.ticket===m.ticket);
      if(!seat){this.send(card,'end',{room:m.room,ticket:m.ticket});return;}
    }
    if(action==='unask' && r?.host && r.id===m.room && uuid(m.ticket)){
      const req=this.joinRequests.get(card.device),grant=this.sent.get(card.id);
      if(req?.card.id===card.id && req.ticket===m.ticket){this.joinRequests.delete(card.device);this.changed();}
      if(grant?.ticket===m.ticket && grant.devices.has(card.device)){grant.devices.delete(card.device);if(!grant.devices.size)this.sent.delete(card.id);this.changed();}
      return;
    }
    if(action==='ask' && uuid(m.ticket)){
      if(!r?.host||r.id!==m.room||!r.listed||this.quiet()||this.silent()||r.roster.length>=LIMIT||r.roster.some(p=>p.id===card.id)||this.joinRequests.size>=32){
        this.send(card,'refused',{room:m.room,ticket:m.ticket});return;
      }
      if(!this.joinRequests.has(card.device)){
        const actionId='request-'+randomUUID();
        this.joinRequests.set(card.device,{actionId,card,ticket:m.ticket,room:m.room,expires:Date.now()+30000});
        this.event({type:'game-requested',id:actionId,name:card.name});this.changed();
      }return;
    }
    const ask=this.asked;
    if(ask && ask.room===m.room && ask.peer.id===card.id && ask.peer.device===card.device){
      if(action==='end' && (!m.ticket || m.ticket===ask.ticket)){this.asked=null;this.changed();this.event({type:'game-notice',name:card.name,text:tr('Эта комната уже недоступна.')});return;}
      if(action==='refused' && ask.ticket===m.ticket){this.asked=null;this.changed();this.event({type:'game-notice',name:card.name,text:tr('Запрос на вход отклонён.')});return;}
      if(action==='admit' && !r && ask.expires>Date.now() && ask.ticket===m.ticket){
        this.asked=null;this.active={id:ask.room,title:ask.title,owner:ask.peer,host:false,roster:[],messages:[],waiting:true,expires:ask.expires,ticket:ask.ticket};
        this.send(card,'accept',{ticket:ask.ticket});this.changed();return;
      }
    }
    if(action==='invite'){
      if(!uuid(m.ticket)||!Number.isFinite(m.expires)||m.expires<=Date.now()||m.expires>Date.now()+65000 ||
        this.invitations.size>=16||this.invitations.has(m.room)||typeof m.title!=='string'||!m.title.trim()||m.title.length>48||
        [...this.invitations.values()].some(i=>i.peer.id===card.id))return;
      if(this.quiet()||r){this.send(card,'decline',{room:m.room,ticket:m.ticket});return;}
      const peer={id:card.id,device:card.device,name:card.name};
      const actionId='invite-'+randomUUID();
      this.invitations.set(m.room,{id:m.room,actionId,title:validateName(m.title),peer,ticket:m.ticket,expires:m.expires});
      if(!this.silent())this.event({type:'game-invited',id:actionId,name:card.name});this.changed();return;
    }
    if(action==='end'){
      const inv=this.invitations.get(m.room);if(inv?.peer.id===card.id&&inv.peer.device===card.device && (m.ticket===undefined || m.ticket===inv.ticket)){this.invitations.delete(m.room);this.changed();}
    }
    if(action==='return' && uuid(m.ticket)){
      if(!this.quiet() && this.returnOffer(card)?.id===m.room && this.seat(card,m.ticket))return;
      this.send(card,'return-denied',{room:m.room,ticket:m.ticket});return;
    }
    if(!r || m.room!==r.id)return;
    if(action==='return-denied' && r.waiting && r.ticket===m.ticket && r.owner?.id===card.id && r.owner.device===card.device){
      this.leave(false);this.event({type:'game-notice',name:card.name,text:tr('Эта комната уже недоступна.')});return;
    }
    if(r.host && (action==='accept'||action==='decline')){
      const ticket=this.sent.get(card.id);
      if(!ticket||ticket.ticket!==m.ticket||ticket.expires<=Date.now()||!ticket.devices.has(card.device))return;
      if(action==='decline'){ticket.devices.delete(card.device);if(ticket.devices.size)return;this.event({type:'game-notice',name:card.name,text:tr('Приглашение не принято.')});}
      this.sent.delete(card.id);
      if(action!=='accept'||!this.seat(card,m.ticket))this.send(card,'end',{ticket:m.ticket});
      for(const other of this.links(card.id))if(other.card.device!==card.device)this.send(other.card,'end',{ticket:m.ticket});
      this.changed();return;
    }
    if(owner){
      if(action==='end' && (m.ticket===undefined || m.ticket===r.ticket)){this.leave(false);return;}
      if(action==='roster'){
        const list=readRoster(m.list),self=this.self();
        const me=list?.find(p=>p.device===self.device && p.id===self.id);
        if(!me||!validPrefix(m.prefix)||list[0].device!==card.device || list[0].id!==card.id)return;
        if(!r.waiting && r.prefix !== m.prefix)return;
        const reported=me.ready;
        me.ready=r.localReady===true;me.probePort=r.localProbePort;
        r.waiting=false;r.prefix=m.prefix;r.roster=list;this.changed();
        if(reported!==me.ready)this.send(r.owner,'ready',{ready:me.ready,probePort:me.probePort,ticket:r.ticket});
        return;
      }
    }
    const p=r.roster.find(p=>p.id===card.id && p.device===card.device);
    if(!p||(!r.host && p.slot!==1))return;
    if(r.host && m.ticket!==undefined && m.ticket!==p.ticket)return;
    if(r.host && action==='end' && uuid(m.ticket)){
      r.roster=r.roster.filter(person=>person!==p);this.limits.delete(card.id);this.announce();return;
    }
    if(r.host && action==='ready' && typeof m.ready==='boolean'){
      if(m.probePort!==undefined && m.probePort!==0 && !isProbePort(m.probePort))return;
      const probePort=m.ready?m.probePort:undefined;
      if(!!p.ready!==m.ready || p.probePort!==probePort){
        p.ready=m.ready;p.probePort=probePort;const now=Date.now();
        if(now-(p.lastReady||0)>750){p.lastReady=now;this.announce();return;}
        this.rosterDirty=true;
      }
      if(m.requestRoster===true)this.sendRoster(this.link(p),p);
      return;
    }
    if(r.host && action==='leave'){
      r.roster=r.roster.filter(person=>person!==p);
      if(this.returnees.size>=256)this.returnees.delete(this.returnees.keys().next().value);
      this.returnees.set(card.device,card.id);this.limits.delete(card.id);this.announce();return;
    }
    if(r.host && action==='say' && typeof m.text==='string' && m.text.length<=1000){
      if(!this.limits.has(p.id))this.limits.set(p.id,new TokenBucket(2,5));
      if(this.limits.get(p.id).take())this.note(p,validateChat(m.text));
    }
    const e=m.entry;
    if(!r.host && action==='text' && e && uuid(e.id) && typeof e.text==='string' && e.text.length<=1000 && typeof e.name==='string' && Number.isSafeInteger(e.time))
      this.append({id:e.id,name:validateName(e.name),text:validateChat(e.text),time:e.time,
        ...(hex(e.device)&&r.roster.some(p=>p.device===e.device&&p.name===e.name)?{device:e.device}:{})});
  }
}
module.exports={GameRoom,validPrefix,validSlot,LIMIT};
