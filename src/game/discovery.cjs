'use strict';

const {allowedPort}=require('./ports.cjs');
const rakMagic=Buffer.from('00ffff00fefefefefdfdfdfd12345678','hex');
const bedrockPorts=new Set([19132,19133]);

// Epic's NboSerializerNull writes a string session ID before the IP.
// NboSerializerSteam writes a 64-bit session ID after the IP.
function epicSession(data,start,steam){
  let offset=start;
  function skipString(){
    if(offset+4>data.length)return false;
    const n=data.readInt32BE(offset);
    if(n<0||n>data.length-offset-4)return false;
    offset+=4+n;return true;
  }
  if(steam)offset+=8;
  else if(!skipString())return;
  if(!skipString()||offset+8>data.length)return;
  offset+=8;
  if(!steam&&!skipString())return;
  if(offset+4>data.length)return;
  const size=data.readUInt32BE(offset);
  if(size!==4&&size!==16)return;
  const addressOffset=offset+4,portOffset=addressOffset+size;
  const settings=portOffset+4+(steam?8:0);
  if(settings+26>data.length||size!==4)return {blocked:true};
  const port=data.readUInt32BE(portOffset);
  // Older MTDS builds set bIsLANMatch false even on the LAN menu.
  if(!allowedPort(port)||data.subarray(settings+8,settings+18).some(v=>v>1))return {blocked:true};
  return {addressOffset,port,build:data.readInt32BE(settings+18)};
}

function discoveryMessage(data,h){
  const version=data[0],header=version===12?32:version===11?16:0;
  if(header&&data[6]===0x53){
    const key='epic/'+data.subarray(0,6).toString('hex')+'/'+data.subarray(8,16).toString('hex');
    if(data[7]===0x51&&data.length===header)return {type:'query',key};
    if(data[7]===0x52)return {type:'answer',key,session:epicSession(data,header,false)??epicSession(data,header,true)??{blocked:true}};
  }
  if(bedrockPorts.has(h.dport)&&[1,2].includes(data[0])&&data.length===33&&data.subarray(9,25).equals(rakMagic))
    return {type:'query',key:'rak/'+data.subarray(1,9).toString('hex'),discoveryPort:true};
  if(bedrockPorts.has(h.sport)&&data[0]===0x1c&&data.length>=35&&data.subarray(17,33).equals(rakMagic)&&data.readUInt16BE(33)===data.length-35){
    const fields=data.subarray(35).toString('utf8').split(';');
    if(fields[0]!=='MCPE'||fields.length<6)return;
    const port=fields[10]?Number(fields[10]):h.sport;
    return {type:'answer',key:'rak/'+data.subarray(1,9).toString('hex'),discoveryPort:true,
      session:allowedPort(port)?{port}:{blocked:true}};
  }
}

class GameDiscovery{
  constructor(){this.queries=new Map();this.listeners=new Map();}
  clear(){this.queries.clear();this.listeners.clear();}
  remember(map,key,value){
    map.delete(key);
    if(map.size>=128)map.delete(map.keys().next().value);
    map.set(key,value);
  }
  listener(client,host,port){
    return allowedPort(port)&&this.listeners.get(client+'/'+host+'/'+port)>Date.now();
  }
  observe(message,h,now=Date.now()){
    if(!message||message.session?.blocked||!allowedPort(h.sport)||!allowedPort(h.dport))return [];
    if(message.type==='query'){
      this.remember(this.queries,h.src+'/'+message.key,{seat:h.src,target:h.dst,sport:h.sport,dport:h.dport,key:message.key,expires:now+15000});
      return [];
    }
    const matches=[];
    for(const q of this.queries.values()){
      if(q.key!==message.key||q.expires<=now||q.seat===h.src||q.dport!==h.sport||
        (q.target!==255&&q.target!==h.src)||(h.dst!==255&&h.dst!==q.seat)||
        (q.sport!==h.dport&&!(h.dst===255&&q.dport===h.dport)))continue;
      matches.push(q);
      if(message.session)this.remember(this.listeners,q.seat+'/'+h.src+'/'+message.session.port,now+90000);
    }
    return matches;
  }
}

function checksum(buffer,initial=0){
  let sum=initial;
  for(let i=0;i<buffer.length;i+=2)sum+=(buffer[i]<<8)|(buffer[i+1]||0);
  while(sum>0xffff)sum=(sum&0xffff)+(sum>>>16);
  return (~sum)&0xffff;
}

// A matching response belongs to this socket. Addressing it directly also
// avoids relying on Windows' limited-broadcast delivery on multihomed PCs.
function localAnswer(frame,query,session){
  const packet=Buffer.from(frame);
  packet.copy(packet,16,12,15);packet[19]=query.seat;
  packet.writeUInt16BE(query.sport,22);
  if(session?.addressOffset!==undefined)packet.copy(packet,28+session.addressOffset,12,16);
  packet.writeUInt16BE(0,10);packet.writeUInt16BE(checksum(packet.subarray(0,20)),10);
  packet.writeUInt16BE(0,26);
  const pseudo=packet.readUInt16BE(12)+packet.readUInt16BE(14)+packet.readUInt16BE(16)+packet.readUInt16BE(18)+17+packet.length-20;
  packet.writeUInt16BE(checksum(packet.subarray(20),pseudo)||0xffff,26);
  return packet;
}
module.exports={discoveryMessage,GameDiscovery,localAnswer};
