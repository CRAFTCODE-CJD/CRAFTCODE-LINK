'use strict';
const {clickPath}=require('./qa-navigation.cjs');
const {testRuntime}=require('./electron-runtime.cjs');
const assert=require('node:assert/strict');
const net=require('node:net');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {_electron}=require(require.resolve('playwright',{paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||__dirname]}));
const apps=[];
let scratch;
async function open(label){
  const root=(label==='guest'?process.env.LINK_QA_GUEST_APP:process.env.LINK_QA_HOST_APP)||path.resolve(__dirname,'..');
  const entry=require.resolve(path.resolve(root));
  const profile=path.join(scratch,label);await fs.mkdir(profile);
  const args=[path.join(__dirname,'screen-sync-bootstrap.cjs'),'--no-error-dialogs','--mute-audio','--allow-loopback-in-peer-connection','--craftlink-profile=quality-'+label];
  if(process.platform==='linux')args.unshift('--headless','--ozone-platform=headless','--no-sandbox');
  const app=await _electron.launch({executablePath:testRuntime(),args,env:{...process.env,QA_PROFILE_ROOT:profile,QA_APP_ENTRY:entry}});
  apps.push(app);
  assert((await app.evaluate(({app})=>app.getPath('userData'))).startsWith(profile+path.sep));
  const page=await app.firstWindow();
  await page.click('#entryLater');
  return {app,page};
}
async function snapshot(page,kind){
  return page.evaluate(async kind=>{
    const report=await window.qaPC.getStats();
    const s=[...report.values()].find(s=>s.type===kind+'-rtp' && s.kind==='video' && s.mid==='1');
    return s && {frames:s.framesDecoded??s.framesEncoded,bytes:s.bytesReceived??s.bytesSent,width:s.frameWidth,height:s.frameHeight,time:s.timestamp};
  },kind);
}
async function run(){
  scratch=await fs.mkdtemp(path.join(os.tmpdir(),'link-stream-quality-'));
  const {app,page:host}=await open('owner'),{page:guest}=await open('guest');
  for(const page of [host,guest]){
    await page.evaluate(()=>{
      const Base=RTCPeerConnection;
      window.RTCPeerConnection=class extends Base{constructor(...args){super(...args);window.qaPC=this;}};
    });
  }
  await host.exposeBinding('qaConsumeSelection',()=>app.evaluate(({BrowserWindow})=>new Promise((resolve,reject)=>{
    globalThis.qaDisplayRequest({frame:BrowserWindow.getAllWindows()[0].webContents.mainFrame,videoRequested:true},
      selection=>selection?.video?.name==='QA timing chart'?resolve():reject(Error('Test source was not selected')));
  })));
  await host.evaluate(()=>{
    navigator.mediaDevices.getDisplayMedia=async({video})=>{
      await window.qaConsumeSelection();
      const c=document.createElement('canvas');
      let timer;
      const format=constraints=>{
        c.width=constraints.width.ideal;c.height=constraints.height.ideal;
        clearInterval(timer);
        timer=setInterval(draw,1000/constraints.frameRate.ideal);
      };
      const ctx=c.getContext('2d');
      let frame=0;
      const draw=()=>{
        ctx.fillStyle='#171d21';ctx.fillRect(0,0,c.width,c.height);
        for(let i=0;i<140;i++){
          ctx.fillStyle='hsl('+((i*7)%360)+' 60% 55%)';
          ctx.fillRect((frame*5+i*77)%c.width,(frame*2+i*41)%c.height,42+i%52,24+i%43);
        }
        frame++;
      };
      format(video);draw();const stream=c.captureStream(60);
      const track=stream.getVideoTracks()[0],apply=track.applyConstraints.bind(track);
      window.qaCapture=track;window.qaConstraints=0;
      track.applyConstraints=async constraints=>{window.qaConstraints++;format(constraints);await apply(constraints);};
      stream.getVideoTracks()[0].addEventListener('ended',()=>clearInterval(timer));
      return stream;
    };
  });
  const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  await clickPath(host,'#createBtn');await host.click('#hubManual');await host.fill('#nameInput','Host');await host.fill('#addressInput','127.0.0.1');await host.fill('#portInput',String(port));await host.click('#roomSubmitBtn');await host.waitForSelector('#inviteDoneBtn');
  const invite=await host.inputValue('#inviteOutput');await host.click('#inviteDoneBtn');
  await clickPath(guest,'#joinBtn');await guest.fill('#hubCode',invite);await guest.click('#hubEnter');await guest.fill('#nameInput','Guest');await guest.click('#roomSubmitBtn');
  await host.waitForFunction(()=>window.qaPC?.connectionState==='connected');
  const settings=async(height,fps,limit,content)=>{
    if(await host.locator('#studioBtn').isVisible())await host.click('#studioBtn');
    else {await host.click('#settingsBtn');await host.click('[data-pane=stream]');}
    await host.selectOption('#qualitySelect',height+'p'+fps);
    await host.selectOption('#shareContent',content);
    await host.selectOption('#bitrateSelect',String(limit));
    await host.click('#closeSettingsDialog');
  };
  await settings(720,30,4,'motion');
  await host.click('#shareBtn');
  const sound=host.locator('#withSystemAudio');if(await sound.isChecked())await sound.uncheck();
  await host.locator('.source-card').first().click();await host.click('#startShare');
  await guest.waitForFunction(()=>document.querySelector('#remoteVideo').videoWidth>0);
  assert(await host.locator('#watchBufferBox').isHidden());
  assert.equal(await guest.inputValue('#watchBuffer'),'0');
  await guest.selectOption('#watchBuffer','2000');
  await guest.waitForFunction(()=>qaPC.getTransceivers()[1].receiver.jitterBufferTarget===2000);
  const before=await snapshot(guest,'inbound');
  await host.click('#studioBtn');await host.selectOption('#bitrateSelect','8');await host.click('#closeSettingsDialog');
  await host.waitForFunction(()=>qaPC.getTransceivers()[1].sender.getParameters().encodings[0].maxBitrate===8e6);
  const reconfigurations=await host.evaluate(()=>qaConstraints);
  if(!process.env.LINK_QA_HOST_APP)assert.equal(reconfigurations,0);
  await guest.waitForFunction(async frames=>{
    const s=[...(await qaPC.getStats()).values()].find(s=>s.type==='inbound-rtp'&&s.mid==='1');
    return qaPC.connectionState==='connected'&&s?.framesDecoded>frames+15&&qaPC.getTransceivers()[1].receiver.jitterBufferTarget===2000;
  },before.frames);
  console.log('PASS bitrate alone updates the active sender while the viewer keeps 2000ms and decodes new frames; capture reconfigurations:',reconfigurations);
  if(!process.env.LINK_QA_GUEST_APP){
    await guest.click('#fullscreenBtn');await guest.waitForFunction(()=>document.fullscreenElement?.id==='streamStage');
    await guest.waitForFunction(()=>/\d+ × \d+.*[1-9]\d*(?:,\d+)? FPS.*приём/.test(document.querySelector('#playerFormat').textContent));
    const stage=await guest.locator('#streamStage').boundingBox();await guest.mouse.move(stage.x+stage.width/2,stage.y+stage.height-8);await guest.click('#pinPlayer');
    assert.equal(await guest.textContent('#playerFormat'),await guest.textContent('#stageStats'));
    assert(await guest.locator('#playerFormat').isVisible());
    if(process.env.LINK_VISUAL_DIR)await guest.screenshot({path:path.join(process.env.LINK_VISUAL_DIR,'fullscreen-received.png')});
    console.log('PASS fullscreen receiver overlay',await guest.textContent('#playerFormat'));
    await guest.click('#exitPlayer');await guest.waitForFunction(()=>!document.fullscreenElement);
    assert(await guest.locator('#playerFormat').isHidden());
  }
  if(process.env.LINK_QA_SHORT)return;
  await guest.selectOption('#watchBuffer','1000');
  await guest.waitForFunction(()=>window.qaPC.getTransceivers()[1].receiver.jitterBufferTarget===1000);
  await clickPath(guest,'#networkHelpBtn');
  await guest.waitForFunction(()=>document.querySelector('#mediaDiagnostics').textContent.includes('Буфер просмотра · слот 0 · 1000 мс'));
  await guest.click('#closeNetworkDialog');
  await guest.selectOption('#watchBuffer','0');
  await guest.waitForFunction(()=>window.qaPC.getTransceivers()[1].receiver.jitterBufferTarget===null,null,{timeout:30000});
  console.log('PASS viewer changes viewing buffer through the player and reads its value in diagnostics; local preview stays clear');
  for(const [height,fps,limit,content] of [[720,30,4,'motion'],[720,60,12,'motion'],[1080,30,8,'detail'],[1080,60,20,'motion']]){
    await settings(height,fps,limit,content);
    await host.waitForFunction(([fps,limit,content])=>{
      const p=window.qaPC.getTransceivers()[1].sender.getParameters();
      return p.encodings[0].maxFramerate===fps && p.encodings[0].maxBitrate===limit*1e6 &&
        p.degradationPreference==='maintain-resolution' && window.qaPC.getTransceivers()[1].sender.track.contentHint===content;
    },[fps,limit,content]);
    await new Promise(r=>setTimeout(r,10500));
    const a=await snapshot(guest,'inbound');await new Promise(r=>setTimeout(r,5500));const b=await snapshot(guest,'inbound');
    const seconds=(b.time-a.time)/1000;
    const sender=await host.evaluate(async()=>{
      const stats=await qaPC.getStats(),s=[...stats.values()].find(s=>s.type==='outbound-rtp' && s.mid==='1');
      const src=stats.get(s.mediaSourceId),transport=stats.get(s.transportId),pair=stats.get(transport?.selectedCandidatePairId);
      return {codec:stats.get(s.codecId)?.mimeType,sourceWidth:src?.width,sourceHeight:src?.height,sourceFPS:src?.framesPerSecond,encodedFPS:s.framesPerSecond,qualityReason:s.qualityLimitationReason,encoder:s.encoderImplementation,availableMbps:+((pair?.availableOutgoingBitrate||0)/1e6).toFixed(2)};
    });
    const result={targetHeight:height,content,...sender,targetFPS:fps,limitMbps:limit,width:b.width,height:b.height,decodedFPS:+((b.frames-a.frames)/seconds).toFixed(1),receivedMbps:+((b.bytes-a.bytes)*8/seconds/1e6).toFixed(2)};
    assert.ok(b.frames>a.frames && b.bytes>a.bytes && b.width>0);
    assert.equal(result.sourceHeight,height);
    assert.ok(result.height<=height && result.width<=result.sourceWidth);
    console.log('PASS measured moving canvas at receiver '+JSON.stringify(result));
  }

  await guest.click('#studioBtn');await guest.selectOption('#viewHeight','720');await guest.click('#closeSettingsDialog');
  await host.waitForFunction(()=>qaPC.getTransceivers()[1].sender.getParameters().encodings[0].scaleResolutionDownBy>=1.5);
  const beforeCap=await snapshot(guest,'inbound');
  await guest.waitForFunction(async frames=>{
    const stream=[...(await qaPC.getStats()).values()].find(s=>s.type==='inbound-rtp' && s.mid==='1');
    return stream?.framesDecoded>frames+10 && stream.frameHeight>0 && stream.frameHeight<=720;
  },beforeCap.frames);
  await guest.click('#studioBtn');await guest.selectOption('#viewHeight','0');await guest.click('#closeSettingsDialog');
  await host.waitForFunction(()=>qaPC.getTransceivers()[1].sender.getParameters().encodings[0].scaleResolutionDownBy===1);
  console.log('PASS receiver 720p ceiling limits decoded video; Auto releases that ceiling');

  await clickPath(host,'#networkHelpBtn');
  await host.waitForFunction(()=>document.querySelector('#mediaDiagnostics').textContent.includes('Отправка видео · слот 0'));
  await clickPath(guest,'#networkHelpBtn');
  await guest.waitForFunction(()=>document.querySelector('#mediaDiagnostics').textContent.includes('Приём видео · слот 0'));
  await guest.waitForFunction(()=>/За последние \d+ с · потеряно пакетов \d+.*время замираний/.test(document.querySelector('#mediaDiagnostics').textContent));
  console.log('PASS recent loss and freezes visible alongside measured resolution and FPS in receiver diagnostics');
  console.log('PASS sender parameters change live for motion and detail; both diagnostics identify the video direction');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  for(const app of apps)await app.close().catch(()=>{});
  if(scratch)await fs.rm(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:180});
});
