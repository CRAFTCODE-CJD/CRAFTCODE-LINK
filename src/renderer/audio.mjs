import {tr} from './locale.mjs';
export const volumeLimit = role => role === 'voice' ? 400 : 200;
export const clampGain = (value, role) => Math.min(volumeLimit(role), Math.max(0, Number(value) || 0)) / 100;

// Compression controls sustained loud sounds. The final curve also catches the
// first transient inside the compressor attack interval. Its linear region
// preserves quiet speech and independent mix settings.
function makePeakCurve(knee, ceilingDb) {
  const margin = 10 ** (ceilingDb / 20) - knee;
  return Float32Array.from({length: 8193}, (_, i) => {
    const x = i / 4096 - 1;
    const magnitude = Math.abs(x);
    return magnitude <= knee ? x : Math.sign(x) * (knee + margin * Math.tanh((magnitude - knee) / margin));
  });
}
const mixCurve = makePeakCurve(0.5, -3);
const voiceCurve = makePeakCurve(0.25, -9);

export function protectedOutput(context, destination, role) {
  const ceiling = context.createWaveShaper();
  ceiling.curve = role === 'voice' ? voiceCurve : mixCurve;
  ceiling.connect(destination);
  // Screen audio already passes through the master limiter at playback.
  // Keep its peak ceiling at capture and mixing without buffering either copy.
  if(role==='system')return {input:ceiling,disconnect(){ceiling.disconnect();}};
  const limiter = context.createDynamicsCompressor();
  // A 0 dB threshold on the bus keeps Chromium's automatic makeup gain
  // from amplifying an already limited voice on its way to the speakers.
  limiter.threshold.value = role === 'voice' ? -4 : 0;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
  limiter.connect(ceiling);
  return {input: limiter, disconnect() { limiter.disconnect(); ceiling.disconnect(); }};
}

function openGate(gain, time, delay = 0) {
  gain.cancelScheduledValues(time);
  gain.setValueAtTime(0, time);
  gain.setTargetAtTime(1, time + delay, 0.018);
}

