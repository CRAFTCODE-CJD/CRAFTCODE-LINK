'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Duplex}=require('node:stream'),{DirectService}=require('../src/direct/service.cjs');
const {ProfileStore,seed,friend}=require('../src/direct/identity.cjs'),{GroupFiles}=require('../src/groups/files.cjs');
const {setTimeout:delay}=require('node:timers/promises');
const storage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
test('a transferred profile gets a fresh device and local reset removes hosted group data while preserving saved downloads',async t=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'link-group-reset-'));
  const local=path.join(base,'old'),second=path.join(base,'other'),downloads=path.join(base,'Downloads');
  const original=new ProfileStore(local,storage),copy=new ProfileStore(second,storage);
  const bytes=crypto.randomBytes(190),filename=path.join(downloads,'notes.txt');
  await fs.mkdir(downloads);await fs.writeFile(filename,bytes);
  original.write({root:seed(),device:seed(),name:'Owner',friends:[],dht:false,lan:''});
  const host=new DirectService({store:original,nics:()=>[]}),imported=new DirectService({store:copy,nics:()=>[]});
  host.groups.files=new GroupFiles(host.groups,{directory:local,choose:async()=>filename,downloads:()=>downloads,reveal:()=>{}});
  t.after(async()=>{await Promise.allSettled([host.stop(),imported.stop()]);await fs.rm(base,{recursive:true,force:true,maxRetries:12,retryDelay:100});});
  host.start();const {id}=await host.groups.command({op:'group-create',name:'Group'});
  const channel=host.groups.authority(id).channels.find(c=>c.type==='text').id;
  await host.groups.files.command('offer',{group:id,channel});
  const [{file}]=host.groups.authority(id).messages[channel];await host.groups.files.blobs.verify(id,file);
  const pass='private local migration test';await imported.import(await host.export(pass),pass);
  assert.equal(imported.me.id,host.me.id);assert.notEqual(imported.me.device,host.me.device);
  assert.deepEqual(imported.groups.snapshot().items,[]);assert(!imported.groups.authority(id));
  // A copied group DB is pinned to the original certified device as well.
  await host.stop();await imported.stop();
  await fs.copyFile(path.join(local,'link-groups-v1.sqlite'),path.join(second,'link-groups-v1.sqlite'));
  imported.start();assert.deepEqual(imported.groups.snapshot().items,[]);assert(!imported.groups.authority(id));
  original.erase();assert.equal(original.read(),null);
  assert(!(await fs.readdir(local)).some(name=>name.startsWith('group-files-v1')||name.startsWith('link-groups-v1.sqlite')));
  assert.equal(copy.read().root,imported.profile.root);assert((await fs.readFile(filename)).equals(bytes));
});
async function until(fn,why){
  for(let i=0;i<300;i++){if(fn())return;await delay(15);}
  throw Error('Timed out: '+why);
}
test('group ACL, channel history, exact attachment bytes and crash recovery of a two-device ownership handoff',async t=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'link-groups-')),all=[];
  const bytes=crypto.randomBytes(53121),file=path.join(base,'notes.bin');await fs.writeFile(file,bytes);
  t.after(async()=>{await Promise.allSettled(all.map(s=>s.stop()));await fs.rm(base,{recursive:true,force:true,maxRetries:12,retryDelay:100});});
  function start(name){
    const dir=path.join(base,name),store=new ProfileStore(dir,storage);
    if(!store.read())store.write({root:seed(),device:seed(),name,friends:[],dht:false,lan:''});
    const s=new DirectService({store,nics:()=>[]});
    s.groups.files=new GroupFiles(s.groups,{directory:dir,choose:async()=>file,downloads:()=>path.join(dir,'downloads'),reveal:()=>{}});
    s.start();all.push(s);return s;
  }
  function connect(a,b){
    if(!a.contact(b.me.id))a.setFriend(friend(b.me,'friend'));
    if(!b.contact(a.me.id))b.setFriend(friend(a.me,'friend'));
    let x,y;const socket=get=>new Duplex({read(){},write(buf,_enc,cb){get().push(Buffer.from(buf));cb();}});
    x=socket(()=>y);y=socket(()=>x);x.on('error',()=>{});y.on('error',()=>{});x.on('close',()=>y.destroy());y.on('close',()=>x.destroy());
    const binding=seed();a.attach(x,'lan',binding,b.me.id,b.me.device);b.attach(y,'lan',binding,a.me.id,a.me.device);
  }
  let a=start('Alice'),b=start('Boris'),c=start('Carol');
  connect(a,b);connect(a,c);await until(()=>a.groups.link(b.me.id)&&a.groups.link(c.me.id),'capabilities');
  const cmd=(s,op,args={})=>s.groups.command({op:'group-'+op,...(op==='appearance'?{profileId:s.me.id}:{}),...args});
  const {id}=await cmd(a,'create',{name:'Evening games'}),args={id};
  for(const s of [b,c]){
    await cmd(a,'invite',{id,person:s.me.id});await until(()=>s.groups.snapshot().invites.length,'invitation');
    await cmd(s,'answer',{id,accept:true});
  }
  const initial=await cmd(c,'open',args),channel=initial.channels.find(ch=>ch.type==='text').id;
  const shared=person=>({person,profileId:c.me.id});
  assert.deepEqual(await cmd(c,'shared-with',shared(a.me.id)),[{id,name:'Evening games'}]);
  await assert.rejects(cmd(c,'shared-with',shared(b.me.id)));
  await assert.rejects(cmd(c,'shared-with',{person:a.me.id,profileId:b.me.id}));
  assert.equal(initial.theme,'personal','groups stored without appearance inherit the local theme');
  const avatar=crypto.randomBytes(48*48*3).toString('base64');
  await assert.rejects(cmd(a,'appearance',{id,theme:'dusk',profileId:b.me.id}));
  await assert.rejects(cmd(c,'appearance',{id,theme:'light',avatar}));
  await assert.rejects(cmd(a,'appearance',{id,theme:'light',avatar:'file:///not-an-image'}));
  await assert.rejects(cmd(a,'appearance',{id,theme:'url(https://example.org)'}));
  assert.equal((await cmd(a,'open',args)).theme,'personal','invalid combined edit is atomic');
  await cmd(a,'appearance',{id,theme:'dusk',avatar});
  await until(()=>[b,c].every(s=>s.groups.snapshot().items[0]?.avatar===avatar),'both participants cached the exact avatar');
  const legacy=a.groups.localView(a.groups.records.get(id),c.me.id,{groupAppearance:false});
  assert(!('avatarKey' in legacy)&&!('theme' in legacy)&&!('appearanceVersion' in legacy));
  assert.deepEqual(await cmd(c,'shared-with',shared(a.me.id)),[{id,name:'Evening games',avatar}]);
  const {id:privateRoom}=await cmd(a,'channel-create',{id,type:'voice',name:'Organizers',access:'staff'});
  assert(!(await cmd(c,'open',args)).channels.some(ch=>ch.id===privateRoom));
  assert(!a.groups.voiceAccess(id,privateRoom,c.me.id));
  await assert.rejects(cmd(c,'channel-rename',{id,channel,name:'Wrong'}));
  await cmd(a,'role',{id,person:b.me.id,role:'admin'});
  await cmd(b,'appearance',{id,theme:'forest'});
  assert.equal((await cmd(c,'open',args)).avatar,avatar,'changing the theme preserves the photo');
  assert(b.groups.voiceAccess(id,privateRoom,b.me.id));
  const nonce=crypto.randomUUID();await cmd(c,'send',{id,channel,nonce,text:'Meet at eight'});
  await cmd(c,'send',{id,channel,nonce,text:'Meet at eight'});
  assert.equal((await cmd(b,'history',{id,channel})).messages.length,1);
  await a.groups.files.command('offer',{group:id,channel});
  const attachment=(await cmd(c,'history',{id,channel})).messages.find(row=>row.file).file;
  assert.equal(attachment.sha,crypto.createHash('sha256').update(bytes).digest('hex'));
  await cmd(a,'transfer',{id,person:b.me.id});
  await until(()=>b.groups.snapshot().transfers.length,'handoff consent');
  await assert.rejects(cmd(b,'transfer-answer',{id,accept:true}),/Carol/);
  await assert.rejects(cmd(c,'send',{id,channel,nonce:crypto.randomUUID(),text:'during handoff'}));
  connect(b,c);await until(()=>b.groups.link(c.me.id),'all members connected to successor');
  let blockedCommit=false;
  const oldSend=a.groups.send.bind(a.groups);a.groups.send=(l,op,data)=>{
    if(op==='handoff-commit'){blockedCommit=true;return true;}
    return oldSend(l,op,data);
  };
  await cmd(b,'transfer-answer',{id,accept:true});
  await until(()=>blockedCommit,'durable fence');
  assert(!a.groups.authority(id));assert(!b.groups.authority(id));
  await Promise.all([a.stop(),b.stop()]);
  a=start('Alice');b=start('Boris');connect(a,b);connect(a,c);connect(b,c);
  await until(()=>b.groups.authority(id)&&!a.groups.records.get(id)?.move,'owner activation after both restart');
  assert(!a.groups.authority(id));assert.equal(b.groups.authority(id).epoch,2);
  await until(()=>c.groups.host(id)?.owner===b.me.id,'signed routing change');
  const history=await cmd(c,'history',{id,channel});assert.equal(history.messages.length,2);
  for(const s of [a,b,c]){
    const view=await cmd(s,'open',args);assert.equal(view.theme,'forest');assert.equal(view.avatar,avatar);
  }
  await cmd(b,'appearance',{id,avatar:null});
  await until(()=>[a,b,c].every(s=>!s.groups.snapshot().items[0].avatar),'removed photo is evicted from all group views');
  const downloaded=await b.groups.files.blobs.read(id,attachment,0);
  assert(downloaded.equals(bytes.subarray(0,downloaded.length)));
  await b.groups.files.blobs.verify(id,attachment);
  await cmd(b,'ban',{id,person:c.me.id});await until(()=>!c.groups.host(id),'revoked membership');
  assert.deepEqual(await cmd(c,'shared-with',shared(a.me.id)),[]);
  assert(!b.groups.voiceAccess(id,privateRoom,c.me.id));
  await assert.rejects(cmd(b,'invite',{id,person:c.me.id}));
  await cmd(a,'clear',{id,channel});assert.deepEqual((await cmd(b,'history',{id,channel})).messages,[]);
});
