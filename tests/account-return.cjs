const {clickPath}=require('./qa-navigation.cjs');
// First run, registration handoff and clean reinstall against a local XMPP fixture.
// No public account is created; the *system* file pickers are stubbed, their file I/O is real.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(require.resolve('playwright',{paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || __dirname]}));
const { Fixture } = require('./xmpp-fixture.cjs');

const { providers }=require('../src/renderer/providers.mjs');
const domain=providers.jabberru.domain;

(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'link-account-test-'));
 const server=new Fixture({port:34921,secret:'test-only'});
 const who='alex@'+domain,friend='ira@'+domain;
 server.rosters.set(who,new Map([[friend,{to:true,from:true}]]));
 const card=path.join(root,'Карточка входа.txt');
 const errors=[],checks=[];
 let app,page,profile;
 let available='none';
 const probeFrames=[];
 const pass=name=>{checks.push(name);console.log('PASS',name);};
 async function launch(){
   app=await _electron.launch({executablePath:require('electron'),args:['--headless','--ozone-platform=headless','--no-sandbox',
     path.join(__dirname,'..'),'--craftlink-profile=account-return'],env:{...process.env,XDG_CONFIG_HOME:root}});
   page=await app.firstWindow(); page.setDefaultTimeout(9000);page.on('pageerror',e=>errors.push(e.message));
   await page.context().route(providers.jabberclub.bosh,route=>route.abort());
   for (const key of ['jabberclub','jabberru','jix']) {
     const site=providers[key];
     await page.context().routeWebSocket(site.service,ws=>{
       if (available === 'hold') return;
       if (available === key || available === 'both') return server.route(ws,site.domain);
       ws.onMessage(frame=>{probeFrames.push(frame);ws.send('<html/>');});
     });
   }
   await page.reload();
   profile=await app.evaluate(({app})=>app.getPath('userData'));
   assert.ok(profile.startsWith(root+path.sep),'only use the isolated test profile');
   await app.evaluate(({dialog,shell,session},file)=>{
     globalThis.qaExternal=[];
     globalThis.qaRejectClub = false;
     session.fromPartition('link-registration-check',{cache:false}).fetch=async url=>{
       if(url.includes('/captcha.php'))return new Response(globalThis.qaRejectClub?'blocked':Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(32)]),{headers:{'content-type':'image/png'}});
       const js=url.includes('.js');
       const body=js ? '/register renderCaptcha recaptcha' : '#register /js/bundle.js name="nickname" name="password_confirm" name="captcha_answer"';
       return new Response(body,{headers:{'content-type':js?'text/javascript':'text/html'}});
     };
     shell.openExternal=async url=>{globalThis.qaExternal.push(url);};
     dialog.showSaveDialog=async()=>({canceled:false,filePath:file});
     dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});
   },card);
 }
 const visible=s=>page.locator(s).waitFor({state:'visible'});
 async function shutdown(){await app.close();app=null;}
 try{
   await launch();await visible('#entryStart');await clickPath(page,'#startCreate');
   await page.waitForFunction(()=>document.querySelector('#providerStatus').textContent.includes('не подтвердила'));
   assert.ok(await page.locator('#registerAccount').isEnabled());
   assert.equal(await page.inputValue('#xmppProvider'),'jabberru');
   assert.equal(probeFrames.length,1);assert.ok(probeFrames.every(x=>x.startsWith('<open ') && !x.includes('alex')));
   pass('Jabber.ru is the default even after an inconclusive check, with no automatic website or alternative connection');
   available='hold';await page.click('#retryProvider');await page.click('#serviceSummary');
   await page.selectOption('#xmppProvider','hotchilli');
   await page.waitForFunction(()=>document.querySelector('#providerStatus').textContent.includes('вручную'));
   await page.click('#alreadyCreated');assert.equal(await page.inputValue('#xmppProvider'),'hotchilli');
   pass('Manual service survives the transition from registration to short-name login');
   available='both';await page.click('#loginCreate');
   await page.waitForFunction(()=>document.querySelector('#providerStatus').textContent.includes('отвечают'));
   assert.equal(await page.inputValue('#xmppProvider'),'jabberru');assert.equal(server.clients.size,0);
   pass('Registration can start over from sign-in under Jabber.ru without sending credentials');
   await page.click('#registerAccount');
   await visible('#accountForm');
   assert.deepEqual(await app.evaluate(()=>globalThis.qaExternal),[providers.jabberru.register]);
   pass('Fresh profile opens the two choices; register opens the provider and returns to the sign-in form');
   await shutdown();await launch();await visible('#accountForm');
   await page.fill('#accountJid','https://jabber.hot-chilli.net/forms/create/');await page.fill('#accountPass','fixture-password');await page.click('#loginAccount');
   await visible('#onlineError');assert.equal(server.clients.size,0);
   await page.fill('#accountJid','alex');assert.ok((await page.textContent('#loginPreview')).includes(who));await page.click('#loginAccount');
   await visible('#saveCardBox');await visible('#internetRoster .contact-card');await page.click('#saveCard');
   await page.waitForFunction(()=>document.querySelector('#cardFeedback').textContent.startsWith('Карточка сохранена'));
   const text=await fs.readFile(card,'utf8');assert.ok(text.includes(who));assert.ok(!text.includes('fixture-password'));assert.ok(!text.includes(friend));
   pass('Registration resumes after restart; URL is rejected; nickname signs in and saves an address-only card outside the profile');
   await shutdown();await fs.rm(profile,{recursive:true});await launch();await visible('#entryStart');await clickPath(page,'#startLogin');
   await page.click('#openRecovery');
   assert.equal(await page.locator('#resetPassword').isDisabled(),true);
   await page.click('#serviceSummary');await page.selectOption('#xmppProvider','hotchilli');await page.click('#resetPassword');
   await page.selectOption('#xmppProvider','jabberes');await page.click('#resetPassword');
   assert.deepEqual(await app.evaluate(()=>globalThis.qaExternal),['https://jabber.hot-chilli.net/forms/resetpw/','https://www.jabberes.org/acerca-de/#contacto']);
   pass('Fresh reinstall has provider-specific password recovery and a forgotten-address path');
   await page.click('#recoverCard');await visible('#accountPass');
   assert.equal(await page.inputValue('#accountJid'),who);assert.equal(await page.inputValue('#xmppProvider'),'jabberru');
   assert.equal(await page.inputValue('#accountPass'),'');assert.equal(server.clients.size,0);
   await page.fill('#accountPass','fixture-password');await page.click('#loginAccount');
   await visible('#internetRoster .contact-card');
   assert.equal(await page.textContent('#signedAddress'),who);assert.ok((await page.textContent('#internetRoster')).includes(friend));
   await page.locator('#internetDialog').getByRole('button',{name:'Скопировать адрес '+friend,exact:true}).click();
   assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),friend);
   pass('After full profile deletion the card restores the correct address; password is still required and the original roster returns');
   await page.click('#logoutAccount');await visible('#entryStart');await page.click('#entryLater');
   await shutdown();await launch();await visible('#navFriends');
   await page.waitForFunction(()=>document.querySelector('#statusText')?.textContent==='Не в комнате');
   await clickPath(page,'#internetBtn');await visible('#accountPass');assert.deepEqual(errors,[]);
   pass('Later and logout leave manual access available and Friends can reopen sign-in');
 } catch (e) {
   if(page && !page.isClosed())console.error('UI status',await page.locator('#onlineStatus').textContent(),'message',await page.locator('#onlineError').textContent(),'clients',server.clients.size,'page errors',errors);
   throw e;
 } finally {if(app) await shutdown();await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
