'use strict';
const assert=require('node:assert/strict');
const {selectGame,configureGame,forgetGame,launcherState}=require('../src/game/launcher.cjs');

module.exports=async function verifyGameLauncher(page,tr){
  await page.bringToFront();
  const service={game:{},profile:{},save(profile){this.profile=profile;}};
  const files={async realpath(file){return file;},async stat(){return {isFile:()=>true};}};
  const picked='D:\\Example games\\Demo.exe',calls=[];
  let cancel=true,phase='off';
  const dialog={async showOpenDialog(){return {canceled:cancel,filePaths:cancel?[]:[picked]};}};
  await page.exposeFunction('qaLauncher',async r=>{
    if(r.op==='state'){
      service.me={id:r.person};service.game.active=r.room;
      return {launcher:launcherState(service.profile),phase};
    }
    calls.push(r.op);
    switch(r.op){
      case 'game-launcher-select':return selectGame(service,dialog,null,r.profileId,r.room,{files,platform:'win32'});
      case 'game-launcher-forget':return forgetGame(service,r.profileId,r.room);
      case 'game-launcher-mode':return configureGame(service,r.profileId,r.room,r.mode);
      case 'game-launch-saved':assert.equal(phase,'ready');return true;
      default:throw Error('Unexpected launcher command '+r.op);
    }
  });
  await page.evaluate(()=>{
    const bridge=window.craftlink,original=bridge.direct;
    bridge.direct=async r=>{
      if(r.op.startsWith('game-launcher-')||r.op==='game-launch-saved')return qaLauncher(r);
      const result=await original(r);
      if(r.op==='state'){
        const state=await qaLauncher({op:'state',person:result.me.id,room:result.game.room});
        result.game.launcher=state.launcher;result.game.network.phase=state.phase;
      }
      return result;
    };
  });
  await page.click('#navGame');await page.fill('#gameTitle','Evening match');await page.press('#gameTitle','Enter');
  await page.locator('#gameChatTab').press('End');
  assert.equal(await page.getAttribute('#gameNetworkTab','aria-selected'),'true');
  const summary=page.locator('#gameLauncher summary'),choose=page.locator('#gameChooseExe');
  assert.equal(await summary.textContent(),tr('Быстрый запуск игры'));
  await summary.press('Enter');await page.keyboard.press('Tab');
  const focused=id=>page.waitForFunction(id=>document.activeElement.id===id,id,{timeout:2500});
  await focused('gameChooseExe');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!document.querySelector('#gameChooseExe').disabled);
  assert.deepEqual(calls,['game-launcher-select']);assert.equal(await page.isVisible('#gameLaunchOptions'),false);
  await focused('gameChooseExe');
  cancel=false;await page.keyboard.press('Enter');await page.locator('#gameLaunchOptions').waitFor();
  assert.equal(await page.textContent('#gameSelectedName'),'Demo.exe');
  assert.equal(await choose.textContent(),tr('Выбрать другую игру…'));
  assert.equal(await page.inputValue('#gameLaunchMode'),'plain');assert.equal(await page.isVisible('#gameUnrealOptions'),false);
  assert.equal(await page.locator('#ueLaunch').isDisabled(),true);
  assert.equal(await page.textContent('#gameLaunchAvailability'),tr('Для запуска через LINK сначала включите игровую сеть Windows.'));
  cancel=true;await choose.click();await page.waitForFunction(()=>!document.querySelector('#gameChooseExe').disabled);
  assert.equal(await page.textContent('#gameSelectedName'),'Demo.exe');
  phase='ready';await page.evaluate(()=>roomFixture.refresh());await page.waitForFunction(()=>!document.querySelector('#ueLaunch').disabled);
  await page.selectOption('#gameLaunchMode','unreal');await page.locator('#gameUnrealOptions').waitFor();
  assert.equal(await page.inputValue('#gameLaunchMode'),'unreal');
  await page.locator('#ueLaunch').press('Enter');await page.waitForFunction(()=>!document.querySelector('#ueLaunch').disabled);
  await page.locator('#gameForgetExe').press('Enter');await page.locator('#gameLaunchOptions').waitFor({state:'hidden'});
  assert.equal(await page.isVisible('#gameForgetExe'),false);await focused('gameChooseExe');
  assert.equal(await choose.textContent(),tr('Выбрать игру…'));
  assert.deepEqual(calls,['game-launcher-select','game-launcher-select','game-launcher-select','game-launcher-mode','game-launch-saved','game-launcher-forget']);
  console.log('PASS '+await page.locator('html').getAttribute('lang')+' LAN quick launch: choose, cancel, replace/cancel, readiness, launch mode, keyboard focus and forget.');
};
