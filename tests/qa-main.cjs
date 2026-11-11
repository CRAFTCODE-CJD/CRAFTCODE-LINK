'use strict';
// Isolated test harness; loaded only by QA or the explicit local test launcher.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const windows = new Map();
const standalone = process.argv.includes('--craftlink-test-media');
if (standalone) {
  require('../src/profile-paths.cjs').useProfile(app, path.join(app.getPath('appData'), 'CRAFTCODE LINK', 'media-test'));
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('allow-loopback-in-peer-connection');
ipcMain.on('qa:signal', (event, message) => {
  const entry = [...windows].find(([, win]) => win.webContents === event.sender);
  const target = windows.get(message?.peerId);
  if (entry && target && !target.isDestroyed()) {
    target.webContents.send('qa:signal', { from: entry[0], data: message.data });
  }
});
app.whenReady().then(async () => {
  const qaURL = pathToFileURL(path.join(__dirname, 'qa-media.html')).href;
  const localNetwork = new Set(['local-network', 'local-network-access', 'loopback-network']);
  const trusted = contents => [...windows.values()].some(w => !w.isDestroyed() && w.webContents === contents) &&
    contents.getURL().split('?')[0] === qaURL;
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) =>
    trusted(contents) && details?.isMainFrame !== false && (localNetwork.has(permission) ||
      (permission === 'media' && details?.mediaType !== 'video')));
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(trusted(contents) && details?.isMainFrame !== false && (localNetwork.has(permission) ||
      (permission === 'media' && details?.mediaTypes?.length > 0 && details.mediaTypes.every(type => type === 'audio')))));
  for (const id of ['host', 'g1', 'g2']) {
    const window = new BrowserWindow({
      width: 800, height: 600, show: !process.argv.includes('--link-qa-hidden'),
      webPreferences: {
        preload: path.join(__dirname, 'qa-preload.cjs'), contextIsolation: true,
        nodeIntegration: false, sandbox: true, backgroundThrottling: false,
      },
    });
    windows.set(id, window);
    if (standalone) {
      window.webContents.setAudioMuted(true);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.removeMenu();
    }
    window.webContents.setWebRTCUDPPortRange({ min: 45832, max: 45863 });
    await window.loadFile(path.join(__dirname, 'qa-media.html'), { query: { id } });
  }
  if (standalone) await require('./rtp-local.cjs').runLocalTest(windows);
}).catch(error => {
  if (standalone && process.platform === 'win32') require('electron').dialog.showErrorBox('CRAFTCODE LINK', 'Не удалось открыть окна теста RTP.');
  console.error(error.message);
  app.exit(1);
});
app.on('window-all-closed', () => app.quit());
