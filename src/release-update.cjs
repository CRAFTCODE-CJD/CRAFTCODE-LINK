'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {tr}=require('./native-language.cjs');
const {spawn}=require('node:child_process');
const {UpdateService}=require('./update-service.cjs');
const {removeStage}=require('./github-releases.cjs');
const {cacheDirectory}=require('./update-download.cjs');
const {offlineManifest,maxSize}=require('./offline-update.cjs');
const invalidFile=message=>Object.assign(Error(tr(message)),{code:'UPDATE_INVALID_PAYLOAD'});
async function verifyInstaller(input,expected,output){
  const stat=await input.stat(),offset=expected.offset??0,size=stat.size-offset;
  if(!stat.isFile()||size<2||size>maxSize||(expected.bytes!==undefined&&size!==expected.bytes))throw invalidFile('Неверный файл установщика.');
  const buffer=Buffer.alloc(256*1024),hash=crypto.createHash('sha256');let pos=0;
  while(pos<size){
    const {bytesRead}=await input.read(buffer,0,Math.min(buffer.length,size-pos),offset+pos);
    if(!bytesRead || (!pos&&buffer[0]!==0x4d) || (pos<2&&pos+bytesRead>=2&&buffer[1-pos]!==0x5a))
      throw invalidFile('Неверный файл установщика.');
    const bytes=buffer.subarray(0,bytesRead);hash.update(bytes);if(output)await output.writeFile(bytes);pos+=bytesRead;
  }
  if(hash.digest('hex')!==expected.sha)throw invalidFile('Установщик отличается от выпуска CRAFTCODE.');
}
async function stage(file,dir,expected){
  dir=await cacheDirectory(dir,true);
  const work=await fs.mkdtemp(path.join(dir,'install-')),dest=path.join(work,expected.name);
  let input,output;
  try{
    input=await fs.open(file,'r');output=await fs.open(dest,'wx',0o700);
    await verifyInstaller(input,expected,output);
    await output.sync();await output.close();output=null;return dest;
  }catch(e){
    await output?.close().catch(()=>{});await removeStage(work);throw e;
  }finally{await input?.close().catch(()=>{});}
}
async function cleanup(dir,{strict=false}={}){
  try{dir=await cacheDirectory(dir);}catch(e){if(e.code==='ENOENT')return;throw e;}
  const list=await fs.readdir(dir,{withFileTypes:true});
  for(const e of list)if(e.isDirectory()&&/^install-[a-zA-Z0-9]{6}$/.test(e.name))
    await removeStage(path.join(dir,e.name)).catch(e=>{if(strict)throw e;});
}
function registerUpdates({handle,app,dialog,window,allowed,updateBlocker,gameRoom,leaveGame,changed,announce,openExternal,
  supported=process.platform==='win32'&&process.arch==='x64',fetcher,launcher=spawn}){
  const dir=path.join(app.getPath('userData'),'update-cache');
  let busy=false,launching=false,closed=false;
  function ensureAvailable(){
    if(closed)throw Error(tr('Приложение завершает работу.'));
    const blocker=updateBlocker();
    if(blocker)throw Error(tr(blocker));
  }
  async function confirmInstall(file,expected){
    ensureAvailable();
    const room=gameRoom();
    const detail=room ? (room.host
      ? 'Вы организатор игровой LAN. При установке комната закроется для всех участников. LINK отключит игровой адаптер и запустит установщик.'
      : 'При установке вы выйдете из игровой LAN. LINK отключит игровой адаптер и запустит установщик.')
      : 'LINK проверит установщик и закроется для установки обновления.';
    const {response}=await dialog.showMessageBox(window(),{type:'question',message:tr('Установить CRAFTCODE LINK ')+expected.version+'?',
      detail:tr(detail),buttons:[tr('Отмена'),tr(room?'Выйти и установить':'Установить')],defaultId:0,cancelId:0});
    if(response!==1)return false;
    ensureAvailable();let copy=await stage(file,dir,expected);
    try{
      ensureAvailable();
      if(gameRoom() && gameRoom()!==room)throw Error(tr('Игровая комната изменилась. Нажмите «Установить» снова.'));
      launching=true;
      if(room && room===gameRoom())await leaveGame();
      ensureAvailable();
      if(gameRoom())throw Error(tr('Игровая комната изменилась. Нажмите «Установить» снова.'));
      await new Promise((resolve,reject)=>{const child=launcher(copy,[],{shell:false,detached:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
      copy=null;app.quit();return true;
    }finally{if(copy){launching=false;await removeStage(path.dirname(copy));}}
  }
  const hub=new UpdateService({directory:app.getPath('userData'),cache:dir,current:app.getVersion(),allowed,supported,
    scheduled:app.isPackaged===true,changed,announce,openExternal,fetcher,install:async(file,expected)=>{
      if(busy)throw Error(tr('Обновление уже открыто.'));
      busy=true;try{return await confirmInstall(file,expected);}finally{busy=false;}
    }});
  const ready=cleanup(dir).then(()=>hub.restore());
  // An inaccessible cache is reported by IPC when the update panel is opened.
  ready.catch(()=>{});
  handle('releases',async raw=>{await ready;return hub.command(raw);});
  handle('install-release',async raw=>{
    if(raw!==undefined)throw Error(tr('Некорректная команда.'));
    if(!supported)throw Error(tr('Этот установщик предназначен для Windows x64.'));
    if(busy)throw Error(tr('Обновление уже открыто.'));
    ensureAvailable();busy=true;
    try{
      await ready;
      const picked=await dialog.showOpenDialog(window(),{title:tr('Открыть пакет обновления'),properties:['openFile'],filters:[{name:'CRAFTCODE LINK',extensions:['linkupdate']}]});
      if(picked.canceled)return false;
      ensureAvailable();
      const file=picked.filePaths[0],handle=await fs.open(file,'r');
      let expected;
      try{
        expected=await offlineManifest(handle,app.getVersion());
        await verifyInstaller(handle,expected);
      }finally{await handle.close();}
      // The selected file can be replaced while the confirmation dialog is open.
      // stage() rechecks the signed digest while copying to the private cache.
      return await confirmInstall(file,expected);
    }finally{busy=false;}
  });
  return {policy:()=>{if(!allowed())hub.policy();else ready.then(()=>hub.policy()).catch(()=>{});},announceAvailable:()=>hub.announceAvailable(),close:()=>{closed=true;hub.close();},get launching(){return launching;},
    async clearCache(){
      if(busy||launching||closed)throw Error(tr('Дождитесь завершения текущей операции обновления.'));
      busy=true;try{await ready;await hub.clearCache(dir=>cleanup(dir,{strict:true}));}finally{busy=false;}
    }};
}
module.exports={stage,cleanup,registerUpdates};
