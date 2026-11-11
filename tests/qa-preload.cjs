'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('qaBridge', Object.freeze({
  signal(message) { ipcRenderer.send('qa:signal', message); },
  onSignal(callback) {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('qa:signal', handler);
    return () => ipcRenderer.removeListener('qa:signal', handler);
  },
}));
