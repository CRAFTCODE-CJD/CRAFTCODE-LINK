'use strict';
const {testRuntime}=require('./electron-runtime.cjs');
// Real Windows IPC/UI with a private AppData, DPAPI profile and Downloads.
// Native folder choices and relaunch are controlled by this launcher only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {_electron}=require(require.resolve('playwright',{paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||__dirname]}));
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'link-storage-ui-'));
const appData=path.join(temp,'AppData'),downloads=path.join(temp,'Downloads'),driveA=path.join(temp,'drive-a'),driveB=path.join(temp,'drive-b');
for(const dir of [appData,downloads,driveA,driveB])fs.mkdirSync(dir);
const launcher=path.join(temp,'launch.cjs'),errors=[],apps=new Set();let client;
fs.writeFileSync(launcher,`
  const {app,dialog,safeStorage,shell}=require('electron'),fs=require('node:fs'),path=require('node:path');
  shell.openPath=async folder=>{globalThis.openedFolder=folder;return '';};
  const ownRequire=require('node:module').createRequire(${JSON.stringify(path.join(root,'package.json'))});
  app.setPath('appData',${JSON.stringify(appData)});app.setPath('downloads',${JSON.stringify(downloads)});
  app.getVersion=()=>ownRequire('./package.json').version;
  app.getAppPath=()=>${JSON.stringify(root)};
  app.on('browser-window-created',(_,win)=>{win.show=()=>{};win.showInactive=()=>{};win.focus=()=>{};});
  dialog.showOpenDialog=async()=>globalThis.testChosenFolder?{canceled:false,filePaths:[globalThis.testChosenFolder]}:{canceled:true,filePaths:[]};
  dialog.showErrorBox=(title,message)=>{console.error(title,message);fs.writeFileSync(${JSON.stringify(path.join(temp,'startup-error'))},title+' '+message);};
  app.relaunch=()=>fs.writeFileSync(${JSON.stringify(path.join(temp,'restart-requested'))},'requested');
  globalThis.fetch=async()=>new Response('',{status:404});
  const {Networks}=ownRequire('./src/direct/networks.cjs');Networks.prototype.publishDht=()=>{};Networks.prototype.startLan=async()=>{};
  app.whenReady().then(()=>{
    const {ProfileStore,publicCard,seed,friend}=ownRequire('./src/direct/identity.cjs');
    const store=new ProfileStore(app.getPath('userData'),safeStorage);
    if(!store.read()){
      const other=publicCard({root:seed(),device:seed(),name:'Offline fixture'}),p={root:seed(),device:seed(),name:'Storage fixture',friends:[friend(other,'friend')],dht:false,lan:''};
      store.write(p);store.chatHistory.open(publicCard(p));
      store.chatHistory.enqueue(other.id,p.friends[0].chatKey,require('node:crypto').randomUUID(),'Queue survives migration');store.chatHistory.close();
    }
    globalThis.inspectStorageProfile=()=>{
      const p=store.read(),history=store.chatHistory;history.open(publicCard(p));
      try{return {card:publicCard(p),friends:p.friends.map(f=>f.id),messages:history.page(p.friends[0].id,p.friends[0].chatKey).messages.map(r=>({text:r.text,status:r.status}))};}finally{history.close();}
    };
  });
  ownRequire('./src/entry.cjs');
`);
async function open(){
  const app=await _electron.launch({executablePath:testRuntime(),args:[launcher,'--craftlink-profile=storage','--mute-audio','--no-error-dialogs'],env:{...process.env}});
  apps.add(app);
  const page=await app.firstWindow();page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(String(e)));
  await page.waitForFunction(()=>typeof document.querySelector('#bookQuery')?.oninput==='function');
  const data=await app.evaluate(({app})=>app.getPath('userData'));assert(data.startsWith(temp+path.sep));
  if(await page.locator('#profileWelcome').isVisible())await page.click('#welcomeSkip');
  return {app,page,data};
}
async function settings(){
  await client.page.click('#settingsBtn');await client.page.click('[data-pane="storage"]');
  await client.page.waitForFunction(()=>document.querySelector('#storagePath').textContent!=='—'&&document.querySelector('#pref-storage').getAttribute('aria-busy')==='false');
}
async function choose(folder,selector){
  await client.app.evaluate((_,folder)=>{globalThis.testChosenFolder=folder;},folder);await client.page.click(selector);
  await client.page.waitForFunction(()=>document.querySelector('#pref-storage').getAttribute('aria-busy')==='false');
}
async function restart(){
  const old=client.app,closed=old.waitForEvent('close');await client.page.click('#storageRestart');await closed;apps.delete(old);client=null;
  assert(fs.existsSync(path.join(temp,'restart-requested')));client=await open();
}
async function narrowCapture(name){
  await client.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,600));
  await client.page.waitForTimeout(350);
  const overflow=await client.page.evaluate(()=>{
    const pane=document.querySelector('#pref-storage'),bounds=pane.getBoundingClientRect();
    return [...pane.querySelectorAll('button,.storage-summary,.storage-path')].filter(e=>e.getClientRects().length).some(e=>{const r=e.getBoundingClientRect();return r.left<bounds.left-1||r.right>bounds.right+1||e.scrollWidth>e.clientWidth+1;});
  });assert.equal(overflow,false,'storage controls fit 800px width');
  const filename=path.join(root,'out','qa',name);
  await client.app.evaluate(async({BrowserWindow})=>BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true}));
  await client.page.waitForTimeout(350);
  fs.writeFileSync(filename,Buffer.from(await client.app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true})).toPNG().toString('base64')),'base64'));
  await client.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,940));
}
(async()=>{
  client=await open();const original=await client.app.evaluate(()=>globalThis.inspectStorageProfile());
  await client.page.evaluate(()=>localStorage.setItem('storage-fixture','appearance survives'));
  await settings();await client.page.fill('#settingsSearch','Хранилище');assert(await client.page.locator('[data-pane="storage"]').isVisible());await client.page.fill('#settingsSearch','');
  async function checkOpen(button,expected){
    await client.page.locator('#'+button).focus();await client.page.keyboard.press('Enter');
    await client.page.waitForFunction(()=>document.querySelector('#pref-storage').getAttribute('aria-busy')==='false');
    assert.equal(await client.app.evaluate(()=>globalThis.openedFolder),fs.realpathSync.native(expected));
  }
  await checkOpen('storageOpen',client.data);await checkOpen('downloadsOpen',downloads);
  await assert.rejects(client.page.evaluate(()=>window.craftlink.storage({op:'open-profile',path:'untrusted'})));
  await choose(null,'#storageChoose');assert(await client.page.locator('#storageMove').isHidden());
  await choose(driveA,'#storageChoose');assert(await client.page.locator('#storageConfirmMove').isVisible(),await client.page.locator('#storageStatus').innerText());await client.page.click('#storageCancelMove');
  await client.page.waitForSelector('#storageMove',{state:'hidden'});
  await choose(driveB,'#downloadsChoose');assert.equal(await client.page.locator('#downloadsPath').innerText(),driveB);
  await checkOpen('downloadsOpen',driveB);
  fs.rmdirSync(driveB);
  await client.app.evaluate(()=>{globalThis.openedFolder=null;});
  await client.page.click('#downloadsOpen');
  await client.page.waitForFunction(()=>document.querySelector('#storageStatus').textContent.includes('доступен ли диск'));
  assert.equal(await client.app.evaluate(()=>globalThis.openedFolder),null);
  fs.mkdirSync(driveB);
  await checkOpen('downloadsOpen',driveB);
  await client.page.click('#storageClearCache');await client.page.waitForFunction(()=>document.querySelector('#pref-storage').getAttribute('aria-busy')==='false');
  assert.equal(await client.page.evaluate(()=>localStorage.getItem('storage-fixture')),'appearance survives');
  assert.deepEqual(await client.app.evaluate(()=>globalThis.inspectStorageProfile()),original);
  await choose(driveA,'#storageChoose');await client.page.click('#storageConfirmMove');await client.page.locator('#storageRestart').waitFor();
  const out=path.join(root,'out','qa');fs.mkdirSync(out,{recursive:true});
  await narrowCapture('0714-storage-ui-ru-800.png');
  fs.writeFileSync(path.join(out,'0714-storage-ui-ru.png'),Buffer.from(await client.app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true})).toPNG().toString('base64')),'base64'));
  await restart();assert.equal(client.data,path.join(driveA,'CRAFTCODE LINK Data'));
  assert.deepEqual(await client.app.evaluate(()=>globalThis.inspectStorageProfile()),original);
  assert.equal(await client.page.evaluate(()=>localStorage.getItem('storage-fixture')),'appearance survives');
  await settings();assert.equal(await client.page.locator('#downloadsPath').innerText(),driveB);
  await checkOpen('storageOpen',client.data);
  await client.page.evaluate(async()=>{localStorage.setItem('craftcode.language','en');await window.craftlink.setLanguage('en');});await client.page.reload();
  await client.page.waitForFunction(()=>typeof document.querySelector('#bookQuery')?.oninput==='function');await settings();
  await client.page.fill('#settingsSearch','Storage');assert(await client.page.locator('[data-pane="storage"]').isVisible());await client.page.fill('#settingsSearch','');
  assert.equal(await client.page.locator('#storageChoose').innerText(),'Change location');
  await narrowCapture('0714-storage-ui-en-800.png');
  fs.writeFileSync(path.join(out,'0714-storage-ui-en.png'),Buffer.from(await client.app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true})).toPNG().toString('base64')),'base64'));
  // A second move exercises reopening the same stable lock and persistent path map.
  const second=path.join(temp,'drive-c');fs.mkdirSync(second);await choose(second,'#storageChoose');await client.page.click('#storageConfirmMove');await client.page.locator('#storageRestart').waitFor();await restart();
  assert.equal(client.data,path.join(second,'CRAFTCODE LINK Data'));assert.deepEqual(await client.app.evaluate(()=>globalThis.inspectStorageProfile()),original);
  assert.equal(await client.page.evaluate(()=>localStorage.getItem('storage-fixture')),'appearance survives');assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'0714-storage-desktop.json'),JSON.stringify({result:'PASS',checks:['normal UI/native choices/IPC','native DPAPI identity + friends + offline queue','same profile on restart','second migration','cancel selection','cancel selected destination','localStorage and profile preserved by cache clear','chosen downloads persisted separately','RU/EN settings search and layout at 1440 and 800x600'],limitations:['copy happens before main window opens; no animated copy progress'],errors},null,2));
  console.log('PASS storage desktop migration, DPAPI, queue, preferences, cache, downloads, RU/EN');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  for(const app of apps)await app.close().catch(()=>{});
  assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(temp).startsWith('link-storage-ui-'));
  try{fs.rmSync(temp,{recursive:true,force:true});}catch(e){console.error('Owned test fixture cleanup:',e.code);}
});
