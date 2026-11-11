'use strict';
// Exercise the same native-picker command flow as Settings. Drives are owned
// temporary directories; low space and ENOSPC are injected, never filled disks.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {StorageLocation,BASENAME,LOCATOR}=require('../src/storage-location.cjs');

function fixture(t){
  const temp=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'link-storage-mistakes-')));
  t.after(()=>{assert.equal(path.dirname(temp),fs.realpathSync.native(os.tmpdir()));assert(path.basename(temp).startsWith('link-storage-mistakes-'));fs.rmSync(temp,{recursive:true,force:true});});
  const anchor=path.join(temp,'AppData','CRAFTCODE LINK'),downloads=path.join(temp,'Downloads'),installed=path.join(temp,'Programs','LINK');
  for(const p of [downloads,installed,path.join(temp,'drive-a'),path.join(temp,'drive-b')])fs.mkdirSync(p,{recursive:true});
  let pick=path.join(temp,'drive-a'),free=1024**3;
  const create=(extra={})=>new StorageLocation({anchor,downloads,installDirectory:installed,privateDirectory:()=>{},spaceAvailable:()=>free,
    dialog:{showOpenDialog:async()=>typeof pick==='function'?pick():{canceled:false,filePaths:[pick]}},...extra});
  const c=create();c.bootstrap();fs.writeFileSync(path.join(anchor,'identity.bin'),'identity fixture');fs.writeFileSync(path.join(anchor,'history.bin'),'history fixture');
  const intact=()=>{assert.equal(fs.readFileSync(path.join(anchor,'identity.bin'),'utf8'),'identity fixture');assert.equal(fs.readFileSync(path.join(anchor,'history.bin'),'utf8'),'history fixture');};
  return {temp,anchor,installed,create,c,intact,pick:value=>{pick=value;},free:value=>{free=value;}};
}
async function select(c){return (await c.command({op:'choose-location'})).selection.token;}
async function schedule(c){const token=await select(c);await c.command({op:'schedule-move',token});}

test('picker refuses a source subfolder and application resource folders',async t=>{
  const f=fixture(t),nested=path.join(f.anchor,'nested'),resources=path.join(f.installed,'resources','app');
  fs.mkdirSync(nested);fs.mkdirSync(resources,{recursive:true});
  for(const parent of [nested,resources]){
    f.pick(parent);await assert.rejects(f.c.command({op:'choose-location'}),/отдельную папку/);
    assert(!fs.existsSync(path.join(parent,BASENAME)));assert(!f.c.state.pending);f.intact();
  }
});

test('confirmation rechecks a destination changed after selection and preserves its new files',async t=>{
  const f=fixture(t),target=path.join(f.temp,'drive-a',BASENAME),token=await select(f.c);
  fs.mkdirSync(target);fs.writeFileSync(path.join(target,'other-user-notes.txt'),'do not overwrite');
  await assert.rejects(f.c.command({op:'schedule-move',token}),/содержит данные/);
  assert.equal(fs.readFileSync(path.join(target,'other-user-notes.txt'),'utf8'),'do not overwrite');
  assert(!f.c.state.pending);assert(!JSON.parse(fs.readFileSync(path.join(f.anchor,LOCATOR))).pending);f.intact();
});

test('the installation folder permits only the dedicated data child and never overwrites program files',async t=>{
  const f=fixture(t),executable=path.join(f.installed,'CRAFTCODE-LINK.exe');fs.writeFileSync(executable,'program fixture');
  f.pick(f.installed);const token=await select(f.c);
  assert.equal(f.c.selection.directory,path.join(f.installed,BASENAME));
  await f.c.command({op:'schedule-move',token});const moved=f.create();
  assert.equal(moved.bootstrap(),path.join(f.installed,BASENAME));
  assert.equal(fs.readFileSync(executable,'utf8'),'program fixture');
  assert.equal(fs.readFileSync(path.join(f.installed,BASENAME,'history.bin'),'utf8'),'history fixture');
});

