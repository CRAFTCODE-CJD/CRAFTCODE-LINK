'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const M=require('../src/groups/model.cjs'),{pack,unpack}=require('../src/groups/voice-directory.cjs');

test('voice channel sidebar only exposes visible channels and public seats from the authenticated membership revision',()=>{
  const person=(name,role)=>({id:randomBytes(32).toString('hex'),name,role});
  const owner=person('Owner','owner'),friend=person('Alex','member'),admin=person('Alex','admin');
  const group=M.create('Group',{...owner,device:randomBytes(32).toString('hex')});
  group.members.push(friend,admin);
  const first=group.channels[1].id,staff=randomUUID();
  group.channels.push({id:staff,name:'Staff',type:'voice',access:'staff',allow:[]});
  const seat=(p,muted,sharing)=>({person:p.id,device:randomUUID(),ticket:randomUUID(),publicSeat:randomUUID(),
    peer:{micMuted:muted,sharing}});
  const one=seat(owner,true,false),two=seat(admin,false,true);
  const room=(id,seats)=>({group:group.id,channel:id,epoch:group.epoch,seats});
  const voice={rooms:new Map([[first,room(first,[one])],[staff,room(staff,[two])]])};
  const wire=pack(group,friend.id,voice);
  assert.deepEqual(Object.keys(wire),[first]);
  assert(!JSON.stringify(wire).includes(one.device));assert(!JSON.stringify(wire).includes(one.ticket));
  const view=M.project(group,friend.id);
  assert.deepEqual(unpack(view,friend.id,wire)[first],[{id:owner.id,name:'Owner',seat:one.publicSeat,micMuted:true,sharing:false}]);
  const privileged=pack(group,owner.id,voice);
  assert.equal(unpack(group,owner.id,privileged)[staff][0].sharing,true);
  assert.equal(unpack(view,friend.id,privileged),null);
  assert.equal(unpack(view,friend.id,{[first]:[[128,one.publicSeat,0]]}),null);
  assert.equal(unpack(view,friend.id,{[first]:[...wire[first],...wire[first]]}),null);
});
