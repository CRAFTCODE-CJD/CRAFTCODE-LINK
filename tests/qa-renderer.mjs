import { RoomMedia, ROLES, trackIdentity } from '../src/renderer/peer.mjs';
import { AudioMixer } from '../src/renderer/audio.mjs';

const id = new URL(location.href).searchParams.get('id');
let media = null;
let peers = [];
let currentId = id;
let slot = id === 'host' ? 0 : Number(id.slice(1));
const errors = [];
const states = [];
const signals = [];
const buffered = [];
const contexts = new Set();
const oscillators = new Set();
const videoTimers = new Set();
const generated = new Set();
const videos = new Map();
const received = new Map();
let mixer = new AudioMixer({ onError: error => errors.push(String(error)) });
let generation = 0;

window.qaBridge.onSignal(({ from, data }) => {
  if (!media) buffered.push({ from, data });
  else media.acceptSignal(from, data);
});

function makeAudio(role) {
  const context = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
  contexts.add(context);
  const destination = context.createMediaStreamDestination();
  destination.channelCount = role === 'system' ? 2 : 1;
  const oscillator = context.createOscillator();
  oscillator.frequency.value = role === 'voice' ? 220 + slot * 137 : 970 + slot * 173;
  const gain = context.createGain();
  gain.gain.value = 0.12;
  oscillator.connect(gain).connect(destination);
  oscillator.start();
  oscillators.add(oscillator);
  context.resume();
  const track = destination.stream.getAudioTracks()[0];
  track.contentHint = role === 'system' ? 'music' : 'speech';
  generated.add(track);
  return track;
}

function makeVideo() {
  generation++;
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 180;
  const context = canvas.getContext('2d');
  document.getElementById('local').replaceChildren(canvas);
  let frame = 0;
  const draw = () => {
    context.fillStyle = ['#b9233d', '#21834f', '#2047b5'][slot % 3];
    context.fillRect(0, 0, 320, 180);
    context.fillStyle = 'white'; context.font = '22px sans-serif';
    context.fillText(`${currentId} / ${generation} / ${frame++}`, 20, 36);
    context.fillRect(20 + (frame * 3) % 240, 105, 30, 30);
  };
  draw();
  const timer = setInterval(draw, 80);
  videoTimers.add(timer);
  const stream = canvas.captureStream(12);
  const track = stream.getVideoTracks()[0];
  track.contentHint = 'motion';
  generated.add(track);
  return track;
}

async function onTrack({ slot: remoteSlot, role, track }) {
  const key = `${remoteSlot}:${role}`;
  if (!track) {
    received.delete(key);
    const existing = videos.get(remoteSlot);
    if (role === 'screen' && existing) { existing.srcObject = null; existing.remove(); videos.delete(remoteSlot); }
    const peerId = peers.find(peer => peer.slot === remoteSlot)?.id;
    if (peerId && role !== 'screen') mixer.detach(peerId, role);
    return;
  }
  received.set(key, track);
  if (role === 'screen') {
    let video = videos.get(remoteSlot);
    if (!video) {
      video = document.createElement('video');
      video.autoplay = true; video.muted = true; video.playsInline = true;
      video.width = 240;
      video.dataset.slot = String(remoteSlot);
      document.getElementById('receivers').append(video);
      videos.set(remoteSlot, video);
    }
    video.srcObject = new MediaStream([track]);
    video.play().catch(error => { if (error.name !== 'AbortError') errors.push(`play: ${error.message}`); });
  } else {
    const peerId = peers.find(peer => peer.slot === remoteSlot)?.id;
    if (peerId) await mixer.attach(peerId, role, track);
  }
}

