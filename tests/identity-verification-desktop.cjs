'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');

module.exports=async({a,b})=>{
  for(const client of [a,b])await client.page.waitForFunction(async()=>{
    const state=await window.craftlink.direct({op:'state'});
    return state.friends[0]?.online===true;
  });
  async function open(client){
    const p=client.page;
    if(await p.locator('#messagesPage').isHidden()){
      await p.click('#navChats');await p.locator('#dmList button').click();
    }
    await p.click('#dmActions summary');await p.click('#dmSecurity');
    await p.locator('#identityCode span').first().waitFor();
  }
  await open(a);await open(b);
  const aCode=await a.page.locator('#identityCode').innerText();
  assert.equal(aCode,await b.page.locator('#identityCode').innerText());
  assert.match(aCode.replace(/\s/g,''),/^[A-F0-9]{64}$/);
  console.log('SECURITY',await a.page.evaluate(async()=>{
    const s=await window.craftlink.direct({op:'state'});
    return window.craftlink.direct({op:'chat-security',profileId:s.me.id,id:s.friends[0].id});
  }));
  await a.page.getByText('Личное соединение зашифровано',{exact:true}).waitFor();
  await a.page.click('#identityCopy');
  const copied=await a.app.evaluate(()=>globalThis.testClipboard);
  assert.equal(copied.replace(/\s/g,''),aCode.replace(/\s/g,''));
  await a.page.click('#identityConfirm');
  await a.page.locator('#identityVerified').filter({hasText:'Код сверён на этом ПК'}).waitFor();
  assert.equal(await b.page.locator('#identityVerified').textContent(),'Код ещё не сверяли');
  await a.page.locator('#identityDialog').press('Escape');
  await open(a);
  assert.match(await a.page.locator('#identityVerified').textContent(),/Код сверён/);
  await a.page.setViewportSize({width:740,height:560});
  assert(await a.page.locator('#identityDialog').evaluate(el=>el.scrollWidth===el.clientWidth));
  assert.notEqual(await a.page.locator('#identityDialog').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
  if(process.env.LINK_VISUAL_DIR){
    await fs.mkdir(process.env.LINK_VISUAL_DIR,{recursive:true});
    await a.page.locator('#identityDialog').waitFor({state:'visible'});
    const capture=()=>a.app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true})).toPNG().toString('base64'));
    await capture();
    await new Promise(resolve=>setTimeout(resolve,350));
    await fs.writeFile(path.join(process.env.LINK_VISUAL_DIR,'dm-security.png'),Buffer.from(await capture(),'base64'));
  }
  await a.page.click('#identityReset');
  await a.page.locator('#identityVerified').filter({hasText:'Код ещё не сверяли'}).waitFor();
  const foreign=await a.page.evaluate(async()=>{
    const s=await window.craftlink.direct({op:'state'});
    try{
      await window.craftlink.direct({op:'chat-verify',profileId:s.me.id,id:s.friends[0].id,fingerprint:'0'.repeat(64),verified:true});
      return false;
    }catch{return true;}
  });
  assert.equal(foreign,true);
  await a.page.evaluate(async()=>{
    const s=await window.craftlink.direct({op:'state'});
    await window.craftlink.direct({op:'forget',id:s.friends[0].id});
  });
  await a.page.waitForFunction(()=>!document.querySelector('#identityDialog').open);
  console.log('PASS two actual encrypted peers share one public identity code; local verification/copy/reopen/reset; wrong code rejected; forgotten friend closes the dialog; narrow keyboard flow.');
};
