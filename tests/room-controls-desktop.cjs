'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const voice = require('./received-voice.cjs');

// Installed by the private-chat test launcher before the application loads.
// Keep the real Opus/WebRTC and output mixer. Substitute only the capture device.
function instrument() {
  const settings = JSON.parse(localStorage.getItem('craftlink.settings.v1') || '{}');
  localStorage.setItem('craftlink.settings.v1', JSON.stringify({...settings, publicStun:false, cueEnabled:false}));
  window.qaVoice = { sources:[], peers:[], outputs:[] };
  window.qaConnections = window.qaVoice.peers;
  const NativePeer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends NativePeer {
    constructor(options) { super({...options, iceServers:[]}); window.qaVoice.peers.push(this); }
    setConfiguration(options) { super.setConfiguration({...options, iceServers:[]}); }
  };
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext();
    await ctx.resume();
    const tone = ctx.createOscillator(), gain = ctx.createGain(), output = ctx.createMediaStreamDestination();
    gain.gain.value = 0.12;
    tone.connect(gain).connect(output);
    tone.start();
    window.qaVoice.sources.push(output.stream.getAudioTracks()[0]);
    return output.stream;
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function(destination, ...args) {
    const result = connect.call(this, destination, ...args);
    if (this instanceof WaveShaperNode && destination === this.context.destination) {
      const meter = this.context.createAnalyser();
      connect.call(this, meter);
      window.qaVoice.outputs.push(meter);
    }
    return result;
  };
  window.qaOutputLevel = () => {
    const meter = window.qaVoice.outputs.findLast(node => node.context.state === 'running');
    if (!meter) return null;
    const samples = new Float32Array(meter.fftSize);
    meter.getFloatTimeDomainData(samples);
    return Math.sqrt(samples.reduce((sum, v) => sum + v*v, 0) / samples.length);
  };
}

const contact = (page, name) => page.locator('#workspaceContacts .contact-card').filter({has:page.getByText(name, {exact:true})});
const tile = (page, name) => page.locator('.voice-tile').filter({has:page.locator('.voice-name', {hasText:name})});
const options = page => page.locator('#participantSoundMenu');

async function addFriend(sender, recipient, name) {
  await recipient.page.click('#navFriends');
  await recipient.page.click('#bookCopy');
  const card = await recipient.app.evaluate(() => globalThis.testClipboard);
  await sender.page.click('#navFriends');
  await sender.page.click('#linkFriends');
  await sender.page.fill('#directCode', card);
  await sender.page.click('#sendCardRequest');
  await recipient.page.click('#navRequests');
  await recipient.page.locator('#inRequests').getByRole('button', {name:'Принять',exact:true}).click({timeout:65000});
  await sender.page.click('#navFriends');
  await contact(sender.page, name).waitFor();
}

