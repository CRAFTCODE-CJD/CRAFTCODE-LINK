'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const tls = require('node:tls');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { startHost, joinHost, LIMITS } = require('../src/core/session.cjs');
const { encodeInvite, decodeInvite } = require('../src/core/invite.cjs');
const { createRoomCertificate } = require('../src/core/certificate.cjs');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(predicate, timeout = 2500) {
  const end = performance.now() + timeout;
  while (performance.now() < end) {
    const result = predicate();
    if (result) return result;
    await delay(10);
  }
  assert.fail('Timed out waiting for network evidence');
}

async function room(t) {
  const events = [];
  const host = await startHost({ name: 'Создатель', address: '127.0.0.1', port: 0, onEvent: (event) => events.push(event) });
  t.after(() => host.close());
  return { host, events };
}

async function guest(t, host, name) {
  const events = [];
  const session = await joinHost({ name, invite: host.getInfo().invite, onEvent: (event) => events.push(event) });
  t.after(() => session.close());
  return { session, events };
}

async function rawClient(t, host, { authenticate = true } = {}) {
  const invitation = decodeInvite(host.getInfo().invite);
  const socket = tls.connect({ host: '127.0.0.1', port: invitation.port, rejectUnauthorized: false, minVersion: 'TLSv1.2' });
  socket.on('error', () => {});
  t.after(() => socket.destroy());
  const messages = [];
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      messages.push(JSON.parse(buffer.slice(0, i)));
      buffer = buffer.slice(i + 1);
    }
  });
  await once(socket, 'secureConnect');
  const write = (message) => socket.write(JSON.stringify(message) + '\n');
  if (authenticate) {
    write({ type: 'hello', v: 1, token: invitation.token, name: 'Raw tester' });
    await eventually(() => messages.find((message) => message.type === 'welcome'));
  }
  return { socket, messages, write, invitation };
}

test('real TLS room: bidirectional signaling, stamped chat and no cloud service', async (t) => {
  const { host, events: hostEvents } = await room(t);
  const { session: client, events } = await guest(t, host, 'Друг');
  const id = client.getInfo().selfId;
  assert.equal(host.getInfo().peers.length, 2);
  assert.equal(client.getInfo().hostId, 'host');
  assert.equal(client.getInfo().udpMax, 45863);
  assert.equal(client.getInfo().peers.find((peer) => peer.id === id).slot, 1);
  assert.equal(client.getInfo().invite, undefined);

  host.sendSignal(id, { type: 'offer', sdp: 'synthetic test signaling payload' });
  const received = await eventually(() => events.find((event) => event.type === 'signal'));
  assert.equal(received.from, 'host');
  assert.equal(received.data.type, 'offer');
  client.sendSignal('host', { type: 'answer', sdp: 'reply' });
  assert.equal((await eventually(() => hostEvents.find((event) => event.type === 'signal'))).from, id);
  client.sendChat('Привет <script>literal text</script>');
  const chat = await eventually(() => hostEvents.find((event) => event.type === 'chat'));
  assert.equal(chat.name, 'Друг');
  assert.equal(chat.from, id);
  assert.equal(chat.text, 'Привет <script>literal text</script>');
  assert.ok(Number.isSafeInteger(chat.time));
  assert.equal((await eventually(() => events.find((event) => event.id === chat.id))).id, chat.id);
  host.sendChat('Ответ');
  assert.equal((await eventually(() => events.find((event) => event.text === 'Ответ'))).from, 'host');
});

