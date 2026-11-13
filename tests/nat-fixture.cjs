// Two user-space IPv4 port mappings on loopback. Each external socket translates packets
// from the other client's private port into packets from that client's mapped port.
const dgram=require('node:dgram');
const bind=socket=>new Promise((resolve,reject)=>{socket.once('error',reject);socket.bind(0,'127.0.0.1',()=>{socket.off('error',reject);resolve(socket.address().port);});});
async function localNat(){
  const stun=dgram.createSocket('udp4'),port=await bind(stun);
  const mappings=new Map(),sockets=new Set([stun]);
  let forwarded=0,bindings=0,closed=false,profile=null,dropped=0;
  const queues=new Map(),timers=new Set();
  let burstStart=0;
  function forward(socket,payload,port){
    const send=()=>{if(!closed){socket.send(payload,port,'127.0.0.1');forwarded++;}};
    if(!profile){send();return;}
    if(profile.offline){dropped++;return;}
    const now=performance.now();
    if(profile.holdMs){
      const phase=(now-burstStart)%profile.periodMs;
      const wait=phase<profile.holdMs?profile.holdMs-phase:0;
      if(!wait){send();return;}
      const timer=setTimeout(()=>{timers.delete(timer);send();},wait);
      timers.add(timer);return;
    }
    if(profile.latencyMs && !profile.mbps){
      const timer=setTimeout(()=>{timers.delete(timer);send();},profile.latencyMs);
      timers.add(timer);return;
    }
    const q=queues.get(port) || {next:now,sequence:0};
    queues.set(port,q);q.sequence++;
    if(q.sequence%97===0 || q.next-now>110){dropped++;return;}
    q.next=Math.max(q.next,now)+payload.length*8/1000/profile.mbps;
    let arrival=q.next+(profile.latencyMs ?? 12)+(q.sequence%7)*3;
    if(profile.ordered){
      // Last-mile jitter can vary while packets in a single FIFO still arrive in order.
      arrival=Math.max(arrival,q.arrival || 0);
      q.arrival=arrival;
    }
    const delay=arrival-now;
    const timer=setTimeout(()=>{timers.delete(timer);send();},delay);
    timers.add(timer);
  }
  async function mapping(privatePort){
    if(!mappings.has(privatePort)){
      const external=dgram.createSocket('udp4');sockets.add(external);
      const ready=bind(external).then(publicPort=>{
        external.on('message',async(payload,from)=>{
          if(closed || !mappings.has(from.port))return;
          const source=await mappings.get(from.port);
          if(!closed)forward(source.external,payload,privatePort);
        });
        return {external,publicPort};
      });
      mappings.set(privatePort,ready);
    }
    return mappings.get(privatePort);
  }
  stun.on('message',async(request,from)=>{
    if(request.length<20 || request.readUInt16BE(0)!==1 || request.readUInt32BE(4)!==0x2112a442)return;
    const {publicPort}=await mapping(from.port);
    const reply=Buffer.alloc(32);reply.writeUInt16BE(0x101);reply.writeUInt16BE(12,2);
    request.copy(reply,4,4,20);reply.writeUInt16BE(0x20,20);reply.writeUInt16BE(8,22);
    reply[25]=1;reply.writeUInt16BE(publicPort^0x2112,26);reply.writeUInt32BE((0x7f000001^0x2112a442)>>>0,28);
    if(!closed){stun.send(reply,from.port,from.address);bindings++;}
  });
  return {port,shape(value){profile=value;burstStart=performance.now();queues.clear();},stats:()=>({bindings,mappings:mappings.size,forwarded,dropped}),close(){closed=true;for(const timer of timers)clearTimeout(timer);for(const socket of sockets)socket.close();}};
}
module.exports={localNat};
