import {tr} from './locale.mjs';
// Signaling is addressed to a single authenticated XMPP resource. Only the host assigns media slots.
import { RoomText } from './room-text.mjs';
import { cleanDisplayName } from './profile-name.mjs';
const uuid = () => crypto.randomUUID();
const isId = s => typeof s === 'string' && /^[a-f0-9-]{36}$/.test(s);
const peer = (id, name, slot) => ({ id, name, slot, micMuted:true, sharing:false, shareTitle:'' });
const cleanPresence = p => ({ micMuted:p?.micMuted !== false, sharing:p?.sharing === true, shareTitle:String(p?.shareTitle || '').slice(0,100) });
const cleanName = s => String(s || '').replace(/[\p{Cc}\p{Cf}]/gu,'').slice(0,48);
const display = full => cleanName(full.split('@')[0]);
const MAX = 3;
const liveKinds=new Set(['ping','presence','roster','bye']);

export class InternetRoom {
  constructor({ account, event, changed, busy, accepted, error, ring, myName, quiet=()=>false, inCall=()=>false, promptBusy = ()=>false, sendControl = ()=>false, requestEnded = () => {} }) {
    Object.assign(this,{ account, event, changed, busy, accepted, error, ring, myName, quiet, inCall, promptBusy, sendControl, requestEnded });
    this.returnees=new Set();this.channelSeen = new Map(); this.members = new Map(); this.seen = new Set();
  }
  forgetReturn(id){for(const full of this.returnees)if(full.split('/')[0]===id)this.returnees.delete(full);}
  canReturn(full){return this.room?.role==='host' && this.returnees.has(full) && this.account.mutual(full.split('/')[0]);}
  info() {
    if (!this.room) throw new Error(tr('Звонок уже завершён.'));
    return { contacts:true, internet:true, role:this.room.role, hostId:'host', selfId:this.room.selfId,
      peers:this.room.peers.map(p => ({ ...p })) };
  }
  host(keepOpen = false) {
    if (this.busy() || this.room || this.pending || this.joining) throw new Error(tr('Другой звонок уже начался.'));
    this.room = {role:'host', keepOpen, id:uuid(), selfId:'host', peers:[peer('host',this.myName?.() || display(this.account.id),0)]};
  }
  send(full, kind, fields = {}, room = this.room?.id) {
    const packet={version:1,kind,room,...fields};
    if(liveKinds.has(kind) && this.room?.id===room) {
      const id=this.room.role==='guest' && full===this.hostFull ? 'host' : this.members.get(full)?.peer.id;
      const recent=Date.now()-(this.channelSeen.get(id) ?? -Infinity)<20000;
      if(id && (recent || kind==='ping' || this.account.status!=='online') && this.sendControl(id,packet)){
        if(recent || this.account.status!=='online')return;
      }
      if(this.account.status!=='online')return;
    }
    this.account.send(full,packet);
  }
  fromChannel(id,packet) {
    if(!this.room || packet?.version!==1 || packet.room!==this.room.id || !liveKinds.has(packet.kind))return;
    const full=this.room.role==='guest' ? (id==='host' ? this.hostFull : null)
      : [...this.members].find(([,m])=>m.ready && m.peer.id===id)?.[0];
    if(!full || !this.account.mutual(full.split('/')[0]))return;
    this.channelSeen.set(id,Date.now());
    this.receive(full,packet);
  }
  requestJoin(target, origin = 'code') {
    if (this.busy() || this.pending || this.room || this.joining) throw new Error(tr('Уже идёт подключение или звонок.'));
    if (target.owner === this.account.id) throw new Error(tr('Это приглашение в вашу комнату.'));
    if (!this.account.mutual(target.owner)) throw new Error(tr('Сначала добавьте создателя в друзья и дождитесь подтверждения.'));
    if (!this.account.resources.get(target.owner)?.has(target.full)) throw new Error(tr('Создатель сейчас недоступен. Попросите его открыть комнату и прислать новое приглашение.'));
    const token = uuid();
    this.send(target.full,'join-request',{token,expires:Date.now()+30000},target.room);
    this.joining = {...target,token,origin};
    this.clock('joining',()=>this.endJoin(tr('Друг не ответил. Проверьте, открыта ли комната.')),30000);
    this.changed();
  }
  endJoin(reason = '') {
    if (!this.joining) return;
    const {origin,full,token,room}=this.joining;
    try{this.send(full,'join-cancel',{token},room);}catch{}
    this.clear('joining');
    this.requestEnded(reason,origin);
    this.changed();
  }
  invite(id, requested = null) {
    const full = requested?.full || this.account.full(id);
    if (!full || !this.account.mutual(id)) throw new Error(tr('Друг сейчас недоступен.'));
    if (this.room?.role !== 'host' || this.outgoing || this.members.size >= MAX-1 ||
        [...this.members.keys()].some(key => key.split('/')[0] === id)) throw new Error(tr('Невозможно пригласить участника.'));
    const token = uuid();
    const purpose=this.room.keepOpen || this.room.peers.length>1 || requested ? 'invite' : 'call';
    this.send(full,'ring',{token,purpose,expires:Date.now()+30000,...(requested ? {requestToken:requested.token} : {})});
    this.outgoing = { full, token, purpose, requestToken:requested?.token };
    this.clock('outgoing', () => this.cancel(tr('Друг не ответил.'),'timeout'), 30000); this.changed();
  }
  clock(name, fn, ms) { clearTimeout(this[name+'Timer']); this[name+'Timer'] = setTimeout(fn,ms); }
  cancel(reason = '', outcome = 'cancel') {
    if (!this.outgoing) return;
    const {full,token} = this.outgoing;
    if(outcome!=='remote')try { this.send(full,'cancel',{token,outcome}); } catch {}
    this.clear('outgoing');
    if (this.room?.peers.length === 1 && !this.room.keepOpen) this.event({type:'closed',notice:true,reason:reason || tr('Вызов отменён.')});
    else if(reason)this.error(reason);
    this.changed();
  }
  clear(k) { clearTimeout(this[k+'Timer']); this[k] = null; }
  decline(outcome = 'declined') {
    const p = this.pending; if (!p) return;
    try { this.send(p.full,p.purpose==='entry'?'join-unavailable':'decline',{token:p.token,outcome},p.room); } catch {}
    this.clear('pending'); this.changed();
    if(outcome==='timeout')this.error(p.accepted?tr('Подключение не завершилось.'):tr('Пропущенный вызов · ')+p.full.split('/')[0]);
  }
  accept() {
    const p = this.pending;
    if(p?.purpose==='entry'){
      if(this.quiet()||p.expires<=Date.now()||this.room?.id!==p.room){this.decline('busy');return;}
      this.invite(p.full.split('/')[0],p);this.clear('pending');this.changed();return;
    }
    if (!p || p.accepted || this.busy()) throw new Error(tr('Вызов недоступен.'));
    this.send(p.full,'accept',{token:p.token,name:this.myName?.(),mediaSlots:3},p.room);
    p.accepted = true;this.clock('pending',()=>this.decline('timeout'),20000);this.changed();
  }
  publish(includeRemote = true) {
    if (!this.room) return;
    this.event({type:'roster',peers:this.room.peers.map(p=>({...p}))});
    if (includeRemote && this.room.role === 'host') for (const [full,m] of this.members)
      if (m.ready) this.send(full,'roster',{peers:this.room.peers});
    this.changed();
  }
  textLink(peerId) {
    return this.room?.role==='guest' && peerId==='host' ? this.hostFull :
      [...this.members].find(([,m])=>m.ready && m.peer.id===peerId)?.[0];
  }
  ensureText(){
    if(!this.text && this.room){
      const roomId=this.room.id;
      this.text=new RoomText(roomId,this.room.selfId,(id,kind,fields)=>{
        const full=this.textLink(id);
        if(!full || this.room?.id!==roomId || !this.account.mutual(full.split('/')[0]))throw Error(tr('Участник недоступен.'));
        this.send(full,kind,fields);
      },(id,msg)=>this.onText?.(id,msg),()=>this.changed());
    }
    return this.text;
  }
  ready() {
    if (this.room?.role === 'guest') this.send(this.hostFull,'ready');
  }
  resume() {
    if (!this.room) return;
    if (this.room.role === 'guest') {this.send(this.hostFull,'resume');this.ensureText().hello('host').catch(()=>{});}
    else for (const [full, m] of this.members) if (m.ready) this.send(full,'resume');
  }
  expireMember(full) {
    if (this.room?.role === 'guest' && full === this.hostFull) return this.event({type:'closed',reason:tr('Связь с создателем потеряна.')});
    const m = this.members.get(full); if (m) {
      clearTimeout(m.timer); this.text?.links.delete(m.peer.id);this.channelSeen.delete(m.peer.id); this.members.delete(full);
      this.room.peers = this.room.peers.filter(p => p.id !== m.peer.id); this.publish();
    }
  }
  monitor() {
    if (!this.room) return;
    const now = Date.now();
    if (this.room.role === 'guest' && now - this.lastHost > 120000) return this.expireMember(this.hostFull);
    for (const [full,m] of this.members) if (now - m.last > 120000) this.expireMember(full);
    if(this.account.status==='online' && this.room.role==='host')for(const [full,m] of this.members){
      if(m.ready && !this.ensureText().ready(m.peer.id) && (m.keyAttempts || 0)<4 && now-(m.keyTime || 0)>12000){
        m.keyAttempts=(m.keyAttempts || 0)+1;m.keyTime=now;
        this.text.hello(m.peer.id).catch(()=>{});
      }
    }
    const silence=this.room.role==='guest'?now-this.lastHost:Math.max(0,...[...this.members.values()].map(m=>now-m.last));
    if(silence>18000 && this.account.status==='online')this.account.probe?.();
    if (this.room.role === 'guest') this.send(this.hostFull,'ping');
    else for (const [full,m] of this.members) if (m.ready) this.send(full,'ping');
  }
  receive(full, d) {
    if (!d || d.version !== 1 || !isId(d.room) || !this.account.mutual(full.split('/')[0])) return;
    const p = this.pending, out = this.outgoing, join = this.joining;
    if(d.kind==='join-cancel' && out?.requestToken && out.full===full && out.requestToken===d.token && this.room?.id===d.room){this.cancel();return;}
    if(d.kind==='join-cancel' && p?.purpose==='entry' && p.full===full && p.room===d.room && p.token===d.token){this.clear('pending');this.changed();return;}
    if (d.kind === 'join-request' && isId(d.token) && d.expires > Date.now() && d.expires <= Date.now()+65000) {
      if(this.seen.has(d.token))return;
      if(this.seen.size>=256)this.seen.delete(this.seen.values().next().value);this.seen.add(d.token);
      if (!this.quiet() && !this.promptBusy() && !p && !out && this.room?.role==='host' && this.room.id===d.room &&
          this.members.size<MAX-1 && ![...this.members.keys()].some(key=>key.split('/')[0]===full.split('/')[0])){
        if(this.canReturn(full) || (this.approvedDoor?.full===full && this.approvedDoor.room===d.room && this.approvedDoor.until>Date.now())){
          this.approvedDoor=null;this.invite(full.split('/')[0],{full,token:d.token});return;
        }
        this.pending={purpose:'entry',full,token:d.token,room:d.room,expires:d.expires};
        this.clock('pending',()=>this.decline('timeout'),d.expires-Date.now());this.ring();this.changed();return;
      }
      this.send(full,'join-unavailable',{token:d.token},d.room); return;
    }
    if (d.kind === 'join-unavailable' && join?.full === full && join.room === d.room && join.token === d.token) {
      this.endJoin(d.outcome==='declined'?tr('Друг отклонил запрос на вход.'):tr('Комната закрыта или занята.')); return;
    }
    if (d.kind === 'ring' && isId(d.token) && Number.isFinite(d.expires) && d.expires > Date.now() && d.expires <= Date.now()+65000) {
      if (this.seen.has(d.token)) return;
      if (this.seen.size >= 256) this.seen.delete(this.seen.values().next().value);
      this.seen.add(d.token);
      const expected = join && join.full === full && join.room === d.room && join.token === d.requestToken;
      if ((this.quiet() && !expected) || out || p || (this.busy()&&!this.inCall()) || this.promptBusy() || (d.requestToken || join) && !expected) return this.send(full,'decline',{token:d.token,outcome:'busy'},d.room);
      if (expected) this.clear('joining');
      this.pending = {full,room:d.room,token:d.token,switchCall:this.inCall(),purpose:d.purpose==='call'?'call':'invite'};
      this.clock('pending',()=>this.decline('timeout'),Math.max(1,d.expires-Date.now())); if (expected) this.accept(); else this.ring(); this.changed(); return;
    }
    if (p && full === p.full && d.room === p.room && d.token === p.token) {
      if (d.kind === 'cancel') { this.clear('pending'); this.changed();this.error(d.outcome==='timeout'?tr('Пропущенный вызов · ')+full.split('/')[0]:p.purpose==='call'?tr('Друг отменил вызов.'):tr('Друг отменил приглашение.')); return; }
      if (d.kind === 'welcome' && p.accepted && isId(d.selfId) && this.validRoster(d.peers,d.selfId)) {
        this.clear('pending'); this.hostFull = full; this.lastHost = Date.now();
        this.room = { role:'guest', id:d.room, selfId:d.selfId, peers:this.cleanRoster(d.peers) };
        this.accepted(); this.changed(); return;
      }
    }
    if (d.room !== this.room?.id) return;
    if (out?.full === full && out.token === d.token) {
      if (d.kind === 'decline') { this.cancel(d.outcome==='timeout'?tr('Друг не ответил.'):d.outcome==='busy'?tr('Друг сейчас занят.'):out.purpose==='call'?tr('Друг отклонил вызов.'):tr('Друг отклонил приглашение.'),'remote'); return; }
      if (d.kind === 'accept' && this.room.role === 'host') {
        const slots = new Set([...this.members.values()].map(v=>v.peer.slot));
        const slot = [1,2].find(i=>!slots.has(i)); if (!slot) return this.cancel(tr('В комнате уже трое.'));
        const guest = peer(uuid(),cleanDisplayName(d.name) || display(full),slot);
        if(d.mediaSlots===3)guest.mediaSlots=3;
        const m = { peer:guest, token:d.token, ready:false, last:Date.now() };
        m.timer = setTimeout(()=>{ if(!m.ready){ this.expireMember(full); if(this.room?.peers.length===1 && !this.room.keepOpen) this.event({type:'closed',reason:tr('Друг не подключился.')}); } },20000);
        this.members.set(full,m); this.clear('outgoing');
        this.send(full,'welcome',{token:d.token,selfId:guest.id,peers:[...this.room.peers,guest]}); this.changed(); return;
      }
    }
    const member = this.members.get(full);
    const host = this.room.role === 'guest' && full === this.hostFull;
    if (!host && !member) return;
    if (host) this.lastHost = Date.now(); else member.last = Date.now();
    if(member && !member.ready && d.kind==='decline' && d.token===member.token){
      this.expireMember(full);if(!this.room.keepOpen && this.room.peers.length===1)this.event({type:'closed',notice:true,reason:tr('Подключение отменено.')});return;
    }
    if (d.kind === 'ping') return;
    if (d.kind === 'bye') {
      if(member?.ready && this.room.role==='host'){
        if(this.returnees.size>=256)this.returnees.delete(this.returnees.values().next().value);
        this.returnees.add(full);
      }
      return this.expireMember(full);
    }
    if (d.kind === 'ready' && member && !member.ready) {
      clearTimeout(member.timer); member.ready=true; this.room.peers.push(member.peer); this.publish();
      this.ensureText().hello(member.peer.id).catch(()=>{}); return;
    }
    if (!host && !member.ready) return;
    if(d.kind==='text-key' || d.kind==='text-box'){
      this.ensureText().receive(host?'host':member.peer.id,d).catch(()=>{});return;
    }
    if (d.kind === 'resume') {
      this.ensureText().hello(host?'host':member.peer.id).catch(()=>{});
      if (member) this.publish();
      this.event({type:'internet-restart',peerId:host?'host':member.peer.id}); return;
    }
    if (host && d.kind === 'roster' && this.validRoster(d.peers,this.room.selfId)) {
      this.room.peers=this.cleanRoster(d.peers); this.publish(false); return;
    }
    if (member && d.kind === 'presence') { Object.assign(member.peer,cleanPresence(d.value)); this.publish(); }
    if (d.kind === 'signal' && ['offer','answer','ice','restart','view-height','share-profile'].includes(d.data?.type))
      this.event({type:'signal',from:host?'host':member.peer.id,data:d.data});
  }
  validRoster(peers, selfId) {
    return Array.isArray(peers) && peers.length >= 2 && peers.length <= MAX &&
      peers.every(p=>p && Number.isInteger(p.slot) && p.slot>=0 && p.slot<MAX && (p.slot === 0 ? p.id==='host' : isId(p.id))) &&
      new Set(peers.map(p=>p.id)).size === peers.length && new Set(peers.map(p=>p.slot)).size === peers.length &&
      peers.some(p=>p.id==='host') && peers.some(p=>p.id===selfId);
  }
  cleanRoster(roster) { return roster.map(p=>({...peer(p.id,cleanName(p.name),p.slot),...cleanPresence(p)})); }
  signal({peerId,data}) {
    const full = this.room?.role === 'guest' && peerId === 'host' ? this.hostFull :
      [...this.members].find(([,m])=>m.peer.id===peerId && m.ready)?.[0];
    if(full && this.account.status==='online') this.send(full,'signal',{data});
  }
  presence(value) {
    if (!this.room) return;
    if (this.room.role === 'guest') this.send(this.hostFull,'presence',{value});
    else { Object.assign(this.room.peers[0],cleanPresence(value)); this.publish(); }
  }
  leave() {
    if (this.room) {
      const targets = this.room.role === 'host' ? [...this.members.keys()] : [this.hostFull];
      for (const full of targets) try { this.send(full,'bye'); } catch {}
    }
    if (this.outgoing) try { this.send(this.outgoing.full,'cancel',{token:this.outgoing.token}); } catch {}
    this.returnees.clear();this.approvedDoor=null;this.clear('joining'); this.clear('outgoing'); if(!this.pending||this.pending!==this.keepPending)this.decline();
    for(const m of this.members.values()) clearTimeout(m.timer);
    this.text?.close();this.text=null;
    this.channelSeen.clear(); this.members.clear(); this.hostFull=null; this.room=null; this.changed();
  }
}
