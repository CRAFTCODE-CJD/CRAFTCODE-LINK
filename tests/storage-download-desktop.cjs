'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
module.exports=async({a,b})=>{
  const selected=path.join(b.base,'Chosen downloads');await fs.mkdir(selected);
  await b.app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},selected);
  await b.page.click('#settingsBtn');await b.page.click('[data-pane="storage"]');
  await b.page.waitForFunction(()=>document.querySelector('#pref-storage').getAttribute('aria-busy')==='false');
  await b.page.click('#downloadsChoose');await b.page.waitForFunction(folder=>document.querySelector('#downloadsPath').textContent===folder,selected);
  await b.page.click('#closeSettingsDialog');await b.page.click('#navChats');await b.page.locator('#dmList button').click();
  await b.page.waitForFunction(()=>!document.querySelector('#dmInput').disabled);
  const original=crypto.randomBytes(64*1024+19),filename=path.join(a.base,'Selected storage fixture.bin');await fs.writeFile(filename,original);
  await a.app.evaluate(({dialog},filename)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filename]});},filename);
  await a.page.click('#dmAttach summary');await a.page.click('#dmFile');
  const row=b.page.locator('#dmLog article').last();await row.locator('.link-chat-body').filter({hasText:'Selected storage fixture.bin'}).waitFor();
  await row.locator('[data-action=download]').click();await row.locator('[data-action=reveal]').waitFor();
  const entries=await fs.readdir(selected,{recursive:true,withFileTypes:true}),saved=entries.filter(e=>e.isFile()).map(e=>path.join(e.parentPath,e.name));
  assert.equal(saved.length,1);assert.deepEqual(await fs.readFile(saved[0]),original);
  assert.equal((await fs.readdir(path.join(b.base,'Downloads'))).length,0);
  // Change the root again, then clear using the original download receipt.
  const second=path.join(b.base,'Next downloads');await fs.mkdir(second);
  await b.app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},second);
  await b.page.click('#settingsBtn');await b.page.click('[data-pane="storage"]');await b.page.click('#downloadsChoose');
  await b.page.waitForFunction(folder=>document.querySelector('#downloadsPath').textContent===folder,second);await b.page.click('#closeSettingsDialog');
  const cleared=await b.page.evaluate(async()=>{
    const state=await window.craftlink.direct({op:'state'}),f=state.friends[0];
    return window.craftlink.direct({op:'chat-clear',id:f.id,profileId:state.me.id,deleteDownloads:true});
  });
  assert(!await fs.stat(saved[0]).then(()=>true,()=>false),'known download in previous selected root removed');
  const result={result:'PASS',bytes:original.length,sha256:crypto.createHash('sha256').update(original).digest('hex'),checks:['two real clients on isolated loopback DHT','native Settings downloads folder choice','DM transfer received and checksum matched in selected path','old default Downloads unchanged','new choice retains approved previous root for clear-history files']};
  await fs.writeFile(path.resolve('out/qa/0714-storage-download-desktop.json'),JSON.stringify(result,null,2));
  console.log('PASS selected storage DM download and previous-root cleanup',JSON.stringify(cleared));
};
