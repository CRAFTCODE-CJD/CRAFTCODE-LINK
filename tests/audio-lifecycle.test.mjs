import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioMixer } from '../src/renderer/audio.mjs';

function fakeAudio(t) {
  const saved = { AudioContext: globalThis.AudioContext, MediaStream: globalThis.MediaStream };
  const previousAudio = globalThis.Audio;
  globalThis.Audio = class { async play() {} pause() {} };
  t.after(() => { globalThis.Audio = previousAudio; });
  const activeSources = new Set();
  let createdSources = 0;
  const param = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } });
  const baseNode = () => ({ connect(target) { return target; }, disconnect() {} });
  class Context {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = baseNode(); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    async setSinkId() {}
    createWaveShaper() { return baseNode(); }
    createAnalyser() { return {...baseNode(), getFloatTimeDomainData(samples) { samples.fill(0.1); }}; }
    createGain() { return { ...baseNode(), gain: param() }; }
    createDynamicsCompressor() { return { ...baseNode(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }; }
    createMediaStreamSource(stream) {
      createdSources++;
      const source = { stream, connect(target) { activeSources.add(source); return target; }, disconnect() { activeSources.delete(source); } };
      return source;
    }
  }
  globalThis.AudioContext = Context;
  globalThis.MediaStream = class { constructor(tracks) { this.tracks = tracks; } };
  t.after(() => { globalThis.AudioContext = saved.AudioContext; globalThis.MediaStream = saved.MediaStream; });
  return { activeSources, created: () => createdSources };
}

test('screen playout compensation follows the selected device and audible system track',async t=>{
  fakeAudio(t);
  const mixer=new AudioMixer(),track={kind:'audio',enabled:true,readyState:'live'};
  await mixer.attach('guest','system',track);
  assert.equal(mixer.screenOutputDelay('guest'),null);
  mixer.context.outputLatency=.042;assert.equal(mixer.screenOutputDelay('guest'),48);
  mixer.context.outputLatency=.012;assert.equal(mixer.screenOutputDelay('guest'),18);
  let now=mixer.screenMeter.lastSound;
  t.mock.method(performance,'now',()=>now);
  mixer.screenMeter.analyser.getFloatTimeDomainData=samples=>samples.fill(0);
  now+=2000;assert.equal(mixer.screenOutputDelay('guest'),18,'brief silence preserves picture timing');
  now+=5000;assert.equal(mixer.screenOutputDelay('guest'),null);
  mixer.screenMeter.analyser.getFloatTimeDomainData=samples=>samples.fill(.001);
  assert.equal(mixer.screenOutputDelay('guest'),18);
  mixer.setSetting('guest','system',{active:false});assert.equal(mixer.screenOutputDelay('guest'),null);
  mixer.setSetting('guest','system',{active:true});mixer.setDeafened(true);
  assert.equal(mixer.screenOutputDelay('guest'),null);
  mixer.setDeafened(false);mixer.setRoomVolume(0);assert.equal(mixer.screenOutputDelay('guest'),null);
  mixer.setRoomVolume(100);track.muted=true;assert.equal(mixer.screenOutputDelay('guest'),null);
  await mixer.close();assert.equal(mixer.screenOutputDelay('guest'),null);
});

test('speaking meter reads the current voice samples and clears with mute, stop, deafen or exit',async t=>{
  fakeAudio(t);const mixer=new AudioMixer(),voice={kind:'audio',enabled:true,readyState:'live'};
  await mixer.attach('speaker','system',voice);assert.equal(mixer.voiceLevel('speaker'),0);
  await mixer.attach('speaker','voice',voice);assert(Math.abs(mixer.voiceLevel('speaker')-0.4)<0.001);
  mixer.setSetting('speaker','voice',{muted:true});assert.equal(mixer.voiceLevel('speaker'),0);
  mixer.setSetting('speaker','voice',{muted:false});mixer.setDeafened(true);assert.equal(mixer.voiceLevel('speaker'),0);
  mixer.setDeafened(false);voice.muted=true;assert.equal(mixer.voiceLevel('speaker'),0);
  voice.muted=false;voice.readyState='ended';assert.equal(mixer.voiceLevel('speaker'),0);
  mixer.removeParticipant('speaker');assert.equal(mixer.voiceLevel('speaker'),0);await mixer.close();
});
test('concurrent same-track attachments produce one controllable graph, no orphan playback', async t => {
  const context = fakeAudio(t);
  const mixer = new AudioMixer();
  const track = { kind: 'audio', enabled: true };
  await Promise.all(Array.from({ length: 12 }, () => mixer.attach('peer', 'voice', track)));
  assert.equal(context.created(), 1);
  assert.equal(context.activeSources.size, 1);
  assert.equal(mixer.sources.size, 1);
  mixer.setSetting('peer', 'voice', { muted: true });
  assert.equal(mixer.sources.get('peer:voice').gain.gain.value, 0);
  assert.equal(track.enabled, true, 'local mute never mutates forwarded remote track');
  mixer.detach('peer', 'voice');
  assert.equal(context.activeSources.size, 0);
  await mixer.close();
});

test('participant removal cancels pending attachment before it can become audible', async t => {
  const context = fakeAudio(t);
  const mixer = new AudioMixer();
  const pending = mixer.attach('peer', 'system', { kind: 'audio' });
  mixer.removeParticipant('peer');
  await pending;
  assert.equal(context.activeSources.size, 0);
  assert.equal(mixer.sources.size, 0);
  await mixer.close();
});

test('closing mixer invalidates pending attachment and releases all source graphs', async t => {
  const context = fakeAudio(t);
  const mixer = new AudioMixer();
  const pending = mixer.attach('peer', 'voice', { kind: 'audio' });
  await mixer.close();
  await pending;
  assert.equal(context.activeSources.size, 0);
  assert.equal(mixer.sources.size, 0);
});

test('voice/system, users and master deafen remain independent', async t => {
  fakeAudio(t);
  const mixer = new AudioMixer();
  const a = { kind: 'audio', enabled: true }, b = { kind: 'audio', enabled: true };
  await mixer.attach('one', 'voice', a);
  await mixer.attach('one', 'system', b);
  await mixer.attach('two', 'voice', { kind: 'audio' });
  mixer.setSetting('one', 'voice', { volume: 25 });
  mixer.setSetting('one', 'system', { volume: 200 });
  assert.equal(mixer.sources.get('one:voice').gain.gain.value, 0.25);
  assert.equal(mixer.sources.get('one:system').gain.gain.value, 2);
  assert.equal(mixer.sources.get('two:voice').gain.gain.value, 1);
  mixer.setDeafened(true);
  assert.equal(mixer.master.gain.value, 0);
  mixer.setDeafened(false);
  assert.equal(mixer.master.gain.value, 1);
  assert.equal(mixer.sources.get('one:system').gain.gain.value, 2);
  assert.equal(a.enabled && b.enabled, true);
  await mixer.close();
});

test('a removed output device cannot block joining the next room', async t => {
  fakeAudio(t);
  let unplugged = false;
  globalThis.AudioContext.prototype.setSinkId = async id => {
    if (id && unplugged) throw new Error('device unavailable');
  };
  const mixer = new AudioMixer();
  await mixer.setOutput('headset');
  await mixer.close();
  unplugged = true;
  await mixer.start();
  await assert.rejects(mixer.setOutput('headset'), /unavailable/);
  await mixer.setOutput('');
  await mixer.close();
});
