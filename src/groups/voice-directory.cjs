'use strict';
const M=require('./model.cjs');
const {LIMITS}=require('../core/protocol.cjs');

// This roster is transient. Each viewer receives only accessible channels.
// The member index refers to the authenticated group revision. The seat ID is
// public and independent of signalling tickets, device keys and network addresses.
function pack(group,viewer,voice){
  const channels={};
  const members=new Map(group.members.map((person,i)=>[person.id,i]));
  for(const room of voice.rooms.values()){
    if(room.group!==group.id||room.epoch!==group.epoch||!M.access(group,room.channel,viewer,'voice'))continue;
    const seats=[];
    for(const s of room.seats){
      if(!members.has(s.person)||s.replaces&&voice.replacing(s)||!M.access(group,room.channel,s.person,'voice'))continue;
      seats.push([members.get(s.person),s.publicSeat,Number(s.peer.micMuted)+2*Number(s.peer.sharing)]);
    }
    if(seats.length)channels[room.channel]=seats;
  }
  return channels;
}

function unpack(group,viewer,channels){
  if(!channels||typeof channels!=='object'||Array.isArray(channels)||Object.keys(channels).length>group.channels.length)return null;
  const result={},seen=new Set();
  for(const [id,seats] of Object.entries(channels)){
    if(!M.uuid(id)||!M.access(group,id,viewer,'voice')||!Array.isArray(seats)||seats.length>LIMITS.participants)return null;
    result[id]=[];
    for(const row of seats){
      if(!Array.isArray(row)||row.length!==3)return null;
      const [index,seat,flags]=row;
      if(!Number.isInteger(index)||index<0||index>=group.members.length||!M.uuid(seat)||seen.has(seat)||
        !Number.isInteger(flags)||flags<0||flags>3)return null;
      seen.add(seat);
      const {id:person,name}=group.members[index];
      result[id].push({id:person,name,seat,micMuted:!!(flags&1),sharing:!!(flags&2)});
    }
  }
  return result;
}

class VoiceDirectory{
  constructor(groups){this.groups=groups;this.pending=new Set();this.remote=new Map();}
  schedule(id){
    this.pending.add(id);
    if(this.timer)return;
    this.timer=setTimeout(()=>{
      this.timer=null;const ids=[...this.pending];this.pending.clear();
      for(const key of ids){
        const r=this.groups.records.get(key);
        if(!this.groups.mine(r))continue;
        for(const member of r.group.members){
          for(const link of this.groups.s.linksTo(member.id))this.send(r,link);
        }
      }
      this.groups.s.update();
    },200);
    this.timer.unref();
  }
  send(r,link){
    if(!this.groups.fileAllowed(link)||!M.member(r.group,link.card.id))return;
    const channels=r.move?{}:pack(r.group,link.card.id,this.groups.s.voiceChannels);
    this.groups.send(link,'voice-directory',{id:r.id,epoch:r.epoch,revision:r.group.revision,channels});
  }
  accept(r,link,packet){
    if(!r?.view||r.invite||r.move||packet.epoch!==r.epoch||r.view.revision!==packet.revision||
      link.card.id!==r.owner||link.card.device!==r.device)return;
    const channels=unpack(r.view,this.groups.s.me.id,packet.channels);
    if(!channels)return;
    this.remote.set(r.id,{channels,link,epoch:r.epoch,revision:packet.revision});this.groups.s.update();
  }
  read(r){
    if(r.move)return {};
    if(this.groups.mine(r)){
      const me=this.groups.s.me.id;
      return unpack(r.group,me,pack(r.group,me,this.groups.s.voiceChannels));
    }
    const cached=this.remote.get(r.id);
    if(cached?.epoch===r.epoch&&cached.revision===r.view?.revision&&cached.link.card.id===r.owner&&
      cached.link.card.device===r.device&&this.groups.fileAllowed(cached.link))return cached.channels;
    return undefined;
  }
  lost(link){for(const [id,v] of this.remote)if(v.link===link)this.remote.delete(id);}
  close(){clearTimeout(this.timer);this.timer=null;this.pending.clear();this.remote.clear();}
}
module.exports={VoiceDirectory,pack,unpack};
