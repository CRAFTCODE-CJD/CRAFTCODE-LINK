'use strict';
const {roomMix,closeRoomMenu}=require('./participant-controls.cjs');
const path=require('node:path'),os=require('node:os'),fs=require('node:fs/promises');
const {EventEmitter}=require('node:events'),assert=require('node:assert/strict');
const {_electron}=require(require.resolve('playwright',{paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||__dirname]}));
const root=path.resolve(process.env.LINK_QA_APP_ROOT||path.join(__dirname,'..'));
const interfaces=[{name:'lo',family:4,address:'127.0.0.1',host:'127.0.0.1',internal:true}];
const udx=require('udx-native');
udx.prototype.networkInterfaces=()=>interfaces;
udx.prototype.watchNetworkInterfaces=()=>Object.assign(new EventEmitter(),{interfaces,destroy(){}});

async function checkTextContrast(page,container){
  const ratios=await page.locator(container).evaluate(root=>{
    const rgb=value=>value.match(/[\d.]+/g).map(Number);
    const luminance=values=>values.slice(0,3).map(v=>(v/=255)<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
    const ratio=el=>{
      let p=el,bg;
      while(p){bg=rgb(getComputedStyle(p).backgroundColor);if(bg[3]!==0)break;p=p.parentElement;}
      const a=luminance(rgb(getComputedStyle(el).color)),b=luminance(bg);
      return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    };
    return [...root.querySelectorAll('.link-chat-body,.link-chat-author,.link-chat-time,.link-chat-status,textarea,button[type=submit]:enabled')].filter(el=>el.offsetHeight>0).map(el=>[el.className||el.id,ratio(el)]);
  });
  assert(ratios.some(([key])=>key.includes('link-chat-body')));
  assert(ratios.some(([key])=>key==='dmSend'||key.includes('send-button')||key.includes('icon-button')));
  assert(ratios.every(([,n])=>n>=4.5),JSON.stringify(ratios));
  return Number(Math.min(...ratios.map(([,n])=>n)).toFixed(2));
}
async function receivedVoice(page){
  let previous,sample,available;
  for(let attempts=0;attempts<40;attempts++){
    const inbound=await page.evaluate(async()=>{
      const reports=await Promise.all(window.qaPeers.map(pc=>pc.getStats()));
      const transceiver=window.qaPeers.flatMap(pc=>pc.getTransceivers()).find(t=>t.mid==='0'&&t.receiver.track.kind==='audio');
      if(transceiver&&!window.qaReceiverMeter){
        const context=new AudioContext();await context.resume();
        const source=context.createMediaStreamSource(new MediaStream([transceiver.receiver.track])),analyser=context.createAnalyser(),mute=context.createGain();
        mute.gain.value=0;source.connect(analyser).connect(mute).connect(context.destination);
        window.qaReceiverMeter={analyser,context,samples:new Float32Array(analyser.fftSize)};
      }
      let rms=0;const meter=window.qaReceiverMeter;
      if(meter){meter.analyser.getFloatTimeDomainData(meter.samples);rms=Math.sqrt(meter.samples.reduce((a,n)=>a+n*n,0)/meter.samples.length);}
      return reports.flatMap(report=>[...report.values()]).filter(s=>s.type==='inbound-rtp' && s.mid==='0' && s.kind==='audio')
        .map(s=>({mid:s.mid,bytes:s.bytesReceived,seconds:s.totalSamplesDuration,rms}));
    });
    available=inbound;sample=inbound.find(s=>s.rms>.01 && s.bytes>0 && s.seconds>0);
    if(previous && sample && sample.bytes>previous.bytes && sample.seconds>previous.seconds)return [previous,sample];
    if(sample)previous=sample;
    await new Promise(r=>setTimeout(r,250));
  }
  throw Error('No increasing decoded microphone samples: '+JSON.stringify(available));
}
async function run(){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'link-appearance-ui-')),apps=new Set(),errors=[];
  const network=await require('hyperdht/testnet')(6);
  try{
    const launcher=path.join(temp,'launch.cjs');
    await fs.writeFile(launcher,`
      const {app,Notification,dialog,clipboard,desktopCapturer}=require('electron');
      dialog.showErrorBox=(title,message)=>console.error(title,message);
      Notification.isSupported=()=>false;desktopCapturer.getSources=async()=>[];
      clipboard.writeText=text=>globalThis.card=text;
      app.setPath('appData',process.env.LINK_APPEARANCE_DATA);
      app.on('browser-window-created',(_,win)=>{win.show=()=>{};win.showInactive=()=>{};});
      const load=require('node:module').createRequire(${JSON.stringify(path.join(root,'package.json'))});
      const udx=load('udx-native'),interfaces=${JSON.stringify(interfaces)};
      udx.prototype.networkInterfaces=()=>interfaces;
      udx.prototype.watchNetworkInterfaces=()=>Object.assign(new (require('node:events').EventEmitter)(),{interfaces,destroy(){}});
      const DHT=load('hyperdht'),{Networks}=load('./src/direct/networks.cjs'),publish=Networks.prototype.publishDht;
      Networks.prototype.publishDht=function(epoch){
        this.dhtFactory=()=>new DHT({bootstrap:${JSON.stringify(network.bootstrap)},host:process.env.LINK_APPEARANCE_IP,firewalled:false,ephemeral:true});
        return publish.call(this,epoch);
      };
      load('./src/entry.cjs');
    `);
    async function open(id,name,ip){
      const base=path.join(temp,id);await fs.mkdir(base);
      const app=await _electron.launch({executablePath:process.env.LINK_QA_ELECTRON||require('electron'),
        args:[launcher,'--mute-audio','--no-error-dialogs','--allow-loopback-in-peer-connection','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--craftlink-profile='+id],
        env:{...process.env,LINK_APPEARANCE_DATA:base,LINK_APPEARANCE_IP:ip,XDG_CONFIG_HOME:base}});
      apps.add(app);
      assert((await app.evaluate(({app})=>app.getPath('userData'))).startsWith(base+path.sep));
      const page=await app.firstWindow();page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));
      const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});
      await page.setViewportSize({width:1280,height:800});
      await page.addInitScript(()=>{
        const stored=JSON.parse(localStorage.getItem('craftlink.settings.v1')||'{}');
        localStorage.setItem('craftlink.settings.v1',JSON.stringify({...stored,publicStun:false,cueEnabled:false,systemNotices:false}));
        const Peer=window.RTCPeerConnection;window.qaPeers=[];
        window.RTCPeerConnection=class extends Peer{constructor(...args){super(...args);window.qaPeers.push(this);}};
        const connect=AudioNode.prototype.connect;
        AudioNode.prototype.connect=function(destination,...args){
          if(this instanceof WaveShaperNode && destination===this.context.destination){
            const tap=this.context.createAnalyser();connect.call(this,tap);
            window.qaPlaybackRms=()=>{
              const samples=new Float32Array(tap.fftSize);tap.getFloatTimeDomainData(samples);
              return Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length);
            };
          }
          return connect.call(this,destination,...args);
        };
        navigator.mediaDevices.getUserMedia=async()=>{
          const context=new AudioContext();await context.resume();
          const tone=context.createOscillator(),gain=context.createGain(),out=context.createMediaStreamDestination();
          gain.gain.value=.2;tone.frequency.value=420;tone.connect(gain).connect(out);tone.start();
          window.qaGain=gain;window.qaInput=out.stream.getAudioTracks()[0];return out.stream;
        };
      });
      await page.locator('#startDirect').waitFor();await page.reload();await page.click('#startDirect');await page.fill('#directName',name);await page.click('#directCreateForm button');
      await page.waitForFunction(()=>!document.querySelector('#directDialog').open && document.querySelector('#profileLabel').textContent!=='Войти');
      return {app,page};
    }
    const a=await open('qa-portrait-anna','Анна','127.0.0.2'),b=await open('qa-portrait-boris','Борис','127.0.0.3');
    await a.page.click('#profileBtn');
    const demoPhoto=path.join(root,'src/renderer/assets/craftlink.png');
    const crop=a.page.locator('#avatarCrop');
    await a.page.setInputFiles('#avatarFile',demoPhoto);
    await crop.waitFor();await a.page.keyboard.press('Escape');
    await crop.waitFor({state:'hidden'});assert.equal(await a.page.locator('#avatarPreview canvas').count(),0);
    await a.page.locator('#chooseAvatar:enabled').waitFor();
    await a.page.setInputFiles('#avatarFile',demoPhoto);await crop.waitFor();
    await a.page.locator('#avatarCropZoom').press('End');
    assert.equal(await a.page.locator('#avatarCropScale').textContent(),'300%');
    const preview=a.page.locator('#avatarCropPreview');
    const beforeMove=await preview.evaluate(el=>el.toDataURL());
    await preview.press('Shift+ArrowRight');
    assert.notEqual(await preview.evaluate(el=>el.toDataURL()),beforeMove);
    if(process.env.LINK_VISUAL_DIR){
      await fs.mkdir(process.env.LINK_VISUAL_DIR,{recursive:true});
      await a.page.screenshot({path:path.join(process.env.LINK_VISUAL_DIR,'photo-crop.png')});
    }
    await crop.locator('button[value=apply]').click();
    await a.page.locator('#avatarPreview canvas').waitFor();
    await a.page.check('#profileCoverChoices [value="lagoon"]');await a.page.fill('#profileAboutInput','Играем по вечерам');
    assert.equal(await a.page.locator('#profileAboutPreview').textContent(),'Играем по вечерам');
    assert.equal(await a.page.locator('#profileCoverPreview').getAttribute('data-cover'),'lagoon');
    await a.page.click('#saveProfileStyle');await a.page.waitForFunction(()=>document.querySelector('#saveProfileStyle').disabled&&!document.querySelector('#profileAboutInput').disabled);
    await a.page.selectOption('#profileTheme','dusk');await a.page.selectOption('#chatWallpaper','dots');await a.page.click('#closeSettingsDialog');
    await a.page.reload();await a.page.waitForFunction(()=>document.documentElement.dataset.theme==='dusk' && document.documentElement.dataset.wallpaper==='dots' && !!document.querySelector('#profileAvatar canvas'));
    assert.equal(await b.page.locator('html').getAttribute('data-theme'),'default');
    await b.page.click('#profileBtn');
    if(process.env.LINK_VISUAL_DIR){
      await fs.mkdir(process.env.LINK_VISUAL_DIR,{recursive:true});
      await b.page.check('#profileCoverChoices [value="twilight"]');await b.page.fill('#profileAboutInput','По выходным играем вместе');
      await b.page.locator('#avatarEditor').scrollIntoViewIfNeeded();
      // Capture the actual Electron compositor without showing either test window.
      const bytes=await b.app.evaluate(async({BrowserWindow})=>{
        const win=BrowserWindow.getAllWindows()[0];
        const image=await win.webContents.capturePage(undefined,{stayHidden:true});
        return image.toPNG().toString('base64');
      });
      assert(bytes.length>1000);
      await fs.writeFile(path.join(process.env.LINK_VISUAL_DIR,'profile-card-editor.png'),Buffer.from(bytes,'base64'));
    }
    await b.page.selectOption('#profileTheme','light');await b.page.click('#closeSettingsDialog');
    await a.page.click('#bookCopy');const card=await a.app.evaluate(()=>globalThis.card);
    const fields=JSON.parse(Buffer.from(card.slice(5),'base64url'));
    assert.deepEqual(Object.keys(fields).sort(),['cert','device','id','name','signature']);
    await b.page.click('#linkFriends');await b.page.fill('#directCode',card);await b.page.click('#sendCardRequest');
    await a.page.click('#navRequests');await a.page.locator('#inRequests').getByRole('button',{name:'Принять',exact:true}).click();
    await b.page.click('#navFriends');await b.page.locator('#workspaceContacts .contact-avatar canvas').waitFor();
    await b.page.locator('#workspaceContacts .open-person-chat').click();
    await b.page.locator('#dmAvatar canvas').waitFor();
    const avatarPixels=canvas=>canvas.toDataURL();
    assert.equal(await b.page.locator('#dmAvatar canvas').evaluate(avatarPixels),
      await a.page.locator('#profileAvatar canvas').evaluate(avatarPixels),'friend receives the selected crop');
    await a.page.click('#profileBtn');
    for(const [status,label] of [['away','Отошёл'],['busy','Занят'],['invisible','Не в сети'],['online','В сети']]){
      await a.page.selectOption('#directStatus',status);
      await b.page.waitForFunction(({status,label})=>{
        const presence=document.querySelector('#dmPresence');
        if(status==='invisible')return !presence.classList.contains('available') &&
          (presence.textContent===label||presence.textContent.startsWith('Был на связи · '));
        return presence.textContent===label;
      },{status,label});
    }
    console.log('PASS two desktop clients: Away, Busy, Invisible and Online propagate to the selected conversation.');
    await a.page.click('#closeSettingsDialog');
    await b.page.waitForFunction(()=>document.querySelector('#dmProfileCover').dataset.cover==='lagoon' && document.querySelector('#dmAboutText').textContent==='Играем по вечерам');
    await b.page.fill('#dmInput','Личное сообщение');await b.page.click('#dmSend');
    await a.page.click('#navChats');await a.page.locator('#dmList button').first().click();
    await a.page.fill('#dmInput','Ответ в чате');await a.page.click('#dmSend');await b.page.getByText('Ответ в чате',{exact:true}).last().waitFor();
    await b.page.fill('#dmInput','Черновик');
    const dmContrast=await checkTextContrast(b.page,'#dmConversation');
    await b.page.fill('#dmInput','');
    const shots=process.env.LINK_VISUAL_DIR;
    if(shots){await fs.mkdir(shots,{recursive:true});await b.page.screenshot({path:path.join(shots,'light-private-chat.png')});}
    await a.page.click('#profileBtn');await a.page.check('#profileCoverChoices [value="default"]');await a.page.fill('#profileAboutInput','');
    await a.page.click('#saveProfileStyle');await a.page.click('#closeSettingsDialog');
    await b.page.waitForFunction(()=>document.querySelector('#dmProfileCover').dataset.cover==='default' && document.querySelector('#dmAbout').hidden);
    console.log('PASS saved photo, live profile card preview, profile design delivery and clearing, independent theme / wallpaper after reload, public card excludes personal details.');
    if(process.env.LINK_QA_PROFILE_CARD==='1'){assert.deepEqual(errors,[]);return;}
    await a.page.click('#navFriends');await a.page.locator('#workspaceContacts').getByRole('button',{name:'Позвонить',exact:true}).click();
    await b.page.click('#peerAccept');
    const anna=p=>p.locator('.voice-tile').filter({hasText:'Анна'});
    const photo=e=>e.locator('.room-avatar canvas');
    await photo(anna(a.page)).waitFor();await photo(anna(b.page)).waitFor();
    assert.equal(await anna(b.page).getAttribute('class'),'voice-tile mic-off');
    await a.page.click('#micBtn');
    async function speaking(p,yes){await p.waitForFunction(yes=>[...document.querySelectorAll('.voice-tile')].some(t=>t.textContent.includes('Анна')&&t.classList.contains('is-speaking')===yes),yes);}
    await speaking(a.page,true);await speaking(b.page,true);
    const voiceBytes=await receivedVoice(b.page);
    const peerTile=anna(b.page), toggle=peerTile.locator('.tile-mute');
    await b.page.waitForFunction(()=>window.qaPlaybackRms?.()>.02);
    const playback={before:await b.page.evaluate(()=>qaPlaybackRms())};
    await peerTile.click({button:'right'});
    const menu=b.page.locator('#participantSoundMenu');
    await menu.getByText('Настройки сохраняются для этого друга').waitFor();
    const volume=menu.locator('input[data-role="voice"]');
    await volume.press('Home');await volume.press('ArrowRight');await volume.press('End');await volume.press('Home');
    await volume.evaluate(el=>{el.value='35';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
    await b.page.waitForFunction(previous=>{const rms=qaPlaybackRms();return rms>.001 && rms<previous*.5;},playback.before);
    playback.reduced=await b.page.evaluate(()=>qaPlaybackRms());
    const stored=()=>b.page.evaluate(async()=>(await window.craftlink.direct({op:'state'})).friends.find(f=>f.name==='Анна').mix);
    await b.page.waitForFunction(async()=>(await window.craftlink.direct({op:'state'})).friends.find(f=>f.name==='Анна').mix?.voice?.volume===35);
    if(shots)await b.page.screenshot({path:path.join(shots,'participant-context-menu.png')});
    await volume.press('Escape');await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'),'true');
    await b.page.waitForFunction(()=>qaPlaybackRms()<.00002);
    playback.muted=await b.page.evaluate(()=>qaPlaybackRms());
    assert.equal((await stored()).voice.muted,true);
    await speaking(a.page,true); // Muting for the listener leaves the sender's mic active.
    await peerTile.locator('.tile-sound-menu').press('Shift+F10');
    await menu.getByRole('button',{name:'Включить голос · Анна'}).click();
    assert.equal(await toggle.getAttribute('aria-pressed'),'false');
    await volume.press('Escape');await roomMix(b.page,0);
    assert.equal(await b.page.locator('#menu-mix-0-voice').inputValue(),'35');
    await closeRoomMenu(b.page);
    await a.page.evaluate(()=>window.qaGain.gain.value=0);await speaking(a.page,false);await speaking(b.page,false);
    await a.page.evaluate(()=>window.qaGain.gain.value=.18);await speaking(b.page,true);
    await b.page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await anna(b.page).locator('.room-avatar').evaluate(e=>getComputedStyle(e,'::after').transform),'none');
    await b.page.fill('#chatInput','Сообщение в комнате');await b.page.click('#sendChatBtn');
    await a.page.fill('#chatInput','Ответ в комнате');await a.page.click('#sendChatBtn');await b.page.locator('#chatMessages').getByText('Ответ в комнате',{exact:true}).waitFor();
    await b.page.fill('#chatInput','Черновик');
    const roomContrast=await checkTextContrast(b.page,'#roomChat');
    await b.page.fill('#chatInput','');
    if(shots){await b.page.screenshot({path:path.join(shots,'light-room-chat.png')});await a.page.screenshot({path:path.join(shots,'voice-room-portraits.png')});}
    await a.page.click('#micBtn');await speaking(a.page,false);await speaking(b.page,false);
    await a.page.click('#profileBtn');await a.page.click('#removeAvatar');await b.page.waitForFunction(()=>!document.querySelector('.voice-tile .profile-photo'));
    await a.page.click('#closeSettingsDialog');await a.page.click('#leaveBtn');await a.page.click('#confirmYesBtn');
    await b.page.waitForFunction(()=>document.querySelector('#voiceGrid').hidden&&!document.querySelector('.voice-tile'));
    await b.page.evaluate(()=>localStorage.setItem('craftcode.language','en'));await b.page.reload();await b.page.click('#profileBtn');
    assert.equal(await b.page.locator('#chooseAvatar').textContent(),'Choose photo');
    assert.equal(await b.page.locator('#profileTheme').inputValue(),'light');
    assert.equal(await b.page.locator('#profileTheme option[value="forest"]').textContent(),'Evergreen');
    assert.equal(await b.page.locator('#chatWallpaper option[value="mesh"]').textContent(),'Diagonal lines');
    assert.deepEqual(errors,[]);
    if(shots){
      const runtime=await a.app.evaluate(()=>({electron:process.versions.electron,chromium:process.versions.chrome,platform:process.platform,arch:process.arch}));
      const evidence={status:'PASS',finishedAt:new Date().toISOString(),scenario:'tests/profile-appearance-desktop.cjs',runtime,
        profiles:2,network:'private loopback DHT, TLS room and WebRTC',source:'synthetic oscillator, user microphone and loudspeakers unused',
        ui:['photo choose/remove, friends only, DM and both room windows','preferences persist across reload and remain local','measured voice, silence, mute, reduced motion and room exit','English labels'],
        inboundVoice:voiceBytes,listenerPlaybackRms:playback,minimumLightTextContrast:{directChat:dmContrast,roomChat:roomContrast},pageErrors:errors,
        screenshots:['light-private-chat.png','light-room-chat.png','voice-room-portraits.png','participant-context-menu.png']};
      await fs.writeFile(path.join(shots,'windows-two-clients.json'),JSON.stringify(evidence,null,2)+'\n');
    }
    console.log('PASS actual local and received WebRTC audio changed both indicators on speech / silence, mute, reduced motion, photo removal and room exit.',{voiceBytes,dmContrast,roomContrast});
  }finally{
    await Promise.allSettled([...apps].map(app=>app.close()));
    await network.destroy();await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:150});
  }
}
run().catch(e=>{console.error(e);process.exitCode=1;});
