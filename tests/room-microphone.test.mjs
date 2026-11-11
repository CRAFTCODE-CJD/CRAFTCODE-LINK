import assert from 'node:assert/strict';
import test from 'node:test';
import {RoomMicrophoneChoice} from '../src/renderer/room-microphone.mjs';

test('only a local entry consumes the current profile’s explicit saved microphone choice', () => {
  const values = new Map(), storage = {
    getItem:key => values.get(key), setItem:(key,value) => values.set(key,value), removeItem:key => values.delete(key),
  };
  let owner='link/alice', now=100;
  const choice = new RoomMicrophoneChoice(storage, () => owner, () => now);
  const room = {rightsKnown:true, closed:false, isHost:false, moderated:false, selfSlot:1, allowed:() => true};
  assert.equal(choice.read(),'muted');
  choice.begin();assert.equal(choice.take(room),false);
  choice.write('on');assert.equal(choice.take(room),false);
  choice.begin();assert.equal(choice.take({...room,rightsKnown:false}),false);
  assert.equal(choice.take(room),true);assert.equal(choice.take(room),false);
  choice.begin();assert.equal(choice.take({...room,moderated:true}),false);
  assert.equal(choice.take(room),false,'lifting moderation cannot activate a device');
  choice.begin();assert.equal(choice.take({...room,allowed:()=>false}),false);
  choice.begin();now+=30001;assert.equal(choice.take(room),false);
  choice.begin();owner='jabber/alice';assert.equal(choice.read(),'muted');assert.equal(choice.take(room),false);
  owner='link/alice';choice.begin();choice.write(null);assert.equal(choice.take(room),false);
  assert.equal(new RoomMicrophoneChoice(storage,()=>owner).read(),null,'an explicit opt-out survives a restart');
  choice.write('muted');const restored=new RoomMicrophoneChoice(storage,()=>owner);
  assert.equal(restored.read(),'muted');restored.begin();assert.equal(restored.take(room),false);
  owner=null;restored.write('on');restored.begin();assert.equal(restored.take(room),false);
  restored.reconnect(true);assert.equal(restored.take({...room,moderated:true}),false);
  assert.equal(restored.take(room),false);
  owner='link/alice';choice.write('on');
  storage.setItem=()=>{throw Error('QuotaExceededError');};
  assert.throws(()=>choice.write('muted'),/QuotaExceededError/);
  assert.equal(choice.read(),'muted','failure to save a manual mute clears the old permission');
});
