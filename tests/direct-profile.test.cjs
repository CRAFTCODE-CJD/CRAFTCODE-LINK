'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {once,EventEmitter}=require('node:events');
const {Duplex}=require('node:stream');
const {seed,publicCard,shareCard,parseCard,sign,validCard,friend,seal,unseal}=require('../src/direct/identity.cjs');
const {DirectService}=require('../src/direct/service.cjs');
function profile(name){return {name,root:seed(),device:seed(),friends:[],dht:false,lan:''};}
function service(p,opts={}){
 const store={read:()=>p,write:n=>{p=n;}};
 const s=new DirectService({store,nics:()=>[],...opts});s.start();return s;
}
function pair(){
 let a,b;const make=get=>new Duplex({read(){},write(data,enc,cb){get().push(Buffer.from(data));cb();}});
 a=make(()=>b);b=make(()=>a);a.on('error',()=>{});b.on('error',()=>{});a.on('close',()=>b.destroy());b.on('close',()=>a.destroy());return [a,b];
}
function link(a,b){
 const [s,t]=pair(),nonce=seed();a.attach(s,'lan',nonce,b.me.id,b.me.device);b.attach(t,'lan',nonce,a.me.id,a.me.device);
}
async function wait(pred){for(let i=0;i<1000;i++){if(pred())return;await new Promise(r=>setTimeout(r,10));}throw Error('Condition timeout');}

test('one-byte fragments before authentication use bounded copying and still preserve the signed frame',()=>{
  const {ContactLink}=require('../src/direct/links.cjs'),local=profile('Local'),guest=profile('Peer'),card=publicCard(guest),binding=seed();
  const socket=new Duplex({read(){},write(_buf,_enc,done){done();}});let authenticated=false;
  new ContactLink(socket,'lan',binding,local,card.id,card.device,()=>{authenticated=true;},()=>{},()=>{});
  const hello={kind:'hello',card,proof:sign(guest.device,['hello-v1',binding,card.id,card.device,card.name])};
  const original=Buffer.concat,byte=Buffer.from(' ');let allocated=0;
  try{
    Buffer.concat=(parts,...args)=>{const data=original(parts,...args);allocated+=data.length;return data;};
    for(let i=0;i<12000;i++)socket.emit('data',byte);
    socket.emit('data',Buffer.from(JSON.stringify(hello)+'\n'));
    assert(authenticated);assert(allocated<100000,`12 KiB caused ${allocated} bytes of buffer concatenations`);
  }finally{Buffer.concat=original;socket.destroy();}
});

