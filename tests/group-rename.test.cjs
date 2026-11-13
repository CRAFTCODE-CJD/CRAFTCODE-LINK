'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {Duplex}=require('node:stream'),{setTimeout:delay}=require('node:timers/promises');
const {DirectService}=require('../src/direct/service.cjs');
const {ProfileStore,seed,friend}=require('../src/direct/identity.cjs');
const M=require('../src/groups/model.cjs');
const storage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};

async function until(predicate,label){
  for(let i=0;i<300;i++){if(predicate())return;await delay(15);}
  throw Error('Timed out: '+label);
}
function connect(a,b){
  if(!a.contact(b.me.id))a.setFriend(friend(b.me,'friend'));
  if(!b.contact(a.me.id))b.setFriend(friend(a.me,'friend'));
  let x,y;const socket=get=>new Duplex({read(){},write(buf,_enc,cb){get().push(Buffer.from(buf));cb();}});
  x=socket(()=>y);y=socket(()=>x);x.on('error',()=>{});y.on('error',()=>{});x.on('close',()=>y.destroy());y.on('close',()=>x.destroy());
  const binding=seed();a.attach(x,'lan',binding,b.me.id,b.me.device);b.attach(y,'lan',binding,a.me.id,a.me.device);
}
const cmd=(service,op,args={})=>service.groups.command({op:'group-'+op,...(op==='rename'?{profileId:service.me.id}:{}),...args});

