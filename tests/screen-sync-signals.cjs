// The source, the sender tap and the receiver know only the four recurring marks.
// None of the detectors reads the RTP timestamp or the stamped picture clock.
const pilot = {period: 1250, length: 250, bins: [82, 91, 100, 109], fft: 512};

function installProbe({sender, pilot}) {
  const marks = Object.create(null), taps = new Map();
  const record = (name, tag, now) => {
    const stage = marks[name] ??= {last: undefined, events: [], onset: null};
    if (tag === stage.last) return;
    if (stage.onset !== null && tag === -1 && now - stage.onset >= 60) {
      // A real 250 ms tone is visible across several detector windows.
      // Date its first rising edge, not the later sample that confirmed it.
      const time = stage.onset;
      const cycle = pilot.period * pilot.bins.length;
      // A deliberately advanced source (negative calibration) can arrive just
      // before its nominal mark. The supported watch targets remain below 2.5 s.
      const elapsed = (time % cycle - stage.last * pilot.period + 1.5*cycle) % cycle - cycle/2;
      stage.events.push([time - elapsed, elapsed]);
    }
    // Joining or changing taps mid-pulse must not invent an onset.
    stage.onset = stage.last === -1 && tag >= 0 ? now : null;
    stage.last = tag;
  };
  window.qaDrawPulse = (context, now) => {
    const tag = now % pilot.period < pilot.length ? Math.floor(now / pilot.period) % 4 : -1;
    for (let i = 0; i < 4; i++) {
      context.fillStyle = i === tag ? 'white' : 'black';
      context.fillRect(496 + 32*i, 0, 32, 80);
    }
    record('pictureInput', tag, now);
  };
  const connect = AudioNode.prototype.connect;
  function tap(name, node) {
    if (taps.has(name)) return;
    const analyser = node.context.createAnalyser();
    analyser.fftSize = pilot.fft;
    analyser.smoothingTimeConstant = 0;
    connect.call(node, analyser);
    taps.set(name, {analyser, bins: new Float32Array(analyser.frequencyBinCount)});
  }
  AudioNode.prototype.connect = function(destination, ...args) {
    const result = connect.call(this, destination, ...args);
    if (sender && this instanceof AudioWorkletNode && this.context.sinkId?.type === 'none')
      tap('audioWorklet', this);
    if (sender && destination instanceof MediaStreamAudioDestinationNode && this.context.sinkId?.type === 'none')
      tap('audioSender', this);
    if (!sender && destination instanceof AudioDestinationNode) tap('audioOutput', this);
    return result;
  };
  window.qaSystemTap = node => tap('audioReceiver', node);
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 1;
  const scan = canvas.getContext('2d', {willReadFrequently:true});
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [name, {analyser, bins}] of taps) {
      analyser.getFloatFrequencyData(bins);
      let strongest = -38, tag = -1;
      pilot.bins.forEach((bin, i) => {
        if (bins[bin] > strongest && bins[bin] > 8 + Math.max(bins[bin-3], bins[bin+3])) {
          strongest = bins[bin]; tag = i;
        }
      });
      record(name, tag, now);
    }
    if (sender) return;
    const v = document.querySelector('#remoteVideo');
    if (!v?.videoWidth || v.readyState < v.HAVE_CURRENT_DATA) return;
    scan.drawImage(v, 0, 0, v.videoWidth, v.videoHeight/8, 0, 0, 640, 1);
    const pixels = scan.getImageData(496, 0, 128, 1).data;
    let tag = -1;
    for (let i = 0; i < 4; i++) if (pixels[4*(16 + i*32)] > 170) tag = i;
    record('pictureReceiver', tag, now);
  }, 8);
  window.qaPulseEvents = () => Object.fromEntries(Object.entries(marks).map(([name, row]) => [name, row.events]));
  window.qaOutputTiming = () => {
    const ctx = taps.get('audioOutput')?.analyser.context;
    if (!ctx) return null;
    return {sampleRate:ctx.sampleRate, baseLatencyMs:Math.round(ctx.baseLatency*1000),
      outputLatencyMs:Number.isFinite(ctx.outputLatency) ? Math.round(ctx.outputLatency*1000) : null};
  };
  window.addEventListener('unload', () => clearInterval(timer), {once:true});
}

function compareEvents(stages, start, end) {
  const entries = Object.fromEntries(Object.entries(stages).map(([key, events]) =>
    [key, new Map(events.filter(([time]) => time >= start && time < end))]));
  const summary = values => {
    if (!values.length) return {n:0};
    values.sort((a, b) => a - b);
    const at = p => values[Math.ceil(p * values.length) - 1];
    const absolute=values.map(Math.abs).sort((a,b)=>a-b);
    return {n:values.length, p05:at(.05), median:at(.5), p95:at(.95),
      p95Abs:absolute[Math.ceil(.95*absolute.length)-1]};
  };
  const result = {};
  for (const [key, events] of Object.entries(entries)) result[key] = summary([...events.values()]);
  for (const [key, first, second] of [
    ['audioWorkletToSender','audioSender','audioWorklet'],
    ['audioSenderToReceiver','audioReceiver','audioSender'],
    ['audioReceiverToOutput','audioOutput','audioReceiver'],
    ['pictureInputToReceiver','pictureReceiver','pictureInput'],
    ['sourcePictureMinusAudio','pictureInput','audioSender'],
    ['receivedPictureMinusAudio','pictureReceiver','audioReceiver'],
    ['outputPictureMinusAudio','pictureReceiver','audioOutput']
  ]) {
    const a = entries[first], b = entries[second];
    result[key] = summary(a && b ? [...a].filter(([id]) => b.has(id)).map(([id, age]) => age - b.get(id)) : []);
  }
  return result;
}

module.exports = {pilot, installProbe, compareEvents};