test('a seventeenth signed device cannot call or invite to LAN, even in its hello frame batch',async t=>{
  const {randomUUID}=require('node:crypto'),root=seed();
  const device=()=>({...profile('Friend'),root}),first=device(),second=device();
  const host=service(profile('Host')),other=service(second);
  t.after(()=>Promise.all([host.stop(),other.stop()]));
  const trusted=friend(publicCard(first),'friend');host.setFriend(trusted);other.setFriend(friend(host.me,'friend'));
  link(host,other);await wait(()=>host.linksTo(trusted.id).some(l=>l.card.device===other.me.device&&l.groups));
  const devices=[...host.contact(trusted.id).devices];assert.equal(devices.length,2);
  while(devices.length<16)devices.push(publicCard(device()).device);
  host.setFriend({...host.contact(trusted.id),devices});
  const incoming=device(),card=publicCard(incoming),[local,remote]=pair(),binding=seed(),expires=Date.now()+30000;
  const batch=[{kind:'hello',card,proof:sign(incoming.device,['hello-v1',binding,card.id,card.device,card.name])},
    {kind:'ring',id:randomUUID(),expires},
    {kind:'game-room',action:'invite',room:randomUUID(),ticket:randomUUID(),title:'Match',expires}];
  host.attach(local,'lan',binding,card.id);
  remote.write(batch.map(m=>JSON.stringify(m)).join('\n')+'\n');await new Promise(resolve=>setImmediate(resolve));
  assert(!host.pending,'a rejected hello must never deliver the pipelined ring');
  assert.equal(host.game.invitations.size,0);assert(local.destroyed);assert(!host.linksTo(card.id).some(l=>l.card.device===card.device));
  const accepted=other.linksTo(host.me.id)[0];accepted.send(batch[1]);accepted.send(batch[2]);
  await wait(()=>host.pending?.device===other.me.device&&host.game.invitations.size===1);
});
test('revoking discovery during TLS setup prevents signed LAN replies and stale profile writes',async t=>{
  const udp=require('node:dgram');
  const {verify}=require('../src/direct/identity.cjs');
  const sockets=[],replies=[];
  t.mock.method(udp,'createSocket',()=>{
    const socket=new EventEmitter();
    Object.assign(socket,{
      bind(_port,_address,ready){queueMicrotask(ready);},
      close(){this.closed=true;this.emit('close');},
      addMembership(){},setMulticastInterface(){},setMulticastTTL(){},setBroadcast(){},
      send(data,_port,_address,done){if(data[0]===123)replies.push(JSON.parse(data));done();}
    });
    sockets.push(socket);return socket;
  });
  const nic={name:'test-loopback',address:'127.0.0.1',netmask:'255.0.0.0'};
  const s=service(profile('Local'),{nics:()=>[nic]});
  t.after(()=>s.stop());
  const nonce=Buffer.alloc(16,3);
  function query(){
    for(const socket of sockets)if(!socket.closed)socket.emit('message',Buffer.concat([Buffer.from('CCLQ1'),nonce]),{address:'127.0.0.1',port:23456});
  }
  const enabling=s.settings({lan:nic.name});
  s.strict=true;
  await s.settings({dht:false,lan:''});await enabling;
  query();
  assert.equal(replies.length,0,'a stranger received the signed identity after revocation');
  assert.equal(s.profile.lan,'');
  assert.equal(s.network.nic,null);
  s.strict=false;
  await s.settings({lan:nic.name});
  query();assert.equal(replies.length,1);
  const reply=replies[0];
  assert.equal(reply.card.id,s.me.id);
  assert.ok(verify(reply.card.device,['lan-v1',nonce.toString('hex'),reply.port,reply.pin,reply.card.name],reply.proof));
  sockets.at(-1).emit('error',Error('interface lost'));
  assert.equal(s.network.nic,null);
  s.refreshContacts();await wait(()=>s.network.nic && !s.rebinding);
  query();assert.equal(replies.length,2,'refresh rebinds the same selected interface after a socket failure');
  s.network.sender.send=(_q,_port,_to,sent)=>sent(Object.assign(Error('no route'),{code:'ENETUNREACH'}));
  s.network.refresh();assert.equal(s.network.nic,null,'a send callback error also invalidates the bind');
});
test('private playback preferences validate membership and room, survive store reopen and disappear on block',async t=>{
  const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
  const {ProfileStore}=require('../src/direct/identity.cjs');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'link-listener-'));
  let s;
  t.after(async()=>{
    try{await s?.stop();}
    finally{await fs.rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
  });
  const protect={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:bytes=>bytes.toString()};
  const store=new ProfileStore(directory,protect), owner=profile('Listener'), first=publicCard(profile('Same')), second=publicCard(profile('Same'));
  owner.friends=[friend(first,'friend'),friend(second,'friend')];store.write(owner);
  let room={role:'host',invite:'original',peers:[{id:'p1'},{id:'p2'}]};
  s=new DirectService({store,roomInfo:()=>room,nics:()=>[]});s.me=publicCard(owner);s.publishRoom=true;
  s.tunnels.set(1,{invite:'original',peer:'p1',person:first.id});
  const cmd={owner:s.me.id,room:s.mixRoom(),peer:'p1',person:first.id,role:'voice',volume:35,muted:true};
  for(const bad of [{owner:first.id},{room:seed()},{peer:'p2'},{person:second.id},{role:'screen'},{volume:401},{volume:NaN},{muted:1}])
    assert.throws(()=>s.setRoomMix({...cmd,...bad}));
  s.setRoomMix(cmd);s.setRoomMix({...cmd,role:'system',volume:160,muted:false});
  const restarted=new ProfileStore(directory,protect).read();
  assert.deepEqual(restarted.contactMix[first.id],{voice:{volume:35,muted:true},system:{volume:160,muted:false}});
  assert.equal(restarted.contactMix[second.id],undefined);
  assert.equal((await unseal(await seal(restarted,'a long test passphrase'),'a long test passphrase')).contactMix,undefined);
  room={...room,invite:'next'};s.tunnels.get(1).invite='next';
  assert.throws(()=>s.setRoomMix(cmd));s.setRoomMix({...cmd,room:s.mixRoom(),volume:100,muted:false});
  assert.equal(store.read().contactMix[first.id].voice,undefined);
  s.forget(first.id,true);assert.equal(store.read().contactMix[first.id],undefined);
  assert.throws(()=>s.setRoomMix({...cmd,room:s.mixRoom()}));
});
test('photos and profile cards are profile-bound and friend-only; replay, wrong sizes, removal and unsupported peers',async t=>{
  const a=service(profile('Name')),b=service(profile('Name')),c=service(profile('Name'));
  t.after(()=>Promise.all([a.stop(),b.stop(),c.stop()]));
  const pixels=Buffer.alloc(48*48*3,126).toString('base64');
  assert.throws(()=>a.setAvatar(b.me.id,pixels));assert.throws(()=>a.setAvatar(a.me.id,pixels+'A'));
  a.setAvatar(a.me.id,pixels);
  assert.throws(()=>a.setProfileStyle(b.me.id,'lagoon','Bio'));
  for(const [cover,about] of [['url(test)','Bio'],['lagoon','x'.repeat(161)],['twilight','Spoof\u202e']])assert.throws(()=>a.setProfileStyle(a.me.id,cover,about));
  a.setProfileStyle(a.me.id,'lagoon','Играем по вечерам');
  assert(!publicCard(a.profile).avatar);assert(!parseCard(a.card()).avatar);
  assert(!publicCard(a.profile).cardStyle);assert(!parseCard(a.card()).cardStyle);
  a.add(b.card());link(a,b);await wait(()=>b.requests.size);
  assert(!b.profile.contactAvatars?.[a.me.id]);assert(!b.snapshot().requests[0].avatar);
  assert(!b.profile.contactStyles?.[a.me.id]);assert(!b.snapshot().requests[0].cardStyle);
  b.answer(a.me.id,true);await wait(()=>b.snapshot().friends[0]?.avatar===pixels);
  await wait(()=>b.snapshot().friends[0]?.cardStyle?.about==='Играем по вечерам');
  assert.deepEqual(b.snapshot().friends[0].cardStyle,{cover:'lagoon',about:'Играем по вечерам'});
  const previousStyle={...a.profile.cardStyle};
  const old={...a.profile.avatar};
  b.receiveAvatar(a.me.id,{...old,time:Date.now()+2*86400000});assert.equal(b.pendingAvatars.size,0);
  const copy=await unseal(await b.export('protected avatar profile'),'protected avatar profile');assert(!copy.contactAvatars);
  const own=await unseal(await a.export('protected avatar profile'),'protected avatar profile');assert.equal(own.avatar.pixels,pixels);
  assert.deepEqual(own.cardStyle,previousStyle);assert(!copy.contactStyles);
  a.setProfileStyle(a.me.id,'default','');
  await wait(()=>b.snapshot().friends[0]?.cardStyle?.cover==='default');
  for(const style of [previousStyle,{...previousStyle,time:Date.now()+10,about:'x'.repeat(161)},{...previousStyle,time:Date.now()+2*86400000}]){
    b.message(b.linksTo(a.me.id)[0],{kind:'profile-style',style});b.flushAvatars();
    assert.deepEqual(b.snapshot().friends[0].cardStyle,{cover:'default',about:''});
  }
  a.setAvatar(a.me.id,null);await wait(()=>b.snapshot().friends[0]?.avatar===null);
  b.message(b.linksTo(a.me.id)[0],{kind:'avatar',avatar:old});b.flushAvatars();assert.equal(b.snapshot().friends[0].avatar,null);
  const legacySent=[],unsupported={card:c.me,socket:{destroyed:false},send:m=>{legacySent.push(m);return true;}};
  a.setFriend(friend(c.me,'friend'));a.links.add(unsupported);a.setAvatar(a.me.id,pixels);
  a.setProfileStyle(a.me.id,'ember','');assert(!legacySent.some(m=>m.kind==='profile-style'));
  assert(!legacySent.some(m=>m.kind==='avatar'));b.forget(a.me.id,true);
  assert(!b.profile.contactAvatars?.[a.me.id]);assert(!b.pendingAvatars.has(a.me.id));
  assert(!b.profile.contactStyles?.[a.me.id]);assert(!b.pendingStyles.has(a.me.id));
});

