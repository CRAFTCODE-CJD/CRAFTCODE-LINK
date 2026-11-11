'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

// The real game sockets are bound to loopback. Between the two guest seats
// every packet goes through the actual membership checks and contact transport.
async function connectGame({ room, client, host, udp, datagram }, gamePort, clientPort = 0, capture = false) {
  const address = '127.0.0.1';
  const inside = await udp(clientPort);
  const outside = await udp();
  const counts = { toServer: 0, toClient: 0, bytesToServer: 0, bytesToClient: 0 };
  const first = { toServer: [], toClient: [] };
  let remotePort = 0;
  function record(direction, bytes) {
    counts[direction]++;
    counts[direction === 'toServer' ? 'bytesToServer' : 'bytesToClient'] += bytes.length;
    if (capture && first[direction].length < 200) {
      first[direction].push({ sequence: counts[direction], at: Date.now(), data: bytes.toString('base64') });
    }
  }
  inside.on('message', (bytes, sender) => {
    if (sender.address !== address || (remotePort && remotePort !== sender.port)) return;
    remotePort = sender.port;
    client.route(17, datagram(room, 17, 2, 44117, 7777, bytes), true);
  });
  outside.on('message', (bytes, sender) => {
    if (sender.address === address && sender.port === gamePort) {
      host.route(2, datagram(room, 2, 17, 7777, 44117, bytes), true);
    }
  });
  host.adapter = { close() {}, write(frame) {
    const bytes = frame.subarray(28);
    record('toServer', bytes);
    outside.send(bytes, gamePort, address);
  } };
  client.adapter = { close() {}, write(frame) {
    if (!remotePort) return;
    const bytes = frame.subarray(28);
    record('toClient', bytes);
    inside.send(bytes, remotePort, address);
  } };
  return { address, clientPort: inside.address().port, gamePort, counts, first,
    close() { client.adapter = host.adapter = null; } };
}

async function externalGame(options) {
  function portValue(raw) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw Error('Invalid loopback port: ' + raw);
    return n;
  }
  const ready = path.resolve(process.env.LINK_QA_GAME_RELAY_READY);
  const capture = process.env.LINK_QA_GAME_RELAY_CAPTURE;
  const gamePort = portValue(process.env.LINK_QA_GAME_UDP_PORT);
  const clientPort = process.env.LINK_QA_GAME_RELAY_PORT ? portValue(process.env.LINK_QA_GAME_RELAY_PORT) : 0;
  const stop = ready + '.done';
  if (await fs.stat(stop).then(() => true, () => false)) throw Error('Use a fresh relay readiness path');
  const relay = await connectGame(options, gamePort, clientPort, Boolean(capture));
  try {
    const endpoint = { address: relay.address, clientPort: relay.clientPort, gamePort, stop };
    await fs.mkdir(path.dirname(ready), { recursive: true });
    await fs.writeFile(ready, JSON.stringify(endpoint), { flag: 'wx' });
    console.log('Game relay listening:', endpoint);
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline && !await fs.stat(stop).then(() => true, () => false)) await delay(250);
    console.log('External game datagrams through LINK:', relay.counts);
    if (capture) await fs.writeFile(capture, JSON.stringify({ ...endpoint, counts: relay.counts, packets: relay.first }));
    if (!relay.counts.toServer || !relay.counts.toClient) throw Error('Missing bidirectional game traffic');
    // The caller checks actual gameplay. Packet counts prove transport only.
  } finally {
    relay.close();
  }
}

module.exports = { connectGame, externalGame };
