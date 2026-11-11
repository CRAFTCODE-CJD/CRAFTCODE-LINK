import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomMedia} from '../src/renderer/peer.mjs';

function fixture(t, host = true) {
  t.mock.method(globalThis, 'MediaStream', class {}, {times: Infinity});
  const room = new RoomMedia({session: {role: host ? 'host' : 'guest', selfId: host ? 'host' : 'guest', hostId: 'host'}, sendSignal() {}});
  room.peers = [{id: 'host', slot: 0}, {id: 'guest', slot: 1}, {id: 'other', slot: 2}];
  const sent = [];
  const pc = {signalingState: 'stable', close() {}, getTransceivers: () => transceivers};
  const transceivers = Array.from({length: 9}, () => ({sender: {setStreams(...streams) {this.streams = streams;}}}));
  const endpoint = {id: host ? 'guest' : 'host', remoteSlot: host ? 1 : 0, pc, queue: Promise.resolve()};
  room.endpoints.set(endpoint.id, endpoint);
  room.sendControl = (id, packet) => {sent.push({id, packet}); return true;};
  room.offer = async () => {};
  t.after(() => room.close());
  return {room, endpoint, sent, transceivers};
}

test('camera source metadata is bound to the authenticated participant and current room permissions', async t => {
  globalThis.MediaStream ??= class {};
  const {room, endpoint, sent} = fixture(t);
  const packet = {kind: 'video-source', peerId: 'guest', slot: 1, source: 'camera'};
  for (const invalid of [
    {...packet, slot: 2}, {...packet, peerId: 'other', slot: 2}, {...packet, source: 'arbitrary'},
    {...packet, slot: '1'}, {...packet, extra: true}, {...packet, peerId: 'absent'},
  ]) room.receiveVideoSource(endpoint, invalid);
  assert.equal(room.videoSource(1), 'screen');
  assert.equal(sent.length, 0);
  room.receiveVideoSource(endpoint, packet);
  assert.equal(room.videoSource(1), 'camera');
  assert(sent.some(row => row.packet.sources?.some(source => source.peerId === 'guest' && source.source === 'camera')));
  await endpoint.queue;
  await room.setRights(true);
  assert.equal(room.videoSource(1), 'screen');
  room.receiveVideoSource(endpoint, packet);
  assert.equal(room.videoSource(1), 'screen');
  room.receiveVideoSource(endpoint, {...packet, source: 'screen'});
  assert.equal(room.videoSources.size, 0);
});

test('guests accept source metadata only from the host for a known remote identity', t => {
  globalThis.MediaStream ??= class {};
  const {room, endpoint} = fixture(t, false);
  const packet = {kind: 'video-source', peerId: 'other', slot: 2, source: 'camera'};
  room.receiveVideoSource({id: 'other'}, packet);
  assert.equal(room.videoSource(2), 'screen');
  room.receiveVideoSource(endpoint, packet);
  assert.equal(room.videoSource(2), 'camera');
  room.receiveVideoSource(endpoint, {...packet, peerId: 'guest', slot: 1});
  assert.equal(room.videoSource(1), 'screen');
  room.peers[2] = {id: 'replacement', slot: 2};
  assert.equal(room.videoSource(2), 'screen', 'a reused slot must not inherit camera metadata');
});

test('camera shares the voice stream identity while screen shares system sound, with queued renegotiation', async t => {
  globalThis.MediaStream ??= class {};
  const {room, endpoint, transceivers} = fixture(t);
  let offers = 0;
  room.offer = async () => {offers++;};
  const voice = room.senderStreams(0, 'voice')[0];
  const system = room.senderStreams(0, 'system')[0];
  assert.notEqual(voice, system);
  assert.equal(room.senderStreams(0, 'screen')[0], system);
  room.setVideoSource('camera');
  assert.equal(transceivers[1].sender.streams[0], voice);
  await endpoint.queue;
  assert.equal(offers, 1);
  endpoint.pc.signalingState = 'have-local-offer';
  room.setVideoSource('screen');
  await endpoint.queue;
  assert.equal(transceivers[1].sender.streams[0], system);
  assert.equal(endpoint.videoNegotiationPending, true);
  assert.equal(offers, 1);
});

test('the complete room source snapshot occupies one bounded control packet per recipient', t => {
  globalThis.MediaStream ??= class {};
  const {room, endpoint, sent} = fixture(t);
  room.peers.push(...Array.from({length: 5}, (_, i) => ({id: 'peer-' + i, slot: i + 3})));
  room.publishVideoSources(endpoint);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].packet.sources.length, 8);
  const guest = fixture(t, false);
  const source = {peerId: 'other', slot: 2, source: 'camera'};
  for (const sources of [[source, source], [source, null], Array(9).fill(source), [{...source, slot: 5}]]) {
    guest.room.receiveVideoSources(guest.endpoint, {kind: 'video-sources', sources});
    assert.equal(guest.room.videoSource(2), 'screen');
  }
  guest.room.receiveVideoSources(guest.endpoint, {kind: 'video-sources', sources: [source]});
  assert.equal(guest.room.videoSource(2), 'camera');
});

