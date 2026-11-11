'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {tr}=require('./native-language.cjs');
const {spawn}=require('node:child_process');
const {UpdateService}=require('./update-service.cjs');
const {removeStage}=require('./github-releases.cjs');
const maxSize=512*1024**2;
const {parseUpdateCode}=require('./renderer/release-code.mjs');
const invalidFile=message=>Object.assign(Error(tr(message)),{code:'UPDATE_INVALID_PAYLOAD'});
function release(code,current){
  const result=parseUpdateCode(code,current);
  if(result.error)throw Error(tr(result.error));
  return result;
}
async function stage(file,dir,expected){
  await fs.mkdir(dir,{recursive:true,mode:0o700});
  const work=await fs.mkdtemp(path.join(dir,'install-')),dest=path.join(work,expected.name);
  let input,output;
  try{
    input=await fs.open(file,'r');const stat=await input.stat();
    if(!stat.isFile()||stat.size<2||stat.size>maxSize)throw invalidFile('Неверный файл установщика.');
    output=await fs.open(dest,'wx',0o700);
    const buffer=Buffer.alloc(256*1024),hash=crypto.createHash('sha256');let pos=0;
    while(pos<stat.size){
      const {bytesRead}=await input.read(buffer,0,Math.min(buffer.length,stat.size-pos),pos);
      if(!bytesRead || (!pos&&buffer[0]!==0x4d) || (pos<2&&pos+bytesRead>=2&&buffer[1-pos]!==0x5a))
        throw invalidFile('Неверный файл установщика.');
      const bytes=buffer.subarray(0,bytesRead);hash.update(bytes);await output.writeFile(bytes);pos+=bytesRead;
    }
    if(hash.digest('hex')!==expected.sha)throw invalidFile('Установщик отличается от выпуска CRAFTCODE.');
    await output.sync();await output.close();output=null;return dest;
  }catch(e){
    await output?.close().catch(()=>{});await removeStage(work);throw e;
  }finally{await input?.close().catch(()=>{});}
}
async function cleanup(dir,{strict=false}={}){
  const stat=await fs.lstat(dir).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(!stat)return;
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error(tr('Не удалось безопасно открыть расположение данных LINK.'));
  const list=await fs.readdir(dir,{withFileTypes:true});
  for(const e of list)if(e.isDirectory()&&/^install-[a-zA-Z0-9]{6}$/.test(e.name))
    await removeStage(path.join(dir,e.name)).catch(e=>{if(strict)throw e;});
}
function registerUpdates({handle,app,dialog,window,completed,allowed,sessionActive,changed,openExternal,
  supported=process.platform==='win32'&&process.arch==='x64',fetcher,launcher=spawn}){
  const dir=path.join(app.getPath('userData'),'update-cache');
  const ready=cleanup(dir).catch(()=>{});let busy=false,launching=false,closed=false;
  function idle(){
    if(closed || launching)throw Error(tr('Приложение завершает работу.'));
    if(sessionActive())throw Error(tr('Сначала завершите звонок и выйдите из игровой LAN. Скачанный установщик можно открыть позже.'));
  }
  async function confirmInstall(file,expected){
    idle();
    const {response}=await dialog.showMessageBox(window(),{type:'question',message:tr('Установить CRAFTCODE LINK ')+expected.version+'?',
      detail:tr('LINK проверит установщик и закроется для установки обновления.'),buttons:[tr('Отмена'),tr('Установить')],defaultId:0,cancelId:0});
    if(response!==1)return false;
    idle();let copy=await stage(file,dir,expected);
    try{
      idle();launching=true;
      await new Promise((resolve,reject)=>{const child=launcher(copy,[],{shell:false,detached:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
      copy=null;app.quit();return true;
    }finally{if(copy){launching=false;await removeStage(path.dirname(copy));}}
  }
  const hub=new UpdateService({directory:app.getPath('userData'),cache:dir,current:app.getVersion(),allowed,supported,
    scheduled:app.isPackaged===true,changed,openExternal,fetcher,install:async(file,expected)=>{
      if(busy)throw Error(tr('Обновление уже открыто.'));
      busy=true;try{return await confirmInstall(file,expected);}finally{busy=false;}
    }});
  handle('releases',async raw=>{await ready;return hub.command(raw);});
  handle('install-release',async value=>{
    if(!supported)throw Error(tr('Этот установщик предназначен для Windows x64.'));
    if(busy)throw Error(tr('Обновление уже открыто.'));
    idle();busy=true;
    try{
      await ready;const expected=release(value?.code,app.getVersion());
      let file;
      if(value.token){file=completed(value.token);if(!file)throw Error(tr('Выберите сохранённый установщик.'));}
      else{
        const picked=await dialog.showOpenDialog(window(),{title:tr('Выберите сохранённый установщик.'),properties:['openFile'],filters:[{name:'CRAFTCODE LINK',extensions:['exe']}]});
        if(picked.canceled)return false;file=picked.filePaths[0];
      }
      return await confirmInstall(file,expected);
    }finally{busy=false;}
  });
  return {policy:()=>hub.policy(),close:()=>{closed=true;hub.close();},get launching(){return launching;},
    async clearCache(){
      if(busy||launching||closed)throw Error(tr('Дождитесь завершения текущей операции обновления.'));
      busy=true;try{await ready;await hub.clearCache(dir=>cleanup(dir,{strict:true}));}finally{busy=false;}
    }};
}
module.exports={release,stage,cleanup,registerUpdates};
