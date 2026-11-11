'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {StorageLocation,BASENAME}=require('../src/storage-location.cjs');

function fixture(t){
  const temp=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'link-storage-security-')));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const anchor=path.join(temp,'AppData','CRAFTCODE LINK'),parent=path.join(temp,'destination'),downloads=path.join(temp,'Downloads');
  fs.mkdirSync(parent);fs.mkdirSync(downloads);
  const create=(fault,extra={})=>new StorageLocation({anchor,downloads,installDirectory:path.join(temp,'installed'),privateDirectory:()=>{},fault,
    dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[parent]})},...extra});
  const storage=create();storage.bootstrap();
  const relative=path.join('data','link-personal-chats-v1.sqlite'),source=path.join(anchor,relative),target=path.join(parent,BASENAME,relative);
  fs.mkdirSync(path.dirname(source));fs.writeFileSync(source,'synthetic encrypted chat fixture');
  return {temp,anchor,parent,downloads,create,storage,source,target};
}
async function schedule(f){
  const selected=await f.storage.command({op:'choose-location'});
  await f.storage.command({op:'schedule-move',token:selected.selection.token});
}

test('storage recovery retains the source when the committed copy is corrupted',async t=>{
  const f=fixture(t);await schedule(f);
  assert.throws(()=>f.create(point=>{if(point==='committed')throw Error('simulated interruption');}).bootstrap(),/simulated interruption/);
  assert.equal(fs.readFileSync(f.source,'utf8'),'synthetic encrypted chat fixture');
  fs.writeFileSync(f.target,'corrupted destination');
  assert.throws(()=>f.create().bootstrap());
  assert.equal(fs.readFileSync(f.source,'utf8'),'synthetic encrypted chat fixture','the good source must survive recovery failure');
});

test('storage recovery resumes after the path map was saved without modifying copied data',async t=>{
  const f=fixture(t);await schedule(f);
  assert.throws(()=>f.create(point=>{if(point==='mapped')throw Error('simulated interruption');}).bootstrap(),/simulated interruption/);
  assert.equal(fs.readFileSync(f.source,'utf8'),'synthetic encrypted chat fixture');
  assert.equal(f.create().bootstrap(),path.join(f.parent,BASENAME));
  assert.equal(fs.readFileSync(f.target,'utf8'),'synthetic encrypted chat fixture');
  assert.equal(fs.existsSync(f.source),false);
});

test('storage cleanup preserves source files changed or added after the copy',async t=>{
  const f=fixture(t);await schedule(f);
  assert.throws(()=>f.create(point=>{if(point==='committed')throw Error('simulated interruption');}).bootstrap());
  fs.writeFileSync(f.source,'new source content that must survive');
  const foreign=path.join(f.anchor,'added-after-copy.txt');fs.writeFileSync(foreign,'personal notes');
  const storage=f.create();storage.bootstrap();
  assert.equal(fs.readFileSync(f.source,'utf8'),'new source content that must survive');
  assert.equal(fs.readFileSync(foreign,'utf8'),'personal notes');
  assert.equal(fs.readFileSync(f.target,'utf8'),'synthetic encrypted chat fixture');
  assert.ok(storage.snapshot().error,'retained data must be disclosed');
});

test('storage selection rejects a junction instead of moving into its target',async t=>{
  const f=fixture(t),foreign=path.join(f.temp,'foreign');fs.mkdirSync(foreign);
  const sentinel=path.join(foreign,'personal-sentinel.txt');fs.writeFileSync(sentinel,'keep');
  fs.symlinkSync(foreign,path.join(f.parent,BASENAME),process.platform==='win32'?'junction':'dir');
  await assert.rejects(f.storage.command({op:'choose-location'}));
  assert.equal(fs.readFileSync(sentinel,'utf8'),'keep');
  assert.equal(fs.readFileSync(f.source,'utf8'),'synthetic encrypted chat fixture');
});

test('storage copy interruption preserves downloads and original profile data',async t=>{
  const f=fixture(t),download=path.join(f.downloads,'sent-file.webm');fs.writeFileSync(download,'user download');
  await schedule(f);
  const failed=f.create(point=>{if(point==='copied')throw Error('simulated disk failure');});
  assert.equal(failed.bootstrap(),f.anchor);
  assert.ok(failed.snapshot().error);
  assert.equal(fs.readFileSync(f.source,'utf8'),'synthetic encrypted chat fixture');
  assert.equal(fs.readFileSync(download,'utf8'),'user download');
  assert.equal(fs.existsSync(f.target),false);
});

