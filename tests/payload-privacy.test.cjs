'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const {verifyPayloadPrivacy,verifySourcePrivacy,sourceIncluded}=require('../scripts/payload-privacy.cjs');

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'link-release-privacy-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const payload=path.join(root,'payload');await fs.mkdir(payload);
  await fs.writeFile(path.join(payload,'CRAFTCODE-LINK.exe'),'MZ synthetic executable');
  return {root,payload};
}

test('release preflight accepts clean files but refuses runtime data and profile material',async t=>{
  const {payload}=await fixture(t);await verifyPayloadPrivacy(payload);
  for(const relative of ['CRAFTCODE LINK Data/private-copy.txt','cRaFtCoDe LiNk DaTa/anything','nested/storage-location-v1.json',
    'nested/link-personal-chats-v1.sqlite-wal','nested/link-direct-v1.bin.tmp','nested/craftlink-account-v1.bin','nested/profile.cclprofile','.craftcode-link-copy-v1/header.json']){
    const target=path.join(payload,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,'synthetic private data');
    await assert.rejects(verifyPayloadPrivacy(payload),/Refusing to package runtime user data/);
    assert.equal(await fs.readFile(target,'utf8'),'synthetic private data','preflight must preserve user data');
    await fs.rm(path.join(payload,relative.split('/')[0]),{recursive:true,force:true});
  }
});

test('release preflight refuses a redirected payload tree',async t=>{
  const {root,payload}=await fixture(t),outside=path.join(root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'keep'),'synthetic private data');
  await fs.symlink(outside,path.join(payload,'redirected'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(verifyPayloadPrivacy(payload),/Refusing to package/);
  assert.equal(await fs.readFile(path.join(outside,'keep'),'utf8'),'synthetic private data');
});

test('both handoff modes stop before making archives from a launched portable tree',async t=>{
  const {root}=await fixture(t),scripts=path.join(root,'scripts'),version='0.0.1';await fs.mkdir(scripts);
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version}));
  for(const name of ['handoff.cjs','payload-privacy.cjs','payload-privacy.json'])await fs.copyFile(path.resolve(__dirname,'..','scripts',name),path.join(scripts,name));
  const payload=path.join(root,'out',`CRAFTCODE-LINK-${version}-win-x64`),data=path.join(payload,'CRAFTCODE LINK Data');
  await fs.mkdir(data,{recursive:true});await fs.writeFile(path.join(payload,'CRAFTCODE-LINK.exe'),'MZ fixture');await fs.writeFile(path.join(data,'private-copy'),'synthetic');
  for(const args of [[],['--installer']]){
    const result=spawnSync(process.execPath,[path.join(scripts,'handoff.cjs'),...args],{cwd:root,encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/Refusing to package runtime user data/);
    assert.deepEqual(await fs.readdir(path.join(root,'out')),[`CRAFTCODE-LINK-${version}-win-x64`]);
    assert.equal(await fs.readFile(path.join(data,'private-copy'),'utf8'),'synthetic');
  }
});

test('source preflight works without Git and preserves private inputs while refusing them',async t=>{
  const {root}=await fixture(t),source=path.join(root,'source');await fs.mkdir(source);
  await fs.writeFile(path.join(source,'sample.pem'),'-----BEGIN CERTIFICATE-----\n'+ 'A'.repeat(64)+'\n-----END CERTIFICATE-----\n');
  await fs.writeFile(path.join(source,'marker.cjs'),"const marker='-----BEGIN PRIVATE KEY-----';");
  await fs.mkdir(path.join(source,'__pycache__'));await fs.writeFile(path.join(source,'__pycache__','sample.pyc'),'generated');
  await verifySourcePrivacy([source]);
  const copied=path.join(root,'copied');await fs.cp(source,copied,{recursive:true,filter:sourceIncluded});
  assert.equal((await fs.readdir(copied)).includes('__pycache__'),false);
  for(const [name,content] of [
    ['.env','synthetic'],['debug.log','synthetic'],['profile.cclprofile','synthetic'],['state.sqlite','synthetic'],
    ['secret.pem','-----BEGIN PRIVATE KEY-----\n'+'A'.repeat(64)+'\n-----END PRIVATE KEY-----\n'],
    ['token.txt','ghp_'+'A'.repeat(36)],['node_modules/private.txt','synthetic'],['build/private.txt','synthetic'],
  ]){
    const file=path.join(source,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);
    await assert.rejects(verifySourcePrivacy([source]),/Refusing to package private/);
    assert.equal(await fs.readFile(file,'utf8'),content);
    await fs.rm(path.join(source,name.split('/')[0]),{recursive:true,force:true});
  }
  const outside=path.join(root,'outside-source');await fs.mkdir(outside);
  await fs.symlink(outside,path.join(source,'redirected'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(verifySourcePrivacy([source]),/Refusing to package private/);
});

test('both handoff modes reject private source before creating any release directory',async t=>{
  const {root}=await fixture(t),scripts=path.join(root,'scripts'),version='0.0.1';await fs.mkdir(scripts);
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version}));
  await fs.writeFile(path.join(root,'AGENTS.md'),'fixture');await fs.mkdir(path.join(root,'src'));
  const privateFile=path.join(root,'src','.env');await fs.writeFile(privateFile,'synthetic');
  for(const name of ['handoff.cjs','payload-privacy.cjs','payload-privacy.json'])await fs.copyFile(path.resolve(__dirname,'..','scripts',name),path.join(scripts,name));
  const payload=path.join(root,'out',`CRAFTCODE-LINK-${version}-win-x64`);await fs.mkdir(payload,{recursive:true});
  await fs.writeFile(path.join(payload,'CRAFTCODE-LINK.exe'),'MZ fixture');
  for(const args of [[],['--installer']]){
    const result=spawnSync(process.execPath,[path.join(scripts,'handoff.cjs'),...args],{cwd:root,encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/Refusing to package private/);
    assert.deepEqual(await fs.readdir(path.join(root,'out')),[`CRAFTCODE-LINK-${version}-win-x64`]);
    assert.equal(await fs.readFile(privateFile,'utf8'),'synthetic');
  }
});