async function init(nextPeers, nextId = id) {
  peers = nextPeers; currentId = nextId;
  slot = peers.find(peer => peer.id === currentId).slot;
  // Test-only fake device permission, matching the real application's explicit microphone consent.
  // This also lets Chromium expose local ICE addresses without relying on multicast DNS.
  const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  permissionStream.getTracks().forEach(track => track.stop());
  const session = { role: slot === 0 ? 'host' : 'guest', selfId: currentId, hostId: 'host', peers,
    publicAddress: '127.0.0.1', udpMin: 45832, udpMax: 45863 };
  media = new RoomMedia({ session,
    sendSignal: message => { signals.push({ to: message.peerId, type: message.data.type }); window.qaBridge.signal(message); },
    onTrack: event => onTrack(event).catch(error => errors.push(error.message)),
    onState: state => states.push(state), onError: error => errors.push(error),
  });
  await mixer.start();
  // Use an own-only roster first so all source tracks exist before the first host offer.
  await media.updatePeers([peers.find(peer => peer.id === currentId)]);
  for (const role of ROLES) await media.setLocalTrack(role, role === 'screen' ? makeVideo() : makeAudio(role));
  for (const message of buffered.splice(0)) await media.acceptSignal(message.from, message.data);
  return true;
}

async function roster(nextPeers) {
  peers = nextPeers;
  await media.updatePeers(peers);
  // A reused forwarded slot retains its WebRTC receiver; rebind local playback to the new identity.
  for (const peer of peers) for (const role of ['voice', 'system']) {
    const track = received.get(`${peer.slot}:${role}`);
    if (track && peer.id !== currentId) await mixer.attach(peer.id, role, track);
  }
}

// Observe the raw received PCM independently from the listener's volume controls.
function receivedSpectrum() {
  const peaks = {};
  for (const [key, entry] of mixer.sources) {
    if (!entry.qaAnalyser) {
      entry.qaAnalyser = mixer.context.createAnalyser();
      entry.qaAnalyser.fftSize = 4096;
      entry.qaAnalyser.smoothingTimeConstant = 0;
      entry.source.connect(entry.qaAnalyser);
    }
    const levels = new Float32Array(entry.qaAnalyser.frequencyBinCount);
    entry.qaAnalyser.getFloatFrequencyData(levels);
    let index = 0;
    for (let i = 1; i < levels.length; i++) if (levels[i] > levels[index]) index = i;
    peaks[key] = { hz: index * mixer.context.sampleRate / entry.qaAnalyser.fftSize,
      db: Number.isFinite(levels[index]) ? levels[index] : -200 };
  }
  return peaks;
}

async function snapshot() {
  const connections = [];
  for (const ep of media?.endpoints.values() || []) {
    const report = await ep.pc.getStats();
    const inbound = [];
    const outgoing = [];
    const candidates = [];
    let selectedTransport = null;
    report.forEach(stat => {
      if (stat.type === 'inbound-rtp') inbound.push({ mid: stat.mid, kind: stat.kind, bytes: stat.bytesReceived,
        packets: stat.packetsReceived, frames: stat.framesDecoded, width: stat.frameWidth, height: stat.frameHeight,
        totalAudioEnergy: stat.totalAudioEnergy, totalSamplesReceived: stat.totalSamplesReceived });
      if (stat.type === 'outbound-rtp') outgoing.push({ mid: stat.mid, kind: stat.kind, bytes: stat.bytesSent, frames: stat.framesEncoded });
      if (stat.type === 'transport' && stat.selectedCandidatePairId) {
        const pair = report.get(stat.selectedCandidatePairId);
        const local = report.get(pair?.localCandidateId);
        const remote = report.get(pair?.remoteCandidateId);
        selectedTransport = { protocol: local?.protocol, localPort: local?.port, remotePort: remote?.port };
      }
      if (stat.type === 'local-candidate') candidates.push({ protocol: stat.protocol, type: stat.candidateType, port: stat.port });
    });
    connections.push({ id: ep.id, state: ep.pc.connectionState, iceState: ep.pc.iceConnectionState, gatheringState: ep.pc.iceGatheringState,
      signalingState: ep.pc.signalingState, localDescription: ep.pc.localDescription?.type, remoteDescription: ep.pc.remoteDescription?.type,
      opusFmtp: [...new Set((ep.pc.localDescription?.sdp.match(/^a=fmtp:111 .*$/gm) || []).map(value => value.trim()))],
      configuration: ep.pc.getConfiguration(), inbound, outgoing, candidates, selectedTransport,
      senders: ep.pc.getTransceivers().map((transceiver, index) => ({ index, ...trackIdentity(index), mid: transceiver.mid,
        direction: transceiver.direction, currentDirection: transceiver.currentDirection,
        trackId: transceiver.sender.track?.id || null, readyState: transceiver.sender.track?.readyState || null,
        enabled: transceiver.sender.track?.enabled ?? null })),
    });
  }
  return { id: currentId, slot, peaks: receivedSpectrum(), errors: errors.slice(), states: states.slice(), signals: signals.slice(), connections,
    received: [...received].map(([key, track]) => ({ key, id: track.id, kind: track.kind, enabled: track.enabled, muted: track.muted, readyState: track.readyState })),
    videos: [...videos].map(([remoteSlot, video]) => ({ slot: remoteSlot, width: video.videoWidth, height: video.videoHeight,
      readyState: video.readyState, frames: video.getVideoPlaybackQuality().totalVideoFrames })),
    mixer: { deafened: mixer.deafened, masterGain: mixer.master?.gain.value,
      entries: [...mixer.sources].map(([key, item]) => ({ key, gain: item.gain.gain.value, trackId: item.track.id, enabled: item.track.enabled })) },
  };
}