test('partial-copy recovery retains deletion receipts while the source file is unavailable',async t=>{
  const f=fixture(t),bytes=Buffer.alloc(1024*1024,37);fs.writeFileSync(f.source,bytes);await schedule(f);
  const broken=f.create(point=>{if(point==='copy-progress')throw Error('simulated interrupted write');});
  assert.equal(broken.bootstrap(),f.anchor);
  const stage=broken.stage(broken.state.pending),journal=path.join(stage,'.craftcode-link-copy-v1');
  const receipt=fs.readdirSync(journal).find(name=>name!=='header.json');assert.ok(receipt);
  const receiptPath=path.join(journal,receipt),before=fs.readFileSync(receiptPath);
  const partial=path.join(stage,path.relative(f.anchor,f.source));assert.equal(fs.statSync(partial).size,512*1024);
  fs.renameSync(f.source,f.source+'.temporarily-unavailable');
  const unavailable=f.create();assert.equal(unavailable.bootstrap(),f.anchor);assert.ok(unavailable.snapshot().error);
  assert.deepEqual(fs.readFileSync(receiptPath),before,'source ENOENT cannot authorize discarding the partial-copy receipt');
  assert.equal(fs.statSync(partial).size,512*1024);
  fs.renameSync(f.source+'.temporarily-unavailable',f.source);
  assert.equal(f.create().bootstrap(),path.join(f.parent,BASENAME));
  assert.deepEqual(fs.readFileSync(f.target),bytes);assert.equal(fs.existsSync(stage),false);
});

test('relocated attachment paths reject redirected parents with either separator',t=>{
  const {FILE,createPathResolver}=require('../src/profile-relocations.cjs');
  const f=fixture(t),foreign=path.join(f.temp,'foreign');fs.mkdirSync(foreign);
  const sentinel=path.join(foreign,'personal-sentinel.txt');fs.writeFileSync(sentinel,'keep');
  fs.symlinkSync(foreign,path.join(f.anchor,'linked'),process.platform==='win32'?'junction':'dir');
  const old=path.join(f.temp,'previous','personal-sentinel.txt');
  for(const relative of ['linked/personal-sentinel.txt','linked\\personal-sentinel.txt']){
    fs.writeFileSync(path.join(f.anchor,FILE),JSON.stringify({version:1,product:'CRAFTCODE LINK',entries:[{from:old,relative,identity:'1/2/3'}]}));
    assert.throws(()=>createPathResolver(f.anchor)(old),/directory changed/,relative);
  }
  assert.equal(fs.readFileSync(sentinel,'utf8'),'keep');
});

test('maintenance appearing after the live owner guard prevents any migration', {skip:process.platform!=='win32'},async t=>{
  const f=fixture(t);await schedule(f);
  const maintenanceDirectory=path.dirname(f.anchor),maintenance=path.join(maintenanceDirectory,'.craftcode-link-maintenance-v1.json');
  let copied=0,guarded=0;
  const storage=f.create(point=>{if(point==='copied')copied++;},{guardOwner:true,maintenanceDirectory});
  const guard=storage.guard.bind(storage);
  storage.guard=()=>{
    guard();guarded++;
    fs.writeFileSync(maintenance,JSON.stringify({version:1,product:'CRAFTCODE LINK',pid:process.pid,
      startTime:storage.guardRecord.startTime,token:'11111111-1111-4111-8111-111111111111'}));
  };
  assert.throws(()=>storage.bootstrap(),/Обслуживание|maintenance/i);
  assert.equal(guarded,1,'the second check must run after the actual live process guard');
  assert.equal(copied,0);
  assert.equal(fs.existsSync(f.target),false);
  assert.equal(fs.readFileSync(f.source,'utf8'),'synthetic encrypted chat fixture');
});