test('group names propagate from owner and administrator to members and invitations, persist across restarts, and respect live authority',async t=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'link-group-names-')),all=[];
  t.after(async()=>{await Promise.allSettled(all.map(s=>s.stop()));await fs.rm(base,{recursive:true,force:true,maxRetries:12,retryDelay:100});});
  function start(name){
    const store=new ProfileStore(path.join(base,name),storage);
    if(!store.read())store.write({root:seed(),device:seed(),name,friends:[],dht:false,lan:''});
    const s=new DirectService({store,nics:()=>[]});s.start();all.push(s);return s;
  }
  let owner=start('Owner'),admin=start('Admin');const member=start('Member'),invited=start('Invited');
  for(const s of [admin,member,invited])connect(owner,s);
  await until(()=>[admin,member,invited].every(s=>owner.groups.link(s.me.id)),'authenticated group links');
  const {id}=await cmd(owner,'create',{name:'Weekend'});
  for(const s of [admin,member,invited]){
    await cmd(owner,'invite',{id,person:s.me.id});
    await until(()=>s.groups.snapshot().invites.some(r=>r.id===id),'group invitation');
    if(s!==invited)await cmd(s,'answer',{id,accept:true});
  }
  await cmd(owner,'role',{id,person:admin.me.id,role:'admin'});
  await until(()=>admin.groups.records.get(id)?.view?.role==='admin','administrator role');
  const hasName=(s,name)=>s.groups.snapshot().items.find(r=>r.id===id)?.name===name;
  const invitationName=()=>invited.groups.snapshot().invites.find(r=>r.id===id)?.name;
  await cmd(owner,'rename',{id,name:'  Friday games  '});
  await until(()=>[owner,admin,member].every(s=>hasName(s,'Friday games'))&&invitationName()==='Friday games','owner name broadcast');
  for(const s of [owner,admin,member])assert.equal((await cmd(s,'open',{id})).name,'Friday games');
  await cmd(admin,'rename',{id,name:'Friends’ evening'});
  await until(()=>[owner,admin,member].every(s=>hasName(s,'Friends’ evening'))&&invitationName()==='Friends’ evening','administrator name broadcast');
  assert.equal(owner.groups.authority(id).name,'Friends’ evening');
  const invitation=invited.groups.records.get(id),ownerLink=invited.groups.link(owner.me.id);
  connect(member,invited);await until(()=>invited.groups.link(member.me.id),'second authenticated friend');
  const update={id,op:'invite',epoch:invitation.epoch,name:'Outdated',nameRevision:invitation.nameRevision-1};
  await invited.groups.receive(ownerLink,update);
  await invited.groups.receive(ownerLink,{...update,nameRevision:undefined});
  await invited.groups.receive(ownerLink,{...update,epoch:invitation.epoch+1,nameRevision:invitation.nameRevision+1});
  await invited.groups.receive(invited.groups.link(member.me.id),{...update,nameRevision:invitation.nameRevision+1});
  assert.equal(invited.groups.records.get(id),invitation,'stale or unpinned updates never rewrite the invitation');
  const unchanged=JSON.stringify(owner.groups.records.get(id));
  await assert.rejects(cmd(member,'rename',{id,name:'Unauthorized'}),/Нет доступа/);
  await assert.rejects(cmd(admin,'rename',{id,profileId:member.me.id,name:'Wrong profile'}),/Нет доступа/);
  await assert.rejects(admin.groups.request(id,'rename',{name:'Extra fields',owner:admin.me.id}),/Некорректная команда/);
  for(const name of ['', '   ', 'a'.repeat(61), 'a\nb', 'a\0b', 'a\u202eb', 'a\u2066b', 42, null])
    await assert.rejects(cmd(owner,'rename',{id,name}),/Некорректная команда/);
  assert.equal(JSON.stringify(owner.groups.records.get(id)),unchanged,'rejected updates do not touch the stored record');
  const put=owner.groups.store.put;
  owner.groups.store.put=()=>{throw Error('Simulated storage failure');};
  try{await assert.rejects(cmd(owner,'rename',{id,name:'Not saved'}),/storage failure/);}
  finally{owner.groups.store.put=put;}
  assert(hasName(owner,'Friends’ evening'));assert(hasName(member,'Friends’ evening'));

  const cached=admin.groups.records.get(id),legacy={...cached.view};delete legacy.renameVersion;
  M.validateView(legacy);
  admin.groups.records.set(id,{...cached,view:legacy});
  await assert.rejects(cmd(admin,'rename',{id,name:'Old server'}),/Обновите LINK/);
  admin.groups.records.set(id,cached);
  assert.throws(()=>M.validateView({...cached.view,renameVersion:2}),/Некорректная команда/);
  await cmd(owner,'rename',{id,name:'a'.repeat(60)});
  await until(()=>hasName(admin,'a'.repeat(60)),'maximum permitted name');
  await cmd(admin,'rename',{id,name:'Saturday friends'});
  await until(()=>hasName(member,'Saturday friends')&&invitationName()==='Saturday friends','final synchronized name');

  await owner.stop();await until(()=>!admin.groups.link(owner.me.id),'owner disconnected');
  await assert.rejects(cmd(admin,'rename',{id,name:'Offline edit'}),/Сервер группы недоступен/);
  assert.equal((await cmd(member,'open',{id})).name,'Saturday friends','offline group retains the last published name');
  owner=start('Owner');assert(hasName(owner,'Saturday friends'),'owner reloads its renamed sidebar entry');
  assert.equal(owner.groups.authority(id).name,'Saturday friends','owner reloads the same authoritative name');
  for(const s of [admin,member,invited])connect(owner,s);
  await until(()=>[admin,member,invited].every(s=>owner.groups.link(s.me.id)),'restored links');
  await cmd(invited,'answer',{id,accept:true});
  assert.equal((await cmd(invited,'open',{id})).name,'Saturday friends','late member sees the new name');
  await admin.stop();admin=start('Admin');assert(hasName(admin,'Saturday friends'),'member cache survives restart');connect(owner,admin);
  await until(()=>owner.groups.link(admin.me.id),'administrator reconnected');

  await cmd(owner,'transfer',{id,person:admin.me.id});
  await until(()=>admin.groups.snapshot().transfers.some(r=>r.id===id),'ownership transfer offer');
  await assert.rejects(cmd(owner,'rename',{id,name:'During transfer'}),/Идёт передача группы/);
  await assert.rejects(cmd(admin,'rename',{id,name:'During transfer'}),/Идёт передача группы/);
  await cmd(owner,'transfer-cancel',{id});
  await cmd(owner,'role',{id,person:admin.me.id,role:'member'});
  await assert.rejects(cmd(admin,'rename',{id,name:'After demotion'}),/Нет доступа/);
  assert(hasName(owner,'Saturday friends'));assert(hasName(member,'Saturday friends'));
});
