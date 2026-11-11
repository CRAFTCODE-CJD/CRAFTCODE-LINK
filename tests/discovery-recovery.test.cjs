'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DirectService}=require('../src/direct/service.cjs');
const {seed}=require('../src/direct/identity.cjs');
function fixture(make) {
  let profile={root:seed(),device:seed(),name:'Test',friends:[],lan:'',dht:true};
  return new DirectService({store:{read:()=>profile,write:p=>{profile=p;}},nics:()=>[],dhtFactory:make});
}
function dht(listen,announce) {
  const server={listening:true,relayAddresses:[],listen};
  return {createServer:()=>server, announce, destroy:async()=>{}, connect(){throw Error('no expected calls');}};
}
const replies=()=>({finished:async()=>{},closestNodes:[{}],destroy(){}});
test('failed internet listener is retired; a service tick retries the saved route after backoff',async t=>{
  let count=0;
  const s=fixture(()=>dht(async()=>{if(++count===1)throw Error('unavailable');},replies));
  t.after(()=>s.stop());
  s.start();await s.network.dhtAttempt;
  assert.equal(s.network.discovery,'retry');assert.equal(s.network.dht,null);
  s.tick();assert.equal(count,1);
  s.network.dhtDue=Date.now()-1;s.tick();await s.network.dhtAttempt;
  assert.equal(s.network.discovery,'ready');assert.equal(count,2);
});
test('empty discovery replies show a retry and preserve the listening endpoint on manual refresh',async t=>{
  let publications=0,nodes=0;
  const s=fixture(()=>{nodes++;return dht(async()=>{},()=>({...replies(),closestNodes:++publications===1?[]:[{}]}));});
  t.after(()=>s.stop());
  s.start();await s.network.dhtAttempt;
  assert.equal(s.network.discovery,'retry');
  s.refreshContacts();s.refreshContacts();await s.network.dhtAttempt;
  assert.equal(s.network.discovery,'ready');assert.equal(nodes,1);assert.equal(publications,2);
});
test('late DHT completion cannot make disabled discovery online or restart a signed-out profile',async t=>{
  let allow,count=0;
  const s=fixture(()=>{count++;return dht(()=>new Promise(r=>{allow=r;}),replies);});
  t.after(()=>s.stop());s.start();const old=s.network.dhtAttempt;
  await s.settings({dht:false});allow();await old;s.refreshContacts();
  assert.equal(s.network.discovery,'off');assert.equal(s.network.dht,null);assert.equal(count,1);
  s.paused=true;s.tick();assert.equal(count,1);
});
