const {capture}=require('./visual-capture.cjs');
const {clickPath}=require('./qa-navigation.cjs');
const {roomChat}=require('./participant-controls.cjs');
'use strict';
const assert=require('node:assert/strict');
const net=require('node:net');
const path=require('node:path');
const {_electron}=require(require.resolve('playwright',{paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||__dirname]}));
const fs=require('node:fs'),os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'cclink-topology-'));
const appdir=path.resolve(__dirname,'..');
const apps=[];
async function open(label, profile){
  const args=[appdir,'--allow-loopback-in-peer-connection','--craftlink-profile='+(profile || 'quality-'+Date.now()+'-'+label)];
  if(process.platform==='linux')args.unshift('--headless','--ozone-platform=headless','--no-sandbox');
  const app=await _electron.launch({executablePath:require(path.join(appdir,'node_modules/electron')),args,env:{...process.env,XDG_CONFIG_HOME:root}});
  apps.push(app);
  const page=await app.firstWindow();
  if(await page.evaluate(()=>!JSON.parse(localStorage.getItem('craftlink.settings.v1')||'{}').accountIntroSeen))await page.click('#entryLater');
  await page.evaluate(()=>{
    const Base=RTCPeerConnection;
    window.tracked=[];window.RTCPeerConnection=class extends Base{constructor(...args){super(...args);window.tracked.push(this);}};
  });
  return {app,page};
}

