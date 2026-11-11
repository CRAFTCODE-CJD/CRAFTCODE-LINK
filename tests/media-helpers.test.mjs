import test from 'node:test';
import assert from 'node:assert/strict';
import { trackIndex, trackIdentity, forwardedCandidate, stereoDescription, MAX_PARTICIPANTS, validIPv4 } from '../src/renderer/peer.mjs';
import { clampGain } from '../src/renderer/audio.mjs';

test('eight participant slots map bijectively to 24 explicit media roles', () => {
  assert.equal(MAX_PARTICIPANTS, 8);
  for (let i = 0; i < 24; i++) {
    const mapping = trackIdentity(i);
    assert.equal(trackIndex(mapping.slot, mapping.role), i);
  }
  assert.equal(trackIdentity(24), null);
  assert.equal(trackIdentity(-1), null);
  assert.throws(() => trackIndex(8, 'voice'));
  assert.throws(() => trackIndex(0, 'unknown'));
});

test('configured port-forward ICE candidate preserves original and routing identity', () => {
  const original = { candidate: 'candidate:1234 1 udp 2122260223 192.168.1.7 45837 typ host generation 0 ufrag AAA network-id 1', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'AAA' };
  const saved = JSON.stringify(original);
  const candidate = forwardedCandidate(original, '203.0.113.17');
  assert.match(candidate.candidate, /203\.0\.113\.17 45837 typ srflx raddr 192\.168\.1\.7 rport 45837/);
  assert.match(candidate.candidate, /ufrag AAA/);
  assert.equal(candidate.sdpMid, '0');
  assert.equal(candidate.sdpMLineIndex, 0);
  assert.equal(candidate.usernameFragment, 'AAA');
  assert.equal(JSON.stringify(original), saved);
});

test('configured candidates reject wrong transport, candidate type, IP and port', () => {
  const make = (s) => ({ candidate: s, sdpMid: '0', sdpMLineIndex: 0 });
  assert.equal(forwardedCandidate(make('candidate:1 1 tcp 1 192.168.1.1 45832 typ host'), '203.0.113.1'), null);
  assert.equal(forwardedCandidate(make('candidate:1 1 udp 1 192.168.1.1 45831 typ host'), '203.0.113.1'), null);
  assert.equal(forwardedCandidate(make('candidate:1 1 udp 1 192.168.1.1 45864 typ host'), '203.0.113.1'), null);
  assert.equal(forwardedCandidate(make('candidate:1 1 udp 1 192.168.1.1 45832 typ srflx'), '203.0.113.1'), null);
  assert.equal(forwardedCandidate(make('candidate:1 1 udp 1 ::1 45832 typ host'), '203.0.113.1'), null);
  assert.equal(forwardedCandidate(make('candidate:1 1 udp 1 192.168.1.1 45832 typ host'), 'bad.example'), null);
  assert.equal(forwardedCandidate(make('candidate:1 1 udp 1 203.0.113.1 45832 typ host'), '203.0.113.1'), null);
  assert.equal(forwardedCandidate(make('candidate:1 3 udp 1 192.168.1.1 45832 typ host'), '203.0.113.1'), null);
});

test('mDNS local candidate can advertise configured mapping without claiming discovery', () => {
  const candidate = forwardedCandidate({ candidate: 'candidate:abcd 1 udp 123 example.local 45863 typ host', sdpMid: '3', sdpMLineIndex: 3 }, '203.0.113.1');
  assert.match(candidate.candidate, /raddr 0\.0\.0\.0 rport 45863/);
});

test('IPv4 helper rejects wildcard, multicast and ambiguous octets', () => {
  for (const address of ['0.0.0.0', '224.0.0.1', '01.2.3.4', '256.2.3.4', '1.2.3', '::1']) assert.equal(validIPv4(address), false);
  assert.equal(validIPv4('192.168.1.1'), true);
  assert.equal(validIPv4('203.0.113.4'), true);
});

test('all BUNDLE Opus payloads have identical stereo fmtp, idempotently', () => {
  const header = 'v=0\r\na=group:BUNDLE 0 1 2\r\n';
  const audio = mid => `m=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:${mid}\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n`;
  const video = 'm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:1\r\na=rtpmap:96 VP8/90000\r\n';
  const original = { type: 'offer', sdp: header + audio(0) + video + audio(2) };
  const converted = stereoDescription(original);
  const fmtp = [...converted.sdp.matchAll(/^a=fmtp:111 ([^\r\n]+)/gm)].map(m => m[1]);
  assert.equal(fmtp.length, 2);
  assert.equal(fmtp[0], fmtp[1]);
  assert.match(fmtp[0], /stereo=1/);
  assert.match(converted.sdp, /a=rtpmap:96 VP8\/90000/);
  assert.deepEqual(stereoDescription(converted), converted);
  assert.equal(original.sdp.includes('stereo=1'), false);
});

test('local gain is bounded0–200 percent, including malformed input', () => {
  assert.equal(clampGain(100), 1);
  assert.equal(clampGain(200), 2);
  assert.equal(clampGain(0), 0);
  assert.equal(clampGain(-20), 0);
  assert.equal(clampGain(400), 2);
  assert.equal(clampGain('invalid'), 0);
});

test('extra headroom for quiet voices applies only to voice', () => {
  assert.equal(clampGain(400, 'voice'), 4);
  assert.equal(clampGain(600, 'voice'), 4);
  assert.equal(clampGain(400, 'system'), 2);
  assert.equal(clampGain(4, 'system'), 0.04);
});
