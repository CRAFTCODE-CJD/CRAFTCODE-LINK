import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {quickContacts,friendRooms,newestPeerVersion} from '../src/renderer/room-directory.mjs';
import {DirectService} from '../src/direct/service.cjs';

test('a personal call, including a legacy ring, never admits a caller to the active room',()=>{
  let room={role:'host',invite:'original-room',peers:[{},{}]};
  const sent=[];
  const service=new DirectService({store:{read:()=>({friends:[{id:'friend',state:'friend',devices:['pc']}]})},roomInfo:()=>room,busy:()=>!!room});
  const link={card:{id:'friend',device:'pc'},socket:{destroyed:false},send:m=>sent.push(m)};
  service.links.add(link);
  service.publishRoom=true;
  service.audience.mode='invite';
  const id=randomUUID();
  service.message(link,{kind:'ring',id,expires:Date.now()+20000,canJoin:true});
  assert.equal(service.pending.admit,null);
  assert.equal(service.pending.switchCall,true);
  assert.throws(()=>service.take(id));
  service.take(id,true);
  assert.deepEqual(sent.at(-1),{kind:'take',id});
  service.message(link,{kind:'cancel',id});
  assert.equal(service.pending,null);
  assert.equal(room.invite,'original-room');
  assert.equal(service.grants.size,0);

  room=null;
  service.call('friend');
  assert.equal(sent.at(-1).canJoin,false);
  service.message(link,{kind:'join-here',id:service.out.id,invite:'unexpected'});
  assert.equal(service.pending,null);
  assert.equal(service.out.peer,'friend');
  clearTimeout(service.dirty);
});

test('quick access keeps offline favorites and excludes requests; a peer version is a numeric hint',()=>{
 const items=[{id:'c',name:'C',state:'friend',online:true,versions:['0.10.0','5000.x.1']},{id:'a',name:'A',state:'friend',online:false,favorite:true,versions:['100.0.0']},{id:'b',name:'B',state:'invited',favorite:true,online:true,versions:['200.0.0']}];
 assert.deepEqual(quickContacts(items).map(c=>c.id),['a','c']);
 assert.equal(newestPeerVersion(items,'0.6.4'),'0.10.0');
 assert.equal(newestPeerVersion(items,'1.0.0'),'');
});
test('distinct devices can host separate rooms; hide the current room and private contacts',()=>{
 const common={id:'owner',name:'Alex',state:'friend',online:true,rooms:[{device:'one',door:'a',count:1},{device:'two',door:'b',count:8}]};
 const rooms=friendRooms([common,{...common,id:'blocked',state:'invited'}],true,{}, {hostPerson:'owner',hostDevice:'one'});
 assert.deepEqual(rooms.map(r=>[r.device,r.count,r.limit]),[['two',8,8]]);
});
test('private room summaries expire, never include an invitation and never become a call on stale join',()=>{
 const s=new DirectService({store:{read:()=>({friends:[{id:'friend',state:'friend',devices:['pc']}]})},roomInfo:()=>({role:'host',invite:'secret-code',peers:[{}]})});
 const messages=[],l={card:{id:'friend',device:'pc'},socket:{destroyed:false},send:m=>messages.push(m)};
 s.links.add(l);s.publishRoom=true;s.announceRooms();const summary=messages[0];
 assert.equal(summary.count,1);assert.equal(JSON.stringify(summary).includes('secret-code'),false);
 s.message(l,summary);assert.equal(s.roomsFor('friend')[0].count,1);
 s.message(l,{kind:'ring',id:summary.door,door:'invalid',canJoin:true});assert.equal(messages.at(-1).kind,'busy');assert.ok(!s.pending);
 s.lastRing.set('friend',Date.now());const beforeRetry=messages.length;
 s.message(l,{kind:'ring',id:summary.door,door:summary.door,canJoin:true,expires:Date.now()+30000});
 assert.equal(messages.length,beforeRetry+1);assert.equal(messages.at(-1).kind,'busy');assert.ok(!s.pending);
 l.remoteRoom.until=0;assert.deepEqual(s.roomsFor('friend'),[]);
 s.dnd=true;s.announceRooms();assert.equal(messages.at(-1).door,'');
 s.dnd=false;s.announceRooms();assert.notEqual(messages.at(-1).door,summary.door);
 s.publishRoom=false;s.announceRooms();assert.equal(messages.at(-1).door,'');
 s.profile.friends=[];s.message(l,summary);assert.equal(l.remoteRoom.until,0);clearTimeout(s.dirty);
});
