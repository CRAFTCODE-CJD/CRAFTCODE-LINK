'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {tr} = require('../native-language.cjs');

function gameAddress(service) {
  const room=service.game.active, member=service.gameNet.mine();
  if(!room || room.waiting || service.gameNet.phase!=='ready' || !member)return null;
  const address=room.prefix+'.'+member.slot;
  return net.isIPv4(address) ? {room:room.id,address} : null;
}

// The selection and all arguments originate on this PC. Never accept a path from a peer or the renderer.
async function launchUnreal(service,dialog,window,host={platform:process.platform,files:fs,spawn},target=null,port=7777){
  const state=gameAddress(service);
  if(!state || host.platform!=='win32')throw Error(tr('Сначала включите игровую сеть на этом ПК.'));
  function checkPort(){
    const remote=target&&service.game.active?.roster.find(p=>p.device===target&&p.ready);
    const learned=remote&&service.gameNet.discovery?.listener(service.gameNet.mine()?.slot,remote.slot,port);
    if(!learned&&!service.gameNet.ports.allows('UDP',port))throw Error(tr('Сначала разрешите этот UDP-порт в настройках игровой сети.'));
  }
  checkPort();
  function targetAddress(){
    if(!target)return '';
    const r=service.game.active, remote=r?.roster?.find(p=>p.device===target && p.device!==service.gameNet.mine()?.device && p.ready);
    if(!remote || !net.isIPv4(r.prefix+'.'+remote.slot))throw Error(tr('Игровой хост больше недоступен.'));
    return r.prefix+'.'+remote.slot+':'+port;
  }
  const destination=targetAddress();
  const args=[...(destination?[destination]:[]),'-MULTIHOME='+state.address];
  if(!destination && port!==7777)args.push('-port='+port);
  const selected=await dialog.showOpenDialog(window,{title:tr('Выберите установленную игру'),properties:['openFile','dontAddToRecent'],
    filters:[{name:tr('Приложение Windows'),extensions:['exe']}]});
  if(selected.canceled || selected.filePaths.length!==1)return;
  const file=await host.files.realpath(selected.filePaths[0]);
  if(!/^[a-z]:[\\/]/i.test(file)||path.extname(file).toLowerCase()!=='.exe'||!(await host.files.stat(file)).isFile())
    throw Error(tr('Выберите EXE-файл установленной игры на этом ПК.'));
  const confirmed=await dialog.showMessageBox(window,{type:'question',title:tr('Запустить игру через LINK?'),
    message:path.win32.basename(file),detail:file+'\n\n'+args.join(' '),
    buttons:[tr('Отмена'),tr('Запустить игру')],defaultId:0,cancelId:0,noLink:true});
  if(confirmed.response!==1)return;
  const current=gameAddress(service);
  if(current?.room!==state.room||current.address!==state.address||targetAddress()!==destination)throw Error(tr('Игровая сеть изменилась. Откройте запуск снова.'));
  checkPort();
  await new Promise((resolve,reject)=>{
    const proc=host.spawn(file,args,{shell:false,detached:true,cwd:path.win32.dirname(file),stdio:'ignore'});
    proc.once('error',reject);proc.once('spawn',()=>{proc.unref();resolve();});
  });
}
module.exports={gameAddress,launchUnreal};