test('room pictures use confirmed identities and session-bound signatures even when participants share a name',async t=>{
  const {validRoomMap,roomTag,memberTag,witnessFields}=require('../src/direct/avatars.cjs');
  const host=profile('Same'),other=profile('Same'),guest=profile('Same');
  const h=publicCard(host),o=publicCard(other),peer='1234567890abcdef',room=roomTag('test room');
  const g=service(guest,{roomInfo:()=>({role:'guest',hostId:'host',peers:[{id:'host'},{id:peer}]})});
  t.after(()=>g.stop());g.setFriend(friend(h,'friend'));g.setFriend(friend(o,'friend'));
  g.guestAppearance={person:h.id,device:h.device,room};
  const link={card:h,socket:{destroyed:false},appearance:true,send:()=>true};g.links.add(link);
  const tag=memberTag(room,g.me.id,o.id);
  const signed=(key,scope,id)=>sign(key,witnessFields(scope,id));
  const roster=(proof,scope=room)=>({kind:'avatar-roster',room:scope,members:[[peer,tag,proof]]});
  const expected={host:h.id,[peer]:o.id};
  g.message(link,roster(signed(other.root,room,peer)));assert.deepEqual(g.roomContacts(),expected);
  g.message(link,roster(signed(host.root,room,peer)));assert.deepEqual(g.roomContacts(),{host:h.id});
  g.message(link,roster(signed(other.root,room,'aaaaaaaaaaaaaaaa')));assert.deepEqual(g.roomContacts(),{host:h.id});
  g.message(link,roster(signed(other.root,room,peer),roomTag('old')));assert.deepEqual(g.roomContacts(),{host:h.id});
  assert(!validRoomMap({room,members:Array(8).fill([peer,tag,''])}));
  g.message(link,roster(signed(other.root,room,peer)));g.forget(o.id,true);assert.deepEqual(g.roomContacts(),{host:h.id});
});
test('three authenticated LINK participants receive signed room bindings for current friends; an IP guest receives the standard roster only',async t=>{
  const {startHost,joinHost}=require('../src/core/session.cjs'),{joinRecoveringGuest}=require('../src/core/reconnect.cjs');
  const {roomTag}=require('../src/direct/avatars.cjs');
  let hostRoom,manual;
  const guests=new Map(),rosters=[];
  const host=service(profile('Same'),{roomInfo:()=>hostRoom?.getInfo(),hostRoom:async()=>{
    if(!hostRoom)hostRoom=await startHost({name:'Same',address:'127.0.0.1',bindAddress:'127.0.0.1',port:0,
      onGuestJoined:(port,invite,id,address)=>host.joinedPeer(port,invite,id,address),onEvent:e=>{if(e.type==='roster')host.announceRooms();}});
    host.publishRoom=true;return hostRoom.getInfo();
  }});
  const b=service(profile('Same'),{roomInfo:()=>guests.get(b)?.getInfo()}),c=service(profile('Same'),{roomInfo:()=>guests.get(c)?.getInfo()});
  t.after(async()=>{
    await manual?.close();for(const room of guests.values())await room.close();
    await hostRoom?.close();await Promise.all([host.stop(),b.stop(),c.stop()]);
  });
  for(const g of [b,c]){host.setFriend(friend(g.me,'friend'));g.setFriend(friend(host.me,'friend'));link(host,g);}
  b.setFriend(friend(c.me,'friend'));c.setFriend(friend(b.me,'friend'));
  async function join(g){
    await wait(()=>host.linksTo(g.me.id).some(l=>l.appearance));host.call(g.me.id);
    await wait(()=>g.pending);const id=g.pending.id;g.take(id);await wait(()=>g.pending?.joining);
    const opts=g.joinOptions(id);
    const room=await joinRecoveringGuest({...opts,onEvent:e=>{if(e.type==='roster')g.announceRooms();}});
    guests.set(g,room);g.guestAppearance={room:roomTag(opts.invite),device:opts.hostDevice,person:opts.hostPerson};
    g.announceRooms();return room.getInfo().selfId;
  }
  const bId=await join(b),cId=await join(c);
  await wait(()=>b.roomContacts()[cId]===c.me.id&&c.roomContacts()[bId]===b.me.id);
  const localSocket={invite:hostRoom.getInfo().invite,raw:{localAddress:'127.0.0.1'}};
  host.tunnels.set(-1,localSocket);host.joinedPeer(-1,localSocket.invite,cId,'192.0.2.20');host.tunnels.delete(-1);
  assert.equal(localSocket.peer,undefined);
  assert.deepEqual(host.roomContacts(),{[bId]:b.me.id,[cId]:c.me.id});
  manual=await joinHost({name:'Same',invite:hostRoom.getInfo().invite,onEvent:e=>{if(e.type==='roster')rosters.push(e.peers);}});
  await wait(()=>rosters.some(r=>r.length===4)&&guests.get(b).getInfo().peers.length===4);
  const stranger=manual.getInfo().selfId;
  for(const s of [host,b,c])assert(!Object.hasOwn(s.roomContacts(),stranger));
  for(const p of rosters.at(-1))assert.deepEqual(Object.keys(p).sort(),['id','micMuted','name','shareTitle','sharing','slot']);
  b.forget(c.me.id,true);assert(!Object.hasOwn(b.roomContacts(),cId));
});
test('an authenticated LAN reconnect refreshes membership and adapter consent, including a missed room closure',async t=>{
  t.mock.method(require('node:os'),'networkInterfaces',()=>({}));
  const host=service(profile('Host')), guest=service(profile('Guest')),third=service(profile('Third'));
  t.after(()=>Promise.all([host.stop(),guest.stop(),third.stop()]));
  let released=0;
  for(const s of [host,guest])s.gameNet.open=async()=>({close(){released++;}});
  host.setFriend(friend(guest.me,'friend')); guest.setFriend(friend(host.me,'friend'));
  const reconnect=async()=>{
    link(host,guest);
    await wait(()=>host.linksTo(guest.me.id).length && guest.linksTo(host.me.id).length);
  };
  const disconnect=async()=>{
    guest.linksTo(host.me.id)[0].socket.destroy();
    await wait(()=>!host.linksTo(guest.me.id).length && !guest.linksTo(host.me.id).length);
  };
  await reconnect();
  host.game.create('Match'); const id=host.game.active.id;
  host.game.invite(guest.me.id); await wait(()=>guest.game.invitations.has(id));
  guest.game.answer(guest.game.state().invitations[0].id,true); await wait(()=>guest.game.active?.waiting===false);
  await disconnect();
  await host.gameNet.start(); await guest.gameNet.start();
  host.setFriend(friend(third.me,'friend')); third.setFriend(friend(host.me,'friend'));
  link(host,third); await wait(()=>host.linksTo(third.me.id).length && third.links.size);
  host.game.invite(third.me.id); await wait(()=>third.game.invitations.has(id));
  third.game.answer(third.game.state().invitations[0].id,true); await wait(()=>third.game.active?.waiting===false);
  await reconnect();
  await wait(()=>host.game.active.roster[1].ready && guest.game.active.roster[0].ready && guest.game.active.roster.length===3);
  assert.equal(guest.game.active.roster[1].ready,true);
  assert.equal(guest.game.active.roster[2].device,third.me.device);
  assert(guest.game.active.roster.every(p=>!Object.hasOwn(p,'ticket')));
  assert.equal(released,0);
  await disconnect();
  host.game.leave();
  await reconnect();
  await wait(()=>guest.game.active===null);
  assert.equal(guest.gameNet.phase,'off');
  assert.equal(released,2);
});

