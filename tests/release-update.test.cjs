'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {stage,cleanup}=require('../src/release-update.cjs');
test('Staging rechecks every byte and cleanup removes only installer directories',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'release-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const bytes=Buffer.concat([Buffer.from('MZ'),Buffer.alloc(550000,13)]),sha=createHash('sha256').update(bytes).digest('hex');
  const r={sha,name:'CRAFTCODE-LINK-0.10.1-Setup-x64.exe'};
  const file=path.join(dir,'input'),cache=path.join(dir,'cache');await fs.writeFile(file,bytes);
  const copy=await stage(file,cache,r);assert.equal(path.basename(copy),r.name);assert.deepEqual(await fs.readFile(copy),bytes);
  await fs.writeFile(file,'MZmodified');await assert.rejects(stage(file,cache,r));assert.equal((await fs.readdir(cache)).length,1);
  await fs.mkdir(path.join(cache,'personal'));await cleanup(cache);assert.deepEqual(await fs.readdir(cache),['personal']);
});