test('source updates coalesce during channel backpressure and stop retrying when closed', async t => {
  globalThis.MediaStream ??= class {};
  t.mock.timers.enable({apis: ['setTimeout']});
  const {room, endpoint} = fixture(t);
  endpoint.channel = {readyState: 'open'};
  let blocked = true;
  const delivered = [];
  room.sendControl = (id, packet) => {
    if (blocked) return false;
    delivered.push(packet);
    return true;
  };
  room.publishVideoSources();
  room.setVideoSource('camera');
  room.setVideoSource('screen');
  room.setVideoSource('camera');
  await endpoint.queue;
  assert(endpoint.videoSourceRetry);
  blocked = false;
  t.mock.timers.tick(250);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].sources[0].source, 'camera');
  assert.equal(endpoint.videoSourceRetry, null);
  blocked = true;
  room.publishVideoSources();
  room.close();
  blocked = false;
  t.mock.timers.tick(1000);
  assert.equal(delivered.length, 1);
});

test('replacing a camera track restores its voice association after the native sender resets streams', async t => {
  globalThis.MediaStream ??= class {};
  for (const host of [true, false]) {
    const {room, endpoint, transceivers} = fixture(t, host);
    room.applyEncoding = async () => {};
    const slot = room.selfSlot;
    const sender = transceivers[slot * 3 + 1].sender;
    const original = room.senderStreams(slot, 'system')[0];
    sender.replaceTrack = async track => {sender.track = track; sender.streams = [original];};
    room.setVideoSource('camera');
    await room.setLocalTrack('screen', {kind: 'video'});
    assert.equal(sender.streams[0], room.senderStreams(slot, 'voice')[0]);
    await endpoint.queue;
  }
});

test('roster snapshots leave room in the control budget for the following camera change', t => {
  globalThis.MediaStream ??= class {};
  const {room, endpoint} = fixture(t, false);
  room.peers.push(...Array.from({length: 5}, (_, i) => ({id: 'peer-' + i, slot: i + 3})));
  const channel = {label: 'room-chat', close() {}};
  room.installChat(endpoint, channel);
  const deliver = control => channel.onmessage({data: JSON.stringify({control})});
  const sources = room.peers.map(peer => ({peerId: peer.id, slot: peer.slot, source: 'screen'}));
  for (let i = 0; i < 4; i++) deliver({kind: 'video-sources', sources});
  deliver({kind: 'video-source', peerId: 'other', slot: 2, source: 'camera'});
  assert.equal(endpoint.controlCount, 5);
  assert.equal(room.videoSource(2), 'camera');
  assert.equal(room.videoSource(1), 'screen', 'remote snapshots cannot change our own source');
});

test('encoding updates preserve the camera and voice stream association', async t => {
  globalThis.MediaStream ??= class {};
  const {room, endpoint, transceivers} = fixture(t);
  endpoint.pc.remoteDescription = {type: 'answer'};
  const sender = transceivers[1].sender;
  const system = room.senderStreams(0, 'system')[0];
  sender.track = {kind: 'video', getSettings: () => ({width: 640, height: 480})};
  sender.getParameters = () => ({encodings: [{}]});
  let updates = 0;
  sender.setParameters = async () => {updates++; sender.streams = [system];};
  room.setVideoSource('camera');
  await endpoint.queue;
  await room.applyEncodingNow(endpoint);
  assert.equal(updates, 1);
  assert.equal(sender.streams[0], room.senderStreams(0, 'voice')[0]);
});

test('renegotiation requires a valid own-source message and waits for the current answer', async t => {
  globalThis.MediaStream ??= class {};
  const {room, endpoint} = fixture(t);
  let offers = 0;
  room.offer = async () => {offers++; endpoint.pc.signalingState = 'have-local-offer';};
  room.applyEncoding = room.flushCandidates = async () => {};
  endpoint.pc.setRemoteDescription = async () => {endpoint.pc.signalingState = 'stable';};
  const channel = {label: 'room-chat', close() {}};
  room.installChat(endpoint, channel);
  const packet = {kind: 'video-source', peerId: 'guest', slot: 1, source: 'screen', renegotiate: true};
  const deliver = control => channel.onmessage({data: JSON.stringify({control})});
  for (const value of [false, 1, 'true', null, {}]) deliver({...packet, renegotiate: value});
  deliver({...packet, peerId: 'other', slot: 2});
  deliver({...packet, slot: 2});
  deliver({...packet, extra: true});
  await endpoint.queue;
  assert.equal(offers, 0);
  assert.equal(endpoint.videoNegotiationPending, undefined);
  endpoint.pc.signalingState = 'have-local-offer';
  deliver(packet);
  await endpoint.queue;
  assert.equal(offers, 0);
  assert.equal(endpoint.videoNegotiationPending, true);
  await room.acceptSignal('guest', {type: 'answer', sdp: 'v=0\r\n'});
  assert.equal(offers, 1);
  assert.equal(endpoint.videoNegotiationPending, false);
});

test('a guest retains the renegotiation request through channel backpressure', t => {
  globalThis.MediaStream ??= class {};
  t.mock.timers.enable({apis: ['setTimeout']});
  const {room, endpoint} = fixture(t, false);
  endpoint.channel = {readyState: 'open'};
  let blocked = true;
  const delivered = [];
  room.sendControl = (_id, packet) => {
    if (blocked) return false;
    delivered.push(packet);
    return true;
  };
  room.setVideoSource('camera');
  room.setVideoSource('camera');
  assert.equal(endpoint.videoSourceNegotiation, true);
  blocked = false;
  t.mock.timers.tick(250);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].source, 'camera');
  assert.equal(delivered[0].renegotiate, true);
  assert.equal(endpoint.videoSourceNegotiation, false);
});