test('an offline voluntary LAN exit restores return only to the departed device; late messages cannot remove its new seat',async t=>{
  const host=service(profile('Host')), guest=service(profile('Guest')),other=service({...guest.profile,device:seed()});
  t.after(()=>Promise.all([host.stop(),guest.stop(),other.stop()]));
  host.setFriend(friend(guest.me,'friend'));
  for(const s of [guest,other])s.setFriend(friend(host.me,'friend'));
  link(host,guest); await wait(()=>!!host.game.link(guest.me));
  host.game.create('Match',false); const room=host.game.active.id;
  host.game.invite(guest.me.id); await wait(()=>guest.game.invitations.has(room));
  guest.game.answer(guest.game.state().invitations[0].id,true); await wait(()=>guest.game.active?.waiting===false);
  const ticket=guest.game.active.ticket;
  guest.linksTo(host.me.id)[0].socket.destroy();await wait(()=>!host.game.link(guest.me));
  guest.game.leave();link(host,other);await wait(()=>!!host.game.link(other.me));
  const otherLink=other.linksTo(host.me.id)[0];
  otherLink.send({kind:'game-room',action:'ready',requestRoster:true,ready:true,room,ticket});
  link(host,guest); await wait(()=>!!host.game.returnOffer(guest.me));
  assert.equal(host.game.returnOffer(other.me),null);
  guest.game.rejoin(host.me,host.game.returnOffer(guest.me));
  await wait(()=>guest.game.active?.waiting===false);
  assert.notEqual(guest.game.active.ticket,ticket);
  const current=guest.game.active.ticket;
  guest.game.receive(host.me,{action:'end',room,ticket});
  host.game.receive(guest.me,{action:'leave',room,ticket});
  host.game.receive(guest.me,{action:'end',room,ticket});
  assert.equal(guest.game.active.ticket,current);
  assert.equal(host.game.active.roster[1].ticket,current);
});
test('protected transfer preserves the person and contacts, creates separate device keys, and rejects a wrong password or damaged file',async t=>{
 const a=service(profile('Борис')),b=service(null);t.after(()=>Promise.all([a.stop(),b.stop()]));
 const ev=publicCard(profile('Анна'));a.setFriend(friend(ev,'friend'));
 const pass='correct private passphrase',file=await a.export(pass);
 assert(!file.includes(Buffer.from(a.profile.root)));await assert.rejects(b.import(file,'wrong private passphrase'));
 const damaged=Buffer.from(file);damaged[damaged.length-1]^=1;await assert.rejects(b.import(damaged,pass));assert(!b.profile);
 await b.import(file,pass);assert.equal(a.me.id,b.me.id);assert.notEqual(a.me.device,b.me.device);
 assert.equal(b.snapshot().friends[0].id,ev.id);assert(!b.profile.dht&&!b.profile.lan);
 const c=publicCard(profile('Друг')),bad={...c,id:a.me.id};assert(!validCard(bad));
 assert.throws(()=>parseCard('CCF1:'+Buffer.from(JSON.stringify(bad)).toString('base64url')));
});
test('two devices are one contact, first answer wins, a manual IP participant and the contact share one real TLS room', {timeout:20000},async t=>{
 const {startHost,joinHost}=require('../src/core/session.cjs');
 let live,joins=0,chosen=0;const sessions=[];
 const a=service(profile('А'),{roomInfo:()=>live?.getInfo(),hostRoom:async()=>{live=await startHost({address:'127.0.0.1',bindAddress:'127.0.0.1',port:0,name:'А'});return live.getInfo();}});
 const b=service(profile('Б'),{incoming:kind=>{if(kind==='join')joins++;}});
 const c=service({...b.profile,device:seed()},{incoming:kind=>{if(kind==='join')chosen++;}});
 const stranger=service(profile('Незнакомец'));
 t.after(async()=>{for(const s of sessions)await s.close();await live?.close();await Promise.all([a.stop(),b.stop(),c.stop(),stranger.stop()]);});
 a.add(b.card());link(a,b);await wait(()=>b.requests.size);b.answer(a.me.id,true);
 await wait(()=>a.contact(b.me.id)?.state==='friend');
 c.setFriend(friend(a.me,'friend'));link(a,c);await wait(()=>a.snapshot().friends[0].onlineDevices===2);
 assert.equal(a.snapshot().friends.length,1);
 link(a,stranger);await wait(()=>stranger.links.size);
 stranger.linksTo(a.me.id)[0].send({kind:'ring',id:require('node:crypto').randomUUID()});await new Promise(r=>setTimeout(r,10));assert(!a.pending);
 a.call(b.me.id);await wait(()=>b.pending&&c.pending);const previous=b.pending.id;
 b.take(previous);await wait(()=>joins===1&&!c.pending);assert.equal(chosen,0);
 const events=[];const bGuest=await joinHost({...b.joinOptions(previous),onEvent:e=>events.push(e)});sessions.push(bGuest);
 const mEvents=[];const manual=await joinHost({name:'IP',invite:live.getInfo().invite,onEvent:e=>mEvents.push(e)});sessions.push(manual);
 assert.equal(live.getInfo().peers.length,3);manual.sendChat('Из IP-комнаты');await wait(()=>events.some(e=>e.text==='Из IP-комнаты'));
 bGuest.sendChat('От контакта');await wait(()=>mEvents.some(e=>e.text==='От контакта'));
 assert.throws(()=>b.take(previous));await wait(()=>a.snapshot().friends[0].lastCall>0);
});
test('captured identity proof from a different authenticated session is refused',async t=>{
 const a=service(profile('A')),p=profile('B'),c=publicCard(p);t.after(()=>a.stop());
 const [s,peer]=pair();a.attach(s,'lan','fresh',c.id,c.device);
 const close=once(s,'close');peer.write(JSON.stringify({kind:'hello',card:c,proof:sign(p.device,['hello-v1','previous',c.id,c.device,c.name])})+'\n');
 await close;assert.equal(a.links.size,0);assert.equal(a.requests.size,0);
});
test('search, presence, favorite, waiting and deterministic natural sorting',async()=>{
 const {selectContacts}=await import('../src/renderer/contact-list.mjs');
 const f=[{id:'1',name:'Алёна 10',alias:'link-a',online:true,state:'friend',lastCall:40},{id:'2',name:'Алёна 2',online:false,state:'invited',favorite:true,lastCall:60}];
 assert.deepEqual(selectContacts(f,{query:'алена',sort:'name'}).map(x=>x.id),['2','1']);assert.equal(selectContacts(f,{query:'LINK-A'})[0].id,'1');
 for(const filter of ['favorite','waiting'])assert.equal(selectContacts(f,{filter})[0].id,'2');
 assert.equal(selectContacts(f,{filter:'online'})[0].id,'1');assert.equal(selectContacts(f,{sort:'recent'})[0].id,'2');assert.equal(selectContacts(f,{query:'нет такого'}).length,0);
});

