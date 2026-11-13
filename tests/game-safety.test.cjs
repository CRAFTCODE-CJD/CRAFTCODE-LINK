'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),os=require('node:os'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {GameNetwork}=require('../src/game/network.cjs'),{GameRoom}=require('../src/game/room.cjs');
const {ShelfStorage,safe,BLOCK}=require('../src/files/storage.cjs');
const {DirectService}=require('../src/direct/service.cjs'),{seed,publicCard,friend}=require('../src/direct/identity.cjs');
const members=['A','B','C'].map((name,i)=>({id:String(i+1).repeat(64),device:String(i+4).repeat(64),name,slot:i+1,ready:true}));
function frame({src=2,dst=1,sport=49000,dport=7000}={}){
 const b=Buffer.alloc(32);b[0]=0x45;b[9]=17;b.writeUInt16BE(b.length,2);b.set([10,90,2,src,10,90,2,dst],12);b.writeUInt16BE(sport,20);b.writeUInt16BE(dport,22);b.writeUInt16BE(b.length-20,24);return b;
}
test('game diagnostics distinguish a broadcast session query from a game response and discard unrelated bytes',()=>{
 const room={active:{id:crypto.randomUUID(),host:true,roster:members,prefix:'10.90.2'},self:()=>members[0],link:()=>null,adapterReady(){}};
 const network=new GameNetwork(room,()=>{});network.adapter={write(){},close(){}};
 function announce(src,version,type,size,port=14001){
   const data=Buffer.alloc(28+size);frame({src,dst:255,sport:port,dport:port}).copy(data,0,0,28);
   data.writeUInt16BE(data.length,2);data.writeUInt16BE(8+size,24);data[28]=version;data[29]=1;
   if(type==='SR'&&size>(version===11?16:32)){
     // Empty owner/name/session strings, four-byte IPv4 address and valid game endpoint.
     const addressSize=28+(version===11?16:32)+20;
     data.writeUInt32BE(4,addressSize);data.writeUInt32BE(7777,addressSize+8);
   }
   data.write(type,34,'ascii');network.route(src,data,src===1);
 }
 try{
   announce(1,11,'SQ',16);announce(2,11,'SR',74);
   announce(2,12,'SQ',32);announce(1,12,'SR',92);
   announce(1,12,'SQ',16);announce(2,12,'SR',32);announce(1,13,'SQ',32);announce(2,12,'SQ',32,445);
   const {queriesTx,queriesRx,answersTx,answersRx}=network.status().traffic;
   assert.deepEqual([queriesTx,queriesRx,answersTx,answersRx],[1,1,1,1]);
 }finally{network.stop();}
});
test('only admitted seats may inject approved room-local game UDP; return traffic requires a prior flow',()=>{
 const room={active:{id:crypto.randomUUID(),host:true,roster:members,prefix:'10.90.2'},self:()=>members[0],link:()=>null};
 const n=new GameNetwork(room,()=>{}),delivered=[];n.adapter={write:p=>delivered.push(p),close(){}};
 const send=(card,buf,id=room.active.id)=>n.receive(card,{room:id,frames:[buf.toString('base64')]});
 const good=frame();send(members[1],good);assert.equal(delivered.length,1);
 send({...members[1],device:members[2].device},good);send(members[2],good);send(members[1],good,'old');
 for(const [at,v] of [[0,0x46],[6,0x20],[9,6],[12,192],[16,192],[19,44],[25,1]]){const b=Buffer.from(good);b[at]=v;send(members[1],b);}
 send(members[1],frame({dport:445}));send(members[1],frame({sport:7000,dport:44444}));assert.equal(delivered.length,1);
 n.route(1,frame({src:1,dst:2,sport:44444,dport:7000}),true);send(members[1],frame({sport:7000,dport:44444}));assert.equal(delivered.length,2);n.stop();
});
test('overlapping adapter ranges detected including VPN /8',()=>{
 const {overlaps,interfaceRanges}=require('../src/game/subnet.cjs');
 const nic=mask=>interfaceRanges({n:[{family:'IPv4',address:'10.90.2.50',netmask:mask}]});
 assert(overlaps('10.90.2',nic('255.255.255.0')));assert(overlaps('10.90.88',nic('255.0.0.0')));assert(!overlaps('10.90.88',nic('255.255.255.0')));
});
test('Generals lobby broadcasts and fixed-port match traffic cross the LAN between admitted peers',async t=>{
 const id=crypto.randomUUID(),peers=members.slice(0,2),received=[[],[]];
 const networks=peers.map((me,i)=>new GameNetwork({
   active:{id,host:i===0,roster:peers,prefix:'10.90.2'},self:()=>me,
   link:()=>({socket:{writableLength:0},send:packet=>{networks[1-i].receive(me,packet);return true;}})
 },()=>{}));
 networks.forEach((network,i)=>{network.adapter={write:b=>{received[i].push(Buffer.from(b));return true;},close(){}};});
 t.after(()=>networks.forEach(n=>n.stop()));
 const lobby=frame({src:1,dst:255,sport:8086,dport:8086});lobby.fill(255,16,20);
 const match=frame({src:2,dst:1,sport:8088,dport:8088}),reply=frame({src:1,dst:2,sport:8088,dport:8088});
 match.writeUInt32BE(0x12345678,28);reply.writeUInt32BE(0x7265706c,28);
 for(const [i,b] of [[0,lobby],[1,match],[0,reply],[1,frame({src:2,dst:255,sport:8088,dport:8088})],[1,frame({src:2,dst:1,sport:49123,dport:8088})]])
   networks[i].route(i+1,b,true);
 await new Promise(resolve=>setTimeout(resolve,35));
 assert.deepEqual(received,[[match],[lobby,reply]]);
 assert.equal(networks[1].status().traffic.blockedTx,2);
});
test('explicit per-room ports admit a TCP handshake and exact game bytes, enforce revocation and protect system listeners',t=>{
 const id=crypto.randomUUID(),host=members[0],guest=members[1],delivered=[];
 const room={active:{id,host:true,roster:members,prefix:'10.90.2'},self:()=>host,link:()=>null};
 const n=new GameNetwork(room,()=>{});n.adapter={write:p=>delivered.push(Buffer.from(p)),close(){}};t.after(()=>n.stop());
 function tcp(src,dst,sport,dport,flags,payload=Buffer.alloc(0)){
   const b=Buffer.alloc(40+payload.length);
   frame({src,dst,sport,dport}).copy(b,0,0,24);b.writeUInt16BE(b.length,2);b[9]=6;b[32]=0x50;b[33]=flags;
   payload.copy(b,40);return b;
 }
 const send=b=>n.receive(guest,{room:id,frames:[b.toString('base64')]});
 const syn=tcp(2,1,49000,25565,2),synAck=tcp(1,2,25565,49000,0x12);
 const data=crypto.randomBytes(1100),request=tcp(2,1,49000,25565,0x18,data);
 send(syn);assert.equal(delivered.length,0);assert.equal(n.status().traffic.lastBlockedRx,'TCP 25565');
 for(const ports of ['TCP 445','TCP 3389','UDP 5355','UDP 45879','TCP 65536','TCP 0','0.0.0.0','UDP 7876-7777','TCP 5300-5390','UDP 39000-40000','UDP 7777-7876, TCP 25000-25030'])
   assert.throws(()=>n.setPorts(id,ports));
 assert.throws(()=>n.setPorts('different room','TCP 25565'));
 n.setPorts(id,'udp 19132, tcp 25565, UDP 19132');assert.equal(n.status().ports,'UDP 19132, TCP 25565');
 send(request);send(tcp(2,255,49000,25565,2));assert.equal(delivered.length,0);
 const short=Buffer.from(syn);short[32]=0xf0;send(short);assert.equal(delivered.length,0);
 send(syn);n.route(1,synAck,true);send(request);assert.equal(delivered.length,2);assert.deepEqual(delivered[1].subarray(40),data);
 send(tcp(2,1,49001,25565,0x10));assert.equal(delivered.length,2);
 const search=frame({src:2,dst:255,sport:49000,dport:19132});send(search);assert.equal(delivered.length,3);
 assert.deepEqual([n.status().traffic.tx,n.status().traffic.rx,n.status().traffic.broadcastRx],[1,3,1]);
 n.setPorts(id,'');send(request);send(search);assert.equal(delivered.length,3);
 n.setPorts(id,'udp 7777–7876');assert.equal(n.status().ports,'UDP 7777-7876');
 assert.throws(()=>n.setPorts(id,'UDP 45870-45890'));assert.equal(n.status().ports,'UDP 7777-7876');
 for(const port of [7776,7777,7831,7876,7877])send(frame({src:2,dst:1,sport:49103,dport:port}));
 assert.equal(delivered.length,6);
 assert.deepEqual(delivered.slice(3).map(b=>b.readUInt16BE(22)),[7777,7831,7876]);
 n.setPorts(id,'TCP 25565');room.active.id=crypto.randomUUID();n.reconcile();assert.equal(n.status().ports,'');
});
test('expired or forged LAN invitations do not admit another device or room',()=>{
 const output=[],g=new GameRoom({self:()=>members[0],links:id=>members.filter(p=>p.id===id).map(card=>({card,send:m=>{output.push(m);return true;}})),event:()=>{},quiet:()=>false,changed:()=>{}});
 g.create('LAN');g.invite(members[1].id);const inv=output[0],accept={...inv,action:'accept'};g.receive(members[2],accept);g.receive(members[1],{...accept,ticket:crypto.randomUUID()});assert.equal(g.active.roster.length,1);
 g.sent.get(members[1].id).expires=0;g.receive(members[1],accept);g.tick();assert.equal(g.active.roster.length,1);assert.equal(g.sent.size,0);
});
test('host enforces privacy on the wire even when a confirmed friend knows the current door',async t=>{
 const a={name:'A',root:seed(),device:seed(),friends:[],dht:false,lan:''},b=publicCard({...a,name:'B',root:seed(),device:seed()});a.friends=[friend(b,'friend')];
 const room={role:'host',invite:'test',peers:[{}]},s=new DirectService({store:{read:()=>a},roomInfo:()=>room}),out=[];t.after(()=>s.stop());s.publishRoom=true;
 const link={card:b,send:m=>{out.push(m);return true;},socket:{destroyed:false}};s.links.add(link);s.announceRooms();const door=s.listedRoom.door;
 s.setAudience('selected',[]);assert.equal(out.at(-1).door,'');const ring=()=>({kind:'ring',id:crypto.randomUUID(),door,canJoin:true,expires:Date.now()+10000});
 s.message(link,ring());assert.equal(out.at(-1).kind,'busy');assert(!s.pending);
 s.setAudience('selected',[b.id]);s.message(link,ring());assert(s.pending);s.setAudience('invite',[]);assert(!s.pending);
});
test('files use exclusive publish, original bytes and bounded chunks; reject hash mismatch, symlinks and unsafe names',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shelf-test-')),store=new ShelfStorage(dir);
 t.after(async()=>{await store.close();await fs.rm(dir,{recursive:true,force:true});});
 const file=path.join(dir,'input'),buf=crypto.randomBytes(2*BLOCK+5);await fs.writeFile(file,buf);
 const meta=await store.offer(file);assert.equal(meta.sha,crypto.createHash('sha256').update(buf).digest('hex'));
 async function transfer(m){const id=await store.begin(m,'LAN');let result;for(let p=0;p<buf.length;p+=BLOCK)result=await store.put(id,p,await store.read(meta.id,p));return result.path;}
 const first=await transfer(meta),next=await transfer(meta);assert.notEqual(first,next);assert.deepEqual(await fs.readFile(next),buf);
 await assert.rejects(transfer({...meta,sha:'0'.repeat(64)}));const id=await store.begin(meta,'LAN');await store.put(id,0,await store.read(meta.id,0));await store.cancel(id);
 assert.equal((await fs.readdir(path.dirname(first))).filter(x=>x.endsWith('.part')).length,0);assert(!safe('../A:foo').includes('/'));assert.equal(safe('NUL.exe'),'_NUL.exe');
 if(process.platform!=='win32'){await fs.symlink(dir,path.join(dir,'CRAFTCODE LINK','evil'));await assert.rejects(store.begin(meta,'evil'));}
 await fs.appendFile(file,'x');await assert.rejects(store.read(meta.id,0));
});