test('three people: independent identities/presence, chat fanout and slot reuse after one guest leaves', async (t) => {
  const { host, events: hostEvents } = await room(t);
  const a = await guest(t, host, 'Первый');
  const b = await guest(t, host, 'Второй');
  await eventually(() => a.session.getInfo().peers.length === 3);
  const aId = a.session.getInfo().selfId;
  const bId = b.session.getInfo().selfId;
  assert.notEqual(aId, bId);
  assert.equal(b.session.getInfo().peers.find((peer) => peer.id === bId).slot, 2);
  a.session.setPresence({ micMuted: false, sharing: true, shareTitle: 'Игра' });
  await eventually(() => b.session.getInfo().peers.find((peer) => peer.id === aId)?.sharing);
  assert.equal(b.session.getInfo().peers.find((peer) => peer.id === aId).micMuted, false);
  assert.equal(b.session.getInfo().peers.find((peer) => peer.id === bId).micMuted, true);
  a.session.sendChat('Троим');
  await eventually(() => hostEvents.some((event) => event.text === 'Троим') && b.events.some((event) => event.text === 'Троим'));
  assert.throws(() => a.session.sendSignal(bId, { type: 'answer' }), { code: 'INVALID_MESSAGE' });
  await a.session.close();
  await eventually(() => b.session.getInfo().peers.length === 2);
  assert.equal(host.getInfo().peers.length, 2);
  b.session.sendChat('Я остался');
  await eventually(() => hostEvents.some((event) => event.text === 'Я остался'));
  const replacement = await guest(t, host, 'Новый');
  assert.equal(replacement.session.getInfo().peers.find((peer) => peer.id === replacement.session.getInfo().selfId).slot, 1);
  assert.notEqual(replacement.session.getInfo().selfId, aId);
});

test('capacity: seven guests plus host accepted, ninth participant rejected', async (t) => {
  const { host } = await room(t);
  const guests = [];
  for (let i = 0; i < 7; i++) guests.push(await guest(t, host, `Друг ${i + 1}`));
  assert.equal(host.getInfo().peers.length, 8);
  assert.deepEqual(host.getInfo().peers.map((peer) => peer.slot), [0, 1, 2, 3, 4, 5, 6, 7]);
  await assert.rejects(joinHost({ name: 'Девятый', invite: host.getInfo().invite }), { code: 'ROOM_FULL' });
  assert.equal(host.getInfo().peers.length, 8);
  guests[6].session.sendChat('Восемь подключены');
  await eventually(() => guests[0].events.some((event) => event.text === 'Восемь подключены'));
});

test('wrong authentication token cannot occupy a participant slot', async (t) => {
  const { host } = await room(t);
  const parsed = decodeInvite(host.getInfo().invite);
  const wrong = encodeInvite({ ...parsed, token: randomBytes(32).toString('base64url') });
  await assert.rejects(joinHost({ name: 'Неверный код', invite: wrong }), { code: 'AUTH_FAILED' });
  assert.equal(host.getInfo().peers.length, 1);
});

