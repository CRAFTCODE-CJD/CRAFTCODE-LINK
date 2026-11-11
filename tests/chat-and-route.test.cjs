'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PathCheck}=require('../src/game/path-check.cjs');
const {ShelfStorage}=require('../src/files/storage.cjs');
const {GameRoom}=require('../src/game/room.cjs');
const {setTimeout:delay}=require('node:timers/promises');
async function until(fn){for(let i=0;i<160;i++){if(fn())return;await delay(25);}assert.fail('Timed out');}
test('UDP challenge uses both real local sockets, identity, timeout, and releases its port',async t=>{
  const left='127.0.0.81',right='127.0.0.82';
  const peer=(addr,id)=>a=>a===addr?{ready:true,device:id}:undefined;
  const A=new PathCheck({changed(){},peer:peer(right,'B')}),B=new PathCheck({changed(){},peer:peer(left,'A')});
  t.after(()=>{A.close();B.close();});A.open(left);B.open(right);
  await until(()=>A.result.state==='idle'&&B.result.state==='idle');
  A.test(right);await until(()=>A.result.state==='ok');assert.equal(A.result.device,'B');
  B.close();A.test(right);await until(()=>A.result.state==='timeout');
  B.open(right);await until(()=>B.result.state==='idle');B.test(left);await until(()=>B.result.state==='ok');
});
test('a busy diagnostic port falls back, advertises its binding and exchanges real UDP in both directions',async t=>{
  const dgram=require('node:dgram'),{PORT}=require('../src/game/path-check.cjs');
  const left='127.0.0.83',right='127.0.0.84',locals={};
  const blocker=dgram.createSocket('udp4');
  await new Promise((resolve,reject)=>{blocker.once('error',reject);blocker.bind(PORT,right,resolve);});t.after(()=>blocker.close());
  const build=(self,other)=>new PathCheck({changed(){},onPort(port){locals[self]=port;},peer:address=>address===other?{ready:true,device:other,probePort:locals[other]}:null});
  const a=build(left,right),b=build(right,left);t.after(()=>{a.close();b.close();});
  a.open(left);b.open(right);await until(()=>a.result.state==='idle'&&b.result.state==='idle');
  assert.equal(locals[left],PORT);assert.notEqual(locals[right],PORT);
  a.test(right);b.test(left);await until(()=>a.result.state==='ok'&&b.result.state==='ok');
});
test('socket failure is reported with its cause and the next local check retries the bind without cycling the adapter',async t=>{
  const {EventEmitter}=require('node:events'),dgram=require('node:dgram');
  const left='127.0.0.85',right='127.0.0.86';
  let blocked=true;
  const a=new PathCheck({changed(){},peer:ip=>ip===right?{ready:true,device:'B'}:null,createSocket(){
    if(!blocked)return dgram.createSocket('udp4');
    const socket=new EventEmitter();
    socket.bind=()=>setImmediate(()=>socket.emit('error',Object.assign(Error(),{code:'EACCES'})));socket.close=()=>{};
    return socket;
  }});
  const b=new PathCheck({changed(){},peer:ip=>ip===left?{ready:true,device:'A'}:null});
  t.after(()=>{a.close();b.close();});a.open(left);b.open(right);
  await until(()=>a.result.state==='unavailable'&&b.result.state==='idle');
  assert.equal(a.result.code,'EACCES');blocked=false;a.test(right);await until(()=>a.result.state==='ok');
});
test('room media clips stay in bounded memory, verify type/hash, and cannot reveal a path or read arbitrary files',async()=>{
  const storage=new ShelfStorage('unused'),bytes=Buffer.from('1a45dfa381','hex');
  const clip=storage.clip('voice',bytes);assert.equal(clip.size,5);
  assert.deepEqual(await storage.readBytes(clip.id,0,5),bytes);
  assert.equal((await storage.preview(clip.id,clip)).type,'audio/webm');
  assert.throws(()=>storage.location(clip.id));assert.throws(()=>storage.location('../test'));
  await assert.rejects(storage.preview(clip.id,{...clip,sha:'0'.repeat(64)}));
  assert.throws(()=>storage.clip('voice',Buffer.from('other format')));
  await storage.remove(clip.id);await assert.rejects(storage.preview(clip.id,clip));
  await storage.close();assert.throws(()=>storage.clip('circle',bytes));
});
test('local previews need a matching extension and media signature',()=>{
  const {mediaType}=require('../src/files/chat-media.cjs');
  const ftyp=(brand)=>Buffer.concat([Buffer.from([0,0,0,16]),Buffer.from('ftyp'+brand+'0000')]);
  const ogg=Buffer.alloc(36);ogg.write('OggS');ogg[5]=2;ogg[26]=1;ogg[27]=8;ogg.write('OpusHead',28);
  const cases=[
    ['photo.GIF',Buffer.from('GIF89a'),'image/gif'],['photo.avif',ftyp('avif'),'image/avif'],
    ['clip.mp4',ftyp('mp42'),'video/mp4'],['music.m4a',ftyp('M4A '),'audio/mp4'],
    ['clip.webm',Buffer.from('1a45dfa3','hex'),'video/webm'],['audio.opus',ogg,'audio/ogg'],
    ['song.mp3',Buffer.from('fffb9064','hex'),'audio/mpeg'],['sound.wav',Buffer.from('RIFF0000WAVE'),'audio/wav'],
  ];
  for(const [name,bytes,type] of cases){
    assert.equal(mediaType(name,bytes),type);assert.equal(mediaType(name,Buffer.from('<svg onload="alert()"/>')),null);
  }
  const bad=ftyp('isom');bad.writeUInt32BE(2048);assert.equal(mediaType('f.mp4',bad),null);
  assert.equal(mediaType('photo.svg',Buffer.from('GIF89a')),null);
});
test('game return is limited to admitted device, same room, and capacity; private lobby and explicit removal revoke entry',()=>{
  const card=n=>({id:n.toString(16).padStart(64,'0'),device:(n+50).toString(16).padStart(64,'0'),name:'Test '+n});
  const host=card(1),guest=card(2),g=new GameRoom({self:()=>host,links:()=>[],changed(){},event(){},quiet:()=>false});
  g.create('Test',false);const id=g.active.id;assert.equal(g.listing(guest),null);
  g.receive(guest,{action:'leave',room:id});assert.equal(g.returnOffer(guest),null);
  g.seat(guest);g.receive(guest,{action:'leave',room:id});assert.equal(g.listing(guest).again,true);
  assert.equal(g.returnOffer({...guest,device:card(8).device}),null);
  for(let i=3;i<=18;i++)g.seat(card(i));g.receive(guest,{action:'return',room:id,ticket:randomUUID()});assert.equal(g.active.roster.length,17);
  g.remove(guest.id);assert.equal(g.listing(guest),null);
  g.leave();g.create('Next');assert.notEqual(g.active.id,id);assert.equal(g.listing(guest).again,false);
});

