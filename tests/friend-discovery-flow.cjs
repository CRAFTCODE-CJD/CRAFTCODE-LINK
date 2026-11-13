'use strict';
const assert=require('node:assert/strict');

module.exports=async function friendDiscovery(page,people,tr){
  await page.evaluate(people=>{
    const direct=window.craftlink.direct;
    const friends=people.map((id,i)=>({id:id.slice(0,63)+(i+3),name:i?'Саша':'Миша',state:'friend',online:false,devices:[]}));
    const data={dht:false,lan:'',lanReady:false,discovery:'off',privacy:{status:'online'},friends,lastContactRefresh:0};
    let finish;
    const commands=[];
    window.discoveryFixture={
      commands,change(fields){Object.assign(data,fields);roomFixture.refresh();},
      finish(){data.lastContactRefresh=Date.now();finish();},
      online(i){friends[i].online=true;roomFixture.refresh();}
    };
    window.craftlink.direct=async request=>{
      if(request.op==='state')return {...await direct(request),...data};
      commands.push(request.op);
      if(request.op==='refresh')await new Promise(resolve=>{finish=resolve;});
      return direct(request);
    };
    roomFixture.refresh();
  },people);
  await page.click('#navFriends');
  const status=page.locator('#bookPresenceText'),button=page.locator('#bookPresenceAction');
  const check=text=>status.getByText(tr(text),{exact:false}).waitFor();
  const change=fields=>page.evaluate(fields=>discoveryFixture.change(fields),fields);
  await check('Поиск друзей выключен на этом ПК.');
  await button.click();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'directDht');
  await page.click('#closeSettingsDialog');
  await change({privacy:{status:'invisible'}});
  await check('Поиск приостановлен в невидимом режиме.');
  await button.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'directStatus');
  await page.click('#closeSettingsDialog');
  await page.click('#settingsBtn');
  await page.click('.pref-nav [data-pane=connection]');
  await page.click('#advancedRouting summary');
  await page.check('#strictProxy');
  await page.click('#closeSettingsDialog');
  await check('Прямой поиск отключён в режиме «Только через ретранслятор».');
  await button.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'strictProxy');
  assert(await page.isChecked('#strictProxy'));
  await page.uncheck('#strictProxy');
  await page.click('#closeSettingsDialog');
  await change({privacy:{status:'online'},dht:true,discovery:'connecting'});
  await check('Подключаемся к интернет-поиску LINK…');
  await change({discovery:'retry'});
  await check('Не удалось подключиться к интернет-поиску. LINK попробует снова.');
  await page.context().setOffline(true);
  await check('На этом ПК нет подключения к сети по данным системы.');
  await page.context().setOffline(false);
  await check('Не удалось подключиться к интернет-поиску. LINK попробует снова.');
  await change({discovery:'ready'});
  await check('Интернет-поиск доступен.');
  await check('Связь с друзьями пока не установлена.');
  await button.press('Enter');
  await check('Запрашиваем повторный поиск…');
  assert(await button.isDisabled());
  await button.evaluate(element=>element.click());
  await page.evaluate(()=>discoveryFixture.finish());
  await status.getByText(tr('Повторный поиск запрошен в {time}.').split('{time}')[0],{exact:false}).waitFor();
  await change({dht:false,lan:'Demo LAN',lanReady:false});
  await check('Выбранная локальная сеть пока недоступна.');
  await button.click();
  await page.locator('#directDialog #directNic').waitFor();
  await page.click('#directClose');
  await change({lanReady:true});
  await check('Для связи оба устройства должны выбрать одну локальную сеть.');
  assert.equal(await button.innerText(),tr('Обновить связь'));
  await page.evaluate(()=>discoveryFixture.online(0));
  await status.getByText(tr('Друзья на связи · {online} из {total}.').replace('{online}','1').replace('{total}','2'),{exact:false}).waitFor();
  await page.evaluate(()=>discoveryFixture.online(1));
  await page.locator('#bookPresence').waitFor({state:'hidden'});
  const commands=await page.evaluate(()=>discoveryFixture.commands);
  assert.equal(commands.filter(op=>op==='refresh').length,1);
  assert(!commands.includes('settings')&&!commands.includes('set-contact-privacy'));
  console.log('PASS friend discovery: disabled, invisible, strict, startup, publication failed, OS offline, ready, contact counts, missing LAN, local-only, keyboard retry and request time.');
};
