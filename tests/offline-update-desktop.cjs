'use strict';

// Windows QA with a publisher-signed package supplied by the release job.
// Only the file picker, confirmation and OS process boundary are simulated.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {createReadStream}=require('node:fs');
const {createHash}=require('node:crypto');
const {EventEmitter,once}=require('node:events');
const {spawn}=require('node:child_process');
const os=require('node:os'),path=require('node:path');
const {testRuntime}=require('./electron-runtime.cjs');
const {offlineManifest}=require('../src/offline-update.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function flipByte(file,position){
  const handle=await fs.open(file,'r+');
  try{
    const byte=Buffer.alloc(1);
    assert.equal((await handle.read(byte,0,1,position)).bytesRead,1);
    byte[0]^=1;
    assert.equal((await handle.write(byte,0,1,position)).bytesWritten,1);
  }finally{await handle.close();}
}

async function payloadHash(file){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}

async function desktop(){
  const {app,dialog,Notification}=require('electron');
  const root=process.env.LINK_OFFLINE_TEST_ROOT,language=process.env.LINK_QA_LANG;
  assert.equal(path.dirname(root),os.tmpdir());
  assert.match(path.basename(root),/^link-offline-update-/);
  app.setPath('appData',root);
  const installed=process.env.LINK_QA_INSTALLED||'0.7.19';
  let current=installed;
  app.getVersion=()=>current;
  Notification.isSupported=()=>false;
  dialog.showErrorBox=(_title,error)=>console.error(error);

  const source=process.env.LINK_QA_OFFLINE_PACKAGE,copy=path.join(root,'received.linkupdate');
  await fs.copyFile(source,copy);
  const handle=await fs.open(copy,'r');
  let expected;
  try{expected=await offlineManifest(handle,installed);}finally{await handle.close();}
  const signatureByte=expected.offset-1,bodyByte=expected.offset+expected.bytes-1;
  const labels=language==='en'
    ? {open:'Open update package',cancel:'Cancel',install:'Install',signature:'different publisher',payload:'does not match',active:'game room has changed',leave:'Leave and install',older:'already installed or older'}
    : {open:'Открыть пакет обновления',cancel:'Отмена',install:'Установить',signature:'другим издателем',payload:'отличается',active:'комната изменилась',leave:'Выйти и установить',older:'уже установлена или устарела'};
  let scenario='',launches=0,quits=0,js;
  const pickers=[],confirmations=[];
  const joinLan=()=>js("window.craftlink.direct({op:'game-create',title:'Local QA',listed:false}).then(()=>true)");
  const leaveLan=()=>js("window.craftlink.direct({op:'game-leave'}).then(()=>true)");
  dialog.showOpenDialog=async(_win,options)=>{
    pickers.push(options);
    if(scenario==='join-during-picker')await joinLan();
    return scenario==='cancel-picker'?{canceled:true,filePaths:[]}:{canceled:false,filePaths:[copy]};
  };
  dialog.showMessageBox=async(_win,options)=>{
    confirmations.push(options);
    if(scenario==='replace'){
      // Replace the actual selected path after validation, while consent is pending.
      await fs.rename(copy,path.join(root,'previous.linkupdate'));
      await fs.copyFile(source,copy);
      await flipByte(copy,bodyByte);
    }
    if(scenario==='join-during-confirmation')await joinLan();
    return {response:['cancel-install','in-LAN','join-during-picker'].includes(scenario)?0:1};
  };
  const release=require('../src/release-update.cjs'),register=release.registerUpdates;
  let cachedFile,currentRoom;
  release.registerUpdates=options=>{currentRoom=options.gameRoom;return register({...options,
    allowed:()=>false,
    app:{getVersion:app.getVersion,getPath:app.getPath.bind(app),quit:()=>{quits++;},isPackaged:false},
    launcher:(file,args,options)=>{
      launches++;
      assert.ok(!currentRoom(),'Game LAN must be left before launching');
      assert.equal(scenario,'install-in-LAN');
      assert.equal(path.basename(file),expected.name);
      assert.match(path.basename(path.dirname(file)),/^install-[a-zA-Z0-9]{6}$/);
      assert.equal(path.dirname(path.dirname(file)),path.join(app.getPath('userData'),'update-cache'));
      assert.deepEqual(args,[]);assert.deepEqual(options,{shell:false,detached:true,stdio:'ignore'});
      cachedFile=file;
      const child=new EventEmitter();child.unref=()=>{};
      setImmediate(()=>child.emit('spawn'));
      return child;
    }});};

  async function exercise(win){
    js=code=>win.webContents.executeJavaScript(code);
    async function until(code){
      const limit=Date.now()+15000;
      while(Date.now()<limit){if(await js(code))return;await sleep(60);}
      throw Error('Timed out: '+code);
    }
    const initialized="!!document.getElementById('introLanguage')?.onchange";
    await until(initialized);
    if(language==='en'){
      const reloaded=once(win.webContents,'did-finish-load');
      await js("const select=document.getElementById('introLanguage');select.value='en';select.dispatchEvent(new Event('change'))");
      await reloaded;await until(initialized);
    }
    assert.equal(await js('document.documentElement.lang'),language);
    await js("window.craftlink.direct({op:'create',name:'Demo'}).then(()=>true)");
    await js("document.getElementById('networkHelpBtn').click()");
    await until("document.getElementById('networkDialog').open");
    await js("document.getElementById('helpOpenUpdates').click()");
    await until("document.getElementById('updatesDialog').open");
    await until("document.getElementById('openOfflineUpdate').checkVisibility()");
    assert.equal(await js("document.getElementById('openOfflineUpdate').textContent.trim()"),labels.open);

    async function attempt(name,{picker=true,confirm=false,error='',success=false,inRoom=false}={}){
      scenario=name;
      const initialPickers=pickers.length,initialConfirms=confirmations.length;
      assert.equal(await js("document.getElementById('openOfflineUpdate').click();Promise.resolve().then(()=>document.getElementById('openOfflineUpdate').disabled)"),true);
      await until("!document.getElementById('openOfflineUpdate').disabled");
      const status=await js("document.getElementById('offlineUpdateStatus').textContent");
      assert.ok(error?status.includes(error):status==='',name+' status: '+status);
      assert.doesNotMatch(status,/Error invoking remote method|craftlink:install-release/);
      assert.equal(pickers.length,initialPickers+Number(picker),name+' picker count');
      assert.equal(confirmations.length,initialConfirms+Number(confirm),name+' confirmation count');
      if(picker){
        assert.equal(pickers.at(-1).title,labels.open);
        assert.deepEqual(pickers.at(-1).filters,[{name:'CRAFTCODE LINK',extensions:['linkupdate']}]);
      }
      if(confirm){
        const result=confirmations.at(-1);
        assert.ok(result.message.includes(expected.version));
        assert.deepEqual(result.buttons,[labels.cancel,inRoom?labels.leave:labels.install]);
        if(inRoom)assert.match(result.detail,language==='en'?/close the room for everyone/:/закроется для всех участников/);
        assert.equal(result.defaultId,0);assert.equal(result.cancelId,0);
      }
      assert.equal(launches,Number(success));assert.equal(quits,Number(success));
      if(!success){
        const stages=await fs.readdir(path.join(app.getPath('userData'),'update-cache')).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
        assert.ok(!stages.some(name=>name.startsWith('install-')),name+' left a staged installer');
      }
    }

    await attempt('cancel-picker');
    await attempt('cancel-install',{confirm:true});
    current=expected.version;
    await attempt('already-installed',{error:labels.older});
    current=installed;
    await flipByte(copy,signatureByte);await attempt('bad-signature',{error:labels.signature});await flipByte(copy,signatureByte);
    await flipByte(copy,bodyByte);await attempt('bad-body',{error:labels.payload});await flipByte(copy,bodyByte);
    await attempt('replace',{confirm:true,error:labels.payload});
    await fs.copyFile(source,copy);
    await joinLan();
    await until("document.getElementById('updateRoomNotice').checkVisibility()");
    await attempt('in-LAN',{confirm:true,inRoom:true});assert.ok(currentRoom(),'Cancel keeps the room');await leaveLan();
    await attempt('join-during-picker',{confirm:true,inRoom:true});assert.ok(currentRoom());await leaveLan();
    await attempt('join-during-confirmation',{confirm:true,error:labels.active});assert.ok(currentRoom());await leaveLan();
    await joinLan();await attempt('install-in-LAN',{confirm:true,inRoom:true,success:true});
    assert.equal((await fs.stat(cachedFile)).size,expected.bytes);
    const digest=await payloadHash(cachedFile);
    assert.equal(digest,expected.sha);
    console.log('PASS '+language+' offline update '+installed+' -> '+expected.version+': cancel, signature, payload, replacement, anti-rollback, active LAN before and during dialogs, '+expected.bytes+' verified bytes, SHA-256 '+digest+'. Installer launch simulated.');
  }
  app.on('browser-window-created',(_,win)=>{
    win.show=()=>{};win.showInactive=()=>{};win.hide();
    win.webContents.once('did-finish-load',()=>exercise(win).then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1);}));
  });
  require('../src/entry.cjs');
}

async function main(){
  if(process.versions.electron)return desktop();
  assert.ok(process.env.LINK_QA_OFFLINE_PACKAGE,'Supply a publisher-signed .linkupdate in LINK_QA_OFFLINE_PACKAGE.');
  for(const language of ['ru','en']){
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'link-offline-update-'));
    try{
      const env={...process.env,LINK_OFFLINE_TEST_ROOT:root,LINK_QA_LANG:language};delete env.ELECTRON_RUN_AS_NODE;
      const child=spawn(testRuntime(),[__filename,'--craftlink-profile=offline-update'],{env,windowsHide:true,stdio:'inherit'});
      const timeout=setTimeout(()=>child.kill(),90000);
      try{const [code]=await once(child,'exit');assert.equal(code,0,language+' offline update');}
      finally{clearTimeout(timeout);}
    }finally{await fs.rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
