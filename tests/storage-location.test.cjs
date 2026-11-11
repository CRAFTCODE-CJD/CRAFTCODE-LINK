'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {StorageLocation,LOCATOR,MARKER,BASENAME,makePrivate}=require('../src/storage-location.cjs');
const {createPathResolver}=require('../src/profile-relocations.cjs');
const {ProfileStore,seed,publicCard,friend}=require('../src/direct/identity.cjs');
const privateStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString('utf8')};
function fixture(t){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'link-storage-'));
  const anchor=path.join(temp,'AppData','CRAFTCODE LINK'),downloads=path.join(temp,'Downloads');fs.mkdirSync(downloads);
  for(const name of ['drive-a','drive-b'])fs.mkdirSync(path.join(temp,name));
  let pick;
  const options={anchor,downloads,privateDirectory:()=>{},dialog:{showOpenDialog:async()=>pick?{canceled:false,filePaths:[pick]}:{canceled:true,filePaths:[]}}};
  const create=(extra={})=>new StorageLocation({...options,...extra});
  const c=create();c.bootstrap();
  t.after(()=>{assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));assert(path.basename(temp).startsWith('link-storage-'));fs.rmSync(temp,{recursive:true,force:true});});
  return {temp,anchor,downloads,create,c,pick:value=>{pick=value;}};
}
async function schedule(f,c=f.c,drive='drive-a'){
  f.pick(path.join(f.temp,drive));const result=await c.command({op:'choose-location'});
  await c.command({op:'schedule-move',token:result.selection.token});return path.join(f.temp,drive,BASENAME);
}
test('moves all profile data before opening stores, preserves encrypted queue and external attachments, and supports repeated moves',async t=>{
  const f=fixture(t),profile={root:seed(),device:seed(),name:'Storage fixture',friends:[]},contact=publicCard({root:seed(),device:seed(),name:'Friend'});
  profile.friends=[friend(contact,'friend')];const ps=new ProfileStore(f.anchor,privateStorage);ps.write(profile);
  const me=publicCard(profile),history=ps.chatHistory;history.open(me);
  fs.writeFileSync(path.join(f.anchor,'owned.webm'),'owned fixture');const original=path.join(f.downloads,'selected.txt');fs.writeFileSync(original,'external');
  const id=require('node:crypto').randomUUID(),epoch='fixture';
  history.enqueue(contact.id,epoch,id,'Pending file',{name:'owned.webm',size:13,sha:'a'.repeat(64)},{kind:'path',bytes:Buffer.from(path.join(f.anchor,'owned.webm'))});
  history.enqueue(contact.id,epoch,require('node:crypto').randomUUID(),'External file',{name:'selected.txt',size:8,sha:'b'.repeat(64)},{kind:'path',bytes:Buffer.from(original)});
  history.enqueue(contact.id,epoch,require('node:crypto').randomUUID(),'Voice',{name:'voice.webm',size:3,sha:'c'.repeat(64),clip:'voice'},{kind:'clip',bytes:Buffer.from([1,2,3])});history.close();
  fs.mkdirSync(path.join(f.anchor,'Local Storage'));fs.writeFileSync(path.join(f.anchor,'Local Storage','fixture'),'theme and microphone preferences');
  fs.writeFileSync(path.join(f.anchor,'SingletonLock'),'must stay');
  const database=fs.readFileSync(path.join(f.anchor,'link-personal-chats-v1.sqlite'));
  const target=await schedule(f),restart=f.create();assert.equal(restart.bootstrap(),target);
  assert.deepEqual(fs.readFileSync(path.join(target,'link-personal-chats-v1.sqlite')),database);
  assert.equal(fs.readFileSync(path.join(f.anchor,'SingletonLock'),'utf8'),'must stay');assert(!fs.existsSync(path.join(target,'SingletonLock')));
  const moved=new ProfileStore(target,privateStorage);assert.deepEqual(publicCard(moved.read()),me);moved.chatHistory.open(me);
  const rows=moved.chatHistory.page(contact.id,epoch).messages;
  assert.equal(rows.length,3);assert(rows.every(r=>r.status==='pending'));
  assert.equal(moved.chatHistory.attachmentData(rows[0].seq).bytes.toString(),path.join(target,'owned.webm'));
  assert.equal(moved.chatHistory.attachmentData(rows[1].seq).bytes.toString(),original);
  assert.deepEqual(moved.chatHistory.attachmentData(rows[2].seq).bytes,Buffer.from([1,2,3]));moved.chatHistory.close();
  assert(!fs.existsSync(path.join(f.anchor,'owned.webm')));assert.equal(fs.readFileSync(original,'utf8'),'external');
  const second=await schedule(f,restart,'drive-b'),next=f.create();assert.equal(next.bootstrap(),second);
  assert.equal(createPathResolver(second)(path.join(f.anchor,'owned.webm')).filename,path.join(second,'owned.webm'));
  assert.equal(createPathResolver(second)(path.join(target,'owned.webm')).filename,path.join(second,'owned.webm'));
  assert(!fs.existsSync(path.join(target,'owned.webm')));
});
test('failed copy preserves source, cancellation removes its verified stage and permits retry',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.anchor,'a.txt'),'a');fs.writeFileSync(path.join(f.anchor,'b.txt'),'b');
  await schedule(f);const broken=f.create({fault:event=>{if(event==='copied')throw Error('fixture full disk');}});assert.equal(broken.bootstrap(),f.anchor);
  assert.match(broken.snapshot().error,/Исходные данные сохранены/);assert.equal(fs.readFileSync(path.join(f.anchor,'a.txt'),'utf8'),'a');
  const stage=broken.stage(broken.state.pending);assert(fs.existsSync(stage));
  await broken.command({op:'cancel-move'});assert.deepEqual(broken.state.retainedStages||[],[]);assert(!fs.existsSync(stage));
  const target=await schedule(f,broken);const retry=f.create();assert.equal(retry.bootstrap(),target);assert.equal(fs.readFileSync(path.join(target,'b.txt'),'utf8'),'b');
});
test('cancel removes a proved partial prefix after interrupted fd copy',async t=>{
  const f=fixture(t),bytes=require('node:crypto').randomBytes(1024*1024+17);fs.mkdirSync(path.join(f.anchor,'media'));fs.writeFileSync(path.join(f.anchor,'media','video.bin'),bytes);
  await schedule(f);const broken=f.create({fault:event=>{if(event==='copy-progress')throw Error('copy interrupted');}});broken.bootstrap();const stage=broken.stage(broken.state.pending);
  assert.equal(fs.statSync(path.join(stage,'media','video.bin')).size,512*1024);await broken.command({op:'cancel-move'});
  assert(!fs.existsSync(stage));assert.deepEqual(fs.readFileSync(path.join(f.anchor,'media','video.bin')),bytes);
});
test('cancel preserves changed, replaced and unknown files in a partial stage',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.anchor,'payload.bin'),Buffer.alloc(1024*1024,7));await schedule(f);
  const broken=f.create({fault:event=>{if(event==='copy-progress')throw Error('copy interrupted');}});broken.bootstrap();const stage=broken.stage(broken.state.pending);
  fs.writeFileSync(path.join(stage,'payload.bin'),'user changed this file');fs.writeFileSync(path.join(stage,'unknown.txt'),'keep unknown');
  await broken.command({op:'cancel-move'});assert.deepEqual(broken.state.retainedStages,[stage]);
  assert.equal(fs.readFileSync(path.join(stage,'payload.bin'),'utf8'),'user changed this file');assert.equal(fs.readFileSync(path.join(stage,'unknown.txt'),'utf8'),'keep unknown');
});
test('a partial stage without a durable receipt remains explicitly accounted for',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.anchor,'payload.bin'),'data');await schedule(f);
  const broken=f.create({fault:event=>{if(event==='copied')throw Error('copy interrupted');}});broken.bootstrap();const stage=broken.stage(broken.state.pending);
  const records=path.join(stage,'.craftcode-link-copy-v1');for(const entry of fs.readdirSync(records))fs.unlinkSync(path.join(records,entry));fs.rmdirSync(records);
  await broken.command({op:'cancel-move'});assert.deepEqual(broken.state.retainedStages,[stage]);assert.equal(fs.readFileSync(path.join(stage,'payload.bin'),'utf8'),'data');
});
test('cancel keeps a replaced partial file and cannot use a modified source to prove its prefix',async t=>{
  for(const change of ['replaced-copy','changed-source']){
    const f=fixture(t);fs.writeFileSync(path.join(f.anchor,'payload.bin'),Buffer.alloc(1024*1024,7));await schedule(f);
    const broken=f.create({fault:event=>{if(event==='copy-progress')throw Error('copy interrupted');}});broken.bootstrap();const stage=broken.stage(broken.state.pending),copy=path.join(stage,'payload.bin');
    if(change==='replaced-copy'){fs.renameSync(copy,path.join(stage,'original-partial'));fs.writeFileSync(copy,Buffer.alloc(512*1024,7));}
    else fs.writeFileSync(path.join(f.anchor,'payload.bin'),Buffer.alloc(1024*1024,8));
    await broken.command({op:'cancel-move'});assert(fs.existsSync(copy));assert.deepEqual(broken.state.retainedStages,[stage]);
  }
});
test('cancel after a complete copy removes verified payload and completion metadata',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.anchor,'payload.bin'),'data');await schedule(f);
  const broken=f.create({fault:event=>{if(event==='copied-all')throw Error('copy interrupted');}});broken.bootstrap();const stage=broken.stage(broken.state.pending);
  await broken.command({op:'cancel-move'});assert(!fs.existsSync(stage));assert.equal(fs.readFileSync(path.join(f.anchor,'payload.bin'),'utf8'),'data');
});
test('retry cleans a verified partial stage before copying again',async t=>{
  const f=fixture(t),bytes=Buffer.alloc(1024*1024,3);fs.writeFileSync(path.join(f.anchor,'payload.bin'),bytes);const target=await schedule(f);
  const interrupted=f.create({fault:event=>{if(event==='copy-progress')throw Error('copy interrupted');}});assert.equal(interrupted.bootstrap(),f.anchor);
  const stage=interrupted.stage(interrupted.state.pending);assert(fs.existsSync(stage));
  assert.equal(f.create().bootstrap(),target);assert(!fs.existsSync(stage));assert.deepEqual(fs.readFileSync(path.join(target,'payload.bin')),bytes);
});
for(const phase of ['copied-all','promoted','committed','mapped'])test('recovers interruption at '+phase+' without losing source',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.anchor,'fixture'),'recover');const target=await schedule(f);
  const broken=f.create({fault:event=>{if(event===phase)throw Error('fixture interruption');}});
  if(['committed','mapped'].includes(phase))assert.throws(()=>broken.bootstrap(),/fixture interruption/);else broken.bootstrap();
  assert.equal(fs.readFileSync(path.join(f.anchor,'fixture'),'utf8'),'recover');
  const retry=f.create();assert.equal(retry.bootstrap(),target);assert.equal(fs.readFileSync(path.join(target,'fixture'),'utf8'),'recover');
  assert(!fs.existsSync(path.join(f.anchor,'fixture')));
});
test('committed but corrupt destination never causes deletion of the good source',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.anchor,'fixture'),'original');const target=await schedule(f);
  assert.throws(()=>f.create({fault:event=>{if(event==='committed')throw Error('fixture interruption');}}).bootstrap());
  fs.writeFileSync(path.join(target,'fixture'),'corrupt');assert.throws(()=>f.create().bootstrap());
  assert.equal(fs.readFileSync(path.join(f.anchor,'fixture'),'utf8'),'original');
});
test('selection and cancellation do not touch another folder, stale profiles and traversal are rejected',async t=>{
  const f=fixture(t);assert.deepEqual(await f.c.command({op:'choose-location'}),{cancelled:true});
  f.pick(f.anchor);await assert.rejects(f.c.command({op:'choose-location'}));
  f.pick(path.join(f.temp,'missing-volume'));await assert.rejects(f.c.command({op:'choose-location'}));
  const stale=path.join(f.temp,'drive-a',BASENAME);fs.mkdirSync(stale);fs.writeFileSync(path.join(stale,'unrelated.txt'),'retain');
  f.pick(path.dirname(stale));await assert.rejects(f.c.command({op:'choose-location'}));assert.equal(fs.readFileSync(path.join(stale,'unrelated.txt'),'utf8'),'retain');
  await assert.rejects(f.c.command({op:'schedule-move',token:require('node:crypto').randomUUID()}));
  const locator=JSON.parse(fs.readFileSync(path.join(f.anchor,LOCATOR)));locator.directory=f.temp;fs.writeFileSync(path.join(f.anchor,LOCATOR),JSON.stringify(locator));
  assert.throws(()=>f.create().bootstrap());
});
test('junction source/destination and a symbolic locator are rejected',async t=>{
  const f=fixture(t),other=path.join(f.temp,'unrelated');fs.mkdirSync(other);fs.writeFileSync(path.join(other,'keep'),'safe');
  fs.symlinkSync(other,path.join(f.anchor,'link'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(schedule(f));fs.unlinkSync(path.join(f.anchor,'link'));
  const dest=path.join(f.temp,'drive-a',BASENAME);fs.symlinkSync(other,dest,process.platform==='win32'?'junction':'dir');await assert.rejects(schedule(f));
  assert.equal(fs.readFileSync(path.join(other,'keep'),'utf8'),'safe');
});
test('download folder selection persists previous roots without moving user downloads',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.downloads,'keep'),'download');f.pick(path.join(f.temp,'drive-a'));
  const result=await f.c.command({op:'choose-downloads'});assert.equal(result.downloads,path.join(f.temp,'drive-a'));
  const again=f.create();again.bootstrap();assert.deepEqual(again.downloadRoots(),[path.join(f.temp,'drive-a'),f.downloads]);
  assert.equal(fs.readFileSync(path.join(f.downloads,'keep'),'utf8'),'download');
});
test('insufficient destination space refuses scheduling before any profile copy',async t=>{
  const f=fixture(t),small=f.create({spaceAvailable:()=>1});small.bootstrap();fs.writeFileSync(path.join(f.anchor,'fixture'),'preserve');
  await assert.rejects(schedule(f,small),/недостаточно/);assert(!small.state.pending);
  assert.equal(fs.readFileSync(path.join(f.anchor,'fixture'),'utf8'),'preserve');assert.deepEqual(fs.readdirSync(path.join(f.temp,'drive-a')),[]);
});
test('Windows private directory DACL can be applied before copying data',{skip:process.platform!=='win32'},t=>{
  const f=fixture(t);assert.doesNotThrow(()=>makePrivate(path.join(f.temp,'drive-a')));
});
test('fresh packaged installation keeps data beside program and only control records in AppData',t=>{
  const f=fixture(t),freshAnchor=path.join(f.temp,'fresh-anchor'),install=path.join(f.temp,'Program');fs.mkdirSync(install);
  const data=path.join(install,BASENAME),controller=new StorageLocation({anchor:freshAnchor,installDirectory:install,freshDirectory:data,downloads:f.downloads,privateDirectory:()=>{}});
  assert.equal(controller.bootstrap(),data);assert.deepEqual(fs.readdirSync(freshAnchor).sort(),[MARKER,LOCATOR].sort());
  fs.writeFileSync(path.join(data,'profile-fixture'),'identity');
  const again=new StorageLocation({anchor:freshAnchor,installDirectory:install,freshDirectory:data,downloads:f.downloads,privateDirectory:()=>{}});
  assert.equal(again.bootstrap(),data);assert.equal(fs.readFileSync(path.join(data,'profile-fixture'),'utf8'),'identity');
});
test('adjacent first-run ACL failure retries the same directory and never falls back to an empty AppData profile',t=>{
  const f=fixture(t),anchor=path.join(f.temp,'fresh-anchor'),install=path.join(f.temp,'Program');fs.mkdirSync(install);
  const data=path.join(install,BASENAME),options={anchor,installDirectory:install,freshDirectory:data,downloads:f.downloads};
  assert.throws(()=>new StorageLocation({...options,privateDirectory:()=>{const e=Error('readonly');e.code='EACCES';throw e;}}).bootstrap(),/Распакуйте LINK/);
  assert(!fs.existsSync(path.join(anchor,LOCATOR)));assert(fs.existsSync(path.join(anchor,MARKER)));assert(fs.existsSync(path.join(data,MARKER)));
  assert.equal(new StorageLocation({...options,privateDirectory:()=>{}}).bootstrap(),data);
});
test('legacy AppData and existing external locator take precedence over new adjacent default',async t=>{
  const f=fixture(t),install=path.join(f.temp,'Program');fs.mkdirSync(install);const freshDirectory=path.join(install,BASENAME);
  fs.unlinkSync(path.join(f.anchor,LOCATOR));fs.writeFileSync(path.join(f.anchor,'existing-profile'),'preserve');
  const legacy=f.create({installDirectory:install,freshDirectory});assert.equal(legacy.bootstrap(),f.anchor);assert(!fs.existsSync(freshDirectory));
  const external=await schedule(f,legacy);assert.equal(f.create({installDirectory:install,freshDirectory}).bootstrap(),external);assert(!fs.existsSync(freshDirectory));
});
test('Downloads validates its managed subdirectory, allows a sibling data disk and rejects the installation folder',async t=>{
  const f=fixture(t),install=path.join(f.temp,'Program');fs.mkdirSync(install);const chosen=await schedule(f),c=f.create({installDirectory:install});c.bootstrap();
  f.pick(path.dirname(chosen));await c.command({op:'choose-downloads'});assert.equal(c.downloads(),path.dirname(chosen));
  f.pick(install);await assert.rejects(c.command({op:'choose-downloads'}),/папки программы/);
});
