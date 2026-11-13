'use strict';
const assert=require('node:assert/strict');

// Delay only the native send response. All navigation, inputs and forms use the desktop renderer.
module.exports=async function verifyDrafts(page){
  await page.evaluate(()=>{
    const original=craftlink.direct;
    const friends=['A','B'].map((name,i)=>({id:String(i+3).repeat(64),name,state:'friend',online:true,chat:{supported:true,files:true}}));
    const group={id:'team',name:'Team',role:'owner',online:true,members:[],channels:friends.map(f=>({id:f.name,name:f.name,type:'text'}))};
    const fixture=window.draftQA={sends:[],settle:null};
    craftlink.offerSelectedFile=()=>new Promise(resolve=>{fixture.finishFile=resolve;});
    craftlink.direct=async r=>{
      if(r.op==='group-open')return group;
      if(r.op==='group-file-list'||r.op==='group-shared-with')return [];
      if(r.op==='chat-history'||r.op==='group-history')return {messages:[]};
      if(r.op==='chat-send'||r.op==='group-send'){
        fixture.sends.push({id:r.clientId||r.nonce,recipient:r.channel||r.id,text:r.text});
        return new Promise((resolve,reject)=>{fixture.settle=success=>{
          fixture.settle=null;
          if(success)resolve(true);else reject(Error('fixture: acknowledgement lost'));
        };});
      }
      const result=await original(r);
      if(r.op==='state'){result.friends=friends;result.groups={items:[group],invites:[],transfers:[]};}
      return result;
    };
    roomFixture.refresh();
  });
  for(const variant of ['dm','group']){
    const personal=variant==='dm',input=page.locator(personal?'#dmInput':'#groupInput');
    const send=page.locator(personal?'#dmSend':'#groupSend');
    if(!personal)await page.click('#navGroups');
    const select=async name=>{
      const id=(name==='A'?'3':'4').repeat(64);
      const button=personal?page.locator('#quickPeople [data-person="'+id+'"]:visible, #dmList [data-person="'+id+'"]:visible'):page.locator('[data-group-channel="'+name+'"]');
      await button.click();
      await page.waitForFunction(({personal,name})=>personal?
        document.querySelector('#dmTitle').textContent===name&&!document.querySelector('#dmInput').disabled:
        document.querySelector('#groupChannelName').textContent==='# '+name,{personal,name});
    };
    const submitted=()=>page.evaluate(()=>draftQA.sends.slice());
    const settle=success=>page.evaluate(success=>draftQA.settle(success),success);
    const ready=()=>page.waitForFunction(personal=>!document.querySelector(personal?'#dmSend':'#groupSend').disabled,personal);
    await select('A');
    await input.fill('A unsent');
    await select('B');assert.equal(await input.inputValue(),'');
    await input.fill('B unsent');
    await select('A');assert.equal(await input.inputValue(),'A unsent');
    await input.press('Enter');const first=(await submitted()).at(-1);
    assert.equal(first.recipient,personal?'3'.repeat(64):'A');
    await select('B');assert.equal(await input.inputValue(),'B unsent');assert(await send.isEnabled());
    await select('A');assert(await send.isDisabled());
    const count=(await submitted()).length;
    await input.press('Enter');assert.equal((await submitted()).length,count);
    await select('B');await settle(true);
    await select('A');assert.equal(await input.inputValue(),'','a completed send must not reappear');
    await input.fill('one');await input.press('Enter');
    await input.fill('temporary');await input.fill('one'); // A fresh draft with identical content.
    await select('B');await settle(true);
    await select('A');assert.equal(await input.inputValue(),'one');await ready();
    await input.press('Enter');const failed=(await submitted()).at(-1);
    await select('B');await settle(false);await select('A');
    assert.equal(await input.inputValue(),'one');await ready();
    await input.press('Enter');const retry=(await submitted()).at(-1);
    assert.equal(retry.id,failed.id,'a retry after lost acknowledgement must be idempotent');
    await settle(true);
    await page.waitForFunction(personal=>!document.querySelector(personal?'#dmInput':'#groupInput').value,personal);
    await select('B');assert.equal(await input.inputValue(),'B unsent');
    await input.press('Enter');await select('A');await input.fill('private to this profile');
    await page.evaluate(()=>roomFixture.changeOwner(crypto.randomUUID()));
    await select('A');assert.equal(await input.inputValue(),'','no draft follows a profile switch');
    await select('B');assert.equal(await input.inputValue(),'');
    await input.fill('new profile');await settle(true);assert.equal(await input.inputValue(),'new profile');
    const drop=name=>input.evaluate((node,name)=>{
      const dataTransfer=new DataTransfer();
      dataTransfer.items.add(new File(['fixture'],name));
      node.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));
    },name);
    await drop('old-file.txt');await page.click('#attachmentDraftSend');
    await page.evaluate(()=>roomFixture.changeOwner(crypto.randomUUID()));
    await page.locator('#attachmentDraft').waitFor({state:'hidden'});
    await select('A');await input.fill('new attachment caption');await drop('new-file.txt');
    await page.evaluate(()=>draftQA.finishFile(true));
    assert.equal(await page.inputValue('#attachmentCaption'),'new attachment caption');
    assert(await page.locator('#attachmentDraftItems').getByText('new-file.txt',{exact:true}).isVisible());
    await page.click('#attachmentDraftCancel');
  }
  console.log('PASS desktop personal and group drafts: navigation, late completion, duplicate suppression, edits, retry identity and attachment isolation on profile switch.');
};
