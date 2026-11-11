'use strict';
const {roomMix}=require('./participant-controls.cjs');
const assert = require('node:assert/strict');

// Fixtures replace the physical transducers only. Levels are sampled at the
// listener's final output after real negotiated Opus and both mixer sliders.
async function instrument(page, frequency) {
  await page.evaluate(frequency => {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
      const result = connect.call(this, destination, ...args);
      if (destination instanceof AudioDestinationNode && this instanceof WaveShaperNode) {
        const fft = this.context.createAnalyser();
        fft.fftSize = 8192;
        fft.smoothingTimeConstant = 0;
        connect.call(this, fft);
        window.qaPeak = () => {
          const block = new Float32Array(fft.fftSize);
          fft.getFloatTimeDomainData(block);
          let peak = 0;
          for (const sample of block) peak = Math.max(peak, Math.abs(sample));
          return peak;
        };
        window.qaMix = () => {
          const spectrum = new Float32Array(fft.frequencyBinCount);
          fft.getFloatFrequencyData(spectrum);
          return [503, 751, 1103, 1423].map(hz => {
            const bin = Math.round(hz * fft.fftSize / fft.context.sampleRate);
            return Math.max(-150, ...spectrum.slice(bin - 2, bin + 3));
          });
        };
      }
      return result;
    };
    window.qaOpens = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      window.qaOpens++;
      const context = new AudioContext({sampleRate:48000});
      const tone = context.createOscillator();
      const gain = context.createGain();
      const out = context.createMediaStreamDestination();
      window.qaToneGain = gain;
      gain.gain.value = 0.035;
      tone.frequency.value = frequency;
      tone.connect(gain).connect(out);
      tone.start();
      await context.resume();
      return out.stream;
    };
  }, frequency);
}

async function levels(page) {
  return page.evaluate(async () => {
    const samples = [];
    for (let i = 0; i < 13; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      samples.push(window.qaMix());
    }
    return samples[0].map((_, i) => samples.map(s => s[i]).sort((a,b) => a-b)[6]);
  });
}

async function slider(page, selector, n) {
  await page.locator(selector).evaluate((el, n) => {
    el.value = String(n);
    el.dispatchEvent(new Event('input', {bubbles:true}));
  }, n);
}
function near(actual, target) {
  assert(Math.abs(actual - target) < 1.5, 'expected ' + target + ' dB; measured ' + actual);
}
async function verify(host, guest) {
  await host.click('#micBtn');
  await guest.click('#micBtn');
  await guest.waitForFunction(() => window.qaMix?.()[0] > -65);
  await host.waitForFunction(() => window.qaMix?.()[2] > -65);
  const baseline = await levels(guest);
  assert(baseline[0] > -60 && baseline[1] > -60);
  assert(baseline[2] < -75 && baseline[3] < -75, 'own voice or loopback present in received mix');

  await roomMix(guest,0);await slider(guest, '#menu-mix-0-system', 4);
  await roomMix(guest,0);await slider(guest, '#menu-mix-0-voice', 200);
  const custom = await levels(guest);
  near(custom[0] - baseline[0], 6.02);
  near(custom[1] - baseline[1], -27.96);
  await roomMix(host,0);assert.equal(await host.inputValue('#own-voice'), '100');
  await roomMix(guest,0);await slider(guest, '#menu-mix-0-voice', 400);
  near((await levels(guest))[0] - baseline[0], 12.04);
  await roomMix(guest,0);await slider(guest, '#menu-mix-0-voice', 100);
  await roomMix(host,0);await slider(host, '#own-voice', 200);
  await guest.waitForFunction(target => qaMix()[0] > target, baseline[0] + 3);
  const doubled = await levels(guest);
  near(doubled[0] - baseline[0], 6.02);
  await host.click('#settingsBtn');
  await slider(host, '#micGain', 400);
  await guest.waitForFunction(target => qaMix()[0] > target, baseline[0] + 9);
  const boosted = await levels(guest);
  near(boosted[0] - baseline[0], 12.04);
  near(boosted[1] - custom[1], 0);
  const count = await host.evaluate(() => {
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      if (blob.type.startsWith('audio/')) window.qaClip = blob;
      return create(blob);
    };
    return qaOpens;
  });
  await host.click('#testMic');
  await guest.waitForFunction(() => qaMix()[0] < -75);
  await host.waitForFunction(() => document.querySelector('#testMic').dataset.phase === 'playing');
  assert.equal(await host.evaluate(() => qaOpens), count, 'second capture during check');
  assert((await levels(guest))[0] < -75);
  await host.waitForFunction(() => document.querySelector('#testMic').dataset.phase === 'idle');
  const clip = await host.evaluate(async () => {
    const ctx = new OfflineAudioContext(1,1,48000);
    const audio = await ctx.decodeAudioData(await qaClip.arrayBuffer());
    return {duration:audio.duration, rms:Math.sqrt(audio.getChannelData(0).reduce((s,v)=>s+v*v,0)/audio.length)};
  });
  assert(clip.duration > 3 && clip.rms > .01, JSON.stringify(clip));
  await guest.waitForFunction(target => qaMix()[0] > target, baseline[0] + 9);
  await slider(host, '#micGain', 0);
  await guest.waitForFunction(() => qaMix()[0] < -75);
  await host.click('#closeSettingsDialog');
  await roomMix(host,0);await slider(host, '#own-voice', 100);
  await roomMix(guest,0);await slider(guest, '#menu-mix-0-system', 100);
  await guest.click('#deafenBtn');
  await guest.waitForFunction(() => qaMix()[0] < -75 && qaMix()[1] < -75);
  await guest.click('#deafenBtn');
  await guest.waitForFunction(() => qaMix()[0] > -60 && qaMix()[1] > -60);
  await host.click('#micBtn');
  await guest.waitForFunction(() => qaMix()[0] < -75 && qaMix()[1] > -60);
  await guest.click('#micBtn');
  console.log('PASS remote post-mix dB by frequency [503 voice,751 shared,1103 listener own voice,1423 excluded loopback] ' +
    JSON.stringify({baseline, custom, doubled, boosted}));
}
async function loudVoice(host, guest) {
  await roomMix(host,0);await slider(host, '#own-voice', 400);
  await roomMix(guest,0);await slider(guest, '#menu-mix-0-voice', 400);
  await host.evaluate(() => {
    const {context, gain} = window.qaToneGain;
    gain.setValueAtTime(0, context.currentTime);
    gain.setValueAtTime(4, context.currentTime + .35);
    gain.setValueAtTime(0, context.currentTime + .39);
    gain.setValueAtTime(4, context.currentTime + .65);
    gain.setValueAtTime(0, context.currentTime + 1.45);
  });
  const peak = await guest.evaluate(async () => {
    let peak=0;
    for(let i=0;i<55;i++) {
      peak=Math.max(peak,qaPeak());
      await new Promise(resolve=>setTimeout(resolve,45));
    }
    return peak;
  });
  assert(peak>.19 && peak<=10**(-9/20)+.001, String(peak));
  console.log('PASS overloaded voice, 400% at both ends, final receiver peak dBFS ' + (20*Math.log10(peak)).toFixed(2));
}
module.exports = {instrument, verify, loudVoice};
