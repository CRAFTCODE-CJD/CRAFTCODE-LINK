'use strict';
const {testRuntime}=require('./electron-runtime.cjs');
// Launch the real app with a disposable profile and substitute only release
// HTTP and the native confirmation. The fixture has no executable installer.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function runDesktop(){
  const {app,dialog,Notification}=require('electron');
  const {api,home,latestURL}=require('../src/github-releases.cjs'),version='99.1.0',name='CRAFTCODE-LINK-'+version+'-Setup-x64.exe';
  const data=Buffer.from('MZsynthetic QA fixture'),digest=createHash('sha256').update(data).digest('hex');
  const calls=[];let confirmations=0,visibleRequests=0,errorResponse=false;
  const testRoot=process.env.LINK_RELEASE_FIXTURE;
  assert.ok(testRoot&&path.dirname(testRoot)===os.tmpdir());app.setPath('appData',testRoot);
  app.getVersion=()=>require('../package.json').version;
  Notification.isSupported=()=>false;dialog.showErrorBox=(_title,err)=>console.error(err);
  dialog.showMessageBox=async()=>{confirmations++;return {response:0};};
  const release=require('../src/release-update.cjs'),register=release.registerUpdates;
  release.registerUpdates=options=>register({...options,
    app:{getVersion:app.getVersion,getPath:app.getPath.bind(app),quit:()=>assert.fail('Unexpected quit for update'),isPackaged:true},
    launcher:()=>assert.fail('Unexpected OS launch'),fetcher:(url)=>{
      calls.push(url);
      if(url===latestURL){
        if(errorResponse)return new Response(null,{status:403,headers:{'x-ratelimit-remaining':'0'}});
        return Response.json({draft:false,prerelease:false,tag_name:'v'+version,html_url:home+'/releases/tag/v'+version,assets:[{
          name,id:82,state:'uploaded',size:data.length,digest:'sha256:'+digest,url:api+'/releases/assets/82',
          browser_download_url:home+'/releases/download/v'+version+'/'+name}]});
      }
      assert.equal(url,api+'/releases/assets/82');return new Response(data);
    }});
  async function exercise(win){
    const js=code=>win.webContents.executeJavaScript(code);
    async function until(code,timeout=8000){
      const start=Date.now();while(Date.now()-start<timeout){if(await js(code))return;await pause(90);}throw Error('Timed out: '+code);
    }
    await until('!document.querySelector("#githubUpdates")?.hidden && !!document.querySelector("#githubCheck")?.onclick');
    const initialShows=visibleRequests;
    assert.equal(calls.length,0);assert.ok(await js('!document.querySelector("#coffeeSupport").hidden'));
    // With the real UI hidden in the tray, wait through the actual initial
    // scheduler delay. No window, native dialog, download or installer starts.
    await until('document.querySelector("#githubDownload").hidden===false',35000);
    assert.equal(win.isVisible(),false);assert.equal(visibleRequests,initialShows);assert.equal(confirmations,0);
    assert.deepEqual(calls,[latestURL]);assert.equal(await js('document.querySelector("#networkDialog").open'),false);
    await js('document.querySelector("#closeInternet").click();document.querySelector("#networkHelpBtn").click()');
    await until('document.querySelector("#networkDialog").open && document.querySelector("#updatePanel").open');
    await js('document.querySelector("#releaseAutomatic").click()');
    await until('(async()=>!(await window.craftlink.releases({op:"state"})).automatic)()');
    errorResponse=true;await js('document.querySelector("#githubCheck").click()');await until('document.querySelector("#githubReleaseStatus").textContent.includes("частоту")');
    await js('window.craftlink.direct({op:"policy",strict:true})');await until('document.querySelector("#githubCheck").disabled');
    const count=calls.length;await js('document.querySelector("#githubCheck").click()');assert.equal(calls.length,count);
    errorResponse=false;await js('window.craftlink.direct({op:"policy",strict:false})');await until('!document.querySelector("#githubCheck").disabled');
    await js('document.querySelector("#githubCheck").click()');await until('!document.querySelector("#githubDownload").hidden');
    await js('document.querySelector("#githubDownload").click()');await until('!document.querySelector("#githubInstall").hidden');
    assert.equal(calls.at(-1),api+'/releases/assets/82');assert.equal(confirmations,0);
    await js('document.querySelector("#githubInstall").click()');await pause(150);assert.equal(confirmations,1);
    assert.equal(await js('document.querySelector("#githubInstall").hidden'),false);
    console.log('PASS Electron release UI, actual daily timer in tray, no focus/notification/automatic download, strict and manual checks, 403, cache verification, native cancel, hidden support.');
  }
  app.on('browser-window-created',(_,win)=>{
    win.show=()=>{visibleRequests++;};win.showInactive=()=>{visibleRequests++;};win.hide();
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
    const timer=setTimeout(()=>child.kill(),65000);
    try{const code=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});assert.equal(code,0);}
    finally{clearTimeout(timer);}
  }finally{await fs.rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
}
run().catch(err=>{console.error(err);process.exitCode=1;});
