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
const turn=()=>new Promise(resolve=>setImmediate(resolve));
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
test('manual refresh replaces stuck peer queries and ignores their late results',async t=>{
  const queries=[],dialed=[];
  const s=fixture(()=>({...dht(async()=>{},replies),lookup(){
    let release;
    const waiting=new Promise(resolve=>{release=resolve;});
    const query={destroyed:false,release,destroy(){this.destroyed=true;},
      async *[Symbol.asyncIterator](){yield await waiting;}};
    queries.push(query);return query;
  }}));
  t.after(()=>s.stop());s.start();await s.network.dhtAttempt;
  s.network.dialDht=device=>dialed.push(device);
  for(let i=0;i<4;i++)s.setFriend({id:String(i+1).repeat(64),name:'Friend '+i,state:'friend',devices:[]});
  s.tick();assert.equal(queries.length,4);
  assert.equal(s.snapshot().lastContactRefresh,0);
  s.refreshContacts();const accepted=s.snapshot().lastContactRefresh;
  assert(accepted>0);s.refreshContacts();assert.equal(s.snapshot().lastContactRefresh,accepted);
  assert.equal(queries.length,8);assert(queries.slice(0,4).every(q=>q.destroyed));
  const result={peers:[{publicKey:Buffer.alloc(32,9)}]};
  for(const query of queries.slice(0,4))query.release(result);
  await turn();assert.deepEqual(dialed,[]);
  queries[4].release(result);await turn();assert.deepEqual(dialed,[Buffer.alloc(32,9).toString('hex')]);
  await s.settings({dht:false});assert(queries.slice(5).every(q=>q.destroyed));
  for(const query of queries.slice(5))query.release(result);
  await turn();assert.equal(dialed.length,1);
});
test('repeated empty publications replace an idle broken node but preserve a live Noise connection',async t=>{
  let nodes=0,destroyed=0;
  const s=fixture(()=>{
    const healthy=++nodes>1;
    return {...dht(async()=>{},()=>({...replies(),closestNodes:healthy?[{}]:[]})),destroy:async()=>{destroyed++;}};
  });
  t.after(()=>s.stop());s.start();await s.network.dhtAttempt;
  const live={contactRoute:'dht',destroyed:false};s.allSockets.add(live);
  try{
    await s.network.startDht(true);assert.equal(s.network.discovery,'retry');
    assert.equal(destroyed,0,'an authenticated stream must survive publication retries');
  }finally{s.allSockets.delete(live);}
  await s.network.startDht(true);assert.equal(destroyed,1);assert(!s.network.dht);
  s.refreshContacts();await s.network.dhtAttempt;assert.equal(nodes,2);assert.equal(s.network.discovery,'ready');
});
test('a peer lookup that never yields releases its slot after its deadline',async t=>{
  const {PassThrough}=require('node:stream');
  t.mock.timers.enable({apis:['setTimeout']});
  const network=fixture(()=>{}).network;
  const query=new PassThrough({objectMode:true});
  network.dht={lookup:()=>query};
  const read=network.lookup('pending',()=>assert.fail('empty query must not dial'));
  assert.equal(network.lookups.size,1);
  t.mock.timers.tick(35000);await read.catch(()=>{});
  assert(query.destroyed);assert.equal(network.lookups.size,0);
});
