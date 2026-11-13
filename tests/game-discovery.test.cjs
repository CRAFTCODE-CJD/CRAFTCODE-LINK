'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {GameNetwork}=require('../src/game/network.cjs');
const {GameDiscovery,discoveryMessage}=require('../src/game/discovery.cjs');

const members=[1,2,3].map(slot=>({slot,id:'person'+slot,device:'device'+slot,ready:true}));
test('ioquake3 multiport LAN scan only admits the responding server for the querying player',t=>{
  const {net,writes,receive}=harness(t);
  const oob=text=>Buffer.concat([Buffer.from([255,255,255,255]),Buffer.from(text)]);
  const response=challenge=>oob('infoResponse\n\\mapname\\q3dm1\\protocol\\71\\challenge\\'+challenge);
  const clientPort=49012;
  receive(2,frame(2,255,clientPort,27960,oob('getstatus')));
  assert.equal(writes.length,0);
  for(let port=27960;port<=27963;port++)
    receive(2,frame(2,255,clientPort,port,oob('getinfo xxx')));
  assert.deepEqual(writes.map(b=>b.readUInt16BE(22)),[27960,27961,27962,27963]);
  net.route(1,frame(1,2,27960,clientPort,response('wrong')),true);
  assert(!net.discovery.listener(2,1,27960));
  net.route(1,frame(1,2,27960,clientPort,response('xxx')),true);
  assert(net.discovery.listener(2,1,27960));
  assert(!net.discovery.listener(3,1,27960));
  receive(2,frame(2,1,clientPort,27960,oob('getchallenge')));
  receive(3,frame(3,1,clientPort,27960,oob('getchallenge')));
  assert.equal(writes.length,5);
  assert(!discoveryMessage(response('xxx'),{sport:5353,dport:clientPort}));
  assert(!discoveryMessage(oob('infoResponse\n\\challenge\\xxx\\protocol\\71'),{sport:27960,dport:clientPort}));
  assert(!discoveryMessage(oob('getinfo xxx\nrcon bad'),{sport:clientPort,dport:27960}));
});
function frame(from,to,sport,dport,data){
  const b=Buffer.alloc(28+data.length);
  b[0]=0x45;b[8]=64;b[9]=17;b.writeUInt16BE(b.length,2);
  b.set([10,90,1,from,10,90,1,to],12);b.writeUInt16BE(sport,20);b.writeUInt16BE(dport,22);
  b.writeUInt16BE(b.length-20,24);data.copy(b,28);return b;
}
function header(type,nonce){
  const b=Buffer.alloc(32,12);b[0]=12;b[1]=1;b.writeUInt32BE(9999,2);b.write(type,6);
  b.writeBigUInt64BE(BigInt(nonce),8);return b;
}
function word(n){const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;}
function string(s){return Buffer.concat([word(Buffer.byteLength(s)),Buffer.from(s)]);}
function session(port,nonce){
  return Buffer.concat([header('SR',nonce),string('local owner'),string('local name'),word(0),word(1),
    string('session'),word(4),Buffer.from([192,168,1,42]),word(port),word(2),word(0),
    Buffer.from([1,0,0,0,1,1,1,1,0,0]),word(47537391),word(0)]);
}
function harness(t){
  const room={active:{id:'test',host:true,prefix:'10.90.1',roster:members.map(p=>({...p}))},self:()=>members[0],link:()=>null};
  const net=new GameNetwork(room,()=>{}),writes=[];
  net.adapter={close(){},write:b=>{writes.push(b);return true;}};t.after(()=>net.stop());
  const receive=(from,b)=>net.receive(members[from-1],{room:'test',frames:[b.toString('base64')]});
  return {net,room,writes,receive};
}

test('a matched advertisement rewrites only the advertised server and permits its UDP port only for that searcher',t=>{
  const {net,writes,receive}=harness(t);
  const q=frame(1,255,49750,14001,header('SQ',55));
  const sr=frame(2,255,14001,14001,session(29543,55));
  receive(2,sr);assert.equal(writes.length,0);
  net.route(1,q,true);
  receive(2,frame(2,255,14001,14001,session(29543,54)));assert.equal(writes.length,0);
  receive(2,sr);
  const delivered=writes[0];
  assert.equal(delivered[19],1);assert.equal(delivered.readUInt16BE(22),49750);
  const offset=28+discoveryMessage(sr.subarray(28),{sport:14001,dport:14001}).session.addressOffset;
  assert.deepEqual([...delivered.subarray(offset,offset+4)],[10,90,1,2]);
  assert.deepEqual([...sr.subarray(offset,offset+4)],[192,168,1,42]);
  assert.equal(delivered.readUInt32BE(offset+4),29543);
  function sum(buf){
    let n=0;for(let i=0;i<buf.length;i+=2)n+=(buf[i]<<8)+(buf[i+1]||0);
    while(n>>>16)n=(n&65535)+(n>>>16);return n;
  }
  assert.equal(sum(delivered.subarray(0,20)),65535);
  assert.equal(sum(Buffer.concat([delivered.subarray(12,20),Buffer.from([0,17]),delivered.subarray(24,26),delivered.subarray(20)])),65535);
  assert(net.discovery.listener(1,2,29543));assert(!net.discovery.listener(3,2,29543));assert(!net.discovery.listener(2,1,29543));
  assert.equal(net.status().traffic.lastMatch.build,47537391);
  // The same authenticated sender cannot open a service on another seat or a reserved port.
  receive(2,frame(3,255,14001,14001,session(29543,55)));
  receive(2,frame(2,255,14001,14001,session(3389,55)));
  assert.equal(writes.length,1,'forged third-party or management endpoints never reach the local game');
  assert(!net.discovery.listener(1,3,29543));assert(!net.discovery.listener(1,2,3389));
  net.setPorts('test','');assert(!net.discovery.listener(1,2,29543));
});

