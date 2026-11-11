'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),sync=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createHash,randomUUID}=require('node:crypto');
const {ShelfStorage}=require('../src/files/storage.cjs');
const {PartialJournal}=require('../src/files/partial-journal.cjs');
const {fileIdentity,removeSavedDownload}=require('../src/files/saved-download.cjs');

async function aliasedRoot(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'link download path aliases-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
  // Read an actual short path through Windows. The generated path is passed as
  // data, never interpolated into a shell command; no 8.3 volume setting changes.
  const command=`Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class LinkQaPath {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern uint GetShortPathName(string path, StringBuilder result, uint size);
}
'@
$result = New-Object System.Text.StringBuilder 32768
$length = [LinkQaPath]::GetShortPathName($env:LINK_QA_DOWNLOAD_ROOT, $result, 32768)
if ($length -eq 0 -or $length -ge 32768) { throw 'Could not resolve test short path' }
$result.ToString()`;
  const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const alias=execFileSync(powershell,['-NoLogo','-NoProfile','-NonInteractive','-Command',command],
    {encoding:'utf8',windowsHide:true,timeout:20000,env:{...process.env,LINK_QA_DOWNLOAD_ROOT:root}}).trim();
  const physical=await fs.realpath(root);
  if(path.relative(alias,physical)===''){t.skip('This Windows volume has no short path alias for the test directory');return;}
  assert.equal(await fs.realpath(alias),physical);
  return {root:physical,alias};
}

test('Windows short Downloads aliases retain exact-file cleanup and reject redirected rooms',{skip:process.platform!=='win32'},async t=>{
  const dirs=await aliasedRoot(t);if(!dirs)return;
  const {root,alias}=dirs,person='a'.repeat(64),bytes=Buffer.from('verified original');
  const sha=createHash('sha256').update(bytes).digest('hex'),shelf=new ShelfStorage(alias);
  t.after(()=>shelf.close());
  async function receive(name){
    const id=await shelf.begin({name,sha,size:bytes.length},'DM-'+person.slice(0,12));
    const saved=await shelf.putBytes(id,0,bytes);
    return {person,filename:saved.path,size:bytes.length,sha,identity:fileIdentity(await fs.stat(saved.path,{bigint:true}))};
  }
  const saved=await receive('voice.weba');
  assert.equal(await removeSavedDownload(alias,saved,()=>true),'removed');
  assert.equal(sync.existsSync(saved.filename),false);
  const legacy=await receive('legacy.txt');delete legacy.identity;
  assert.equal(await removeSavedDownload(alias,legacy,()=>true),'removed','pre-index receipts still verify the full content');
  const shortReceipt=await receive('short-receipt.txt');
  shortReceipt.filename=path.join(alias,path.relative(root,shortReceipt.filename));
  assert.equal(await removeSavedDownload(root,shortReceipt,()=>true),'removed','a receipt may retain the short spelling of Downloads');
  const replaced=await receive('replaced.txt');
  replaced.filename=path.join(alias,path.relative(root,replaced.filename));
  await fs.rename(replaced.filename,replaced.filename+'.original');
  await fs.writeFile(replaced.filename,bytes);
  assert.equal(await removeSavedDownload(root,replaced,()=>true),'kept','a short receipt still requires the saved file identity');
  const edited=await receive('edited.txt');await fs.appendFile(edited.filename,'my changes');
  assert.equal(await removeSavedDownload(alias,edited,()=>true),'kept');
  const outside=path.join(root,'outside.txt');await fs.writeFile(outside,bytes);
  await assert.rejects(removeSavedDownload(alias,{...saved,filename:outside},()=>true),/Download directory changed/);
  assert.deepEqual(await fs.readFile(outside),bytes);
  const redirected=await receive('redirected.txt'),room=path.dirname(redirected.filename),moved=path.join(root,'moved-room');
  await fs.rename(room,moved);await fs.symlink(moved,room,'junction');
  assert.equal(await removeSavedDownload(alias,redirected,()=>true),'kept');
  const redirectedAlias={...redirected,identity:undefined,filename:path.join(alias,path.relative(root,redirected.filename))};
  assert.equal(await removeSavedDownload(root,redirectedAlias,()=>true),'kept','a legacy short receipt cannot follow a redirected conversation');
  assert.deepEqual(await fs.readFile(path.join(moved,'redirected.txt')),bytes);
});

test('Windows short Downloads aliases recover only the journalled file identity',{skip:process.platform!=='win32'},async t=>{
  const dirs=await aliasedRoot(t);if(!dirs)return;
  const {root,alias}=dirs,profile=path.join(alias,'profile');await fs.mkdir(profile);
  const journal=new PartialJournal(profile),shelf=new ShelfStorage(alias,journal);
  t.after(()=>shelf.close());
  const id=await shelf.begin({name:'unfinished.bin',sha:'0'.repeat(64),size:10},'Room');
  const current=shelf.incoming.get(id);
  // Leave the owned partial and journal behind, as after a process exits.
  await current.file.close();shelf.incoming.clear();
  const dir=path.join(root,'CRAFTCODE LINK','Room'),other=path.join(dir,'.link-'+randomUUID()+'.part');
  await fs.writeFile(other,'unrelated');
  await journal.recover(alias);
  assert.equal(sync.existsSync(current.tmp),false,'native canonical paths identify the recorded partial');
  assert.equal(await fs.readFile(other,'utf8'),'unrelated');
  assert.deepEqual(await fs.readdir(profile),[]);
});

