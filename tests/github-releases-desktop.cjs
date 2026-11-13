'use strict';
const {testRuntime}=require('./electron-runtime.cjs');
// Run the real app on a disposable profile. Release HTTP, Windows balloon and
// native confirmation use fixtures; no installer or system notification runs.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{createHash}=require('node:crypto');
const {once}=require('node:events');
const root=path.resolve(__dirname,'..'),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function runDesktop(){
  const {app,dialog,Notification,Tray}=require('electron');
  const {home,latestURL}=require('../src/github-releases.cjs'),version='99.1.0';
  const prefix=home+'/releases/download/v'+version+'/CRAFTCODE-LINK-'+version,installer=prefix+'-Setup-x64.exe',sumsURL=prefix+'-SHA256SUMS.txt';
  const data=Buffer.alloc(48*1024,0x24);data.write('MZ');
  const digest=createHash('sha256').update(data).digest('hex');
  const calls=[],balloons=[],ranges=[];let confirmations=0,visibleRequests=0,errorResponse=false,damaged=false,disconnect=false,fixtureTray;
  const lang=process.env.LINK_QA_LANG==='en'?'en':'ru';
  const en=require('../src/renderer/l10n/en.json');
  const label=ru=>lang==='ru'?ru:en[ru];
  const testRoot=process.env.LINK_RELEASE_FIXTURE;
  assert.ok(testRoot&&path.dirname(testRoot)===os.tmpdir());app.setPath('appData',testRoot);
  app.getVersion=()=>require('../package.json').version;
  Notification.isSupported=()=>false;dialog.showErrorBox=(_title,err)=>console.error(err);
  Tray.prototype.displayBalloon=function(options){fixtureTray=this;balloons.push(options);};
  dialog.showMessageBox=async()=>{confirmations++;return {response:0};};
  const release=require('../src/release-update.cjs'),register=release.registerUpdates;
  release.registerUpdates=options=>register({...options,
    app:{getVersion:app.getVersion,getPath:app.getPath.bind(app),quit:()=>assert.fail('Unexpected quit for update'),isPackaged:true},
    launcher:()=>assert.fail('Unexpected OS launch'),fetcher:(url,{signal,method,headers})=>{
      calls.push([method,url]);
      if(url===latestURL){
        if(errorResponse)return new Response(null,{status:429,headers:{'Retry-After':'1'}});
        return Response.redirect(home+'/releases/tag/v'+version,302);
      }
      if(url===sumsURL)return new Response(digest+'  CRAFTCODE-LINK-'+version+'-Setup-x64.exe');
      assert.equal(url,installer);
      if(method==='HEAD')return new Response(null,{headers:{'Content-Length':String(data.length)}});
      const range=new Headers(headers).get('Range'),half=data.length/2;
      ranges.push(range);if(range!==null)assert.equal(range,'bytes='+half+'-');
      const reply=range===null?{status:200,headers:{'Content-Length':String(data.length)}}:
        {status:206,headers:{'Content-Range':'bytes '+half+'-'+(data.length-1)+'/'+data.length,'Content-Length':String(half)}};
      return new Response(new ReadableStream({start(controller){
        const first=range===null?setTimeout(()=>controller.enqueue(data.subarray(0,half)),300):null;
        function aborted(){clearTimeout(first);clearTimeout(last);controller.error(signal.reason);}
        const last=setTimeout(()=>{
          signal.removeEventListener('abort',aborted);
          if(disconnect){disconnect=false;controller.error(new TypeError('network socket closed'));return;}
          controller.enqueue(damaged?Buffer.alloc(half):data.subarray(half));controller.close();
        },1200);
        signal.addEventListener('abort',aborted,{once:true});
      }}),reply);
    }});
  async function exercise(win){
    const js=code=>win.webContents.executeJavaScript(code);
    async function until(code,timeout=8000){
      const start=Date.now();while(Date.now()-start<timeout){if(await js(code))return;await pause(90);}throw Error('Timed out: '+code);
    }
    await until('!document.querySelector("#githubUpdates")?.hidden && !!document.querySelector("#githubCheck")?.onclick');
    if(lang==='en'){
      const reloaded=once(win.webContents,'did-finish-load');
      await js('const select=document.getElementById("introLanguage");select.value="en";select.dispatchEvent(new Event("change"))');
      await reloaded;await until('document.documentElement.lang==="en" && !!document.querySelector("#githubCheck")?.onclick');
    }
    const initialShows=visibleRequests;
    assert.equal(calls.length,0);assert.ok(await js('!document.querySelector("#releaseRail").checkVisibility()'));assert.ok(await js('!document.querySelector("#coffeeSupport").hidden'));
    // With the real UI hidden in the tray, wait through the actual initial
    // scheduler delay. No window, native dialog, download or installer starts.
    await until('document.querySelector("#githubDownload").hidden===false',35000);
    assert.equal(win.isVisible(),false);assert.equal(visibleRequests,initialShows);assert.equal(confirmations,0);
    assert.deepEqual(calls,[['HEAD',latestURL],['GET',sumsURL],['HEAD',installer]]);assert.equal(await js('document.querySelector("#networkDialog").open'),false);
    assert.equal(balloons.length,1);assert.match(balloons[0].content,/99\.1\.0/);
    assert.ok(balloons[0].noSound&&balloons[0].respectQuietTime);
    await js('document.querySelector("#closeInternet").click()');
    assert.ok(fixtureTray.emit('balloon-click'),'notification click listener');
    assert.ok(visibleRequests>initialShows,'notification click reveals the window');
    await until('document.querySelector("#updatesDialog").open && !document.querySelector("#networkDialog").open');
    await js('document.querySelector("#closeUpdatesDialog").click()');
    assert.ok(await js('document.querySelector("#releaseRail").checkVisibility() && document.querySelector("#releaseRail").getBoundingClientRect().bottom <= document.querySelector("#networkHelpBtn").getBoundingClientRect().top'));
    await js('document.querySelector("#releaseRail").click()');
    await until('document.querySelector("#updatesDialog").open');
    await js('document.querySelector("#releaseAutomatic").click()');
    await until('(async()=>!(await window.craftlink.releases({op:"state"})).automatic)()');
    errorResponse=true;await js('document.querySelector("#githubCheck").click()');
    await until('document.querySelector("#githubReleaseStatus").textContent.includes('+JSON.stringify(label('GitHub ограничил запросы. Повтор будет доступен после'))+') && document.querySelector("#githubCheck").disabled');
    await js('window.craftlink.direct({op:"policy",strict:true})');await until('document.querySelector("#githubCheck").disabled');
    const count=calls.length;await js('document.querySelector("#githubCheck").click()');assert.equal(calls.length,count);
    errorResponse=false;await js('window.craftlink.direct({op:"policy",strict:false})');await until('!document.querySelector("#githubCheck").disabled');
    await js('document.querySelector("#githubCheck").click()');await until('!document.querySelector("#githubDownload").hidden');
    await js('document.querySelector("#githubDownload").click()');
    await until('document.querySelector("#githubProgress progress")?.value===24576');
    assert.equal(await js('document.querySelector("#githubProgress progress").max'),49152);
    const progress=()=>js('document.querySelector("#githubProgress").textContent');
    const hasRate=lang==='en'?/\/s/:/\/с/;
    assert.match(await progress(),/50%.*24.*48/);assert.match(await progress(),hasRate);
    await js('document.querySelector("#githubCancel").click()');await until('!document.querySelector("#githubDownload").hidden');
    assert.equal(await js('getComputedStyle(document.querySelector("#githubProgress")).display'),'none');
    damaged=true;await js('document.querySelector("#githubDownload").click()');
    await until('document.querySelector("#githubDownload").textContent==='+JSON.stringify(label('Повторить загрузку'))+' && !document.querySelector("#githubDownload").hidden');
    assert.equal(await js('document.querySelector("#githubInstall").hidden'),true);
    assert.equal(await js('document.querySelector("#githubReleaseStatus").textContent'),label('Установщик выпуска не прошёл проверку.'));
    damaged=false;
    const click=id=>js('document.getElementById('+JSON.stringify(id)+').click()');
    async function interrupt(){
      disconnect=true;
      await click('githubDownload');
      await until('document.querySelector("#githubDownload").textContent==='+JSON.stringify(label('Продолжить сейчас'))+' && !document.querySelector("#githubDownload").hidden');
      assert.equal(await js('document.querySelector("#githubProgress progress").value'),24576);
      assert.doesNotMatch(await progress(),hasRate);
      assert.match(await js('document.querySelector("#githubReleaseStatus").textContent'),lang==='ru'?/попытка в \d/:/attempt at \d/i);
    }
    await interrupt();
    // A manual retry preserves the prefix too. Cancel the resumed transfer
    // before the final block to exercise cancellation for a byte-range request.
    await click('githubDownload');
    await until('document.querySelector("#githubReleaseStatus").textContent==='+JSON.stringify(label('Продолжаем загрузку обновления…')));
    assert.equal(ranges.at(-1),'bytes=24576-');
    await click('githubCancel');await until('document.querySelector("#githubProgress").hidden');
    await interrupt();
    // Explicitly cancelling a waiting transfer removes its bytes. The next
    // request therefore starts at zero. An actual disconnect keeps those bytes.
    await click('githubCancel');await until('document.querySelector("#githubProgress").hidden');
    await interrupt();assert.equal(ranges.at(-1),null);
    await js('window.craftlink.direct({op:"policy",strict:true})');
    await until('document.querySelector("#githubDownload").disabled && !document.querySelector("#githubCancel").hidden');
    assert.equal(await js('document.querySelector("#githubProgress progress").value'),24576);
    assert.match(await js('document.querySelector("#githubReleaseStatus").textContent'),lang==='ru'?/Только через ретранслятор/:/Relay-only/);
    await js('window.craftlink.direct({op:"policy",strict:false})');
    await until('document.querySelector("#githubReleaseStatus").textContent==='+JSON.stringify(label('Продолжаем загрузку обновления…')),18000);
    await until('!document.querySelector("#githubInstall").hidden');
    assert.equal(ranges.at(-1),'bytes=24576-');
    assert.match(await js('document.querySelector("#githubReleaseStatus").textContent'),/SHA-256/);assert.equal(balloons.length,1);
    assert.deepEqual(calls.at(-1),['GET',installer]);assert.equal(confirmations,0);
    await js('document.querySelector("#githubInstall").click()');await pause(150);assert.equal(confirmations,1);assert.equal(await js('document.querySelector("#releaseRail").dataset.phase'),'ready');
    assert.equal(await js('document.querySelector("#githubInstall").hidden'),false);
    console.log('PASS '+lang+' Electron release UI: background notice, byte progress and speed, waiting after disconnect, cancel and discard, pause under strict mode, automatic byte-range resume and verified installer confirmation.');
  }
  app.on('browser-window-created',(_,win)=>{
    win.show=()=>{visibleRequests++;};win.showInactive=()=>{visibleRequests++;};win.focus=()=>{};win.hide();
    win.webContents.once('did-finish-load',()=>exercise(win).then(()=>app.quit()).catch(err=>{console.error(err);app.exit(1);}));
  });
  require('../src/entry.cjs');
}
async function run(){
  if(process.versions.electron)return runDesktop();
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'link-update-desktop-'));
  try{
    const env={...process.env,LINK_RELEASE_FIXTURE:temp};delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(testRuntime(),[__filename,'--craftlink-profile=updates-test'],{env,windowsHide:true,stdio:'inherit'});
    const timer=setTimeout(()=>child.kill(),90000);
    try{const code=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});assert.equal(code,0);}
    finally{clearTimeout(timer);}
  }finally{await fs.rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
}
run().catch(err=>{console.error(err);process.exitCode=1;});