test('the Steam LAN layout carries the same local endpoint without requiring a Steam web session',()=>{
  const meta=Buffer.concat([header('SR',7),Buffer.from('0110000101234567','hex'),string('Host'),word(0),word(1),word(4),
    Buffer.from([172,24,1,18]),word(28901),Buffer.alloc(8),word(2),word(0),Buffer.from([1,1,0,0,1,1,1,1,0,0]),word(50),word(0)]);
  const s=discoveryMessage(meta,{sport:14001,dport:14001}).session;
  assert.equal(s.port,28901);assert.equal(s.build,50);
  assert.deepEqual([...meta.subarray(s.addressOffset,s.addressOffset+4)],[172,24,1,18]);
});

test('chat-only members cannot observe broadcasts, inject packets or reuse a revoked return path',t=>{
  const {net,room,writes,receive}=harness(t);
  const [host,guest,other]=room.active.roster;
  const games=Buffer.from('game');
  net.reconcile();
  net.route(1,frame(1,255,47011,7000,games),true);
  assert(net.queues.has(guest.device));
  net.route(1,frame(1,255,47011,14001,header('SQ',1)),true);
  receive(2,frame(2,1,14001,47011,session(57001,1)));
  assert(net.discovery.listener(1,2,57001));
  guest.ready=false;net.reconcile();
  assert(!net.queues.has(guest.device));assert(!net.discovery.listener(1,2,57001));
  writes.length=0;
  net.route(1,frame(1,255,47012,7000,games),true);
  net.route(1,frame(1,255,47012,14001,header('SQ',2)),true);
  assert(!net.queues.has(guest.device));assert(net.queues.has(other.device));
  receive(2,frame(2,1,47013,7000,games));assert.equal(writes.length,0);
  guest.ready=true;net.reconcile();
  receive(2,frame(2,1,7000,47011,games));receive(2,frame(2,1,7000,47012,games));
  receive(2,frame(2,1,14001,47011,session(57001,1)));receive(2,frame(2,1,14001,47012,session(57002,2)));
  assert.equal(writes.length,0);
  receive(3,frame(3,1,7000,47011,games));assert.equal(writes.length,1,'unrelated match still has its return flow');
  host.ready=false;net.reconcile();net.queues.clear();writes.length=0;
  receive(2,frame(2,255,47013,7000,games));
  assert.equal(writes.length,0);assert(net.queues.has(other.device),'the organizer may relay between two ready players');
});

test('a guest cannot reissue the same discovery answer to fill a client socket or choose unlimited listeners',t=>{
  const {net,writes,receive}=harness(t);
  const q=frame(1,255,47011,14001,header('SQ',7));
  net.route(1,q,true);
  for(let i=0;i<25;i++){
    receive(2,frame(2,255,14001,14001,session(57001,7)));
    receive(2,frame(2,255,14001,14001,session(57001+i,7)));
  }
  assert(writes.length>=2,'legitimate independent listeners on one host still work');
  assert(writes.length<=4,'bounded replies per responder and search');
  assert(!net.discovery.listener(1,2,57025));
  net.route(1,frame(1,255,47011,14001,header('SQ',8)),true);
  receive(2,frame(2,255,14001,14001,session(57025,8)));
  assert(net.discovery.listener(1,2,57025),'fresh search permits a new lobby');
});

test('game broadcast flood is bounded per origin and cannot exhaust a different seat or unicast',t=>{
  const {writes,receive}=harness(t), bytes=Buffer.from('lobby');
  const b=frame(2,255,49010,8086,bytes);
  for(let n=0;n<1000;n++)receive(2,b);
  assert(writes.length>30&&writes.length<650);
  const count=writes.length;
  receive(3,frame(3,255,49010,8086,bytes));receive(2,frame(2,1,8088,8088,bytes));
  assert.equal(writes.length,count+2);
});

