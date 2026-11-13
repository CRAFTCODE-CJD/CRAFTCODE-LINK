'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { validPrefix, interfaceRanges, overlaps, chooseFreePrefix } = require('../src/game/subnet.cjs');
const { GameRoom } = require('../src/game/room.cjs');
const { GameNetwork } = require('../src/game/network.cjs');

const host = { id: '1'.repeat(64), device: '2'.repeat(64), name: 'Host', slot: 1 };
const guest = { id: '3'.repeat(64), device: '4'.repeat(64), name: 'Guest', slot: 2 };
const ipv4 = (address, netmask) => ({ family: 'IPv4', address, netmask });
function room(self, peer, sent = []) {
  return new GameRoom({ self: () => self, links: () => [{card: peer, send: msg => { sent.push(msg); return true; }}],
    event() {}, changed() {}, quiet: () => false });
}
function onlyFree(prefix) {
  const entries = [];
  for (let second = 80; second <= 223; second++) {
    if (!prefix.startsWith('10.' + second + '.')) entries.push(ipv4('10.' + second + '.3.7', '255.255.0.0'));
    else for (let third = 1; third <= 253; third++) {
      const candidate = '10.' + second + '.' + third;
      if (candidate !== prefix) entries.push(ipv4(candidate + '.230', '255.255.255.255'));
    }
  }
  return {VPN: entries};
}

test('selects the single remaining legacy-compatible /24, including both ends of the range', () => {
  for (const prefix of ['10.80.1', '10.99.73', '10.223.253']) {
    const ranges = interfaceRanges(onlyFree(prefix));
    assert.equal(chooseFreePrefix(ranges), prefix);
    assert.ok(validPrefix(prefix));
    assert.ok(!overlaps(prefix, ranges));
  }
  for (const invalid of ['10.079.1', '10.79.1', '10.224.1', '10.90.0', '10.90.254', '192.168.1']) assert.ok(!validPrefix(invalid));
  const mixed = interfaceRanges({wan: [ipv4('192.168.1.7', '255.255.255.0'), {family: 'IPv6'}],
    vpn: [ipv4('10.90.2.240', '255.255.255.128'), { ...ipv4('10.123.7.1', '255.255.255.255'), family: 4 }]});
  assert.ok(overlaps('10.90.2', mixed));
  assert.ok(overlaps('10.123.7', mixed));
  assert.ok(!overlaps('10.90.3', mixed));
  assert.ok(validPrefix(chooseFreePrefix(interfaceRanges({}))));
  assert.equal(chooseFreePrefix(interfaceRanges({vpn: [ipv4('10.12.0.1','255.0.0.0')]})), null);
});

test('host chooses from its own interfaces once and returns the same prefix after reconnect', t => {
  let interfaces = onlyFree('10.223.253');
  t.mock.method(os, 'networkInterfaces', () => interfaces);
  const sent = [], session = room(host, guest, sent);
  session.create('Match');
  assert.equal(session.active.prefix, '10.223.253');
  interfaces = {};
  session.invite(guest.id);
  session.receive(guest, {...sent[0], action: 'accept'});
  assert.equal(sent.at(-1).action, 'roster');
  assert.equal(sent.at(-1).prefix, '10.223.253');
  session.reconnected(session.link(guest));
  assert.equal(sent.at(-1).prefix, '10.223.253');
});

test('guest accepts a legacy roster, blocks an overlapping subnet, retries in-place and rejects mid-match renumbering', async t => {
  let interfaces = {wifi: [ipv4('10.91.73.248', '255.255.255.255')]};
  t.mock.method(os, 'networkInterfaces', () => interfaces);
  const session = room(guest, host);
  const invite = { action: 'invite', room: randomUUID(), title: 'Match', ticket: randomUUID(), expires: Date.now()+30000 };
  session.receive(host, invite);
  session.answer(session.state().invitations[0].id, true);
  const roster = {room: invite.room, action: 'roster', list: [host, guest], prefix: '10.91.73'};
  session.receive(host, roster);
  assert.equal(session.active.waiting, false);
  let starts = 0;
  const network = new GameNetwork(session, () => {}, async ({ip}) => {
    starts++;
    assert.equal(ip, '10.91.73.2');
    return {close() {}};
  });
  t.mock.method(network.pathCheck, 'open', () => {});
  t.after(() => network.stop());
  await assert.rejects(network.start(), {code: 'overlap'});
  assert.equal(starts, 0);
  assert.equal(session.active.id, invite.room);
  interfaces = {};
  await network.start();
  assert.equal(network.phase, 'ready');
  assert.equal(starts, 1);
  session.receive(host, {...roster, prefix: '10.92.74'});
  network.reconcile();
  assert.equal(session.active.prefix, '10.91.73');
  assert.equal(network.phase, 'ready');
});

test('room chat survives an exhausted pool or an enumeration failure and the adapter rechecks on retry', async t => {
  let mode = 'vpn';
  t.mock.method(os, 'networkInterfaces', () => {
    if (mode === 'error') throw Error('interfaces unavailable');
    return mode === 'vpn' ? {vpn: [ipv4('10.12.0.1','255.0.0.0')]} : {};
  });
  for (const initial of ['vpn', 'error']) {
    mode = initial;
    const session = room(host, guest);
    session.create('Match');
    session.chat('Ready?');
    assert.equal(session.active.messages[0].text, 'Ready?');
    const original = session.active.prefix;
    assert.ok(validPrefix(original));
    let starts = 0;
    const network = new GameNetwork(session, () => {}, async ({ip}) => {
      starts++;
      assert.equal(ip, original + '.1');
      return {close() {}};
    });
    t.mock.method(network.pathCheck, 'open', () => {});
    try {
      await assert.rejects(network.start(), initial === 'vpn' ? /нет свободной подсети/ : /проверить сетевые адаптеры/);
      assert.equal(starts, 0);
      mode = 'free';
      await network.start();
      assert.equal(starts, 1);
      assert.equal(session.active.prefix, original);
    } finally { network.stop(); }
  }
});
