'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {generalsPlan}=require('../src/game/generals-options.cjs');
const {launchUnreal}=require('../src/game/unreal-launch.cjs');

const local='10.90.2.2',physical='10.0.0.2',defaultOptions='IPAddress = '+physical+'\r\nGameSpyIPAddress = 192.0.2.7\r\nMusicVolume = 65\r\n';
async function game(t,edition='Zero Hour'){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'link-generals-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'generals.exe'),leaf='Game Data',folder=path.join(dir,leaf);
  for(const name of ['generals.exe','game.dat',edition==='Generals'?'INI.big':'INIZH.big'])
    await fs.writeFile(path.join(dir,name),'fixture');
  await fs.mkdir(folder);
  const options=path.join(folder,'Options.ini');
  await fs.writeFile(options,defaultOptions);
  const feedback={leaf,busy:false};
  const host={documents:()=>dir,addresses:async()=>[local,physical],inspect:async name=>{assert.equal(name,edition);return feedback;}};
  return {dir,file,options,host,feedback,plan:()=>generalsPlan(file,local,host)};
}
test('both editions select the stored active IP, otherwise the numerically first enumerated Windows address',async t=>{
  for(const edition of ['Generals','Zero Hour']){
    const f=await game(t,edition);
    assert.equal(typeof (await f.plan()).apply,'function');
    await fs.writeFile(f.options,'IPAddress = 192.0.2.214\n');
    assert.equal(typeof (await f.plan()).apply,'function');
    f.host.addresses=async()=>['192.0.2.30',local];
    assert.equal(await f.plan(),null);
    await fs.writeFile(f.options,'IPAddress = '+local);
    f.host.addresses=async()=>[physical,local];assert.equal(await f.plan(),null);
    f.host.addresses=async()=>[physical];assert.equal((await f.plan()).apply,undefined);
  }
});
test('save changes the LAN key in the confirmed file only, preserving ANSI, duplicates and line endings',async t=>{
  const f=await game(t);
  const input=Buffer.from('\xe9\r\n  IPAddress =  0.0.0.0\r\n'+defaultOptions,'latin1');
  await fs.writeFile(f.options,input);
  await (await f.plan()).apply(()=>{});
  assert.deepEqual(await fs.readFile(f.options),Buffer.from(input.toString('latin1').replace('0.0.0.0',local).replace(physical,local),'latin1'));
  await fs.writeFile(f.options,'MusicVolume = 65');
  await (await f.plan()).apply(()=>{});
  assert.equal(await fs.readFile(f.options,'utf8'),'MusicVolume = 65\r\nIPAddress = '+local+'\r\n');
});
test('recognizes both open-source binaries only alongside matching original game data',async t=>{
  for(const [edition,binary,archive,other] of [['Generals','generalsv.exe','INI.big','INIZH.big'],['Zero Hour','generalszh.exe','INIZH.big','INI.big']]){
    const f=await game(t,edition),file=path.join(f.dir,binary);
    await fs.rename(f.file,file);
    assert.equal(typeof (await generalsPlan(file,local,f.host)).apply,'function');
    await fs.rename(path.join(f.dir,archive),path.join(f.dir,other));
    assert.equal(await generalsPlan(file,local,f.host),null);
  }
});
test('running game, changed file, lost seat, links and unsafe registry leaves prevent writes',async t=>{
  const f=await game(t);
  const plan=await f.plan();
  f.feedback.busy=true;assert.equal((await f.plan()).apply,undefined);await assert.rejects(plan.apply(()=>{}));
  f.feedback.busy=false;
  await fs.appendFile(f.options,'Other = 1');await assert.rejects(plan.apply(()=>{}));
  const current=await fs.readFile(f.options);
  await assert.rejects((await f.plan()).apply(()=>{throw Error('room changed');}),/room changed/);
  const other=path.join(f.dir,'Other.ini');await fs.link(f.options,other);
  assert.equal((await f.plan()).apply,undefined);assert.deepEqual(await fs.readFile(other),current);
  assert.deepEqual(await fs.readdir(path.dirname(f.options)),['Options.ini']);
  f.feedback.leaf='../Game Data';assert.equal((await f.plan()).apply,undefined);
});
test('normal saved-game launch offers cancel, launch unchanged and save explicitly', {skip:process.platform!=='win32'},async t=>{
  const f=await game(t),file=await fs.realpath(f.file);
  const choice={file,mode:'plain'},service={me:{id:'p'},profile:{gameLaunch:choice},game:{active:{id:'r',prefix:'10.90.2'}},
    gameNet:{phase:'ready',mine:()=>({slot:2})}};
  let launches=0,answer=0;
  const host={platform:'win32',files:fs,generals:f.host,spawn(_file,args){
    launches++;assert.deepEqual(args,[]);const proc=Object.assign(new EventEmitter(),{unref(){}});
    queueMicrotask(()=>proc.emit('spawn'));return proc;
  }};
  const dialog={async showMessageBox(_w,opts){
    assert.equal(opts.buttons.length,3);assert.ok(opts.detail.includes('IPAddress = '+local));return {response:answer};
  }};
  for(answer of [0,2,1]){
    await launchUnreal(service,dialog,null,host,null,7777,choice);
    assert.equal(launches,answer===1?2:answer===2?1:0);
    assert.equal(await fs.readFile(f.options,'utf8'),answer===1?defaultOptions.replace(physical,local):defaultOptions);
  }
});