test('an invalid maintenance marker blocks before creating any profile', {skip:process.platform!=='win32'},t=>{
  const f=fixture(t),maintenanceDirectory=path.join(f.temp,'another-AppData');fs.mkdirSync(maintenanceDirectory);
  const anchor=path.join(maintenanceDirectory,'CRAFTCODE LINK');
  fs.writeFileSync(path.join(maintenanceDirectory,'.craftcode-link-maintenance-v1.json'),'{}');
  const storage=f.create(undefined,{anchor,guardOwner:true,maintenanceDirectory});
  assert.throws(()=>storage.bootstrap());
  assert.equal(fs.existsSync(anchor),false);
});

test('fresh adjacent storage refuses occupied, foreign-owned and redirected destinations',async t=>{
  const {LOCATOR,MARKER}=require('../src/storage-location.cjs');
  for(const kind of ['occupied','foreign-owner','junction'])await t.test(kind,t=>{
    const f=fixture(t),anchor=path.join(f.temp,'fresh-AppData','CRAFTCODE LINK'),install=path.join(f.temp,'Program');
    fs.mkdirSync(install);const data=path.join(install,BASENAME),foreign=path.join(f.temp,'foreign');fs.mkdirSync(foreign);
    let preserved;
    if(kind==='junction'){
      preserved=path.join(foreign,'personal-notes.txt');fs.writeFileSync(preserved,'keep');
      fs.symlinkSync(foreign,data,process.platform==='win32'?'junction':'dir');
    }else{
      fs.mkdirSync(data);
      preserved=path.join(data,kind==='foreign-owner'?MARKER:'personal-notes.txt');
      fs.writeFileSync(preserved,kind==='foreign-owner'?JSON.stringify({version:1,product:'CRAFTCODE LINK',owner:'22222222-2222-4222-8222-222222222222'}):'keep');
    }
    const before=fs.readFileSync(preserved);
    const storage=f.create(undefined,{anchor,installDirectory:install,freshDirectory:data});
    assert.throws(()=>storage.bootstrap());
    assert.deepEqual(fs.readFileSync(preserved),before);
    assert.equal(fs.existsSync(path.join(anchor,LOCATOR)),false,'refusal cannot silently select an empty AppData profile');
  });
});

test('fresh adjacent retry keeps its owner and refuses files added after an ACL failure',t=>{
  const {LOCATOR,MARKER}=require('../src/storage-location.cjs');
  const f=fixture(t),anchor=path.join(f.temp,'fresh-AppData','CRAFTCODE LINK'),install=path.join(f.temp,'Program');
  fs.mkdirSync(install);const data=path.join(install,BASENAME);
  const options={anchor,installDirectory:install,freshDirectory:data};
  const first=f.create(undefined,{...options,privateDirectory:()=>{throw Object.assign(Error('synthetic ACL failure'),{code:'EACCES'});}});
  assert.throws(()=>first.bootstrap());
  const owner=JSON.parse(fs.readFileSync(path.join(anchor,MARKER),'utf8')).owner;
  assert.equal(JSON.parse(fs.readFileSync(path.join(data,MARKER),'utf8')).owner,owner);
  const added=path.join(data,'personal-notes.txt');fs.writeFileSync(added,'keep');
  assert.throws(()=>f.create(undefined,options).bootstrap());
  assert.equal(fs.readFileSync(added,'utf8'),'keep');
  assert.equal(fs.existsSync(path.join(anchor,LOCATOR)),false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(anchor,MARKER),'utf8')).owner,owner);
  fs.unlinkSync(added);
  assert.equal(f.create(undefined,options).bootstrap(),data);
  assert.equal(JSON.parse(fs.readFileSync(path.join(anchor,LOCATOR),'utf8')).owner,owner);
});

test('a damaged existing locator never falls back to fresh adjacent storage',t=>{
  const {LOCATOR}=require('../src/storage-location.cjs');
  const f=fixture(t),anchor=path.join(f.temp,'fresh-AppData','CRAFTCODE LINK'),install=path.join(f.temp,'Program');
  fs.mkdirSync(install);fs.mkdirSync(anchor,{recursive:true});
  fs.writeFileSync(path.join(anchor,LOCATOR),'{invalid existing location');
  const data=path.join(install,BASENAME),storage=f.create(undefined,{anchor,installDirectory:install,freshDirectory:data});
  assert.throws(()=>storage.bootstrap());
  assert.equal(fs.existsSync(data),false);
  assert.equal(fs.readFileSync(path.join(anchor,LOCATOR),'utf8'),'{invalid existing location');
});
