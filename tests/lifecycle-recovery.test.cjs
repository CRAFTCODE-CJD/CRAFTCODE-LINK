'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto');
const {CameraConsent}=require('../src/files/camera-consent.cjs');
const {PartialJournal}=require('../src/files/partial-journal.cjs');
const {GameRoom}=require('../src/game/room.cjs');

test('late camera consent cannot arm a cancelled recording or revoke the next recording',async()=>{
  const camera=new CameraConsent(),a=randomUUID(),b=randomUUID();
  let resolve;
  const pending=camera.ask(a,()=>new Promise(done=>{resolve=done;}));
  camera.cancel(a);assert.equal(await camera.ask(b,()=>true),false);
  resolve(true);assert.equal(await pending,false);assert.equal(camera.allowed(),false);
  assert.equal(await camera.ask(b,()=>true),true);camera.cancel(a);
  assert.equal(camera.consume(),true);assert.equal(camera.consume(),false);
  assert.equal(await camera.ask(a,()=>false),false);assert.equal(camera.allowed(),false);
  let room={};const original=room;
  assert(await camera.ask(a,()=>true,()=>room===original));
  room={};assert.equal(camera.consume(),false,'a grant cannot follow the user to another LAN session');
  let prompted=false;
  assert.equal(await camera.ask(b,()=>{prompted=true;return true;},()=>false),false);
  assert.equal(prompted,false);
});

test('after abrupt process death only the recorded incomplete file belonging to that profile is removed',{timeout:15000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'link-journal-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const profile=path.join(root,'profile'),downloads=path.join(root,'Downloads');
  await Promise.all([fs.mkdir(profile),fs.mkdir(downloads)]);
  const script=`
    const {ShelfStorage}=require(process.argv[1]),{PartialJournal}=require(process.argv[2]);
    (async()=>{
      const store=new ShelfStorage(process.argv[3],new PartialJournal(process.argv[4]));
      const id=await store.begin({name:'build.zip',sha:'0'.repeat(64),size:49152},'Room');
      await store.putBytes(id,0,Buffer.alloc(24576));process.send(id);
      setInterval(()=>{},10000);
    })().catch(e=>{console.error(e);process.exit(1);});
  `;
  const child=spawn(process.execPath,['-e',script,require.resolve('../src/files/storage.cjs'),require.resolve('../src/files/partial-journal.cjs'),downloads,profile],{stdio:['ignore','ignore','inherit','ipc']});
  t.after(()=>{if(child.exitCode===null&&!child.signalCode)child.kill();});
  const [id]=await once(child,'message'),exit=once(child,'exit');
  child.kill('SIGKILL');await exit;
  const dir=path.join(downloads,'CRAFTCODE LINK','Room'),partial=path.join(dir,'.link-'+id+'.part');
  assert.equal((await fs.stat(partial)).size,24576);
  const unrelated='.link-'+randomUUID()+'.part';
  await fs.writeFile(path.join(dir,unrelated),'other');await fs.writeFile(path.join(dir,'build.zip'),'saved');
  const journal=new PartialJournal(profile);
  await journal.recover(root);assert.equal((await fs.stat(partial)).size,24576);
  await journal.recover(downloads);await journal.recover(downloads);
  assert.deepEqual((await fs.readdir(dir)).sort(),[unrelated,'build.zip'].sort());
  assert.equal(await fs.readFile(path.join(dir,'build.zip'),'utf8'),'saved');
  assert.deepEqual(await fs.readdir(profile),[]);
});

