const {clickPath}=require('./qa-navigation.cjs');
'use strict';
const path=require('node:path'), fs=require('node:fs'), assert=require('node:assert/strict');
const {_electron}=require(require.resolve('playwright',{paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || __dirname]}));
const {Fixture}=require('./xmpp-fixture.cjs');
const {providers}=require('../src/renderer/providers.mjs');
const homes={anna:providers.jabberclub,boris:providers.jabberru,vera:providers.hotchilli};
const address=name=>name+'@'+homes[name].domain;
const {spawn}=require('node:child_process'),{randomBytes}=require('node:crypto'),os=require('node:os');
const turn={port:34921,secret:randomBytes(24).toString('hex')};
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'craftlink-turn-'));
const relays=[];
function startRelay(port,low){
const rel=spawn(process.env.CCLINK_QA_TURN || 'turnserver',['-n','--listening-ip=127.0.0.1','--relay-ip=127.0.0.1','--allow-loopback-peers','--no-cli','--no-tls','--no-dtls','--no-multicast-peers','--relay-threads=1','--lt-cred-mech','--realm=craftlink.invalid','--user=local-qa:'+turn.secret,'--listening-port='+port,'--min-port='+low,'--max-port='+(low+80),'--pidfile='+path.join(tmp,'pid'+port),'--log-file='+path.join(tmp,'turn'+port+'.log'),'--userdb='+path.join(tmp,'turn.sqlite')],{stdio:'ignore',env:{...process.env,...(process.env.CCLINK_QA_TURN_LIB?{LD_LIBRARY_PATH:process.env.CCLINK_QA_TURN_LIB}:{})}});
rel.on('error',e=>console.error('Local coturn is required:',e.message));
relays.push(rel);return rel;
}
const rel=startRelay(turn.port,49420);
const srv=new Fixture(turn), apps=[],errors=[], tag='internet-qa-'+Date.now();
const out=path.join(__dirname,'../out/qa');fs.mkdirSync(out,{recursive:true});
const log=s=>console.log('PASS '+s);
const wait=(p,id,txt)=>p.waitForFunction(([id,t])=>document.querySelector(id)?.textContent.includes(t),[id,txt],{timeout:18000});
let signalingPaused=false;
async function open(n){
 const app=await _electron.launch({executablePath:require('electron'),env:{...process.env,XDG_CONFIG_HOME:tmp},args:['--headless','--ozone-platform=headless','--no-sandbox','--allow-loopback-in-peer-connection','--use-fake-device-for-media-stream',path.join(__dirname,'..'),'--craftlink-profile='+tag+'-'+n]});apps.push(app);
 const page=await app.firstWindow();await page.waitForFunction(()=>document.querySelector('#statusText')?.textContent==='Не в комнате');await page.context().routeWebSocket(homes[n].service,ws=>{if(signalingPaused)ws.close({code:1012,reason:'QA outage'});else srv.route(ws,homes[n].domain);});
 if(homes[n].bosh)await page.context().route(homes[n].bosh,route=>route.abort());
 await page.reload();
 page.setDefaultTimeout(13000);page.on('pageerror',e=>errors.push(e.message));
 await clickPath(page,'#startLogin');await page.fill('#accountJid',address(n));await page.fill('#accountPass','fixture-password');await page.uncheck('#rememberAccount');await page.click('#loginAccount');
 await wait(page,'#onlineStatus','На связи');
 if(process.argv.includes('--relay-only')){await page.click('#openConnectionSettings');await page.click('#advancedRouting > summary');await page.check('#strictProxy');await page.click('#closeSettingsDialog');}
 return page;
}
const onlineCard=(p,n)=>p.locator('#internetRoster .contact-card').filter({hasText:n+'@'});
async function pair(a,b,n,me){
 await a.fill('#contactJid',address(n));await a.locator('#addContactForm button').click();
 await wait(b,'#onlineRequests',me+'@');await b.locator('#onlineRequests').getByRole('button',{name:'Добавить'}).click();
 await onlineCard(a,n).getByRole('button',{name:'Позвонить'}).waitFor();await wait(a,'#internetRoster','Онлайн');
}
(async()=>{
 const a=await open('anna'),b=await open('boris'),c=await open('vera');log('Strophe WebSocket framing, SASL and binding in 3 isolated app windows using local provider fixture');
 await pair(a,b,'boris','anna');await pair(a,c,'vera','anna');log('Mutual subscription and online CRAFTCODE LINK presence');
 await a.click('#openConnectionSettings');await a.click('#previewCue');await a.uncheck('#cueEnabled');await a.check('#cueEnabled');await a.click('#closeSettingsDialog');
 await a.screenshot({path:path.join(out,'online-contacts.png')});
 await a.click('#closeInternet');await b.click('#closeInternet');await c.click('#closeInternet');
 await a.click('#profileBtn');
 assert.equal(await a.inputValue('#profileId'),address('anna'));await a.click('#profileCopy');
 assert.equal(await apps[0].evaluate(({clipboard})=>clipboard.readText()),address('anna'));
 await a.fill('#profileName','Анна');await a.locator('#profileForm button').click();await a.click('#closeSettingsDialog');await wait(b,'#internetRoster','Анна');
 await clickPath(a,'#internetBtn');await a.fill('#contactFilter','BOR');assert.equal(await a.locator('#internetRoster .contact-card').count(),1);
 await a.fill('#contactFilter','');await a.click('#closeInternet');
 await clickPath(a,'#createBtn');await a.click('#hubManual');assert.equal(await a.inputValue('#nameInput'),'Анна');await a.click('#closeRoomDialog');
 log('Copied full profile login, saved a display name, filtered contacts and prefilled the manual room');
 await a.locator('#workspaceContacts .contact-card').filter({hasText:'boris'}).getByRole('button',{name:'Позвонить'}).click();
 await wait(b,'#callState','Входящий звонок');
 assert(await a.locator('#callDialog').isVisible() && !await a.locator('#internetDialog').isVisible());
 assert(await b.locator('#hubCodeForm').isHidden());
 await a.screenshot({path:path.join(out,'calling.png')});await b.screenshot({path:path.join(out,'incoming.png')});
 await b.click('#hubDecline');
 await wait(a,'#participantsCount','0 / 8');log('Decline closes pending room without enabling capture');
 await a.locator('#workspaceContacts .contact-card').filter({hasText:'boris'}).getByRole('button',{name:'Позвонить'}).click();
 await b.waitForSelector('#hubAccept');await a.click('#hubCancelCall');await wait(b,'#toast','отменил вызов');
 await wait(a,'#participantsCount','0 / 8');assert(await b.locator('#callDialog').isHidden());
 log('Outgoing cancel dismisses the incoming prompt and leaves no pending call');
 if(await a.locator('#internetDialog').isVisible())await a.click('#closeInternet');
 await clickPath(a,'#createBtn');await a.click('#hubStart');await wait(a,'#participantsCount','1 / 3');
 await a.locator('#inviteFriends .contact-card').filter({hasText:'boris@'}).getByRole('button',{name:'Пригласить'}).click();
 await wait(b,'#callState','Приглашение');await b.click('#hubDecline');await wait(a,'#toast','отклонил приглашение');assert(await a.locator('#callDialog').isHidden());await wait(a,'#participantsCount','1 / 3');
 await a.click('#copyInviteBtn');await a.click('#hubCopy');const code=await apps[0].evaluate(({clipboard})=>clipboard.readText());assert.ok(code.startsWith('LINK1:anna@'));
 await clickPath(b,'#joinBtn');await b.fill('#hubCode','bad');await b.click('#hubEnter');await wait(b,'#hubError','целиком');
 await b.fill('#hubCode',code.slice(0,-6)+'123456');await b.click('#hubEnter');await wait(b,'#hubError','закрыта');
 await b.fill('#hubCode',code);await b.click('#hubEnter');
 await wait(a,'#callState','Просит войти');await a.click('#hubAccept');
 for(const p of [a,b]){await wait(p,'#participantsCount','2 / 3');await wait(p,'#voiceGrid','Анна');}
 log('Explicit room survives decline, invalid and stale codes show errors, confirmed friend enters the right room by copied code');
 await a.click('#copyInviteBtn');await a.locator('#inviteFriends .contact-card').filter({hasText:'vera@'}).getByRole('button',{name:'Пригласить'}).click();
 await wait(c,'#callState','Приглашение');await c.click('#hubDecline');await wait(a,'#toast','отклонил приглашение');
 await wait(b,'#participantsCount','2 / 3');assert(await a.locator('#callDialog').isHidden());
 await wait(b,'#statusText','На связи');await b.fill('#chatInput','two-still-here');await b.click('#sendChatBtn');await wait(a,'#chatMessages','two-still-here');
 log('Declining a third-party invite preserves the existing two-person chat and media connection');
 await a.click('#copyInviteBtn');await a.locator('#inviteFriends .contact-card').filter({hasText:'vera@'}).getByRole('button',{name:'Пригласить'}).click();
 await wait(c,'#callState','Приглашение');await c.click('#minimizeCall');await clickPath(c,'#joinBtn');await c.click('#hubAccept');
 log('Incoming invitation stays in the inbox until answered and a third friend joins through the create/invite UI');
 for(const p of [a,b,c]){await wait(p,'#participantsCount','3 / 3');assert.equal(await p.locator('#micBtn').getAttribute('aria-pressed'),'false');}
 log('Three-person host room, capture off by default');
 await wait(a,'#statusText','На связи');await wait(b,'#statusText','На связи');await wait(c,'#statusText','На связи');
 await c.fill('#chatInput','room-channel-check');await c.click('#sendChatBtn');await wait(b,'#chatMessages','room-channel-check');
 assert(!srv.transcript.includes('body'));log('WebRTC DataChannel chat forwarded from guest to guest');
 await c.click('#micBtn');await clickPath(b,'#networkHelpBtn');
 const result=await b.waitForFunction(()=>{const m=document.querySelector('#mediaDiagnostics').textContent.match(/Источник 2 · голос (\d+) Б/);const v=m?Number(m[1]):0,prev=window.previousBytes||0;window.previousBytes=v;return prev>0&&v>prev?[prev,v]:false;},null,{timeout:20000,polling:500});
 console.log('PASS third guest microphone RTP bytes at other guest',await result.jsonValue());
 if(process.argv.includes('--relay-only')){await wait(b,'#connectionHint','через ретранслятор');log('Selected TURN path under strict relay-only policy');}
    await apps[2].evaluate(({ desktopCapturer }) => {
      desktopCapturer.getSources = async () => [
        { id: 'screen:77:0', name: 'Synthetic QA desktop' }, { id: 'window:78:0', name: 'Synthetic QA window' },
      ];
    });
    await c.evaluate(() => {
      window.qaCaptures = [];
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 320; canvas.height = 180;
        const ctx = canvas.getContext('2d');
        ctx.fillRect(0, 0, 320, 180);
        const stream = canvas.captureStream(12);
        let frame = 0;
        const timer = setInterval(() => {
          if (stream.getVideoTracks()[0].readyState !== 'live') { clearInterval(timer); return; }
          ctx.fillStyle = frame++ % 2 ? '#44aa88' : '#113344';
          ctx.fillRect(0, 0, 320, 180);
        }, 80);
        window.qaCaptures.push(stream);
        return stream;
      };
    });
    const shareSynthetic = async tab => {
      await c.locator('#shareBtn').click();
      await c.locator(tab).click();
      if (await c.locator('#withSystemAudio').isChecked()) await c.locator('#withSystemAudio').uncheck();
      await c.locator('#sourcesGrid .source-card').first().click();
      await c.click('#startShare');
      await c.waitForFunction(() => !document.querySelector('#sourceDialog').open);
    };
    await shareSynthetic('#screenTabBtn');

 const counts=await b.waitForFunction(()=>{const m=document.querySelector('#mediaDiagnostics').textContent.match(/Источник 2 · голос (\d+) Б · экран (\d+) Б · звук стрима (\d+) Б · кадров декодировано (\d+)/);
 if(!m)return false;const v=[Number(m[2]),Number(m[4])],old=window.lastScreen || [0,0];window.lastScreen=v;return old[1]>0 && v[0]>old[0] && v[1]>old[1]?[old,v]:false;},null,{timeout:20000,polling:500});
 console.log('PASS third guest screen bytes and decoded frames at other guest',await counts.jsonValue());
 await b.click('#closeNetworkDialog');
 if(process.argv.includes('--signaling-outage')){
   signalingPaused=true;
   for(const client of [...srv.clients.values()])client.ws.close({code:1012,reason:'QA continuous signaling outage'});
   const start=Date.now();
   await new Promise(resolve=>setTimeout(resolve,126000));
   for(const tab of [a,b,c]) {await wait(tab,'#participantsCount','3 / 3');await wait(tab,'#statusText','На связи');}
   assert.ok((await b.textContent('#internetRoster')).includes('Статус неизвестен'));
   await c.fill('#chatInput','outage-chat');await c.click('#sendChatBtn');await wait(b,'#chatMessages','outage-chat');
   await clickPath(b,'#networkHelpBtn');
   const read=()=>b.textContent('#mediaDiagnostics').then(text=>text.match(/Источник 2 · голос (\d+) Б · экран (\d+) Б · звук стрима \d+ Б · кадров декодировано (\d+)/).slice(1).map(Number));
   const before=await read(); await new Promise(resolve=>setTimeout(resolve,4000)); const after=await read();
   assert.ok(after.every((v,i)=>v>before[i]));
   console.log('PASS established three-person call, chat, microphone and decoded video throughout XMPP outage',Date.now()-start,'ms',before,after);
   await b.click('#closeNetworkDialog'); signalingPaused=false;
   const deadline=Date.now()+85000;while(![...Object.keys(homes)].every(n=>srv.clients.get(address(n))?.online)){
     if(Date.now()>deadline)throw new Error('XMPP did not return after extended outage');
     await new Promise(resolve=>setTimeout(resolve,300));
   }
 }
 const oldEndpoint=srv.clients.get(address('boris'));oldEndpoint.ws.close({code:1012,reason:'QA signaling restart'});
 const deadline=Date.now()+20000;while(srv.clients.get(address('boris'))===oldEndpoint || !srv.clients.get(address('boris'))?.online){if(Date.now()>deadline)throw new Error('No signaling recovery');await new Promise(r=>setTimeout(r,150));}
 await c.fill('#chatInput','after-reconnect');await c.click('#sendChatBtn');await wait(b,'#chatMessages','after-reconnect');
 await wait(b,'#participantsCount','3 / 3');log('Signaling reconnect preserves roster and existing data channel');
 if(process.argv.includes('--relay-only')){
   await clickPath(b,'#networkHelpBtn');
   for(const returning of [false,true]){
   const previous=await b.textContent('#mediaDiagnostics');
   const counters=t=>t.match(/Источник 2 · голос (\d+) Б · экран (\d+) Б · звук стрима \d+ Б · кадров декодировано (\d+)/).slice(1).map(Number);
   const before=counters(previous);
   const old=relays.at(-1);await new Promise(resolve=>{old.once('exit',resolve);old.kill();});
   await new Promise(resolve=>setTimeout(resolve,3200));
   turn.port=returning?34921:34922;startRelay(turn.port,returning?49420:49620);
   // Neither OS routing nor a real VPN is altered. Destroying TURN removes the only usable path.
   // The production main-process network event models an adapter appearing on the host.
   srv.dropOneAnswer=!returning;
   if(!returning)await apps[0].evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('craftlink:event',{type:'network-route-changed'}));
   const delivered=await b.waitForFunction(old=>{
     const text=document.querySelector('#mediaDiagnostics').textContent;
     const m=text.match(/Источник 2 · голос (\d+) Б · экран (\d+) Б · звук стрима \d+ Б · кадров декодировано (\d+)/);
     if(!m || !text.includes('Маршрут TURN'))return false;
     const now=m.slice(1).map(Number);
     return now[0]>old[0]+4000 && now[1]>old[1]+5000 && now[2]>old[2]+65?now:false;
   },before,{timeout:85000,polling:500});
   assert.equal(srv.dropOneAnswer,false);
   const message=returning?'relay-back':'new-relay-only';await c.fill('#chatInput',message);await c.click('#sendChatBtn');
   await wait(b,'#chatMessages',message);
   console.log(returning?'PASS reverse migration detected by WebRTC with no adapter notification; audio/video and chat restored':'PASS destroyed TURN route, refreshed at a different port, lost one answer, restored RTP/video and chat without a new invitation',before,await delivered.jsonValue());
   }
   await b.click('#closeNetworkDialog');
 }
 await a.click('#leaveBtn');await a.click('#confirmYesBtn');for(const p of [a,b,c])await wait(p,'#participantsCount','0 / 8');
 assert.deepEqual(errors,[]);log('Clean release and no renderer exceptions');
})().catch(async e=>{console.error(e.message,errors);for(const app of apps){const p=app.windows()[0];if(p)console.error(await p.locator('body').innerText().then(s=>s.slice(-800)).catch(()=>''));}process.exitCode=1;}).finally(async()=>{for(const app of apps)await app.close().catch(()=>{});for(const server of relays)server.kill();fs.rmSync(tmp,{recursive:true,force:true});});
