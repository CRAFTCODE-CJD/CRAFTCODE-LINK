'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {launchSelection,launcherState,selectGame,configureGame,forgetGame}=require('../src/game/launcher.cjs');
const {launchUnreal}=require('../src/game/unreal-launch.cjs');
const {ProfileStore,seed,seal,unseal}=require('../src/direct/identity.cjs');
const file='D:\\Games\\My Game\\Game.exe';
function fixture(){
  const starts=[];let selected=0;
  const service={me:{id:'profile'},profile:{name:'Test'},save(p){this.profile=p;},
    game:{active:{id:'room',prefix:'10.44.90',roster:[{slot:2,device:'friend',ready:true}]}},
    gameNet:{phase:'ready',ports:new (require('../src/game/ports.cjs').GamePorts)(),mine:()=>({slot:1,device:'self'})}};
  const host={platform:'win32',files:{realpath:async()=>file,stat:async()=>({isFile:()=>true})},spawn(...args){
    starts.push(args);const proc=Object.assign(new EventEmitter(),{unref(){}});queueMicrotask(()=>proc.emit('spawn'));return proc;
  }};
  const dialog={showOpenDialog:async()=>{selected++;return {filePaths:[file]};},showMessageBox:async()=>({response:1})};
  return {service,host,dialog,starts,selected:()=>selected};
}
test('local game selection is explicit, defaults to plain launch, exposes only a basename and can be forgotten',async()=>{
  const {service,host,dialog}=fixture();
  assert.equal(await selectGame(service,dialog,null,'profile','room',host),true);
  assert.deepEqual(service.profile.gameLaunch,{file,mode:'plain'});
  assert.deepEqual(launcherState(service.profile),{selected:true,name:'Game.exe',mode:'plain'});
  configureGame(service,'profile','room','unreal');assert.equal(service.profile.gameLaunch.mode,'unreal');
  assert.throws(()=>configureGame(service,'profile','room','shell'));
  forgetGame(service,'profile','room');assert.deepEqual(launcherState(service.profile),{selected:false,name:'',mode:'plain'});
  assert.throws(()=>configureGame(service,'profile','room','plain'));
});
test('cancelled, foreign-profile, changed-room and non-local executable selections never save a launcher',async()=>{
  const {service,host,dialog}=fixture();
  dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});
  assert.equal(await selectGame(service,dialog,null,'profile','room',host),false);
  await assert.rejects(selectGame(service,dialog,null,'other','room',host));
  dialog.showOpenDialog=async()=>{service.game.active.id='new';return {filePaths:[file]};};
  await assert.rejects(selectGame(service,dialog,null,'profile','room',host));
  assert.equal(service.profile.gameLaunch,undefined);
  for(const bad of ['\\\\server\\game.exe','C:\\Game.exe:stream','C:\\game.cmd','C:\\game.exe\n','/tmp/game.exe'])
    assert.equal(launchSelection({file:bad,mode:'plain'}),null);
});
test('saved game launches without a new picker or shell and Unreal arguments are an explicit mode',async()=>{
  const f=fixture();await selectGame(f.service,f.dialog,null,'profile','room',f.host);
  await launchUnreal(f.service,f.dialog,null,f.host,null,7777,f.service.profile.gameLaunch);
  assert.equal(f.selected(),1);assert.deepEqual(f.starts[0],[file,[],{shell:false,detached:true,cwd:'D:\\Games\\My Game',stdio:'ignore'}]);
  await assert.rejects(launchUnreal(f.service,f.dialog,null,f.host,'friend',7777,f.service.profile.gameLaunch));
  configureGame(f.service,'profile','room','unreal');
  await launchUnreal(f.service,f.dialog,null,f.host,'friend',7777,f.service.profile.gameLaunch);
  assert.deepEqual(f.starts[1][1],['10.44.90.2:7777','-MULTIHOME=10.44.90.1']);
  for(const port of [0,1023,65536,7777.5,'7777'])await assert.rejects(launchUnreal(f.service,f.dialog,null,f.host,null,port,f.service.profile.gameLaunch));
  assert.equal(f.starts.length,2);
});
test('launch cancellation and room, profile or selection changes during confirmation prevent execution',async()=>{
  for(const change of ['cancel','room','profile','selection','filesystem']){
    const f=fixture();await selectGame(f.service,f.dialog,null,'profile','room',f.host);
    f.dialog.showMessageBox=async()=>{
      if(change==='cancel')return {response:0};
      if(change==='room')f.service.game.active.id='new';
      if(change==='profile')f.service.me.id='other';
      if(change==='selection')f.service.profile.gameLaunch={file,mode:'unreal'};
      if(change==='filesystem')f.host.files.stat=async()=>{f.service.game.active=null;return {isFile:()=>true};};
      return {response:1};
    };
    const run=launchUnreal(f.service,f.dialog,null,f.host,null,7777,f.service.profile.gameLaunch);
    if(change==='cancel')await run;else await assert.rejects(run);
    assert.equal(f.starts.length,0,change);
  }
});
test('the selected executable survives a local encrypted-profile restart but is excluded from profile transfer',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'link-launcher-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const storage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  const store=new ProfileStore(directory,storage),profile={name:'Test',root:seed(),device:seed(),friends:[],gameLaunch:{file,mode:'plain'}};
  store.write(profile);assert.deepEqual(store.read().gameLaunch,profile.gameLaunch);
  const restored=await unseal(await seal(profile,'test-transfer-password'),'test-transfer-password');
  assert.equal(restored.gameLaunch,undefined);assert(!JSON.stringify(restored).includes('Game.exe'));
});
