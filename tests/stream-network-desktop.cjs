'use strict';
// node tests/stream-network-desktop.cjs [sender-entry] [--game-scene] [--audio] [--ordered] [--startup-only] [--qhd60] [--frame-source] [--prefer-h264]
// LINK_QA_VIEWER_ENTRY selects a second product version for compatibility checks.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { _electron } = require(require.resolve('playwright', { paths: [__dirname, process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || __dirname] }));
const { localNat } = require('./nat-fixture.cjs');
const { testRuntime } = require('./electron-runtime.cjs');
const { clickPath } = require('./qa-navigation.cjs');

const entry = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || path.join(__dirname, '../src/entry.cjs'));
const viewerEntry = path.resolve(process.env.LINK_QA_VIEWER_ENTRY || entry);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'link-stream-network-'));
const apps = [];
const startupOnly = process.argv.includes('--startup-only');
const withAudio = process.argv.includes('--audio');
const ordered = process.argv.includes('--ordered');
const gameScene = process.argv.includes('--game-scene');
const qhd60 = process.argv.includes('--qhd60');
const frameSource = process.argv.includes('--frame-source');
const preferH264 = process.argv.includes('--prefer-h264');
const format = qhd60 ? {width: 2560, height: 1440, fps: 60} : {width: 1280, height: 720, fps: 30};

// Only the test's mapped UDP addresses are signalled. Chromium still performs its own
// congestion control, encode/decode, retransmission and playout on this route.
function useTestNetwork({port, preferH264}) {
  const Native = RTCPeerConnection;
  const mappedLine = line => / typ srflx /.test(line) && !line.startsWith('candidate:cl');
  const local = (cfg) => ({ ...cfg, iceServers: [{ urls: 'stun:127.0.0.1:' + port }] });
  window.RTCPeerConnection = class extends Native {
    constructor(cfg) { super(local(cfg)); window.qaPC = this; }
    addTransceiver(track, init) {
      const transceiver = super.addTransceiver(track, init);
      if (preferH264 && (track === 'video' || track?.kind === 'video')) {
        const codecs = RTCRtpReceiver.getCapabilities('video').codecs;
        const h264 = codec => codec.mimeType.toLowerCase() === 'video/h264';
        transceiver.setCodecPreferences([...codecs.filter(h264), ...codecs.filter(codec => !h264(codec))]);
      }
      return transceiver;
    }
    setConfiguration(cfg) { return super.setConfiguration(local(cfg)); }
    addIceCandidate(c) {
      if (c?.candidate && !mappedLine(c.candidate)) return Promise.resolve();
      return super.addIceCandidate(c);
    }
    setRemoteDescription(d) {
      if (!d?.sdp) return super.setRemoteDescription(d);
      const sdp = d.sdp.split('\r\n').filter(line => !line.startsWith('a=candidate:') || mappedLine(line.slice(2))).join('\r\n');
      return super.setRemoteDescription({ type: d.type, sdp });
    }
  };
}

