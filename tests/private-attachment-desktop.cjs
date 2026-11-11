'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
module.exports=async({a,b})=>{
  const evidence={files:[],recordings:[],stubs:['hidden test windows','temporary Downloads per profile','native picker and camera confirmation','fake microphone and camera','loopback DHT','private clipboard and notifications','delayed source blocks for the Cancel focus check']};
  const output=process.env.LINK_VISUAL_DIR;
  if(output)await fs.mkdir(output,{recursive:true});
  async function capture(name){
    if(!output)return;
    await b.page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const png=await b.app.evaluate(async({BrowserWindow})=>{
      const window=BrowserWindow.getAllWindows()[0];
      const result=await Promise.race([window.capturePage(undefined,{stayHidden:true}),new Promise(r=>setTimeout(()=>r(null),1200))]);
      return result && !result.isEmpty()?result.toPNG().toString('base64'):null;
    });
    if(png)await fs.writeFile(path.join(output,name),Buffer.from(png,'base64'));
  }
  await b.page.click('#navChats');await b.page.locator('#dmList button').click();
  await b.page.waitForFunction(()=>!document.querySelector('#dmInput').disabled);
  const downloads=await b.app.evaluate(({app})=>app.getPath('downloads'));assert.equal(downloads,path.join(b.base,'Downloads'));
  await a.app.evaluate(({BrowserWindow,dialog})=>{
    dialog.showOpenDialog=async()=>({canceled:!globalThis.testPicked,filePaths:globalThis.testPicked?[globalThis.testPicked]:[]});
    const win=BrowserWindow.getAllWindows()[0];
    // The native production check requires a visible foreground window before prompting.
    // The test simulates this one observation; show/showInactive/focus stay suppressed.
    win.isVisible=()=>true;
    globalThis.cameraPrompts=0;
    dialog.showMessageBox=async(_win,opts)=>{
      if(opts.message==='Включить камеру и микрофон для записи?'){globalThis.cameraPrompts++;return {response:globalThis.cameraChoice||0};}
      throw Error('Unexpected native dialog');
    };
  });
  const last=b.page.locator('#dmLog article').last();
  async function attach(id){
    await a.page.click('#dmAttach summary');await a.page.click('#'+id);
  }
  async function choose(name,bytes){
    const file=path.join(a.base,name);await fs.writeFile(file,bytes);await a.app.evaluate((_,f)=>{globalThis.testPicked=f;},file);
    await attach('dmFile');await last.locator('.link-chat-body').filter({hasText:name}).waitFor();
  }
  const downloaded=()=>fs.readdir(downloads,{recursive:true,withFileTypes:true}).then(rows=>rows.filter(r=>r.isFile()).map(r=>path.join(r.parentPath,r.name)));
  const doc=crypto.randomBytes(2*1024**2+31),name='Общий документ '+'с длинным именем '.repeat(4)+'к матчу.bin';
  await choose(name,doc);assert.deepEqual(await downloaded(),[]);
  await a.app.evaluate(()=>{globalThis.testFileBlockDelay=180;});
  const save=last.locator('[data-action=download]');await save.click();
  const cancel=last.locator('[data-action=cancel]');await cancel.focus();
  const cancelNode=await cancel.elementHandle();
  await b.page.waitForTimeout(750);
  assert(await cancelNode.evaluate(node=>node.isConnected&&document.activeElement===node&&!node.disabled),'Cancel retains keyboard focus while progress updates');
  await cancel.press('Enter');await cancelNode.dispose();
  await save.waitFor();assert.deepEqual(await downloaded(),[]);
  await a.app.evaluate(()=>{globalThis.testFileBlockDelay=0;});
  await save.click();
  try{await last.locator('[data-action=reveal]').waitFor({timeout:45000});}
  catch(e){throw new Error('File download did not finish: '+await last.innerText()+' '+JSON.stringify(await downloaded()),{cause:e});}
  let saved=(await downloaded()).find(f=>path.basename(f)===name);
  assert.equal(digest(await fs.readFile(saved)),digest(doc));evidence.files.push({type:'document',bytes:doc.length,sha256:digest(doc),cancelledAndRetried:true});
  const png=await a.page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=80;canvas.height=48;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#4a4b97';ctx.fillRect(0,0,80,48);return canvas.toDataURL().split(',')[1];
  });
  const photo=Buffer.from(png,'base64');
  await choose('Photo.png',photo);assert.equal((await downloaded()).length,1);
  await save.click();await last.locator('[data-action=preview]').click();
  const dims=await last.locator('.chat-media-preview img').evaluate(async img=>{await img.decode();return [img.naturalWidth,img.naturalHeight];});
  assert.deepEqual(dims,[80,48]);await capture('dm-photo.png');await last.locator('[data-action=preview]').click();
  await last.locator('button.preview-photo canvas').waitFor();
  await last.press('Shift+F10');
  await b.page.getByRole('menuitem',{name:'Показать в папке'}).waitFor();
  await b.page.keyboard.press('Escape');
  saved=(await downloaded()).find(f=>path.basename(f)==='Photo.png');assert.equal(digest(await fs.readFile(saved)),digest(photo));
  evidence.files.push({type:'photo',bytes:photo.length,sha256:digest(photo),dimensions:dims});
  await attach('dmCircle');await a.page.waitForFunction(()=>!document.querySelector('#clipDialog').open);
  assert.equal(await a.app.evaluate(()=>globalThis.cameraPrompts),1);
  await a.app.evaluate(()=>{globalThis.cameraChoice=1;});
  for(const [id,tag] of [['dmVoice','audio'],['dmCircle','video']]){
    const before=await b.page.locator('#dmLog article').count();
    if(id==='dmCircle')await a.page.press('#dmRecordMode','Enter');
    await a.page.evaluate(()=>{
      const devices=navigator.mediaDevices, capture=devices.getUserMedia;
      devices.getUserMedia=function(){
        devices.getUserMedia=capture;
        return Promise.reject(new DOMException('Permission denied by system','NotAllowedError'));
      };
    });
    await a.page.press('#dmRecord','Enter');
    const recovery=a.page.locator('#clipDisplay');
    await recovery.getByRole('button',{name:'Повторить запись'}).waitFor();
    assert.equal(await a.page.locator('#clipStop').isVisible(),false);
    assert.equal(await a.page.locator('#clipSend').isVisible(),false);
    assert.match(await a.page.locator('#clipStatus').innerText(),/доступ/);
    await recovery.getByRole('button',{name:'Повторить запись'}).click();
    await a.page.locator('#clipStop').waitFor();
    assert.match(await a.page.locator('#clipStatus').innerText(),tag==='audio'?/\/ 10:00$/:/\/ 1:00$/);
    await a.page.waitForTimeout(1300);await a.page.click('#clipStop');await a.page.locator('#clipSend').waitFor();
    await a.page.click('#clipSend');
    await b.page.waitForFunction(n=>document.querySelectorAll('#dmLog article').length===n+1,before);
    const expected=await a.page.evaluate(async()=>{
      const state=await window.craftlink.direct({op:'state'}),scope={id:state.friends[0].id,profileId:state.me.id};
      const history=await window.craftlink.direct({op:'chat-history',...scope}),message=history.messages.at(-1);
      const source=await window.craftlink.direct({op:'chat-attachment',action:'preview',messageId:message.id,...scope});
      return {size:source.bytes.byteLength,sha:[...new Uint8Array(await crypto.subtle.digest('SHA-256',source.bytes))].map(v=>v.toString(16).padStart(2,'0')).join('')};
    });
    assert(expected.size>256);
    assert.equal(await last.locator('[data-action=preview]').count(),0);
    await save.click();await last.locator('.clip-unplayed').waitFor();
    await last.locator('[data-action=preview]').click();
    const card=b.page.locator('#dmLog article[data-id="'+await last.getAttribute('data-id')+'"]');
    const player=card.locator('.chat-media-preview '+tag);
    await player.evaluate(async e=>{e.muted=true;await e.play();});
    await b.page.waitForFunction(type=>{
      const e=document.querySelector('#dmLog .chat-media-preview '+type);
      return e?.currentTime>0 && (type==='audio' || e.getVideoPlaybackQuality().totalVideoFrames>0);
    },tag);
    const result=await player.evaluate(e=>({time:e.currentTime,frames:e.getVideoPlaybackQuality?.().totalVideoFrames}));
    await b.page.waitForFunction(async id=>{
      const state=await window.craftlink.direct({op:'state'});
      const history=await window.craftlink.direct({op:'chat-history',profileId:state.me.id,id:state.friends[0].id});
      return history.messages.find(m=>m.id===id)?.attachment?.played===true;
    },await card.getAttribute('data-id'));
    assert.equal(await card.locator('.clip-unplayed').count(),0);
    const widget=card.locator(tag==='video'?'.clip-round':'.clip-voice');
    assert.equal(await player.evaluate(e=>e.controls),false);
    await widget.locator('.clip-speed').click();
    assert.equal(await player.evaluate(e=>e.playbackRate),1.5);
    await player.evaluate(e=>e.pause());
    if(tag==='video'){
      const bounds=await widget.boundingBox();assert(Math.abs(bounds.width-bounds.height)<2&&bounds.width>=140);
      assert.equal(await widget.evaluate(e=>getComputedStyle(e).borderRadius),'50%');
      await widget.locator('.clip-rim').press('End');await widget.locator('.clip-rim').press('ArrowLeft');
    }else{
      await widget.locator('.voice-track.has-wave .voice-wave').waitFor();
      await widget.locator('.clip-seek:enabled').press('End');
      await widget.locator('.clip-seek').press('Home');
      assert(await player.evaluate(e=>e.currentTime<.2));
    }
    await capture(tag==='video'?'dm-circle.png':'dm-wave.png');
    const file=(await downloaded()).find(f=>f.endsWith(tag==='audio'?'.weba':'.webm'));
    assert.equal(digest(await fs.readFile(file)),expected.sha);
    evidence.recordings.push({type:tag,bytes:expected.size,sha256:expected.sha,playedSeconds:result.time,decodedFrames:result.frames});
    const node=await player.elementHandle(),message='Проверка проигрывателя · '+tag;
    await a.page.fill('#dmInput',message);await a.page.press('#dmInput','Enter');
    await b.page.locator('#dmLog').getByText(message,{exact:true}).waitFor();
    assert(await node.evaluate(el=>el.isConnected));
    await card.locator('[data-action=preview]').click();assert(await node.evaluate(el=>!el.isConnected));await node.dispose();
  }
  assert.equal(await a.app.evaluate(()=>globalThis.cameraPrompts),3);
  const flag='🇰🇿';
  await a.page.fill('#dmInput',flag);await a.page.press('#dmInput','Enter');
  const emoji=last.locator('.chat-emoji-glyph').filter({hasText:flag});await emoji.waitFor();
  assert.equal(await emoji.evaluate(n=>getComputedStyle(n.closest('article')).backgroundColor),'rgba(0, 0, 0, 0)');
  assert(await emoji.evaluate(async n=>{await document.fonts.ready;return document.fonts.check('30px "LINK Emoji"',n.textContent);}));
  await emoji.scrollIntoViewIfNeeded();
  await capture('dm-media-normal.png');
  await b.page.setViewportSize({width:740,height:560});
  await emoji.scrollIntoViewIfNeeded();
  assert(await b.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await capture('dm-media-narrow.png');
  await b.page.setViewportSize({width:1440,height:900});
  await a.page.setViewportSize({width:740,height:560});assert(await a.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await choose('Withdraw.txt',Buffer.from('withdraw'));await a.page.locator('#dmLog article').last().locator('[data-action=withdraw]').click();
  await last.getByText('Доступ отозван',{exact:false}).waitFor();assert.equal(await last.locator('[data-action=download]').count(),0);
  if(output){
    await capture('dm-attachments.png');
    await fs.writeFile(path.join(output,'dm-attachments.json'),JSON.stringify(evidence,null,2));
  }
  const copies=await downloaded();
  assert(copies.length>=4);
  const clear=async all=>{
    await b.page.click(all?'#dmStorage summary':'#dmActions summary');
    await b.page.click(all?'#dmClearAll':'#dmClear');
    const checkbox=b.page.locator('#dmClearDownloads');
    assert.equal(await checkbox.isChecked(),false);
    return checkbox;
  };
  let checkbox=await clear(false);
  await checkbox.check();await b.page.click('#confirmNoBtn');
  assert.deepEqual(await downloaded(),copies);
  await clear(false);await b.page.click('#confirmYesBtn');
  await b.page.waitForFunction(()=>!document.querySelector('#dmLog').childElementCount);
  assert.deepEqual(await downloaded(),copies);
  checkbox=await clear(true);await checkbox.check();await b.page.click('#confirmYesBtn');
  await b.page.waitForFunction(()=>document.querySelector('#dmClearAll').disabled && document.querySelector('#dmStorage').getAttribute('aria-busy')!=='true');
  assert.equal(await b.page.evaluate(async()=>(await window.craftlink.direct({op:'state'})).chatStorage.downloads),false);
  assert.deepEqual(await downloaded(),[]);assert.deepEqual(await fs.readFile(path.join(a.base,name)),doc);
  console.log('PASS local download cleanup: cancellation, text-only clear, checked clear-all, originals preserved.');
  console.log('PASS private attachments in two isolated Electron profiles',JSON.stringify(evidence));
};
