'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {measure,createStorageControls}=require('../src/storage-controls.cjs');
const {UpdateService}=require('../src/update-service.cjs');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'link-storage-controls-'));t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('link-storage-controls-'));return fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return root;}

test('Storage measurement never counts Downloads or traverses redirected cache',async t=>{
  const root=await fixture(t),profile=path.join(root,'profile'),outside=path.join(root,'Downloads');
  await fs.mkdir(profile);await fs.mkdir(outside);await fs.mkdir(path.join(profile,'Cache'));
  await fs.writeFile(path.join(profile,'history.db'),Buffer.alloc(23));await fs.writeFile(path.join(profile,'Cache','safe'),Buffer.alloc(11));
  await fs.writeFile(path.join(outside,'keep'),Buffer.alloc(999));
  await fs.symlink(outside,path.join(profile,'GPUCache'),process.platform==='win32'?'junction':'dir');
  const value=await measure(profile);assert.equal(value.bytes,34);assert.equal(value.cacheBytes,11);assert.equal(value.incomplete,true);assert.ok(value.free>0);
  assert.equal((await fs.stat(path.join(outside,'keep'))).size,999);
});

test('Cache cleanup selects only native cache APIs, serializes work, and blocks active-session restart',async t=>{
  const directory=await fixture(t),calls=[];let release;
  const location={snapshot:()=>({directory,pending:{directory:'target'},downloads:'downloads'}),command:()=>assert.fail('Unexpected location change')};
  const session={clearData:async value=>{calls.push(value);await new Promise(resolve=>release=resolve);},clearCodeCaches:async value=>calls.push(value)};
  const controller=createStorageControls({location,session:()=>session,updates:{clearCache:async()=>calls.push('updates')},sessionActive:()=>true,restart:()=>assert.fail('Unsafe restart')});
  await assert.rejects(controller.command({op:'clear-cache',directory:'arbitrary'}));
  const cleaning=controller.command({op:'clear-cache'});
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(controller.command({op:'choose-location'}));release();
  const done=await cleaning;assert.equal(done.freed,0);
  assert.deepEqual(calls,['updates',{dataTypes:['cache']},{}]);
  await assert.rejects(controller.command({op:'restart'}));
  assert.equal((await controller.command({op:'state'})).directory,directory);
});

test('Clearing update cache invalidates a staged installer and excludes concurrent check or install',async t=>{
  const directory=await fixture(t);let release;
  const hub=new UpdateService({directory,cache:directory,current:'0.1.0',allowed:()=>true,supported:true,scheduled:false,changed:()=>{},install:()=>assert.fail('Unexpected install')});
  t.after(()=>hub.close());hub.staged=path.join(directory,'install-abcdef','setup.exe');hub.phase='ready';hub.release={version:'0.2.0',size:5};
  const cleaning=hub.clearCache(()=>new Promise(resolve=>release=resolve));
  await assert.rejects(hub.command({op:'install'}));assert.throws(()=>hub.start('checking'));
  release();await cleaning;assert.equal(hub.staged,null);assert.equal(hub.phase,'available');
  hub.operation=new AbortController();await assert.rejects(hub.clearCache(()=>assert.fail('active download must survive')));hub.operation=null;
});
