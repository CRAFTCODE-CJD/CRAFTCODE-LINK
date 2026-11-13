'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {tr}=require('./native-language.cjs');
const {directory}=require('./storage-location.cjs');
const cacheNames=new Set(['Cache','Code Cache','GPUCache','DawnCache','DawnGraphiteCache','DawnWebGPUCache','GrShaderCache','ShaderCache','GraphiteDawnCache','Crashpad','logs','reports','update-cache','media-test']);

// Count only this product's own data. Downloads are not traversed, and links
// never authorize reading another tree. A changing file makes the size an estimate.
async function measure(directory){
  let bytes=0,cacheBytes=0,incomplete=false;
  async function walk(folder,cached=false){
    let entries;try{entries=await fs.readdir(folder,{withFileTypes:true});}catch{incomplete=true;return;}
    for(const entry of entries){
      const file=path.join(folder,entry.name),isCache=cached||folder===directory&&cacheNames.has(entry.name);
      try{
        const s=await fs.lstat(file);
        if(s.isSymbolicLink()){incomplete=true;continue;}
        if(s.isDirectory())await walk(file,isCache);
        else if(s.isFile()){bytes+=s.size;if(isCache)cacheBytes+=s.size;}
      }catch{incomplete=true;}
    }
  }
  const root=await fs.lstat(directory);
  if(!root.isDirectory()||root.isSymbolicLink())throw Error(tr('Не удалось безопасно открыть расположение данных LINK.'));
  await walk(directory);
  const stats=await fs.statfs(directory,{bigint:true});
  return {bytes,cacheBytes,free:Number(stats.bavail*stats.bsize),incomplete};
}

function createStorageControls({location,session,updates,restart,sessionActive,openDirectory}){
  let busy=false;
  async function snapshot(){const state=await location.snapshot();return {...state,...await measure(state.directory)};}
  async function command(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||typeof raw.op!=='string'||Object.keys(raw).some(k=>!['op','token'].includes(k)))throw Error(tr('Некорректная команда.'));
    if(busy)throw Error(tr('Дождитесь завершения операции с хранилищем.'));
    busy=true;
    try{
      switch(raw.op){
        case 'state':return await snapshot();
        case 'open-profile':case 'open-downloads':{
          const target=raw.op==='open-profile'?location.current:location.downloads();
          try{
            const folder=directory(target);
            if(await openDirectory(folder))throw Error();
          }catch{throw Error(tr('Не удалось открыть папку. Проверьте, доступен ли диск.'));}
          return true;
        }
        case 'clear-cache':{
          const before=await snapshot();
          await updates.clearCache();
          const ses=session();
          // Explicit cache types preserve Local Storage, authentication and all
          // profile databases. Chromium manages its active cache handles itself.
          await ses.clearData({dataTypes:['cache']});
          await ses.clearCodeCaches({});
          const after=await snapshot();return {...after,freed:Math.max(0,before.bytes-after.bytes)};
        }
        case 'restart':{
          if(sessionActive())throw Error(tr('Сначала завершите звонок и выйдите из игровой LAN.'));
          const state=await location.snapshot();
          if(!state.pending)throw Error(tr('Перенос хранилища не запланирован.'));
          await restart();return state;
        }
        case 'choose-location':case 'schedule-move':case 'cancel-move':case 'choose-downloads':{
          await location.command(raw);return await snapshot();
        }
        default:throw Error(tr('Неизвестная команда.'));
      }
    }finally{busy=false;}
  }
  return {command,snapshot};
}
module.exports={createStorageControls,measure};
