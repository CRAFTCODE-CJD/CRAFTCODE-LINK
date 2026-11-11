const {clickPath}=require('./qa-navigation.cjs');
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { _electron } = require(require.resolve('playwright', {paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || __dirname]}));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(),'link-footprint-'));
const root = path.resolve(__dirname,'..');
let app;
function inventory(dir) {
  const files = [];
  function visit(folder) {
    for (const entry of fs.readdirSync(folder,{withFileTypes:true})) {
      const file = path.join(folder,entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  visit(dir);
  return {files, bytes:files.reduce((total,file)=>total+fs.statSync(file).size,0)};
}
(async()=>{
  const probe=net.createServer();
  await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  let directory;
  const invites=[];
  for(const count of [0,1,5,5]){
    app=await _electron.launch({executablePath:require('electron'),args:['--headless','--ozone-platform=headless','--no-sandbox',root,'--craftlink-profile=disk'],
      env:{...process.env,XDG_CONFIG_HOME:scratch}});
    directory=await app.evaluate(({app})=>app.getPath('userData'));
    assert(directory.startsWith(scratch+path.sep));
    const page=await app.firstWindow();
    await page.waitForSelector('#createBtn',{state:'attached'});
    if(await page.locator('#internetDialog').isVisible()) await page.click('#entryLater');
    for(let i=0;i<count;i++){
      await clickPath(page,'#createBtn');await page.click('#hubManual');
      await page.fill('#nameInput','Контроль');await page.fill('#addressInput','127.0.0.1');await page.fill('#portInput',String(port));await page.click('#roomSubmitBtn');
      await page.waitForSelector('#inviteDoneBtn');invites.push(await page.inputValue('#inviteOutput'));await page.click('#inviteDoneBtn');
      await clickPath(page,'#networkHelpBtn');await page.click('#closeNetworkDialog');await page.click('#leaveBtn');await page.waitForSelector('#createBtn');
    }
    await app.close();app=null;
    const {files,bytes}=inventory(directory);
    for(const file of files){
      const data=fs.readFileSync(file);
      for(const invite of invites)assert(!data.includes(invite)&&!data.includes(Buffer.from(invite,'utf16le')),'room code persisted: '+path.relative(directory,file));
    }
    assert(!fs.existsSync(path.join(directory,'reports')));
    assert(!files.some(file=>/\.(?:webm|mp4|wav|mkv)$/i.test(file)));
    console.log('PASS',JSON.stringify({rooms:invites.length,files:files.length,bytes}));
  }
  assert.equal(new Set(invites).size,11);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(app)await app.close().catch(()=>{});
  fs.rmSync(scratch,{recursive:true,force:true});
});
