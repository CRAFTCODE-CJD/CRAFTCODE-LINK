import {tr} from './locale.mjs';
const numeric = value => Number.isFinite(value) && value >= 0;
const number = new Intl.NumberFormat('ru', {maximumFractionDigits: 1});
export function videoFormat(width, height, fps) {
  const fields = [];
  if (width > 0 && height > 0) fields.push(width + ' × ' + height);
  if (numeric(fps)) fields.push(number.format(fps) + ' FPS');
  return fields.join(' · ');
}
export function localCaptureFormat(settings, slot, stats, started, now = Date.now()) {
  const mid = String(slot * 3 + 1);
  let latest = -Infinity, source;
  for (const sample of stats.values()) {
    const time = Date.parse(sample.sampledAt);
    if (!(time >= started && time >= now - 8000 && time > latest) || sample.state !== 'connected') continue;
    const video = sample.video?.find(v => v.direction === 'out' && String(v.mid) === mid && numeric(v.sourceFps));
    if (video) { latest = time; source = video; }
  }
  if (source) return videoFormat(source.sourceWidth || settings.width, source.sourceHeight || settings.height, source.sourceFps);
  return [videoFormat(settings.width, settings.height), numeric(settings.frameRate) ? '≤ ' + number.format(settings.frameRate) + ' FPS' : ''].filter(Boolean).join(' · ');
}
export function outgoingScreens(peers, session, stats, started, now = Date.now()) {
  const own = peers.find(p => p.id === session?.selfId);
  if (!own) return [];
  const mid = String(own.slot * 3 + 1);
  const endpoints = peers.filter(p => p.id !== own.id && (session.role === 'host' || p.id === session.hostId));
  return endpoints.map(p => {
    const sample = stats.get(p.id), time = Date.parse(sample?.sampledAt);
    const recent = time >= started && now-time <= 8000;
    const video = recent && sample.state === 'connected' && sample.video?.find(v => v.direction === 'out' && String(v.mid) === mid);
    let value = tr('Ожидаем отправку…');
    if (video && numeric(video.mbps)){
      value = video.mbps > 0 ? [videoFormat(video.width,video.height,video.fps), number.format(video.mbps)+tr(' Мбит/с')].filter(Boolean).join(' · ') : tr('Новых видеоданных пока нет');
    } else if (recent && ['failed','disconnected','closed'].includes(sample.state)) value = tr('Связь прервана');
    return {name:p.name, value,encoder:video?.mbps>0?video.encoder:null};
  });
}
