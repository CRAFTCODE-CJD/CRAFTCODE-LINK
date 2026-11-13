'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {tr}=require('../native-language.cjs');

function launchSelection(value){
  if(!value||typeof value.file!=='string'||value.file.length>32760||
    !/^[a-z]:[\\/][^<>:"|?*\x00-\x1f]+\.exe$/i.test(value.file)||
    !['plain','unreal'].includes(value.mode))return null;
  return {file:value.file,mode:value.mode};
}
function launcherState(profile){
  const choice=launchSelection(profile?.gameLaunch);
  return {selected:!!choice,name:choice?path.win32.basename(choice.file):'',mode:choice?.mode||'plain'};
}
function current(service,profileId,roomId){
  if(!profileId||service.me?.id!==profileId)throw Error(tr('Профиль LINK изменился. Откройте диалог снова.'));
  if(!roomId||service.game.active?.id!==roomId||service.game.active.waiting)
    throw Error(tr('Игровая сеть изменилась. Откройте запуск снова.'));
}
async function executable(file,files=fs){
  const canonical=await files.realpath(file);
  if(!launchSelection({file:canonical,mode:'plain'})||!(await files.stat(canonical)).isFile())
    throw Error(tr('Выберите EXE-файл установленной игры на этом ПК.'));
  return canonical;
}
async function selectGame(service,dialog,window,profileId,roomId,host={platform:process.platform,files:fs}){
  current(service,profileId,roomId);
  if(host.platform!=='win32')throw Error(tr('Запуск игр доступен в Windows.'));
  const picked=await dialog.showOpenDialog(window,{title:tr('Выберите установленную игру'),
    properties:['openFile','dontAddToRecent'],filters:[{name:tr('Приложение Windows'),extensions:['exe']}]});
  if(picked.canceled||picked.filePaths?.length!==1)return false;
  const file=await executable(picked.filePaths[0],host.files);
  current(service,profileId,roomId);
  // A new selection starts without engine-specific arguments. Device paths stay
  // in the OS-encrypted local profile and never enter a card or profile export.
  service.save({...service.profile,gameLaunch:{file,mode:'plain'}});
  return true;
}
function configureGame(service,profileId,roomId,mode){
  current(service,profileId,roomId);
  if(!['plain','unreal'].includes(mode))throw Error(tr('Выберите способ запуска игры.'));
  const choice=launchSelection(service.profile?.gameLaunch);
  if(!choice)throw Error(tr('Сначала выберите игру на этом ПК.'));
  service.save({...service.profile,gameLaunch:{...choice,mode}});
}
function forgetGame(service,profileId,roomId){
  current(service,profileId,roomId);
  const next={...service.profile};delete next.gameLaunch;service.save(next);
}
module.exports={launchSelection,launcherState,executable,selectGame,configureGame,forgetGame,current};
