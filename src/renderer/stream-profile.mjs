// These are sender ceilings. The congestion controller allocates the actual rate.
const autoMbps = new Map([
  ['720p30', 8], ['720p60', 12],
  ['1080p30', 8], ['1080p60', 20],
  ['1440p30', 20], ['1440p60', 32],
]);

// Older profiles stored only a number, even when the user deliberately chose 8.
// Keep each valid saved limit. Zero is the automatic choice for new profiles.
export function bitrateChoice(value) {
  return [2, 4, 8, 12, 20, 32].includes(value) ? value : 0;
}

export function streamProfile(preset, content, bitrate) {
  const format = autoMbps.has(preset) ? preset : '1080p30';
  const [height, fps] = format.split('p').map(Number);
  const width = {720: 1280, 1080: 1920, 1440: 2560}[height];
  const mbps = bitrateChoice(bitrate) || autoMbps.get(format);
  return {width, height, fps, content: content === 'detail' ? 'detail' : 'motion', bitrate: mbps * 1_000_000};
}
