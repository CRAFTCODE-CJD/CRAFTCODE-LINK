'use strict';
// The two external game processes use separate discovery ports. Only LINK
// bridges them. All four fixture addresses belong to the loopback interface.
const dgram=require('node:dgram');
const fs=require('node:fs/promises');
const {once}=require('node:events');
const {setTimeout:delay}=require('node:timers/promises');
const assert=require('node:assert/strict');
const {discoveryMessage}=require('../src/game/discovery.cjs');

module.exports=async function({services,room,datagram}){
  const ready=process.env.LINK_QA_DISCOVERY_READY, sockets=[];
  const host=services[1].gameNet,client=services[16].gameNet, prefix='127.126.52';
  const gamePort=28844, bridge='127.0.0.22', hostIP='127.0.0.20', clientIP='127.0.0.21';
  const packets={queries:0,replies:0,toHost:0,toClient:0};
  let deliveredEndpoint;
  async function udp(address,port){
    const socket=dgram.createSocket('udp4');
    const listen=once(socket,'listening');
    socket.bind(port,address);await listen;sockets.push(socket);return socket;
  }
  try{
    // Emulate the two virtual NICs on a local prefix the test OS can bind.
    for(const s of services)if(s.game.active)s.game.active.prefix=prefix;
    const hd=await udp(bridge,36141),cd=await udp(bridge,36142);
    const game=await udp(prefix+'.2',gamePort),outside=await udp(bridge,0);
    let guestPort=0;
    cd.on('message',(data,sender)=>{
      if(sender.address!==clientIP||sender.port!==36142)return;
      packets.queries++;client.route(17,datagram(room,17,255,14001,14001,data),true);
    });
    hd.on('message',(data,sender)=>{
      if(sender.address!==hostIP||sender.port!==36141)return;
      packets.replies++;host.route(2,datagram(room,2,255,14001,14001,data),true);
    });
    game.on('message',(data,sender)=>{
      if(sender.address!==clientIP||(guestPort&&sender.port!==guestPort))return;
      guestPort=sender.port;
      client.route(17,datagram(room,17,2,44117,gamePort,data),true);
    });
    outside.on('message',(data,sender)=>{
      if(sender.address===hostIP&&sender.port===gamePort)
        host.route(2,datagram(room,2,17,gamePort,44117,data),true);
    });
    host.adapter={close(){},write(frame){
      const port=frame.readUInt16BE(22);
      if(port===14001)hd.send(frame.subarray(28),36141,hostIP);
      if(port===gamePort){packets.toHost++;outside.send(frame.subarray(28),gamePort,hostIP);}
    }};
    client.adapter={close(){},write(frame){
      const port=frame.readUInt16BE(22);
      if(port===14001){
        const reply=discoveryMessage(frame.subarray(28),{sport:frame.readUInt16BE(20),dport:port});
        if(reply?.session?.addressOffset!==undefined){
          const start=28+reply.session.addressOffset;
          deliveredEndpoint=[...frame.subarray(start,start+4)].join('.');
        }
        cd.send(frame.subarray(28),36142,clientIP);
      }
      if(port===44117&&guestPort){packets.toClient++;game.send(frame.subarray(28),guestPort,clientIP);}
    }};
    assert.equal(host.ports.allows('UDP',gamePort),false);
    await fs.writeFile(ready,'ready',{flag:'wx'});
    const end=Date.now()+8*60000;
    while(Date.now()<end){
      if(await fs.stat(ready+'.done').then(()=>true,()=>false))break;
      await delay(300);
    }
    const status=client.status().traffic;
    console.log(JSON.stringify({packets,deliveredEndpoint,clientEndpoint:{address:clientIP,port:guestPort},virtualDestination:game.address(),
      gameListener:{address:hostIP,port:gamePort},guest:status,host:host.status().traffic}));
    assert(packets.queries>0&&packets.replies>0&&status.matchedRx>0);
    assert.equal(status.lastMatch?.port,gamePort);
    assert.equal(deliveredEndpoint,prefix+'.2','the game must receive the normalized endpoint, including when the relay already corrected it');
    assert(packets.toHost>0&&packets.toClient>0);
  }finally{host.adapter=client.adapter=null;for(const socket of sockets)socket.close();}
};
