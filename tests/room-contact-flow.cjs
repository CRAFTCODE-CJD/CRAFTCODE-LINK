'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const dictionary=require('../src/renderer/l10n/en.json');
module.exports=async function roomContactFlow(page,guest,keys,language){
  const tr=text=>language==='en'?dictionary[text]:text;
  await page.evaluate(keys=>{
    const original=window.craftlink.direct;
    const scope='a'.repeat(64),person=keys[1],owner=keys[0];
    const peers=[{id:'host',slot:0,name:'Анна',micMuted:true,sharing:false},
      {id:'guest',slot:1,name:'Борис',micMuted:true,sharing:false}];
    const control=window.roomContactFixture={relation:'unknown',introduced:true,reads:0,calls:[],present:true,inCall:true};
    const info={role:'host',selfId:'host',hostId:'host',peers,direct:true,usePeerIce:false,mixRoom:scope};
    window.craftlink.direct=async request=>{
      if(request.op==='host'){roomFixture.emit({type:'direct-host',info});return true;}
      if(request.op==='room-add'){
        if(request.owner!==owner||request.room!==scope||request.person!==person||request.peer!=='guest'||!control.present)
          throw Error('Stale room request');
        control.calls.push(request);control.relation='invited';return 'sent';
      }
      const data=await original(request);
      if(request.op==='state'){
        control.reads++;
        const friend={id:person,device:person,name:'Борис',state:control.relation,online:true,status:'online',
          inCall:control.inCall,rooms:[],chat:{unread:0,last:null,supported:true}};
        data.friends=['friend','invited'].includes(control.relation)?[friend]:[];
        data.requests=control.relation==='incoming'?[{id:person,name:'Борис'}]:[];
        data.blocked=control.relation==='blocked'?[{id:person,name:'Борис'}]:[];
        data.mixRoom=scope;data.roomContacts=control.relation==='friend'?{guest:person}:{};
        data.roomPeople=control.introduced&&control.present?{guest:{id:person,name:'Борис',room:scope,peer:'guest'}}:{};
      }
      return data;
    };
    control.refresh=()=>roomFixture.refresh();
    control.roster=()=>roomFixture.emit({type:'roster',peers:control.present?peers:[peers[0]]});
  },keys);
  async function update(values){
    const before=await page.evaluate(()=>roomContactFixture.reads);
    await page.evaluate(values=>{Object.assign(roomContactFixture,values);roomContactFixture.refresh();},values);
    await page.waitForFunction(before=>roomContactFixture.reads>before,before);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  }
  async function personMenu(){
    await page.locator('.voice-tile[data-slot="1"] .tile-sound-menu').click();
    await page.locator('#participantSoundMenu').getByRole('button',{name:tr('Карточка участника'),exact:true}).click();
    await page.locator('#contactActions:modal').waitFor();
  }
  await guest.evaluate(()=>{roomFixture.enter();roomFixture.roster();});
  await update({});await page.click('#linkHost');await page.locator('.voice-tile[data-slot="1"]').waitFor();
  await personMenu();
  const choices=page.locator('#contactChoices');
  await choices.getByText(tr('Карточка LINK проверена для этой комнаты. Отправьте заявку, чтобы стать друзьями.'),{exact:true}).waitFor();
  assert((await choices.locator('.participant-id').textContent()).includes(keys[1]));
  if(process.env.LINK_UI_QA_IMAGES){
    await fs.mkdir(process.env.LINK_UI_QA_IMAGES,{recursive:true});
    await page.screenshot({path:path.join(process.env.LINK_UI_QA_IMAGES,'room-add-friend-'+language+'.png')});
  }
  await choices.getByRole('button',{name:tr('Добавить в друзья'),exact:true}).click();
  await page.waitForFunction(()=>roomContactFixture.calls.length===1);
  await personMenu();assert.equal(await choices.getByRole('button',{name:tr('Добавить в друзья'),exact:true}).count(),0);
  await choices.getByRole('button',{name:tr('Открыть заявки'),exact:true}).waitFor();await page.click('#closeContactActions');

  await update({relation:'friend'});await personMenu();
  await choices.getByRole('button',{name:tr('Личный чат'),exact:true}).waitFor();await page.click('#closeContactActions');
  async function statusAt(selector,text){
    await page.locator(selector).waitFor();
    await page.waitForFunction(({selector,text})=>document.querySelector(selector)?.textContent===text,{selector,text});
    assert.equal(await page.locator(selector).textContent(),text);
  }
  const sidebar='#quickPeople [data-person="'+keys[1]+'"]',sidebarStatus=sidebar+' .context-contact-label small';
  const preview='#dmList [data-person="'+keys[1]+'"] .dm-preview';
  await page.click('#navFriends');
  await statusAt(sidebarStatus,tr('Сейчас в звонке'));
  assert.equal(await page.locator(sidebar).getAttribute('title'),'Борис · '+tr('Сейчас в звонке'));
  if(process.env.LINK_UI_QA_IMAGES)await page.screenshot({path:path.join(process.env.LINK_UI_QA_IMAGES,'friend-call-presence-'+language+'.png')});
  // Only inCall changes: online status, avatar, name and unread count stay the
  // same. Both cached lists must invalidate in either direction while visible.
  await update({inCall:false});
  await statusAt(sidebarStatus,tr('В сети'));
  assert.equal(await page.locator(sidebar).getAttribute('title'),'Борис · '+tr('В сети'));
  await update({inCall:true});await statusAt(sidebarStatus,tr('Сейчас в звонке'));
  await page.click('#navChats');
  assert.equal(await page.evaluate(()=>roomContactFixture.inCall),true);
  await statusAt(preview,tr('Сейчас в звонке'));
  await update({inCall:false});await statusAt(preview,tr('В сети'));
  await update({inCall:true});await statusAt(preview,tr('Сейчас в звонке'));
  await page.click('#navRoom');await page.locator('.voice-tile[data-slot="1"]').waitFor();

  await update({relation:'blocked'});await personMenu();
  await choices.getByRole('button',{name:tr('Заблокированные контакты'),exact:true}).waitFor();
  assert.equal(await choices.getByRole('button',{name:tr('Добавить в друзья'),exact:true}).count(),0);await page.click('#closeContactActions');
  await update({relation:'unknown',introduced:false});await personMenu();
  assert.equal(await choices.locator('.participant-id').count(),0);
  assert.equal(await choices.getByRole('button',{name:tr('Добавить в друзья'),exact:true}).count(),0);
  await choices.getByRole('button',{name:tr('Вставить карточку друга'),exact:true}).waitFor();await page.click('#closeContactActions');

  await update({introduced:true});await personMenu();
  await update({introduced:false});
  await page.locator('#contactActions:modal').waitFor({state:'detached'});
  await update({introduced:true});await personMenu();
  await page.evaluate(()=>{roomContactFixture.present=false;roomContactFixture.roster();roomContactFixture.refresh();});
  await page.locator('.voice-tile[data-slot="1"]').waitFor({state:'detached'});
  await page.locator('#contactActions:modal').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>roomContactFixture.calls.length),1,'a participant who left must not be added by an old dialog');
  console.log('PASS '+language+' room profile action, explicit friend request, pending/friend/blocked states, call status, legacy fallback and stale dialog. Native identity transport is verified separately in room-people.test.cjs.');
};
