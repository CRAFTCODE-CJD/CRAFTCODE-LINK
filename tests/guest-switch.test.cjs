'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {startHost,joinHost}=require('../src/core/session.cjs');
const {decodeInvite,encodeInvite}=require('../src/core/invite.cjs');
const {GuestSwitch}=require('../src/core/guest-switch.cjs');
async function wait(until){for(let n=0;n<200;n++){if(until())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timeout');}
test('room switch authenticates the new TLS room and preserves the old conversation on failure or cancellation',async t=>{
  const opts={name:'Host',port:0,address:'127.0.0.1',bindAddress:'127.0.0.1'};
  const messages=[],original=await startHost({...opts,onEvent:e=>{if(e.type==='chat')messages.push(e.text);}});
  const target=await startHost(opts);
  const old=await joinHost({name:'Guest',invite:original.getInfo().invite});
  t.after(async()=>{await old.close();await original.close();await target.close();});
  const invite=target.getInfo().invite;
  const fake=encodeInvite({...decodeInvite(invite),fingerprint:'00'.repeat(32)});
  const wrong=new GuestSwitch({name:'Guest',invite:fake},Date.now()+10000);
  await assert.rejects(wrong.connect(),{code:'CERT_PIN_MISMATCH'});await wrong.close();
  old.sendChat('Original call alive');await wait(()=>messages.includes('Original call alive'));
  const cancelled=new GuestSwitch({name:'Guest',invite},Date.now()+10000);
  await cancelled.connect();await cancelled.close();assert(!cancelled.usable());
  old.sendChat('Cancelled');await wait(()=>messages.includes('Cancelled'));
  await wait(()=>target.getInfo().peers.length===1);
  const candidate=new GuestSwitch({name:'Guest',invite},Date.now()+10000);
  await candidate.connect();const id=candidate.room.getInfo().selfId;
  target.sendChat('Held during switch');await wait(()=>candidate.queue.some(e=>e.text==='Held during switch'));
  const events=[],active=candidate.adopt(e=>events.push(e));
  assert.equal(active.getInfo().selfId,id);assert.equal(target.getInfo().peers.length,2);
  assert(events.some(e=>e.text==='Held during switch'));await active.close();
});
