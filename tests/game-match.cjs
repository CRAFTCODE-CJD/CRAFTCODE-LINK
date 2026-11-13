'use strict';
// Real Godot processes and product contact framing. In lieu of a Windows driver
// each virtual interface is backed by two loopback UDP sockets in this fixture.
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),net=require('node:net'),dgram=require('node:dgram');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict');
const {seed,publicCard,friend}=require('../src/direct/identity.cjs');
const {DirectService}=require('../src/direct/service.cjs');
const {setTimeout:delay}=require('node:timers/promises');
const services=[],sockets=[],processes=[],tcp=[];let temp,server;
async function until(fn,label,ms=15000){const end=Date.now()+ms;while(!fn()){if(Date.now()>end)throw Error(label);await delay(25);}}
async function udp(port=0){
 const socket=dgram.createSocket('udp4');
 await new Promise((resolve,reject)=>{
   socket.once('error',reject);
   socket.bind(port,'127.0.0.1',()=>{socket.off('error',reject);resolve();});
 });
 sockets.push(socket);
 return socket;
}
async function port(){const s=await udp(),p=s.address().port;await new Promise(r=>s.close(r));sockets.splice(sockets.indexOf(s),1);return p;}
function datagram(r,src,dst,sport,dport,data){
  const b=Buffer.alloc(28+data.length);b[0]=0x45;b.writeUInt16BE(b.length,2);b[8]=64;b[9]=17;
  Buffer.from(r.prefix.split('.').map(Number)).copy(b,12);b.copy(b,16,12,15);b[15]=src;b[19]=dst;
  b.writeUInt16BE(sport,20);b.writeUInt16BE(dport,22);b.writeUInt16BE(b.length-20,24);data.copy(b,28);return b;
}
// Exercise the discovery transport independently of the engine. The payload is a fixture,
// not an emulation of UE session serialization or proof of a Windows engine join.
async function discoveryRoundTrip(room){
 const client=services[16].gameNet, host=services[1].gameNet;
 const gameClient=await udp(),clientNic=await udp(),hostNic=await udp(),gameHost=await udp();
 let delivered=0, observed=[];
 const addr='127.0.0.1';
 clientNic.on('message',payload=>{
   const play=payload[0]===3, ephemeral=payload[0]===2;
   const packet=datagram(room,17,play?2:255,ephemeral||play?49789:14001,play?7777:14001,payload);
   if(payload[0]===1)packet.fill(255,16,20);
   client.route(17,packet,true);
 });
 gameHost.on('message',payload=>gameHost.send(payload,hostNic.address().port,addr));
 hostNic.on('message',payload=>{
   const kind=payload[0], all=kind===1;
   const packet=datagram(room,2,all?255:17,kind===3?7777:14001,all?14001:49789,payload);
   if(all)packet.fill(255,16,20);
   host.route(2,packet,true);
 });
 host.adapter={close(){},write(packet){delivered++;hostNic.send(packet.subarray(28),gameHost.address().port,addr);}};
 client.adapter={close(){},write(packet){clientNic.send(packet.subarray(28),gameClient.address().port,addr);}};
 gameClient.on('message',payload=>observed.push(Buffer.from(payload)));
 try{
   for(const kind of [1,2,3]){
     const payload=Buffer.concat([Buffer.from([kind]),require('node:crypto').randomBytes(12)]);
     gameClient.send(payload,clientNic.address().port,addr);
     await until(()=>observed.length===kind,'discovery or game-port response '+kind,6000);
     assert.deepEqual(observed[kind-1],payload);
   }
   assert.equal(delivered,3);
   for(const network of [client,host]){
     const {tx,rx,blockedTx,blockedRx}=network.status().traffic;
     assert.deepEqual({tx,rx,blockedTx,blockedRx},{tx:3,rx:3,blockedTx:0,blockedRx:0});
   }
   console.log('PASS limited and directed discovery broadcasts on 14001, broadcast and ephemeral-port replies, subsequent UDP 7777 handshake, two guest seats via room host, with matching payloads and counters.');
 }finally{
   client.adapter=null;host.adapter=null;
   for(const sock of [gameClient,clientNic,hostNic,gameHost]){sock.close();sockets.splice(sockets.indexOf(sock),1);}
 }
}
// Optional real IPv4/TCP/UDP stacks in disposable namespaces. On Windows,
// LINK_QA_WSL selects the WSL distribution. The helper refuses a nonempty
// namespace, including the machine's normal network namespace.
async function kernelSockets(room){
 const organizer=services[0].gameNet,host=services[1].gameNet,client=services[16].gameNet;
 const peers=[];let error;
 const untilReady=async(test,label)=>until(()=>{if(error)throw error;return test();},label,25000);
 function open(slot,remote,role,network){
   const script=['python3','-I','tests/game-socket-peer.py',room.prefix+'.'+slot,room.prefix+'.'+remote,role];
   const windows=process.platform==='win32';
   const proc=spawn(windows?'wsl.exe':script[0],windows?['-d',process.env.LINK_QA_WSL,'--cd',path.join(__dirname,'..'),'--',...script]:script.slice(1),
     {cwd:path.join(__dirname,'..'),stdio:['pipe','pipe','pipe'],windowsHide:true});
   const peer={proc,ready:false,closed:new Promise(resolve=>proc.once('close',resolve))};peers.push(peer);
   let stderr='';
   proc.on('error',e=>{error=e;});proc.stdin.on('error',e=>{error=e;});
   proc.stderr.on('data',b=>{stderr=(stderr+b).slice(-2000);});
   proc.on('exit',code=>{if(code)error=Error(role+' kernel endpoint: '+code+' '+stderr);});
   network.adapter={close(){},write(b){if(!proc.stdin.destroyed)proc.stdin.write(b.toString('base64')+'\n');}};
   const lines=require('node:readline').createInterface({input:proc.stdout});
   lines.on('line',line=>{
     try{
       const event=JSON.parse(line);
       if(event.frame)network.route(slot,Buffer.from(event.frame,'base64'),true);
       if(event.ready)peer.ready=true;
       if(event.error)error=Error(role+': '+event.error);
       if(event.verified)peer.result=event;
     }catch(e){error=e;}
   });
   return peer;
 }
 try{
   for(const n of [organizer,host,client])n.setPorts(room.id,'UDP 19132, TCP 25565, UDP 7777-7876');
   const a=open(2,17,'host',host);await untilReady(()=>a.ready,'kernel listener');
   const b=open(17,2,'guest',client);await untilReady(()=>a.result&&b.result,'kernel game traffic');
   const crypto=require('node:crypto'),bytes=crypto.createHash('shake256',{outputLength:65536}).update('CRAFTCODE LINK kernel TCP and UDP').digest();
   const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
   assert.equal(a.result.verified,digest(bytes));assert.equal(b.result.verified,digest(bytes.reverse()));
   assert.equal(a.result.size,65536);assert.equal(b.result.size,65536);
   assert.deepEqual(a.result.udpPorts,[7777,7831,7876]);assert.deepEqual(b.result.udpPorts,a.result.udpPorts);
   console.log('PASS ordinary UDP endpoints across the explicit port range, bidirectional payload checks:',b.result.udpPorts);
   console.log('PASS real kernel UDP broadcast discovery, ephemeral reply and TCP handshake; 65536 bytes verified in each direction through LINK:',a.result.verified,b.result.verified);
 }finally{
   client.adapter=host.adapter=null;
   for(const n of [organizer,host,client])n.setPorts(room.id,'');
   for(const {proc} of peers)proc.stdin.end();
   await Promise.all(peers.map(async({proc,closed})=>{
     const timer=setTimeout(()=>proc.kill(),3000);try{await closed;}finally{clearTimeout(timer);}
   }));
 }
}
async function run(){
 temp=await fs.mkdtemp(path.join(os.tmpdir(),'link-match-'));
 await fs.cp(path.join(__dirname,'game-match'),path.join(temp,'game'),{recursive:true});
 const profiles=Array.from({length:18},(_,i)=>({name:'Player '+i,root:seed(),device:seed(),friends:[],dht:false,lan:''})),cards=profiles.map(publicCard);
 for(let i=0;i<profiles.length;i++){
   const profile=profiles[i];profile.friends=(i?[cards[0]]:cards.slice(1)).map(c=>friend(c,'friend'));
   const s=new DirectService({store:{read:()=>profile,write(){}},nics:()=>[]});s.start();services.push(s);
 }
 const [host]=services;const awaiting=[];
 server=net.createServer(s=>{tcp.push(s);const {card,key}=awaiting.shift();host.attach(s,'lan',key,card.id,card.device);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 for(let i=1;i<services.length;i++){const key=seed();awaiting.push({card:cards[i],key});const s=net.connect(server.address().port,'127.0.0.1');tcp.push(s);services[i].attach(s,'lan',key,cards[0].id,cards[0].device);await until(()=>host.linksTo(cards[i].id).length,'authenticated contact');}
 host.game.create('Match');const room=host.game.active;for(let i=1;i<=16;i++){
   host.game.invite(cards[i].id);await until(()=>services[i].game.invitations.size===1,'invite');
   const guest=services[i].game;
   guest.answer(guest.state().invitations[0].id,true);await until(()=>!guest.active.waiting,'accept');
 }
 assert.throws(()=>host.game.invite(cards[17].id));await until(()=>services[16].game.active.roster.length===17,'seats');
 services[16].game.chat('ready');await until(()=>services.slice(0,17).every(s=>s.game.active.messages.length===1),'chat');
 const players=services.slice(0,17);
 for(const s of players)s.game.adapterReady(true);
 await until(()=>players.every(s=>s.game.active.roster.every(p=>p.ready)),'network opt-in');
 await discoveryRoundTrip(room);
 if(process.env.LINK_QA_DISCOVERY_READY){
   await require('./game-discovery-relay.cjs')({services,room,datagram});
   return;
 }
 if(process.env.LINK_QA_GAME_UDP_PORT){
   await require('./game-loopback-relay.cjs').externalGame({room,client:services[16].gameNet,host:services[1].gameNet,udp,datagram});
   return;
 }
 if(process.env.LINK_QA_UNREAL_EDITOR||process.env.LINK_QA_EIK_GAME){
   await require('./unreal-ip-match.cjs')({room,client:services[16].gameNet,host:services[1].gameNet,udp,port,datagram});
   return;
 }
 if(process.env.LINK_QA_WSL || process.env.LINK_QA_KERNEL_LAN==='1')await kernelSockets(room);
 const gamePort=await port(),serverSeat=2,udpPeers=new Map(),clientPorts=new Map(),logs=new Map();let frames=0;
 function godot(label,args){
   const executable=process.env.LINK_QA_GODOT || 'godot';
   const p=spawn(executable,['--headless','--max-fps','60','--log-file',path.join(temp,`godot-${label}.log`),'--path',path.join(temp,'game'),'--',...args],{
     env:{...process.env,GODOT_SILENCE_ROOT_WARNING:'1',XDG_DATA_HOME:temp,APPDATA:temp},
     windowsHide:true,stdio:['ignore','pipe','pipe']});
   processes.push({child:p,closed:new Promise(resolve=>p.once('close',resolve))});
   logs.set(label,'');for(const out of [p.stdout,p.stderr])out.on('data',b=>logs.set(label,(logs.get(label)+b).slice(-8000)));
   p.on('error',e=>logs.set(label,e.message));
 }
 godot('server',['host',String(gamePort)]);await until(()=>logs.get('server').includes('HOST_READY'),'Godot server');
 for(let slot=1;slot<=17;slot++){
   const network=services[slot-1].gameNet;
   if(slot===serverSeat)continue;
   const cli=await udp(),srv=await udp(),local=await port();clientPorts.set(slot,{cli,local});udpPeers.set(slot,srv);
   const sport=44000+slot;
   cli.on('message',(b,r)=>{if(r.port===local)network.route(slot,datagram(room,slot,serverSeat,sport,7000,b),true);});
   srv.on('message',(b,r)=>{if(r.port===gamePort)services[1].gameNet.route(2,datagram(room,2,slot,7000,sport,b),true);});
   network.adapter={close(){},write(b){frames++;cli.send(b.subarray(28),local,'127.0.0.1');}};
 }
 services[1].gameNet.adapter={close(){},write(b){frames++;udpPeers.get(b[15])?.send(b.subarray(28),gamePort,'127.0.0.1');}};
 for(const [slot,{cli,local}] of clientPorts)godot(slot,['client',String(cli.address().port),String(local)]);
 try{await until(()=>[...clientPorts.keys()].every(slot=>logs.get(slot).includes('MATCH_OK')),'16 ENet clients',45000);}catch(e){console.error(Object.fromEntries(logs));throw e;}
 assert(logs.get('server').includes('ALL_PLAYERS'));assert(frames>960);
 console.log('PASS 17 admitted LINK participants, 18th refused, chat at every seat. Godot game server at invited seat 2, 16 real ENet clients, 30 ordered RPCs each, final scoreboard verified by all; UDP frames delivered:',frames);
 host.game.leave();await until(()=>services.every(s=>!s.game.active),'end all memberships');
}
(async()=>{try{await run();}catch(e){console.error(e);process.exitCode=1;}finally{
 for(const {child} of processes)if(child.exitCode===null)child.kill();
 await Promise.all(processes.map(p=>p.closed));
 for(const s of sockets)s.close();await Promise.allSettled(services.map(s=>s.stop()));
 for(const s of tcp)s.destroy();server?.close();if(temp)await fs.rm(temp,{recursive:true,force:true});
}})();