async function optIn(page) {
  await page.click('#settingsBtn');
  await page.click('[data-pane="voice"]');
  if(await page.isChecked('#joinWithMic'))await page.uncheck('#joinWithMic');
  await page.check('#joinWithMic');
  await page.click('#closeSettingsDialog');
}
async function count(page, total) {
  await page.waitForFunction(n => document.querySelector('#participantsCount').textContent === n+' / 8', total);
}
async function call(page, name) {
  await page.click('#navFriends');
  await contact(page,name).getByRole('button', {name:'Позвонить',exact:true}).click();
}
async function adjust(control, value) {
  await control.evaluate((slider, next) => {
    slider.value = next;
    slider.dispatchEvent(new Event('input', {bubbles:true}));
    slider.dispatchEvent(new Event('change', {bubbles:true}));
  }, String(value));
  assert.equal(await control.inputValue(), String(value));
}
// A slider changes gain smoothly. A single sample can capture the ramp and
// make a correct post-unmute level appear different from its baseline.
async function steadyPlayback(page,expected){
  const until=Date.now()+20000;
  let samples;
  do{
    samples=await page.evaluate(async()=>{
      const values=[];
      for(let i=0;i<7;i++){values.push(window.qaOutputLevel());await new Promise(resolve=>setTimeout(resolve,40));}
      return values;
    });
    if(!samples.every(Number.isFinite))continue;
    samples.sort((a,b)=>a-b);
    const median=samples[3];
    if(expected===0 && samples[6]<.0001)return median;
    if(median>.001 && samples[6]-samples[0]<median*.12 && (expected===undefined||Math.abs(median-expected)<expected*.15))return median;
  }while(Date.now()<until);
  const controls=await page.evaluate(()=>({deafened:document.querySelector('#deafenBtn').getAttribute('aria-pressed'),volume:document.querySelector('#roomOutputVolume').value}));
  throw Error('Playback did not settle: '+JSON.stringify({expected,samples,...controls}));
}
async function assertMix(page, name, expectedMuted) {
  await tile(page,name).locator('.tile-sound-menu').click();
  await page.waitForFunction(() => document.querySelector('#participantSoundMenu input[data-role="voice"]')?.value === '43');
  assert.equal(await options(page).locator('input[data-role="system"]').inputValue(), '71');
  assert.equal(await options(page).locator('[data-mute="voice"]').getAttribute('aria-pressed'), String(expectedMuted));
  await page.keyboard.press('Escape');
}
async function screenshot(page, file) {
  if (!process.env.LINK_VISUAL_DIR) return;
  await fs.mkdir(process.env.LINK_VISUAL_DIR,{recursive:true});
  // Hidden windows may not get a compositor frame immediately after a restart.
  // The scenario's assertions run independently of these optional images.
  try { await page.screenshot({path:path.join(process.env.LINK_VISUAL_DIR,file),timeout:2500}); }
  catch (error) { if(error.name!=='TimeoutError')throw error; }
}

