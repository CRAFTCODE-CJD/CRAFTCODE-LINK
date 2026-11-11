'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {count,addFriend}=require('./room-controls-desktop.cjs');

function instrument(){
  const settings=JSON.parse(localStorage.getItem('craftlink.settings.v1')||'{}');
  localStorage.setItem('craftlink.settings.v1',JSON.stringify({...settings,publicStun:false,cueEnabled:false}));
  window.qaConnections=[];window.qaCameraTracks=[];window.qaMediaRequests=[];window.qaCameraFault='';window.qaNoCamera=false;
  window.qaVideoSourceLog=[];
  window.qaMediaHook=import(new URL('peer.mjs',location.href).href).then(({RoomMedia})=>{
    for(const name of ['setVideoSource','updateVideoSource','offer']){
      const method=RoomMedia.prototype[name];
      RoomMedia.prototype[name]=function(...args){window.qaRoom=this;window.qaVideoSourceLog.push({name,selfSlot:this.selfSlot,isHost:this.isHost,target:name==='updateVideoSource'?args[0]?.slot:null,source:name==='setVideoSource'?args[0]:name==='updateVideoSource'?args[1]:this.videoSource(this.selfSlot),slots:this.peers.map(peer=>[peer.slot,peer.id===this.session.selfId]),states:[...this.endpoints.values()].map(ep=>ep.pc.signalingState)});if(window.qaVideoSourceLog.length>80)window.qaVideoSourceLog.shift();const result=method.apply(this,args);if(name==='offer')return result.then(value=>{window.qaVideoSourceLog.push({name:'offer-resolved',source:this.videoSource(this.selfSlot)});return value;},error=>{window.qaVideoSourceLog.push({name:'offer-failed',error:error.message});throw error;});return result;};
    }
  });
  const Peer=window.RTCPeerConnection;
  window.RTCPeerConnection=class extends Peer{constructor(options){super({...options,iceServers:[]});window.qaConnections.push(this);}setConfiguration(options){super.setConfiguration({...options,iceServers:[]});}};
  const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices),enumerate=navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
  navigator.mediaDevices.enumerateDevices=async()=>{const devices=await enumerate();return window.qaNoCamera?devices.filter(device=>device.kind!=='videoinput'):devices;};
  navigator.mediaDevices.getUserMedia=async options=>{
    window.qaMediaRequests.push(options);
    if(options.video&&window.qaCameraFault)throw new DOMException('Injected device failure',window.qaCameraFault);
    const stream=await capture(options);
    if(options.video)window.qaCameraTracks.push(...stream.getVideoTracks());
    return stream;
  };
  navigator.mediaDevices.getDisplayMedia=async()=>{
    const canvas=document.createElement('canvas');canvas.width=480;canvas.height=270;
    const ctx=canvas.getContext('2d');let n=0;
    const paint=()=>{ctx.fillStyle='#253c55';ctx.fillRect(0,0,480,270);ctx.fillStyle='#6fffd1';ctx.fillRect(n++*8%400,60,60,60);};
    paint();const stream=canvas.captureStream(15),timer=setInterval(paint,70),track=stream.getVideoTracks()[0],stop=track.stop.bind(track);
    track.stop=()=>{clearInterval(timer);stop();};return stream;
  };
}
async function frames(page){
  let prior;
  for(let i=0;i<100;i++){
    const row=await page.evaluate(async()=>{
      for(const pc of window.qaConnections){if(pc.connectionState!=='connected')continue;
        const stats=await pc.getStats(),video=[...stats.values()].find(row=>row.type==='inbound-rtp'&&row.kind==='video'&&row.framesDecoded>2);
        if(video)return{bytes:video.bytesReceived,frames:video.framesDecoded,width:video.frameWidth,height:video.frameHeight};
      }return null;
    });
    if(row&&prior&&row.bytes>prior.bytes&&row.frames>prior.frames)return{before:prior,after:row};
    if(row)prior=row;await new Promise(resolve=>setTimeout(resolve,200));
  }throw Error('Camera did not reach decoded remote frames: '+JSON.stringify(prior));
}
async function audioFrames(page,mid){
  let before;
  for(let i=0;i<100;i++){
    const after=await page.evaluate(async mid=>{for(const pc of window.qaConnections){if(pc.connectionState!=='connected')continue;const stats=await pc.getStats();const row=[...stats.values()].find(row=>row.type==='inbound-rtp'&&row.kind==='audio'&&row.mid===mid);if(row)return{bytes:row.bytesReceived,seconds:row.totalSamplesDuration};}return null;},mid);
    if(before&&after&&after.bytes>before.bytes&&after.seconds>before.seconds)return{before,after};
    if(after)before=after;await new Promise(resolve=>setTimeout(resolve,200));
  }throw Error('No decoded voice with camera: '+JSON.stringify(before));
}
async function association(page,slot,camera){
  const read=()=>page.evaluate(slot=>{
    const pc=window.qaConnections.findLast(pc=>pc.connectionState==='connected');
    if(!pc?.localDescription)return null;
    const sections=pc.localDescription.sdp.split(/\r?\nm=/);
    const stream=mid=>sections.find(section=>new RegExp('(?:^|\\r?\\n)a=mid:'+mid+'(?:\\r?\\n|$)').test(section))?.match(/(?:^|\r?\n)a=msid:([^\s]+)/)?.[1]||null;
    return {voice:stream(slot*3),video:stream(slot*3+1),system:stream(slot*3+2)};
  },slot);
  let value;
  for(let i=0;i<100;i++){
    value=await read();
    if(value?.voice&&value.video&&(camera?value.voice===value.video&&value.video!==value.system:value.voice!==value.video))return value;
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  const details=await page.evaluate(async slot=>{const room=window.qaRoom,pc=window.qaConnections.findLast(pc=>pc.connectionState==='connected');const fresh=await pc.createOffer();return{kind:room.videoSource(slot),groups:{voice:room.senderStreams(slot,'voice')[0].id,video:room.senderStreams(slot,'screen')[0].id,system:room.senderStreams(slot,'system')[0].id},fresh: fresh.sdp.split(/\r?\nm=/).slice(1,4).map(section=>section.match(/a=msid:([^\s]+)/)?.[1]),log:window.qaVideoSourceLog};},slot);
  throw Error('Wrong SDP camera/voice association '+JSON.stringify({camera,value,details}));
}
async function preview(client){
  await client.app.evaluate(()=>{globalThis.qaCameraAllow=true;});
  await client.page.click('#cameraBtn');await client.page.click('#previewCameraBtn');
  await client.page.waitForFunction(()=>document.querySelector('#cameraPreviewVideo').videoWidth>0);
  assert.equal(await client.page.locator('#startShare').isEnabled(),true);
}
async function run({a,b,open,create}){
  const evidence={result:'PASS',scope:'three actual Electron clients, private loopback DHT, fake Chromium cameras/microphones; native consent answers/visible state and screen source substituted',limitations:['Physical webcam devices and real two-PC lip synchronization are not tested.','Missing/busy cameras, window hide and control-network loss are injected; device acquisition, release, WebRTC bytes and decoded frames are real Chromium operations.'],checks:[],frames:{}};
  const check=name=>{evidence.checks.push(name);console.log('PASS',name);};
  const out=process.env.LINK_VISUAL_DIR||path.resolve(__dirname,'../out/qa');await fs.mkdir(out,{recursive:true});
  async function capture(client,name){await client.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const png=await client.app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true})).toPNG().toString('base64'));await fs.writeFile(path.join(out,name+'.png'),Buffer.from(png,'base64'));}
  for(const client of [a,b])if(await client.page.locator('#welcomeSkip').isVisible())await client.page.click('#welcomeSkip');
  await a.page.click('#dmCall');await b.page.click('#peerAccept');await count(a.page,2);await count(b.page,2);
  for(const client of [a,b])if(await client.page.locator('#micBtn').getAttribute('aria-pressed')==='true')await client.page.click('#micBtn');
  if(process.env.LINK_QA_CAMERA_ASSOCIATION_ONLY==='1'){
    await preview(a);await a.page.click('#startShare');await frames(b.page);
    await preview(b);await b.page.click('#startShare');await frames(a.page);
    console.log('Camera SDP before microphone',await association(a.page,0,true),await association(b.page,1,true));
    for(const client of [a,b])await client.page.click('#micBtn');
    await audioFrames(b.page,'0');await audioFrames(a.page,'3');
    console.log('Camera SDP after microphone',await association(a.page,0,true),await association(b.page,1,true));return;
  }
  // The native permission boundary also rejects a direct renderer request.
  const unauthorized=await a.page.evaluate(async()=>{try{const s=await navigator.mediaDevices.getUserMedia({video:true,audio:false});s.getTracks().forEach(t=>t.stop());return false;}catch{return true;}});
  assert(unauthorized,'camera without an explicit preview grant must be denied');check('camera request without local grant denied');
  await a.app.evaluate(()=>{globalThis.qaCameraAllow=true;});
  const microphoneDenied=await a.page.evaluate(async()=>{
    const requestId=crypto.randomUUID();if(!await window.craftlink.liveCamera({action:'ask',requestId}))return false;
    try{const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});stream.getTracks().forEach(track=>track.stop());return false;}
    catch{return true;}finally{await window.craftlink.liveCamera({action:'cancel',requestId});}
  });assert(microphoneDenied);await a.app.evaluate(()=>{globalThis.qaCameraAllow=false;});check('camera-only grant cannot enable microphone together with video');
  await a.page.click('#cameraBtn');await a.page.click('#previewCameraBtn');
  await a.page.waitForFunction(()=>!document.querySelector('#previewCameraBtn').disabled);
  assert.equal(await a.page.locator('#startShare').isEnabled(),false);assert.equal(await a.page.locator('#cameraPreviewVideo').evaluate(video=>!!video.srcObject),false);
  await a.page.click('#closeSourceDialog');check('dismissed native consent does not start camera or publish video');
  await preview(a);await a.page.click('#closeSourceDialog');
  await a.page.waitForFunction(()=>window.qaCameraTracks.every(track=>track.readyState==='ended'));check('closing preview releases actual fake-device track');
  await preview(a);await a.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].emit('hide'));
  await a.page.waitForFunction(()=>window.qaCameraTracks.every(track=>track.readyState==='ended'));
  await a.page.click('#closeSourceDialog');check('native window-hidden event releases preview device track');
  await a.page.evaluate(()=>{window.qaCameraFault='NotReadableError';});await a.page.click('#cameraBtn');await a.page.click('#previewCameraBtn');
  await a.page.locator('#cameraPreviewError').filter({hasText:'занята'}).waitFor();assert.equal(await a.page.locator('#startShare').isEnabled(),false);
  await a.page.click('#closeSourceDialog');await a.page.evaluate(()=>{window.qaCameraFault='';window.qaNoCamera=true;});
  await a.page.click('#cameraBtn');await a.page.waitForFunction(()=>document.querySelector('#cameraDevice').options.length===0);
  assert.equal(await a.page.locator('#previewCameraBtn').isEnabled(),false);await a.page.click('#closeSourceDialog');
  await a.page.evaluate(()=>{window.qaNoCamera=false;});check('busy/missing camera shows recovery and cannot publish');
  await preview(a);await capture(a,'0714-camera-picker-ru');await a.page.setViewportSize({width:800,height:600});await capture(a,'0714-camera-picker-ru-800');await a.page.setViewportSize({width:1440,height:900});
  await a.page.click('#startShare');await a.page.locator('#sourceDialog').waitFor({state:'hidden'});
  evidence.frames.aToB=await frames(b.page);
  await preview(b);await b.page.click('#startShare');await b.page.locator('#sourceDialog').waitFor({state:'hidden'});
  evidence.frames.bToA=await frames(a.page);check('both camera directions deliver increasing received bytes and decoded frames');
  for(const client of [a,b]){
    await client.page.locator('#callPip').waitFor();
    assert.equal(await client.page.locator('#callPip .call-pip-label').textContent(),'Вы');
    assert.equal(await client.page.locator('#micBtn').getAttribute('aria-pressed'),'false');
    assert(await client.page.evaluate(()=>window.qaMediaRequests.filter(options=>options.video&&typeof options.video==='object').every(options=>options.audio===false)));
  }check('remote video main, self PiP, neither microphone nor system audio enabled by camera');
  for(const client of [a,b])await client.page.click('#micBtn');
  evidence.voiceAToB=await audioFrames(b.page,'0');evidence.voiceBToA=await audioFrames(a.page,'3');
  evidence.cameraAssociation={a:await association(a.page,0,true),b:await association(b.page,1,true)};
  check('explicit microphone enable delivers decoded voice while cameras continue');
  for(const client of [a,b])await client.page.click('#micBtn');
  await a.page.click('#callPip');assert.equal(await a.page.locator('#callPip .call-pip-label').textContent(),'Борис');
  await a.page.locator('#callPip').focus();await a.page.keyboard.press('Enter');assert.equal(await a.page.locator('#callPip .call-pip-label').textContent(),'Вы');
  const pip=await a.page.locator('#callPip').boundingBox(),stage=await a.page.locator('#streamStage').boundingBox();
  await a.page.mouse.move(pip.x+pip.width/2,pip.y+pip.height/2);await a.page.mouse.down();await a.page.mouse.move(stage.x-80,stage.y+stage.height+60,{steps:15});await a.page.mouse.up();
  assert.equal(await a.page.locator('#callPip .call-pip-label').textContent(),'Вы','drag must not swap');
  await a.page.setViewportSize({width:800,height:600});
  await a.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const bounds=await a.page.evaluate(()=>{const p=document.querySelector('#callPip').getBoundingClientRect(),s=document.querySelector('#streamStage').getBoundingClientRect();return {px:p.x,py:p.y,right:p.right,bottom:p.bottom,x:s.x,y:s.y,sright:s.right,sbottom:s.bottom};});
  assert(bounds.px>=bounds.x&&bounds.py>=bounds.y&&bounds.right<=bounds.sright+1&&bounds.bottom<=bounds.sbottom+1,JSON.stringify(bounds));
  await a.page.locator('#callPip').focus();await a.page.keyboard.press('Home');
  await a.page.waitForFunction(()=>{const position=JSON.parse(localStorage.getItem('craftlink.call-pip.v1'));return position.side==='right'&&position.y===0;});
  const home=await a.page.evaluate(()=>{const pip=document.querySelector('#callPip'),stage=document.querySelector('#streamStage');return{x:pip.offsetLeft,y:pip.offsetTop,right:stage.clientWidth-pip.offsetLeft-pip.offsetWidth};});
  assert(home.y<=10&&home.right<=10,JSON.stringify(home));
  check('click and keyboard swap, drag snapping and resized PiP remain inside stage');
  await capture(a,'0714-camera-call-800');await a.page.setViewportSize({width:1440,height:900});
  await capture(a,'0714-camera-call');
  const c=await open('vera');await create(c,'Вера');await addFriend(a,c,'Вера');
  await a.page.locator('#workspaceContacts .contact-card').filter({has:a.page.getByText('Вера',{exact:true})}).getByRole('button',{name:'Пригласить',exact:true}).click();
  await c.page.click('#peerAccept');await count(a.page,3);await count(b.page,3);await count(c.page,3);
  assert.equal(await a.page.locator('#callPip').isVisible(),false);
  await a.page.click('#navRoom');assert.equal(await a.page.locator('#voiceGrid .voice-tile').count(),3);
  evidence.frames.thirdParticipant=await frames(c.page);
  await c.page.click('#leaveBtn');await count(a.page,2);await a.page.locator('#callPip').waitFor();
  check('third participant uses existing group cards/focus and receives decoded video; PiP returns when two remain');
  await a.page.click('#shareBtn');await a.page.locator('#sourcesGrid button').first().click();
  if(await a.page.locator('#withSystemAudio').isEnabled())await a.page.uncheck('#withSystemAudio');
  await a.page.click('#startShare');await a.page.locator('#sourceDialog').waitFor({state:'hidden'});
  assert(await a.page.evaluate(()=>window.qaCameraTracks.every(track=>track.readyState==='ended')));
  evidence.frames.screenToB=await frames(b.page);check('camera to screen releases camera and continues decoded video');
  evidence.screenAssociation=await association(a.page,0,false);
  await b.page.locator('#watchBufferBox').waitFor();await b.page.selectOption('#watchBuffer','1000');
  await preview(a);await a.page.click('#startShare');evidence.frames.cameraAgain=await frames(b.page);
  await b.page.locator('#watchBufferBox').waitFor({state:'hidden'});check('camera disables the previous one-second screen buffer');
  await a.page.click('#cameraBtn');assert(await a.page.evaluate(()=>window.qaCameraTracks.every(track=>track.readyState==='ended')));check('screen to camera and explicit camera off release capture');
  await a.page.click('#roomOptionsBtn');await a.page.check('#roomModerated');await a.page.keyboard.press('Escape');
  await b.page.waitForFunction(()=>document.querySelector('#cameraBtn').disabled);
  assert(await b.page.evaluate(()=>window.qaCameraTracks.every(track=>track.readyState==='ended')));check('host role revocation stops guest camera');
  await a.page.click('#leaveBtn');if(await a.page.locator('#confirmYesBtn').isVisible())await a.page.click('#confirmYesBtn');
  await b.page.locator('#leaveBtn').waitFor({state:'hidden'});
  assert(await b.page.evaluate(()=>window.qaCameraTracks.every(track=>track.readyState==='ended')));check('room closure releases device tracks');
  const denied=await a.page.evaluate(async()=>{try{await window.craftlink.liveCamera({action:'ask',requestId:crypto.randomUUID()});return false;}catch{return true;}});
  assert(denied);check('camera consent cannot be requested outside a room');
  await a.page.evaluate(async()=>{localStorage.setItem('craftcode.language','en');await window.craftlink.setLanguage('en');});await a.page.reload();await a.page.waitForFunction(()=>!!document.querySelector('#bookQuery')?.oninput);await a.page.waitForLoadState('load');
  await a.page.click('#navFriends');await a.page.locator('#workspaceContacts .contact-card').filter({has:a.page.getByText('Борис',{exact:true})}).locator('.open-person-chat').click();
  await a.page.click('#dmCall');await b.page.click('#peerAccept');await count(a.page,2);await count(b.page,2);
  await preview(a);assert.equal(await a.page.locator('#startShare').textContent(),'Turn video on');
  await capture(a,'0714-camera-picker-en');await a.page.setViewportSize({width:800,height:600});await capture(a,'0714-camera-picker-en-800');await a.page.setViewportSize({width:1440,height:900});
  await a.page.click('#startShare');await preview(b);await b.page.click('#startShare');await a.page.locator('#callPip').waitFor();
  await frames(a.page);await capture(a,'0714-camera-call-en');await a.page.setViewportSize({width:800,height:600});await capture(a,'0714-camera-call-en-800');
  check('Russian and English camera picker/call screens captured at 1440 and 800 widths');
  await a.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('craftlink:event',{type:'network-reconnecting'}));
  await a.page.waitForFunction(()=>window.qaCameraTracks.every(track=>track.readyState==='ended')&&document.querySelector('#cameraBtn').disabled);
  check('simulated control-connection loss releases camera and disables publishing');
  await a.page.click('#leaveBtn');if(await a.page.locator('#confirmYesBtn').isVisible())await a.page.click('#confirmYesBtn');
  await fs.writeFile(path.join(out,'0714-live-camera.json'),JSON.stringify(evidence,null,2));
}
module.exports={instrument,run};
