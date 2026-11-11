'use strict';
const {tr}=require('./native-language.cjs');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

function createGraphics(app) {
  const directory = app.getPath('userData');
  const file = path.join(directory, 'graphics.json');
  let automatic = true;
  try {
    if (fs.statSync(file).size < 1024) automatic = JSON.parse(fs.readFileSync(file, 'utf8')).automatic !== false;
  } catch { /* Existing installations and new profiles use Chromium defaults. */ }
  const applied = automatic;
  if (!applied) app.commandLine.appendSwitch('disable-accelerated-video-encode');
  let ready = false;
  app.on('gpu-info-update', () => { ready = true; });

  function snapshot() {
    const features = ready ? app.getGPUFeatureStatus() : {};
    return {automatic, applied, active: ready ? app.isHardwareAccelerationEnabled() : null,
      encode: features.video_encode || '', decode: features.video_decode || '', compositing: features.gpu_compositing || ''};
  }
  function set(value) {
    if (typeof value !== 'boolean') throw Error(tr('Недопустимое значение настройки.'));
    if (value !== automatic) {
      fs.mkdirSync(directory, {recursive:true});
      const temp = file+'.'+randomUUID()+'.tmp';
      try {
        fs.writeFileSync(temp, JSON.stringify({automatic:value}), {flag:'wx', mode:0o600});
        fs.renameSync(temp, file);
      } finally { fs.rmSync(temp, {force:true}); }
      automatic = value;
    }
    return snapshot();
  }
  return {snapshot,set};
}
module.exports = {createGraphics};