async function run({a,b,open,create,apps}) {
  async function crashTestGuest(client) {
    const guest=await client.app.evaluate(({app})=>({pid:process.pid,exe:process.execPath,argv:process.argv,profile:app.getPath('userData')}));
    assert(guest.argv.includes('--craftlink-profile=boris'));
    assert(guest.profile.startsWith(client.base+path.sep));
    assert.equal(path.resolve(guest.exe),path.resolve(process.env.LINK_QA_ELECTRON||require('electron')));
    const gone=client.app.waitForEvent('close',{timeout:10000});
    process.kill(guest.pid,'SIGKILL');await gone;apps.delete(client.app);
  }
  const c = await open('vera');
  await create(c,'Вера');
  await addFriend(a,c,'Вера');
  await addFriend(b,c,'Вера');
  console.log('Three isolated clients confirmed their contacts.');
  await call(a.page,'Борис');
  await b.page.click('#peerAccept');
  await count(a.page,2); await count(b.page,2);
  for(const page of [a.page,b.page]){
    assert.equal(await page.locator('#micBtn').getAttribute('aria-pressed'),'false');
    await page.click('#micBtn');
  }
  const firstVoice = await voice(b.page,'0');
  await voice(a.page,'3');
  const fullLevel=await steadyPlayback(b.page);
  await tile(b.page,'Анна').click({button:'right'});
  await adjust(options(b.page).locator('input[data-role="voice"]'),43);
  await adjust(options(b.page).locator('input[data-role="system"]'),71);
  const reduced=await steadyPlayback(b.page,fullLevel*.43);
  await screenshot(b.page,'participant-sound-menu.png');
  await b.page.keyboard.press('Escape');
  await b.page.click('#settingsBtn');await b.page.click('[data-pane="voice"]');
  await adjust(b.page.locator('#roomOutputVolume'),50);
  const roomLevel=await steadyPlayback(b.page,reduced*.50);
  await screenshot(b.page,'voice-settings-wide.png');
  await b.page.setViewportSize({width:740,height:620});await screenshot(b.page,'voice-settings-narrow.png');
  await b.page.setViewportSize({width:1440,height:900});await b.page.click('#closeSettingsDialog');
  await b.page.click('#deafenBtn');
  await steadyPlayback(b.page,0);
  await b.page.click('#deafenBtn');
  const restored=await steadyPlayback(b.page,roomLevel);
  console.log('PASS room output volume multiplies the personal mix, mutes and returns to the chosen playback level.',{fullLevel,reduced,roomLevel,restored});
  await tile(b.page,'Анна').locator('.tile-mute').click();
  await b.page.waitForFunction(() => window.qaOutputLevel()!==null && window.qaOutputLevel()<.0001);
  assert.equal(await a.page.locator('#micBtn').getAttribute('aria-pressed'),'true');
  await voice(b.page,'0');
  console.log('PASS two opted-in microphones and decoded incoming audio, measured local playback level and local mute', {fullLevel,reduced});

  // Terminate only the child we launched with the dedicated, temporary guest profile.
  await crashTestGuest(b);
  await count(a.page,1);
  b = await open('boris');
  const back = b.page.locator('#quickRooms button[data-return-room]');
  await back.waitFor({timeout:65000});
  await b.page.click('#settingsBtn');await b.page.click('[data-pane="voice"]');
  assert.equal(await b.page.inputValue('#roomOutputVolume'),'50');await b.page.click('#closeSettingsDialog');
  console.log('The restarted guest has a return action and is still outside the room.');
  assert.equal(await b.page.evaluate(()=>window.qaVoice.sources.length),0);
  await screenshot(b.page,'resume-after-restart.png');
  await back.click();
  await count(a.page,2); await count(b.page,2);
  await assertMix(b.page,'Анна',true);
  let resumed;
  try{resumed=await voice(a.page,'3');}
  catch(error){
    const sending=await b.page.evaluate(async()=>{
      const pc=window.qaVoice.peers.at(-1),stats=await pc?.getStats();
      return {
        choice:Object.keys(localStorage).filter(key=>key.startsWith('craftlink.room-microphone.')).map(key=>localStorage.getItem(key)),
        mic:document.getElementById('micBtn').getAttribute('aria-pressed'),
        captures:window.qaVoice.sources.map(track=>[track.enabled,track.readyState]),
        senders:pc?.getTransceivers().filter(t=>t.sender.track).map(t=>[t.mid,t.currentDirection,t.sender.track.enabled,t.sender.track.readyState]),
        audio:[...(stats?.values()||[])].filter(s=>s.type==='outbound-rtp'&&s.kind==='audio').map(s=>[s.mid,s.bytesSent]),
        channels:pc?.sctp?.state,error:document.getElementById('toast').textContent
      };
    });
    throw Error(error.message+'; restarted sender '+JSON.stringify(sending),{cause:error});
  }
  await tile(b.page,'Анна').locator('.tile-mute').click();
  await b.page.waitForFunction(()=>window.qaOutputLevel()>.001);
  console.log('PASS cold guest restart and one click into the same living room. Host was never asked. Microphone choice and both personal levels survived.');

  // The outsider has separate DM history and is not a member of the current room.
  await b.page.click('#navFriends'); await contact(b.page,'Вера').locator('.open-person-chat').click();
  const secret = 'Личное для Веры '+Date.now();
  await b.page.fill('#dmInput',secret); await b.page.press('#dmInput','Enter');
  await c.page.click('#navFriends'); await contact(c.page,'Борис').locator('.open-person-chat').click();
  await c.page.locator('#dmLog').getByText(secret,{exact:true}).waitFor();
  await c.page.fill('#dmInput','Отвечаю только Борису'); await c.page.press('#dmInput','Enter');
  await b.page.locator('#dmLog').getByText('Отвечаю только Борису',{exact:true}).waitFor();
  assert.equal(await a.page.locator('#chatMessages').getByText(secret,{exact:true}).count(),0);
  const whileChatting = await voice(a.page,'3');
  await count(b.page,2);
  await c.page.click('#dmCall'); await b.page.click('#peerReject');
  await c.page.locator('#peerCallDialog').waitFor({state:'hidden'});
  await count(a.page,2); await voice(a.page,'3');

  // Confirming a switch must also handle a caller who hangs up mid-prompt.
  await new Promise(resolve=>setTimeout(resolve,3200));
  await c.page.click('#dmCall');await b.page.locator('#peerAccept').waitFor();
  await screenshot(b.page,'incoming-during-call.png');await b.page.click('#peerAccept');
  await b.page.locator('#confirmYesBtn').waitFor();
  assert.equal(await b.page.locator('.call-switch-peer strong').textContent(),'Вера');
  await c.page.click('#peerReject');await b.page.locator('#confirmYesBtn').waitFor({state:'hidden'});
  await count(a.page,2); await voice(a.page,'3');
  await new Promise(resolve=>setTimeout(resolve,3200));
  await c.page.click('#dmCall'); await b.page.click('#peerAccept');
  await screenshot(b.page,'switch-call.png');
  await b.page.click('#confirmYesBtn');
  await count(a.page,1); await count(c.page,2); await count(b.page,2);
  await tile(b.page,'Вера').waitFor(); await voice(c.page,'3');
  assert.equal(await tile(c.page,'Анна').count(),0);
  console.log('PASS private text outside the room, voice continued, decline and caller cancellation kept the original call, confirmed guest switch entered the caller’s room.');

  // Same friend in a different host's room. The third party needs a separate invitation.
  await c.page.click('#navFriends');
  await contact(c.page,'Анна').getByRole('button',{name:'Пригласить',exact:true}).click();
  await a.page.click('#peerAccept'); await a.page.click('#confirmYesBtn');
  await count(c.page,3); await count(a.page,3); await count(b.page,3);
  await assertMix(b.page,'Анна',false);
  await voice(b.page,'6');
  console.log('PASS saved friend mix in a third person’s room.');

  // The host of a populated room receives a private call. Only explicit consent closes that room.
  await b.page.click('#leaveBtn');
  await count(c.page,2);
  await call(b.page,'Вера'); await c.page.click('#peerAccept');
  await c.page.getByText('Ваша текущая комната закроется для участников.',{exact:true}).waitFor();
  await c.page.click('#confirmNoBtn');
  await b.page.locator('#peerCallDialog').waitFor({state:'hidden'}); await count(a.page,2);
  await new Promise(resolve=>setTimeout(resolve,3200));
  await call(b.page,'Вера'); await c.page.click('#peerAccept'); await c.page.click('#confirmYesBtn');
  await count(c.page,2); await count(b.page,2); await tile(c.page,'Борис').waitFor();
  await a.page.locator('#leaveBtn').waitFor({state:'hidden'});
  assert.equal(await tile(b.page,'Анна').count(),0);
  await voice(c.page,'0');
  console.log('PASS host declined the group shutdown, then confirmed it and switched to a separate two-person call.');
  await b.page.click('#micBtn');
  await b.page.waitForFunction(()=>document.querySelector('#micBtn').getAttribute('aria-pressed')==='false');
  await crashTestGuest(b);
  b=await open('boris');
  await b.page.click('#settingsBtn');await b.page.click('[data-pane="voice"]');
  assert(await b.page.isChecked('#joinWithMic'));
  assert.match(await b.page.textContent('#joinWithMicHint'),/с выключенным микрофоном/);
  assert.equal(await b.page.evaluate(()=>window.qaVoice.sources.length),0);
  console.log('PASS a deliberate microphone mute survived an immediate process crash; no capture on restart.');
  if(process.env.LINK_VISUAL_DIR)await fs.writeFile(path.join(process.env.LINK_VISUAL_DIR,'room-controls.json'),JSON.stringify({
    status:'PASS',profiles:3,network:'private loopback DHT and real WebRTC, synthetic capture',fullLevel,reduced,roomLevel,firstVoice,resumed,whileChatting,
    checked:['both microphones opted-in','output gain and mute','room volume multiplies personal gain and survives deafen and restart','guest process killed and restarted','no capture in lobby','one-click return with no host action','DM with nonmember during call','decline and caller cancellation','guest and host switch','per-friend levels with a different host','manual microphone mute survives immediate crash']
  },null,2)+'\n');
}

module.exports={instrument,run,addFriend,optIn,count};
