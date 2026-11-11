import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { InternetAccount, iceServices, jid } from '../src/renderer/internet-account.mjs';
import { InternetRoom } from '../src/renderer/internet-room.mjs';
import profile from '../src/friends/account-profile.cjs';

const ns='urn:xmpp:extdisco:2';
function service(type,host,options={}) {
  const data={type,host,...options};
  return {namespaceURI:ns,localName:'service',getAttribute:key=>data[key] || null};
}
test('only well-formed ICE services and authenticated TURN entries are offered',()=>{
  const entries=iceServices({children:[service('stun','stun.test'),service('turn','relay.test'),service('turn','relay.test',{port:'90000'}),
    service('turns','relay.test',{username:'a',password:'b'}),service('turn','relay/?bad'),service('bad','fake.test')]});
  assert.deepEqual(entries,[{urls:'stun:stun.test:3478'},{urls:'turns:relay.test:5349?transport=tcp',username:'a',credential:'b'}]);
});
test('account rejects unsupported login domain before requesting any socket',async()=>{
  const account=new InternetAccount({changed(){},resumed(){},packet(){},transport(){assert.fail('socket requested');}});
  await assert.rejects(account.login('a@unknown.invalid','test'));
  assert.equal(jid(' Anna@Server.test '),'anna@server.test');assert.equal(jid('a@b.test/machine'),'');
});
test('refusing unprotected credential storage leaves no password file',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'profile-qa-'));
  try {
    const store=new profile.AccountProfile(dir,{isEncryptionAvailable:()=>false});
    assert.throws(()=>store.save('a','private'));assert.deepEqual(fs.readdirSync(dir),[]);assert.equal(store.load(),null);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('room requires an approved contact, ignores stale tokens and validates participant slots',()=>{
  const trusted='alex@a.test',full=trusted+'/craftlink-123', sent=[];
  const r=new InternetRoom({account:{mutual:id=>id===trusted,send:(...args)=>sent.push(args)},event(){},changed(){},busy:()=>false,ring(){},accepted(){}});
  const invitation={version:1,kind:'ring',room:crypto.randomUUID(),token:crypto.randomUUID(),expires:Date.now()+30000};
  r.receive('stranger@a.test/craftlink-123',invitation);assert(!r.pending);
  r.receive(full,invitation);assert.equal(r.pending.token,invitation.token);
  r.receive(full,{...invitation,kind:'cancel',token:crypto.randomUUID()});assert(r.pending);
  r.decline();r.receive(full,invitation);assert(!r.pending);assert.equal(sent[0][1].kind,'decline');
  const id=crypto.randomUUID();assert(!r.validRoster([{id:'host',slot:0},{id,slot:0}],id));
  assert(r.validRoster([{id:'host',slot:0},{id,slot:1}],id));r.leave();
});

test('account codes bind the sender, device and room; strangers and unsolicited replies cannot enter',async()=>{
  const {parseRoomCode,roomCode}=await import('../src/renderer/room-code.mjs');
  const owner='host@a.test',device=crypto.randomUUID(),room=crypto.randomUUID(),full=owner+'/craftlink-'+device;
  const code=roomCode({id:owner,resource:'craftlink-'+device},room);
  const target=parseRoomCode(code);
  assert.deepEqual(target,{owner,full,room});assert.throws(()=>parseRoomCode(code+'/extra'));
  const sent=[];let mutual=false;
  const r=new InternetRoom({account:{id:'guest@a.test',mutual:()=>mutual,resources:new Map([[owner,new Set([full])]]),send:(...v)=>sent.push(v)},
    busy:()=>false,changed(){},ring(){assert.fail('unsolicited room response');}});
  assert.throws(()=>r.requestJoin(target),/друзья/);mutual=true;
  r.requestJoin(target);
  const token=r.joining.token;
  const ring={version:1,kind:'ring',room,token:crypto.randomUUID(),requestToken:token,expires:Date.now()+30000};
  r.receive(full,{...ring,room:crypto.randomUUID()});assert(!r.pending && r.joining);
  r.endJoin();r.receive(full,{...ring,token:crypto.randomUUID()});assert(!r.pending);
  r.quiet=()=>true;
  r.requestJoin(target);r.receive(full,{...ring,token:crypto.randomUUID(),requestToken:r.joining.token});
  assert.equal(r.pending.accepted,true);assert.equal(sent.at(-1)[1].kind,'accept');r.leave();
});
test('local display names are scoped to each account, bounded and safe to render',async()=>{
  const {profileName,cleanDisplayName}=await import('../src/renderer/profile-name.mjs');
  const names={'a@a.test':'Анна'};
  assert.equal(profileName('a@a.test',names,'Локально'),'Анна');
  assert.equal(profileName('b@a.test',names,'Локально'),'b');
  assert.equal(profileName('',names,'Локально'),'Локально');
  assert.equal(cleanDisplayName('  А\u202eБ\n '),'АБ');
  assert.equal(cleanDisplayName('Я'.repeat(60)).length,32);
});
test('established guest keeps the room across nine simulated hours offline while authenticated heartbeats arrive',t=>{
  let now=1000000,expired=0,controls=0;
  t.mock.method(Date,'now',()=>now);
  const room=new InternetRoom({account:{status:'reconnecting',mutual:id=>id==='alice@host.test',send(){assert.fail('XMPP is offline');}},
    event:e=>{if(e.type==='closed')expired++;},sendControl:()=>{controls++;return true;}});
  room.room={id:crypto.randomUUID(),role:'guest',selfId:crypto.randomUUID()};
  room.hostFull='alice@host.test/desktop'; room.lastHost=now;
  const packet={version:1,room:room.room.id,kind:'ping'};
  for(let step=0;step<9*360;step++){
    now+=10000; room.fromChannel('host',packet); room.monitor();
  }
  assert.equal(controls,9*360);assert.equal(expired,0);
  now+=121000; room.fromChannel('unknown',packet); room.fromChannel('host',{...packet,room:crypto.randomUUID()});
  room.monitor(); assert.equal(expired,1);
});
test('missed and busy calls each finish once and late packets cannot dismiss a later call',t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:80000});
  const id='pal@example.org',full=id+'/craftlink-device',sent=[],ends=[],notices=[];
  const r=new InternetRoom({account:{id:'me@example.org',full:()=>full,mutual:()=>true,send:(_,p)=>sent.push(p)},
    event:e=>ends.push(e),error:m=>notices.push(m),busy:()=>false,changed(){},ring(){},accepted(){}});
  r.host();r.invite(id);const first=sent.at(-1);
  t.mock.timers.tick(30000);assert.equal(ends.length,1);assert.match(ends[0].reason,/не ответил/);
  assert.equal(sent.at(-1).outcome,'timeout');assert.deepEqual(notices,[]);r.leave();
  r.host(true);r.invite(id);const next=sent.at(-1);
  r.receive(full,{...first,kind:'decline'});assert.equal(r.outgoing.token,next.token);
  r.receive(full,{...next,kind:'decline',outcome:'busy'});assert.equal(r.outgoing,null);
  assert.match(notices.at(-1),/занят/);assert.equal(ends.length,1);assert(r.room);r.leave();
  const incoming={version:1,kind:'ring',room:crypto.randomUUID(),token:crypto.randomUUID(),expires:Date.now()+1200};
  r.receive(full,incoming);t.mock.timers.tick(1200);assert.equal(r.pending,null);
  assert.equal(sent.at(-1).outcome,'timeout');assert.match(notices.at(-1),/Пропущенный/);
  r.receive(full,{...incoming,kind:'cancel'});assert.equal(notices.length,2);
});
test('a dismissed group invitation reports an unavailable host to the contact flow',()=>{
  const owner='anna@example.org',full=owner+'/craftlink-'+crypto.randomUUID(),room=crypto.randomUUID(),ends=[];
  const r=new InternetRoom({account:{id:'vera@example.org',mutual:()=>true,resources:new Map([[owner,new Set([full])]]),send(){}},
    busy:()=>false,changed(){},requestEnded:(reason,origin)=>ends.push({reason,origin})});
  r.requestJoin({owner,full,room},'contact');assert.equal(r.joining.origin,'contact');
  const token=r.joining.token;
  r.receive(full,{version:1,kind:'join-unavailable',room,token});
  assert.equal(ends[0].origin,'contact');assert.match(ends[0].reason,/закрыта|занята/);assert.equal(r.joining,null);
  r.receive(full,{version:1,kind:'join-unavailable',room,token});assert.equal(ends.length,1);
});

test('room-code entry requires approval, DND and remote cancellation leave current occupants connected',()=>{
  const sent=[],full='friend@test.local/craftlink-'+crypto.randomUUID();let quiet=false;
  const room=new InternetRoom({account:{id:'me@test.local',mutual:()=>true,send:(id,data)=>sent.push(data)},changed(){},busy:()=>false,quiet:()=>quiet,ring(){},event(){},error(){}});
  room.host(true);const roomId=room.room.id;
  const request=()=>({version:1,kind:'join-request',room:roomId,expires:Date.now()+29000,token:crypto.randomUUID()});
  const one=request();room.receive(full,one);assert.equal(room.pending.purpose,'entry');assert.equal(room.outgoing,undefined);
  room.decline();assert.equal(sent.at(-1).kind,'join-unavailable');room.receive(full,one);assert(!room.pending);
  quiet=true;room.receive(full,request());assert(!room.pending);quiet=false;
  const two=request();room.receive(full,two);room.receive(full,{...two,kind:'join-cancel'});assert(!room.pending);
  const three=request();room.receive(full,three);room.accept();assert.equal(sent.at(-1).requestToken,three.token);
  assert.equal(room.members.size,0);assert.equal(room.room.id,roomId);room.leave();
});
