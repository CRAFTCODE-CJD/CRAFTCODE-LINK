'use strict';
const assert=require('node:assert/strict');
const receivedVoice=require('./received-voice.cjs');
module.exports=async({a,b})=>{
  const marker='Посмотри https://youtu.be/dQw4w9WgXcQ';
  await a.page.fill('#dmInput',marker);await a.page.press('#dmInput','Enter');
  await b.page.waitForFunction(()=>!document.querySelector('#dmBadge').hidden);
  assert(await b.page.locator('#messagesPage').isHidden());
  const toast=await b.app.evaluate(()=>{
    const n=globalThis.testNotifications.findLast(n=>n.title==='Личное сообщение');
    if(!n)return null;
    const result={body:n.body,title:n.title};n.emit('click');return result;
  });
  assert(toast && toast.body.includes('Анна') && !toast.body.includes('youtu'));
  await b.page.locator('#dmTitle',{hasText:'Анна'}).waitFor();
  const card=b.page.locator('#dmLog .chat-link-card');
  await card.locator('strong',{hasText:'YouTube'}).waitFor();
  assert.equal((await b.app.evaluate(()=>testWebRequests.filter(u=>u.startsWith('https://www.youtube.com/')))).length,0);
  const poster=await b.page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=16;c.height=9;return c.toDataURL('image/jpeg').split(',')[1];
  });
  await b.app.evaluate(({session},jpg)=>{
    globalThis.testPoster=jpg;
    session.fromPartition('link-youtube',{cache:false}).protocol.handle('https',req=>
      new Response('<title>Isolated fixture</title>',{headers:{'Content-Type':'text/html'}}));
  },poster);
  await card.getByRole('button',{name:'Загрузить описание'}).click();
  await card.locator('strong',{hasText:'Тестовый ролик'}).waitFor();
  assert(await card.locator('.chat-video-poster img').evaluate(async img=>{await img.decode();return img.naturalWidth===16;}));
  await card.getByRole('button',{name:'Смотреть видео в LINK'}).click();
  await b.page.waitForFunction(()=>!document.querySelector('.chat-video-poster').disabled);
  const video=await b.app.evaluate(async({BrowserWindow,session})=>{
    const win=BrowserWindow.getAllWindows().find(w=>w.webContents.session!==session.defaultSession);if(!win)return null;
    const result=[win.webContents.getURL(),await win.webContents.executeJavaScript('typeof window.craftlink')];
    win.close();return result;
  });
  assert.deepEqual(video,['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1','undefined']);
  await card.click({button:'right'});
  await b.page.getByRole('menuitem',{name:'Копировать ссылку'}).click();
  assert.equal(await b.app.evaluate(()=>testClipboard),'https://youtu.be/dQw4w9WgXcQ');
  await card.locator('a').click();assert.equal(await b.app.evaluate(()=>testExternal),'https://youtu.be/dQw4w9WgXcQ');
  await a.page.click('#networkHelpBtn');
  if(!await a.page.locator('#updatePanel').evaluate(panel=>panel.open))await a.page.click('#updateSummary');
  await a.page.locator('#githubCheck').waitFor();
  await a.page.locator('#helpDonate').getByText('Угостить кофе').waitFor();
  await a.page.click('#coffeeQR summary');
  assert.equal(await a.page.locator('#coffeeQR img').evaluate(img=>img.complete && img.naturalWidth),150);
  await a.page.click('#helpDonate');
  assert.equal(await a.app.evaluate(()=>testExternal),'https://boosty.to/channel-jonathan-developer/donate');
  await a.page.click('#coffeeQR summary');
  await a.page.uncheck('#releaseAutomatic');
  await a.page.click('#githubCheck');await a.page.locator('#githubDownload').waitFor();
  assert.equal(await a.app.evaluate(()=>testWebRequests.filter(x=>x.includes('/releases/assets/')).length),0);
  await a.page.click('#githubDownload');await a.page.locator('#githubInstall').waitFor();
  await a.page.click('#closeNetworkDialog');
  // Disable external ICE discovery for the isolated call and record received RTP.
  for(const page of [a.page,b.page])await page.evaluate(()=>{
    const pc=window.RTCPeerConnection;window.qaConnections=[];
    window.RTCPeerConnection=class extends pc{
      constructor(opts){super({...opts,iceServers:[]});window.qaConnections.push(this);}
      setConfiguration(opts){return super.setConfiguration({...opts,iceServers:[]});}
    };
  });
  await a.page.click('#dmCall');await b.page.locator('#peerAccept').waitFor();
  assert(await b.page.locator('#roomPage').isHidden());
  await b.page.click('#peerReject');await a.page.waitForFunction(()=>!document.querySelector('#peerCallDialog').open);
  await new Promise(resolve=>setTimeout(resolve,3200));
  await a.page.click('#dmCall');await b.page.click('#peerAccept');
  for(const page of [a.page,b.page]){
    await page.waitForFunction(()=>document.querySelector('#participantsCount').textContent==='2 / 8'&&!document.querySelector('#roomPage').hidden);
    await page.locator('#roomConversation').waitFor();
  }
  assert(await a.page.evaluate(async()=>{try{await window.craftlink.releases({op:'install'});return false;}catch{return true;}}));
  assert(!await a.app.evaluate(()=>globalThis.testUnexpectedNativePrompt));
  await a.page.evaluate(receivedVoice.installTestVoice);
  await a.page.click('#micBtn');
  const samples=await receivedVoice(b.page,'0');
  console.log('Received voice RTP and decoded samples',JSON.stringify(samples));
  await b.page.click('#roomConversation');await card.waitFor();
  await b.page.click('#navRoom');
  await a.page.click('#leaveBtn');await a.page.click('#confirmYesBtn');
  for(const page of [a.page,b.page])await page.waitForFunction(()=>!document.querySelector('#messagesPage').hidden && !!document.querySelector('#dmLog .chat-link-card'));
  console.log('PASS two isolated clients: private Windows toast click without contents, offline link card, opt-in title and browser handoff, update preferences and verified user-requested download from a fixture, installation blocked during call, decline before join, accepted chat call with two room participants and received voice RTP, return to the original history.');
};
