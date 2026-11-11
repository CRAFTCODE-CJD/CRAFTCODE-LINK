const {capture}=require('./visual-capture.cjs');
'use strict';
const { _electron }=require(require.resolve('playwright',{paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||__dirname]}));
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ccl-onboard-')),out=path.join(__dirname,'../out/qa');
fs.mkdirSync(out,{recursive:true});
let app,p;const errors=[];
async function launch(){
 app=await _electron.launch({executablePath:require('electron'),args:['--headless','--ozone-platform=headless','--no-sandbox',path.resolve(__dirname,'..'),'--craftlink-profile=guide'],env:{...process.env,XDG_CONFIG_HOME:root}});
 p=await app.firstWindow();p.setDefaultTimeout(7000);p.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({safeStorage})=>Object.assign(safeStorage,{isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=>'qa-keyring',encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()}));
}
(async()=>{
 await launch();await p.waitForSelector('#entryStart');assert(await p.locator('#startLogin').isHidden());
 await p.selectOption('#introLanguage','en');await p.waitForFunction(()=>document.documentElement.lang==='en');
 await p.waitForSelector('#entryStart');assert.equal(await p.textContent('#startDirect'),'Create a LINK profile');
 await p.click('#guideIntro');for(let i=0;i<3;i++){assert((await p.textContent('#guideStep')).includes((i+1)+' / 3'));assert(!/[А-Яа-я]/.test(await p.textContent('#guideText')));await p.click('#guideNext');}
 await p.click('#startDirect');await p.fill('#directName','Друзья');await p.uncheck('#directAtStart');await p.locator('#directCreateForm button').click();
 await p.locator('#directDialog').waitFor({state:'hidden'});await p.locator('#bookCopy').waitFor();
 assert.equal(await p.textContent('#profileLabel'),'Друзья');await p.click('#bookCopy');await p.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Card copied'));
 await p.click('#linkFriends');await p.locator('#directCode').waitFor();assert(await p.locator('#sendCardRequest').isDisabled());
 await p.fill('#directCode','bogus');await p.click('#sendCardRequest');await p.waitForFunction(()=>!!document.querySelector('#directMessage').textContent);
 await p.click('#directClose');await p.click('#profileBtn');assert.equal(await p.textContent('#identitySummary'),'Signed in to LINK · Друзья');assert(await p.locator('#settingsLogin').isHidden());
 await p.screenshot({path:path.join(out,'profile-English.png')});
 await p.click('#closeSettingsDialog');await app.close();await launch();
 await p.waitForFunction(()=>document.documentElement.lang==='en'&&document.querySelector('#profileLabel').textContent==='Друзья');
 assert(await p.locator('#internetDialog').isHidden());await p.click('#networkHelpBtn');assert(await p.locator('#helpNetwork').isHidden());
 await p.locator('#helpFriendArticle summary').click();await p.click('#helpCopyCard');await p.waitForFunction(()=>document.querySelector('#helpCardStatus').textContent.includes('Card copied'));
 await p.click('#helpAddCard');assert(await p.locator('#directCode').isVisible());await capture(p,'add-card-english');await p.click('#directClose');
 await p.click('#networkHelpBtn');await p.screenshot({path:path.join(out,'help-English.png')});await p.click('#helpConnectivity');assert(await p.locator('#mediaDiagnostics').isHidden());await p.click('#technicalReport summary');await p.locator('#mediaDiagnostics').waitFor({state:'visible'});assert((await p.textContent('#mediaDiagnostics')).includes('CRAFTCODE LINK'));await p.click('#closeNetworkDialog');
 await p.click('#linkHost');await p.waitForSelector('#leaveBtn:enabled');assert.equal(await p.textContent('#profileLabel'),'Друзья');await p.click('#leaveBtn');if(await p.locator('#confirmYesBtn').isVisible())await p.click('#confirmYesBtn');
 await p.click('#profileBtn');await p.click('#linkLogout');await p.click('#confirmYesBtn');await p.waitForFunction(()=>document.querySelector('#profileLabel').textContent==='Sign in');
 await app.close();await launch();await p.waitForSelector('#linkFriends');await p.click('#linkFriends');await p.waitForSelector('#directReturn');await capture(p,'resume-profile');await p.click('#resumeLink');await p.locator('#directDialog').waitFor({state:'hidden'});await p.locator('#bookCopy').waitFor();
 await p.click('#profileBtn');assert.equal(await p.textContent('#identitySummary'),'Signed in to LINK · Друзья');
 await p.click('#changeMethod');await p.click('#confirmNoBtn');assert.equal(await p.textContent('#identitySummary'),'Signed in to LINK · Друзья');
 await p.selectOption('#displayLanguage','ru');await p.waitForFunction(()=>document.documentElement.lang==='ru'&&document.querySelector('#profileLabel').textContent==='Друзья');
 await p.click('#profileBtn');assert.equal(await p.textContent('#identitySummary'),'Вы вошли в LINK · Друзья');
 await p.click('#changeMethod');await p.click('#confirmYesBtn');await p.waitForSelector('#entryStart');await p.locator('#entryFallback summary').click();assert(await p.locator('#startLogin').isVisible());
 assert.deepEqual(errors,[]);console.log('PASS fresh LINK-only welcome, optional methods, 3 tutorial steps, English and Russian, unchanged Cyrillic username, explicit LINK identity, room hosting, help, both card actions, quiet diagnostics, active profile restored after restart, sign out, cold return, cancel/confirm method switch.');
})().catch(async e=>{console.error(e,errors,await p?.evaluate(()=>[document.documentElement.lang,localStorage.getItem('craftcode.language'),document.querySelector('#languageNote').textContent,document.querySelector('#toast').textContent]).catch(()=>null),await p?.locator('dialog[open]').evaluateAll(e=>e.map(x=>x.id)).catch(()=>[]));process.exitCode=1;}).finally(async()=>{await app?.close();fs.rmSync(root,{recursive:true,force:true});});