test('wrong certificate pin rejects connection BEFORE any application secret is transmitted', async (t) => {
  const certificate = await createRoomCertificate();
  const sockets = new Set();
  let applicationBytes = 0;
  let secureConnections = 0;
  const server = tls.createServer({ key: certificate.key, cert: certificate.cert, minVersion: 'TLSv1.2' }, (socket) => {
    secureConnections++;
    sockets.add(socket);
    socket.on('data', (data) => { applicationBytes += data.length; });
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('tlsClientError', () => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  const invite = encodeInvite({ address: '127.0.0.1', port: server.address().port,
    fingerprint: randomBytes(32).toString('hex'), token: randomBytes(32).toString('base64url') });
  await assert.rejects(joinHost({ name: 'Не отправлять секрет', invite }), { code: 'CERT_PIN_MISMATCH' });
  await delay(30);
  // Depending on TLS1.3 scheduling, the server may observe close before its
  // secureConnection callback; in either case no application credential exists.
  assert.equal(applicationBytes, 0);
  assert.ok(secureConnections <= 1);
});

test('framing handles split UTF-8 messages and multiple messages in one write', async (t) => {
  const { host, events } = await room(t);
  const raw = await rawClient(t, host, { authenticate: false });
  const hello = Buffer.from(JSON.stringify({ type: 'hello', v: 1, token: raw.invitation.token, name: 'Кириллица' }) + '\n');
  const split = hello.indexOf(Buffer.from('К')) + 1; // split inside a multibyte character
  raw.socket.write(hello.subarray(0, split));
  await delay(20);
  assert.equal(host.getInfo().peers.length, 1);
  raw.socket.write(hello.subarray(split));
  await eventually(() => raw.messages.some((message) => message.type === 'welcome'));
  raw.socket.write(JSON.stringify({ type: 'chat', text: 'Первое' }) + '\n' + JSON.stringify({ type: 'chat', text: 'Второе' }) + '\n');
  await eventually(() => events.filter((event) => event.type === 'chat').length === 2);
  assert.deepEqual(events.filter((event) => event.type === 'chat').map((event) => event.text), ['Первое', 'Второе']);
});

test('malformed JSON, oversized frames, invalid UTF-8 and spoofed routing are isolated and rejected', async (t) => {
  const { host } = await room(t);
  const attacks = [
    () => Buffer.from('{not json}\n'),
    () => Buffer.alloc(LIMITS.frameBytes + 1, 65),
    () => Buffer.from([123, 34, 120, 34, 58, 34, 0xff, 34, 125, 10]),
    () => Buffer.from(JSON.stringify({ type: 'chat', text: 'spoof', from: 'host' }) + '\n'),
    () => Buffer.from(JSON.stringify({ type: 'signal', to: 'another-guest', data: { type: 'offer' } }) + '\n'),
  ];
  for (const attack of attacks) {
    const raw = await rawClient(t, host);
    raw.socket.write(attack());
    await eventually(() => raw.messages.some((message) => message.type === 'rejected'));
    await eventually(() => raw.socket.destroyed);
    await eventually(() => host.getInfo().peers.length === 1);
  }
  const valid = await guest(t, host, 'После ошибок');
  assert.equal(valid.session.getInfo().peers.length, 2);
});

test('frame rate limiting disconnects a flooding peer without killing the host', async (t) => {
  const { host } = await room(t);
  const raw = await rawClient(t, host);
  raw.socket.write((JSON.stringify({ type: 'pong' }) + '\n').repeat(400));
  const rejection = await eventually(() => raw.messages.find((message) => message.type === 'rejected'));
  assert.equal(rejection.code, 'RATE_LIMIT');
  await eventually(() => raw.socket.destroyed && host.getInfo().peers.length === 1);
  await guest(t, host, 'После флуда');
});

test('bounded output queue disconnects a slow receiver rather than buffering indefinitely', async (t) => {
  const { host } = await room(t);
  const raw = await rawClient(t, host);
  const id = raw.messages.find((message) => message.type === 'welcome').session.selfId;
  raw.socket.pause();
  let bounded = false;
  const payload = { type: 'test', blob: 'a'.repeat(110 * 1024) };
  for (let i = 0; i < 30; i++) {
    try { host.sendSignal(id, payload); }
    catch (error) { assert.equal(error.code, 'PEER_DISCONNECTED'); bounded = true; break; }
  }
  assert.equal(bounded, true);
  raw.socket.resume();
  await eventually(() => host.getInfo().peers.length === 1);
});

test('unauthenticated socket is timed out and cannot reserve a room slot', { timeout: 12000 }, async (t) => {
  const { host } = await room(t);
  const raw = await rawClient(t, host, { authenticate: false });
  const rejection = await eventually(() => raw.messages.find((message) => message.type === 'rejected'), LIMITS.handshakeMs + 1000);
  assert.equal(rejection.code, 'AUTH_TIMEOUT');
  assert.equal(host.getInfo().peers.length, 1);
});

test('host shutdown closes connected guests and releases its listening port', async (t) => {
  const { host } = await room(t);
  const g = await guest(t, host, 'Друг');
  const oldPort = host.getInfo().port;
  await host.close();
  const event = await eventually(() => g.events.find((entry) => entry.type === 'closed'));
  assert.match(event.reason, /Создатель/);
  assert.throws(() => host.sendChat('late'), { code: 'ROOM_CLOSED' });
  assert.throws(() => g.session.sendChat('late'), { code: 'ROOM_CLOSED' });
  const replacement = await startHost({ name: 'Новая комната', address: '127.0.0.1', port: oldPort });
  t.after(() => replacement.close());
  assert.notEqual(replacement.getInfo().invite, host.getInfo().invite);
});

test('invalid input and occupied TCP port return actionable errors without breaking existing room', async (t) => {
  const { host } = await room(t);
  await assert.rejects(startHost({ name: '', address: '127.0.0.1' }), { code: 'INVALID_NAME' });
  await assert.rejects(startHost({ name: 'x', address: 'https://example.com' }), { code: 'INVALID_INVITE' });
  await assert.rejects(startHost({ name: 'x', address: '127.0.0.1', port: host.getInfo().port }), { code: 'EADDRINUSE' });
  assert.equal(host.getInfo().peers.length, 1);
  await guest(t, host, 'Соединение сохранилось');
});