test('game host discards only matching cancellation, revokes unconsumed admission and closes outstanding requests',()=>{
  const mk=n=>({name:'User '+n,id:n.toString(16).padStart(64,'0'),device:(n+10).toString(16).padStart(64,'0')});
  const a=mk(1),b=mk(2),messages=[];
  const make=(me,other)=>new GameRoom({self:()=>me,links:()=>[{card:other,send:m=>{messages.push(m);return true;}}],changed(){},event(){},quiet:()=>false});
  const host=make(a,b),guest=make(b,a);host.create('Match');
  const offer=host.listing(b);
  guest.ask(a,offer);host.receive(b,messages.pop());guest.cancelAsk();
  const cancel=messages.pop();host.receive({...b,device:a.device},cancel);
  host.receive(b,{...cancel,ticket:randomUUID()});assert.equal(host.state().requests.length,1);
  host.receive(b,cancel);assert.equal(host.state().requests.length,0);
  guest.ask(a,offer);host.receive(b,messages.pop());host.review(b.device,true);
  const grant=messages.pop();guest.cancelAsk();host.receive(b,messages.pop());guest.receive(a,grant);
  assert.equal(host.sent.size,0);assert.equal(guest.active,null);
  guest.ask(a,offer);host.receive(b,messages.pop());host.leave();guest.receive(a,messages.pop());
  assert.equal(guest.asked,null);
});

test('journal recovery leaves a redirected room, unrelated partial and saved file alone',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'link-journal-dir-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const profile=path.join(root,'profile'),base=path.join(root,'CRAFTCODE LINK'),outside=path.join(root,'another');
  await Promise.all([fs.mkdir(profile),fs.mkdir(base),fs.mkdir(outside)]);
  const journal=new PartialJournal(profile),id=randomUUID(),file='.link-'+id+'.part';
  await journal.track(id,root,'Room');await fs.writeFile(path.join(outside,file),'keep');
  await fs.symlink(outside,path.join(base,'Room'),process.platform==='win32'?'junction':'dir');
  await journal.recover(root);
  assert.equal(await fs.readFile(path.join(outside,file),'utf8'),'keep');
  assert.deepEqual(await fs.readdir(journal.dir),[id+'.json']);
});

test('endurance verdict requires elapsed real milliseconds, both audio streams, resource release and a clean exit',()=>{
  const {passed}=require('./run-endurance.cjs'),target=18000000;
  const end={elapsedMs:target,checkpoints:1800,maxCheckpointGapMs:10000,movieFrames:1,movieBytes:1,voiceBytes:1,systemBytes:1,closed:Array.from({length:3},()=>({endpoints:0,mixerSources:0,generatedLive:0}))};
  assert(passed(target,end,true,0,null));
  for(const event of [{elapsedMs:target-1},{checkpoints:10},{maxCheckpointGapMs:21000},{systemBytes:0},{voiceBytes:0},{closed:[]}])assert(!passed(target,{...end,...event},true,0,null));
  assert(!passed(target,end,true,1,null));assert(!passed(target,end,false,0,null));assert(!passed(target,end,true,null,'SIGTERM'));
});

test('endurance rejects a sleeping machine or a stationary selected track between observations',()=>{
  const {verifyPlayback}=require('./evening-session.cjs');
  const snapshot=(time,wallTime,count)=>({time,wallTime,streams:[
    {screen:{frames:count,bytes:count},system:{bytes:count},voice:{bytes:count}}]});
  const start=snapshot(0,1000,1);
  assert.equal(verifyPlayback(start,snapshot(10000,11000,2),0),10000);
  assert.throws(()=>verifyPlayback(start,snapshot(10000,901000,2),0),/Interrupted/);
  assert.throws(()=>verifyPlayback(start,snapshot(900000,11000,2),0),/Interrupted/);
  const stalled=snapshot(10000,11000,3);stalled.streams[0].system.bytes=1;
  assert.throws(()=>verifyPlayback(start,stalled,0),/stopped advancing/);
});

test('cleanup failure following a committed save never creates a second copy or hides the saved result',async t=>{
  const {ShelfStorage}=require('../src/files/storage.cjs'),{createHash}=require('node:crypto');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'link-committed-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const profile=path.join(dir,'profile');await fs.mkdir(profile);
  const journal=new PartialJournal(profile),store=new ShelfStorage(dir,journal);
  const bytes=Buffer.from('verified file');
  const id=await store.begin({name:'build.zip',size:bytes.length,sha:createHash('sha256').update(bytes).digest('hex')},'Room');
  journal.forget=async()=>{throw Error('Profile busy');};
  const result=await store.putBytes(id,0,bytes);
  assert(result.done);assert.equal(store.location(id),result.path);await store.close();
  await new PartialJournal(profile).recover(dir);
  assert.deepEqual(await fs.readdir(path.dirname(result.path)),['build.zip']);assert.deepEqual(await fs.readFile(result.path),bytes);
});

