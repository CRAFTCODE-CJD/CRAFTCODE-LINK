const {clickPath}=require('./qa-navigation.cjs');
'use strict';
const {roomMix}=require('./participant-controls.cjs');
// Two real Electron clients and WebRTC. Only Windows enumeration / audio device and
// the physical desktop are substituted; no provider accounts or devices are used.
const path=require('node:path'),assert=require('node:assert/strict'),net=require('node:net');
const {_electron}=require(require.resolve('playwright',{paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||__dirname]}));
const microphone=require('./mic-signal.cjs');
const apps=[],errors=[];
const report=text=>console.log('PASS '+text);
async function launch(name){
  const app=await _electron.launch({executablePath:require('electron'),args:['--headless','--ozone-platform=headless','--no-sandbox','--allow-loopback-in-peer-connection','--use-fake-device-for-media-stream',path.join(__dirname,'..'),'--craftlink-profile=echo-'+Date.now()+'-'+name]});
  apps.push(app);
  const p=await app.firstWindow();p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));
  return {app,p};
}
(async()=>{
  const {app,p:host}=await launch('host'),{p:guest}=await launch('guest');
  await app.evaluate(({ipcMain,desktopCapturer})=>{
    const os=process.getBuiltinModule('os');os.platform=()=> 'win32';os.release=()=> '10.0.19045';
    desktopCapturer.getSources=async()=>[{id:'screen:1:0',name:'QA screen'},{id:'window:2:0',name:'QA game'}];
    let phase=0,active=null;
    global.qaAudio={fail:false,reads:0,stops:0,active:false};
    ipcMain.removeHandler('craftlink:stream-audio');
    ipcMain.handle('craftlink:stream-audio',async(_e,{op,token})=>{
      if(op==='stop'){if(active===token){active=null;global.qaAudio.active=false;global.qaAudio.stops++;}return;}
      if(global.qaAudio.fail)throw Error('simulated device lost');
      if(op==='start'){active=token;global.qaAudio.active=true;return true;}
      if(active!==token)throw Error('invalid token');
      await new Promise(resolve=>setTimeout(resolve,8));
      const data=new Int16Array(960*2);
      for(let f=0;f<960;f++)data[f*2]=data[f*2+1]=Math.round(4400*Math.sin(2*Math.PI*751*(phase++)/48000));
      global.qaAudio.reads++;
      return new Uint8Array(data.buffer);
    });
  });
  await host.reload();await host.click('#entryLater');await guest.click('#entryLater');
  await host.evaluate(()=>{
    window.qaRaw=[];
    window.qaTone=new AudioContext({sampleRate:48000});
    navigator.mediaDevices.getDisplayMedia=async options=>{
      if(options.audio!==false || options.systemAudio!=='exclude')throw Error('Unfiltered audio requested');
      const canvas=document.createElement('canvas');canvas.width=240;canvas.height=160;
      const ctx=canvas.getContext('2d');ctx.fillRect(0,0,240,160);const stream=canvas.captureStream(12);
      let n=0;const timer=setInterval(()=>{if(stream.getVideoTracks()[0].readyState==='ended'){clearInterval(timer);return;}ctx.fillStyle=n++%2?'red':'blue';ctx.fillRect(0,0,240,160);},70);
      const tone=qaTone.createOscillator(),out=qaTone.createMediaStreamDestination();tone.frequency.value=1423;tone.connect(out);tone.start();await qaTone.resume();
      const decoy=out.stream.getAudioTracks()[0];window.qaRaw.push(decoy);stream.addTrack(decoy);return stream;
    };
  });
  await guest.evaluate(()=>{
    const Base=RTCPeerConnection;
    window.RTCPeerConnection=class extends Base{
      constructor(...args){super(...args);this.addEventListener('track',e=>{
        if(this.getTransceivers().indexOf(e.transceiver)!==2)return;
        const ctx=window.qaContext=new AudioContext({sampleRate:48000});
        const source=ctx.createMediaStreamSource(new MediaStream([e.track]));const fft=ctx.createAnalyser();fft.fftSize=4096;fft.smoothingTimeConstant=0;source.connect(fft);
        window.qaLevel=()=>{const v=new Float32Array(fft.frequencyBinCount);fft.getFloatFrequencyData(v);
          return [751,1423].map(hz=>{const k=Math.round(hz*fft.fftSize/ctx.sampleRate);return Math.max(...v.slice(k-2,k+3));});};
        ctx.resume();
      });}
    };
  });
  await microphone.instrument(host, 503);
  await microphone.instrument(guest, 1103);
  const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  await clickPath(host,'#createBtn');await host.click('#hubManual');await host.fill('#nameInput','Owner');await host.fill('#addressInput','127.0.0.1');await host.fill('#portInput',String(port));await host.click('#roomSubmitBtn');
  const invite=await host.locator('#inviteOutput').inputValue();await host.click('#inviteDoneBtn');
  await clickPath(guest,'#joinBtn');await guest.fill('#hubCode',invite || await host.locator('#inviteOutput').inputValue());await guest.click('#hubEnter');await guest.fill('#nameInput','Friend');await guest.click('#roomSubmitBtn');
  await guest.waitForFunction(()=>document.querySelector('#statusText').textContent==='На связи');
  async function share(tab,sound){
    await host.click('#shareBtn');await host.click(tab);
    await host.locator('#withSystemAudio').setChecked(sound);
    await host.locator('.source-card').first().click();await host.click('#startShare');
    await host.waitForFunction(()=>!document.querySelector('#sourceDialog').open);
    assert(await host.evaluate(()=>qaRaw.every(t=>t.readyState==='ended')));
  }
  const levels=()=>guest.waitForFunction(()=>{const v=window.qaLevel?.();return v&&v[0]>-45&&v[0]-v[1]>30?v:false;},null,{timeout:16000}).then(h=>h.jsonValue());
  await share('#screenTabBtn',true);
  assert.equal(await host.textContent('#broadcastStatus'),'Ваш показ · со звуком');
  const first=await levels();report('Receiver measures game tone over real RTP and rejects the injected display-loopback tone: '+JSON.stringify(first));
  await roomMix(host,0);
  await microphone.verify(host, guest);
  await host.locator('#playerVolume').focus();await host.keyboard.press('Home');
  await roomMix(host,0);assert.equal(await host.inputValue('#own-system'),'0');
  await guest.waitForFunction(()=>window.qaLevel?.()[0]<-70);
  assert.equal(await host.inputValue('#own-voice'),'100');
  await host.click('#settingsBtn');await host.click('[data-pane="stream"]');
  assert.equal(await host.inputValue('#streamGain'),'0');
  await host.locator('#streamGain').focus();await host.keyboard.press('End');
  await host.click('#closeSettingsDialog');
  await guest.waitForFunction(min=>window.qaLevel?.()[0]>min,first[0]+3);
  assert.equal(await host.inputValue('#own-system'),'200');
  assert.equal(await host.inputValue('#playerVolume'),'200');
  await guest.focus('#playerVolume');await guest.keyboard.press('Home');
  await roomMix(guest,0);assert.equal(await guest.inputValue('#menu-mix-0-system'),'0');
  assert.equal(await host.inputValue('#own-system'),'200');
  await guest.focus('#playerVolume');await guest.keyboard.press('End');
  report('Outgoing stream gain 0/200 independently silences and boosts received RTP; settings and call mixer stay in sync');
  await share('#windowTabBtn',true);await levels();
  assert.equal(await host.getAttribute('#micBtn','aria-pressed'),'false');report('Changing screen to window retains protection and microphone stays off');
  await app.evaluate(()=>{global.qaAudio.fail=true;});
  await host.waitForFunction(()=>document.querySelector('#broadcastStatus').textContent.includes('недоступен'));
  await guest.waitForFunction(()=>window.qaLevel?.()[0]<-70);
  assert.equal(await host.locator('#stopShareBtn').isVisible(),true);
  await share('#screenTabBtn',true);assert((await host.textContent('#broadcastStatus')).includes('недоступен'));
  assert.equal(await app.evaluate(()=>global.qaAudio.active),false);report('Runtime loss and failed reopen keep video-only; no unsafe fallback or residual tone');
  await app.evaluate(()=>{global.qaAudio.fail=false;});await share('#windowTabBtn',true);await levels();
  await host.click('#stopShareBtn');await guest.waitForFunction(()=>window.qaLevel?.()[0]<-70);
  assert.equal(await app.evaluate(()=>global.qaAudio.active),false);
  await share('#screenTabBtn',false);assert.equal(await app.evaluate(()=>global.qaAudio.active),false);report('Stop, recovery and explicit video-only selection release the protected audio stream');
  await host.click('#stopShareBtn');
  await host.click('#micBtn');await guest.click('#micBtn');
  await guest.waitForFunction(()=>qaMix()[0]>-60 && qaMix()[1]<-75 && qaMix()[2]<-75);
  await host.waitForFunction(()=>qaMix()[2]>-60 && qaMix()[0]<-75);
  await microphone.loudVoice(host, guest);
  report('Voice-only call: both peers hear the other tone and no own digital return');
  await host.click('#leaveBtn');await host.click('#confirmYesBtn');assert.deepEqual(errors,[]);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{for(const app of apps)await app.close().catch(()=>{});});