function installMovingSource({gameScene, format, frameSource}) {
  navigator.mediaDevices.getDisplayMedia = async () => {
    await window.qaConsumeSelection();
    if (frameSource) {
      // Feed native-size I420 frames directly to WebRTC. This independent control
      // has moving bars and calibration lines, and bypasses canvas capture timing.
      const {width, height, fps} = format;
      const frameBytes = width * height;
      const pixels = new Uint8Array(frameBytes * 3 / 2).fill(128);
      const track = new MediaStreamTrackGenerator({kind:'video'});
      const writer = track.writable.getWriter();
      for (let y = 0; y < height; y++) {
        const line = y * width;
        for (let x = 0; x < width; x++) pixels[line + x] = 44 + (Math.floor(x/48) ^ Math.floor(y/48)) % 8 * 12;
      }
      for (const [row, bar] of [2,4,8].entries()) {
        for (let y = 32+row*16; y < 46+row*16; y++) {
          for (let x = 0; x < 128; x++) pixels[y*width + 1088 + x] = Math.floor(x/bar)%2 ? 235 : 16;
        }
      }
      const band = 80 * width;
      const background = pixels.slice(band, band + 48*width);
      let n = 0;
      const start = performance.now();
      const pump = async () => {
        if (track.readyState !== 'live') { writer.releaseLock(); return; }
        pixels.set(background, band);
        const position = n++ * 16 % (width - 64);
        for (let y = 80; y < 128; y++) pixels.fill(235, y*width + position, y*width + position + 64);
        const frame = new VideoFrame(pixels, {format:'I420',codedWidth:width,codedHeight:height,timestamp:Math.round(performance.now()*1000)});
        try { await writer.write(frame); }
        finally { frame.close(); }
        window.qaDrawn = n;
        setTimeout(pump, Math.max(1, start + n*1000/fps - performance.now()));
      };
      await pump();
      return new MediaStream([track]);
    }
    const canvas = document.createElement('canvas');
    canvas.width = format.width;
    canvas.height = format.height;
    const ctx = canvas.getContext('2d', {alpha: false});
    const tile = document.createElement('canvas');
    tile.width = 256;
    tile.height = 160;
    const brush = tile.getContext('2d', {alpha: false});
    let seed = 167;
    const random = () => (seed = seed * 16807 % 2147483647);
    for (let i = 0; i < 700; i++) {
      brush.fillStyle = 'hsl(' + random() % 360 + ' 55% 45%)';
      brush.fillRect(random() % 256, random() % 160, 3 + random() % 30, 3 + random() % 26);
    }
    const pattern = ctx.createPattern(tile, 'repeat');
    let n = 0;
    const draw = () => {
      ctx.save();
      if (!gameScene) ctx.translate(n * 13 % 256, n * 3 % 160);
      ctx.fillStyle = pattern;
      ctx.fillRect(-256, -160, canvas.width + 256, canvas.height + 160);
      ctx.restore();
      if (gameScene) {
        // A fixed tactical map with multiple moving units and an animated HUD.
        for (let i = 0; i < 24; i++) {
          const x = (i * 157 + n * (30 / format.fps) * (1 + i % 3)) % canvas.width;
          const y = (i * (format.height === 720 ? 37 : 74) + Math.round(20 * Math.sin((n + i) / 20))) % canvas.height;
          ctx.fillStyle = i % 2 ? '#194459' : '#a3833a';
          ctx.fillRect(x, y, 26, 16);
          ctx.fillStyle = '#c7e7b3';
          ctx.fillRect(x + 2, y - 5, 18, 3);
        }
        ctx.fillStyle = '#19202e';
        ctx.fillRect(12, 12, 232, 42);
        ctx.fillStyle = '#dae9eb';
        ctx.font = '20px monospace';
        ctx.fillText('LINK   ' + Math.floor(n / format.fps) + ' s', 24, 40);
        // The static HUD targets make loss of fine edges measurable after decoding.
        for (const [row, width] of [2, 4, 8].entries()) {
          for (let x = 0; x < 128; x += width) {
            ctx.fillStyle = (x / width) % 2 ? '#ffffff' : '#000000';
            ctx.fillRect(1088 + x, 32 + row * 16, width, 14);
          }
        }
      }
      window.qaDrawn = ++n;
    };
    draw();
    const stream = canvas.captureStream(format.fps);
    const track = stream.getVideoTracks()[0];
    if (format.fps === 60) {
      const interval = 1000 / format.fps;
      let next = performance.now() + interval;
      const tick = () => {
        if (track.readyState !== 'live') return;
        draw();
        next += interval;
        if (next < performance.now()) next = performance.now() + interval;
        setTimeout(tick, Math.max(1, next - performance.now()));
      };
      setTimeout(tick, interval);
    } else {
      const timer = setInterval(() => {
        if (track.readyState === 'live') draw();
        else clearInterval(timer);
      }, 33);
    }
    return stream;
  };
}

