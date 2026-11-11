'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {seed,publicCard}=require('../src/direct/identity.cjs');
const {GroupVoice}=require('../src/groups/voice.cjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('a group server routes separate voice channels, moves the media host, and enforces channel membership',async t=>{
  const group=randomUUID(),first=randomUUID(),second=randomUUID(),members=new Map(),denied=new Set();
  let server;
  function client(name){
    const profile={root:seed(),device:seed(),name},me=publicCard(profile);
    const links=new Map();
    const groups={fileAllowed:l=>!!l?.groups&&links.get(l.card.id)===l&&!l.socket.destroyed,
      voiceAccess:(g,c,person)=>g===group && [first,second].includes(c) && !denied.has(person) && members.has(person)
      ? {owner:server.me.id,device:server.me.device,epoch:1,name:members.get(person).me.name} : null};
    const voice=new GroupVoice({me,profile,groups,update(){},contact:id=>members.has(id)&&{state:'friend'},blocked:()=>false,linksTo:id=>links.has(id)?[links.get(id)]:[]});
    const u={me,links,voice,events:[]};
    u.enter=async channel=>(await voice.join(group,channel)).bind(e=>u.events.push(e));
    members.set(me.id,u);
    return u;
  }
  function connect(a,b){
    const link={card:b.me,groups:true,socket:{destroyed:false},
      send:p=>{queueMicrotask(()=>b.voice.receive(b.links.get(a.me.id),p));return true;}};
    a.links.set(b.me.id,link);
  }
  server=client('Server');
  const a=client('Anna'),b=client('Boris'),c=client('Vera'),d=client('Dima');
  for(const u of [a,b,c,d]){connect(u,server);connect(server,u);}
  t.after(()=>{for(const u of members.values())u.voice.close();});
  const one=await a.enter(first),two=await b.enter(first),other=await c.enter(second);
  await flush();
  assert.equal(server.voice.local,undefined);
  assert.equal(server.voice.rooms.size,2);
  assert.deepEqual(other.getInfo().peers.map(p=>p.name),['Vera']);
  const guest=two.getInfo().selfId;
  assert.equal(a.voice.contacts()[guest],b.me.id);
  const oldProof=server.voice.rooms.get(group+'/'+first).seats.find(s=>s.peer.id===guest).proof;
  server.voice.deliver(server.voice.rooms.get(group+'/'+first),server.voice.rooms.get(group+'/'+first).seats[0],'members',{
    members:[[guest,c.me.id,oldProof],['host',b.me.id,oldProof]]});
  await flush();assert.equal(a.voice.contacts()[guest],undefined);assert.equal(a.voice.contacts().host,undefined);
  server.voice.identities(server.voice.rooms.get(group+'/'+first));await flush();
  assert.equal(a.voice.contacts()[guest],b.me.id);
  const sdp={type:'offer',sdp:'a'.repeat(70000)};
  one.sendSignal(guest,sdp);await flush();
  assert.deepEqual(b.events.find(e=>e.type==='signal')?.data,sdp);
  two.sendChat('Private to first channel');await flush();
  assert(a.events.some(e=>e.type==='chat'&&e.text==='Private to first channel'));
  assert(!c.events.some(e=>e.type==='chat'));
  // A failed or cancelled channel change leaves the current seat usable. A
  // confirmed handover releases it before binding the reserved seat for media.
  const candidate=await b.voice.join(group,second,true);
  assert.throws(()=>candidate.bind(()=>{}));
  assert.throws(()=>candidate.sendChat('before binding'));
  two.sendChat('old call remains');await flush();assert(a.events.some(e=>e.text==='old call remains'));
  candidate.close();await flush();
  assert.equal(two.getInfo().peers.length,2);assert.equal(other.getInfo().peers.length,1);
  const switcher=client('Guest');connect(switcher,server);connect(server,switcher);
  const oldSeat=await switcher.enter(second);const reserved=await switcher.voice.join(group,first,true);
  oldSeat.close();await flush();reserved.bind(e=>switcher.events.push(e)).sendChat('reached new channel');await flush();
  assert(a.events.some(e=>e.text==='reached new channel'));assert(!c.events.some(e=>e.text==='reached new channel'));
  reserved.close();await flush();
  const observer=await d.enter(first);await flush();
  one.close();await flush();
  assert.equal(two.getInfo().role,'host');
  assert.equal(observer.getInfo().role,'guest');
  assert(b.events.some(e=>e.type==='network-rejoined'));
  const elected=server.voice.rooms.get(group+'/'+first);
  server.voice.deliver(elected,elected.seats[1],'members',{members:[['host',b.me.id,oldProof]]});
  await flush();assert.equal(d.voice.contacts().host,undefined);
  assert(c.voice.local);
  denied.add(d.me.id);server.voice.reconcile();await flush();
  assert(d.events.some(e=>e.type==='closed'));assert.equal(two.getInfo().peers.length,1);
  assert.throws(()=>d.voice.join(group,first));
  // The former media host cannot resume using its old ticket.
  assert.throws(()=>one.sendChat('stale'));
});
