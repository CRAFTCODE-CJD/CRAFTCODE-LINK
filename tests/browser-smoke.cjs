'use strict';
// Real Electron/WebRTC test, with test-only synthetic media and IPC signaling.
const assert = require('node:assert/strict');
const { readEvidence, advancing } = require('./rtp-evidence.cjs');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const negotiationOnly = process.argv.includes('--negotiation-only');
let playwright;
try { playwright = require('playwright'); }
catch {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw new Error('Install playwright to run browser QA: npm install --no-save playwright');
  playwright = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
}
const host = { id: 'host', name: 'Host QA', slot: 0, micMuted: false, sharing: true, shareTitle: 'Synthetic host screen' };
const g1 = { id: 'g1', name: 'Guest one QA', slot: 1, micMuted: false, sharing: true, shareTitle: 'Synthetic guest one screen' };
const g2 = { id: 'g2', name: 'Guest two QA', slot: 2, micMuted: false, sharing: true, shareTitle: 'Synthetic guest two screen' };
const result = { suite: 'CRAFTCODE LINK real Electron media smoke', scope: negotiationOnly ? 'SDP negotiation and local audio graph only; NO LIVE RTP ASSERTIONS' : 'live RTP', started: new Date().toISOString(), checks: [], notes: [
  'Real RTCPeerConnections on loopback/LAN interfaces, synthetic canvas and oscillator tracks.',
  'Signaling transport in this isolated suite is IPC; independent network tests cover TLS.',
  'Does not establish Windows game/system capture, WAN NAT traversal, or 4–8 participant performance.',
] };
const diagnosticLines = [];
const check = (name, detail) => { result.checks.push({ name, pass: true, ...(detail ? { detail } : {}) }); console.log(`PASS ${name}`); };
const call = (page, method, ...args) => page.evaluate(({ method, args }) => window.qa[method](...args), { method, args });

