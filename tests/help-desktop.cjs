'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

module.exports=async({a,b})=>{
  const output=path.resolve(process.env.LINK_VISUAL_DIR||'out/qa/help');
  await fs.mkdir(output,{recursive:true});
  const capture=async(client,file)=>{
    const data=await client.app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true})).toPNG().toString('base64'));
    await fs.writeFile(file,Buffer.from(data,'base64'));
  };
  async function screenshot(client,name){await capture(client,path.join(output,name+'.png'));await pause(350);await capture(client,path.join(output,name+'.png'));}
  for(const client of [a,b]){
    await client.page.click('#navFriends');
    assert(await client.page.locator('#firstSteps').isVisible());
    assert(!await client.page.locator('#linkGuide').evaluate(el=>el.open));
    await client.page.click('#welcomeSkip');
  }
  await screenshot(a,'first-steps');
  await a.page.click('#firstStepsOpen');
  for(let i=1;i<=3;i++){
    assert.equal(await a.page.locator('#guideStep').innerText(),i+' / 3');
    assert.equal(await a.page.evaluate(()=>document.activeElement.id),'guideTitle');
    if(i===1)await screenshot(a,'guide-ru');
    await a.page.click('#guideNext');
  }
  assert(await a.page.locator('#firstSteps').isHidden());
  await a.page.waitForFunction(()=>document.activeElement.id==='bookQuery');
  await b.page.click('#firstStepsSkip');await b.page.reload();
  await b.page.click('#navFriends');assert(await b.page.locator('#firstSteps').isHidden());
  await a.page.click('#networkHelpBtn');await a.page.click('#helpTutorial');
  await a.page.keyboard.press('Escape');assert(!await a.page.locator('#linkGuide').evaluate(el=>el.open));
  await a.page.fill('#helpSearch','видеокруж');
  assert(await a.page.locator('[data-help-topic=attachments]').isVisible());
  assert(await a.page.locator('[data-help-topic=groups]').isHidden());
  await a.page.fill('#helpSearch','no-such-topic-0714');assert(await a.page.locator('#helpNothing').isVisible());
  await a.page.fill('#helpSearch','');await a.page.click('#closeNetworkDialog');
  await a.page.click('#networkHelpBtn');assert.equal(await a.page.locator('#helpSearch').inputValue(),'');
  await screenshot(a,'help-ru');await a.page.click('#closeNetworkDialog');
  for(const client of [a,b]){
    await client.page.evaluate(()=>{
      const pc=window.RTCPeerConnection;
      window.RTCPeerConnection=class extends pc{
        constructor(opts){super({...opts,iceServers:[]});}
        setConfiguration(opts){return super.setConfiguration({...opts,iceServers:[]});}
      };
    });
  }
  async function point(client,selector){
    await client.page.locator(selector).first().scrollIntoViewIfNeeded();
    await client.page.locator(selector).first().evaluate(el=>{
      let ring=document.querySelector('#tutorial-pointer');
      if(!ring){ring=document.createElement('div');ring.id='tutorial-pointer';document.body.append(ring);}
      const rect=el.getBoundingClientRect();
      ring.style.cssText='position:fixed;pointer-events:none;z-index:99999;width:30px;height:30px;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 5px #76dbc077;transform:translate(-50%,-50%);left:'+(rect.x+Math.min(rect.width/2,80))+'px;top:'+(rect.y+rect.height/2)+'px';
    });
    await pause(650);
  }
  async function click(client,selector){await point(client,selector);await client.page.locator(selector).first().click();}
  async function record(name,client,actions){
    const selection=(process.env.LINK_RECORD_TUTORIALS||'').split(',');
    if(!selection.includes('1')&&!selection.includes(name)){await actions(()=>{},()=>{});return;}
    const dir=await fs.mkdtemp(path.join(output,'.frames-'+name+'-'));
    try{
      await captureTutorial(dir,name,client,actions);
    }finally{
      await fs.rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:200});
    }
  }
  async function captureTutorial(dir,name,client,actions){
    let running=true,index=0,posterFrame,screen=client;
    await capture(client,path.join(dir,'00000.png'));await pause(350);
    const loop=(async()=>{while(running){const started=Date.now();await capture(screen,path.join(dir,String(index++).padStart(5,'0')+'.png'));await pause(Math.max(0,250-(Date.now()-started)));}})();
    try{await actions(()=>{posterFrame=index;},other=>{screen=other;console.log('Camera cut',name,index/4);});}finally{running=false;await loop;}
    const asset=path.resolve('src/renderer/assets/tutorials');await fs.mkdir(asset,{recursive:true});
    const ffmpeg=process.env.LINK_FFMPEG||'ffmpeg';
    const converted=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-framerate','4','-i',path.join(dir,'%05d.png'),'-frames:v',String(index),'-vf','scale=1280:-2:flags=lanczos','-c:v','libx264','-preset','medium','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',path.join(asset,name+'.mp4')],{encoding:'utf8',windowsHide:true});
    assert.equal(converted.status,0,converted.stderr);
    assert(posterFrame>0&&posterFrame<index,'the example needs a poster from its demonstrated action');
    const poster=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-ss',String(posterFrame/4),'-i',path.join(asset,name+'.mp4'),'-frames:v','1','-q:v','3',path.join(asset,name+'.jpg')],{encoding:'utf8',windowsHide:true});
    assert.equal(poster.status,0,poster.stderr);
    console.log('Recorded',name,index/4,'seconds');
  }
  await a.page.click('#navFriends');
  await record('chat',a,async markPoster=>{
    await pause(1500);await click(a,'#workspaceContacts .open-person-chat');await pause(2000);
    await point(a,'#dmInput');await a.page.locator('#dmInput').pressSequentially('Привет! Соберёмся вечером?',{delay:70});await pause(700);
    await a.page.press('#dmInput','Enter');await pause(2000);
    await point(a,'#dmLog article');await a.page.locator('#dmLog article').first().click({button:'right'});markPoster();await pause(2500);
    await a.page.keyboard.press('Escape');await pause(1000);
  });
  await record('call',a,async(markPoster,show)=>{
    await pause(1000);await click(a,'#dmCall');await b.page.locator('#peerAccept').waitFor();await pause(1500);
    show(b);await point(b,'#peerAccept');markPoster();await pause(2000);
    await b.page.click('#peerAccept');await a.page.waitForFunction(()=>document.querySelector('#participantsCount').textContent==='2 / 8');show(a);await pause(2000);
    await click(a,'#roomConversation');await pause(1500);await a.page.fill('#dmInput','Я здесь, связь не прерывается.');await a.page.press('#dmInput','Enter');await pause(1500);
    await click(a,'#navRoom');await pause(2000);
  });
  await a.page.click('#leaveBtn');await a.page.click('#confirmYesBtn');
  for(const client of [a,b])await client.page.click('#navGame');
  await record('lan',a,async(markPoster,show)=>{
    await pause(1000);await point(a,'#gameTitle');await a.page.fill('#gameTitle','Вечерний матч');await pause(1000);
    await click(a,'#gameCreate button');await pause(1500);await click(a,'#gameSendInvite');
    const accept=b.page.locator('#gameInvites').getByRole('button',{name:'Принять',exact:true});
    await accept.waitFor();show(b);await pause(2000);await accept.click();
    await a.page.waitForFunction(()=>document.querySelector('#gameCount').textContent==='2');show(a);await pause(2000);
    await point(a,'#gameMessage');await a.page.fill('#gameMessage','Кто создаёт матч?');await a.page.press('#gameMessage','Enter');
    await b.page.fill('#gameMessage','Я создам.');await b.page.press('#gameMessage','Enter');await a.page.locator('#gameHistory').getByText('Я создам.',{exact:true}).waitFor();markPoster();await pause(3500);
  });
  await a.page.click('#navFriends');await a.page.click('#groupCreate');
  await a.page.fill('#groupField-name','Вечерняя мастерская');await a.page.click('#groupEditSubmit');
  await a.page.locator('#groupInput:enabled').waitFor();
  await a.page.fill('#groupInput','Встречаемся в голосовом после восьми.');
  await a.page.press('#groupInput','Enter');
  await a.page.locator('#groupLog').getByText('Встречаемся в голосовом после восьми.',{exact:true}).waitFor();
  await a.page.click('#navFriends');
  const demoGroup='#spaceList button';
  await record('group',a,async markPoster=>{
    await pause(1000);await click(a,demoGroup);await a.page.locator('#groupInput:enabled').waitFor();
    await pause(1500);await click(a,'#groupOptions');
    const appearance=a.page.locator('#groupManage').getByRole('button',{name:'Оформление группы',exact:true});
    await appearance.click();await point(a,'#groupTheme');await a.page.selectOption('#groupTheme','terracotta');
    await pause(1500);await click(a,'#groupAppearanceSave');await a.page.locator('#groupAppearance').waitFor({state:'hidden'});
    if(await a.page.locator('#groupManage').isVisible())await a.page.click('#groupManageClose');
    await a.page.locator('html[data-theme=terracotta] #groupInput').waitFor();
    await point(a,'#groupChannels [aria-current=true]');markPoster();await pause(1350);
    await click(a,'#quickPeople button');await a.page.locator('#dmTitle').filter({hasText:'Борис'}).waitFor();
    await pause(1500);await click(a,demoGroup);await a.page.locator('#groupInput:enabled').waitFor();await pause(1500);
  });
  for(const client of [a,b]){
    assert(!['ready','starting'].includes((await client.page.evaluate(()=>window.craftlink.direct({op:'state'}))).game.network.phase));
    await client.page.evaluate(()=>document.querySelector('#tutorial-pointer')?.remove());
  }
  // Real local media must decode, not only return a successful file URL.
  async function checkCaptions(page,name,language){
    await page.waitForFunction(({name,language})=>{
      const video=document.querySelector('#helpVideo'),track=video.textTracks[0];
      return video.currentSrc.endsWith('/'+name+'.mp4') && Number.isFinite(video.duration) &&
        track?.language===language && track.cues?.length>0;
    },{name,language},{timeout:6000});
    const times=await page.locator('#helpVideo').evaluate(video=>{
      const cues=Array.from(video.textTracks[0].cues);
      return {duration:video.duration,end:cues.at(-1).endTime,first:cues[0].startTime};
    });
    assert.equal(times.first,0);
    assert(Math.abs(times.end-times.duration)<=0.25,'captions must cover the example: '+name+' '+language);
  }
  await a.page.click('#networkHelpBtn');await a.page.click('#helpExamplesTitle');
  for(const name of ['chat','call','lan','group']){
    await a.page.click('[data-clip='+name+']');
    const playback=await a.page.locator('#helpVideo').evaluate(async video=>{
      await video.play();await new Promise(resolve=>setTimeout(resolve,900));
      const result={width:video.videoWidth,time:video.currentTime,frames:video.getVideoPlaybackQuality().totalVideoFrames,duration:video.duration};
      video.pause();return result;
    });
    assert(playback.width>0 && playback.frames>0 && playback.time>0,'tutorial must decode '+JSON.stringify(playback));
    await checkCaptions(a.page,name,'ru');
    console.log('PASS tutorial decoded',name,JSON.stringify(playback));
  }
  await screenshot(a,'tutorial-lan');
  await a.page.locator('#helpVideo').evaluate(video=>video.play());await a.page.click('#helpExamplesTitle');await a.page.waitForFunction(()=>document.querySelector('#helpVideo').paused);
  await a.page.click('#helpExamplesTitle');await a.page.locator('#helpVideo').evaluate(video=>video.play());
  await a.page.click('#helpTutorial');assert(await a.page.locator('#helpVideo').evaluate(video=>video.paused));
  await a.page.keyboard.press('Escape');await a.page.waitForFunction(()=>document.activeElement.id==='helpTutorial');
  await a.page.click('#closeNetworkDialog');
  await b.page.evaluate(()=>localStorage.setItem('craftcode.language','en'));await b.page.reload();
  await b.page.click('#networkHelpBtn');assert.equal(await b.page.locator('#helpTutorial').innerText(),'First steps');
  assert(!/[А-Яа-я]/u.test(await b.page.locator('#helpArticles').innerText()));
  await b.page.click('#helpTutorial');await screenshot(b,'guide-en');await b.page.click('#guideSkip');
  await b.page.fill('#helpSearch','download');assert(await b.page.locator('[data-help-topic=storage]').isVisible());
  await b.page.fill('#helpSearch','');await screenshot(b,'help-en');
  for(const width of [900,1100,1440]){
    await b.page.setViewportSize({width,height:800});
    const fits=await b.page.locator('#networkDialog').evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth+1);
    assert(fits,'help overflow at '+width);
  }
  await b.page.emulateMedia({reducedMotion:'reduce'});await b.page.click('#helpExamplesTitle');
  assert(await b.page.locator('#helpVideo').evaluate(video=>video.paused && !video.autoplay));
  for(const name of ['chat','call','lan','group']){
    await b.page.click('[data-clip='+name+']');
    await b.page.locator('#helpVideo').evaluate(async video=>{await video.play();video.pause();});
    await checkCaptions(b.page,name,'en');
  }
  await b.page.click('#closeNetworkDialog');
  console.log('PASS first-run guide is optional, per-profile and persistent; Help search, RU/EN, keyboard dismissal, responsive dialog, manual-only tutorials, no live network adapter.');
};