test('only a current call accepted on the certified device admits the room connection',async t=>{
 const {randomUUID}=require('node:crypto');
 const host=service(profile('Хозяин')),guest=service(profile('Друг')),other=service({...guest.profile,device:seed()});
 t.after(()=>Promise.all([host.stop(),guest.stop(),other.stop()]));
 host.setFriend(friend(guest.me,'friend'));guest.setFriend(friend(host.me,'friend'));other.setFriend(friend(host.me,'friend'));
 link(host,guest);link(host,other);await wait(()=>host.links.size===2&&guest.links.size===1);
 const l=host.linksTo(guest.me.id).find(c=>c.card.device===guest.me.device),otherLink=host.linksTo(guest.me.id).find(c=>c.card.device===other.me.device);
 const id=randomUUID(),ring={kind:'ring',id,expires:Date.now()-1};
 host.message(l,ring);assert(!host.pending);
 ring.expires=Date.now()+20000;host.message(l,ring);assert.equal(host.pending.id,id);
 host.reject();host.message(l,ring);assert(!host.pending);
 const open={kind:'open',id:randomUUID(),ticket:id};
 host.message(l,open);assert(!l.wire);
 host.grants.set(guest.me.device,{id,person:guest.me.id,invite:'test',until:Date.now()+20000});
 host.roomInfo=()=>({invite:'test'});host.message(otherLink,open);assert(!otherLink.wire);
 host.message(l,{...open,ticket:randomUUID()});assert(!l.wire);
 host.grants.get(guest.me.device).until=Date.now()-1;host.message(l,open);assert(!l.wire);
 host.forget(guest.me.id);assert.equal(host.grants.size,0);
 const card=JSON.parse(Buffer.from(guest.card().slice(5),'base64url'));card.name='Другое имя';
 assert.throws(()=>parseCard('CCF1:'+Buffer.from(JSON.stringify(card)).toString('base64url')));
});