test('the Unreal game address is local to the current ready seat',()=>{
 const {gameAddress}=require('../src/game/unreal-launch.cjs');
 const s={game:{active:{id:'room',prefix:'10.44.90'}},gameNet:{phase:'off',mine:()=>({slot:2})}};
 assert.equal(gameAddress(s),null);s.gameNet.phase='ready';
 assert.deepEqual(gameAddress(s),{room:'room',address:'10.44.90.2'});
 s.game.active.waiting=true;assert.equal(gameAddress(s),null);
 s.game.active=null;assert.equal(gameAddress(s),null);
});
test('Unreal launch uses the local seat, handles cancellation and rechecks membership after the chooser',async()=>{
 const {launchUnreal}=require('../src/game/unreal-launch.cjs'),{EventEmitter}=require('node:events');
 const service={game:{active:{id:'r',prefix:'10.44.90'}},gameNet:{phase:'ready',ports:new (require('../src/game/ports.cjs').GamePorts)(),mine:()=>({slot:3})}};
 const file='D:\\Build folder\\Example.exe',starts=[];
 const host={platform:'win32',files:{realpath:async()=>file,stat:async()=>({isFile:()=>true})},spawn(...args){
   starts.push(args);const child=Object.assign(new EventEmitter(),{unref(){}});queueMicrotask(()=>child.emit('spawn'));return child;
 }};
 const dialog={showOpenDialog:async()=>({filePaths:[file]}),showMessageBox:async()=>({response:0})};
 await launchUnreal(service,dialog,null,host);assert.equal(starts.length,0);
 dialog.showMessageBox=async()=>({response:1});await launchUnreal(service,dialog,null,host);
 assert.deepEqual(starts[0],[file,['-MULTIHOME=10.44.90.3'],{shell:false,detached:true,cwd:'D:\\Build folder',stdio:'ignore'}]);
 service.game.active.roster=[{slot:8,device:'gameHost',ready:true}];
 await launchUnreal(service,dialog,null,host,'gameHost');
 assert.deepEqual(starts[1][1],['10.44.90.8:7777','-MULTIHOME=10.44.90.3']);
 await assert.rejects(launchUnreal(service,dialog,null,host,'gameHost',28101));
 service.gameNet.ports.set('UDP 28101-28105');await launchUnreal(service,dialog,null,host,'gameHost',28102);
 assert.equal(starts[2][1][0],'10.44.90.8:28102');
 dialog.showMessageBox=async()=>{service.game.active.roster[0].ready=false;return {response:1};};
 await assert.rejects(launchUnreal(service,dialog,null,host,'gameHost'),/недоступен/);
 dialog.showMessageBox=async()=>{service.game.active=null;return {response:1};};
 await assert.rejects(launchUnreal(service,dialog,null,host),/изменилась/);assert.equal(starts.length,3);
});