/** Local playback only: remote tracks are never modified, stopped or mixed into outgoing media. */
export class AudioMixer {
  constructor({ onError = () => {} } = {}) {
    this.onError = onError;
    this.context = null;
    this.sources = new Map();
    this.settings = new Map();
    this.pendingAttachments = new Map();
    this.epoch = 0;
    this.deafened = false;
    this.roomVolume = 100;
  }
  async start() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      this.master = this.context.createGain();
      this.master.gain.value = this.deafened ? 0 : this.roomVolume / 100;
      this.output = protectedOutput(this.context, this.context.destination);
      this.master.connect(this.output.input);
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }
  routeLocal(element) {
    if (!this.context || this.context.state !== 'running') return null;
    const source = this.context.createMediaElementSource(element);
    source.connect(this.output.input);
    return () => source.disconnect();
  }
  getSetting(id, role) { return this.settings.get(`${id}:${role}`) || { volume: 100, muted: false, active: true }; }
  screenOutputDelay(id) {
    const item=this.sources.get(id+':system'),setting=this.getSetting(id,'system');
    const device=this.context?.outputLatency;
    const audible=item && this.context?.state==='running' && Number.isFinite(device) &&
      !this.deafened && this.roomVolume && !setting.muted && setting.active && setting.volume &&
      item.track.readyState==='live' && !item.track.muted && item.track.enabled;
    if (this.screenMeter && (!audible || this.screenMeter.item!==item)) this.releaseScreenMeter();
    if (!audible) return null;
    // Chromium can report zero totalAudioEnergy for a decoded stereo track.
    // Read only the selected source, before the limiter, at the stats cadence.
    if (!this.screenMeter) {
      const analyser=this.context.createAnalyser();
      analyser.fftSize=512;
      item.source.connect(analyser);
      this.screenMeter={item,analyser,samples:new Float32Array(analyser.fftSize),lastSound:-Infinity};
    }
    const meter=this.screenMeter,now=performance.now();
    meter.analyser.getFloatTimeDomainData(meter.samples);
    if (meter.samples.some(v=>Math.abs(v)>.0001)) meter.lastSound=now;
    if (now-meter.lastSound>6000) return null;
    // Only the master compressor buffers this soundtrack (6 ms look-ahead).
    return 1000*device+6;
  }
  releaseScreenMeter() {
    const meter=this.screenMeter;
    if (!meter) return;
    meter.item.source.disconnect(meter.analyser);
    meter.analyser.disconnect();
    this.screenMeter=null;
  }
  voiceLevel(id) {
    const item=this.sources.get(id+':voice'),setting=this.getSetting(id,'voice');
    if(!item || this.deafened || setting.muted || !setting.active || !setting.volume || item.track.readyState!=='live' || item.track.muted || !item.track.enabled || this.context?.state!=='running')return 0;
    item.analyser.getFloatTimeDomainData(item.samples);
    let energy=0;for(const sample of item.samples)energy+=sample*sample;
    return Math.min(1,4*Math.sqrt(energy/item.samples.length));
  }
  setSetting(id, role, update) {
    const key = `${id}:${role}`;
    const value = { ...this.getSetting(id, role), ...update };
    this.settings.set(key, value);
    const item = this.sources.get(key);
    if (item) item.gain.gain.setTargetAtTime(value.muted || !value.active ? 0 : clampGain(value.volume, role), this.context.currentTime, 0.012);
    return value;
  }
  async attach(id, role, track) {
    const key = `${id}:${role}`;
    const old = this.sources.get(key);
    if (old?.track === track) return;
    this.detach(id, role);
    if (!track || track.kind !== 'audio') return;
    const request = Symbol();
    this.pendingAttachments.set(key, request);
    const epoch = this.epoch;
    try {
      await this.start();
      if (epoch !== this.epoch || this.pendingAttachments.get(key) !== request || !this.context || this.context.state === 'closed') return;
    } finally {
      if (this.pendingAttachments.get(key) === request) this.pendingAttachments.delete(key);
    }
    const stream = new MediaStream([track]);
    const source = this.context.createMediaStreamSource(stream);
    const gain = this.context.createGain();
    const limiter = protectedOutput(this.context, this.master, role);
    const setting = this.getSetting(id, role);
    gain.gain.value = 0;
    if (!setting.muted && setting.active) gain.gain.setTargetAtTime(clampGain(setting.volume, role), this.context.currentTime, 0.018);
    const analyser=role==='voice'?this.context.createAnalyser():null;
    if(analyser){analyser.fftSize=1024;source.connect(analyser).connect(gain);}
    else source.connect(gain);
    gain.connect(limiter.input);
    // Chromium can receive Opus packets without pulling decoded samples until a
    // media element consumes the remote stream. Only WebAudio feeds the output.
    const playback = new Audio();
    playback.muted = true;
    playback.srcObject = stream;
    this.sources.set(key, { source, gain, limiter, track, playback, analyser, samples:analyser?new Float32Array(analyser.fftSize):null });
    playback.play().catch(error => {
      if (this.sources.get(key)?.playback === playback) this.onError(tr('Воспроизведение аудио: ') + error.message);
    });
  }
  detach(id, role) {
    const key = `${id}:${role}`;
    this.pendingAttachments.delete(key);
    const item = this.sources.get(key);
    if (item) {
      if (this.screenMeter?.item===item) this.releaseScreenMeter();
      item.playback.pause();
      item.playback.srcObject = null;
      item.source.disconnect(); item.analyser?.disconnect(); item.gain.disconnect(); item.limiter.disconnect();
      this.sources.delete(key);
    }
  }
  removeParticipant(id) {
    for (const role of ['voice', 'system']) { this.detach(id, role); this.settings.delete(`${id}:${role}`); }
  }
  setDeafened(value) {
    this.deafened = Boolean(value);
    this.setRoomVolume(this.roomVolume);
  }
  setRoomVolume(value) {
    this.roomVolume = Math.max(0, Math.min(100, Number(value) || 0));
    if (this.context) this.master.gain.setTargetAtTime(this.deafened ? 0 : this.roomVolume / 100, this.context.currentTime, 0.012);
  }
  async setOutput(sinkId = '') {
    await this.start();
    if (typeof this.context.setSinkId !== 'function') {
      if (sinkId) throw new Error(tr('Выбор выхода не поддерживается. Используйте устройство по умолчанию Windows.'));
    } else await this.context.setSinkId(sinkId);
  }
  async close() {
    this.epoch++;
    for (const key of [...this.sources.keys()]) {
      const split = key.lastIndexOf(':');
      this.detach(key.slice(0, split), key.slice(split + 1));
    }
    this.settings.clear();
    const context = this.context;
    this.context = this.master = this.output = null;
    this.pendingAttachments.clear();
    if (context && context.state !== 'closed') await context.close();
  }
}