async function configureCapture(app,host){
  await app.evaluate(({desktopCapturer})=>{desktopCapturer.getSources=async()=>[{id:'screen:1:0',name:'Контроль движения'}];});
  await host.evaluate(()=>{
    navigator.mediaDevices.getDisplayMedia=async()=>{
      const c=document.createElement('canvas');c.width=2560;c.height=1440;
      const ctx=c.getContext('2d');
      let frame=0;
      const draw=()=>{
        if (window.pauseMovie) return;
        ctx.fillStyle='#171d21';ctx.fillRect(0,0,c.width,c.height);
        for(let i=0;i<24;i++){
          ctx.fillStyle='hsl('+((i*7)%360)+' 60% 55%)';
          ctx.fillRect((frame*5+i*77)%c.width,(frame*2+i*41)%c.height,42+i%52,24+i%43);
        }
        frame++;
      };
      draw();const stream=c.captureStream(60),timer=setInterval(draw,16); window.captureTrack=stream.getVideoTracks()[0];
      stream.getVideoTracks()[0].addEventListener('ended',()=>clearInterval(timer));
      return stream;
    };
  });

  await host.click('#settingsBtn');await host.click('[data-pane=stream]');
  await host.selectOption('#qualitySelect','1440p60');await host.selectOption('#bitrateSelect','32');await host.selectOption('#shareContent','detail');
  await host.click('#closeSettingsDialog');
}
async function share(page){
  await page.click('#shareBtn');await page.locator('.source-card').first().click();await page.click('#startShare');
}
async function take(page,mid){
  return page.evaluate(async mid=>{
    const out={};
    for(const [pcid,pc] of window.tracked.entries()){
      if(pc.connectionState!=='connected')continue;
      const report=await pc.getStats();
      for(const r of report.values()){
        if(r.kind!=='video'||r.mid!==mid||!['inbound-rtp','outbound-rtp'].includes(r.type))continue;
        out[pcid+'-'+r.id]={direction:r.type,bytes:r.bytesReceived??r.bytesSent,frames:r.framesDecoded??r.framesEncoded??0,
        width:r.frameWidth,height:r.frameHeight,time:r.timestamp};
      }
    }
    return out;
  },mid);
}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function viewLimit(page,height){
  await page.click('#settingsBtn'); await page.click('[data-pane=stream]');
  await page.selectOption('#viewHeight',String(height)); await page.click('#closeSettingsDialog');
}
async function decoded(page,mid,height){
  const until=Date.now()+45000;
  let before,after;
  while(Date.now()<until){
    after=Object.values(await take(page,mid)).find(row=>row.direction==='inbound-rtp');
    if(after?.height===height && after.width===height*16/9 && before?.height===height &&
       after.frames>before.frames && after.bytes>before.bytes){
      return {width:after.width,height,frames:after.frames-before.frames,bytes:after.bytes-before.bytes,
        fps:+((after.frames-before.frames)*1000/(after.time-before.time)).toFixed(1)};
    }
    before=after; await delay(1800);
  }
  throw new Error('Expected live '+height+'p on mid '+mid+'; last sample '+JSON.stringify(after));
}
async function join(guest,invite,name){
await clickPath(guest,'#joinBtn');await guest.fill('#hubCode',invite);await guest.click('#hubEnter');await guest.fill('#nameInput',name);await guest.click('#roomSubmitBtn');
}
async function studioCheck(){
 const profile='studio-gpu', first=await open('defaults',profile);
 await first.page.click('#settingsBtn');await first.page.click('[data-pane=stream]');await first.page.click('#graphicsDetails summary');
 assert.equal(await first.page.inputValue('#graphicsAuto'),'gpu');
 assert.equal(await first.page.locator('#graphicsAuto option').count(),2);
 await first.page.selectOption('#graphicsAuto','cpu');await first.page.waitForSelector('#graphicsRestart');
 const saved=await first.page.evaluate(()=>window.craftlink.graphicsStatus());
 assert.equal(saved.applied,true);assert.equal(saved.automatic,false);
 await first.app.close();apps.splice(apps.indexOf(first.app),1);
 const h=await open('cpu',profile),g=await open('observer'),host=h.page,guest=g.page;
 const flags=await h.app.evaluate(({app})=>({encoder:app.commandLine.hasSwitch('disable-accelerated-video-encode'),
   gpu:app.commandLine.hasSwitch('disable-gpu'),decoder:app.commandLine.hasSwitch('disable-accelerated-video-decode')}));
 assert.deepEqual(flags,{encoder:true,gpu:false,decoder:false});
 console.log('PASS CPU selection persists to a new process and disables hardware encoding only');
 await configureCapture(h.app,host);await configureCapture(g.app,guest);
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 await clickPath(host,'#createBtn');await host.click('#hubManual');await host.fill('#nameInput','Анна');await host.fill('#addressInput','127.0.0.1');await host.fill('#portInput',String(port));await host.click('#roomSubmitBtn');await host.waitForSelector('#inviteDoneBtn');
 const invite=await host.inputValue('#inviteOutput');await host.click('#inviteDoneBtn');
 await share(host);await host.click('#studioBtn');await host.waitForSelector('#studioDock #settingsDialog[open]');
 await host.locator('#studioSend').getByText(/Пока вы одни/).waitFor();
 assert(await host.evaluate(()=>document.querySelector('#remoteVideo').srcObject.getVideoTracks()[0].id===window.captureTrack.id));
 await host.click('#graphicsDetails summary').catch(()=>{});
 if(!await host.isVisible('#graphicsAuto'))await host.click('#graphicsDetails summary');
 await host.selectOption('#graphicsAuto','gpu');await host.waitForSelector('#graphicsNext');
 assert(!await host.isVisible('#graphicsRestart'));
 await assert.rejects(host.evaluate(()=>window.craftlink.restartGraphics()));
 await host.click('#graphicsDetails summary');
 await join(guest,invite,'Борис');
 await guest.waitForFunction(()=>document.querySelector('#remoteVideo').videoWidth>0);
 await host.waitForFunction(()=>document.querySelector('#studioSend').textContent.includes('Мбит/с'));
 const actual=await host.locator('#studioSend').innerText();await capture(host,'live-studio');
 await host.selectOption('#qualitySelect','720p30');await host.selectOption('#bitrateSelect','4');await host.selectOption('#shareContent','motion');
 await host.waitForFunction(()=>window.tracked[0].getTransceivers()[1].sender.getParameters().encodings[0].maxFramerate===30);
 const delivered=await decoded(guest,'1',720);assert(delivered.frames>0&&delivered.bytes>0);
 const captureId=await host.evaluate(()=>window.captureTrack.id);
 const out=path.join(appdir,'out','qa');fs.mkdirSync(out,{recursive:true});
 for(const [w,height] of [[1920,1040],[1440,900],[1152,720],[1000,700]]){
   await host.setViewportSize({width:w,height});
   const geometry=await host.evaluate(()=>{
      const d=document.querySelector('#studioDock').getBoundingClientRect(),s=document.querySelector('#streamStage').getBoundingClientRect();
      const doc=document.documentElement,inside=document.querySelector('#settingsDialog');
      return {separate:s.right<=d.left+1 || s.bottom<=d.top+1,scroll:doc.scrollWidth-doc.clientWidth,inner:inside.scrollWidth-inside.clientWidth,
        video:!document.querySelector('#remoteVideo').hidden && document.querySelector('#remoteVideo').videoWidth>0,modal:!!document.querySelector('dialog:modal')};
   });
   assert(geometry.separate&&geometry.video&&!geometry.modal&&geometry.inner<=2,JSON.stringify([w,geometry]));
   assert(geometry.scroll<=2,JSON.stringify([w,geometry]));
   if(w===1440)await host.screenshot({path:path.join(out,'studio-live.png')});
 }
 await host.setViewportSize({width:1170,height:765});
 await host.click('#closeSettingsDialog');await roomChat(host);
 console.log('PASS local preview without a viewer, separate capture/uplink, 4 studio viewports, live 720p30 without replacing the source',actual,delivered);
 await share(guest);
 await guest.waitForFunction(()=>document.querySelector('#remoteVideo').srcObject?.getVideoTracks()[0]?.id===window.captureTrack.id);
 assert(await guest.locator('#roomFilmstrip .voice-tile .tile-sound-menu').first().isVisible());
 assert.equal(await host.evaluate(()=>window.captureTrack.id),captureId);
 await guest.getByRole('button',{name:'Смотреть трансляцию Анна'}).click();
 await guest.click('#studioBtn');await guest.waitForFunction(()=>document.querySelector('#remoteVideo').srcObject?.getVideoTracks()[0]?.id===window.captureTrack.id);
 await guest.click('#togglePanelBtn');await guest.waitForSelector('#roomSidebar');
 await guest.getByRole('button',{name:'Смотреть трансляцию Анна'}).click();
 const stageBox=await guest.locator('#streamStage').boundingBox();
 await guest.mouse.move(stageBox.x+20,stageBox.y+15);await guest.waitForSelector('#streamStage.controls-asleep');
 await guest.mouse.move(stageBox.x+100,stageBox.y+stageBox.height-6);await guest.click('#pinPlayer');
 await guest.mouse.move(stageBox.x+30,stageBox.y+15);await guest.waitForTimeout(2000);
 assert.equal(await guest.locator('#pinPlayer').getAttribute('aria-pressed'),'true');assert(!(await guest.locator('#streamStage').getAttribute('class')).includes('controls-asleep'));
 assert(await guest.locator('#broadcastStatus').isHidden());await capture(guest,'pinned-player');await guest.click('#pinPlayer');await guest.click('#fullscreenBtn');
 await guest.waitForFunction(()=>document.fullscreenElement?.id==='streamStage');
 await guest.mouse.move(35,40);await guest.waitForSelector('#streamStage.controls-asleep');
 const screen=await guest.locator('#streamStage').boundingBox();await guest.mouse.move(screen.width*.6,screen.height-7);
 await guest.waitForFunction(()=>!document.querySelector('#streamStage').classList.contains('controls-asleep'));
 await capture(guest,'fullscreen-player');await guest.click('#exitPlayer');await guest.waitForFunction(()=>!document.fullscreenElement);
 await guest.click('#fullscreenBtn');await guest.mouse.move(40,50);await guest.waitForSelector('#streamStage.controls-asleep');
 await guest.keyboard.press('Tab');await guest.waitForFunction(()=>!document.querySelector('#streamStage').classList.contains('controls-asleep'));
 await guest.keyboard.press('Escape');await guest.waitForFunction(()=>!document.fullscreenElement);
 console.log('PASS two simultaneous shows, self-preview immediately selected, fullscreen controls hide, pointer reveals, mouse and Escape exit');
 await host.click('#leaveBtn');await host.click('#confirmYesBtn');await host.waitForSelector('#directoryPage');
 await h.app.close();apps.splice(apps.indexOf(h.app),1);
 const reverted=await open('auto',profile);
 assert.equal(await reverted.app.evaluate(({app})=>app.commandLine.hasSwitch('disable-accelerated-video-encode')),false);
 console.log('PASS return to automatic encoder on next launch');
}
async function run(){
 if(process.argv.includes('--studio'))return studioCheck();
 const h=await open('h'),g=await open('g1'),host=h.page,guest=g.page;
 await configureCapture(h.app,host);await configureCapture(g.app,guest);await viewLimit(guest,process.argv.includes('--two') ? 1440 : 720);
  const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  await clickPath(host,'#createBtn');await host.click('#hubManual');await host.fill('#nameInput','Host');await host.fill('#addressInput','127.0.0.1');await host.fill('#portInput',String(port));await host.click('#roomSubmitBtn');await host.waitForSelector('#inviteDoneBtn');
  const invite=await host.inputValue('#inviteOutput');await host.click('#inviteDoneBtn');

 await join(guest,invite,'Guest A');await host.waitForFunction(()=>window.tracked.some(pc=>pc.connectionState==='connected'));
 await share(host);await guest.waitForFunction(()=>document.querySelector('#remoteVideo').videoWidth>0);
 if(process.argv.includes('--two')){
   await host.click('#settingsBtn');await host.click('[data-pane=stream]');
   await host.selectOption('#shareContent','motion');await host.click('#closeSettingsDialog');
   await delay(7000);
   const before=Object.values(await take(guest,'1')).find(r=>r.direction==='inbound-rtp');
   await delay(6000);
   const after=Object.values(await take(guest,'1')).find(r=>r.direction==='inbound-rtp');
   assert.ok(after.bytes>before.bytes && after.frames>before.frames);
   console.log('PASS two-person motion, QHD60 target',JSON.stringify({width:after.width,height:after.height,
     fps:+((after.frames-before.frames)*1000/(after.time-before.time)).toFixed(1),bytes:after.bytes-before.bytes,frames:after.frames-before.frames}));
   await host.click('#leaveBtn');await host.click('#confirmYesBtn');return;
 }
 const {page:viewer}=await open('g2');await viewLimit(viewer,1440);await join(viewer,invite,'Guest B');
 await viewer.waitForFunction(()=>document.querySelector('#remoteVideo').videoWidth>0);
 await delay(4500);
 console.log('PASS host QHD60 preset, simultaneous receivers',JSON.stringify(await Promise.all([decoded(guest,'1',720),decoded(viewer,'1',1440)])));
 await host.click('#settingsBtn');await host.click('[data-pane=stream]');
 await host.selectOption('#qualitySelect','1440p30');await host.click('#closeSettingsDialog');
 await host.waitForFunction(()=>window.tracked.filter(pc=>pc.connectionState==='connected').every(pc=>pc.getTransceivers()[1].sender.getParameters().encodings[0].maxFramerate===30));
 console.log('PASS live QHD30 change',JSON.stringify(await decoded(viewer,'1',1440)));
 await viewLimit(viewer,1080);
 console.log('PASS independently changing viewer cap during broadcast',JSON.stringify(await Promise.all([decoded(guest,'1',720),decoded(viewer,'1',1080)])));
 await viewLimit(viewer,1440);
 const trackId=()=>viewer.locator('#remoteVideo').evaluate(v=>v.srcObject.getVideoTracks()[0].id);
 const movieId=await trackId(),captureId=await host.evaluate(()=>window.captureTrack.id);
 await host.evaluate(()=>window.pauseMovie=true);
 await viewer.evaluate(async()=>{
   const {AudioMixer}=await import('./audio.mjs');
   const original=AudioMixer.prototype.setSetting;
   AudioMixer.prototype.setSetting=function(id,role,update){
     window.observedMixer=this;
     return original.call(this,id,role,update);
   };
 });
 await share(guest);await viewer.getByRole('button',{name:'Смотреть трансляцию Guest A',exact:true}).waitFor();
 assert.equal(await trackId(),movieId,'starting another broadcast did not displace the movie');
 await viewer.click('#settingsBtn');await viewer.click('[data-pane=voice]');await viewer.check('#focusAudio');await viewer.click('#closeSettingsDialog');
 const gains=()=>viewer.evaluate(()=>[...window.observedMixer.settings.entries()].map(([k,v])=>[k,{...v}]).sort());
 const movieMix=await gains();
 assert.equal(movieMix.filter(([k,v])=>k.endsWith(':system') && v.active).length,1);
 await viewer.getByRole('button',{name:'Смотреть трансляцию Guest A',exact:true}).click();
 await viewer.waitForFunction(()=>document.querySelector('#stageName').textContent==='Guest A');
 assert.notEqual(await trackId(),movieId);
 const gameMix=await gains();
 const selected=mix=>mix.filter(([k,v])=>k.endsWith(':system') && v.active).map(([k])=>k);
 assert.equal(selected(gameMix).length,1);assert.notDeepEqual(selected(gameMix),selected(movieMix));
 assert.deepEqual(gameMix.filter(([k])=>k.endsWith(':voice')),movieMix.filter(([k])=>k.endsWith(':voice')));
 console.log('PASS selecting a broadcast gates only the local system tracks and preserves the voice mixer');
 async function deltas(mid){
   const a=Object.values(await take(viewer,mid)).find(r=>r.direction==='inbound-rtp');
   await delay(3500);
   const b=Object.values(await take(viewer,mid)).find(r=>r.direction==='inbound-rtp');
   assert.ok(a && b && b.bytes>a.bytes && b.frames>a.frames);
   return {bytes:b.bytes-a.bytes,frames:b.frames-a.frames};
 }
 await host.waitForFunction(()=>window.tracked.some(pc=>{
   const sender=pc.getTransceivers()[4]?.sender;if(!sender?.track)return false;
   const params=sender.getParameters();return params.degradationPreference==='maintain-resolution' && sender.track.contentHint==='detail' && params.encodings[0].maxFramerate===60;
 }));
 console.log('PASS guest detail preference arrives on the host and applies to the second viewer');
 await delay(11000);
 console.log('PASS forwarded share reached QHD',JSON.stringify(await decoded(viewer,'4',1440)));
 await delay(2000);
 console.log('PASS Viewer selected the second live share while movie source was paused',await deltas('4'));
 assert.equal(await host.evaluate(()=>window.captureTrack.readyState),'live');
 assert.equal(await host.evaluate(()=>window.captureTrack.id),captureId);
 await guest.click('#stopShareBtn');
 await viewer.waitForFunction(()=>document.querySelector('#stageName').textContent==='Host' && !document.querySelector('.tile-watch:not([hidden])'));
 assert.equal(await trackId(),movieId,'the original movie track is still the same');
 await host.evaluate(()=>window.pauseMovie=false);
 console.log('PASS Viewer returned to the same movie track and resumed decoding',await deltas('1'));
 await host.click('#leaveBtn');await host.click('#confirmYesBtn');
 for(const page of [host,guest,viewer])await page.waitForFunction(()=>window.tracked.every(pc=>pc.connectionState==='closed'));
 await new Promise((resolve,reject)=>{const test=net.createServer();test.once('error',reject);test.listen(port,'127.0.0.1',()=>test.close(resolve));});
 console.log('PASS room ended on all three peers and former host TCP port can be used again');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{for(const app of apps)await app.close().catch(()=>{});fs.rmSync(root,{recursive:true,force:true});});
