'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {roomMix,roomChat,closeRoomMenu}=require('./participant-controls.cjs');

// Supply a chosen test image at the capture boundary; both senders, receivers,
// codecs and the room/stream controls run in the production renderer.
module.exports=async function roomStreamView(host,guest,language,tr){
  for(const page of [guest,host]){
    await page.evaluate(()=>{
      window.qaScreenCapture=true;
      // Feed controlled audio through the actual microphone, codec and remote mixer.
      navigator.mediaDevices.getUserMedia=async()=>{
        const context=new AudioContext(),tone=context.createOscillator(),gain=context.createGain();
        const output=context.createMediaStreamDestination();
        tone.frequency.value=390;gain.gain.value=0;tone.connect(gain).connect(output);tone.start();
        await context.resume();window.qaTalk=enabled=>{gain.gain.value=enabled ? 0.15 : 0;};
        return output.stream;
      };
      const Native=RTCPeerConnection;
      const connections=[];
      window.RTCPeerConnection=class extends Native{constructor(...args){super(...args);connections.push(this);}};
      window.receivedScreen=async()=>{
        const reports=await Promise.all(connections.map(pc=>pc.getStats()));
        return reports.flatMap(report=>Array.from(report.values())).filter(r=>r.type==='inbound-rtp'&&r.kind==='video')
          .reduce((sum,r)=>({bytes:sum.bytes+(r.bytesReceived||0),frames:sum.frames+(r.framesDecoded||0)}),{bytes:0,frames:0});
      };
      window.craftlink.sources=async()=>[{id:'screen:qa',type:'screen',name:'LINK QA'}];
      window.craftlink.selectSource=async()=>({token:'qa'});
      navigator.mediaDevices.getDisplayMedia=async()=>{
        const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
        const ctx=canvas.getContext('2d');
        let frame=0;
        const draw=()=>{
          const gradient=ctx.createLinearGradient(0,0,canvas.width,canvas.height);
          gradient.addColorStop(0,'#123a55');gradient.addColorStop(1,'#122335');
          ctx.fillStyle=gradient;ctx.fillRect(0,0,640,360);
          ctx.fillStyle='#91dbc4';ctx.font='600 20px sans-serif';ctx.fillText('CRAFTCODE LINK',32,55);
          ctx.font='32px monospace';ctx.fillStyle='#eef7f7';ctx.fillText(String(frame++).padStart(5,'0'),32,115);
          for(let x=0;x<640;x+=8){
            const y=260+36*Math.sin(x/52+frame/10);
            ctx.fillStyle=x%40?'#56b7aa':'#b4f6cb';ctx.fillRect(x,y,4,10);
          }
        };
        draw();const stream=canvas.captureStream(20);
        const timer=setInterval(()=>{if(stream.getVideoTracks()[0].readyState==='ended')clearInterval(timer);else draw();},50);
        return stream;
      };
    });
  }
  async function share(page){
    await page.click('#shareBtn');await page.click('#sourcesGrid .source-card');await page.click('#startShare');
    await page.waitForFunction(()=>!document.querySelector('#sourceDialog').open);
  }
  await host.click('#linkHost');await guest.evaluate(()=>roomFixture.enter());
  for(const page of [guest,host])await page.evaluate(()=>roomFixture.roster());
  await share(guest);
  await host.waitForFunction(()=>document.querySelector('#remoteVideo').videoWidth>0);
  await host.locator('.voice-tile[data-slot="1"] canvas').waitFor();
  const speakers=host.locator('#streamSpeakers li');
  const thumb=host.locator('.voice-tile[data-slot="1"]');
  for(const page of [host,guest]){
    if(await page.locator('#micBtn').getAttribute('aria-pressed')!=='true')await page.click('#micBtn');
  }
  await host.bringToFront();await host.click('#fullscreenBtn');await host.waitForFunction(()=>document.fullscreenElement?.id==='streamStage');
  assert.equal(await speakers.count(),0);
  await guest.evaluate(()=>qaTalk(true));
  await speakers.filter({hasText:'Борис'}).waitFor();
  await host.evaluate(()=>qaTalk(true));await host.waitForFunction(()=>document.querySelectorAll('#streamSpeakers li').length===2);
  assert.equal(await speakers.first().evaluate(el=>getComputedStyle(el).pointerEvents),'none');
  if(process.env.LINK_UI_QA_IMAGES){
    await fs.mkdir(process.env.LINK_UI_QA_IMAGES,{recursive:true});
    await host.screenshot({path:path.join(process.env.LINK_UI_QA_IMAGES,'fullscreen-speakers-'+language+'.png')});
  }
  await guest.evaluate(()=>qaTalk(false));await speakers.filter({hasText:'Борис'}).waitFor({state:'detached'});
  assert.equal(await speakers.count(),1);
  await guest.evaluate(()=>qaTalk(true));await speakers.filter({hasText:'Борис'}).waitFor();
  await guest.click('#micBtn');await speakers.filter({hasText:'Борис'}).waitFor({state:'detached'});
  await host.focus('#exitPlayer');await host.keyboard.press('Enter');
  await host.waitForFunction(()=>!document.fullscreenElement&&!document.querySelector('#streamSpeakers li'));
  await thumb.waitFor();await host.click('#micBtn');
  console.log('PASS fullscreen speakers: silence, simultaneous local and decoded remote voice, mute and keyboard exit');
  await host.evaluate(()=>{
    const draw=CanvasRenderingContext2D.prototype.drawImage;
    window.qaThumbnailDraws=0;
    CanvasRenderingContext2D.prototype.drawImage=function(...args){
      if(this.canvas.classList.contains('tile-screen-image'))window.qaThumbnailDraws++;
      return draw.apply(this,args);
    };
  });
  await host.click('#navChats');await host.locator('#roomPage').waitFor({state:'hidden'});
  const beforeChat=await host.evaluate(()=>qaThumbnailDraws);
  await new Promise(resolve=>setTimeout(resolve,1800));
  assert.equal(await host.evaluate(()=>qaThumbnailDraws),beforeChat,'hidden filmstrip rendered while in personal chats');
  await host.click('#navRoom');await host.waitForFunction(before=>qaThumbnailDraws>before,beforeChat);
  const first=await host.evaluate(()=>receivedScreen());
  let last=first;
  const deadline=Date.now()+12000;
  while(Date.now()<deadline && (last.bytes<=first.bytes || last.frames<first.frames+4)){
    await new Promise(resolve=>setTimeout(resolve,250));
    last=await host.evaluate(()=>receivedScreen());
  }
  assert(last.bytes>first.bytes && last.frames>=first.frames+4,JSON.stringify({first,last}));
  assert.equal(await host.textContent('#stageTitle'),tr('Экран · ')+'Борис');
  assert.equal(await host.textContent('#stageBadge'),tr('В эфире'));
  assert.equal(await host.locator('.tile-watch:visible').count(),0);
  await host.setViewportSize({width:1426,height:933});await roomChat(host);
  await host.fill('#chatInput','Всё видно');await host.press('#chatInput','Enter');
  await guest.locator('#chatMessages').getByText('Всё видно',{exact:true}).waitFor();
  await roomMix(host,1);await host.focus('#menu-mix-1-system');await host.keyboard.press('Home');await host.keyboard.press('ArrowRight');
  assert.equal(await host.inputValue('#menu-mix-1-system'),'1');
  await closeRoomMenu(host);
  if(process.env.LINK_UI_QA_IMAGES){
    await fs.mkdir(process.env.LINK_UI_QA_IMAGES,{recursive:true});
    await host.locator('#toast').waitFor({state:'hidden'});
    await host.screenshot({path:path.join(process.env.LINK_UI_QA_IMAGES,'live-room-'+language+'.png')});
  }
  await share(host);
  await host.waitForFunction(()=>document.querySelectorAll('.tile-watch:not([hidden])').length===2);
  const remoteScreen=host.getByRole('button',{name:tr('Смотреть трансляцию ')+'Борис',exact:true});
  await remoteScreen.focus();await remoteScreen.press('Enter');
  assert.equal(await remoteScreen.getAttribute('aria-pressed'),'true');
  assert.equal(await host.textContent('#stageTitle'),tr('Экран · ')+'Борис');
  await host.click('#stopShareBtn');await guest.click('#stopShareBtn');
  await host.waitForFunction(()=>!document.querySelector('#stageEmpty').hidden||document.querySelector('#streamStage .voice-tile'));
  assert.equal(await host.locator('#roomFilmstrip').isVisible(),false);
  assert.equal(await host.locator('.tile-screen-image').count(),0);
  console.log('PASS room screen, filmstrip, keyboard switch, local mixer and chat',JSON.stringify({language,frames:last.frames-first.frames,bytes:last.bytes-first.bytes}));
};
