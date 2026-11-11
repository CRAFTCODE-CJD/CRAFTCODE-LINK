'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const {
  encodeInvite, decodeInvite, validateAddress, validatePort, validateUdpRange,
  DEFAULT_PORT, DEFAULT_UDP_MIN, DEFAULT_UDP_MAX,
} = require('../src/core/invite.cjs');
const { validateName, validateChat, validatePresence, validateSignal, validateRoster, LIMITS } = require('../src/core/protocol.cjs');

function example(overrides = {}) {
  return { address: '203.0.113.7', port: DEFAULT_PORT, token: randomBytes(32).toString('base64url'),
    fingerprint: randomBytes(32).toString('hex'), udpMin: DEFAULT_UDP_MIN, udpMax: DEFAULT_UDP_MAX, ...overrides };
}

test('invitation round-trips exact room credentials and configured UDP range', () => {
  const input = example();
  const code = encodeInvite(input);
  assert.match(code, /^CL1:[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeInvite(`  ${code}\n`), { version: 1, ...input });
  assert.equal(DEFAULT_UDP_MAX, 45863);
  assert.equal(Object.isFrozen(decodeInvite(code)), true);
});

test('invitation allows LAN/loopback IPv4 and normal DNS, but not URLs or host:port', () => {
  for (const value of ['192.168.1.2', '127.0.0.1', '10.0.0.7', 'example.com', 'my-room.example.org', 'localhost']) {
    assert.equal(decodeInvite(encodeInvite(example({ address: value }))).address, value);
  }
  assert.equal(validateAddress('My-Room.Example.COM.'), 'my-room.example.com');
  for (const bad of ['https://example.com', 'user@example.com', '1.2.3.4:45831', 'localhost/x', '[::1]', '::1',
    '0.0.0.0', '239.1.2.3', '255.255.255.255', '999.2.3.4', '127.000.0.1', 'bad name', '-bad.com',
    'bad-.com', 'a..com', 'bad\n.com', '', 'a'.repeat(64) + '.com']) {
    assert.throws(() => validateAddress(bad), { name: 'RoomError' }, bad);
  }
});

test('invitation rejects malformed encoding, wrong version, missing/extra fields and corrupt credentials', () => {
  const input = example();
  const code = encodeInvite(input);
  const raw = JSON.parse(Buffer.from(code.slice(4), 'base64url').toString('utf8'));
  const pack = (data) => 'CL1:' + Buffer.from(JSON.stringify(data)).toString('base64url');
  for (const bad of ['', 'foo', code + '=', code + '!', 'CL1:' + 'x'.repeat(2050), 'CL1:!!!',
    pack(null), pack([]), pack({ ...raw, v: 2 }), pack({ ...raw, extra: 1 }),
    pack({ ...raw, t: 'short' }), pack({ ...raw, f: 'f'.repeat(63) }), pack({ ...raw, u: [45832] }),
    pack({ ...raw, p: '45831' }), pack({ ...raw, a: undefined })]) {
    assert.throws(() => decodeInvite(bad), { name: 'RoomError' });
  }
});

test('ports and UDP ranges have finite, narrow integer bounds', () => {
  assert.equal(validatePort(45831), 45831);
  assert.equal(validatePort(0, { allowZero: true }), 0);
  assert.deepEqual(validateUdpRange(45832, 45863), { udpMin: 45832, udpMax: 45863 });
  for (const bad of [0, -1, 65536, 1.5, NaN, Infinity, '45831', null]) assert.throws(() => validatePort(bad));
  for (const pair of [[0, 40], [45863, 45832], [45832, 60000], [65500, 65600], [45832.5, 45863]]) {
    assert.throws(() => validateUdpRange(...pair));
  }
});

test('names, chat and presence validate types and never accept spoofed identity fields', () => {
  assert.equal(validateName(' Анна '), 'Анна');
  assert.equal(validateChat(' привет\nдруг '), 'привет\nдруг');
  for (const name of ['', ' ', 'a'.repeat(49), 'x\ny', 'x\u202ey', 17]) assert.throws(() => validateName(name));
  for (const chat of ['', 'a'.repeat(4001), 'x\0y', null]) assert.throws(() => validateChat(chat));
  assert.deepEqual(validatePresence({ sharing: false, shareTitle: 'obsolete' }), { sharing: false, shareTitle: '' });
  for (const presence of [{}, { micMuted: 1 }, { name: 'spoof' }, { sharing: 'yes' }, { shareTitle: '\n' }]) {
    assert.throws(() => validatePresence(presence));
  }
});

test('signal payloads are bounded deep JSON objects and reject prototype pollution keys', () => {
  const signal = { type: 'candidate', candidate: { candidate: 'candidate:1 1 udp 1 192.168.1.2 45832 typ host', sdpMid: '0' } };
  const copy = validateSignal(signal);
  assert.deepEqual(copy, signal);
  assert.notEqual(copy, signal);
  assert.throws(() => validateSignal({ sdp: 'a'.repeat(LIMITS.signalBytes + 1) }));
  assert.throws(() => validateSignal(JSON.parse('{"__proto__":{"admin":true}}')));
  assert.throws(() => validateSignal([]));
  const loop = {}; loop.loop = loop;
  assert.throws(() => validateSignal(loop));
  let deep = {}; for (let i = 0; i < 15; i++) deep = { deep };
  assert.throws(() => validateSignal(deep));
});

test('rosters enforce host slot0, unique identities/slots and capacity8', () => {
  const peer = (slot) => ({ id: slot === 0 ? 'host' : randomBytes(12).toString('base64url'), name: `User ${slot}`,
    slot, micMuted: true, sharing: false, shareTitle: '' });
  const peers = Array.from({ length: 8 }, (_, slot) => peer(slot));
  assert.deepEqual(validateRoster(peers), peers);
  assert.throws(() => validateRoster([...peers, peer(8)]));
  assert.throws(() => validateRoster([peers[0], { ...peers[1], slot: 0 }]));
  assert.throws(() => validateRoster([peers[0], peers[1], { ...peers[2], id: peers[1].id }]));
  assert.throws(() => validateRoster([peers[1]]));
});
