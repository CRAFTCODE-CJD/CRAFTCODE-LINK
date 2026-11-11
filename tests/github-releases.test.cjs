'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto'),{EventEmitter}=require('node:events');
const {lookup,selectRelease,download,supportURL,latestURL,home,api}=require('../src/github-releases.cjs');
const {UpdateService,DAY}=require('../src/update-service.cjs');
const {registerUpdates}=require('../src/release-update.cjs');
const bytes=Buffer.from('MZsample installer; must never be executed');
const sha=createHash('sha256').update(bytes).digest('hex'),version='0.20.1',tag='v'+version;
const name='CRAFTCODE-LINK-'+version+'-Setup-x64.exe';
function metadata(){
  return {tag_name:tag,draft:false,prerelease:false,html_url:home+'/releases/tag/'+tag,assets:[{
    name,id:7304,size:bytes.length,state:'uploaded',digest:'sha256:'+sha,url:api+'/releases/assets/7304',
    browser_download_url:home+'/releases/download/'+tag+'/'+name}]};
}
const signal=()=>new AbortController().signal;
async function temp(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'link-update-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:75}));return directory;
}
const response=()=>new Response(JSON.stringify(metadata()));
test('Latest lookup pins the publisher and accepts one compatible stable newer installer with a GitHub digest',async()=>{
  const r=await lookup('0.9.9',(url,options)=>{
    assert.equal(url,latestURL);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return response();
  },signal());
  assert.equal(r.phase,'available');assert.equal(r.release.sha,sha);
  assert.equal(selectRelease(metadata(),version),null);assert.equal(selectRelease(metadata(),'0.21.0'),null);
  for(const values of [{draft:true},{prerelease:true},{tag_name:'v0.20.1-beta.1'},{tag_name:'0.020.1'},{html_url:'https://github.com/another/repo'}])
    assert.throws(()=>selectRelease({...metadata(),...values},'0.9.9'));
  for(const fields of [{id:0},{digest:null},{digest:'sha1:'+sha},{name:'setup.exe'},{state:'new'},{url:home},
    {size:513*1024**2},{browser_download_url:'https://another.invalid/'+name}]){
    const m=metadata();Object.assign(m.assets[0],fields);assert.throws(()=>selectRelease(m,'0.9.9'));
  }
  const dup=metadata();dup.assets.push(dup.assets[0]);assert.throws(()=>selectRelease(dup,'0.9.9'));
  assert.equal((await lookup('0.9.9',()=>new Response(null,{status:404}),signal())).phase,'unpublished');
  for(const [status,headers] of [[429,{}],[403,{'x-ratelimit-remaining':'0'}]])
    await assert.rejects(lookup('0.9.9',()=>new Response(null,{status,headers}),signal()),/частоту проверок/);
  for(const res of [new Response(null,{status:403}),new Response(null,{status:302}),new Response('x'.repeat(1024**2+1))])
    await assert.rejects(lookup('0.9.9',()=>res,signal()));
  assert.equal(supportURL(),'https://boosty.to/channel-jonathan-developer/donate');
  assert.equal(supportURL(null),null);
  assert.equal(supportURL('https://support.example/path'),'https://support.example/path');
  for(const url of ['http://example.org','file:///C:/x','https://user@example.org','https://example.org:8443'])assert.equal(supportURL(url),null);
});
test('Binary retrieves only the bound asset or GitHub release CDN, checks every byte and removes failed downloads',async t=>{
  const cache=await temp(t),release=selectRelease(metadata(),'0.1.0'),cdn='https://release-assets.githubusercontent.com/r/1234?sig=ref';
  const calls=[];
  const file=await download(release,cache,(url,options)=>{
    calls.push(url);assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');
    if(url===release.url){assert.equal(options.headers.Accept,'application/octet-stream');return Response.redirect(cdn);}
    return new Response(new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,1));controller.enqueue(bytes.subarray(1));controller.close();}}));
  },signal());
  assert.deepEqual(calls,[release.url,cdn]);assert.deepEqual(await fs.readFile(file),bytes);
  for(const redir of ['http://release-assets.githubusercontent.com/file','https://attacker.invalid/file','https://attacker@release-assets.githubusercontent.com/file',home+'/wrong.exe']){
    let count=0;await assert.rejects(download(release,cache,()=>{count++;return Response.redirect(redir);},signal()));
    assert.equal(count,1);
  }
  for(const contents of [bytes.subarray(0,-1),Buffer.alloc(bytes.length,1),Buffer.concat([bytes,bytes])]){
    await assert.rejects(download(release,cache,()=>new Response(contents),signal()));
    assert.deepEqual(await fs.readdir(cache),[path.basename(path.dirname(file))]);
  }
  await assert.rejects(download({...release,sha:'0'.repeat(64)},cache,()=>new Response(bytes),signal()));
  assert.deepEqual(await fs.readdir(cache),[path.basename(path.dirname(file))]);
});
test('Background checks wait for policy, persist the daily interval, stay silent in the tray and never download',async t=>{
  const directory=await temp(t);let normal=false,calls=0,clock=3*DAY;
  const changes=[];
  const make=()=>new UpdateService({directory,cache:path.join(directory,'cache'),current:'0.1.0',allowed:()=>normal,supported:true,
    scheduled:true,changed:s=>changes.push(s.phase),install:()=>assert.fail('unexpected install'),openExternal:()=>assert.fail('unexpected navigation'),
    now:()=>clock,fetcher:url=>{assert.equal(url,latestURL);calls++;return response();}});
  let h=make();t.after(()=>h.close());h.policy();assert.equal(h.timer,undefined);
  await assert.rejects(h.command({op:'check'}));assert.equal(calls,0);
  normal=true;h.policy();assert.ok(h.timer);await h.check(true);assert.equal(calls,1);assert.equal(h.phase,'available');assert.deepEqual(changes.slice(-2),['checking','available']);
  h.close();h=make();await h.check(true);assert.equal(calls,1);
  clock+=DAY;await h.check(true);assert.equal(calls,2);
  await h.command({op:'automatic',enabled:false});h.close();h=make();assert.equal(h.state().automatic,false);
  clock+=2*DAY;await h.check(true);assert.equal(calls,2);
  await h.command({op:'check'});assert.equal(calls,3);
  normal=false;h.policy();await assert.rejects(h.command({op:'download'}));assert.equal(calls,3);
  await assert.rejects(h.command({op:'donate',url:'https://attacker.invalid'}));
});
test('Switch to relay-only aborts an in-flight lookup; disabled preferences cancel background work',async t=>{
  const directory=await temp(t);let normal=true,requests=0;
  const h=new UpdateService({directory,cache:directory,current:'0.1.0',allowed:()=>normal,supported:true,scheduled:false,changed:()=>{},
    now:()=>3*DAY,fetcher:(_url,opts)=>{requests++;return new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(opts.signal.reason),{once:true}));}});
  t.after(()=>h.close());const job=h.check(true);await assert.rejects(h.check());
  normal=false;h.policy();await job;assert.equal(h.phase,'idle');assert.equal(requests,1);
  normal=true;await h.command({op:'automatic',enabled:false});
  const k=new UpdateService({directory,cache:directory,current:'0.1.0',allowed:()=>normal,supported:true,scheduled:false,changed:()=>{},
    now:()=>5*DAY,fetcher:h.fetcher});t.after(()=>k.close());
  k.automatic(true);const background=k.check(true);k.automatic(false);await background;assert.equal(k.phase,'idle');assert.equal(requests,2);
});
test('Restart preserves the available-version hint only and revalidates with the publisher before download',async t=>{
  const directory=await temp(t),cache=path.join(directory,'cache'),calls=[];
  const mk=()=>new UpdateService({directory,cache,current:'0.1.0',allowed:()=>true,supported:true,scheduled:false,changed:()=>{},
    fetcher:url=>{calls.push(url);if(url===latestURL)return response();assert.equal(url,metadata().assets[0].url);return new Response(bytes);}});
  let hub=mk();await hub.check();hub.close();
  const pref=path.join(directory,'release-check-v1.json'),p=JSON.parse(await fs.readFile(pref,'utf8'));
  assert.deepEqual(p.offer,{version,size:bytes.length});p.offer.url='https://attacker.invalid/untrusted';p.offer.sha='0'.repeat(64);
  await fs.writeFile(pref,JSON.stringify(p));hub=mk();t.after(()=>hub.close());assert.equal(hub.state().version,version);
  assert.equal(hub.phase,'available');await hub.check(true);assert.deepEqual(calls,[latestURL]);
  assert.equal((await hub.command({op:'download'})).phase,'ready');
  assert.deepEqual(calls,[latestURL,latestURL,metadata().assets[0].url]);
});
test('Quitting during native confirmation before the installer starts never launches or resumes an install',async t=>{
  const directory=await temp(t),handlers=new Map();let ctrl;
  ctrl=registerUpdates({handle:(op,cb)=>handlers.set(op,cb),app:{getVersion:()=>'0.1.0',getPath:()=>directory,isPackaged:false,quit:()=>assert.fail()},
    supported:true,allowed:()=>true,sessionActive:()=>false,changed:()=>{},window:()=>null,
    dialog:{showMessageBox:async()=>{ctrl.close();return {response:1};}},launcher:()=>assert.fail('App is already quitting'),
    fetcher:url=>url===latestURL?response():new Response(bytes)});
  const op=op=>handlers.get('releases')({op});await op('check');await op('download');await assert.rejects(op('install'));
  assert.equal(ctrl.launching,false);await assert.rejects(op('install'));
  const cache=path.join(directory,'update-cache');await fs.mkdir(path.join(cache,'personal'));
  const restart=registerUpdates({handle:(op,cb)=>handlers.set(op,cb),app:{getVersion:()=>'0.1.0',getPath:()=>directory,isPackaged:false},
    supported:true,allowed:()=>true,sessionActive:()=>false,changed:()=>{},fetcher:()=>assert.fail('Unexpected network at restart'),
    launcher:()=>assert.fail('Unexpected install at restart')});
  t.after(()=>restart.close());assert.equal((await op('state')).phase,'available');
  await assert.rejects(op('install'));assert.deepEqual(await fs.readdir(cache),['personal']);
});
test('Windows IPC separates download and consent, refuses newly active sessions, recovers from tamper or launch failure',async t=>{
  const directory=await temp(t),cache=path.join(directory,'update-cache'),handlers=new Map(),launched=[];
  let active=false,consent=0,prompts=0,beforeAnswer=()=>{},quits=0,launchFails=false,downloads=0;
  const fakeWindow={};
  const ctrl=registerUpdates({handle:(name,fn)=>handlers.set(name,fn),app:{isPackaged:false,getPath:()=>directory,getVersion:()=>'0.1.0',quit:()=>quits++},
    dialog:{showMessageBox:async(win,opts)=>{assert.equal(win,fakeWindow);assert.equal(opts.defaultId,0);assert.equal(opts.cancelId,0);prompts++;beforeAnswer();return {response:consent};}},
    window:()=>fakeWindow,completed:()=>null,allowed:()=>true,sessionActive:()=>active,changed:()=>{},openExternal:()=>assert.fail('unexpected navigation'),
    supported:true,fetcher:(url)=>{if(url===latestURL)return response();assert.equal(url,metadata().assets[0].url);downloads++;return new Response(bytes);},
    launcher:(file,args,options)=>{assert.deepEqual(args,[]);assert.equal(options.shell,false);launched.push(file);
      const child=new EventEmitter();child.unref=()=>{};process.nextTick(()=>launchFails?child.emit('error',Error('simulated launch failure')):child.emit('spawn'));return child;}});
  t.after(()=>ctrl.close());
  const op=name=>handlers.get('releases')({op:name,url:'https://attacker.invalid/setup.exe',path:'C:\\bad'});
  assert.equal((await op('check')).phase,'available');assert.equal(downloads,0);assert.equal(prompts,0);
  assert.equal((await op('download')).phase,'ready');assert.equal(downloads,1);assert.equal(prompts,0);
  active=true;await assert.rejects(op('install'));assert.equal(prompts,0);
  active=false;await op('install');assert.equal(prompts,1);assert.equal(launched.length,0);
  consent=1;beforeAnswer=()=>{active=true;};await assert.rejects(op('install'));assert.equal(launched.length,0);
  active=false;beforeAnswer=()=>{};
  const cached=async()=>path.join(cache,(await fs.readdir(cache))[0],name);
  await fs.writeFile(await cached(),'MZtampered');assert.equal((await op('install')).phase,'available');
  assert.deepEqual(await fs.readdir(cache),[]);assert.equal(launched.length,0);await op('download');
  await fs.unlink(await cached());assert.equal((await op('install')).phase,'available');assert.deepEqual(await fs.readdir(cache),[]);
  await op('download');launchFails=true;await assert.rejects(op('install'),/simulated launch/);
  assert.equal(ctrl.launching,false);assert.equal(quits,0);assert.equal((await fs.readdir(cache)).length,1);
  launchFails=false;await op('install');assert.deepEqual(await fs.readFile(launched.at(-1)),bytes);assert.equal(quits,1);assert.equal(ctrl.launching,true);
});
