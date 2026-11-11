'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (name, value) => ipcRenderer.invoke(`craftlink:${name}`, value);
const api = {
  // Obtain disk paths only from actual File objects supplied by Chromium.
  // A pasted bitmap has no path and is sent as a bounded in-memory attachment.
  async offerSelectedFile(target,file,caption='') {
    const filename=webUtils.getPathForFile(file);
    if(filename)return invoke('selected-file',{target,filename,caption});
    if(file.size>8*1024**2)throw Error('CLIPBOARD_FILE_TOO_LARGE');
    return invoke('selected-file',{target,name:file.name,bytes:new Uint8Array(await file.arrayBuffer()),caption});
  },
  flushLocalPreferences: ()=>invoke('flush-local-preferences'),
  applyLanguage: ()=>invoke('apply-language'),
  setLanguage: value=>invoke('language',value),
  installRelease: options=>invoke('install-release',options),
  chatLink: options=>invoke('chat-link',options),
  releases: options=>invoke('releases',options),
  storage: options=>invoke('storage',options),
  files: options=>invoke('files',options),
  direct: options => invoke('direct',options),
  internet: options => invoke('internet', options),
  setTrayState: options => invoke('tray-state',options),
  graphicsStatus: () => invoke('graphics-status'),
  saveGraphics: value => invoke('graphics-save',value),
  restartGraphics: () => invoke('graphics-restart'),
  openBorderSettings: () => invoke('capture-border-settings'),
  recordingPrivacy: action => invoke('recording-privacy',action),
  lanCamera: (action,{room,requestId}) => invoke('lan-camera',{action,room,requestId}),
  environment: () => invoke('environment'),
  hostRoom: (options) => invoke('host-room', options),
  joinRoom: (options) => invoke('join-room', options),
  leaveRoom: () => invoke('leave-room'),
  sendSignal: (options) => invoke('send-signal', options),
  sendChat: (options) => invoke('send-chat', options),
  setPresence: (options) => invoke('set-presence', options),
  streamAudio: (op,token) => invoke('stream-audio',{op,token}),
  sources: type => invoke('sources', type),
  selectSource: (options) => invoke('select-source', options),
  liveCamera: options => invoke('live-camera',options),
  copyText: (text) => invoke('copy-text', text),
  onEvent: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Event callback must be a function.');
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('craftlink:event', listener);
    let subscribed = true;
    return () => {
      if (subscribed) ipcRenderer.removeListener('craftlink:event', listener);
      subscribed = false;
    };
  },
};

contextBridge.exposeInMainWorld('craftlink', Object.freeze(api));