async function until(callback, timeout = 20_000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    last = await callback();
    if (last) return last;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Condition not met after ${timeout} ms`);
}

function hasMedia(snapshot, expectedSlots) {
  const inbound = snapshot.connections.flatMap(connection => connection.inbound);
  return expectedSlots.every(slot => ['voice', 'screen', 'system'].every((role, index) => {
    const item = inbound.find(s => Number(s.mid) === slot * 3 + index);
    return item && item.bytes > 100 && (role !== 'screen' || item.frames > 2);
  }));
}

function negotiated(snapshot, count) {
  return snapshot.connections.length === count && snapshot.connections.every(connection =>
    connection.signalingState === 'stable' && connection.localDescription && connection.remoteDescription
    && connection.senders.every(sender => sender.currentDirection !== null));
}

(async () => {
  let app;
  let pages;
  try {
    const args = [path.join(__dirname, 'qa-main.cjs')];
    if (process.platform === 'linux') args.unshift('--headless', '--ozone-platform=headless', '--no-sandbox');
    app = await playwright._electron.launch({ executablePath: require('electron'), args, timeout: 30_000 });
    app.process().stderr.on('data', data => {
      if (process.env.CCLINK_QA_VERBOSE) process.stderr.write(data);
      for (const line of String(data).split('\n')) if (/Operation not permitted|codec collision|Bundled payload type collision|mDNS responder manager failed/.test(line)) diagnosticLines.push(line);
    });
    await until(() => app.windows().length === 3);
    for (const page of app.windows()) await page.waitForURL(/qa-media\.html/, { timeout: 15_000 });
    pages = new Map(app.windows().map(page => [new URL(page.url()).searchParams.get('id'), page]));
    for (const page of pages.values()) await page.waitForFunction(() => window.qa?.ready, null, { timeout: 15_000 });
    const pHost = pages.get('host'), p1 = pages.get('g1'), p2 = pages.get('g2');
    assert.ok(pHost && p1 && p2, 'All three renderer windows must be present');
    check('Three isolated Electron renderers start');
    await call(pHost, 'init', [host, g1]);
    await call(p1, 'init', [host, g1]);
    await call(p1, 'roster', [host, g1]);
    await call(pHost, 'roster', [host, g1]);
    await until(async () => negotiationOnly
      ? negotiated(await call(pHost, 'snapshot'), 1) && negotiated(await call(p1, 'snapshot'), 1)
      : hasMedia(await call(pHost, 'snapshot'), [1]) && hasMedia(await call(p1, 'snapshot'), [0]));
    let snapshots = await Promise.all([call(pHost, 'snapshot'), call(p1, 'snapshot')]);
    for (const snapshot of snapshots) assert.deepEqual(snapshot.errors, [], `No media errors at ${snapshot.id}`);
    for (const snapshot of snapshots) for (const connection of snapshot.connections) assert.equal(connection.opusFmtp.length, 1, 'Bundled Opus payload has identical parameters');
    check(negotiationOnly ? 'Two peers negotiate voice/video/system slots with consistent bundled Opus parameters (RTP NOT VERIFIED)' : 'Two peers exchange distinct voice, video and system-audio RTP', snapshots.map(s => ({ id: s.id, videos: s.videos })));

    await call(p2, 'init', [host, g1, g2]);
    await call(p1, 'roster', [host, g1, g2]);
    await call(p2, 'roster', [host, g1, g2]);
    await call(pHost, 'roster', [host, g1, g2]);
    await until(async () => negotiationOnly
      ? negotiated(await call(pHost, 'snapshot'), 2) && negotiated(await call(p1, 'snapshot'), 1) && negotiated(await call(p2, 'snapshot'), 1)
      : hasMedia(await call(pHost, 'snapshot'), [1, 2]) && hasMedia(await call(p1, 'snapshot'), [0, 2]) && hasMedia(await call(p2, 'snapshot'), [0, 1]));
    snapshots = await Promise.all([...pages.values()].map(page => call(page, 'snapshot')));
    for (const snapshot of snapshots) {
      assert.deepEqual(snapshot.errors, [], `No media errors at ${snapshot.id}`);
      const active = snapshot.connections.flatMap(connection => connection.inbound).filter(s => s.bytes > 100);
      assert.equal(active.filter(s => Math.floor(Number(s.mid) / 3) === snapshot.slot).length, 0, 'Never receive own media');
      assert.ok(snapshot.received.every(track => Number(track.key.split(':')[0]) !== snapshot.slot), 'No self-return receiver callback');
      assert.equal(snapshot.connections.length, snapshot.slot === 0 ? 2 : 1, 'Guests connect to host only');
      for (const connection of snapshot.connections) {
        assert.deepEqual(connection.configuration.iceServers, [], 'No third-party ICE servers');
        if (!negotiationOnly) {
          assert.equal(connection.state, 'connected');
          assert.equal(connection.selectedTransport?.protocol, 'udp');
          for (const port of [connection.selectedTransport.localPort, connection.selectedTransport.remotePort])
            assert.ok(port >= 45832 && port <= 45863, 'Selected media path uses the declared UDP range');
        }
        assert.equal(connection.senders.length, 24, 'Eight participant slot capacity negotiated');
        for (const candidate of connection.candidates) if (candidate.protocol === 'udp') {
          assert.ok(candidate.port >= 45832 && candidate.port <= 45863, `Actual UDP port ${candidate.port} within bounded range`);
        }
      }
    }
    check(negotiationOnly ? 'Third peer negotiates host-only topology with no self-return receiver slots (RTP NOT VERIFIED)' : 'Third peer receives both others through host; no guest-to-guest connection or self-return');
    check(negotiationOnly ? 'No external ICE services configured; 24 transceivers negotiated' : 'No external ICE services, 24 transceivers, actual UDP ports within 45832–45863');
    result.threePeerMedia = snapshots.map(snapshot => ({ id: snapshot.id, videos: snapshot.videos, connections: snapshot.connections.map(c => ({ id: c.id, state: c.state, inbound: c.inbound.filter(r => r.bytes > 0), candidates: c.candidates, selectedTransport: c.selectedTransport })) }));

    let beforeMix;
    if (!negotiationOnly) {
      beforeMix = readEvidence(snapshots, [host, g1, g2]);
      await until(async () => {
        const after = readEvidence(await Promise.all([...pages.values()].map(p => call(p, 'snapshot'))), [host, g1, g2]);
        result.advancingMedia = { before: beforeMix, after };
        return advancing(beforeMix, after);
      });
    }
    const beforeHost = await call(pHost, 'snapshot');
    const hostForwardedVoice = beforeHost.connections.find(c => c.id === 'g2').senders.find(s => s.slot === 1 && s.role === 'voice').trackId;
    const hostForwardedSystem = beforeHost.connections.find(c => c.id === 'g2').senders.find(s => s.slot === 1 && s.role === 'system').trackId;
    await call(pHost, 'setMix', 'g1', 'voice', { volume: 23 });
    await call(pHost, 'setMix', 'g1', 'system', { volume: 176 });
    await until(async () => {
      const snapshot = await call(pHost, 'snapshot');
      const gain = key => snapshot.mixer.entries.find(e => e.key === key)?.gain;
      return Math.abs(gain('g1:voice') - 0.23) < 0.01 && Math.abs(gain('g1:system') - 1.76) < 0.01;
    });
    await call(pHost, 'setMix', 'g1', 'voice', { muted: true });
    await call(pHost, 'deafen', true);
    await until(async () => (await call(pHost, 'snapshot')).mixer.masterGain < 0.001);
    const afterHost = await call(pHost, 'snapshot');
    assert.equal(afterHost.connections.find(c => c.id === 'g2').senders.find(s => s.slot === 1 && s.role === 'voice').trackId, hostForwardedVoice);
    assert.equal(afterHost.connections.find(c => c.id === 'g2').senders.find(s => s.slot === 1 && s.role === 'system').trackId, hostForwardedSystem);
    assert.ok(afterHost.received.filter(t => t.key.startsWith('1:')).every(t => t.enabled), 'Local mute cannot disable forwarded tracks');
    const guest2Mix = (await call(p2, 'snapshot')).mixer;
    assert.ok(guest2Mix.entries.filter(e => e.key.startsWith('g1:')).every(e => Math.abs(e.gain - 1) < 0.001));
    if (!negotiationOnly) {
      const baseline = readEvidence([await call(p2, 'snapshot')], [g1]);
      await until(async () => advancing(baseline, readEvidence([await call(p2, 'snapshot')], [g1])));
    }
    await call(pHost, 'deafen', false);
    await call(pHost, 'setMix', 'g1', 'voice', { muted: false });
    check(negotiationOnly ? 'Local voice/system gain graph independent; mute/deafen preserve raw forwarding track identities (audible output NOT VERIFIED)' : 'Voice/system gains independent; host mute/deafen preserve raw forwarding and guest playback');
    const race = await call(pHost, 'mixerRace');
    assert.equal(race.createdAfterConcurrent, 1, 'Only one real WebAudio source node created for concurrent attaches');
    assert.equal(race.connectedAfterConcurrent, 1);
    assert.equal(race.mapAfterConcurrent, 1);
    assert.deepEqual(race.afterDetach, { connected: 0, entries: 0 });
    assert.deepEqual(race.afterPendingDetach, { connected: 0, entries: 0 });
    assert.deepEqual(race.afterClose, { connected: 0, entries: 0 });
    assert.equal(race.rawTrackUnmodified, true);
    check('Concurrent mixer attaches create one node; detach and close cancel pending attachment without mutating source track', race);

    const offersBefore = (await call(pHost, 'snapshot')).signals.filter(signal => signal.type === 'offer').length;
    const framesBefore = (await call(p2, 'snapshot')).connections[0].inbound.find(stat => Number(stat.mid) === 4)?.frames || 0;
    await call(p1, 'stopVideo');
    await call(p1, 'startVideo');
    await call(p1, 'replaceAudio', 'system');
    if (!negotiationOnly) await until(async () => ((await call(p2, 'snapshot')).connections[0].inbound.find(stat => Number(stat.mid) === 4)?.frames || 0) > framesBefore + 3);
    assert.ok((await call(p1, 'snapshot')).connections[0].senders.filter(s => s.slot === 1).every(s => s.trackId && s.readyState === 'live'));
    assert.equal((await call(pHost, 'snapshot')).signals.filter(signal => signal.type === 'offer').length, offersBefore, 'Track replacement requires no renegotiation');
    check(negotiationOnly ? 'Guest video stop/start and audio replacement preserve negotiated slots (RTP NOT VERIFIED)' : 'Guest video stop/start and system-audio replacement continue through host without renegotiation');

    await call(p2, 'close');
    await call(p1, 'roster', [host, g1]);
    await call(pHost, 'roster', [host, g1]);
    const left = await call(pHost, 'snapshot');
    assert.equal(left.connections.length, 1);
    assert.equal(left.connections[0].id, 'g1');
    assert.ok(left.connections[0].senders.filter(s => s.slot === 2).every(s => s.trackId === null));
    const survivingFrames = (await call(p1, 'snapshot')).connections[0].inbound.find(s => Number(s.mid) === 1)?.frames || 0;
    if (!negotiationOnly) await until(async () => (await call(p1, 'snapshot')).connections[0].inbound.find(s => Number(s.mid) === 1).frames > survivingFrames + 2);
    check(negotiationOnly ? 'Guest departure clears only its forwarded slots; remaining SDP connection preserved' : 'Guest departure clears only its forwarded slots; remaining call continues');

    // Rejoin into the same fixed slot. The IPC harness keeps the opaque transport id stable;
    // independent core tests cover new room identity allocation.
    await call(p2, 'init', [host, g1, g2]);
    await call(p1, 'roster', [host, g1, g2]);
    await call(p2, 'roster', [host, g1, g2]);
    await call(pHost, 'roster', [host, g1, g2]);
    await until(async () => negotiationOnly
      ? negotiated(await call(p2, 'snapshot'), 1) && negotiated(await call(pHost, 'snapshot'), 2)
      : hasMedia(await call(p2, 'snapshot'), [0, 1]) && hasMedia(await call(pHost, 'snapshot'), [1, 2]));
    const previousGuestFrames = (await call(p1, 'snapshot')).connections[0].inbound.find(s => Number(s.mid) === 7)?.frames || 0;
    if (!negotiationOnly) await until(async () => ((await call(p1, 'snapshot')).connections[0].inbound.find(s => Number(s.mid) === 7)?.frames || 0) > previousGuestFrames + 2);
    check(negotiationOnly ? 'Guest rejoin negotiates reused forwarding slot (RTP NOT VERIFIED)' : 'Guest rejoin reuses forwarding slot without interrupting existing peer');

    const final = await Promise.all([...pages.values()].map(page => call(page, 'snapshot')));
    result.finalErrors = final.map(s => ({ id: s.id, errors: s.errors }));
    for (const snapshot of final) assert.deepEqual(snapshot.errors, [], `No errors at ${snapshot.id} after rejoin`);
    assert.equal(diagnosticLines.filter(line => /codec collision|Bundled payload type collision/.test(line)).length, 0, 'No BUNDLE codec collision diagnostics');
    result.passed = true;
  } catch (error) {
    result.passed = false; result.failure = error.stack || error.message;
    if (pages) result.failureSnapshots = await Promise.all([...pages.values()].map(page => call(page, 'snapshot').catch(e => ({ error: e.message }))));
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (pages) await Promise.all([...pages.values()].map(page => call(page, 'close').catch(() => {})));
    if (app) await app.close().catch(() => {});
    result.finished = new Date().toISOString();
    result.diagnostics = [...new Set(diagnosticLines)];
    if (!negotiationOnly && !result.passed && result.diagnostics.some(line => /Operation not permitted/.test(line)) &&
        result.failure?.includes('Condition not met') && result.failureSnapshots?.some(s => s.connections?.length) &&
        result.failureSnapshots.every(s => !s.errors?.length && !s.signals?.some(sig => sig.type === 'ice') &&
          s.connections?.every(c => c.signalingState === 'stable' && c.gatheringState === 'complete' &&
            c.iceState === 'new' && c.inbound.length === 0))) {
      result.status = 'BLOCKED_BY_ENVIRONMENT';
      result.notes.push('No ICE candidates were signaled; no inbound RTP, despite stable SDP. Chromium reported a denied socket operation.');
    }
    const output = path.join(root, 'out', 'qa');
    fs.mkdirSync(output, { recursive: true });
    const reportName = negotiationOnly ? 'negotiation-report.json' : 'media-report.json';
    fs.writeFileSync(path.join(output, reportName), JSON.stringify(result, null, 2));
    console.log(`Result: ${result.passed ? 'PASS' : result.status || 'FAIL'}; ${result.checks.length} completed checks. out/qa/${reportName}`);
  }
})();
