'use strict';
const assert=require('node:assert/strict');

module.exports=async function checkSounds(page,ids){
  await page.bringToFront();
  await page.evaluate(([me,friend])=>{
    const original=craftlink.direct,play=HTMLMediaElement.prototype.play;
    const peer={id:friend,name:'Мила',state:'friend',online:true,devices:[],chat:{supported:true}};
    const fixture=window.cues={played:[],incoming:null,blocked:false};
    HTMLMediaElement.prototype.play=function(){
      const name=this.src.match(/\/assets\/(\w+)\.wav$/)?.[1];
      if(name)fixture.played.push(name);
      return play.call(this);
    };
    craftlink.direct=async request=>{
      if(request.op==='chat-history')return {messages:[],hasMore:false};
      if(request.op==='reject'){fixture.incoming=null;roomFixture.refresh();return;}
      if(request.op==='take'){fixture.incoming.taken=true;roomFixture.refresh();return;}
      const result=await original(request);
      if(request.op==='state'){
        result.friends=[peer];result.blocked=fixture.blocked?[{id:friend}]:[];
        result.incoming=fixture.incoming;
      }
      return result;
    };
    fixture.message=(extra={})=>roomFixture.emit({type:'direct-chat-updated',incoming:true,id:friend,profile:me,...extra});
    fixture.call=()=>{
      fixture.incoming={id:'call',key:crypto.randomUUID(),mode:'call',name:peer.name};
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

  await page.evaluate(()=>cues.call());
  await page.waitForSelector('#peerCallDialog[open]');
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
  console.log('PASS notification cues: foreground DM, unknown and blocked senders, profile change, bursts, incoming ring repeats and stops, settings, DND, real decoded WAV.',JSON.stringify(measures));
};