test('LAN chat attributes each message to a device and clearing a local prefix preserves later messages and the other copy',()=>{
  const member=n=>({id:String(n).padStart(64,'0'),device:String(n+10).padStart(64,'0'),name:'Player'});
  const a=member(1),b=member(2),out=[],links=()=>[];
  const host=new GameRoom({self:()=>a,links,changed(){},event(){},quiet:()=>false});
  const guest=new GameRoom({self:()=>b,links,changed(){},event(){},quiet:()=>false});
  host.create('Lobby');host.seat(b);
  const roster=host.state().room.roster,room=host.active.id;
  guest.active={id:room,owner:a,host:false,roster,messages:[],waiting:false};
  host.links=()=>[{card:b,send:m=>{out.push(m);return true;}}];
  host.receive(b,{room,action:'say',text:'Ready'});host.chat('Start');
  for(const packet of out)guest.receive(a,packet);
  const original=host.active.messages;
  assert.deepEqual(guest.active.messages.map(m=>m.device),[b.device,a.device]);
  guest.clearChat(randomUUID(),original[0].id);assert.equal(guest.active.messages.length,2);
  guest.clearChat(room,original[0].id);assert.deepEqual(guest.active.messages.map(m=>m.text),['Start']);
  assert.equal(original.length,2);
  guest.leave(false);guest.clearChat(undefined,original[1].id);
  assert.equal(guest.state().room,null);
});
