import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RoomMedia,trackIndex} from '../src/renderer/peer.mjs';
test('organizer drops incoming spectator tracks even when the guest ignores its UI and keeps sending',async t=>{
  const seen=[],forwarded=[],transceivers=Array.from({length:24},()=>({}));
  const pc={getTransceivers:()=>transceivers,close(){}};
  const m=new RoomMedia({session:{selfId:'host',role:'host'},sendSignal(){},onTrack:e=>seen.push(e),peerFactory:()=>pc});
  t.after(()=>m.close());m.peers=[{id:'host',slot:0},{id:'guest',slot:1}];
  m.forwardTrack=async(slot,role,track)=>forwarded.push([role,track]);
  const ep=m.createEndpoint('guest',1);m.watchBuffer.update=()=>{};
  await m.setRights(true);
  const track={readyState:'live',addEventListener(){}};
  for(const role of ['voice','screen','system'])ep.pc.ontrack({track,transceiver:transceivers[trackIndex(1,role)]});
  assert.equal(seen.length,0);assert.equal(forwarded.length,0);
  await m.setRights(true,'guest',true);assert.deepEqual(forwarded,[['voice',track]]);
  await m.setRights(true,'guest',false);assert.deepEqual(forwarded.at(-1),['voice',null]);
  assert.equal(m.getTrack(1,'system'),null);assert.equal(m.getTrack(1,'screen'),null);
});
