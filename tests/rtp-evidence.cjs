'use strict';

// A guest receives all other slots from the host. A host receives each guest
// on that guest's own connection. Compare fresh samples from that exact link.
function readEvidence(snapshots, slots) {
  const rows = [];
  for (const snap of snapshots) {
    for (const sender of slots.filter(p => p.slot !== snap.slot)) {
      const peerId = snap.slot === 0 ? sender.id : 'host';
      const conn = snap.connections.find(c => c.id === peerId);
      const get = role => conn?.inbound.find(s => String(s.mid) === String(sender.slot * 3 + role));
      const voice = get(0), screen = get(1), system = get(2);
      rows.push({
        receiver: snap.id, from: sender.id, connected: conn?.state === 'connected',
        voiceBytes: voice?.bytes ?? 0, screenBytes: screen?.bytes ?? 0, systemBytes: system?.bytes ?? 0,
        framesDecoded: screen?.frames ?? 0,
        voiceSamples: voice?.totalSamplesReceived ?? 0, systemSamples: system?.totalSamplesReceived ?? 0,
        voicePeak: snap.peaks?.[sender.id + ':voice'] ?? null, systemPeak: snap.peaks?.[sender.id + ':system'] ?? null,
        expectedVoiceHz: 220 + sender.slot * 137, expectedSystemHz: 970 + sender.slot * 173,
      });
    }
  }
  return rows;
}

function advancing(before, after) {
  return before.length > 0 && before.length === after.length && after.every((current, i) => {
    const previous = before[i];
    return current.connected && current.receiver === previous.receiver && current.from === previous.from &&
      [ ['voicePeak', 'expectedVoiceHz'], ['systemPeak', 'expectedSystemHz'] ].every(([peak, expected]) =>
        current[peak] && current[peak].db > -65 && Math.abs(current[peak].hz - current[expected]) < 30) &&
      ['voiceBytes', 'screenBytes', 'systemBytes', 'framesDecoded', 'voiceSamples', 'systemSamples']
        .every(key => current[key] > previous[key]);
  });
}

module.exports = { readEvidence, advancing };
