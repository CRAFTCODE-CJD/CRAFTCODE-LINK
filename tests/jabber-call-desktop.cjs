const {capture}=require('./visual-capture.cjs');
const {clickPath}=require('./qa-navigation.cjs');
// Three independent clients on the same simulated jabber.ru. No public account is accessed.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron}=require(require.resolve('playwright',{paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||__dirname]}));
const {providers}=require('../src/renderer/providers.mjs');
const {Fixture}=require('./xmpp-fixture.cjs');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'link-jabber-room-'));
const output=path.join(__dirname,'../out/qa');fs.mkdirSync(output,{recursive:true});
const srv=new Fixture({}),apps=[],errors=[],packets=[];
let block=true,delayKeys=true,offerBytes=0;
const secret=require('node:crypto').randomBytes(24).toString('hex');
const turnPort=35165;
const relay=require('node:child_process').spawn(process.env.CCLINK_QA_TURN || 'turnserver',['-n','--listening-ip=127.0.0.1','--relay-ip=127.0.0.1','--allow-loopback-peers','--no-cli','--no-tls','--no-dtls','--no-multicast-peers','--relay-threads=1','--lt-cred-mech','--realm=craftlink.invalid','--user=local-qa:'+secret,'--listening-port='+turnPort,'--min-port=49720','--max-port=49810','--pidfile='+path.join(tmp,'turn.pid'),'--userdb='+path.join(tmp,'turn.sqlite'),'--log-file='+path.join(tmp,'turn.log')],{stdio:'ignore',env:{...process.env,...(process.env.CCLINK_QA_TURN_LIB?{LD_LIBRARY_PATH:process.env.CCLINK_QA_TURN_LIB}:{})}});
relay.on('error',()=>console.error('coturn required for the media-recovery step'));
srv.filterPacket=(from,to,p)=>{
  if(p.kind==='signal' && p.data.type==='offer')offerBytes=Math.max(offerBytes,Buffer.byteLength(p.data.sdp));
  if(p.kind==='text-key' && delayKeys)return false;
  if(p.kind==='text-box')packets.push(JSON.stringify(p));
  return !(block && p.kind==='signal');
};
async function open(n){
 const app=await _electron.launch({executablePath:require('electron'),args:['--headless','--ozone-platform=headless','--no-sandbox','--allow-loopback-in-peer-connection','--use-fake-device-for-media-stream',path.join(__dirname,'..'),'--craftlink-profile='+n],env:{...process.env,XDG_CONFIG_HOME:tmp}});
 apps.push(app);const page=await app.firstWindow();page.setDefaultTimeout(15000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.context().routeWebSocket(providers.jabberru.service,s=>srv.route(s,'jabber.ru'));await page.context().addInitScript(()=>localStorage.setItem('craftlink.settings.v1',JSON.stringify({publicStun:false})));await page.reload();
 await clickPath(page,'#startLogin');await page.fill('#accountJid',n+'@jabber.ru');await page.fill('#accountPass','fixture-password');await page.click('#loginAccount');await page.waitForSelector('#onlineActive');return page;
}
const wait=(p,i,str,timeout=16000)=>p.waitForFunction(([id,text])=>document.getElementById(id)?.textContent.includes(text),[i,str],{timeout});
async function pair(a,b,id){
 await a.fill('#contactJid',id+'@jabber.ru');await a.locator('#addContactForm button').click();await b.locator('#onlineRequests').getByRole('button',{name:'Добавить',exact:true}).click();
 await wait(a,'internetRoster','Онлайн');
}
const row=(p,scope,n)=>p.locator('#'+scope+' .contact-card').filter({hasText:n});
async function chat(p,s){await p.fill('#chatInput',s);await p.click('#sendChatBtn');await wait(p,'chatMessages',s);}
(async()=>{
 const a=await open('anna'),b=await open('boris'),c=await open('vera');
 await pair(a,b,'boris');await pair(b,c,'vera');
 for(const p of [a,b,c])await p.click('#closeInternet');
 await row(a,'workspaceContacts','boris').getByRole('button',{name:'Позвонить'}).click();
 await capture(a,'jabber-outgoing');await capture(b,'jabber-incoming');await b.click('#hubAccept');await wait(a,'participantsCount','2 / 3');await wait(b,'participantsCount','2 / 3');
 for(const p of [a,b]){assert(await p.locator('#chatInput').isDisabled());assert(await p.locator('#sendChatBtn').isDisabled());assert(await p.locator('#mediaNotice').isVisible());}
 delayKeys=false;console.log('PASS Chat is disabled before either route is ready; both clients show the media loading state');
 await wait(b,'chatStatus','зашифровано',22000);await wait(a,'chatStatus','зашифровано');
 assert(await b.locator('#mediaNotice').isVisible());
 await chat(b,'private guest words');await wait(a,'chatMessages','private guest words');
 await chat(a,'private host words');await wait(b,'chatMessages','private host words');
 await apps[1].evaluate(({desktopCapturer})=>{desktopCapturer.getSources=async()=>[{id:'screen:77:0',name:'Тестовый экран'}];});
 await b.evaluate(()=>{
   navigator.mediaDevices.getDisplayMedia=async()=>{
     const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
     const ctx=canvas.getContext('2d'),stream=canvas.captureStream(12);let frame=0;
     const timer=setInterval(()=>{if(stream.getVideoTracks()[0].readyState!=='live'){clearInterval(timer);return;}
       ctx.fillStyle=frame++%2?'#306853':'#75989a';ctx.fillRect(0,0,320,180);},90);return stream;
   };
 });
 await b.click('#shareBtn');await b.click('#screenTabBtn');
 if(await b.locator('#withSystemAudio').isChecked())await b.uncheck('#withSystemAudio');
 await b.locator('#sourcesGrid .source-card').first().click();await b.click('#startShare');
 await wait(a,'stageTitle','Тестовый экран');assert(await a.locator('#mediaNotice').isVisible());
 await a.screenshot({path:path.join(output,'jabber-media-pending.png')});
 await capture(a,'media-pending');assert(packets.length>=3 && packets.every(s=>!s.includes('private')));
 console.log('PASS Two jabber.ru accounts can exchange encrypted room text with no WebRTC and no STUN/TURN; media remains visibly unavailable');
 await row(c,'workspaceContacts','boris').getByRole('button',{name:'Присоединиться'}).click();await wait(b,'callState','Просит войти');
 await b.screenshot({path:path.join(output,'jabber-join-request.png')});
 await capture(b,'join-request');await b.click('#accessCancel');await wait(c,'toast','отклонил запрос');assert(await c.locator('#callDialog').isHidden());
 await row(c,'workspaceContacts','boris').getByRole('button',{name:'Присоединиться'}).click();await b.click('#accessAccept');
 await wait(c,'accessText','добавьте его в друзья');await c.click('#accessAccept');await a.click('#navRequests');
 await a.locator('#inRequests').getByRole('button',{name:'Добавить',exact:true}).click();
 await a.click('#hubAccept');await a.click('#backToCall');
 for(const p of [a,b,c])await wait(p,'participantsCount','3 / 3');
 assert(await b.locator('#copyInviteBtn').isDisabled());
 if(await b.locator('#hubDialog').isVisible())await b.click('#closeHub');
 await wait(c,'chatStatus','зашифровано');await chat(c,'third guest text');await wait(b,'chatMessages','third guest text');await capture(b,'group-chat');
 console.log('PASS Join through a guest contact, decline, retry, explicit mutual approval by the host, 3-person encrypted chat and full-room controls');
 await c.click('#leaveBtn');await wait(b,'participantsCount','2 / 3');
 await clickPath(c,'#createBtn');await c.click('#hubStart');await c.waitForSelector('#leaveBtn');await c.click('#closeHub');
 await c.click('#navRooms');await wait(c,'friendRooms','anna');const listed=c.locator('#friendRooms .room-list-row').filter({hasText:'anna'}).getByRole('button');await listed.click();
 await c.click('#accessAccept');await c.click('#confirmYesBtn');assert(!await a.locator('#accessAccept').isVisible());
 for(const p of [a,b,c])await wait(p,'participantsCount','3 / 3');
 await c.click('#leaveBtn');await wait(b,'participantsCount','2 / 3');
 console.log('PASS Jabber room directory and approved move from an existing room');
 await b.click('#copyInviteBtn');
 await row(b,'inviteFriends','vera').getByRole('button',{name:'Пригласить'}).click();await wait(c,'callState','Приглашает');
 await c.click('#accessAccept');await wait(a,'participantsCount','3 / 3');await wait(c,'participantsCount','3 / 3');
 console.log('PASS An existing guest invites a third person from the call toolbar without copying a link');
 if(await b.locator('#hubDialog').isVisible())await b.click('#closeHub');
 await wait(a,'mediaTitle','прервана',35000);await a.click('#routeHelp');await wait(a,'routeSummary','TURN не получен');
 assert(await a.locator('#mediaDiagnostics').isHidden());
 await a.click('#technicalReport > summary');await wait(a,'mediaDiagnostics','удалённое описание');
 for(const p of [a,b,c]){
   if(p!==a)await clickPath(p,'#networkHelpBtn');
   await p.click('#customRelay summary');if(p===a)await capture(a,'turn-form');await p.fill('#relayAddress','turn:127.0.0.1:'+turnPort+'?transport=udp');
   await p.fill('#relayUser','local-qa');await p.fill('#relaySecret',secret);await p.locator('#relayForm button').click();
   assert.equal(await p.inputValue('#relaySecret'),'');
   assert(!(await p.evaluate(()=>JSON.stringify(localStorage))).includes(secret));
   await p.click('#closeNetworkDialog');
 }
 block=false;await clickPath(a,'#networkHelpBtn');await a.click('#retryMedia');await a.click('#closeNetworkDialog');
 for(const p of [a,b,c])await wait(p,'statusText','На связи',40000);
 await wait(b,'chatStatus','На связи');await b.click('#micBtn');await clickPath(a,'#networkHelpBtn');
 await a.waitForFunction(()=>/Источник 1 · голос [1-9]\d* Б/.test(document.querySelector('#mediaDiagnostics').textContent),null,{timeout:20000});
 const frames=await a.waitForFunction(()=>{
   const m=document.querySelector('#mediaDiagnostics').textContent.match(/Источник 1 · голос (\d+) Б · экран (\d+) Б · звук стрима \d+ Б · кадров декодировано (\d+)/);
   if(!m)return false;
   const values=m.slice(1).map(Number),old=window.qaSamples;window.qaSamples=values;
   return old && old.every((v,i)=>v>0 && values[i]>v)?[old,values]:false;
 },null,{timeout:20000,polling:500});
 console.log('PASS Actual inbound audio bytes, screen bytes and decoded frames advance after recovery',await frames.jsonValue());
 await a.click('#closeNetworkDialog');await a.waitForSelector('#mediaNotice',{state:'hidden'});
 await chat(b,'restored direct chat');await wait(c,'chatMessages','restored direct chat');
 console.log('PASS Explicit temporary TURN and media retry without leaving restore real microphone RTP and direct chat, offer SDP bytes',offerBytes);
 await c.click('#leaveBtn');await wait(b,'participantsCount','2 / 3');
 await clickPath(c,'#createBtn');await c.click('#hubStart');
 const inviteB=async()=>{if(!await c.locator('#hubDialog').isVisible())await c.click('#copyInviteBtn');
   await row(c,'inviteFriends','boris').getByRole('button',{name:'Пригласить'}).click();};
 await inviteB();await wait(b,'callState','Вызов во время разговора');await capture(b,'switch-call');await b.click('#hubDecline');
 await wait(c,'toast','отклонил');await wait(b,'participantsCount','2 / 3');
 await b.click('#settingsBtn');await b.click('[data-pane=connection]');await b.check('#dnd');await b.click('#closeSettingsDialog');
 await inviteB();await wait(c,'toast','занят');assert(await b.locator('#callDialog').isHidden());
 await b.click('#settingsBtn');await b.click('[data-pane=connection]');await b.uncheck('#dnd');await b.click('#closeSettingsDialog');
 await inviteB();await b.click('#hubAccept');await b.locator('dialog[open]').getByRole('button',{name:'Перейти',exact:true}).click();
 await wait(c,'participantsCount','2 / 3');await wait(a,'participantsCount','1 / 3');
 console.log('PASS Jabber invitation during another call: decline, quiet busy response, confirmed switch');
 await b.click('#navFriends');await row(b,'workspaceContacts','anna').getByRole('button',{name:/Действия/}).click();
 await b.locator('#contactChoices').getByRole('button',{name:'Заблокировать'}).click();
 await b.getByRole('button',{name:'Заблокировать',exact:true}).last().click();
 await b.click('#bookFilters [data-filter=blocked]');await b.locator('#workspaceContacts').getByRole('button',{name:'Разблокировать'}).click();
 assert(await row(b,'internetRoster','anna').count()===0);
 console.log('PASS Jabber block and unblock from the friends list');
 assert(offerBytes>0);assert.deepEqual(errors,[]);
})().catch(async e=>{
 console.error(e);
 for(const app of apps){
   const p=app.windows()[0];if(!p)continue;
   if(!await p.locator('dialog[open]').count())await clickPath(p,'#networkHelpBtn',{timeout:2000}).catch(()=>{});
   console.error((await p.textContent('#mediaDiagnostics')).split('\n').filter(s=>/ICE|Согласование|Маршрут|Соединение со/.test(s)).join('\n'));
 }
 process.exitCode=1;
}).finally(async()=>{for(const app of apps)await app.close().catch(()=>{});relay.kill();fs.rmSync(tmp,{force:true,recursive:true});});
