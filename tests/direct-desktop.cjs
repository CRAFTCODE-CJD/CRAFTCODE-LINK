const {capture}=require('./visual-capture.cjs');
const {clickPath}=require('./qa-navigation.cjs');
'use strict';
const {roomMix,roomOptions,closeRoomMenu}=require('./participant-controls.cjs');
// Use real Electron, TLS and WebRTC. These adapters and OS dialog stubs exist only in the test.
const { _electron }=require(require.resolve('playwright',{paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||__dirname]}));
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'direct-desktop-')),apps=[],errors=[];
const pictures=path.join(__dirname,'../out/qa');fs.mkdirSync(pictures,{recursive:true});
const file=path.join(root,'transfer.cclprofile'),pass='unique demo transfer password';
async function open(label,ip){
 const app=await _electron.launch({executablePath:require('electron'),args:['--headless','--ozone-platform=headless','--no-sandbox','--allow-loopback-in-peer-connection','--use-fake-device-for-media-stream',(label==='boris2'&&process.env.LINK_QA_GUEST_APP)||process.env.LINK_QA_APP||path.resolve(__dirname,'..'),'--craftlink-profile='+label],env:{...process.env,XDG_CONFIG_HOME:root}});
 apps.push(app);
 if(process.env.LINK_QA_FILE_MIB){const down=fs.mkdtempSync(path.join(root,'downloads-'));await app.evaluate(({app},dir)=>app.setPath('downloads',dir),down);}
 const p=await app.firstWindow();p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({safeStorage,dialog,desktopCapturer},{ip,file})=>{
   Object.assign(safeStorage,{isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=>'qa-keyring',encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()});
   process.getBuiltinModule('node:os').networkInterfaces=()=>({TestLAN:[{family:'IPv4',address:ip,netmask:'255.0.0.0',internal:false}]});
   dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});
   desktopCapturer.getSources=async()=>[{id:'screen:88:0',name:'QA motion'}];
 },{ip,file});
 if(process.env.LINK_QA_FILE_MIB)await p.evaluate(()=>{
   const Base=RTCPeerConnection;window.RTCPeerConnection=class extends Base{constructor(...args){super(...args);window.qaFilePC=this;}};
   window.qaRanges=0;const send=RTCDataChannel.prototype.send;
   RTCDataChannel.prototype.send=function(data){
     const result=send.call(this,data);
     if(this.label==='link-files-v1'&&typeof data!=='string'){
       window.qaRanges++;
       if(window.qaInterrupt && window.qaRanges===32){window.qaInterrupted=true;this.close();}
     }
     return result;
   };
 });
 await p.evaluate(()=>{navigator.mediaDevices.getDisplayMedia=async()=>{
   const c=document.createElement('canvas');c.width=320;c.height=180;const ctx=c.getContext('2d'),stream=c.captureStream(15);let frame=0;
   const t=setInterval(()=>{if(stream.getVideoTracks()[0].readyState!=='live'){clearInterval(t);return;}ctx.fillStyle=frame++%2?'red':'blue';ctx.fillRect(0,0,320,180);},66);return stream;
 };});
 return p;
}
async function create(p,name){
 await clickPath(p,'#startNearby');await p.waitForSelector('#directName');
 assert.equal(await p.textContent('#directTitle'),'Имя для локальной сети');
 assert(await p.locator('#directAtStart').isHidden());assert(await p.locator('#directNic').isHidden());
 if(name==='Анна'){
   await p.locator('#directCreateForm button').click();assert.equal((await remote(p,'state')).me,null);
   assert.equal(await p.evaluate(()=>document.activeElement.id),'directName');await capture(p,'first-lan-name');
 }
 await p.fill('#directName',name);await p.locator('#directCreateForm button').click();
 await p.waitForSelector('#directNic');assert.equal(await p.textContent('#lanName'),name);
 assert.equal(await p.inputValue('#directNic'),'');assert.equal((await remote(p,'state')).dht,false);
 await p.selectOption('#directNic','TestLAN');await p.waitForFunction(()=>!document.querySelector('#directScan').disabled && document.querySelector('#directNic').value==='TestLAN');
 assert.equal((await remote(p,'state')).lan,'TestLAN');
}
async function nearby(p){
 if(await p.locator('#settingsDialog').isVisible())await p.click('#closeSettingsDialog');
 if(await p.locator('#directDialog').isVisible())await p.click('#directClose');
 await clickPath(p,'#bookNearby');await p.waitForSelector('#directNic');
 await p.selectOption('#directNic','TestLAN');await p.waitForSelector('#directScan:enabled');
}
const remote=(p,op,fields={})=>p.evaluate(([op,fields])=>window.craftlink.direct({op,...fields}),[op,fields]);
(async()=>{
 const a=await open('anna','127.0.0.2'),b=await open('boris','127.0.0.3');
 await create(a,'Анна');await create(b,'Борис');await a.click('#directScan');
 await a.locator('#nearbyList .contact-card').filter({hasText:'Борис'}).waitFor();await capture(a,'lan-friend-found');
 await b.click('#directClose');await b.click('#bookCopy');
 await b.click('#profileBtn');await b.fill('#directNick','Черновик');
 const card=await apps[1].evaluate(({clipboard})=>clipboard.readText());assert.match(card,/^CCF1:/);
 await a.click('#directClose');await a.click('#linkFriends');await a.fill('#directCode',card);await a.click('#sendCardRequest');
 await a.locator('#outRequests .sent-request').waitFor();assert(await a.locator('#directDialog').isHidden());await capture(a,'requests-sent');
 await b.waitForFunction(()=>!document.getElementById('requestBadge').hidden && document.getElementById('requestBadge').textContent==='1');await b.waitForSelector('#requestNotice');
 assert.equal(await b.textContent('#noticeSender'),'Анна');assert.equal(await b.evaluate(()=>document.activeElement.id),'directNick');
 await capture(b,'request-in-profile');await b.click('#noticeDismiss');assert.equal(await b.inputValue('#directNick'),'Черновик');
 await b.waitForTimeout(300);assert(await b.locator('#requestNotice').isHidden());assert.equal(await b.textContent('#requestBadge'),'1');
 await b.click('#closeSettingsDialog');await b.click('#navRequests');
 await b.setViewportSize({width:960,height:680});await capture(b,'requests-incoming');
 await b.locator('#inRequests').getByRole('button',{name:'Принять'}).click();await b.waitForSelector('#requestBadge',{state:'hidden'});
 await b.click('#navFriends');await a.click('#navFriends');await a.locator('#workspaceContacts .contact-card .available').waitFor();
 console.log('PASS first LAN entry on two clean profiles, chosen names, DHT off, selected adapter, actionable notice without focus loss, dismiss preserves request and profile draft; accepted in inbox');
 await b.click('#profileBtn');await b.click('#linkProfileTools summary');await b.click('#directExport');await b.fill('#transferPass',pass);await b.fill('#transferRepeat',pass);await b.click('#transferSubmit');await b.waitForSelector('#transferPanel',{state:'hidden'});
 const c=await open('boris2','127.0.0.4');await c.click('#startDirect');await c.click('#directRestore');await c.fill('#transferPass',pass);await c.click('#transferSubmit');await c.waitForSelector('#directIdentity');
 const before=await remote(b,'state'),after=await remote(c,'state');assert.equal(before.me.id,after.me.id);assert.notEqual(before.me.device,after.me.device);
 await nearby(c);await c.click('#directScan');await nearby(a);await a.click('#directScan');await a.click('#directClose');
 await a.locator('#workspaceContacts').getByText(/2 устройства/).waitFor();assert.equal(await a.locator('#workspaceContacts .contact-card').count(),1);
 await a.locator('#workspaceContacts').getByRole('button',{name:'В избранное',exact:true}).click();await a.click('#bookFilters [data-filter=favorite]');await a.selectOption('#bookSort','name');await a.fill('#bookQuery','бор');assert.equal(await a.locator('#workspaceContacts .contact-card').count(),1);
 await a.fill('#bookQuery','нет совпадений');await a.locator('#workspaceContacts').getByText(/Совпадений нет/).waitFor();await a.fill('#bookQuery','');
 console.log('PASS encrypted export/import through UI, two devices one row, favorites, search and sort');
 await a.setViewportSize({width:1440,height:900});await a.fill('#bookQuery','Бор');await a.click('#bookFilters [data-filter=favorite]');
 assert.equal(await a.locator('#workspaceContacts .contact-card').count(),1);
 await a.click('#quickPeople button');await a.locator('#dmTitle',{hasText:'Борис'}).waitFor();
 await a.click('#navFriends');
 await a.fill('#bookQuery','');await a.click('#linkFriends');assert(await a.locator('#directCode').isVisible());await a.click('#directClose');
 await capture(a,'friends-online');await a.screenshot({path:path.join(pictures,'workspace-friends.png')});
 await a.locator('#workspaceContacts').getByRole('button',{name:'Позвонить'}).click();await Promise.all([b,c].map(p=>p.waitForSelector('#peerCallDialog[open]')));
 await capture(a,'link-outgoing');await capture(c,'link-incoming');await c.click('#peerAccept');await b.waitForSelector('#peerCallDialog',{state:'hidden'});for(const p of [a,c])await p.waitForFunction(()=>document.getElementById('participantsCount').textContent.includes('2 /'));
 console.log('PASS first answer selects second device, sibling ring ended, single room');
 await a.click('#micBtn');await a.click('#shareBtn');await a.click('#screenTabBtn');if(await a.isChecked('#withSystemAudio'))await a.uncheck('#withSystemAudio');
 await a.locator('#sourcesGrid .source-card').first().click();await a.click('#startShare');await clickPath(c,'#networkHelpBtn');
 const evidence=await c.waitForFunction(()=>{
   const m=document.getElementById('mediaDiagnostics').textContent.match(/Источник 0 · голос (\d+) Б · экран (\d+) Б · звук стрима \d+ Б · кадров декодировано (\d+)/);
   if(!m)return false;const values=m.slice(1).map(Number),old=window.previousMedia;window.previousMedia=values;
   return old&&values.every((n,i)=>old[i]>0&&n>old[i])?[old,values]:false;
 },null,{polling:400,timeout:35000});
 console.log('PASS second device receives increasing microphone bytes, video bytes and decoded frames',await evidence.jsonValue());
 // Share a real file before the third participant joins. The OS chooser is the only stub.
 await c.keyboard.press('Escape');await c.click('#navRoom');
 if(!process.env.LINK_QA_FILE_MIB){
   const folder=fs.mkdtempSync(path.join(root,'chat-downloads-'));
   await apps[0].evaluate(({app,shell},dir)=>{app.setPath('downloads',dir);shell.showItemInFolder=file=>{globalThis.lastShown=file;};},folder);
   await apps[2].evaluate(({dialog})=>{dialog.showMessageBox=()=>new Promise(resolve=>{globalThis.qaCameraAnswer=resolve;});});
   await c.click('#chatAttach summary');await c.click('#chatCircle');await c.locator('#clipDialog[open]').waitFor();
   await c.click('#clipClose');
   await apps[2].evaluate(()=>globalThis.qaCameraAnswer({response:1}));
   const denied=await c.evaluate(async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({video:true});stream.getTracks().forEach(t=>t.stop());return false;}catch(e){return e.name==='NotAllowedError';}});
   assert(denied,'A dismissed recording must not gain camera access from a late dialog answer');
   await apps[2].evaluate(({dialog})=>{dialog.showMessageBox=async(_parent,opts)=>({response:opts.title==='Видеосообщение'?1:0});});
   const chat= a.locator('#chatMessages');
   await c.click('#chatEmoji summary');await c.locator('#emojiChoices').getByRole('button',{name:'🎮'}).click();await c.click('#sendChatBtn');await chat.getByText('🎮',{exact:true}).waitFor();
   for(const [id,title,tag] of [['chatVoice','Голосовое сообщение','audio'],['chatCircle','Видеосообщение','video']]){
     await c.click('#chatAttach summary');await c.click('#'+id);await c.locator('#clipStop').waitFor();
     await c.waitForTimeout(1100);await c.click('#clipStop');await c.locator('#clipDisplay .clip-toggle').waitFor();await c.click('#clipSend');
     const card=chat.locator('.chat-attachment').filter({hasText:title});
     await card.getByRole('button',{name:'Скачать'}).click();await card.getByText('Сохранено',{exact:true}).waitFor();
     await card.getByRole('button',{name:tag==='audio'?'Прослушать':'Просмотреть'}).click();
     await a.waitForFunction(tag=>document.querySelector('.chat-media-preview '+tag)?.readyState>=2,tag);
     await card.getByRole('button',{name:'Показать в папке'}).click();
     const file=await apps[0].evaluate(()=>globalThis.lastShown);assert(fs.existsSync(file));
   }
   await c.click('#chatAttach summary');await c.click('#chatVoice');await c.locator('#clipStop').waitFor();await c.click('#clipClose');
   assert.equal(await chat.getByText('Голосовое сообщение',{exact:true}).count(),1);
   await c.evaluate(()=>{
     const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
     navigator.mediaDevices.getUserMedia=async constraints=>{const s=await gum(constraints);window.qaNoteTracks=s.getTracks();return s;};
   });
   await c.click('#chatAttach summary');await c.click('#chatVoice');await c.locator('#clipStop').waitFor();
   await apps[2].evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
   await c.waitForFunction(()=>!document.querySelector('#clipDialog').open && window.qaNoteTracks.every(t=>t.readyState==='ended'));
   await apps[2].evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
   console.log('PASS late camera confirmation denied; hiding recording window ended its device tracks without sending a message');
   const photo=path.resolve(__dirname,'../src/renderer/assets/craftlink.png');
   await apps[2].evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},photo);
   await c.click('#chatAttach summary');await c.click('#chatFile');
   const card=chat.locator('.chat-attachment').filter({hasText:'craftlink.png'});await card.getByRole('button',{name:'Скачать'}).click();
   await card.getByRole('button',{name:'Просмотреть'}).click();await a.waitForFunction(()=>document.querySelector('.chat-media-preview img')?.naturalWidth>0);
   if(process.env.LINK_QA_UI_DIR)await a.screenshot({path:path.join(process.env.LINK_QA_UI_DIR,'Chat.png')});
   console.log('PASS composer emoji, explicit voice and video recording, cancellation, preview before send, peer download and Chromium decoding, PNG preview and native reveal target.');
 }
 if(process.env.LINK_QA_FILE_MIB){
   const mib=Number(process.env.LINK_QA_FILE_MIB);assert(Number.isInteger(mib)&&mib>0&&mib<=1024);
   const crypto=require('node:crypto'),chunk=crypto.randomBytes(1024*1024),hash=crypto.createHash('sha256');
   const update=process.env.LINK_QA_UPDATE==='1';
   const filename=update?'CRAFTCODE-LINK-0.8.0-Setup-x64.exe':'transfer.zip';
   const archive=path.join(root,filename),fd=fs.openSync(archive,'wx');
   try{for(let n=0;n<mib;n++){fs.writeSync(fd,chunk);hash.update(chunk);}}finally{fs.closeSync(fd);}
   const reverse=process.env.LINK_QA_REVERSE==='1',owner=reverse?c:a,recipient=reverse?a:c;
   await apps[reverse?2:0].evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},archive);
   if(process.env.LINK_QA_INTERRUPT==='1')await owner.evaluate(()=>{window.qaInterrupt=true;});
   await owner.click('#roomShelf summary');await owner.click('#shelfOffer');await recipient.click('#roomShelf summary');
   const digest=hash.digest('hex');
   const row=recipient.locator('#shelfItems .file-row').filter({hasText:filename});
   await row.getByRole('button',{name:'Скачать'}).waitFor();const mediaSample=()=>c.evaluate(async()=>{
     const r=await qaFilePC.getStats(),rows=[...r.values()].filter(s=>s.type==='inbound-rtp');
     return {frames:rows.find(s=>s.mid==='1')?.framesDecoded||0,voice:rows.find(s=>s.mid==='0')?.bytesReceived||0,connection:qaFilePC.connectionState};
   });
   const mediaBefore=await mediaSample(),start=performance.now();
   if(update){
     await clickPath(c,'#networkHelpBtn');await c.click('#helpHome');if(!await c.locator('#updatePanel').evaluate(el=>el.open))await c.click('#updateSummary');
     await c.locator('#legacyUpdate > summary').click();
     await c.fill('#releaseCode','LINK-UPDATE 0.8.0 '+'0'.repeat(64));assert(await c.locator('#downloadRelease').isHidden());
     await c.fill('#releaseCode','LINK-UPDATE 0.8.0 '+digest);await c.click('#downloadRelease');
     await c.waitForFunction(()=>document.getElementById('downloadRelease').textContent==='Установить',{},{timeout:60000});
     await c.click('#closeNetworkDialog');console.log('PASS update from Room files: wrong code hides download, matching code downloads, explicit Install remains pending');
   }else await row.getByRole('button',{name:'Скачать'}).click();
   await row.getByText(/Сохранено/).waitFor({timeout:600000});
   const seconds=(performance.now()-start)/1000,mediaAfter=await mediaSample();
   if(seconds>=2){assert.equal(mediaAfter.connection,'connected');assert(mediaAfter.frames>mediaBefore.frames);assert(mediaAfter.voice>mediaBefore.voice);}
   const rootDown=await apps[recipient===a?0:2].evaluate(({app})=>app.getPath('downloads'));const target=fs.readdirSync(rootDown,{recursive:true}).filter(x=>path.basename(x)===filename).map(x=>path.join(rootDown,x))[0];
   const copy=crypto.createHash('sha256');for await(const block of fs.createReadStream(target))copy.update(block);
   assert.equal(digest,copy.digest('hex'));assert.equal(fs.statSync(target).size,mib*1024**2);
   const frames=await owner.evaluate(()=>window.qaRanges);
   if(process.env.LINK_QA_INTERRUPT==='1')assert(await owner.evaluate(()=>window.qaInterrupted));
   if(!process.env.LINK_QA_GUEST_APP&&!process.env.LINK_QA_APP)assert(frames>0);
   console.log(JSON.stringify({mib,seconds,mibPerSec:mib/seconds,binaryFrames:frames,decodedFrames:mediaAfter.frames-mediaBefore.frames,voiceBytes:mediaAfter.voice-mediaBefore.voice,sha256:'verified',media:'concurrent'}));return;
 }
 const buildPath=path.join(root,'Game-build.zip'),buildBytes=require('node:crypto').randomBytes((process.env.LINK_QA_LARGE==='1'?128:2)*1024*1024+17);
 fs.writeFileSync(buildPath,buildBytes);
 await apps[2].evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},buildPath);
 await c.click('#roomShelf summary');await c.click('#shelfOffer');await c.locator('#shelfItems').getByText('Game-build.zip').waitFor();
 await a.click('#navGame');await a.fill('#gameTitle','Матч 8 на 8');await a.locator('#gameCreate button').click();
 await c.click('#navGame');
 await c.locator('#gameReturns').getByRole('button',{name:'Попроситься в LAN'}).waitFor();
 if(process.env.LINK_QA_UI_DIR)await c.screenshot({path:path.join(process.env.LINK_QA_UI_DIR,'Game-LAN.png')});
 await c.locator('#gameReturns').getByRole('button',{name:'Попроситься в LAN'}).click();
 await a.locator('#lanRequests').getByRole('button',{name:'Отклонить'}).waitFor();
 await c.locator('#gameReturns').getByRole('button',{name:'Отменить запрос'}).click();
 await a.locator('#lanRequests').getByRole('button',{name:'Отклонить'}).waitFor({state:'hidden'});
 await c.locator('#gameReturns').getByRole('button',{name:'Попроситься в LAN'}).click();
 await a.locator('#lanRequests').getByRole('button',{name:'Отклонить'}).click();
 await c.locator('#gameReturns').getByRole('button',{name:'Попроситься в LAN'}).click();
 await a.locator('#lanRequests').getByRole('button',{name:'Принять'}).click();
 await c.waitForFunction(()=>document.querySelector('#gameCount').textContent==='2');
 await c.click('#gameLeave');await c.locator('#gameReturns').getByRole('button',{name:'Вернуться в LAN'}).click();
 console.log('PASS contact-only LAN listing, cancelled request, declined request, approved retry, voluntary re-entry');
 await c.waitForFunction(()=>document.querySelector('#gameCount').textContent==='2');
 await c.fill('#gameMessage','Готов к матчу');await c.click('#gameSendMessage');await a.locator('#gameHistory').getByText(/Готов к матчу/).waitFor();
 assert((await remote(b,'state')).game.invitations.length===0);
 // Stand in for the UAC dialog only. The UI, command handler and LAN lifecycle are real.
 await apps[0].evaluate(({app})=>{
   const file=process.getBuiltinModule('path').join(app.getAppPath(),'package.json');
   const load=process.getBuiltinModule('module').createRequire(file);
   const {GameNetwork}=load('./src/game/network.cjs'),start=GameNetwork.prototype.start;
   let stale=true;
   GameNetwork.prototype.start=function(repair=false){
     this.open=({abort,repair:authorized})=>{
       if(stale && !authorized)throw Object.assign(Error('Windows сохранила адаптер LINK от предыдущей сессии.'),{code:'stale'});
       stale=false;
       return new Promise((_,reject)=>abort(()=>reject(Error('Cancelled fixture'))));
     };
     return start.call(this,repair);
   };
 });
 await a.click('#gameActivate');
 const repair=a.getByRole('button',{name:'Восстановить подключение'});
 await repair.waitFor();
 assert(!(await a.locator('#toast').isVisible() && (await a.locator('#toast').innerText()).includes('предыдущей сессии')));
 if(process.env.LINK_LAN_VISUAL)await a.screenshot({path:process.env.LINK_LAN_VISUAL,animations:'disabled'});
 await repair.click();
 await a.getByRole('button',{name:'Отменить включение'}).waitFor();
 await a.fill('#gameMessage','Пока ожидаем разрешения');await a.click('#gameSendMessage');
 await c.locator('#gameHistory').getByText(/Пока ожидаем разрешения/).waitFor();
 await a.click('#gameActivate');
 await a.getByRole('button',{name:'Включить игровую сеть Windows'}).waitFor();
 assert.equal((await remote(a,'state')).game.network.phase,'off');
 console.log('PASS pending elevation permits LAN chat and cancellation without leaving the voice call.');
 await a.screenshot({path:path.join(pictures,'game-room.png')});
 await a.click('#backToCall');await c.click('#backToCall');
 await roomOptions(a);await a.check('#roomModerated');
 await c.waitForSelector('#micBtn:disabled');await c.waitForSelector('#shareBtn:disabled');
 await roomMix(a,1);await a.locator('.speaker-permission').click();await c.waitForSelector('#micBtn:enabled');
 assert.equal(await c.getAttribute('#micBtn','aria-pressed'),'false');
 await c.click('#micBtn');await c.waitForFunction(()=>document.querySelector('#micBtn').getAttribute('aria-pressed')==='true');
 await roomMix(a,1);await a.locator('.speaker-permission').click();await c.waitForSelector('#micBtn:disabled');assert.equal(await c.getAttribute('#micBtn','aria-pressed'),'false');
 await roomOptions(a);await a.uncheck('#roomModerated');await c.waitForSelector('#shareBtn:enabled');
 await a.selectOption('#audienceMode','invite');await a.waitForFunction(async()=>(await window.craftlink.direct({op:'state'})).audience.mode==='invite');
 await a.selectOption('#audienceMode','friends');await closeRoomMenu(a);
 console.log('PASS independent LINK game invitation, second-device cancellation, separate match chat and uninterrupted media room; moderator grant and revocation with explicit mic activation.');
 const d=await open('vera','127.0.0.5');const down=fs.mkdtempSync(path.join(root,'downloads-'));await apps[3].evaluate(({app},dir)=>app.setPath('downloads',dir),down);await create(d,'Вера');await d.click('#directScan');
 await d.locator('#nearbyList .contact-card').filter({hasText:'Анна'}).getByRole('button',{name:'Добавить'}).click();
 await a.waitForSelector('#requestNotice');assert.equal(await a.textContent('#noticeSender'),'Вера');await a.click('#noticeAccept');await a.waitForSelector('#requestBadge',{state:'hidden'});assert(await a.locator('#leaveBtn').isVisible());
 await a.click('#copyInviteBtn');await a.waitForSelector('#workspaceContacts');
 assert.equal(await a.getAttribute('#bookFilters [data-filter=online]','aria-pressed'),'true');
 await a.click('#backToCall');await a.click('#cinemaBtn');
 assert(await a.locator('#navRail').isHidden());assert(await a.locator('#roomSidebar').isHidden());assert(await a.locator('#leaveBtn').isVisible());
 await capture(a,'cinema');await a.keyboard.press('Escape');await a.locator('#navRail').waitFor();assert(await a.locator('#roomSidebar').isVisible());
 await capture(a,'screen-live');await a.screenshot({path:path.join(pictures,'workspace-call.png')});await d.click('#directClose');
 await apps[0].evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
 const veraCall=d.locator('#workspaceContacts .contact-card').filter({hasText:'Анна'}).getByRole('button',{name:'Позвонить'});await veraCall.click();
 await a.waitForFunction(()=>document.querySelector('#peerAccept').textContent==='Перейти в другой звонок');
 assert((await a.textContent('#participantsCount')).includes('2 /'));
 assert.equal(await apps[0].evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
 await apps[0].evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
 await a.screenshot({path:path.join(pictures,'direct-admission.png')});
 await capture(a,'admission');console.log('PASS incoming local-profile call does not reveal the hidden Electron window');
 await a.click('#peerReject');await d.waitForSelector('#peerCallDialog',{state:'hidden'});
 await a.click('#settingsBtn');await a.click('[data-pane=connection]');await a.check('#dnd');await a.click('#closeSettingsDialog');
 await d.waitForFunction(()=>document.querySelector('#quickRooms').childElementCount===0);
 await veraCall.click();await d.waitForFunction(()=>document.querySelector('#toast').textContent.includes('занят'));
 assert(await a.locator('#peerCallDialog').isHidden());assert((await a.textContent('#participantsCount')).includes('2 /'));
 await a.click('#settingsBtn');await a.click('[data-pane=connection]');await a.uncheck('#dnd');await a.click('#closeSettingsDialog');
 await d.click('#linkHost');await d.waitForSelector('#leaveBtn');
 await d.click('#navRooms');const roomEntry=d.locator('#friendRooms .room-list-row').filter({hasText:'Анна'}).getByRole('button');
 await roomEntry.waitFor();await capture(d,'rooms-before-switch');
 // Separate deliberate retries from the contact's three-second ring cooldown.
 await new Promise(done=>setTimeout(done,3200));await roomEntry.click();
 await a.click('#peerReject');await d.waitForSelector('#peerCallDialog',{state:'hidden'});
 assert(await d.locator('#leaveBtn').isVisible());assert((await d.textContent('#participantsCount')).startsWith('1 /'));
 await new Promise(done=>setTimeout(done,3200));await roomEntry.click();await a.click('#peerAccept');await d.waitForSelector('#confirmYesBtn');
 await d.locator('#confirmYesBtn').evaluate(el=>el.closest('dialog').querySelector('button:not(#confirmYesBtn)').click());
 await d.waitForSelector('#confirmYesBtn',{state:'hidden'});assert(await d.locator('#leaveBtn').isVisible());
 await new Promise(done=>setTimeout(done,3200));await roomEntry.click();await a.click('#peerAccept');await d.click('#confirmYesBtn');
 for(const p of [a,c,d])await p.waitForFunction(()=>document.querySelector('#participantsCount').textContent.startsWith('3 /'));
 await d.click('#navRooms');assert.equal(await d.locator('#friendRooms .room-list-row').count(),0);await d.click('#backToCall');
 console.log('PASS discovered an authenticated friend room from another active room, decline and cancel preserved the old call, confirmed switch reached three peers and hid the current room');
 console.log('PASS incoming third direct contact: declined, DND busy, then admitted by host without closing the existing broadcast');
 await d.click('#roomShelf summary');await d.locator('#shelfItems').getByText('Game-build.zip').waitFor();
 const attachment=d.locator('#chatMessages .chat-attachment').filter({hasText:'Game-build.zip'});
 await attachment.waitFor();assert((await attachment.innerText()).includes('Борис'));
 await attachment.getByRole('button',{name:'Скачать'}).click();if(process.env.LINK_QA_LARGE==='1'){
   await d.locator('#shelfItems .file-row').filter({hasText:'Game-build.zip'}).getByRole('button',{name:'Пауза'}).click();await d.locator('#shelfItems .file-row').filter({hasText:'Game-build.zip'}).getByRole('button',{name:'Продолжить'}).click();
 }
 await d.locator('#shelfItems').getByText(/Сохранено/).waitFor({timeout:180000});
 const roomDirs=fs.readdirSync(path.join(down,'CRAFTCODE LINK'));assert.equal(roomDirs.length,1);assert.deepEqual(fs.readFileSync(path.join(down,'CRAFTCODE LINK',roomDirs[0],'Game-build.zip')),buildBytes);
 await a.click('#navGame');await a.click('#gameActivate');await a.getByRole('button',{name:'Отменить включение'}).waitFor();await a.click('#gameLeave');await a.click('#confirmNoBtn');await a.click('#gameLeave');await a.click('#confirmYesBtn');await c.waitForFunction(async()=>(await window.craftlink.direct({op:'state'})).game.room===null);
 await a.click('#backToCall');assert((await c.textContent('#participantsCount')).startsWith('3 /'));
 console.log('PASS late-joining guest downloaded original guest file through the host with byte-for-byte integrity; leaving LAN preserved the 3-person call.',buildBytes.length,'bytes');
 await d.click('#leaveBtn');await d.click('#navRooms');await d.locator('#friendRooms').getByRole('button',{name:'Вернуться в комнату'}).click();
 await a.waitForFunction(()=>document.querySelector('#participantsCount').textContent.startsWith('3 /'));
 assert(!(await a.locator('#peerCallDialog').isVisible()));
 console.log('PASS authenticated voluntary voice-room re-entry without host prompt');
 await d.click('#leaveBtn');await d.locator('#workspaceContacts').getByRole('button',{name:/Действия с контактом/}).click();
 await capture(d,'contact-actions');await d.screenshot({path:path.join(pictures,'direct-actions.png')});await d.locator('#contactChoices').getByRole('button',{name:'Заблокировать'}).click();await d.locator('dialog[open]').getByRole('button',{name:'Заблокировать',exact:true}).last().click();
 await d.click('#bookFilters [data-filter=blocked]');await capture(d,'blocked');await d.locator('#workspaceContacts').getByRole('button',{name:'Разблокировать'}).click();
 assert.equal((await remote(d,'state')).friends.length,0);assert.equal((await remote(d,'state')).blocked.length,0);
 console.log('PASS block from contact menu and unblock without silently restoring friendship');
 const bk=await remote(b,'state');assert(bk.lan);
 await remote(b,'policy',{strict:true});const stopped=await remote(b,'state');assert(!stopped.lan&&!stopped.dht);
 await assert.rejects(remote(b,'settings',{dht:true}));await assert.rejects(remote(b,'settings',{lan:'TestLAN'}));
 await assert.rejects(remote(b,'call',{id:before.friends[0].id}));await remote(b,'policy',{strict:false});
 assert(!(await remote(b,'state')).lan);
 if(await b.locator('#settingsDialog').isVisible())await b.click('#closeSettingsDialog');
 await b.click('#navFriends');
 await b.locator('#bookPresence').getByText('Поиск друзей выключен на этом ПК.',{exact:true}).waitFor();
 await b.click('#bookPresenceAction');await b.locator('#directDht').waitFor();
 await b.click('#closeSettingsDialog');
 console.log('PASS disconnected contacts expose local discovery settings without changing route consent.');
 console.log('PASS strict mode closes discovery and rejects direct calls/reenabling either network; disabling strict leaves networks off');
 await apps[1].evaluate(({dialog})=>{
   globalThis.resetPrompts=0;
   dialog.showMessageBox=async(_parent,options)=>{
     if(options.defaultId!==0 || options.cancelId!==0)throw Error('Unsafe default');
     globalThis.resetPrompts++;
     await new Promise(done=>setTimeout(done,100));return {response:0};
   };
 });
 const outcomes=await Promise.allSettled([remote(b,'reset'),remote(b,'reset')]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(await apps[1].evaluate(()=>globalThis.resetPrompts),1);
 assert.equal((await remote(b,'state')).me.id,before.me.id);
 console.log('PASS duplicate profile removal opens one confirmation and cancellation preserves identity');
 assert.deepEqual(errors,[]);
})().catch(async e=>{console.error(e);for(const app of apps){const p=app.windows()[0];if(p)console.error(await p.evaluate(()=>({nearText:document.getElementById('nearbyList').innerText,selected:document.getElementById('directNic').value,dialog:[...document.querySelectorAll('dialog[open]')].map(d=>d.id),note:document.getElementById('directMessage').textContent,toast:document.getElementById('toast').textContent,diag:document.getElementById('mediaDiagnostics').textContent.slice(0,380)})).catch(()=>null));}process.exitCode=1;}).finally(async()=>{for(const app of apps)await app.close().catch(()=>{});fs.rmSync(root,{recursive:true,force:true});});