test('a restarted guest can rejoin the same live LINK room; only its admitted device gets access',async t=>{
  const {startHost,joinHost}=require('../src/core/session.cjs');
  const {roomTag}=require('../src/direct/avatars.cjs');
  const {randomUUID}=require('node:crypto');
  const guests=[],sessions=[];
  let room,requests=0;
  const received=[];
  const host=service(profile('Host'),{roomInfo:()=>room?.getInfo(),incoming:()=>requests++,hostRoom:async()=>room.getInfo()});
  room=await startHost({name:'Host',address:'127.0.0.1',bindAddress:'127.0.0.1',port:0,
    onGuestJoined:(...args)=>host.joinedPeer(...args),onGuestGoodbye:(...args)=>host.leftByChoice(...args),
    onEvent:e=>{if(e.type==='roster')host.announceRooms();if(e.type==='chat')received.push(e.text);}});
  host.publishRoom=true;host.setAudience('invite',[]);
  const boot=p=>{const client=service(p);guests.push(client);return client;};
  t.after(async()=>{for(const s of sessions)await s.close();await room.close();await Promise.all([host,...guests].map(s=>s.stop()));});
  const initial=boot(profile('Guest'));
  host.setFriend(friend(initial.me,'friend'));initial.setFriend(friend(host.me,'friend'));
  const other=boot({...initial.profile,device:seed()});
  link(host,initial);link(host,other);
  await wait(()=>host.linksTo(initial.me.id).length===2 && initial.linksTo(host.me.id)[0]?.remoteRoom);
  const invite=room.getInfo().invite;
  host.call(initial.me.id);await wait(()=>initial.pending && other.pending);
  const ticket=initial.pending.id;initial.take(ticket);await wait(()=>initial.pending?.joining);
  assert.equal(host.canReturn(initial.me,invite),false,'accept alone is insufficient');
  const saved=initial.profile;
  const firstRoom=await joinHost(initial.joinOptions(ticket));sessions.push(firstRoom);
  await wait(()=>host.canReturn(initial.me,invite) && room.getInfo().peers.length===2);
  assert.deepEqual(other.roomsFor(host.me.id),[],'invite-only room hidden on the other device');
  // Lose the client transport without sending the room goodbye. Start a new
  // service with the same profile, as on a subsequent Windows login.
  await initial.stop();
  await wait(()=>room.getInfo().peers.length===1 && host.linksTo(initial.me.id).every(l=>l.card.device!==initial.me.device));
  const oldGrant=host.grants.get(initial.me.device);oldGrant.until=Date.now()-1;
  host.tick();assert(!host.grants.has(initial.me.device),'rejoin must outlive the short transport grant');
  const restored=boot(saved);link(host,restored);
  const offer=()=>restored.roomsFor(host.me.id)[0];
  await wait(()=>offer()?.canReturn);
  assert.equal(offer().count,1);assert(!JSON.stringify(offer()).includes(invite));
  async function rejoin(){
    restored.call(host.me.id,{...offer(),resume:true});
    await wait(()=>restored.pending?.joining);
    const fresh=restored.pending.id;assert.notEqual(fresh,ticket);
    const session=await joinHost(restored.joinOptions(fresh));sessions.push(session);
    assert.equal(session.getInfo().peers.length,2);assert.equal(requests,0);return session;
  }
  const returned=await rejoin();
  returned.sendChat('After the restart');
  await wait(()=>received.includes('After the restart'));
  await returned.close();await wait(()=>room.getInfo().peers.length===1 && !host.linksTo(restored.me.id).some(l=>l.wire));
  // An explicit leave and another return still use the same live-room policy.
  const last=await rejoin();
  assert.throws(()=>host.revokeReturn(restored.me.id,roomTag('another room')));
  const previous=offer();host.revokeReturn(restored.me.id,roomTag(invite));
  assert.equal(host.canReturn(restored.me,invite),false);
  assert.equal(room.getInfo().peers.length,2,'revoking future entry leaves the current call alone');
  await last.close();await wait(()=>room.getInfo().peers.length===1 && !offer());
  assert(!host.canReturn(restored.me,invite),'goodbye cannot recreate a revoked permission');
  const deviceLink=host.linksTo(restored.me.id).find(l=>l.card.device===restored.me.device);
  host.setAudience('friends',[]);await wait(()=>offer()?.canReturn===false);
  host.message(deviceLink,{kind:'ring',id:randomUUID(),expires:Date.now()+20000,canJoin:true,door:previous.door,resume:true});
  assert.equal(requests,0,'a stale resume cannot turn into a new incoming request');
  assert(!host.pending);assert(!host.grants.has(restored.me.device));
  restored.call(host.me.id,offer());await wait(()=>host.pending?.admit);
  host.take(host.pending.id);await wait(()=>restored.pending?.joining);
  const approved=await joinHost(restored.joinOptions(restored.pending.id));sessions.push(approved);
  assert.equal(requests,1);assert(host.canReturn(restored.me,invite));
  assert(!host.canReturn(restored.me,'a later room'));
  host.setAudience('selected',[other.me.id]);assert(host.canReturn(restored.me,invite)); // same person
  host.setAudience('selected',[]);assert(!host.canReturn(restored.me,invite));assert(!host.grants.has(restored.me.device));
  await approved.close();await wait(()=>room.getInfo().peers.length===1);
  assert(!host.canReturn(other.me,invite));assert(!host.game.active);assert(!restored.game.active);
});
test('incoming direct request and block survive restart; a second device of the same person remains blocked',async t=>{
  const a=service(profile('Получатель')),b=service(profile('Друг'));
  const devices=[a,b];t.after(()=>Promise.all(devices.map(d=>d.stop())));
  b.add(a.card());link(a,b);await wait(()=>a.requests.size===1);
  const restored=service(a.profile);devices.push(restored);
  assert.equal(restored.snapshot().requests[0].id,b.me.id);
  restored.forget(b.me.id,true);
  const again=service(restored.profile),other=service({...b.profile,device:seed()});devices.push(again,other);
  assert.deepEqual(again.snapshot().requests,[]);assert.equal(again.snapshot().blocked[0].id,b.me.id);
  again.found(other.me,'lan');assert.deepEqual(again.snapshot().near,[]);
  assert.throws(()=>again.add(other.card()),/разблокируйте/);
  link(again,other);await wait(()=>again.allSockets.size===0);
  assert.equal(again.linksTo(b.me.id).length,0);again.unblock(b.me.id);assert.equal(again.snapshot().friends.length,0);
  link(again,other);await wait(()=>again.requests.has(b.me.id));
});

