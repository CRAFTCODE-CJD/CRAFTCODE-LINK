'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {routingSeeds,readSeeds}=require('../src/direct/discovery-seeds.cjs');
const {ProfileStore,seed,seal,unseal}=require('../src/direct/identity.cjs');
const {DirectService}=require('../src/direct/service.cjs');

test('routing hints accept a small diverse set of public DHT endpoints and expire',()=>{
  const endpoints=['1.2.3.4','1.2.3.5','2.3.4.5','10.0.1.3','100.64.0.1','192.168.1.5',
    '127.0.0.1','224.0.0.2','169.254.1.2','198.51.100.10','localhost','::1'].map(host=>({host,port:49737}));
  const nodes=routingSeeds([...endpoints,{host:'8.8.8.8',port:53},{}]);
  assert.deepEqual(nodes,[endpoints[0],endpoints[2]]);
  assert.equal(routingSeeds(Array.from({length:32},(_,i)=>({host:'11.'+i+'.0.1',port:49737}))).length,6);
  const now=Date.now();
  assert.equal(readSeeds({time:now+1,nodes},now),undefined);
  assert.equal(readSeeds({time:now-7*86400000,nodes},now),undefined);
});

test('successful replies seed a fresh client, stay out of exports, and are forgotten when discovery is disabled',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'link-discovery-test-'));
  const storage={isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(text),decryptString:bytes=>bytes.toString()};
  const store=new ProfileStore(dir,storage);
  const options=[],nodes=[{host:'1.2.3.4',port:49737}];
  store.write({root:seed(),device:seed(),name:'Test',friends:[],lan:'',dht:true});
  const services=[];
  t.after(async()=>{for(const service of services)await service.stop();fs.rmSync(dir,{recursive:true,force:true});});
  function start(){
    const service=new DirectService({store,nics:()=>[],dhtFactory:opts=>{
      options.push(opts);
      return {createServer:()=>({listening:true,relayAddresses:[],listen:async()=>{}}),
        announce:()=>({finished:async()=>{},closestNodes:nodes}),destroy:async()=>{}};
    }});
    services.push(service);service.start();return service;
  }
  const first=start();await first.network.dhtAttempt;
  assert.deepEqual(options[0].nodes,[]);assert.deepEqual(store.read().discoverySeeds.nodes,nodes);
  await first.stop();services.splice(0,1);
  const next=start();await next.network.dhtAttempt;
  assert.deepEqual(options[1].nodes,nodes);
  assert.equal(options[1].bootstrap,undefined,'library bootstrap stays enabled');
  const password='test-transfer-secret';
  assert.equal((await unseal(await seal(next.profile,password),password)).discoverySeeds,undefined);
  await next.settings({dht:false});assert.equal(store.read().discoverySeeds,undefined);
  // At startup strict policy is applied before networking starts, via save().
  next.save({...next.profile,dht:false,discoverySeeds:{time:Date.now(),nodes}});
  assert.equal(next.profile.discoverySeeds,undefined);
  const disk=JSON.parse(storage.decryptString(fs.readFileSync(store.file)));
  assert.equal(disk.discoverySeeds,undefined,'disabled discovery must also erase the underlying record');
  await next.settings({dht:true});await next.network.dhtAttempt;
  assert.deepEqual(options.at(-1).nodes,[],'re-enabling cannot replay cached nodes erased by strict policy');
});

test('a late announcement cannot populate a new generation or a replacement profile',async t=>{
  const profile={root:seed(),device:seed(),name:'Previous',friends:[],lan:'',dht:true};
  const pending=[],writes=[];
  const service=new DirectService({store:{read:()=>profile,write:p=>writes.push(p)},nics:()=>[],dhtFactory:()=>({
    createServer:()=>({listening:true,relayAddresses:[],listen:async()=>{}}),
    announce:()=>({closestNodes:[{host:'1.2.3.4',port:49737}],destroy(){},
      finished:()=>new Promise(resolve=>pending.push(resolve))}),destroy:async()=>{}
  })});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  t.after(()=>service.stop());service.start();await settle();
  assert.equal(pending.length,1);await service.settings({dht:false});
  await service.settings({dht:true});await settle();assert.equal(pending.length,2);
  pending[0]();await settle();assert(!service.profile.discoverySeeds);
  service.save({...profile,root:seed(),device:seed(),name:'Replacement'});
  pending[1]();await service.network.dhtAttempt;
  assert(!service.profile.discoverySeeds);assert(writes.every(p=>!p.discoverySeeds));
});
