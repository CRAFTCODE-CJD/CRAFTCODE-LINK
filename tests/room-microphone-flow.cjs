'use strict';
const {roomMix,roomOptions,closeRoomMenu}=require('./participant-controls.cjs');
const assert = require('node:assert/strict');
const receivedVoice = require('./received-voice.cjs');

// Two real browser renderers and a WebRTC control channel; only room discovery
// and the microphone device are fixtures supplied by room-chat-browser.
module.exports = async function verifyRoomMicrophone(host, guest) {
  const prefs = async page => {
    await page.click('#settingsBtn');
    await page.click('button[data-pane="voice"]');
    const english = await page.locator('html').getAttribute('lang')==='en';
    assert.equal(await page.locator('label[for="joinWithMic"] span').textContent(),
      english?'Remember my microphone for calls':'Запоминать мой микрофон для звонков');
    assert.match(await page.locator('#joinWithMicHint').textContent(),english?/microphone|muted/i:/микрофон/i);
    return page.locator('#joinWithMic');
  };
  async function fake(page) {
    await page.evaluate(receivedVoice.installTestVoice);
    await page.evaluate(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.probeMic = {requests:0, tracks:[], mode:'normal'};
      window.qaConnections = [];
      const NativePeer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends NativePeer {
        constructor(...args) {super(...args);window.qaConnections.push(this);}
      };
      navigator.mediaDevices.getUserMedia = async options => {
        const probe=window.probeMic;
        probe.requests++;
        if (probe.mode === 'deny') throw new DOMException('Synthetic permission denied', 'NotAllowedError');
        if (probe.mode === 'delay') await new Promise(resolve => {probe.release=resolve;});
        const stream=await original(options);probe.tracks.push(...stream.getAudioTracks());return stream;
      };
    });
  }
  async function enter(moderated = false) {
    await host.click('#linkHost');if(moderated){await roomOptions(host);await host.check('#roomModerated');await closeRoomMenu(host);}
    await guest.evaluate(()=>roomFixture.enter());await guest.waitForSelector('#roomMeta');
    for(const page of [guest,host])await page.evaluate(()=>roomFixture.roster());
  }
  async function leave() {
    for(const page of [guest,host]){
      await page.click('#leaveBtn');
      if (page === host) await page.click('#confirmYesBtn');
      await page.locator('#roomMeta').waitFor({state:'hidden'});
    }
  }
  await fake(host);await fake(guest);
  const choice=await prefs(guest);
  assert(await choice.isChecked());await guest.click('#closeSettingsDialog');
  assert.equal(await guest.evaluate(()=>probeMic.requests),0);
  const hostChoice=await prefs(host);assert(await hostChoice.isChecked());await hostChoice.uncheck();await host.click('#closeSettingsDialog');
  await enter(true);
  await guest.waitForFunction(()=>document.querySelector('#micBtn').disabled);
  assert.equal(await guest.evaluate(()=>probeMic.requests),0);
  await roomMix(host,1);await host.click('.speaker-permission');await guest.waitForFunction(()=>!document.querySelector('#micBtn').disabled);
  assert.equal(await guest.evaluate(()=>probeMic.requests),0,'host cannot turn on a mic by granting voice');
  // Cancel while the device request is outstanding. A late stream is stopped.
  await guest.evaluate(()=>{probeMic.mode='delay';});await guest.click('#micBtn');
  await guest.waitForFunction(()=>!!probeMic.release);await roomMix(host,1);await host.click('.speaker-permission');
  await guest.waitForFunction(()=>document.querySelector('#testMic').disabled===false);
  await guest.evaluate(()=>probeMic.release());
  await guest.waitForFunction(()=>probeMic.tracks.length===1 && probeMic.tracks[0].readyState==='ended');
  await roomMix(host,1);await host.click('.speaker-permission');await guest.waitForFunction(()=>!document.querySelector('#micBtn').disabled);
  await guest.evaluate(()=>{probeMic.mode='normal';});await guest.click('#micBtn');
  await guest.waitForFunction(()=>document.querySelector('#micBtn').getAttribute('aria-pressed')==='true');
  await roomMix(host,1);await host.click('.speaker-permission');
  await guest.waitForFunction(()=>document.querySelector('#micBtn').disabled && probeMic.tracks.every(t=>t.readyState==='ended'));
  assert.equal(await host.evaluate(()=>probeMic.requests),0);
  await leave();
  await guest.reload();await guest.waitForFunction(()=>document.querySelector('#profileLabel').textContent==='Борис');
  await fake(guest);assert(await (await prefs(guest)).isChecked());await guest.click('#closeSettingsDialog');
  // A denied first request leaves the room active and the button usable.
  await guest.evaluate(()=>{probeMic.mode='deny';});await enter();
  await guest.waitForFunction(()=>probeMic.requests===1 && !document.querySelector('#micBtn').disabled);
  assert.equal(await guest.locator('#micBtn').getAttribute('aria-pressed'),'false');
  await guest.evaluate(()=>{probeMic.mode='normal';});await guest.click('#micBtn');
  await guest.waitForFunction(()=>document.querySelector('#micBtn').getAttribute('aria-pressed')==='true');
  await guest.click('#micBtn');
  await guest.waitForFunction(()=>document.querySelector('#micBtn').getAttribute('aria-pressed')==='false');
  await leave();await enter();
  await roomOptions(host);await host.check('#roomModerated');await guest.waitForFunction(()=>document.querySelector('#micBtn').disabled);
  assert.equal(await guest.evaluate(()=>probeMic.requests),2,'manual mute is remembered');
  await roomMix(host,1);await host.click('.speaker-permission');await guest.click('#micBtn');
  await guest.waitForFunction(()=>document.querySelector('#micBtn').getAttribute('aria-pressed')==='true');
  await leave();
  await (await prefs(host)).check();await host.click('#closeSettingsDialog');
  await enter();
  const samples=[];
  for(const [page,mid] of [[host,'3'],[guest,'0']]) {
    await page.waitForFunction(()=>document.querySelector('#micBtn').getAttribute('aria-pressed')==='true');
    samples.push(await receivedVoice(page,mid));
  }
  await guest.evaluate(()=>roomFixture.changeOwner('e'.repeat(64)));
  await guest.waitForFunction(()=>document.querySelector('#micBtn').getAttribute('aria-pressed')==='false' &&
    probeMic.tracks.every(track=>track.readyState==='ended'));
  assert(await (await prefs(guest)).isChecked(),'a different profile starts with remembering enabled and capture muted');
  await guest.click('#closeSettingsDialog');
  await leave();
  console.log('PASS voice preference per profile and reload; no capture on startup, in a moderated room or on a grant; pending and live tracks released on revocation and profile change; permission denial, manual retry, remembered mute and unmute. Both host and guest join with active synthetic sound and receive increasing decoded voice.',JSON.stringify(samples));
};
