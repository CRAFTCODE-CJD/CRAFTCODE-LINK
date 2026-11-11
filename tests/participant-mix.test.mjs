import test from 'node:test';
import assert from 'node:assert/strict';
import {participantMix} from '../src/renderer/participant-mix.mjs';
import {AudioMixer} from '../src/renderer/audio.mjs';

test('verified friends keep voice and stream across room roles and devices; unverified names stay local',()=>{
  const mixer=new AudioMixer(),calls=[];
  const state={roomEpoch:1,session:{direct:true,role:'host',selfId:'host',mixRoom:'one'},
    peers:[{id:'host'},{id:'a'},{id:'b'},{id:'c'}]};
  const friend={id:'person',name:'Same',state:'friend',mix:{voice:{volume:43,muted:true}}};
  const data={me:{id:'owner'},mixRoom:'one',roomContacts:{a:'person',b:'person'},friends:[friend]};
  const prefs=participantMix({state,mixer,snapshot:()=>data,save:async c=>calls.push(c),changed:()=>{},onError:assert.fail});
  mixer.setSetting('a','system',{active:false});
  prefs.sync();
  assert.deepEqual(mixer.getSetting('a','voice'),{volume:43,muted:true,active:true});
  assert.deepEqual(mixer.getSetting('b','voice'),mixer.getSetting('a','voice'));
  prefs.set('a','system',{volume:56},true);assert.equal(mixer.getSetting('b','system').volume,56);
  assert.equal(mixer.getSetting('a','system').active,false);
  assert.equal(calls.length,1);assert.equal(calls[0].person,'person');assert(!('active' in calls[0]));
  prefs.set('c','voice',{muted:true},true);assert.equal(calls.length,1);assert.equal(prefs.remembered('c'),false);
  state.roomEpoch++;state.peers=[{id:'self'},{id:'host'},{id:'r'}];
  state.session={direct:true,role:'guest',selfId:'self',hostId:'host',hostPerson:'person',mixRoom:'two'};
  data.roomContacts.r='person';prefs.sync();assert.equal(prefs.remembered('r'),false);
  assert.deepEqual(mixer.getSetting('host','voice'),{volume:43,muted:true,active:true});
  data.mixRoom='two';prefs.sync();assert.equal(prefs.remembered('r'),true);
  data.friends=[];prefs.sync();assert.equal(prefs.remembered('r'),false);
  assert.equal(mixer.getSetting('r','voice').muted,true);
});
