import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomText } from '../src/renderer/room-text.mjs';
import { readRelay } from '../src/renderer/relay-settings.mjs';
test('room backup keys are ephemeral, messages authenticate the direction, and duplicate ciphertext is ignored',async()=>{
  const id=crypto.randomUUID(),sent=[],reads=[];
  const a=new RoomText(id,'host',(peer,kind,fields)=>sent.push({peer,kind,...fields}),()=>{},()=>{});
  const b=new RoomText(id,'guest',(peer,kind,fields)=>sent.push({peer,kind,...fields}),(from,msg)=>reads.push(msg),()=>{});
  await a.hello('guest');await b.receive('host',sent.pop());await a.receive('guest',sent.pop());
  assert(a.ready('guest') && b.ready('host'));
  await a.write('guest',{from:'host',text:'проверка'});const packet=sent.pop();
  assert(!JSON.stringify(packet).includes('проверка'));await b.receive('host',packet);await b.receive('host',packet);
  assert.deepEqual(reads,[{from:'host',text:'проверка'}]);a.close();b.close();assert(!a.ready('guest'));
  await assert.rejects(a.write('guest',{text:'x'}));
});
test('only credentialed explicit TURN addresses are accepted for the temporary relay',()=>{
 assert.deepEqual(readRelay('turns:relay.example.org:443?transport=tcp','test','temporary'),{urls:'turns:relay.example.org:443?transport=tcp',username:'test',credential:'temporary'});
 for(const url of ['https://example.org','turns:relay.test:99001','turns:relay.test/?transport=tcp','turn:bad@relay.test','turns:relay.test?transport=udp'])assert.throws(()=>readRelay(url,'test','temporary'));
 assert.throws(()=>readRelay('turn:relay.test','',''));
});