async function openClient(name, nat) {
  const profile = path.join(directory, name);
  fs.mkdirSync(profile);
  const app = await _electron.launch({
    executablePath: testRuntime(),
    args: [path.join(__dirname, 'screen-sync-bootstrap.cjs'), '--no-error-dialogs', '--allow-loopback-in-peer-connection',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--mute-audio', '--use-fake-device-for-media-stream', '--craftlink-profile=' + path.basename(directory) + '-' + name],
    env: { ...process.env, QA_PROFILE_ROOT: profile, QA_APP_ENTRY: name === 'viewer' ? viewerEntry : entry }
  });
  apps.push(app);
  assert((await app.evaluate(({app}) => app.getPath('userData'))).startsWith(profile + path.sep));
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  await page.click('#entryLater');
  await page.evaluate(useTestNetwork, {port:nat.port, preferH264});
  return { app, page };
}

async function sample(outbound) {
  const stats = await window.qaPC.getStats();
  const rows = [...stats.values()];
  const media = rows.find(r => r.type === (outbound ? 'outbound-rtp' : 'inbound-rtp') && r.kind === 'video' && (r.framesEncoded || r.framesDecoded));
  if (!media) throw Error('No live video RTP counters');
  const pair = stats.get(rows.find(r => r.type === 'transport').selectedCandidatePairId);
  const sender = outbound ? window.qaPC.getSenders().find(s => s.track?.kind === 'video') : null;
  const params = sender?.getParameters();
  const source = stats.get(media.mediaSourceId);
  const audio = rows.find(r => r.type === 'inbound-rtp' && r.kind === 'audio' && r.mid === '2');
  let rms = 0;
  if (window.qaAudioAnalyser) {
    const samples = new Float32Array(window.qaAudioAnalyser.fftSize);
    window.qaAudioAnalyser.getFloatTimeDomainData(samples);
    rms = Math.sqrt(samples.reduce((sum, value) => sum + value ** 2, 0) / samples.length);
  }
  const videoSenders = outbound ? rows.filter(r => r.type === 'outbound-rtp' && r.kind === 'video')
    .map(r => ({mid:r.mid, frames:r.framesEncoded, target:r.targetBitrate, bytes:r.bytesSent, packets:r.packetsSent})) : undefined;
  return { videoSenders, encodeMsPerFrame: media.framesEncoded ? +(media.totalEncodeTime*1000/media.framesEncoded).toFixed(2) : undefined,
    codec: stats.get(media.codecId)?.mimeType, codecFmtp: stats.get(media.codecId)?.sdpFmtpLine,
    encoder: media.encoderImplementation ?? null, powerEfficientEncoder: media.powerEfficientEncoder ?? null,
    totalEncodeTime: media.totalEncodeTime, targetKbps: Math.round(media.targetBitrate / 1000) || undefined,
    cap: params ? {kbps: params.encodings[0]?.maxBitrate / 1000, fps: params.encodings[0]?.maxFramerate,
      scale: params.encodings[0]?.scaleResolutionDownBy, preference: params.degradationPreference} : undefined,
    priority: params?.encodings[0]?.priority, qp: media.qpSum, qualityChanges: media.qualityLimitationResolutionChanges,
    audioBytes: audio?.bytesReceived, soundRms: rms, rawFps: source?.framesPerSecond, sourceFrames: source?.frames, sourceSize: source ? [source.width, source.height].join('x') : undefined, audioSamples: audio?.totalSamplesReceived,
    detail: window.qaReadDetail?.(), t: media.timestamp, bytes: media.bytesSent ?? media.bytesReceived, frames: media.framesEncoded ?? media.framesDecoded,
    width: media.frameWidth, height: media.frameHeight, freezes: media.freezeCount, freezeSeconds: media.totalFreezesDuration,
    lost: media.packetsLost, received: media.packetsReceived, discarded: media.framesDropped, limitation: media.qualityLimitationReason,
    kbpsEstimate: Math.round(pair.availableOutgoingBitrate / 1000) || undefined, drawn: window.qaDrawn,
    route: stats.get(pair.remoteCandidateId)?.candidateType };
}

async function run(nat) {
  const {app, page: host} = await openClient('sender', nat);
  const {page: viewer} = await openClient('viewer', nat);
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  await clickPath(host, '#createBtn');
  await host.click('#hubManual');
  await host.fill('#nameInput', 'Stream sender');
  await host.fill('#addressInput', '127.0.0.1');
  await host.fill('#portInput', String(port));
  await host.click('#roomSubmitBtn');
  await host.waitForFunction(() => document.querySelector('#inviteDialog').open);
  const invite = await host.inputValue('#inviteOutput');
  await host.click('#inviteDoneBtn');
  await clickPath(viewer, '#joinBtn');
  await viewer.fill('#hubCode', invite);
  await viewer.click('#hubEnter');
  await viewer.fill('#nameInput', 'Stream viewer');
  await viewer.click('#roomSubmitBtn');
  await host.waitForFunction(() => document.querySelector('#participantsCount').textContent === '2 / 8');
  await host.exposeBinding('qaConsumeSelection', () => app.evaluate(({BrowserWindow}) => new Promise((resolve, reject) =>
    globalThis.qaDisplayRequest({frame: BrowserWindow.getAllWindows()[0].webContents.mainFrame, videoRequested: true},
      source => source?.video?.name === 'QA timing chart' ? resolve(true) : reject(Error('Test source was not selected'))))));
  await host.evaluate(installMovingSource, {gameScene, format, frameSource});
  if (qhd60) {
    if (await host.locator('#studioBtn').isVisible()) await host.click('#studioBtn');
    else {
      await host.click('#settingsBtn');
      await host.click('[data-pane=stream]');
    }
    await host.selectOption('#qualitySelect', '1440p60');
    // Older packages have manual limits only. Run their QHD source at the same ceiling.
    const hasAuto = await host.locator('#bitrateSelect option[value="0"]').count();
    if (hasAuto) assert.equal(await host.inputValue('#bitrateSelect'), '0', 'New profiles should use automatic bitrate');
    else await host.selectOption('#bitrateSelect', '32');
    await host.click('#closeSettingsDialog');
  }
  await host.click('#shareBtn');
  await host.click('#screenTabBtn');
  await host.setChecked('#withSystemAudio', withAudio);
  await host.locator('#sourcesGrid .source-card').first().click();
  await host.click('#startShare');
  await viewer.waitForFunction(() => document.querySelector('#remoteVideo').videoWidth > 0, null, {timeout: 40000});
  if (gameScene) await viewer.evaluate(format => {
    const strip = document.createElement('canvas');
    strip.width = 128;
    strip.height = 48;
    const ctx = strip.getContext('2d', {willReadFrequently: true});
    const video = document.querySelector('#remoteVideo');
    window.qaReadDetail = () => {
      // Expand only the receiver's decoded HUD region back to its source coordinates.
      const sx = video.videoWidth / format.width, sy = video.videoHeight / format.height;
      ctx.drawImage(video, 1088*sx, 32*sy, 128*sx, 48*sy, 0, 0, 128, 48);
      const pixels = ctx.getImageData(0, 0, 128, 48).data;
      return [2, 4, 8].map((width, row) => {
        let contrast = 0;
        for (let x = 0; x < 128; x += 2*width) {
          const dark = (row*16 + 7)*128 + x + Math.floor(width/2);
          contrast += pixels[4*(dark + width)] - pixels[4*dark];
        }
        return Math.max(0, contrast/(128/(2*width))/255);
      });
    };
  }, format);
  if (withAudio) {
    await viewer.waitForFunction(async () => [...(await window.qaPC.getStats()).values()].some(s => s.type === 'inbound-rtp' && s.mid === '2' && s.bytesReceived > 0));
    await viewer.evaluate(async () => {
      const ctx = new AudioContext();
      await ctx.resume();
      const track = window.qaPC.getTransceivers().find(t => t.mid === '2').receiver.track;
      const input = ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = ctx.createAnalyser();
      const silence = ctx.createGain();
      silence.gain.value = 0;
      input.connect(analyser).connect(silence).connect(ctx.destination);
      window.qaAudioAnalyser = analyser;
      window.qaAudioContext = ctx;
    });
  }
  assert(nat.stats().forwarded > 0, 'RTP route bypasses the network fixture');
  const phases = [
    ['clear', null, 22],
    ['weak', { mbps: 1.6, latencyMs: 45, ordered }, 42],
    ['recovered', null, 70],
  ];
  for (const [name, shape, seconds] of (startupOnly ? phases.slice(0,1) : phases)) {
    nat.shape(shape);
    const read = async () => {
      const [tx, rx] = await Promise.all([host.evaluate(sample, true), viewer.evaluate(sample, false)]);
      return {tx, rx, datagrams: nat.stats()};
    };
    const observations = [await read()];
    for (let i = 0; i < seconds / 2; i++) {
      await wait(2000);
      observations.push(await read());
    }
    const first = observations[0], last = observations.at(-1), settled = observations.at(-7);
    const duration = (last.rx.t - settled.rx.t) / 1000;
    const restored = observations.find(o => o.rx.height >= format.height && o.rx.frames > first.rx.frames);
    const smoothWindows = observations.slice(1).map((o, i) => {
      const prev = observations[i].rx;
      return (o.rx.frames - prev.frames) * 1000 / (o.rx.t - prev.t) >= (qhd60 ? 55 : 25);
    });
    const smooth = smoothWindows.findIndex((good, i) => good && smoothWindows[i + 1] && smoothWindows[i + 2]);
    const encodedFrames = last.tx.frames - settled.tx.frames;
    const result = {name, shape,
      encodeMsPerFrameLast12s: encodedFrames > 0 && Number.isFinite(settled.tx.totalEncodeTime) && Number.isFinite(last.tx.totalEncodeTime)
        ? +(1000 * (last.tx.totalEncodeTime - settled.tx.totalEncodeTime) / encodedFrames).toFixed(2) : null,
      hudContrastLast12s: gameScene ? [0,1,2].map(i => {
        const values = observations.slice(-7).map(o => o.rx.detail[i]).sort((a,b) => a-b);
        return +values[3].toFixed(2);
      }) : undefined,
      sourceFormat: format, testedFpsThreshold: qhd60 ? 55 : 25,
      firstSustainedFpsSeconds: smooth >= 0 ? +((observations[smooth + 1].rx.t - first.rx.t) / 1000).toFixed(1) : null,
      firstFullHeightSeconds: restored ? +((restored.rx.t - first.rx.t) / 1000).toFixed(1) : null,
      audioSamples: (last.rx.audioSamples - first.rx.audioSamples) || 0, audioBytes: (last.rx.audioBytes - first.rx.audioBytes) || 0,
      audioRms: Math.max(...observations.map(o => o.rx.soundRms)), initialSender: first.tx,
      meanQPLast12s: Math.round((last.tx.qp - settled.tx.qp) / Math.max(1, last.tx.frames - settled.tx.frames)),
      resolutionTimeline: observations.filter((o,i) => i === 0 || observations[i-1].rx.height !== o.rx.height)
        .map(o => [Math.round((o.rx.t-first.rx.t)/1000),o.rx.width,o.rx.height]), duration: Math.round((last.rx.t - first.rx.t) / 1000), frames: last.rx.frames - first.rx.frames,
      decodedFpsLast12s: +( (last.rx.frames - settled.rx.frames) / duration ).toFixed(1),
      kbpsLast12s: Math.round(8 * (last.rx.bytes - settled.rx.bytes) / duration / 1000),
      captureFpsLast12s: Number.isFinite(last.tx.sourceFrames) && Number.isFinite(settled.tx.sourceFrames) ? +((last.tx.sourceFrames - settled.tx.sourceFrames) / duration).toFixed(1) : null,
      sourceFpsLast12s: +((last.tx.drawn - settled.tx.drawn) / duration).toFixed(1),
      sizesLast12s: observations.slice(-7).map(o => [o.rx.width,o.rx.height].join('x')),
      freezeCount: last.rx.freezes - first.rx.freezes, freezeSeconds: +((last.rx.freezeSeconds ?? 0) - (first.rx.freezeSeconds ?? 0)).toFixed(2),
      framesDropped: last.rx.discarded - first.rx.discarded, lostPackets: last.rx.lost - first.rx.lost,
      receivedPackets: last.rx.received - first.rx.received, forwarded: last.datagrams.forwarded - first.datagrams.forwarded,
      reorderedByFixture: last.datagrams.reordered - first.datagrams.reordered,
      droppedByFixture: last.datagrams.dropped - first.datagrams.dropped, finalSender: last.tx};
    console.log('PHASE ' + JSON.stringify(result));
    if (preferH264) assert.equal(last.tx.codec, 'video/H264', 'H.264 trial negotiated a different codec');
    assert(result.frames > 0 && result.forwarded > 0 && result.kbpsLast12s > 0 && result.decodedFpsLast12s > 0);
    if (withAudio) assert(result.audioSamples > 0 && result.audioBytes > 0 && result.audioRms > .001, 'No incoming non-silent screen audio');
    if (name === 'weak') {
      assert(result.droppedByFixture > 0, 'Weak network must drop some packets');
      if (ordered) assert.equal(result.reorderedByFixture, 0, 'FIFO reordered UDP packets');
      else assert(result.reorderedByFixture > 0, 'Stress route must reorder UDP packets');
    }

  }
  const version = file => require(path.join(path.dirname(file), '../package.json')).version;
  console.log('PASS ' + JSON.stringify({senderVersion: version(entry), viewerVersion: version(viewerEntry), withAudio, ordered, gameScene, frameSource, format, preferH264}));
}

(async () => {
  const nat = await localNat();
  try { await run(nat); }
  catch (e) { console.error(e, nat.stats()); process.exitCode = 1; }
  finally {
    await Promise.allSettled(apps.map(a => a.close()));
    nat.close();
    fs.rmSync(directory, {recursive: true, force: true});
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
