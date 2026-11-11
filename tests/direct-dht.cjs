// Product control protocol over real HyperDHT/Noise on a private loopback DHT.
// The fixture supplies the interface list; this cloud runner cannot observe OS interface events.
'use strict';
const {EventEmitter}=require('node:events'),assert=require('node:assert/strict');
const UDX=require('udx-native');
const addresses=[{name:'lo',family:4,host:'127.0.0.1',address:'127.0.0.1',internal:true}];
UDX.prototype.networkInterfaces=()=>addresses;
UDX.prototype.watchNetworkInterfaces=()=>Object.assign(new EventEmitter(),{interfaces:addresses,destroy(){}});
const testnet=require('hyperdht/testnet'),{DirectService}=require('../src/direct/service.cjs');
const {seed,ProfileStore}=require('../src/direct/identity.cjs');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const wait=async read=>{for(let i=0;i<600;i++){if(read())return;await new Promise(r=>setTimeout(r,90));}throw Error('DHT condition timed out: '+String(read));};
(async()=>{
 const net=await testnet(6),services=[];let profileDir;
 function make(p,ip,Service=DirectService,chatHistory){
   const service=new Service({store:{read:()=>p,write:n=>{p=n;},chatHistory},nics:()=>[],dhtFactory:()=>net.createNode({host:ip,firewalled:false})});
   services.push(service);service.start();return service;
 }
 const prof=name=>({name,root:seed(),device:seed(),friends:[],dht:true,lan:''});
 try{
   if(process.env.LINK_QA_LEGACY_SOURCE){
     const base=path.resolve(process.env.LINK_QA_LEGACY_SOURCE);
     assert.equal(require(path.join(base,'package.json')).version,'0.5.4');
     const legacy=require(path.join(base,'src/direct/identity.cjs'));
     const storage={encryptString:s=>Buffer.from(s),decryptString:b=>b.toString(),isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=>'test'};
     const profiles=[prof('First'),prof('Second')],cards=profiles.map(legacy.publicCard);
     profileDir=fs.mkdtempSync(path.join(os.tmpdir(),'link-upgrade-'));
     const pair=profiles.map((p,i)=>{
       const dir=path.join(profileDir,String(i));
       p.friends=[{...legacy.friend(cards[1-i],'friend'),favorite:true}];
       new legacy.ProfileStore(dir,storage).write(p);
       const current=new ProfileStore(dir,storage).read();
       assert.equal(current.root,p.root);assert.equal(current.device,p.device);assert.equal(current.dht,true);
       assert.equal(current.friends[0].favorite,true);
       return make(current,'127.0.0.'+(5+i));
     });
     await wait(()=>pair.every(s=>s.snapshot().friends[0].online&&s.snapshot().discovery==='ready'));
     pair[0].call(pair[1].me.id);await wait(()=>pair[1].pending);pair[1].reject();
     await Promise.all(pair.map(s=>s.stop()));
     console.log('PASS 0.5.4 profile files on both endpoints: keys, discovery opt-in, existing friendship, favorites, mutual presence and call on private DHT; OS key storage substituted.');
     const LegacyService=require(path.join(base,'src/direct/service.cjs')).DirectService;
     const history=new ProfileStore(path.join(profileDir,'mixed'),storage).chatHistory;
     const current=make(prof('Current'),'127.0.0.7',DirectService,history);
     const previous=make(prof('Previous'),'127.0.0.8',LegacyService);
     await wait(()=>current.network.server?.listening && previous.network.server?.listening);
     current.add(previous.card());await wait(()=>previous.requests.size);
     previous.answer(current.me.id,true);
     await wait(()=>current.snapshot().friends[0]?.state==='friend' && current.linksTo(previous.me.id).length);
     assert.equal(current.snapshot().friends[0].chat.supported,false);
     current.chats.send(previous.me.id,'queued for a compatible client');
     current.call(previous.me.id);await wait(()=>previous.pending);
     previous.reject();await wait(()=>!current.out);
     previous.call(current.me.id);await wait(()=>current.pending);
     current.reject();await wait(()=>!previous.out);
     assert.equal(current.chats.history(previous.me.id).messages[0].status,'pending');
     current.setPrivacy(current.me.id,{...current.snapshot().privacy,status:'invisible'});
     await wait(()=>!previous.snapshot().friends[0]?.online);
     previous.refreshContacts?.();previous.tick();
     assert(!current.network.dht && !current.network.nic && !current.linksTo(previous.me.id).length);
     current.setPrivacy(current.me.id,{...current.snapshot().privacy,status:'away'});
     await wait(()=>previous.snapshot().friends[0]?.online);
     await Promise.all([current.stop(),previous.stop()]);
     console.log('PASS mixed 0.5.4 and current service: mutual call and decline; invisible disconnects; returning restores reachability; private text remains locally pending.');
   }
   const a=make(prof('Anna'),'127.0.0.2'),b=make(prof('Boris'),'127.0.0.3');
   await wait(()=>a.network.server?.listening && b.network.server?.listening);
   a.add(b.card());await wait(()=>b.requests.size);b.answer(a.me.id,true);await wait(()=>a.contact(b.me.id)?.state==='friend');
   const old=b.profile;await b.stop();await wait(()=>!a.linksTo(b.me.id).length);
   // A restored device has a new key at a different address; the contact knows only the old key.
   const c=make({...old,device:seed()},'127.0.0.4');await wait(()=>c.network.server?.listening);
   await c.network.announce();a.nextLookup.clear();a.tick();
   await wait(()=>a.linksTo(c.me.id).some(l=>l.card.device===c.me.device));
   assert.equal(a.snapshot().friends.length,1);assert.equal(c.me.id,b.me.id);
   a.call(c.me.id);await wait(()=>c.pending);const id=c.pending.id;
   c.reject();await wait(()=>!a.out);assert(!c.pending);
   a.game.create('Match');a.game.invite(c.me.id);await wait(()=>c.game.invitations.size);
   c.game.answer(c.game.state().invitations[0].id,true);await wait(()=>!c.game.active.waiting&&a.game.active.roster.length===2);
   a.setPrivacy(a.me.id,{...a.snapshot().privacy,status:'invisible'});
   await wait(()=>!c.snapshot().friends[0].online);assert(!a.network.server&&!a.network.dht);
   c.game.chat('Match continues');await wait(()=>a.game.active.messages.some(m=>m.text==='Match continues'));
   c.game.leave();await wait(()=>!a.linksTo(c.me.id).length);
   console.log('PASS real private DHT: authenticated friendship, device change, ring and decline; invisible preserves current match messages over Noise and releases peer after leave',id.length);
 }finally{for(const s of services)await s.stop();await net.destroy();if(profileDir)fs.rmSync(profileDir,{force:true,recursive:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
