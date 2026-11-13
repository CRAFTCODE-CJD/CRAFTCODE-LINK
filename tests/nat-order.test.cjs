'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const { once } = require('node:events');
const { setTimeout: wait } = require('node:timers/promises');
const { localNat } = require('./nat-fixture.cjs');

async function mappedPort(socket, nat) {
  socket.bind(0, '127.0.0.1');
  await once(socket, 'listening');
  const request = Buffer.alloc(20);
  request.writeUInt16BE(1);
  request.writeUInt32BE(0x2112a442, 4);
  const reply = once(socket, 'message');
  socket.send(request, nat.port, '127.0.0.1');
  const [packet] = await reply;
  return packet.readUInt16BE(26) ^ 0x2112;
}

test('numbered UDP packets preserve FIFO and expose reordering on the stress route', {timeout: 8000}, async t => {
  const nat = await localNat();
  const source = dgram.createSocket('udp4');
  const receiver = dgram.createSocket('udp4');
  t.after(() => { source.close(); receiver.close(); nat.close(); });
  const [, destination] = await Promise.all([mappedPort(source, nat), mappedPort(receiver, nat)]);
  for (const ordered of [true, false]) {
    nat.shape({mbps: 1.6, latencyMs: 45, ordered});
    const before = nat.stats();
    const received = [];
    const record = packet => received.push(packet.readUInt16BE(0));
    receiver.on('message', record);
    // 196 small packets fit the 110 ms queue even if dispatched as one burst.
    for (let index = 1; index <= 196; index++) {
      const packet = Buffer.alloc(32);
      packet.writeUInt16BE(index);
      source.send(packet, destination, '127.0.0.1');
    }
    const deadline = performance.now() + 3000;
    while (received.length < 194 && performance.now() < deadline) await wait(10);
    receiver.off('message', record);
    assert.equal(received.length, 194);
    const expected = Array.from({length: 196}, (_, i) => i + 1).filter(i => i % 97);
    assert.deepEqual([...received].sort((a, b) => a - b), expected);
    let last = 0, reordered = 0;
    for (const index of received) {
      if (index < last) reordered++;
      else last = index;
    }
    const after = nat.stats();
    assert.equal(after.dropped - before.dropped, 2);
    assert.equal(after.reordered - before.reordered, reordered);
    if (ordered) assert.equal(reordered, 0);
    else assert(reordered > 0);
  }
});
