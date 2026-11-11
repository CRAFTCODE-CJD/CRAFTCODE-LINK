'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Keep every profile (including the synthetic media test) inside the app's data tree.
function useProfile(app, directory) {
  for (const [key, target] of Object.entries({
    userData: directory, sessionData: directory, crashDumps: path.join(directory, 'Crashpad'),
  })) {
    fs.mkdirSync(target, { recursive: true });
    app.setPath(key, target);
  }
  app.setAppLogsPath(path.join(directory, 'logs'));
}

// The single-instance main process serializes these synchronous writes.
function writeProfileFile(file, bytes) {
  const temp = file + '.tmp';
  fs.rmSync(temp, {force:true});
  try {
    fs.writeFileSync(temp, bytes, {mode:0o600, flag:'wx'});
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, {force:true});
  }
}

module.exports = { useProfile, writeProfileFile };