test('concurrent picker, stale confirmation token and repeated confirmation never schedule twice',async t=>{
  const f=fixture(t);let resolvePicker;
  f.pick(()=>new Promise(resolve=>resolvePicker=resolve));const choosing=f.c.command({op:'choose-location'});
  await assert.rejects(f.c.command({op:'choose-location'}),/Дождитесь/);
  resolvePicker({canceled:false,filePaths:[path.join(f.temp,'drive-a')]});const old=(await choosing).selection.token;
  f.pick(path.join(f.temp,'drive-b'));const current=await select(f.c);
  await assert.rejects(f.c.command({op:'schedule-move',token:old}),/ещё раз/);assert(!f.c.state.pending);
  await f.c.command({op:'schedule-move',token:current});const pending=JSON.stringify(f.c.state.pending);
  await assert.rejects(f.c.command({op:'schedule-move',token:current}));assert.equal(JSON.stringify(f.c.state.pending),pending);
  await f.c.command({op:'cancel-move'});await assert.rejects(f.c.command({op:'schedule-move',token:current}));
  assert(!f.c.state.pending);f.intact();
});

test('a destination lost after scheduling opens the original profile with a recoverable error',async t=>{
  const f=fixture(t),parent=path.join(f.temp,'drive-a'),offline=path.join(f.temp,'offline-drive-a');await schedule(f.c);
  fs.renameSync(parent,offline);
  const restarted=f.create();assert.equal(restarted.bootstrap(),f.anchor);
  assert.match(restarted.snapshot().error,/недоступны/);assert(restarted.state.pending);f.intact();
  await restarted.command({op:'cancel-move'});assert(!restarted.state.pending);f.intact();
  fs.renameSync(offline,parent);await schedule(restarted);
  const next=f.create(),destination=path.join(parent,BASENAME);assert.equal(next.bootstrap(),destination);
  assert.equal(fs.readFileSync(path.join(destination,'history.bin'),'utf8'),'history fixture');
});

test('space is rechecked at confirmation and restart, keeping the original usable',async t=>{
  const f=fixture(t),token=await select(f.c);f.free(1);
  await assert.rejects(f.c.command({op:'schedule-move',token}),/недостаточно/);assert(!f.c.state.pending);f.intact();
  f.free(1024**3);await f.c.command({op:'schedule-move',token});f.free(1);
  const restarted=f.create();assert.equal(restarted.bootstrap(),f.anchor);assert.match(restarted.snapshot().error,/недостаточно/);f.intact();
  assert.deepEqual(fs.readdirSync(path.join(f.temp,'drive-a')),[]);
  f.free(1024**3);const next=f.create();assert.equal(next.bootstrap(),path.join(f.temp,'drive-a',BASENAME));
});

test('ENOSPC from copying preserves the source and allows cancel then a clean retry',async t=>{
  const f=fixture(t),payload=Buffer.alloc(1024*1024+31,83);fs.writeFileSync(path.join(f.anchor,'a-large.bin'),payload);await schedule(f.c);
  let written=0;
  const failed=f.create({fault:(event,progress)=>{
    if(event==='copy-progress'&&progress.path==='a-large.bin'){written=progress.bytes;throw Object.assign(Error('simulated disk full'),{code:'ENOSPC'});}
  }});
  assert.equal(failed.bootstrap(),f.anchor);assert.match(failed.snapshot().error,/недостаточно/);f.intact();
  assert(written>0&&written<payload.length,'the failure must interrupt a real partial file');
  const partial=failed.stage(failed.state.pending);assert(fs.existsSync(partial));
  await failed.command({op:'cancel-move'});assert(!failed.state.retainedStages?.length);assert(!fs.existsSync(partial));
  assert.deepEqual(fs.readFileSync(path.join(f.anchor,'a-large.bin')),payload);
  await schedule(failed);const final=f.create(),target=path.join(f.temp,'drive-a',BASENAME);
  assert.equal(final.bootstrap(),target);assert.equal(fs.readFileSync(path.join(target,'identity.bin'),'utf8'),'identity fixture');
  assert.deepEqual(fs.readFileSync(path.join(target,'a-large.bin')),payload);
});
