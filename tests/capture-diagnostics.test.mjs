import test from 'node:test';
import assert from 'node:assert/strict';
import { removeDisplayAudio } from '../src/renderer/capture.mjs';
import { inboundCounters } from '../src/renderer/peer.mjs';
import { readEvidence, advancing } from './rtp-evidence.cjs';

test('playout offset pairs fresh screen and system clocks for the same participant', () => {
  const row=(mid,kind,playout)=>({type:'inbound-rtp',mid,kind,timestamp:8000,lastPacketReceivedTimestamp:7950,
    estimatedPlayoutTimestamp:playout});
  const video=row('1','video',2000),system=row('2','audio',1950);
  const skew=(...rows)=>inboundCounters(rows)[0]?.estimatedScreenSkewMs;
  assert.equal(skew(video,system,row('0','audio',2900)),-50);
  assert.equal(skew(video,row('5','audio',2700)),undefined);
  assert.equal(skew(video,{...system,lastPacketReceivedTimestamp:6000}),undefined);
  assert.equal(skew(video,{...system,estimatedPlayoutTimestamp:null}),undefined);
  assert.equal(skew(video,{...system,estimatedPlayoutTimestamp:2000}),0);
  assert.equal(skew(video,system,{...system,estimatedPlayoutTimestamp:1960}),undefined);
});

function audioFixture(...settings) {
  const tracks = settings.map(value => ({
    readyState: 'live', getSettings: () => value, stop() { this.readyState = 'ended'; },
  }));
  const active = new Set(tracks);
  return { tracks, stream: { getAudioTracks: () => [...active], removeTrack: t => active.delete(t) } };
}

test('every display audio track is stopped before forwarding, regardless of browser metadata', () => {
  const {tracks,stream}=audioFixture({}, {deviceId:'loopback'}, {restrictOwnAudio:true}, {deviceId:'loopbackWithoutChrome'});
  removeDisplayAudio(stream);
  assert.deepEqual(stream.getAudioTracks(),[]);
  assert.ok(tracks.every(track=>track.readyState==='ended'));
});
test('diagnostics count only measured inbound media by slot and role, never raw identities', () => {
  const stats = [
    { type: 'transport', address: '192.168.1.1' },
    { mid: '3', kind: 'audio', bytesReceived: 150 },
    { mid: '4', kind: 'video', bytesReceived: 5000, framesDecoded: 7 },
    { mid: '5', kind: 'audio', bytesReceived: 250 },
    { mid: '4', kind: 'video', bytesReceived: 50, framesDecoded: 1 },
    { mid: '30', kind: 'audio', bytesReceived: 800 },
    { mid: null, kind: 'audio', bytesReceived: 800 },
    { mid: '3', kind: 'video', bytesReceived: 1000 },
  ].map(row => ({ type: 'inbound-rtp', ssrc: 'private', ...row }));
  assert.deepEqual(inboundCounters(stats), [{ slot: 1, voiceBytes: 150, systemBytes: 250, screenBytes: 5050, framesDecoded: 8 }]);
});

test('live evidence requires fresh audio samples and the expected test tones, bytes and decoded frames on the intended host link', () => {
  const sender = { id: 'g1', slot: 1 };
  const conn = { id: 'g1', state: 'connected', inbound: [
    { mid: '3', bytes: 50, totalSamplesReceived: 480 }, { mid: '4', bytes: 80, frames: 1 }, { mid: '5', bytes: 70, totalSamplesReceived: 480 },
  ] };
  const sample = c => readEvidence([{ id: 'host', slot: 0, peaks: { 'g1:voice': { hz: 357, db: -24 }, 'g1:system': { hz: 1143, db: -24 } }, connections: [c] }], [sender]);
  const zero = sample({ ...conn, inbound: [] }), real = sample(conn);
  assert.ok(advancing(zero, real));
  assert.equal(advancing(real, real), false);
  assert.equal(advancing(zero, [{ ...real[0], systemPeak: { hz: 357, db: -24 } }]), false);
  assert.equal(advancing(zero, [{ ...real[0], framesDecoded: 0 }]), false);
  assert.equal(advancing(zero, sample({ ...conn, id: 'g2' })), false);
});

test('reports from both Windows peers with stable SDP and only host candidates surface a contextual action',async()=>{
  const {routeProblem}=await import('../src/renderer/diagnostics.mjs');
  const sample={remoteSdp:true,state:'connecting',gatheringState:'complete',routeAge:48000,candidateType:'',
    localTypes:['host'],remoteTypes:['host'],servers:[]};
  const saved={publicStun:false,proxyOnly:false};
  assert.deepEqual(routeProblem([sample],saved),{stalled:true,hostOnly:true,offerStun:true});
  assert.equal(routeProblem([sample],{...saved,proxyOnly:true}).offerStun,false);
  assert.equal(routeProblem([{...sample,servers:['stun']}],saved).offerStun,false);
  assert.equal(routeProblem([{...sample,remoteTypes:['srflx']}],saved).hostOnly,false);
  assert.equal(routeProblem([{...sample,candidateType:'host',state:'connected'}],saved).stalled,false);
  assert.equal(routeProblem([{...sample,routeAge:1000}],saved).offerStun,false);
});
