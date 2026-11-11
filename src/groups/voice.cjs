'use strict';
const {randomUUID,randomBytes}=require('node:crypto');
const {LIMITS,TokenBucket,validateSignal,validateRoster,validatePresence,validateChat,validateName}=require('../core/protocol.cjs');
const {tr}=require('../native-language.cjs');
const {sign,verify}=require('../direct/identity.cjs');
const {roomTag}=require('../direct/avatars.cjs');
const uuid=v=>typeof v==='string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const unavailable=()=>Error(tr('Голосовой канал недоступен.'));
const key=(group,channel)=>group+'/'+channel;
const witness=(room,peer)=>['LINK group voice seat v1',room.group,room.channel,room.epoch,room.session,peer];

// The group owner's device authenticates participants and routes signalling.
// Each occupied channel has its own media host. The owner's UI can be in any
// room (or in none). Only the local user's explicit join creates a client seat.
class GroupVoice {
  constructor(service){
    this.service=service;this.rooms=new Map();this.parts=new Map();
  }
  access(group,channel,person){return !this.service.paused&&!this.service.strict && this.service.groups?.voiceAccess(group,channel,person);}
  self(){return this.service.me;}
  link(person,device){
    return this.service.linksTo(person).find(link=>link.card.device===device && this.service.groups.fileAllowed(link));
  }
  connected(person,device){return this.self()?.id===person&&this.self().device===device || !!this.link(person,device);}
  post(person,device,message){
    if(this.self()?.id===person && this.self().device===device){
      const me=this.self();queueMicrotask(()=>this.route(me,message));return true;
    }
    const link=this.link(person,device);if(!link)return false;
    const bytes=Buffer.from(JSON.stringify(message));
    if(bytes.length>LIMITS.signalBytes+4000)return false;
    if(bytes.length<22000)return link.send({kind:'group-voice',message});
    const id=randomUUID(),total=Math.ceil(bytes.length/15000);
    for(let i=0;i<total;i++)if(!link.send({kind:'group-voice',part:{id,i,total,group:message.group,channel:message.channel,
      data:bytes.subarray(i*15000,(i+1)*15000).toString('base64')}}))return false;
    return true;
  }
  receive(link,packet){
    if(!this.service.groups.fileAllowed(link))return;
    if(packet.message){this.route(link.card,packet.message);return;}
    const p=packet.part;if(!p || !uuid(p.group)||!uuid(p.channel)||!uuid(p.id)||!Number.isInteger(p.total)||p.total<2||p.total>9||
      !Number.isInteger(p.i)||p.i<0||p.i>=p.total||typeof p.data!=='string'||p.data.length>20000||!this.hasRoute(link.card,p))return;
    const id=link.card.device+'/'+p.id;
    let buffer=this.parts.get(id);
    if(p.i===0){
      if(this.parts.size>=32)return;
      buffer={group:p.group,channel:p.channel,total:p.total,bytes:0,chunks:[],until:Date.now()+10000};this.parts.set(id,buffer);
    }
    if(!buffer||buffer.total!==p.total||buffer.chunks.length!==p.i||buffer.group!==p.group||buffer.channel!==p.channel){this.parts.delete(id);return;}
    const bytes=Buffer.from(p.data,'base64');buffer.bytes+=bytes.length;
    if(buffer.bytes>LIMITS.signalBytes+4000){this.parts.delete(id);return;}
    buffer.chunks.push(bytes);
    if(p.i+1===p.total){
      this.parts.delete(id);
      try{const m=JSON.parse(Buffer.concat(buffer.chunks));if(m.group===p.group&&m.channel===p.channel)this.route(link.card,m);}catch{}
    }
  }
  hasRoute(card,m){
    if([this.local,this.preparing].some(s=>s && s.owner===card.id&&s.device===card.device&&s.group===m.group&&s.channel===m.channel))return true;
    return this.rooms.get(key(m.group,m.channel))?.seats.some(s=>s.person===card.id&&s.device===card.device);
  }
  route(card,m){
    if(!m || !uuid(m.group)||!uuid(m.channel)||!uuid(m.ticket)||this.service.paused||this.service.strict)return;
    try{
      if(m.down===true)this.down(card,m);
      else this.up(card,m);
    }catch{/* Invalid network input never changes local device state. */}
  }
  deliver(room,s,op,body={}){
    return this.post(s.person,s.device,{group:room.group,channel:room.channel,epoch:room.epoch,ticket:s.ticket,session:room.session,down:true,op,...body});
  }
  roster(room,reason){
    this.service.groups?.directory?.schedule(room.group);
    const peers=room.seats.map(s=>({...s.peer}));
    for(const s of room.seats)this.deliver(room,s,'roster',{selfId:s.peer.id,peers,reason});
    this.identities(room);
  }
  identities(room){
    const members=room.seats.filter(s=>s.proof).map(s=>[s.peer.id,s.person,s.proof]);
    for(const s of room.seats)this.deliver(room,s,'members',{members});
  }
  contacts(){
    return Object.fromEntries(Object.entries(this.local?.contacts||{}).filter(([,person])=>
      this.service.contact(person)?.state==='friend'&&!this.service.blocked(person)));
  }
  remove(room,s,notify=true){
    if(!room.seats.includes(s))return;
    if(notify)this.deliver(room,s,'end');
    room.seats=room.seats.filter(seat=>seat!==s);
    if(!room.seats.length){this.rooms.delete(key(room.group,room.channel));this.service.groups?.directory?.schedule(room.group);return;}
    if(s.peer.slot===0){
      const next=room.seats[0];next.peer.id='host';next.peer.slot=0;
      for(const seat of room.seats)delete seat.proof;
      room.session=randomUUID();this.roster(room,'elect');
    }else this.roster(room);
  }
  up(card,m){
    const access=this.access(m.group,m.channel,card.id), owner=this.self();
    const id=key(m.group,m.channel);
    let room=this.rooms.get(id);
    const replyEnd=()=>this.post(card.id,card.device,{group:m.group,channel:m.channel,epoch:m.epoch,down:true,op:'end',ticket:m.ticket});
    if(!access||access.owner!==owner.id||access.device!==owner.device||access.epoch!==m.epoch){if(m.op==='join')replyEnd();return;}
    if(m.op==='join'){
      if(!room){
        if(this.rooms.size>=32){replyEnd();return;}
        room={group:m.group,channel:m.channel,epoch:m.epoch,session:randomUUID(),seats:[]};this.rooms.set(id,room);
      }
      const prior=room.seats.find(s=>s.device===card.device&&s.person===card.id);
      if(prior?.ticket===m.ticket)return;
      const occupied=[...this.rooms.values()].flatMap(r=>r.seats.filter(s=>s.device===card.device&&s.person===card.id));
      // Allow a short reservation while this same authenticated device still
      // owns its previous seat. Neither its ticket nor any media is forwarded.
      const replacing=occupied.length===1&&occupied[0].ticket===m.replace;
      if(prior||room.seats.length>=LIMITS.participants||occupied.length&&!replacing){replyEnd();if(!room.seats.length)this.rooms.delete(id);return;}
      let slot=0;while(room.seats.some(s=>s.peer.slot===slot))slot++;
      room.seats.push({person:card.id,device:card.device,publicSeat:randomUUID(),ticket:m.ticket,seen:Date.now(),replaces:replacing?{seat:occupied[0],until:Date.now()+15000}:null,rate:new TokenBucket(75,145),chat:new TokenBucket(2,5),
        peer:{id:slot===0?'host':randomBytes(12).toString('base64url'),slot,name:validateName(access.name),micMuted:true,sharing:false,shareTitle:''}});
      this.roster(room);return;
    }
    const s=room?.seats.find(s=>s.ticket===m.ticket&&s.person===card.id&&s.device===card.device);
    if(!s)return;
    if(m.op==='leave'){this.remove(room,s,false);return;}
    if(m.session!==room.session||!s.rate.take())return;
    if(s.replaces && this.replacing(s) && m.op!=='proof'&&m.op!=='ping')return;
    s.seen=Date.now();
    if(m.op==='proof' && !s.proof && verify(card.id,witness(room,s.peer.id),m.proof)){
      s.proof=m.proof;this.identities(room);
    }else if(m.op==='signal'){
      const target=room.seats.find(seat=>seat.peer.id===m.to);
      if(target&&s!==target&&(s.peer.slot===0||target.peer.slot===0))
        this.deliver(room,target,'signal',{from:s.peer.id,data:validateSignal(m.data)});
    }else if(m.op==='presence'){
      const presence=validatePresence(m.presence);
      if(Object.keys(presence).some(k=>s.peer[k]!==presence[k])){Object.assign(s.peer,presence);this.roster(room);}
    }else if(m.op==='chat' && s.chat.take()){
      const text=validateChat(m.text),entry={id:randomUUID(),from:s.peer.id,name:s.peer.name,text,at:Date.now()};
      for(const seat of room.seats)this.deliver(room,seat,'chat',{entry});
    }else if(m.op==='ping')this.deliver(room,s,'pong');
  }
  down(card,m){
    const s=[this.local,this.preparing].find(item=>item?.ticket===m.ticket);
    if(!s||card.id!==s.owner||card.device!==s.device||m.group!==s.group||m.channel!==s.channel||m.epoch!==s.epoch)return;
    if(m.op==='end'){this.finish(s);return;}
    if(!uuid(m.session))return;
    if(m.op==='roster'){
      const peers=validateRoster(m.peers),self=peers.find(p=>p.id===m.selfId);
      if(!self)return;
      const changed=s.session && s.session!==m.session;
      if(changed && m.reason!=='elect')return;
      const first=!s.info;s.session=m.session;s.seen=Date.now();
      s.info={role:self.slot===0?'host':'guest',selfId:self.id,hostId:'host',peers,groupVoice:{group:s.group,channel:s.channel},
        groupChannelName:s.name,mixRoom:roomTag(key(s.group,s.channel)+'/'+s.session),udpMin:0,udpMax:0,usePeerIce:true};
      if(first||changed){
        s.contacts={};this.send(s,'proof',{proof:sign(this.service.profile.root,witness(s,self.id))});
      }
      if(first){s.resolve(this.handle(s));}
      else if(changed){this.emit(s,{type:'network-reconnecting'});this.emit(s,{type:'network-rejoined',info:s.info});}
      else this.emit(s,{type:'roster',peers});
    }else if(s.info && m.session===s.session){
      s.seen=Date.now();
      if(m.op==='members' && Array.isArray(m.members)&&m.members.length<=LIMITS.participants){
        const next={};
        for(const row of m.members){
          if(!Array.isArray(row)||row.length!==3)continue;
          const [peer,person,proof]=row;
          if(!s.info.peers.some(p=>p.id===peer)||!verify(person,witness(s,peer),proof))continue;
          next[peer]=person;
        }
        if(JSON.stringify(next)!==JSON.stringify(s.contacts)){s.contacts=next;this.service.update();}
      }
      if(m.op==='signal' && s.info.peers.some(p=>p.id===m.from))this.emit(s,{type:'signal',from:m.from,data:validateSignal(m.data)});
      if(m.op==='chat' && m.entry && uuid(m.entry.id)){
        const peer=s.info.peers.find(p=>p.id===m.entry.from);
        if(peer)this.emit(s,{type:'chat',id:m.entry.id,from:peer.id,name:peer.name,text:validateChat(m.entry.text),time:Date.now()});
      }
    }
  }
  emit(s,event){
    if(s.receive)s.receive(event);
    else if(s.events.length<128&&(s.bytes+=Buffer.byteLength(JSON.stringify(event)))<=1024*1024)s.events.push(event);
    else this.finish(s,true);
  }
  send(s,op,body={}){
    return this.post(s.owner,s.device,{group:s.group,channel:s.channel,epoch:s.epoch,ticket:s.ticket,session:s.session,op,...body});
  }
  finish(s,announce=false){
    if(this.local!==s&&this.preparing!==s)return;
    if(announce)this.send(s,'leave');
    if(this.local===s)this.local=null;else this.preparing=null;
    clearTimeout(s.timer);s.events=[];s.bytes=0;
    if(!s.info)s.reject(unavailable());
    else if(s.receive)s.receive({type:'closed',reason:tr('Голосовой канал недоступен.')});
  }
  join(group,channel,prepare=false){
    const access=uuid(group)&&uuid(channel)&&this.access(group,channel,this.self()?.id);
    if(this.preparing||this.local&&!prepare||!access||!this.connected(access.owner,access.device))throw unavailable();
    return new Promise((resolve,reject)=>{
      const old=this.local,s={group,channel,owner:access.owner,device:access.device,epoch:access.epoch,name:access.channelName||'',ticket:randomUUID(),events:[],bytes:0,seen:Date.now(),resolve,reject};
      if(prepare)this.preparing=s;else this.local=s;
      s.timer=setTimeout(()=>{if(!s.info||this.preparing===s)this.finish(s,true);},12000);s.timer.unref();
      const replace=prepare&&old&&old.owner===s.owner&&old.device===s.device?old.ticket:undefined;
      if(!this.send(s,'join',{replace}))this.finish(s);
    });
  }
  handle(s){
    const send=(op,body)=>{if(this.local!==s||!this.send(s,op,body))throw unavailable();};
    const room={getInfo:()=>structuredClone(s.info),usable:()=>!!s.info&&(this.local===s||this.preparing===s),
      bind:fn=>{
        if(this.preparing===s&&!this.local){this.preparing=null;this.local=s;}
        if(this.local!==s)throw unavailable();
        clearTimeout(s.timer);s.receive=fn;for(const e of s.events)fn(e);s.events=[];s.bytes=0;return room;
      },
      setPresence:presence=>send('presence',{presence:validatePresence(presence)}),
      sendChat:text=>send('chat',{text:validateChat(text)}),sendSignal:(to,data)=>send('signal',{to,data:validateSignal(data)}),
      close:()=>{s.receive=null;this.finish(s,true);}};
    return room;
  }
  replacing(s){
    if([...this.rooms.values()].some(r=>r.seats.includes(s.replaces.seat)))return true;
    s.replaces=null;return false;
  }
  reconcile(){
    const now=Date.now();
    for(const [id,p] of this.parts)if(p.until<now)this.parts.delete(id);
    for(const s of [this.local,this.preparing].filter(Boolean)){
      const access=this.access(s.group,s.channel,this.self()?.id);
      if(!access||access.epoch!==s.epoch||access.owner!==s.owner||access.device!==s.device||!this.connected(s.owner,s.device)||now-s.seen>35000)this.finish(s,true);
      else if(s.info && now-(s.ping||0)>8000){s.ping=now;this.send(s,'ping');}
    }
    for(const room of [...this.rooms.values()])for(const seat of [...room.seats]){
      const access=this.access(room.group,room.channel,seat.person);
      if(!access||access.epoch!==room.epoch||access.owner!==this.self()?.id||access.device!==this.self()?.device||!this.connected(seat.person,seat.device)||now-seat.seen>35000||
        seat.replaces&&this.replacing(seat)&&now>seat.replaces.until)this.remove(room,seat);
    }
  }
  close(){
    if(this.preparing)this.finish(this.preparing,true);
    if(this.local)this.finish(this.local,true);
    for(const room of this.rooms.values())for(const seat of room.seats)this.deliver(room,seat,'end');
    this.rooms.clear();this.parts.clear();
  }
}
module.exports={GroupVoice};