test('cleanup selects only an approved download root and retains receipts for unavailable disks',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'link-download-roots-'));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const previous=path.join(temp,'previous'),current=path.join(temp,'current');
  await fs.mkdir(previous);await fs.mkdir(current);
  const missing=path.join(temp,'unavailable'),person='b'.repeat(64),bytes=Buffer.from('saved attachment');
  const shelf=new ShelfStorage(previous);t.after(()=>shelf.close());
  const sha=createHash('sha256').update(bytes).digest('hex');
  async function receive(name){
    const id=await shelf.begin({name,sha,size:bytes.length},'DM-'+person.slice(0,12));
    const saved=await shelf.putBytes(id,0,bytes);
    return {person,filename:saved.path,size:bytes.length,sha,identity:fileIdentity(await fs.stat(saved.path,{bigint:true}))};
  }
  const saved=await receive('old-location.txt');
  await assert.rejects(removeSavedDownload([missing,current],saved,()=>true),/Download directory/);
  assert.deepEqual(await fs.readFile(saved.filename),bytes);
  assert.equal(await removeSavedDownload([missing,current,previous],saved,()=>true),'removed');
  const absent=await receive('already-removed.txt');await fs.unlink(absent.filename);
  assert.equal(await removeSavedDownload([current,previous],absent,()=>true),'missing');
  const offline=await receive('offline.txt'),disconnected=path.join(temp,'disconnected');
  const relativeFile=path.relative(await fs.realpath(previous),offline.filename);
  await fs.rename(previous,disconnected);
  await assert.rejects(removeSavedDownload([current,previous],offline,()=>true),{code:'ENOENT'});
  assert.deepEqual(await fs.readFile(path.join(disconnected,relativeFile)),bytes);
});

test('a simulated disk disconnect during hashing preserves the receipt for retry',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'link-download-disconnect-'));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const root=path.join(temp,'downloads');await fs.mkdir(root);
  const person='c'.repeat(64),bytes=Buffer.from('retained after a disk disconnect');
  const sha=createHash('sha256').update(bytes).digest('hex'),shelf=new ShelfStorage(root);
  t.after(()=>shelf.close());
  const id=await shelf.begin({name:'voice.weba',sha,size:bytes.length},'DM-'+person.slice(0,12));
  const saved=await shelf.putBytes(id,0,bytes);
  const receipt={person,filename:saved.path,size:bytes.length,sha,identity:fileIdentity(await fs.stat(saved.path,{bigint:true}))};
  let disconnected=false;
  const realpath=sync.realpathSync.native,lstat=sync.lstatSync;
  const check=()=>{if(disconnected)throw Object.assign(Error('Fixture disk disconnected'),{code:'ENOENT'});};
  const realpathMock=t.mock.method(sync.realpathSync,'native',(...args)=>{check();return realpath(...args);});
  const lstatMock=t.mock.method(sync,'lstatSync',(...args)=>{check();return lstat(...args);});
  try{
    await assert.rejects(removeSavedDownload(root,receipt,()=>{disconnected=true;return true;}),{code:'ENOENT'});
  }finally{realpathMock.mock.restore();lstatMock.mock.restore();}
  assert.deepEqual(await fs.readFile(saved.path),bytes);
});

test('partial cleanup retries after a simulated disconnect during directory lookup',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'link-partial-disconnect-'));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const profile=path.join(temp,'profile'),downloads=path.join(temp,'downloads');
  const base=path.join(downloads,'CRAFTCODE LINK'),room='DM-'+('d'.repeat(12));
  await fs.mkdir(profile);await fs.mkdir(path.join(base,room),{recursive:true});
  const id=randomUUID(),part=path.join(base,room,'.link-'+id+'.part');
  await fs.writeFile(part,'unfinished bytes');
  const journal=new PartialJournal(profile);
  await journal.track(id,downloads,room,fileIdentity(await fs.stat(part,{bigint:true})));
  let disconnected=false;
  const realpath=fs.realpath,lstat=fs.lstat;
  const offline=()=>Object.assign(Error('Fixture disk disconnected'),{code:'ENOENT'});
  const rootMock=t.mock.method(fs,'realpath',async(...args)=>{
    if(disconnected&&args[0]===downloads)throw offline();
    return realpath(...args);
  });
  const lookupMock=t.mock.method(fs,'lstat',async(...args)=>{
    if(args[0]===base){disconnected=true;throw offline();}
    return lstat(...args);
  });
  try{await journal.recover(downloads);}
  finally{rootMock.mock.restore();lookupMock.mock.restore();}
  const receipt=path.join(profile,'pending-downloads-v1',id+'.json');
  assert.equal((await fs.stat(receipt)).isFile(),true);
  assert.equal(await fs.readFile(part,'utf8'),'unfinished bytes');
  await journal.recover(downloads);
  await assert.rejects(fs.stat(part),{code:'ENOENT'});
  await assert.rejects(fs.stat(receipt),{code:'ENOENT'});
});
