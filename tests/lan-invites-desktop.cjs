'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const dictionary=require('../src/renderer/l10n/en.json');
const {addFriend,count}=require('./room-controls-desktop.cjs');

module.exports=async({a,b,open,create})=>{
  const en=process.env.LINK_QA_LANG==='en';
  const tr=value=>en?dictionary[value]:value;
  const c=await open('vera');await create(c,'Вера');await addFriend(b,c,'Вера');
  const host=a.page,guest=b.page;
  if(en){
    for(const page of [host,guest]){
      await page.evaluate(()=>localStorage.setItem('craftcode.language','en'));await page.reload();
    }
  }
  async function picture(page){
    await page.evaluate(async()=>{
      const image=new Image();image.src='assets/craftlink.png';await image.decode();
      const canvas=document.createElement('canvas');canvas.width=canvas.height=48;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#193337';ctx.fillRect(0,0,48,48);ctx.drawImage(image,1,1,46,46);
      const data=ctx.getImageData(0,0,48,48).data;
      let raw='';for(let i=0;i<data.length;i+=4)raw+=String.fromCharCode(data[i],data[i+1],data[i+2]);
      const {me}=await window.craftlink.direct({op:'state'});
      await window.craftlink.direct({op:'set-avatar',owner:me.id,pixels:btoa(raw)});
    });
  }
  async function screenshot(page,name){
    const directory=process.env.LINK_VISUAL_DIR;
    if(directory){await fs.mkdir(directory,{recursive:true});await page.screenshot({path:path.join(directory,name+'-'+(en?'en':'ru')+'.png')});}
  }
  const action=(scope,name)=>scope.getByRole('button',{name:tr(name),exact:true});
  async function stableFocus(page,button){
    await button.focus();
    await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
    assert(await button.evaluate(el=>document.activeElement===el));
  }
  async function roster(total){for(const page of [host,guest])await page.waitForFunction(n=>document.getElementById('gameCount').textContent===String(n),total);}
  await picture(host);await picture(guest);
  await guest.click('#navFriends');
  await action(guest.locator('#workspaceContacts .contact-card').filter({has:guest.getByText('Вера',{exact:true})}),'Позвонить').click();
  await c.page.click('#peerAccept');await count(guest,2);await count(c.page,2);
  await host.click('#navGame');await host.fill('#gameTitle','Вечерний матч');await host.click('#gameCreate button');
  await guest.click('#navFriends');await guest.focus('#bookQuery');
  await host.click('#gameSendInvite');
  const invite=guest.locator('#gameInvites .invite-card'),request=host.locator('#lanRequests .invite-card');
  await invite.waitFor({state:'attached'});
  assert(await guest.locator('#bookQuery').evaluate(el=>el===document.activeElement));
  assert(!await invite.isVisible());
  await guest.click('#navGame');
  await invite.locator('.invite-avatar canvas').waitFor();await invite.getByText('Анна',{exact:true}).waitFor();
  assert(await guest.locator('#gameReturns').isHidden(),'one invitation should not offer a second join request to the same room');
  await invite.getByText(tr('Ваш звонок продолжится')).waitFor();
  await invite.locator('.invite-avatar').click();
  await guest.locator('#contactActionsTitle').getByText('Анна',{exact:true}).waitFor();
  await guest.keyboard.press('Escape');
  for(const mode of ['reduce','no-preference']){
    await guest.emulateMedia({reducedMotion:mode});
    assert.equal(await invite.evaluate(el=>getComputedStyle(el).animationName),mode==='reduce'?'none':'invite-arrive');
  }
  await guest.evaluate(()=>document.documentElement.classList.add('reduce-motion'));
  assert.equal(await invite.evaluate(el=>getComputedStyle(el).animationName),'none');
  await guest.evaluate(()=>document.documentElement.classList.remove('reduce-motion'));
  await screenshot(guest,'lan-invitation-during-call');
  await stableFocus(guest,action(invite,'Отклонить'));await guest.keyboard.press('Enter');
  await invite.waitFor({state:'detached'});await count(guest,2);
  assert(await guest.locator('#gameSession').isHidden());
  await host.setViewportSize({width:800,height:620});
  await host.locator('#gameSession.lan-compact').waitFor();
  await host.locator('#gameMessage').focus();
  const ask=action(guest.locator('#gameReturns'),'Попроситься в LAN');
  await ask.click();await request.waitFor({state:'attached'});
  assert(!await request.isVisible());assert.equal(await host.locator('#lanRequestCount').innerText(),'1');
  assert(await host.locator('#gameMessage').evaluate(el=>el===document.activeElement));
  await host.click('#gameMembersToggle');await request.locator('.invite-avatar canvas').waitFor();
  await request.getByText('Борис',{exact:true}).waitFor();
  assert(await host.locator('#gameInviteBox').isHidden(),'an applicant should not be prompted to accept another invitation');
  assert(await request.evaluate(el=>{
    const copy=el.querySelector('.invite-copy').getBoundingClientRect(),actions=el.querySelector('.invite-actions').getBoundingClientRect();
    return actions.top>=copy.bottom&&el.scrollWidth<=el.clientWidth+1&&actions.right<=innerWidth;
  }));
  await screenshot(host,'lan-request-compact');
  await action(request,'Отклонить').click();await request.waitFor({state:'detached'});await count(guest,2);
  await host.keyboard.press('Escape');await host.click('#navFriends');
  await ask.click();
  await action(host.locator('#toast'),'Открыть заявку').click();
  await request.locator('.invite-avatar').waitFor();
  assert(await request.locator('.invite-avatar').evaluate(el=>el===document.activeElement));
  await action(request,'Принять').click();await roster(2);await count(guest,2);
  await guest.click('#gameLeave');await guest.locator('#gameLobby').waitFor();await count(c.page,2);
  await host.setViewportSize({width:1440,height:900});
  await guest.setViewportSize({width:800,height:620});
  await host.click('#gameSendInvite');await action(invite,'Принять').waitFor();
  assert(await invite.evaluate(el=>el.scrollWidth<=el.clientWidth+1&&el.getBoundingClientRect().right<=innerWidth));
  await screenshot(guest,'lan-invitation-compact');
  await action(invite,'Принять').click();await roster(2);await count(guest,2);await count(c.page,2);
  const states=await Promise.all([host,guest].map(p=>p.evaluate(()=>window.craftlink.direct({op:'state'}))));
  assert.deepEqual(states.map(s=>s.game.room.roster.length),[2,2]);
  assert(states.every(s=>!['ready','starting'].includes(s.game.network.phase)));
  console.log('PASS LAN invitations and admission over three real Electron clients; verified both decisions, real portraits, an independent ongoing call, keyboard, unchanged external focus, compact layout and reduced motion in '+(en?'EN':'RU')+'.');
};