async function setMix(peerId, role, settings) { return mixer.setSetting(peerId, role, settings); }
async function deafen(value) { mixer.setDeafened(value); }
async function stopVideo() {
  const track = media.getTrack(slot, 'screen');
  await media.setLocalTrack('screen', null);
  track?.stop();
}
async function startVideo() { await media.setLocalTrack('screen', makeVideo()); }
async function replaceAudio(role) {
  const old = media.getTrack(slot, role);
  await media.setLocalTrack(role, makeAudio(role));
  old?.stop();
}
async function mixerRace() {
  const local = new AudioMixer();
  await local.start();
  const sourceTrack = makeAudio('voice');
  const createSource = local.context.createMediaStreamSource.bind(local.context);
  let created = 0;
  const connected = new Set();
  local.context.createMediaStreamSource = stream => {
    const source = createSource(stream);
    created++;
    const connect = source.connect.bind(source);
    const disconnect = source.disconnect.bind(source);
    source.connect = (...args) => { connected.add(source); return connect(...args); };
    source.disconnect = (...args) => { connected.delete(source); return disconnect(...args); };
    return source;
  };
  await Promise.all(Array.from({ length: 12 }, () => local.attach('race', 'voice', sourceTrack)));
  const outcome = { createdAfterConcurrent: created, connectedAfterConcurrent: connected.size, mapAfterConcurrent: local.sources.size };
  local.detach('race', 'voice');
  outcome.afterDetach = { connected: connected.size, entries: local.sources.size };
  const pendingDetach = local.attach('race', 'voice', sourceTrack);
  local.detach('race', 'voice');
  await pendingDetach;
  outcome.afterPendingDetach = { connected: connected.size, entries: local.sources.size };
  const pendingClose = local.attach('race', 'voice', sourceTrack);
  await local.close();
  await pendingClose;
  outcome.afterClose = { connected: connected.size, entries: local.sources.size };
  outcome.rawTrackUnmodified = sourceTrack.enabled && sourceTrack.readyState === 'live';
  sourceTrack.stop();
  return outcome;
}
async function close() {
  media?.close(); media = null;
  await mixer.close(); mixer = new AudioMixer({ onError: error => errors.push(String(error)) });
  for (const timer of videoTimers) clearInterval(timer);
  for (const oscillator of oscillators) { try { oscillator.stop(); } catch {} }
  for (const track of generated) track.stop();
  for (const context of contexts) if (context.state !== 'closed') await context.close();
  contexts.clear(); generated.clear(); oscillators.clear(); videoTimers.clear();
  received.clear(); for (const video of videos.values()) video.remove(); videos.clear();
}

window.qa = { ready: true, init, roster, snapshot, setMix, deafen, stopVideo, startVideo, replaceAudio, mixerRace, close };
