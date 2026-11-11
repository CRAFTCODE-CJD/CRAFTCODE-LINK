'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { GameRoom } = require('../src/game/room.cjs');
const { GameNetwork } = require('../src/game/network.cjs');
const { PORT } = require('../src/game/path-check.cjs');

const members = ['Host', 'Guest', 'Other'].map((name, i) => ({
  name, id: String(i + 1).repeat(64), device: String(i + 4).repeat(64), slot: i + 1, ready: true
}));

test('a second friend cannot replace or reuse the LAN invitation selected by the user', () => {
  const [self, first, other] = members;
  const sent = [];
  const room = new GameRoom({
    self: () => self, links: id => members.filter(card => card.id === id).map(card => ({
      card, send(message) { sent.push({ id, message }); return true; }
    })), changed() {}, event() {}, quiet: () => false
  });
  const id = randomUUID();
  const invitation = { action: 'invite', room: id, title: 'Game', expires: Date.now() + 45000, ticket: randomUUID() };
  room.receive(first, invitation);
  const chosen = room.state().invitations[0].id;
  for (const wireValue of [id, invitation.ticket]) {
    for (const decision of [true, false]) assert.throws(() => room.answer(wireValue, decision));
  }
  assert.equal(sent.length, 0);
  assert.equal(room.active, null);
  assert.equal(room.state().invitations[0].id, chosen);
  room.receive(other, { ...invitation, ticket: randomUUID() });
  assert.equal(room.state().invitations[0].name, first.name);
  room.receive(first, { action: 'end', room: id, ticket: invitation.ticket });
  room.receive(other, { ...invitation, ticket: randomUUID() });
  assert.throws(() => room.answer(chosen, true));
  assert.throws(() => room.answer(id, true));
  assert.equal(room.active, null);
  room.answer(room.state().invitations[0].id, true);
  assert.equal(room.active.owner.device, other.device);
  assert.equal(sent.at(-1).message.room, id);
  assert.equal(sent.at(-1).id, other.id);
  assert.throws(() => room.answer(chosen, false));
});

test('a peer cannot deliver diagnostic payloads to a port occupied by another application', async t => {
  const local = '127.126.52.1';
  const blocker = dgram.createSocket('udp4'), injector = dgram.createSocket('udp4');
  const unexpected = [];
  blocker.on('message', data => unexpected.push(data));
  const bound = once(blocker, 'listening');
  blocker.bind(PORT, local);
  await bound;
  t.after(() => blocker.close());
  const roster = members.map(p => ({ ...p }));
  const room = { active: { id: randomUUID(), prefix: '10.90.2', host: true, roster },
    self: () => roster[0], link: () => null, adapterReady() {} };
  const net = new GameNetwork(room, () => {});
  t.after(() => { net.stop(); injector.close(); });
  injector.bind(0, local);
  await once(injector, 'listening');
  net.phase = 'ready';
  net.pathCheck.open(local);
  for (let i = 0; i < 100 && net.pathCheck.result.state === 'binding'; i++) await delay(10);
  const port = net.pathCheck.port;
  assert(port && port !== PORT);
  const writes = [];
  net.adapter = { close() {}, write(data) {
    const dest = data.readUInt16BE(22);
    writes.push(dest);
    injector.send(data.subarray(28), dest, local);
  } };
  function attack(sport, dport, to = 1) {
    const frame = Buffer.alloc(50);
    frame[0] = 0x45; frame[9] = 17; frame.writeUInt16BE(frame.length, 2);
    frame.set([10, 90, 2, 2, 10, 90, 2, to], 12);
    frame.writeUInt16BE(sport, 20); frame.writeUInt16BE(dport, 22); frame.writeUInt16BE(30, 24);
    frame.write('CCLG1', 28); frame[33] = 1; frame.fill(0x61, 34);
    net.receive(roster[1], { room: room.active.id, frames: [frame.toString('base64')] });
  }
  attack(PORT, PORT);
  await delay(45);
  assert.equal(unexpected.length, 0, 'packet reached the unrelated real UDP listener');
  attack(PORT, port);
  assert.deepEqual(writes, [port], 'legacy peer may reach the actual LINK socket');
  roster[1].probePort = 32647;
  attack(PORT, port);
  attack(32647, port);
  assert.deepEqual(writes, [port, port]);
  roster[2].probePort = port;
  attack(32647, PORT, 3);
  assert.equal(net.queues.size, 0, 'relay rejects a mismatched destination port');
  attack(32647, port, 3);
  assert.equal(net.queues.get(roster[2].device).frames.length, 1);
  net.pathCheck.close();
  attack(32647, port);
  assert.deepEqual(writes, [port, port], 'no packets are injected after local diagnostics close');
});
