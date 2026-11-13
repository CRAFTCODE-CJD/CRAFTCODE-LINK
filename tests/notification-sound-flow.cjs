'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');

module.exports=async function checkSounds(page,ids){
  await page.bringToFront();
  const capture=async name=>{
    const dir=process.env.LINK_UI_QA_IMAGES;
    if(!dir)return;
    await fs.mkdir(dir,{recursive:true});
    await page.screenshot({animations:'disabled',path:path.join(dir,name+'-'+(process.env.LINK_QA_LANG==='en'?'en':'ru')+'.png')});
  };
  await page.evaluate(async ([me,friend])=>{
    const original=craftlink.direct,play=HTMLMediaElement.prototype.play;
    const peer={id:friend,name:'Мила',state:'friend',online:true,devices:[],chat:{supported:true}};
    const sample=new Image();sample.src='assets/craftlink.png';await sample.decode();
    const bitmap=document.createElement('canvas');bitmap.width=bitmap.height=48;
    const ctx=bitmap.getContext('2d');ctx.fillStyle='#24433f';ctx.fillRect(0,0,48,48);ctx.drawImage(sample,0,0,48,48);
    const rgba=ctx.getImageData(0,0,48,48).data;
    peer.avatar=btoa(String.fromCharCode(...rgba.filter((_,i)=>i%4!==3)));
    const fixture=window.cues={played:[],incoming:null,outgoing:null,blocked:false};
    HTMLMediaElement.prototype.play=function(){
      const name=this.src.match(/\/assets\/(\w+)\.wav$/)?.[1];
      if(name)fixture.played.push(name);
      return play.call(this);
    };
    craftlink.direct=async request=>{
      if(request.op==='chat-history')return {messages:[],hasMore:false};
      if(request.op==='reject'){fixture.incoming=null;roomFixture.refresh();return;}
      if(request.op==='cancel'){fixture.outgoing=null;roomFixture.refresh();return;}
      if(request.op==='take'){fixture.incoming.taken=true;roomFixture.refresh();return;}
      const result=await original(request);
      if(request.op==='state'){
        result.friends=[peer];result.blocked=fixture.blocked?[{id:friend}]:[];
        result.incoming=fixture.incoming;result.outgoing=fixture.outgoing;
      }
      return result;
    };
    fixture.message=(extra={})=>roomFixture.emit({type:'direct-chat-updated',incoming:true,id:friend,profile:me,...extra});
    fixture.call=()=>{
      fixture.incoming={id:'call',peer:friend,key:crypto.randomUUID(),mode:'call',name:peer.name};
      roomFixture.refresh();
    };
    roomFixture.refresh();
  },ids);
  const person=page.locator('#quickPeople button').filter({hasText:'Мила'});
  await person.waitFor();
  await person.click();
  await page.locator('#dmTitle').filter({hasText:'Мила'}).waitFor();
  const played=()=>page.evaluate(()=>[...cues.played]);
  await page.evaluate(()=>cues.message());
  assert.deepEqual(await played(),[],'opened personal chat is quiet');
  // The native desktop harness independently verifies a hidden window.
  // Model the unfocused Electron window in headless Chrome, which focuses both tabs.
  await page.evaluate(()=>{
    Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false});
    try{cues.message();}finally{delete document.hasFocus;}
  });
  await page.waitForFunction(()=>cues.played.length===1);
  assert.deepEqual(await played(),['message'],'an unfocused open chat chimes');
  await page.waitForTimeout(1230);
  await page.evaluate(()=>{cues.played.length=0;});
  await page.click('#navFriends');
  await page.waitForSelector('#directoryPage');
  await page.evaluate(()=>{cues.message({incoming:false});cues.message({profile:'another-profile'});cues.message({id:'stranger'});});
  assert.deepEqual(await played(),[],'changes in history and mismatched identities are quiet');
  await page.evaluate(()=>{cues.message();cues.message();});
  await page.waitForFunction(()=>cues.played.includes('message'));
  assert.deepEqual(await played(),['message'],'one chime for a burst');

  await page.evaluate(friend=>{cues.outgoing={id:'out',peer:friend,name:'Мила'};roomFixture.refresh();},ids[1]);
  await page.waitForSelector('#peerCallDialog[open]');
  assert.equal(await page.locator('#peerAccept').isHidden(),true);
  assert.equal(await page.locator('#peerAvatar canvas').count(),1);
  assert.equal(await page.locator('#peerCallTitle').textContent(),process.env.LINK_QA_LANG==='en'?'Outgoing call':'Исходящий звонок');
  await capture('outgoing');await page.keyboard.press('Escape');
  await page.waitForSelector('#peerCallDialog',{state:'hidden'});
  await page.evaluate(()=>cues.call());
  await page.waitForSelector('#peerCallDialog[open]');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'peerCaller');
  const ripple=()=>page.locator('#peerCallDialog .call-portrait').evaluate(avatar=>getComputedStyle(avatar,'::before').animationName);
  assert.equal(await ripple(),'call-ripple');
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await ripple(),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>document.documentElement.classList.add('reduce-motion'));assert.equal(await ripple(),'none');
  await page.evaluate(()=>document.documentElement.classList.remove('reduce-motion'));
  await capture('incoming');
  const contrasts=await page.evaluate(()=>{
    const root=document.documentElement,dialog=document.querySelector('#peerCallDialog'),original=root.dataset.theme;
    const ctx=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
    function luminance(color){
      ctx.fillStyle=color;ctx.fillRect(0,0,1,1);
      const rgb=ctx.getImageData(0,0,1,1).data.slice(0,3);
      return Array.from(rgb,v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    }
    function ratio(a,b){a=luminance(a);b=luminance(b);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
    const results=[];
    root.classList.add('reduce-motion');
    try{
      for(const {value} of document.querySelectorAll('#profileTheme option')){
        root.dataset.theme=value;
        const bg=getComputedStyle(dialog).backgroundColor;
        const colors=['#peerCaller','#peerCallTitle','#peerAccept','#peerReject'].map(selector=>{
          const el=dialog.querySelector(selector),style=getComputedStyle(el);
          return ratio(style.color,el.tagName==='BUTTON'?style.backgroundColor:bg);
        });
        results.push([value,Math.min(...colors)]);
      }
    }finally{root.dataset.theme=original;root.classList.remove('reduce-motion');}
    return results;
  });
  for(const [theme,ratio] of contrasts)assert(ratio>=4.5,theme+' call text contrast: '+ratio);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'peerAccept');
  await page.waitForFunction(()=>cues.played.includes('ring'));
  await page.waitForFunction(()=>cues.played.filter(name=>name==='ring').length===2);
  await page.evaluate(()=>{cues.message();cues.blocked=true;roomFixture.refresh();});
  assert.deepEqual(await played(),['message','ring','ring']);
  await page.click('#peerReject');
  await page.waitForSelector('#peerCallDialog',{state:'hidden'});
  await page.evaluate(()=>cues.message());
  assert.deepEqual(await played(),['message','ring','ring'],'blocked contact remains silent after hangup');
  await page.evaluate(()=>{cues.blocked=false;roomFixture.refresh();});
  await page.click('#settingsBtn');await page.click('[data-pane="connection"]');
  await page.uncheck('#cueMessages');
  await page.evaluate(()=>cues.message());
  assert.deepEqual(await played(),['message','ring','ring']);
  await page.click('#previewMessageCue');
  await page.waitForFunction(()=>cues.played.length===4);
  await page.check('#cueMessages');await page.check('#dnd');
  await page.evaluate(()=>cues.message());
  assert.deepEqual(await played(),['message','ring','ring','message'],'explicit preview and DND');
  await page.uncheck('#dnd');await page.uncheck('#cueEnabled');
  await page.click('#closeSettingsDialog');await page.evaluate(()=>cues.call());
  await page.waitForSelector('#peerCallDialog[open]');await page.click('#peerReject');
  await page.waitForSelector('#peerCallDialog',{state:'hidden'});
  await page.click('#settingsBtn');await page.click('[data-pane="connection"]');
  await page.check('#cueEnabled');await page.click('#closeSettingsDialog');
  await page.evaluate(()=>cues.call());
  await page.waitForSelector('#peerCallDialog[open]');
  await page.click('#peerAccept');
  await page.waitForSelector('#peerAccept',{state:'hidden'});
  assert.equal(await ripple(),'none');
  assert.equal(await page.locator('#peerCallTitle').textContent(),process.env.LINK_QA_LANG==='en'?'Connecting…':'Подключаемся…');
  const measures=await page.evaluate(async()=>{
    const ctx=new OfflineAudioContext(1,1,32000);
    return Promise.all(['message','ring'].map(async name=>{
      const data=await (await fetch('assets/'+name+'.wav')).arrayBuffer();
      const decoded=await ctx.decodeAudioData(data);
      const frames=decoded.getChannelData(0);
      const peak=Math.max(...frames.map(Math.abs));
      const edges=Math.max(...frames.slice(0,64).map(Math.abs),...frames.slice(-64).map(Math.abs));
      return {name,duration:decoded.duration,peak,edges};
    }));
  });
  for(const item of measures){
    assert(item.duration>.35 && item.duration<1.6);
    assert(item.peak>.08 && item.peak<.2);
    assert(item.edges<.025);
  }
  // The call is still negotiating, but taking it must stop every ring.
  await new Promise(resolve=>setTimeout(resolve,4300));
  assert.deepEqual(await played(),['message','ring','ring','message','ring']);
  await page.click('#peerReject');
  await page.waitForSelector('#peerCallDialog',{state:'hidden'});
  await page.evaluate(()=>roomFixture.enter());
  await page.locator('#leaveBtn').waitFor();
  await page.evaluate(()=>{cues.call();cues.incoming.mode='switch';roomFixture.refresh();});
  await page.waitForSelector('#peerCallDialog[open]');
  await capture('incoming-during-call');
  await page.click('#peerAccept');
  await page.locator('#confirmYesBtn').waitFor();
  assert.equal(await page.locator('.call-switch-peer strong').textContent(),'Мила');
  assert.equal(await page.locator('.call-switch-peer canvas').count(),1);
  await capture('confirm-switch');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#peerCallDialog',{state:'hidden'});
  assert(await page.locator('#leaveBtn').isVisible());
  console.log('PASS notification cues: foreground DM, unknown and blocked senders, profile change, bursts, incoming ring repeats and stops, settings, DND, real decoded WAV.',JSON.stringify(measures));
};