test('replacing a partial download cannot substitute unverified contents or delete a bystander file',async t=>{
  const {ShelfStorage}=require('../src/files/storage.cjs'),{createHash}=require('node:crypto');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'link-replaced-part-'));
  const store=new ShelfStorage(root);
  t.after(async()=>{await store.close();await fs.rm(root,{recursive:true,force:true});});
  const expected=Buffer.from('verified attachment'),replacement=Buffer.from('unverified contents');
  const id=await store.begin({name:'build.bin',size:expected.length,sha:createHash('sha256').update(expected).digest('hex')},'Room');
  const dir=path.join(root,'CRAFTCODE LINK','Room'),part=path.join(dir,'.link-'+id+'.part');
  await store.putBytes(id,0,expected.subarray(0,4));
  await fs.rename(part,path.join(dir,'moved.part'));await fs.writeFile(part,replacement);
  await assert.rejects(store.putBytes(id,4,expected.subarray(4)));
  assert.deepEqual(await fs.readFile(part),replacement);
  await assert.rejects(fs.stat(path.join(dir,'build.bin')),{code:'ENOENT'});
});

test('Windows retains the untrusted zone on a verified downloaded script',{skip:process.platform!=='win32'},async t=>{
  const {ShelfStorage}=require('../src/files/storage.cjs'),{createHash}=require('node:crypto');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'link-file-zone-')),store=new ShelfStorage(root);
  t.after(async()=>{await store.close();await fs.rm(root,{recursive:true,force:true});});
  const data=Buffer.from('# harmless downloaded fixture\n');
  const id=await store.begin({name:'example.ps1',size:data.length,sha:createHash('sha256').update(data).digest('hex')},'Room');
  const result=await store.putBytes(id,0,data);
  assert.deepEqual(await fs.readFile(result.path),data);
  assert.match(await fs.readFile(result.path+':Zone.Identifier','utf8'),/^\[ZoneTransfer\]\r?\nZoneId=3\r?\n?$/);
});

test('an overwritten early block cannot pass the download checksum',async t=>{
  const {ShelfStorage}=require('../src/files/storage.cjs'),{createHash}=require('node:crypto');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'link-overwrite-part-')),store=new ShelfStorage(root);
  t.after(async()=>{await store.close();await fs.rm(root,{recursive:true,force:true});});
  const data=Buffer.from('original contents');
  const id=await store.begin({name:'build.bin',size:data.length,sha:createHash('sha256').update(data).digest('hex')},'Room');
  const dir=path.join(root,'CRAFTCODE LINK','Room');
  await store.putBytes(id,0,data.subarray(0,4));
  const handle=await fs.open(path.join(dir,'.link-'+id+'.part'),'r+');
  try{await handle.write(Buffer.from('fake'),0,4,0);}finally{await handle.close();}
  await assert.rejects(store.putBytes(id,4,data.subarray(4)));
  assert.deepEqual(await fs.readdir(dir),[]);
});

test('recovery keeps a replacement at the exact journalled name',async t=>{
  const {fileIdentity}=require('../src/files/saved-download.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'link-replaced-recovery-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const profile=path.join(root,'profile'),dir=path.join(root,'CRAFTCODE LINK','Room');
  await Promise.all([fs.mkdir(profile),fs.mkdir(dir,{recursive:true})]);
  const journal=new PartialJournal(profile),id=randomUUID(),part=path.join(dir,'.link-'+id+'.part');
  await fs.writeFile(part,'unfinished');await journal.track(id,root,'Room',fileIdentity(await fs.stat(part,{bigint:true})));
  await fs.rename(part,path.join(dir,'moved.part'));await fs.writeFile(part,'keep this');
  await journal.recover(root);
  assert.equal(await fs.readFile(part,'utf8'),'keep this');assert.deepEqual(await fs.readdir(profile),[]);
});