export class Microphone {
  constructor({ onLevel = () => {}, onEnded = () => {} } = {}) {
    this.onLevel = onLevel;
    this.onEnded = onEnded;
    this.muted = true;
    this.previewPlaying = false;
    this.stream = null;
    this.context = null;
    this.outputTrack = null;
    this.timer = null;
    this.generation = 0;
  }
  async open(settings) {
    const generation = ++this.generation;
    // Chromium can reuse the original capture configuration while a track
    // holds the same device. Keep the sender alive with silence during reopen.
    this.stream?.getTracks().forEach(track => track.stop());
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      ...(settings.micDevice ? { deviceId: { exact: settings.micDevice } } : {}),
      channelCount: 1, sampleRate: 48000,
      echoCancellation: Boolean(settings.echoCancellation),
      noiseSuppression: Boolean(settings.noiseSuppression),
      autoGainControl: Boolean(settings.autoGainControl),
    }, video: false });
    if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); throw new Error(tr('Запрос микрофона отменён')); }
    let context, gain, analyser, limiter, gate, track;
    try {
      context = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      await context.resume();
      if (generation !== this.generation) throw new Error(tr('Запрос микрофона отменён'));
      const input = context.createMediaStreamSource(stream);
      gain = context.createGain();
      gain.gain.value = clampGain(settings.micGain, 'voice');
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      const output = context.createMediaStreamDestination();
      output.channelCount = 1;
      limiter = protectedOutput(context, analyser, 'voice').input;
      gate = context.createGain();
      gate.gain.value = 0;
      input.connect(gain).connect(limiter);
      analyser.connect(gate).connect(output);
      track = output.stream.getAudioTracks()[0];
      track.enabled = !this.muted && !this.previewPlaying;
      if (track.enabled) openGate(gate.gain, context.currentTime);
    } catch (error) {
      stream.getTracks().forEach(t => t.stop()); track?.stop();
      if (context && context.state !== 'closed') await context.close().catch(() => {});
      throw error;
    }
    // Keep the old track alive until replacement in every sender succeeds.
    const previous = { stream: this.stream, context: this.context, track: this.outputTrack, timer: this.timer };
    this.stream = stream; this.context = context; this.gain = gain; this.outputTrack = track;
    this.gate = gate;
    this.analyser = analyser;
    const samples = new Float32Array(analyser.fftSize);
    this.timer = setInterval(() => {
      if (this.context !== context || (this.muted && !this.previewPlaying)) return;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      let peak = 0;
      for (const sample of samples) {
        sum += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      const rms = Math.sqrt(sum / samples.length);
      const level = Math.min(1, rms * 4);
      this.onLevel(this.muted || this.previewPlaying ? 0 : level, {level, rms, peak, reduction: limiter.reduction});
    }, 80);
    stream.getAudioTracks()[0].addEventListener('ended', () => { if (this.stream === stream) this.onEnded(); });
    return { track, releasePrevious: async () => {
      clearInterval(previous.timer); previous.stream?.getTracks().forEach(t => t.stop()); previous.track?.stop();
      if (previous.context && previous.context.state !== 'closed') await previous.context.close();
    } };
  }
  // Tap the same processed samples before the privacy gate. Local playback
  // never connects to this graph and the preview cannot enable the room track.
  previewTap() {
    const analyser = this.analyser;
    const output = this.context.createMediaStreamDestination();
    output.channelCount = 1;
    analyser.connect(output);
    const track = output.stream.getAudioTracks()[0];
    return {track, close() { analyser.disconnect(output); track.stop(); }};
  }
  updateEnabled(delay = 0) {
    const enabled = !this.muted && !this.previewPlaying;
    if (this.outputTrack && enabled !== this.outputTrack.enabled) {
      const now = this.context.currentTime;
      if (enabled) openGate(this.gate.gain, now, delay);
      else {
        this.gate.gain.cancelScheduledValues(now);
        this.gate.gain.setValueAtTime(0, now);
      }
      this.outputTrack.enabled = enabled;
    }
    this.onLevel(0);
  }
  setMuted(value) { this.muted = Boolean(value); this.updateEnabled(); }
  setPreviewPlaying(value, tail = 0) { this.previewPlaying = Boolean(value); this.updateEnabled(tail); }
  setGain(value) { if (this.context) this.gain.gain.setTargetAtTime(clampGain(value, 'voice'), this.context.currentTime, 0.018); }
  async close() {
    this.generation++;
    clearInterval(this.timer);
    this.stream?.getTracks().forEach(t => t.stop());
    this.outputTrack?.stop();
    const context = this.context;
    this.context = this.stream = this.outputTrack = this.timer = null;
    this.analyser = this.gate = this.gain = null;
    this.muted = true; this.onLevel(0);
    if (context && context.state !== 'closed') await context.close();
  }
}