test('card entry distinguishes pending, reciprocal and confirmed contacts and preserves saved devices',async t=>{
  const a=service(profile('Анна')),b=service(profile('Борис'));
  t.after(()=>Promise.all([a.stop(),b.stop()]));
  const other=publicCard(profile('Борис')).id;
  assert.throws(()=>a.add(b.card(),other),/Карточка принадлежит другому участнику/);
  assert.equal(a.profile.friends.length,0);
  assert.equal(a.add(b.card(),b.me.id),'sent');
  const first=a.contact(b.me.id);
  assert.equal(a.add(b.card()),'pending');assert.deepEqual(a.contact(b.me.id),first);
  const second={...b.profile,device:seed()};
  assert.equal(a.add(shareCard(second)),'pending');
  assert.deepEqual(a.contact(b.me.id).devices,[b.me.device,publicCard(second).device]);
  link(a,b);await wait(()=>b.requests.has(a.me.id));
  assert.equal(b.add(a.card()),'accepted');await wait(()=>a.contact(b.me.id).state==='friend');
  assert.equal(a.add(b.card()),'existing');assert.equal(a.profile.friends.length,1);
});

test('availability and admission policies follow confirmed links and survive a legacy reconnect',async t=>{
  const a=service(profile('One')),b=service(profile('Two')),stranger=service(profile('Unknown'));
  t.after(()=>Promise.all([a.stop(),b.stop(),stranger.stop()]));
  const prefs=(s,changes)=>s.setPrivacy(s.me.id,{...s.snapshot().privacy,...changes});
  const info=()=>b.snapshot().friends.find(f=>f.id===a.me.id);
  prefs(a,{friendRequests:false,status:'away',calls:false,invites:false});
  stranger.add(a.card());link(a,stranger);await wait(()=>a.linksTo(stranger.me.id).length);
  await new Promise(r=>setTimeout(r,25));assert.equal(a.requests.size,0);
  a.add(b.card());link(a,b);await wait(()=>b.requests.size===1);b.answer(a.me.id,true);
  await wait(()=>info()?.status==='away');assert(info().online);
  b.call(a.me.id);await wait(()=>!b.out);assert(!a.pending);
  b.game.create('Match');b.game.invite(a.me.id);await new Promise(r=>setTimeout(r,25));
  assert.equal(a.game.invitations.size,0);b.game.leave();
  prefs(a,{status:'busy'});await wait(()=>info().status==='busy');
  assert.throws(()=>a.setPrivacy(b.me.id,a.snapshot().privacy));
  assert.throws(()=>a.setPrivacy(a.me.id,{...a.snapshot().privacy,status:'bad'}));
  prefs(a,{status:'invisible'});await wait(()=>!info().online&&!a.links.size);
  // Older clients use a successful hello as their sole online indicator.
  // A fresh socket must get zero bytes, even if it claims to be a friend.
  const [s,peer]=pair();let bytes=0;peer.on('data',part=>bytes+=part.length);
  const closed=once(peer,'close');a.attach(s,'lan',seed(),b.me.id,b.me.device);await closed;
  assert.equal(bytes,0);a.tick();assert(!a.network.dht&&!a.network.nic);
  const otherDevice=service({...a.profile,device:seed(),privacy:undefined});
  t.after(()=>otherDevice.stop());link(b,otherDevice);
  await wait(()=>info().online);assert.equal(info().onlineDevices,1);assert.equal(info().status,'online');
  prefs(a,{status:'online',calls:true,invites:true});link(a,b);
  await wait(()=>info().onlineDevices===2);
  const remote=b.linksTo(a.me.id).find(l=>l.card.device===a.me.device);
  b.message(remote,{kind:'room-state',door:'',count:0,game:1});assert.equal(info().status,'online');
  b.call(a.me.id);await wait(()=>!!a.pending);b.cancel();await wait(()=>!a.pending);
});
test('an invisible participant keeps the joined match and appears offline, then drops the old route on leaving',async t=>{
  const a=service(profile('Player One')),b=service(profile('Player Two'));
  t.after(()=>Promise.all([a.stop(),b.stop()]));
  a.setFriend(friend(b.me,'friend'));b.setFriend(friend(a.me,'friend'));link(a,b);
  await wait(()=>a.links.size&&b.links.size);
  a.game.create('Match');const id=a.game.active.id;a.game.invite(b.me.id);await wait(()=>b.game.invitations.has(id));
  b.game.answer(b.game.state().invitations[0].id,true);await wait(()=>a.game.active.roster.length===2&&!b.game.active.waiting);
  a.setPrivacy(a.me.id,{...a.snapshot().privacy,status:'invisible'});
  await wait(()=>b.snapshot().friends[0].status==='offline');
  const observed=b.snapshot().friends[0].lastSeen;
  assert.ok(Number.isSafeInteger(observed) && observed<=Date.now());
  // Make the throttle expire while both devices retain their private LAN link.
  b.profile.contactSeen[a.me.id]=observed-20000;
  const hiddenLink=a.linksTo(b.me.id)[0];
  hiddenLink.send({kind:'room-state',door:'',count:0,availability:'offline'});
  hiddenLink.send({kind:'ping'});
  assert.equal(a.linksTo(b.me.id).length,1);assert.equal(b.game.active.roster.length,2);
  b.game.chat('still playing');await wait(()=>a.game.active.messages.some(m=>m.text==='still playing'));
  assert.equal(b.snapshot().friends[0].lastSeen,observed-20000);
  b.game.leave();await wait(()=>!a.linksTo(b.me.id).length);
});
test('hidden device survives profile storage without starting discovery on restart',async t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {ProfileStore}=require('../src/direct/identity.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'link-privacy-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const storage={isEncryptionAvailable:()=>true,encryptString:x=>Buffer.from(x),decryptString:x=>x.toString()};
  const store=new ProfileStore(dir,storage);
  const p={...profile('Remember Me'),lan:'a missing interface',dht:true,privacy:{status:'invisible',friendRequests:false,calls:false,invites:true}};
  const confirmed=friend(publicCard(profile('Friend')),'friend'),unconfirmed=friend(publicCard(profile('New')),'invited');
  p.friends=[confirmed,unconfirmed];const seen=Date.now()-60000;
  p.contactSeen={[confirmed.id]:seen,[unconfirmed.id]:seen};
  store.write(p);let networks=0;
  const s=new DirectService({store,dhtFactory:()=>{networks++;throw Error('unexpected discovery')},nics:()=>[]});
  t.after(()=>s.stop());s.start();s.tick();s.refreshContacts();
  assert.deepEqual(store.read().contactSeen,{[confirmed.id]:seen});
  assert.equal(s.snapshot().friends.find(f=>f.id===confirmed.id).lastSeen,seen);
  assert.deepEqual(s.snapshot().privacy,p.privacy);assert.equal(networks,0);assert(!s.issue&&!s.network.dht&&!s.network.nic);
});
