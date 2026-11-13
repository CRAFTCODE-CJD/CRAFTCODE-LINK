'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto'),{EventEmitter}=require('node:events');
const {lookup,download,supportURL,latestURL,home}=require('../src/github-releases.cjs');
const {UpdateService,DAY}=require('../src/update-service.cjs');
const {registerUpdates}=require('../src/release-update.cjs');
const bytes=Buffer.from('MZsample installer; must never be executed');
const sha=createHash('sha256').update(bytes).digest('hex'),version='0.20.1',tag='v'+version;
const name='CRAFTCODE-LINK-'+version+'-Setup-x64.exe';
function feed(version){
  const prefix=home+'/releases/download/v'+version+'/CRAFTCODE-LINK-'+version;
  return {tag:home+'/releases/tag/v'+version,sums:prefix+'-SHA256SUMS.txt',exe:prefix+'-Setup-x64.exe'};
}
function published(url,opts,v=version){
  const f=feed(v);
  if(url===latestURL){assert.equal(opts.method,'HEAD');return Response.redirect(f.tag,302);}
  if(url===f.sums){assert.equal(opts.method,'GET');return new Response(sha+'  CRAFTCODE-LINK-'+v+'-Setup-x64.exe\n');}
  assert.equal(url,f.exe);
  return opts.method==='HEAD'?new Response(null,{headers:{'Content-Length':String(bytes.length)}}):new Response(bytes);
}
const signal=()=>new AbortController().signal;
async function temp(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'link-update-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:75}));return directory;
}
test('Public latest permalink needs one HEAD for a current client and pinned assets for an upgrade',async()=>{
  const calls=[],check=(url,opts)=>{calls.push(url);assert.equal(opts.credentials,'omit');assert.equal(opts.redirect,'manual');return published(url,opts);};
  const r=await lookup('0.9.9',check,signal());
  assert.equal(r.phase,'available');assert.equal(r.release.sha,sha);assert.equal(r.release.size,bytes.length);
  assert.deepEqual(calls,[latestURL,feed(version).sums,feed(version).exe]);
  for(const current of [version,'0.21.0']){
    calls.length=0;assert.deepEqual(await lookup(current,check,signal()),{phase:'current'});assert.deepEqual(calls,[latestURL]);
  }
  for(const target of [home+'/releases/tag/v0.20.1-beta',home+'/releases/tag/v0.020.1','https://another.invalid/releases/tag/v0.20.1',feed(version).tag+'?q=1'])
    await assert.rejects(lookup('0.9.9',()=>Response.redirect(target),signal()));
  assert.equal((await lookup('0.9.9',()=>new Response(null,{status:404}),signal())).phase,'unpublished');
  for(const [status,headers] of [[429,{}],[403,{'retry-after':'12'}],[403,{'x-ratelimit-remaining':'0'}]])
    await assert.rejects(lookup('0.9.9',()=>new Response(null,{status,headers}),signal()),e=>e.retryAfterMs>=12000);
  for(const body of [sha+'  unrelated.exe', '0'+sha+'  '+name, sha+'  '+name+'\n'+sha+'  '+name, ' '.repeat(8193),'']){
    await assert.rejects(lookup('0.9.9',(url,opts)=>url===feed(version).sums?new Response(body):published(url,opts),signal()));
  }
  for(const len of ['0',String(513*1024**2),'bad']){
    await assert.rejects(lookup('0.9.9',(url,opts)=>url===feed(version).exe?new Response(null,{headers:{'content-length':len}}):published(url,opts),signal()));
  }
  await assert.rejects(lookup('0.9.9',(url,opts)=>url===feed(version).sums?Response.redirect('https://attacker.invalid/code'):published(url,opts),signal()));
  assert.equal(supportURL(),'https://boosty.to/channel-jonathan-developer/donate');
  assert.equal(supportURL(null),null);
  assert.equal(supportURL('https://support.example/path'),'https://support.example/path');
  for(const url of ['http://example.org','file:///C:/x','https://user@example.org','https://example.org:8443'])assert.equal(supportURL(url),null);
});
test('Binary retrieves only the bound asset or GitHub release CDN, checks every byte and removes failed downloads',async t=>{
  const cache=await temp(t),{release}=await lookup('0.1.0',published,signal()),cdn='https://release-assets.githubusercontent.com/r/1234?sig=ref';
  const calls=[],progress=[];
  const file=await download(release,cache,(url,options)=>{
    calls.push(url);assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');
    if(url===release.url){assert.equal(options.method,'GET');return Response.redirect(cdn);}
    return new Response(new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,1));controller.enqueue(bytes.subarray(1));controller.close();}}));
  },signal(),n=>progress.push(n));
  assert.deepEqual(calls,[release.url,cdn]);assert.deepEqual(await fs.readFile(file),bytes);
  assert.deepEqual(progress,[1,bytes.length]);
  for(const redir of ['http://release-assets.githubusercontent.com/file','https://attacker.invalid/file','https://attacker@release-assets.githubusercontent.com/file',home+'/wrong.exe']){
    let count=0;await assert.rejects(download(release,cache,()=>{count++;return Response.redirect(redir);},signal()));
    assert.equal(count,1);
  }
  for(const contents of [bytes.subarray(0,-1),Buffer.alloc(bytes.length,1),Buffer.concat([bytes,bytes])]){
    await assert.rejects(download(release,cache,()=>new Response(contents,{headers:{'Content-Length':String(contents.length)}}),signal()));
    assert.deepEqual(await fs.readdir(cache),[path.basename(path.dirname(file))]);
  }
  await assert.rejects(download({...release,sha:'0'.repeat(64)},cache,()=>new Response(bytes),signal()));
  assert.deepEqual(await fs.readdir(cache),[path.basename(path.dirname(file))]);
});
test('Background checks wait for policy, persist the daily interval and never download',async t=>{
  const directory=await temp(t);let normal=false,calls=0,clock=3*DAY;
  const changes=[];
  const make=()=>new UpdateService({directory,cache:path.join(directory,'cache'),current:'0.1.0',allowed:()=>normal,supported:true,
    scheduled:true,changed:s=>changes.push(s.phase),install:()=>assert.fail('unexpected install'),openExternal:()=>assert.fail('unexpected navigation'),
    now:()=>clock,fetcher:(url,opts)=>{if(url===latestURL)calls++;return published(url,opts);}});
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
test('An available release is announced after deferral, once across restarts; manual checks count as seen',async t=>{
  const directory=await temp(t),shown=[];let clock=3*DAY,ready=false,latest=version;
  const make=()=>new UpdateService({directory,cache:directory,current:'0.1.0',allowed:()=>true,supported:true,scheduled:false,changed:()=>{},
    now:()=>clock,fetcher:(url,opts)=>published(url,opts,latest),
    announce:v=>{if(!ready)return false;shown.push(v);return true;}});
  let hub=make();t.after(()=>hub.close());
  await hub.check(true);assert.deepEqual(shown,[]);ready=true;hub.announceAvailable();hub.announceAvailable();
  assert.deepEqual(shown,[version]);hub.close();hub=make();clock+=DAY;await hub.check(true);
  assert.deepEqual(shown,[version]);
  latest='0.20.2';clock+=DAY;await hub.check(true);assert.deepEqual(shown,[version,latest]);
  latest='0.20.3';await hub.check();clock+=DAY;await hub.check(true);assert.deepEqual(shown,[version,'0.20.2']);
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
    fetcher:(url,opts)=>{calls.push(url);return published(url,opts);}});
  let hub=mk();await hub.check();hub.close();
  const pref=path.join(directory,'release-check-v1.json'),p=JSON.parse(await fs.readFile(pref,'utf8'));
  assert.deepEqual(p.offer,{version,size:bytes.length});p.offer.url='https://attacker.invalid/untrusted';p.offer.sha='0'.repeat(64);
  await fs.writeFile(pref,JSON.stringify(p));hub=mk();t.after(()=>hub.close());assert.equal(hub.state().version,version);
  assert.equal(hub.phase,'available');await hub.check(true);const check=[latestURL,feed(version).sums,feed(version).exe];assert.deepEqual(calls,check);
  assert.equal((await hub.command({op:'download'})).phase,'ready');
  assert.deepEqual(calls,[...check,...check,feed(version).exe]);
});
test('A download requested offline from a cached offer resumes after restart before any bytes were received',async t=>{
  const directory=await temp(t),cache=path.join(directory,'cache');
  let online=true,downloads=0,notice=()=>{};
  const make=()=>new UpdateService({directory,cache,current:'0.1.0',allowed:()=>true,supported:true,scheduled:false,
    changed:state=>notice(state),fetcher:(url,opts)=>{
      if(!online)throw new TypeError('offline');
      if(url===feed(version).exe&&opts.method==='GET')downloads++;
      return published(url,opts);
    }});
  let hub=make();t.after(()=>hub.close());
  await hub.check();hub.close();online=false;
  hub=make();await hub.restore();
  const paused=await hub.command({op:'download'});
  assert.equal(paused.phase,'waiting');assert.equal(paused.received,0);hub.close();
  online=true;hub=make();
  const ready=new Promise((resolve,reject)=>{
    const deadline=setTimeout(()=>reject(Error('Download did not resume')),5000);
    notice=state=>{if(state.phase==='ready'){clearTimeout(deadline);resolve();}};
  });
  await hub.restore();await ready;
  assert.equal(downloads,1);assert.deepEqual(await fs.readFile(hub.staged),bytes);
});
test('Quitting during native confirmation before the installer starts never launches or resumes an install',async t=>{
  const directory=await temp(t),handlers=new Map();let ctrl;
  ctrl=registerUpdates({handle:(op,cb)=>handlers.set(op,cb),app:{getVersion:()=>'0.1.0',getPath:()=>directory,isPackaged:false,quit:()=>assert.fail()},
    supported:true,allowed:()=>true,updateBlocker:()=>'',gameRoom:()=>null,changed:()=>{},window:()=>null,
    dialog:{showMessageBox:async()=>{ctrl.close();return {response:1};}},launcher:()=>assert.fail('App is already quitting'),
    fetcher:published});
  const op=op=>handlers.get('releases')({op});await op('check');await op('download');await assert.rejects(op('install'));
  assert.equal(ctrl.launching,false);await assert.rejects(op('install'));
  const cache=path.join(directory,'update-cache');await fs.mkdir(path.join(cache,'personal'));
  const restart=registerUpdates({handle:(op,cb)=>handlers.set(op,cb),app:{getVersion:()=>'0.1.0',getPath:()=>directory,isPackaged:false},
    supported:true,allowed:()=>true,updateBlocker:()=>'',gameRoom:()=>null,changed:()=>{},fetcher:()=>assert.fail('Unexpected network at restart'),
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
    window:()=>fakeWindow,allowed:()=>true,updateBlocker:()=>active?'Finish the call':'',gameRoom:()=>null,changed:()=>{},openExternal:()=>assert.fail('unexpected navigation'),
    supported:true,fetcher:(url,opts)=>{if(url===feed(version).exe&&opts.method==='GET')downloads++;return published(url,opts);},
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

test('A real web/CDN cooldown survives a restart and repeated manual checks, then clears on success',async t=>{
  const directory=await temp(t);let clock=4*DAY,calls=0;
  const make=()=>new UpdateService({directory,cache:directory,current:version,allowed:()=>true,supported:true,scheduled:false,now:()=>clock,changed:()=>{},
    fetcher:(url,opts)=>{calls++;return calls===1?new Response(null,{status:429,headers:{'retry-after':'90'}}):published(url,opts);}});
  let hub=make();await hub.check();assert.equal(hub.state().retryAt,clock+90000);
  hub.close();hub=make();t.after(()=>hub.close());
  await hub.check();assert.equal(calls,1);clock+=90001;
  assert.equal((await hub.check(true)).phase,'current');assert.equal(calls,2);assert.equal(hub.state().retryAt,0);
});

test('Installing from a Game LAN respects room-specific consent and waits for adapter cleanup',async t=>{
  for(const host of [false,true]){
    const directory=await temp(t),handlers=new Map(),prompts=[];
    const originalRoom={host},otherRoom={host};
    let room=originalRoom,answer=0,onPrompt=()=>{},leaves=0,released=false,launches=0;
    let finishCleanup,started;
    const cleanupStarted=new Promise(resolve=>{started=resolve;});
    const ctrl=registerUpdates({
      handle:(name,fn)=>handlers.set(name,fn),app:{getVersion:()=>'0.1.0',getPath:()=>directory,quit(){}},
      dialog:{showMessageBox:async(_window,options)=>{prompts.push(options);onPrompt();return {response:answer};}},
      window:()=>null,allowed:()=>true,updateBlocker:()=>'',gameRoom:()=>room,changed(){},supported:true,fetcher:published,
      leaveGame:async()=>{
        assert.equal(room,originalRoom);assert.ok(ctrl.launching);leaves++;room=null;started();
        await new Promise(resolve=>{finishCleanup=resolve;});released=true;
      },
      launcher:()=>{
        assert.ok(released);launches++;
        const child=new EventEmitter();child.unref=()=>{};process.nextTick(()=>child.emit('spawn'));return child;
      }
    });
    t.after(()=>ctrl.close());
    const op=name=>handlers.get('releases')({op:name});
    await op('check');await op('download');
    await op('install');assert.equal(leaves,0);assert.equal(room,originalRoom);
    assert.equal(prompts[0].buttons[1],'Выйти и установить');
    assert.ok(prompts[0].detail.includes(host?'закроется для всех':'вы выйдете'));
    answer=1;onPrompt=()=>{room=otherRoom;};
    await assert.rejects(op('install'),/комната изменилась/);assert.equal(leaves,0);
    onPrompt=()=>{};room=originalRoom;
    const installing=op('install');await cleanupStarted;
    assert.equal(launches,0);finishCleanup();await installing;
    assert.equal(leaves,1);assert.equal(launches,1);
  }
});
