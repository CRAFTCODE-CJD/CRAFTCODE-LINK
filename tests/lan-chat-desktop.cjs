'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const dictionary=require('../src/renderer/l10n/en.json');
const {dropFile}=require('./chat-drop-desktop.cjs');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

module.exports=async({a,b})=>{
  const evidence={scope:'two isolated Electron clients, one LAN session, gaming adapter remains off',files:[],recordings:[]};
  const output=process.env.LINK_VISUAL_DIR;
  if(output)await fs.mkdir(output,{recursive:true});
  const state=client=>client.page.evaluate(()=>window.craftlink.direct({op:'state'}));
  const rows=client=>client.page.locator('#gameHistory article');
  async function screenshot(name){
    if(!output)return;
    await b.page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const data=await b.app.evaluate(async({BrowserWindow})=>{
      const frame=await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true});
      return frame.toPNG().toString('base64');
    });
    await fs.writeFile(path.join(output,name+'.png'),Buffer.from(data,'base64'));
  }
  for(const client of [a,b]){
    await client.app.evaluate(({dialog,BrowserWindow})=>{
      const win=BrowserWindow.getAllWindows()[0];win.isVisible=win.isFocused=()=>true;
      dialog.showOpenDialog=async()=>({canceled:!globalThis.lanPicked,filePaths:globalThis.lanPicked?[globalThis.lanPicked]:[]});
      globalThis.lanCameraPrompts=0;globalThis.lanCameraChoice=0;
      dialog.showMessageBox=async(_,options)=>{
        if(options.message==='Включить камеру и микрофон для записи?'||options.message==='Turn on the camera and microphone to record a message?'){
          globalThis.lanCameraPrompts++;return {response:globalThis.lanCameraChoice};
        }
        throw Error('Unexpected LAN native prompt: '+options.message);
      };
    });
    await client.page.click('#navGame');
  }
  await a.page.fill('#gameTitle','Вечерний матч');await a.page.click('#gameCreate button');
  await a.page.click('#gameSendInvite');
  await b.page.locator('#gameInvites').getByRole('button',{name:'Принять',exact:true}).click();
  for(const client of [a,b]){
    await client.page.waitForFunction(()=>document.querySelector('#gameCount').textContent==='2'&&!document.querySelector('#gameFile').disabled);
    assert(!['ready','starting'].includes((await state(client)).game.network.phase));
  }
  const room=(await state(a)).game.room.id;
  // Substitute the denied system prompt only; use the real activation button and diagnostics.
  await a.app.evaluate((_,entry)=>{
    const load=process.getBuiltinModule('node:module').createRequire(entry);
    const {GameNetwork}=load('./src/game/network.cjs'),start=GameNetwork.prototype.start;
    GameNetwork.prototype.start=function(...args){
      this.open=async()=>{throw Object.assign(Error('Windows запретила запуск сетевого помощника LINK.'),{code:'access-denied'});};
      return start.apply(this,args);
    };
  },path.resolve(process.env.LINK_QA_APP_ROOT||path.join(__dirname,'..'),'package.json'));
  await a.page.click('#gameActivate');
  await a.page.locator('#gameFailure').waitFor();
  await a.page.click('#gameNetworkTab');
  assert(await a.page.locator('#gameFailure').isHidden());
  await a.page.locator('#gameCopyDiag').focus();await a.page.keyboard.press('Enter');
  await a.page.waitForFunction(()=>document.querySelector('#gameDiagStatus').textContent==='Скопировано');
  const report=await a.app.evaluate(()=>globalThis.testClipboard);
  assert.match(report,/Включение адаптера · access-denied/);
  assert.ok(report.startsWith('CRAFTCODE LINK · LAN · '+require('../package.json').version+' · '));
  assert.match(report,/Матч Generals \/ Zero Hour · UDP 8088 · TX 0 \/ RX 0/);
  assert.match(report,/Участник 10\.\d+\.\d+\.2 \/ off/);
  await a.page.click('#gameChatTab');
  await b.page.evaluate(()=>localStorage.setItem('craftcode.language','en'));await b.page.reload();
  await b.page.click('#navGame');await b.page.waitForFunction(()=>!document.querySelector('#gameFile').disabled);
  assert.equal(await b.page.getAttribute('html','lang'),'en');
  assert.equal(await b.page.locator('#gameNetworkTab').innerText(),'Connection');
  await b.page.click('#settingsBtn');await b.page.click('#settingsDialog [data-pane=profile]');
  await b.page.selectOption('#profileTheme','dusk');
  for(const wallpaper of ['dots','mesh','plain','dots']){
    await b.page.selectOption('#chatWallpaper',wallpaper);
    const images=await b.page.locator('#gameHistory,#dmScroll,#groupScroll,#roomChat .chat-scroll').evaluateAll(elements=>elements.map(el=>getComputedStyle(el).backgroundImage));
    assert.equal(images.length,4);
    assert(images.every(image=>wallpaper==='plain'?image==='none':image.includes(wallpaper==='dots'?'radial-gradient':'linear-gradient')));
  }
  await b.page.click('#closeSettingsDialog');await b.page.reload();await b.page.click('#navGame');
  assert.equal(await b.page.getAttribute('html','data-theme'),'dusk');
  assert.equal(await b.page.getAttribute('html','data-wallpaper'),'dots');
  assert.match(await b.page.locator('#gameHistory').evaluate(el=>getComputedStyle(el).backgroundImage),/radial-gradient/);
  const scoped=await b.page.evaluate(async()=>{
    const state=await window.craftlink.direct({op:'state'}),room=state.game.room.id;
    const failures=[];
    for(const request of [{op:'game-chat',room:'stale-room',text:'must not send'},
      {op:'game-clear-chat',profileId:'0'.repeat(64),room,through:null,deleteDownloads:true}]){
      try{await window.craftlink.direct(request);failures.push(false);}catch{failures.push(true);}
    }
    return failures;
  });
  assert.deepEqual(scoped,[true,true]);
  await a.page.fill('#gameMessage','Встреча https://example.org/match');await a.page.press('#gameMessage','Enter');
  await rows(b).locator('a.chat-url').filter({hasText:'https://example.org/match'}).first().waitFor();
  await b.page.click('#gameEmoji summary');await b.page.locator('#gameEmojiChoices [data-glyph="🎮"]').click();
  await b.page.press('#gameMessage','Enter');await rows(a).locator('.chat-emoji-glyph').filter({hasText:'🎮'}).waitFor();
  console.log('PASS LAN text, link card and local emoji in RU/EN; adapter off.');
  const savedFiles=async()=>fs.readdir(path.join(b.base,'Downloads'),{recursive:true,withFileTypes:true})
    .then(rows=>rows.filter(f=>f.isFile()).map(f=>path.join(f.parentPath,f.name)));
  async function save(row,bytes,name){
    await row.locator('[data-action=download]').click();
    await row.locator('[data-action=reveal]').waitFor({state:'attached',timeout:45000});
    const file=(await savedFiles()).find(file=>path.basename(file)===name);
    assert(file,'download missing '+name);assert.equal(digest(await fs.readFile(file)),digest(bytes));
    evidence.files.push({name,size:bytes.length,sha256:digest(bytes)});
  }
  const bytes=crypto.randomBytes(49159),filename='lan-map.bin',source=path.join(a.base,filename);
  await fs.writeFile(source,bytes);
  await dropFile(a.page,'#gameChatPane',source);
  await a.page.fill('#attachmentCaption','Карта на вечер');await a.page.press('#attachmentCaption','Enter');
  const fileRow=rows(b).filter({hasText:'Карта на вечер'});await fileRow.waitFor();
  assert.deepEqual(await savedFiles(),[],'a LAN offer does not download itself');
  await save(fileRow,bytes,filename);
  const png=Buffer.from(await a.page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=120;canvas.height=72;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#31875d';ctx.fillRect(0,0,120,72);
    return [...new Uint8Array(await (await new Promise(r=>canvas.toBlob(r))).arrayBuffer())];
  }));
  async function paste(){
    await a.page.evaluate(bytes=>{
      const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(bytes)],'lan-photo.png',{type:'image/png'}));
      document.querySelector('#gameMessage').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
    },[...png]);
  }
  await a.page.fill('#gameMessage','Схема уровня');await paste();
  await a.page.click('#attachmentDraftCancel');assert.equal(await a.page.inputValue('#gameMessage'),'Схема уровня');
  await paste();assert.equal(await a.page.inputValue('#attachmentCaption'),'Схема уровня');
  await a.page.click('#attachmentDraftSend');
  const photo=rows(b).filter({hasText:'Схема уровня'});await save(photo,png,'lan-photo.png');
  await photo.locator('[data-action=preview]').click();
  assert.deepEqual(await photo.locator('.chat-media-preview img').evaluate(async img=>{await img.decode();return [img.naturalWidth,img.naturalHeight];}),[120,72]);
  await photo.press('Shift+F10');await b.page.getByRole('menuitem',{name:dictionary['Показать в папке']}).waitFor();await b.page.keyboard.press('Escape');
  await photo.locator('[data-action=preview]').click();
  console.log('PASS LAN disk drop and clipboard PNG, atomic captions, actual received file hashes and image pixels.');
  await a.page.click('#gameAttach summary');await a.page.click('#gameCircle');
  await a.page.waitForFunction(()=>!document.querySelector('#clipDialog').open);
  assert.equal(await a.app.evaluate(()=>globalThis.lanCameraPrompts),1);
  await a.app.evaluate(()=>{globalThis.lanCameraChoice=1;});
  for(const [kind,tag] of [['voice','audio'],['circle','video']]){
    if(kind==='circle')await a.page.press('#gameRecordMode','Enter');
    await a.page.press('#gameRecord','Enter');await a.page.locator('#clipStop').waitFor();
    assert.match(await a.page.locator('#clipStatus').innerText(),kind==='voice'?/\/ 10:00$/:/\/ 1:00$/);
    await a.page.waitForTimeout(1400);await a.page.click('#clipStop');await a.page.click('#clipSend');
    const offered=rows(b).filter({has:b.page.locator('[data-action=download].preview-'+kind)});
    await offered.waitFor();
    const id=await offered.getAttribute('data-id'),row=b.page.locator('#gameHistory article[data-id="'+id+'"]');
    const original=await a.page.evaluate(async({room,id})=>{
      const state=await window.craftlink.direct({op:'state'});
      const media=await window.craftlink.direct({op:'game-file',profileId:state.me.id,room,action:'preview',messageId:id});
      return [...media.bytes];
    },{room,id});
    assert(original.length>128);
    const model=(await state(b)).game.room.messages.find(m=>m.id===id);
    await save(row,Buffer.from(original),model.attachment.name);
    await row.locator('.clip-unplayed').waitFor();
    assert.equal((await state(b)).game.room.messages.find(m=>m.id===id).attachment.played,false);
    await row.locator('[data-action=preview]').click();
    const player=row.locator('.chat-media-preview '+tag);
    await player.evaluate(async p=>{p.muted=true;await p.play();});
    await b.page.waitForFunction(id=>{
      const p=document.querySelector('#gameHistory article[data-id="'+id+'"] .chat-media-preview :is(audio,video)');
      return p?.currentTime>0&&(p.tagName==='AUDIO'||p.getVideoPlaybackQuality().totalVideoFrames>0);
    },id);
    await player.evaluate(p=>p.pause());
    await b.page.waitForFunction(async id=>(await window.craftlink.direct({op:'state'})).game.room.messages.find(m=>m.id===id)?.attachment.played===true,id);
    assert.equal(await row.locator('.clip-unplayed').count(),0);
    if(kind==='voice')await row.locator('.voice-track.has-wave .clip-seek').press('Home');
    else{
      const bounds=await row.locator('.clip-round').boundingBox();assert(bounds.width>=140&&Math.abs(bounds.width-bounds.height)<2);
      await row.locator('.clip-rim').press('End');await row.locator('.clip-rim').press('Home');
    }
    evidence.recordings.push({kind,...await player.evaluate(p=>({seconds:p.duration,frames:p.getVideoPlaybackQuality?.().totalVideoFrames}))});
    await row.scrollIntoViewIfNeeded();
    await screenshot('lan-'+kind);
    await row.locator('[data-action=preview]').click();
  }
  assert.equal(await a.app.evaluate(()=>globalThis.lanCameraPrompts),2);
  await screenshot('lan-attachments-wide');
  for(const [width,height] of [[800,620],[740,560]]){
    await b.page.setViewportSize({width,height});await b.page.locator('#gameMessage').focus();
    assert(await b.page.evaluate(()=>{
      const form=document.querySelector('#gameComposer').getBoundingClientRect();
      return form.bottom<=innerHeight&&form.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth;
    }));
    await b.page.click('#gameAttach summary');await b.page.locator('#gameCircle').waitFor();await b.page.keyboard.press('Escape');
    await screenshot('lan-attachments-'+width);
  }
  await b.page.setViewportSize({width:1440,height:900});
  await b.page.click('#gameClearChat');
  assert.equal(await b.page.locator('#gameClearDownloads').isChecked(),false);
  await b.page.click('#confirmYesBtn');
  await b.page.waitForFunction(()=>!document.querySelector('#gameHistory').childElementCount);
  assert.equal((await savedFiles()).length,4);
  await b.page.click('#gameClearChat');await b.page.check('#gameClearDownloads');await b.page.click('#confirmYesBtn');
  await b.page.waitForFunction(()=>document.querySelector('#gameClearChat').hidden);
  assert.deepEqual(await savedFiles(),[]);assert.deepEqual(await fs.readFile(source),bytes);
  assert((await state(a)).game.room.messages.length>0,'other participants retain messages');
  // A recording is owned by this LAN. Leaving releases both local tracks.
  await a.page.press('#gameRecord','Enter');await a.page.locator('#clipStop').waitFor();
  const stream=await a.page.locator('#clipDisplay video').evaluateHandle(video=>video.srcObject);
  await a.page.evaluate(()=>window.craftlink.direct({op:'game-leave'}));
  await a.page.waitForFunction(()=>!document.querySelector('#clipDialog').open);
  assert(await stream.evaluate(media=>media.getTracks().every(track=>track.readyState==='ended')));await stream.dispose();
  for(const client of [a,b]){
    await client.page.waitForFunction(()=>document.querySelector('#gameSession').hidden);
    assert(!['ready','starting'].includes((await state(client)).game.network.phase));
  }
  if(output)await fs.writeFile(path.join(output,'lan-chat.json'),JSON.stringify(evidence,null,2));
  console.log('PASS LAN voice, circle, refused/accepted camera, keyboard/radial seek, compact UI, separate history/file cleanup, leaving while recording and source preservation.',JSON.stringify(evidence));
};
