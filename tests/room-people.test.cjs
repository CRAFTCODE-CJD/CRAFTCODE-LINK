'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Duplex}=require('node:stream');
const {seed,publicCard,shareCard,friend,sign}=require('../src/direct/identity.cjs');
const {DirectService}=require('../src/direct/service.cjs');
const {roomTag}=require('../src/direct/avatars.cjs');
const {readPerson,fields}=require('../src/direct/room-people.cjs');
function profile(name){return {name,root:seed(),device:seed(),friends:[],dht:false,lan:''};}
function service(p,opts={}){
  const s=new DirectService({store:{read:()=>p,write:next=>{p=next;}},nics:()=>[],...opts});s.start();return s;
}
function link(a,b){
  let left,right;
  const socket=other=>new Duplex({read(){},write(bytes,_encoding,done){other().push(Buffer.from(bytes));done();}});
  left=socket(()=>right);right=socket(()=>left);
  for(const s of [left,right])s.on('error',()=>{});
  left.on('close',()=>right.destroy());right.on('close',()=>left.destroy());
  const nonce=seed();a.attach(left,'lan',nonce,b.me.id,b.me.device);b.attach(right,'lan',nonce,a.me.id,a.me.device);
}
async function wait(predicate){for(let n=0;n<1000;n++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('Condition timeout');}

test('a room introduction binds the signed profile card, session and ephemeral participant ID',()=>{
  const p=profile('Same'),room=roomTag('room-one'),peer='abcdefgh12345678',card=shareCard(p);
  const entry={peer,card,proof:sign(p.root,fields(room,peer,card))};
  assert.equal(readPerson(entry,room).person.id,publicCard(p).id);
  assert.equal(readPerson(entry,roomTag('other-room')),null);
  assert.equal(readPerson({...entry,peer:'ABCDEFGH12345678'},room),null);
  assert.equal(readPerson({...entry,card:shareCard(profile('Same'))},room),null);
  const altered=JSON.parse(Buffer.from(card.slice(5),'base64url'));altered.name='Someone else';
  assert.equal(readPerson({...entry,card:'CCF1:'+Buffer.from(JSON.stringify(altered)).toString('base64url')},room),null);
  assert.equal(readPerson({...entry,card:'x'.repeat(1501)},room),null);
});

test('two guests can explicitly become friends through a shared LINK room, with stale/blocked identities rejected', {timeout:20000},async t=>{
  const {startHost}=require('../src/core/session.cjs'),{joinRecoveringGuest}=require('../src/core/reconnect.cjs');
  let hostRoom;
  const guests=new Map();
  const host=service(profile('Same'),{roomInfo:()=>hostRoom?.getInfo(),hostRoom:async()=>{
    if(!hostRoom)hostRoom=await startHost({name:'Same',address:'127.0.0.1',bindAddress:'127.0.0.1',port:0,
      onGuestJoined:(port,invite,id,address)=>host.joinedPeer(port,invite,id,address),
      onEvent:e=>{if(e.type==='roster')host.announceRooms();}});
    host.publishRoom=true;return hostRoom.getInfo();
  }});
  let b,c;
  b=service(profile('Same'),{roomInfo:()=>guests.get(b)?.getInfo()});
  c=service(profile('Same'),{roomInfo:()=>guests.get(c)?.getInfo()});
  const outsider=service(profile('Same'));
  t.after(async()=>{
    for(const room of guests.values())await room.close();await hostRoom?.close();
    await Promise.all([host,b,c,outsider].map(s=>s.stop()));
  });
  for(const g of [b,c,outsider]){host.setFriend(friend(g.me,'friend'));g.setFriend(friend(host.me,'friend'));link(host,g);}
  async function join(g){
    await wait(()=>host.linksTo(g.me.id).some(l=>l.roomPeople));host.call(g.me.id);
    await wait(()=>g.pending);const id=g.pending.id;g.take(id);await wait(()=>g.pending?.joining);
    const opts=g.joinOptions(id),room=await joinRecoveringGuest({...opts,onEvent:e=>{if(e.type==='roster')g.announceRooms();}});
    guests.set(g,room);g.guestAppearance={room:roomTag(opts.invite),device:opts.hostDevice,person:opts.hostPerson};
    g.announceRooms();return room.getInfo().selfId;
  }
  const bPeer=await join(b),cPeer=await join(c);
  await wait(()=>b.roomPeople.snapshot()[cPeer]?.id===c.me.id&&c.roomPeople.snapshot()[bPeer]?.id===b.me.id);
  assert.equal(b.contact(c.me.id),undefined,'meeting in a room must not auto-add a friend');
  assert.equal(b.roomContacts()[cPeer],undefined,'unknown participants must not inherit saved friend controls');
  assert.equal(outsider.linksTo(host.me.id)[0].roomPeopleRoster,undefined,'a friend outside the room must not receive identities');
  const info=b.roomPeople.snapshot()[cPeer],request={owner:b.me.id,room:info.room,peer:cPeer,person:c.me.id};
  const privacy={status:'online',calls:true,invites:true,friendRequests:true};
  c.setPrivacy(c.me.id,{...privacy,friendRequests:false});
  await wait(()=>!b.roomPeople.snapshot()[cPeer]);
  assert.throws(()=>b.roomPeople.add(request),'a disabled introduction must disappear from open participant cards');
  c.setPrivacy(c.me.id,privacy);
  await wait(()=>b.roomPeople.snapshot()[cPeer]?.id===c.me.id);
  c.setPrivacy(c.me.id,{...privacy,status:'invisible'});
  await wait(()=>!b.roomPeople.snapshot()[cPeer]);
  assert(guests.get(c).getInfo().peers.some(p=>p.id===cPeer),'the hidden peer remains in the current room');
  assert.throws(()=>b.roomPeople.add(request),'a hidden peer cannot be added using the previous introduction');
  c.setPrivacy(c.me.id,privacy);
  await wait(()=>b.roomPeople.snapshot()[cPeer]?.id===c.me.id);
  for(const bad of [{owner:host.me.id},{room:roomTag('stale')},{peer:bPeer},{person:outsider.me.id}])
    assert.throws(()=>b.roomPeople.add({...request,...bad}));
  assert.equal(b.roomPeople.add(request),'sent');assert.equal(b.roomPeople.add(request),'pending');
  link(b,c);await wait(()=>c.requests.has(b.me.id));assert.equal(c.contact(b.me.id),undefined);
  c.answer(b.me.id,true);await wait(()=>b.contact(c.me.id)?.state==='friend');
  assert.equal(b.roomPeople.add(request),'existing');
  b.forget(c.me.id,true);assert.throws(()=>b.roomPeople.add(request),/разблокируйте/);
  // An arbitrary authenticated friend cannot replace the current host's roster.
  const before=JSON.stringify(b.roomPeople.snapshot());
  const fake={card:outsider.me,roomPeople:true,socket:{destroyed:false},send:()=>true};
  b.setFriend(friend(outsider.me,'friend'));b.links.add(fake);
  b.message(fake,{kind:'room-people',room:info.room,members:[]});
  assert.equal(JSON.stringify(b.roomPeople.snapshot()),before);b.links.delete(fake);
  const oldGuest=guests.get(b);guests.delete(b);
  assert.deepEqual(b.roomPeople.snapshot(),{});assert.throws(()=>b.roomPeople.add(request));
  await oldGuest.close();
});

test('call presence covers hosts and guests without publishing room access and clears on leave, invisibility and expiry',async t=>{
  let room=null;
  const a=service(profile('Caller'),{roomInfo:()=>room}),b=service(profile('Friend'));
  t.after(()=>Promise.all([a.stop(),b.stop()]));
  a.setFriend(friend(b.me,'friend'));b.setFriend(friend(a.me,'friend'));link(a,b);
  await wait(()=>a.linksTo(b.me.id).some(l=>l.roomPeople));
  const sent=[],out=a.linksTo(b.me.id)[0],original=out.send.bind(out);
  out.send=packet=>{sent.push(packet);return original(packet);};
  const call=()=>b.snapshot().friends.find(f=>f.id===a.me.id).inCall;
  assert.equal(call(),false);
  for(const role of ['host','guest']){
    room={role,invite:'private-invite',selfId:'abcdefgh12345678',peers:[]};a.announceRooms();
    await wait(()=>call()===true);
    const state=sent.filter(p=>p.kind==='room-state').at(-1);
    assert.equal(state.inCall,true);assert.equal(state.door,'');assert.equal(state.count,0);
    assert(!JSON.stringify(state).includes('private-invite'));
    room=null;a.announceRooms();await wait(()=>call()===false);
  }
  room={role:'guest',peers:[]};a.announceRooms();await wait(()=>call()===true);
  const received=b.linksTo(a.me.id)[0];
  b.message(received,{kind:'room-state',door:'',count:0,inCall:'true'});assert.equal(call(),true);
  b.message(received,{kind:'room-state',door:'',count:0});assert.equal(call(),false,'legacy absence is not evidence of a call');
  b.message(received,{kind:'room-state',door:'',count:0,inCall:true,availability:'offline'});assert.equal(call(),false);
  b.message(received,{kind:'room-state',door:'',count:0,inCall:true,availability:'online'});assert.equal(call(),true);
  received.remoteRoom.until=0;assert.equal(call(),false);
  a.profile.privacy={status:'invisible',friendRequests:true,calls:true,invites:true};
  // A retained room connection still publishes an explicit offline / no-call status.
  out.wire={};a.announceRooms();await wait(()=>received.contactStatus==='offline');assert.equal(call(),false);out.wire=null;
  assert.equal(sent.filter(p=>p.kind==='room-state').at(-1).inCall,false);
});

test('contact labels retain away/busy and do not show calls for offline people',async()=>{
  const {contactStatusLabel}=await import('../src/renderer/contact-list.mjs');
  assert.equal(contactStatusLabel({online:true,inCall:true}),'Сейчас в звонке');
  assert.equal(contactStatusLabel({online:true,status:'busy',inCall:true}),'Сейчас в звонке · Занят');
  assert.equal(contactStatusLabel({online:true,status:'away',inCall:true}),'Сейчас в звонке · Отошёл');
  assert.equal(contactStatusLabel({online:false,inCall:true}),'Не в сети');
});