test('service ports cannot be contacted with default or legacy rules or learned advertisements',t=>{
  const {net,writes,receive}=harness(t),games=Buffer.from('bytes');
  net.route(1,frame(1,255,47011,14001,header('SQ',13)),true);
  for(const port of [53,67,137,138,139,445,1900,2049,3389,3702,5350,5351,5353,5355]){
    for(const proto of ['UDP','TCP']) assert.throws(()=>net.setPorts('test',proto+' '+port));
    receive(2,frame(2,1,47011,port,games));receive(2,frame(2,255,port,7000,games));
    receive(2,frame(2,255,14001,14001,session(port,13)));
    assert(!net.discovery.listener(1,2,port));
  }
  assert.equal(writes.length,0);
});

test('a source-specific discovery response cannot enroll bystanders, cross a room or outlive its search',t=>{
  const {net,room,receive}=harness(t);net.reconcile();
  net.route(1,frame(1,2,42222,14001,header('SQ',89)),true);
  receive(3,frame(3,1,14001,42222,session(29117,89)));
  receive(2,frame(2,1,14001,42223,session(29117,89)));
  assert(!net.discovery.listener(1,3,29117));assert(!net.discovery.listener(1,2,29117));
  receive(2,frame(2,1,14001,42222,session(29117,89)));assert(net.discovery.listener(1,2,29117));
  room.active.roster=room.active.roster.slice(0,1);net.reconcile();assert(!net.discovery.listener(1,2,29117));
  const state=new GameDiscovery();
  state.observe({type:'query',key:'a'},{src:1,dst:255,sport:14001,dport:14001},members,0);
  assert.deepEqual(state.observe({type:'answer',key:'a',session:{port:27381}},{src:2,dst:255,sport:14001,dport:14001},members,15001),[]);
});

test('malformed and unsolicited advertisements cannot reach sockets, open return flows or relay to a bystander',t=>{
  const {net,room,writes,receive}=harness(t);
  const answer=session(29543,51);
  for(const payload of [header('SR',51).subarray(0,8),header('SR',51),
    Buffer.concat([header('SR',51),Buffer.from('ffffffff7f000001','hex')]),answer]){
    receive(2,frame(2,255,14001,14001,payload));
  }
  assert.equal(writes.length,0);assert.equal(net.queues.size,0);
  assert.equal(net.ports.flows.size,0);assert.equal(net.discovery.listeners.size,0);
  // Only seat 3 searches. Seat 1 is the relay and must not receive the answer.
  receive(3,frame(3,255,49823,14001,header('SQ',51)));
  net.queues.clear();writes.length=0;
  receive(2,frame(2,255,14001,14001,answer));
  assert.equal(writes.length,0);assert.deepEqual([...net.queues.keys()],['device3']);
  const reply=net.queues.get('device3').frames[0];
  assert.equal(reply[19],3);assert.equal(reply.readUInt16BE(22),49823);
  const {session:parsed}=discoveryMessage(reply.subarray(28),{sport:14001,dport:49823});
  assert.deepEqual([...reply.subarray(28+parsed.addressOffset,32+parsed.addressOffset)],[10,90,1,2]);
  assert(net.discovery.listener(3,2,29543));
  assert(!net.discovery.listener(2,1,29543));assert(!net.discovery.listener(2,3,29543));
  assert.equal(net.ports.flows.size,0);
  assert(!net.ports.accepts({proto:'UDP',src:2,dst:3,sport:14001,dport:49823},room.active.roster));
  receive(2,frame(2,1,49001,29543,Buffer.from('unrelated service')));assert.equal(writes.length,0);
});

test('RakNet discovery accepts an exact standard ping and matching Bedrock pong without opening the whole listener',t=>{
  const {net,writes,receive}=harness(t);
  const magic=Buffer.from('00ffff00fefefefefdfdfdfd12345678','hex');
  const q=Buffer.alloc(33);q[0]=1;q.writeBigUInt64BE(12345n,1);magic.copy(q,9);
  receive(2,frame(2,255,45100,19132,Buffer.from('unrelated')));
  receive(2,frame(2,255,137,19132,q));assert.equal(writes.length,0);
  receive(2,frame(2,255,45100,19132,q));assert.equal(writes.length,1);
  const s=Buffer.from('MCPE;LAN;123;1.0;1;3;42;LAN;Survival;1;29210;19133;'),reply=Buffer.alloc(35+s.length);
  reply[0]=0x1c;q.copy(reply,1,1,9);magic.copy(reply,17);reply.writeUInt16BE(s.length,33);s.copy(reply,35);
  const forbidden=Buffer.from(reply);forbidden.write('03389',forbidden.indexOf('29210'));
  assert.deepEqual(discoveryMessage(forbidden,{sport:19132,dport:45100}).session,{blocked:true});
  net.route(1,frame(1,2,19132,45100,reply),true);
  receive(2,frame(2,1,45150,29210,Buffer.from('valid game')));
  receive(3,frame(3,1,45150,29210,Buffer.from('bystander')));
  assert.deepEqual(writes.map(b=>b.readUInt16BE(22)),[19132,29210]);
});
