'use strict';
const {tr}=require('../native-language.cjs');
const {shareCard,parseCard,sign,verify,hex32}=require('./identity.cjs');
const {roomTag}=require('./avatars.cjs');

const peerId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{16}$/.test(value);
const fields=(room,peer,card)=>['LINK room person v1',room,peer,card];
function readPerson(value,room){
  if(!value||!peerId(value.peer)||typeof value.card!=='string'||value.card.length>1500)return null;
  try{
    const person=parseCard(value.card);
    if(!verify(person.id,fields(room,value.peer,value.card),value.proof))return null;
    return {peer:value.peer,card:value.card,proof:value.proof,person};
  }catch{return null;}
}

// A room host introduces only identities authenticated on its contact transport.
// Each introduction also needs the participant's own signature for this room
// and ephemeral peer ID. It grants no friendship, chat, file or call permission.
class RoomPeople {
  constructor(service){this.service=service;}
  context(){
    const s=this.service,guest=s.guestAppearance;
    if(s.paused||s.strict||!s.me||!guest)return null;
    const room=s.roomInfo();
    if(room?.role!=='guest'||!hex32(guest.room)||
      s.contact(guest.person)?.state!=='friend'||s.blocked(guest.person))return null;
    const links=s.linksTo(guest.person).filter(l=>l.roomPeople&&l.card.device===guest.device);
    return {room,guest,links};
  }
  announce(){
    const s=this.service,context=this.context();
    if(context){
      const {room,guest,links}=context;
      if(peerId(room.selfId)&&links.length){
        const offer=!s.hidden&&s.profile.privacy?.friendRequests!==false;
        const key=offer?JSON.stringify([guest.room,room.selfId,s.me.id,s.me.device,s.profile.name]):null;
        const pending=links.filter(link=>(link.sentRoomPerson??null)!==key);
        if(pending.length){
          const packet={kind:'room-person',room:guest.room,peer:room.selfId,card:null};
          if(offer){
            packet.card=shareCard(s.profile);
            packet.proof=sign(s.profile.root,fields(guest.room,room.selfId,packet.card));
          }
          for(const link of pending)if(link.send(packet))link.sentRoomPerson=key;
        }
      }
    }
    const room=s.publishRoom&&s.roomInfo();
    if(s.paused||s.strict||room?.role!=='host'||!room.invite)return;
    const scope=roomTag(room.invite),peers=new Set(room.peers.map(p=>p.id));
    const tunnels=[...s.tunnels.values()].filter(t=>t.invite===room.invite&&peers.has(t.peer)&&
      s.contact(t.person)?.state==='friend'&&!s.blocked(t.person));
    for(const l of s.links){
      if(!l.roomPeople||l.socket.destroyed||s.contact(l.card.id)?.state!=='friend'||s.blocked(l.card.id))continue;
      if(!tunnels.some(t=>t.device===l.card.device&&t.person===l.card.id))continue;
      const members=tunnels.filter(t=>t.personCard&&t.person!==l.card.id).map(t=>{
        const {peer,card,proof}=t.personCard;return {peer,card,proof};
      });
      const packet={kind:'room-people',room:scope,members},key=JSON.stringify(packet),now=Date.now();
      if(l.sentRoomPeople===key&&now-(l.sentRoomPeopleAt||0)<20000)continue;
      if(l.send(packet)){l.sentRoomPeople=key;l.sentRoomPeopleAt=now;}
    }
  }
  receive(link,packet){
    const s=this.service;
    if(!link.roomPeople)return;
    if(packet.kind==='room-person'){
      const room=s.publishRoom&&s.roomInfo();
      if(room?.role!=='host'||!room.invite||packet.room!==roomTag(room.invite))return;
      const tunnel=[...s.tunnels.values()].find(t=>t.invite===room.invite&&t.peer===packet.peer&&
        t.person===link.card.id&&t.device===link.card.device&&room.peers.some(p=>p.id===t.peer));
      if(!tunnel)return;
      if(packet.card===null){
        if(tunnel.personCard){delete tunnel.personCard;this.announce();s.update();}
        return;
      }
      const member=readPerson(packet,packet.room);
      if(!member||member.person.id!==link.card.id||member.person.device!==link.card.device)return;
      if(tunnel.personCard?.card===member.card&&tunnel.personCard.proof===member.proof)return;
      tunnel.personCard=member;
      // The first roster may arrive alongside the TLS welcome before the guest
      // has installed its room scope. Its signed introduction acknowledges that
      // scope, so send the current roster again even when other seats are stable.
      link.sentRoomPeople=null;this.announce();s.update();return;
    }
    const context=this.context();
    if(!context||!context.links.includes(link)||packet.room!==context.guest.room||
      !Array.isArray(packet.members)||packet.members.length>7)return;
    const members=packet.members.map(m=>readPerson(m,packet.room));
    if(members.some(m=>!m)||new Set(members.map(m=>m.peer)).size!==members.length)return;
    link.roomPeopleRoster={room:packet.room,members,until:Date.now()+50000};s.update();
  }
  members(){
    const context=this.context();if(!context)return [];
    const {room,guest,links}=context,peers=new Set(room.peers.map(p=>p.id));
    const roster=links.map(l=>l.roomPeopleRoster).filter(r=>r?.room===guest.room&&r.until>Date.now())
      .sort((a,b)=>b.until-a.until)[0];
    return (roster?.members||[]).filter(m=>m.peer!==room.selfId&&m.person.id!==this.service.me.id&&peers.has(m.peer));
  }
  snapshot(){
    const context=this.context();if(!context)return {};
    return Object.fromEntries(this.members().map(m=>[m.peer,{id:m.person.id,name:m.person.name,
      room:context.guest.room,peer:m.peer}]));
  }
  add({owner,room,peer,person}){
    const s=this.service,context=this.context();
    if(!context||owner!==s.me.id||room!==context.guest.room||!hex32(person)||!peerId(peer))
      throw Error(tr('Участник комнаты недоступен.'));
    const member=this.members().find(m=>m.peer===peer&&m.person.id===person);
    if(!member)throw Error(tr('Участник комнаты недоступен.'));
    return s.add(member.card,person);
  }
}
module.exports={RoomPeople,readPerson,fields};
