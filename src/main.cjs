'use strict';
const {tr}=require('./native-language.cjs');

// This process is the only place with filesystem/network privileges. The local
// renderer gets a small capability API through preload.cjs, never Node or IPC.
const { app, BrowserWindow, Tray, Notification, clipboard, desktopCapturer, dialog, ipcMain, Menu, session, safeStorage, shell, systemPreferences } = require('electron');
const { attachTray, reveal } = require('./tray.cjs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { joinRecoveringGuest }=require('./core/reconnect.cjs');
const { startHost } = require('./core/session.cjs');

const { AccountProfile } = require('./friends/account-profile.cjs');
const { providers, getProvider } = require('./renderer/providers.mjs');
const INTERNET_SERVICES = new Set(Object.values(providers).map(provider => provider.service));
const BOSH_SERVICES = new Set(Object.values(providers).map(provider=>provider.bosh).filter(Boolean));
const {registrationAvailable}=require('./friends/registration-check.cjs');
const registrationChecks = new Map();
let accountProfile, direct, updates;
let internetRoom = false;
const UDP_MIN = 45832;
const UDP_MAX = 45863;
const CONTROL_PORT = 45831;
const uiLanguage=require('./native-language.cjs');
const UI_PATH = path.join(__dirname, 'renderer', 'index.html');
const UI_URL = pathToFileURL(UI_PATH).href;
const UI_DIRECTORY_URL = pathToFileURL(path.dirname(UI_PATH) + path.sep).href;
const CAPTURE_SELECTION_TTL_MS = 15_000;

let mainWindow = null;
let currentRoom = null;
const {CameraConsent,promptCamera}=require('./files/camera-consent.cjs');
const {LiveCameraConsent}=require('./files/live-camera-consent.cjs');
const liveCamera=new LiveCameraConsent();
let shelf=null, partialJournal=null;
function clearShelf(){const old=shelf;shelf=null;return old?.store.close();}
let roomTransition = false;
let roomGeneration = 0;
const {randomUUID}=require('node:crypto');
const {ProtectedAudio}=require('./protected-audio.cjs');
const streamAudio=new ProtectedAudio();
let captureSelection = null, audioGrant=null;
function clearCapture() {
  captureSelection=null;audioGrant=null;streamAudio.stop();liveCamera.reset();
}
let lastSources = new Set();
let lastSourcesAt = 0;
let sourceRequest = 0;
let quitting = false;
let trayController;

// An explicit, local profile option makes two-instance tests possible without
// sharing Local Storage. It is not a URL, remote-debugging port, or IPC endpoint.
const profileArg = process.argv.find((value) => value.startsWith('--craftlink-profile='));
const windowsAppId = 'CRAFTCODE.Link.Desktop';
app.setName('CRAFTCODE LINK');
if (process.platform === 'win32') app.setAppUserModelId(windowsAppId);
const profile = profileArg?.slice('--craftlink-profile='.length);
const profileRoot = path.join(app.getPath('appData'), 'CRAFTCODE LINK');
const named = profile && /^[a-zA-Z0-9_-]{1,48}$/.test(profile);
let storageLocationController;
{
  // Lock identity must survive moving userData to another disk. No session or
  // database is opened until the verified migration has fully completed.
  const anchor = named ? path.join(profileRoot, 'profiles', profile) : process.platform==='win32'?profileRoot:app.getPath('userData');
  try{
    const {StorageLocation}=require('./storage-location.cjs');
    const installDirectory=app.isPackaged?path.dirname(process.execPath):app.getAppPath();
    storageLocationController=new StorageLocation({anchor,downloads:app.getPath('downloads'),installDirectory,
      freshDirectory:app.isPackaged&&!named?path.join(installDirectory,'CRAFTCODE LINK Data'):undefined,
      dialog,window:()=>mainWindow,guardOwner:true,maintenanceDirectory:app.getPath('appData')});
    storageLocationController.checkMaintenance();
    require('node:fs').mkdirSync(anchor,{recursive:true,mode:0o700});app.setPath('userData',anchor);
    if(!app.requestSingleInstanceLock()){app.exit(0);return;}
    require('./profile-paths.cjs').useProfile(app,storageLocationController.bootstrap());
  }catch(error){dialog.showErrorBox(tr('Не удалось открыть данные LINK'),require('./storage-location.cjs').storageError(error).message);app.exit(1);return;}
}
const graphics=require('./graphics.cjs').createGraphics(app);
app.on('gpu-info-update',()=>sendEvent({type:'graphics-updated'}));
app.on('second-instance', () => reveal(mainWindow));

function isAppURL(value) {
  if (typeof value !== 'string') return false;
  try {
    const candidate = new URL(value);
    candidate.hash = '';
    return candidate.href === UI_URL;
  } catch {
    return false;
  }
}

function trustedContents(contents) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && contents &&
    contents === mainWindow.webContents && !contents.isDestroyed() && isAppURL(contents.getURL()));
}

function trustedFrame(frame) {
  try {
    return Boolean(mainWindow && !mainWindow.isDestroyed() && frame &&
      frame === mainWindow.webContents.mainFrame && isAppURL(frame.url));
  } catch {
    return false; // Electron can invalidate a frame during a native capture prompt.
  }
}

function requireTrustedIPC(event) {
  if (!trustedContents(event.sender) || !trustedFrame(event.senderFrame)) {
    throw new Error(tr('Недопустимый источник команды.'));
  }
}

function objectArgument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(tr('Некорректные параметры команды.'));
  }
  return value;
}

function stringArgument(value, maximum, name = tr('Значение')) {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) {
    throw new Error(`${name}${tr(": некорректное или слишком длинное значение.")}`);
  }
  return value;
}

function sendEvent(value) {
  if (trustedContents(mainWindow?.webContents)) {
    mainWindow.webContents.send('craftlink:event', value);
  }
}

// Compare only in memory. The renderer receives a change notification without any address.
let lastInterfaces;
const interfaceTimer=setInterval(()=>{
  if(!currentRoom){lastInterfaces=undefined;return;}
  try {
    const snapshot=Object.entries(os.networkInterfaces()).flatMap(([name,addresses])=>
      (addresses||[]).filter(a=>!a.internal).map(a=>[name,a.family,a.address,a.netmask].join('/'))).sort().join('|');
    if(lastInterfaces!==undefined && snapshot!==lastInterfaces)sendEvent({type:'network-route-changed'});
    lastInterfaces=snapshot;
  } catch { /* ICE state events remain available. */ }
},3000);
interfaceTimer.unref();

function environmentInfo() {
  const platform = os.platform();
  const osRelease = os.release();
  const winBuild = platform === 'win32' ? Number(osRelease.split('.')[2]) : 0;
  return {
    version: app.getVersion(),
    platform,
    arch: process.arch,
    electron: process.versions.electron,
    osRelease,
    // Attempt process-loopback only. Runtime activation decides availability on this installation.
    systemAudioSupported: platform === 'win32' && winBuild >= 19041,
    udpMin: UDP_MIN,
    udpMax: UDP_MAX,
  };
}

async function closeRoom(preserveSwitch) {
  const shelfClosing=clearShelf();
  if (internetRoom) {
    internetRoom = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setWebRTCIPHandlingPolicy('default');
      mainWindow.webContents.setWebRTCUDPPortRange({min:UDP_MIN,max:UDP_MAX});
    }
  }
  direct?.clear(preserveSwitch);
  roomGeneration += 1;
  clearCapture();
  lastSources.clear();
  const room = currentRoom;
  currentRoom = null;
  direct?.presence();
  await Promise.all([shelfClosing,room?.close()]);
}

function roomRequired() {
  if (!currentRoom) throw new Error(tr('Сначала создайте комнату или подключитесь к другу.'));
  return currentRoom;
}

async function openRoom(kind, options, adoptGuest) {
  if(quitting || updates?.launching)throw Error(tr('Приложение завершает работу.'));
  if (roomTransition) throw new Error(tr('Подождите завершения предыдущего подключения.'));
  roomTransition = true;
  try {
    await closeRoom();
    const generation = roomGeneration;
    let eventDeliveryReady = false;
    let earlyClosed = false;
    const queuedEvents = [];
    const onEvent = (event) => {
      if (generation !== roomGeneration) return;
      if (!eventDeliveryReady) {
        if (event.type === 'closed') earlyClosed = true;
        queuedEvents.push(event);
        return;
      }
      if (event.type === 'closed') {
        currentRoom = null;
        clearShelf()?.catch(()=>{});clearCapture();
      }
      if(['roster','closed'].includes(event.type))direct?.presence();
      sendEvent(event);
    };
    const room = kind === 'host'
      ? await startHost({ ...options, onGuestJoined:(port,invite,id,address)=>direct?.joinedPeer(port,invite,id,address), onGuestGoodbye:(port,invite,address)=>direct?.leftByChoice(port,invite,address), udpMin: UDP_MIN, udpMax: UDP_MAX, onEvent })
      : adoptGuest ? adoptGuest(onEvent) : await joinRecoveringGuest({ ...options, onEvent });
    if (generation !== roomGeneration || quitting || earlyClosed) {
      await room.close();
      throw new Error(earlyClosed ? tr('Комната закрылась во время подключения.') : tr('Подключение отменено.'));
    }
    currentRoom = room;
    direct?.presence();
    const info = room.getInfo();
    // Flush only after the invoke result is queued for the renderer. The UI also
    // buffers events until it has installed the returned session identity.
    setImmediate(() => {
      if (generation !== roomGeneration || quitting) return;
      eventDeliveryReady = true;
      for (const event of queuedEvents) {
        if (event.type === 'closed') {currentRoom = null;clearShelf()?.catch(()=>{});clearCapture();}
        if(['roster','closed'].includes(event.type))direct?.presence();
        sendEvent(event);
      }
      queuedEvents.length = 0;
    });
    return info;
  } finally {
    roomTransition = false;
  }
}

let chatLinks;
function registerIPC() {
  const handle = (name, handler) => {
    ipcMain.handle(`craftlink:${name}`, async (event, argument) => {
      requireTrustedIPC(event);
      if(quitting || updates?.launching)throw Error(tr('Приложение завершает работу.'));
      const result=handler(argument);
      if(name==='direct' && argument?.op==='policy'){updates?.policy();chatLinks?.policy();}
      return result;
    });
  };
  handle('flush-local-preferences',()=>mainWindow.webContents.session.flushStorageData());

  direct=require('./direct/ipc.cjs').directIPC({handle,window:()=>mainWindow,journal:()=>partialJournal,
    downloads:()=>storageLocationController.downloads(),downloadRoots:()=>storageLocationController.downloadRoots(),
    emit:e=>{if(e.type==='game-invited'||e.type==='game-requested')trayController?.ring(e.type==='game-requested'?'game-request':'game',e);sendEvent(e);},room:()=>currentRoom?.getInfo(),roomToken:()=>currentRoom,openRoom,closeRoom,busy:()=>!!currentRoom||roomTransition,ring:(kind,info)=>trayController?.ring(kind,info),clearChatNotice:id=>trayController?.clearChatNotice(id)});
  const updateBlocker=()=>currentRoom||roomTransition?'Завершите звонок или закройте приглашение, затем нажмите «Установить» снова.':direct.updateBlocker();
  updates=require('./release-update.cjs').registerUpdates({handle,app,dialog,window:()=>mainWindow,
    allowed:()=>direct?.allowsPublicLookup()===true,updateBlocker,gameRoom:()=>direct.gameRoom,leaveGame:()=>direct.leaveGameForUpdate(),
    changed:state=>sendEvent({type:'release-updated',state}),announce:version=>!currentRoom&&!roomTransition&&trayController?.offerUpdate(version),
    openExternal:url=>shell.openExternal(url)});
  if(storageLocationController){
    const storageControls=require('./storage-controls.cjs').createStorageControls({location:storageLocationController,session:()=>mainWindow.webContents.session,updates,openDirectory:folder=>shell.openPath(folder),
      restart:async()=>{mainWindow.webContents.session.flushStorageData();app.relaunch();app.quit();},
      sessionActive:()=>!!(updateBlocker()||direct.gameRoom)});
    handle('storage',raw=>storageControls.command(raw));
  }
  const publicLookups=()=>direct?.allowsPublicLookup()===true;
  const player=require('./youtube-player.cjs').createYouTubePlayer({BrowserWindow,session,parent:()=>mainWindow,allowed:publicLookups,appId:windowsAppId});
  chatLinks=require('./chat-links.cjs').registerChatLinks({handle,allowed:publicLookups,player,openExternal:url=>shell.openExternal(url)});
  handle('selected-file',async raw=>{
    const {target,caption}=raw||{};
    if(!target||typeof caption!=='string'||caption.length>1024)throw Error(tr('Некорректная команда.'));
    const text=caption.trim()?require('./core/protocol.cjs').validateChat(caption):'';
    const disk=typeof raw.filename==='string' && path.isAbsolute(raw.filename) && !raw.filename.includes('\0');
    if(!disk && (typeof raw.name!=='string'||!raw.name||raw.name.length>255||!(raw.bytes instanceof Uint8Array)||raw.bytes.length>8*1024**2))throw Error(tr('Некорректная команда.'));
    const file=disk?{filename:raw.filename}:{name:raw.name,bytes:raw.bytes};
    if(target.type!=='room')return direct.offerSelected(target,file,text);
    const current=shelf;
    if(!current||current.room!==roomRequired()||target.scope!==current.id)throw Error(tr('Комната закрыта.'));
    const meta=disk?await current.store.offer(file.filename):current.store.memory(file.name,file.bytes);
    if(shelf!==current)throw Error(tr('Комната закрыта.'));
    return {...meta,...(disk?{}:{memoryOnly:true}),...(text?{caption:text}:{})};
  });
  handle('files',async raw=>{
    const room=roomRequired(), op=raw?.op;
    if(op==='open'){
      await clearShelf();if(currentRoom!==room)throw Error(tr('Комната закрыта.'));
      const {ShelfStorage,safe}=require('./files/storage.cjs');
      shelf={id:randomUUID(),room,camera:new CameraConsent(),name:safe(raw.label||'LINK'),store:new ShelfStorage(storageLocationController?.downloads()||app.getPath('downloads'),partialJournal)};
      return shelf.id;
    }
    const x=shelf;if(!x||x.room!==room||x.id!==raw.scope)throw Error(tr('Комната закрыта.'));
    const store=x.store;
    if(op==='offer'){
      const picked=await dialog.showOpenDialog(mainWindow,{title:tr('Поделиться файлом'),properties:['openFile']});
      if(picked.canceled||shelf!==x)return null;return store.offer(picked.filePaths[0]);
    }
    if(op==='reveal'){const file=store.location(raw.id);shell.showItemInFolder(file);return true;}
    if(op==='clip')return store.clip(raw.kind,raw.bytes);
    if(op==='preview')return store.preview(raw.id,raw.meta);
    if(op==='camera-end'){x.camera.cancel(raw.requestId);return;}
    if(op==='camera')return x.camera.ask(raw.requestId,()=>promptCamera(()=>mainWindow,dialog),()=>shelf===x);
    if(op==='read-range')return store.readBytes(raw.id,raw.pos,raw.length);
    if(op==='put-range')return store.putBytes(raw.id,raw.pos,raw.bytes);
    if(op==='read')return store.read(raw.id,raw.pos);
    if(op==='begin'){store.downloads=storageLocationController?.downloads()||app.getPath('downloads');return store.begin(raw.meta,x.name);}
    if(op==='put')return store.put(raw.id,raw.pos,raw.data);
    if(op==='cancel')return store.cancel(raw.id);
    if(op==='remove')return store.remove(raw.id);
    if(op==='clear')return clearShelf();throw Error(tr('Неизвестная команда.'));
  });
  handle('tray-state', raw => {
    const connected = Boolean(currentRoom) && raw?.connected === true;
    trayController?.setNoticePolicy(raw?.systemNotices!==false,raw?.dnd===true);
    trayController?.setCall(connected, connected && raw?.sharing === true);
    updates?.announceAvailable();
  });
  handle('internet', async raw => {
    const {op} = objectArgument(raw);
    if (op === 'check-registration') {
      const key = raw.provider;
      if (!['jabberclub','jabberru'].includes(key)) return false;
      if (!registrationChecks.has(key)) {
        const isolated = session.fromPartition('link-registration-check', {cache:false});
        const pending = registrationAvailable(key, isolated.fetch.bind(isolated)).finally(()=>registrationChecks.delete(key));
        registrationChecks.set(key, pending);
      }
      return registrationChecks.get(key);
    }
    if (['register', 'account-help', 'recover'].includes(op)) {
      const provider = getProvider(raw.provider);
      if (!provider) throw new Error(tr('Выберите сервис аккаунта.'));
      return shell.openExternal(provider[op]);
    }
    if (op === 'save-card' || op === 'read-card') {
      const card = await import('./friends/account-card.mjs');
      const filters = [{ name:tr('Карточка входа CRAFTCODE LINK'), extensions:['txt'] }];
      if (op === 'read-card') {
        const choice = await dialog.showOpenDialog(mainWindow, {title:tr('Открыть карточку входа'), filters, properties:['openFile']});
        if (choice.canceled || !choice.filePaths.length) return null;
        try { return await card.readCard(choice.filePaths[0]); }
        catch { throw new Error(tr('Не удалось прочитать карточку. Выберите TXT-файл, сохранённый в CRAFTCODE LINK, или введите адрес вручную.')); }
      }
      const { jid, loginProvider } = await import('./renderer/account-address.mjs');
      const id = jid(stringArgument(raw.id, 260));
      if (!loginProvider(id)) throw new Error(tr('Сначала войдите в аккаунт.'));
      const choice = await dialog.showSaveDialog(mainWindow, { title:tr('Сохранить карточку входа'), filters,
        defaultPath:path.join(app.getPath('documents'), 'CRAFTCODE-LINK-' + id + '.txt') });
      if (choice.canceled || !choice.filePath) return false;
      const roots = [app.getPath('userData')];
      if (process.platform === 'win32' || named) roots.push(profileRoot);
      if (app.isPackaged) roots.push(path.dirname(process.execPath));
      await card.writeCard(choice.filePath, id, roots);
      return true;
    }
    if (op === 'load') return accountProfile.load();
    if (op === 'forget') return accountProfile.forget();
    if (op === 'save') return accountProfile.save(stringArgument(raw.id,260),stringArgument(raw.password,1024));
    if(op==='sync-game-notices'){if(Array.isArray(raw.ids))trayController?.syncGameNotices(raw.ids.slice(0,48));return;}
    if(op==='clear-request-notice'){trayController?.clearRequestNotice(raw.source);return;}
    if(op==='end-ring'){if(trayController)trayController.endRing();else mainWindow?.flashFrame(false);return;}
    if (op === 'ring') {
      if(raw.kind==='message'||raw.kind==='update')return;
      if(trayController)trayController.ring(raw.kind,raw);
      else if(mainWindow&&!mainWindow.isFocused())mainWindow.flashFrame(true);
      return;
    }
    if(op==='show-executable'){
      if(process.platform==='win32' && app.isPackaged)shell.showItemInFolder(process.execPath);
      return;
    }
    if (op === 'open') {
      if (currentRoom || roomTransition) throw new Error(tr('Сначала завершите другой звонок.'));
      mainWindow.webContents.setWebRTCUDPPortRange({min:0,max:0});
      mainWindow.webContents.setWebRTCIPHandlingPolicy(raw.proxyOnly === true ? 'disable_non_proxied_udp' : 'default_public_and_private_interfaces');
      internetRoom = true;
      currentRoom = { close: async () => {}, getInfo: () => ({ role:'internet' }) };
      direct?.presence();
      return;
    }
    throw new Error(tr('Неизвестная команда.'));
  });
  handle('apply-language',()=>{if(!currentRoom&&!roomTransition)setImmediate(()=>mainWindow?.webContents.reload());});
  handle('language',value=>uiLanguage.save(app.getPath('userData'),value));
  handle('graphics-status', () => graphics.snapshot());
  handle('graphics-save', value => graphics.set(value));
  handle('graphics-restart', () => {
    const choice=graphics.snapshot();
    if(currentRoom||roomTransition)throw Error(tr('Сначала завершите звонок.'));
    if(choice.automatic===choice.applied||quitting)return;
    app.relaunch();app.quit();
  });
  handle('environment', () => environmentInfo());
  handle('recording-privacy', async action=>{
    if(process.platform!=='win32')return null;
    if(action==='status')return Object.fromEntries(['microphone','camera'].map(device=>[device,systemPreferences.getMediaAccessStatus(device)]));
    const page=action==='microphone'?'ms-settings:privacy-microphone':action==='camera'?'ms-settings:privacy-webcam':null;
    if(!page)throw Error(tr('Некорректная команда.'));
    await shell.openExternal(page);return true;
  });
  handle('capture-border-settings', async () => {
    if(process.platform!=='win32' || Number(os.release().split('.')[2])<20348)return false;
    await shell.openExternal('ms-settings:privacy-graphicscapturewithoutborder');return true;
  });
  handle('host-room', async (argument) => {
    const options = objectArgument(argument);
    const name = stringArgument(options.name, 48, tr('Имя'));
    const address = stringArgument(options.address, 253, tr('Адрес'));
    const port = options.port ?? CONTROL_PORT;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(tr('Порт должен быть от 1024 до 65535.'));
    return openRoom('host', { name, address, port });
  });
  handle('join-room', async (argument) => {
    const options = objectArgument(argument);
    return openRoom('guest', {
      name: stringArgument(options.name, 48, tr('Имя')),
      invite: stringArgument(options.invite, 8192, tr('Приглашение')),
    });
  });
  handle('leave-room', async () => {
    await closeRoom();
    return { ok: true };
  });
  handle('send-signal', (argument) => {
    const options = objectArgument(argument);
    const peerId = stringArgument(options.peerId, 80, tr('Участник'));
    const data = objectArgument(options.data);
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 128 * 1024) throw new Error(tr('Слишком большое сообщение соединения.'));
    roomRequired().sendSignal(peerId, data);
    return { ok: true };
  });
  handle('send-chat', (argument) => {
    const { text } = objectArgument(argument);
    roomRequired().sendChat(stringArgument(text, 4000, tr('Сообщение')));
    return { ok: true };
  });
  handle('set-presence', (argument) => {
    const options = objectArgument(argument);
    if (typeof options.micMuted !== 'boolean' || typeof options.sharing !== 'boolean') {
      throw new Error(tr('Некорректное состояние участника.'));
    }
    roomRequired().setPresence({
      micMuted: options.micMuted,
      sharing: options.sharing,
      shareTitle: stringArgument(options.shareTitle ?? '', 160, tr('Название трансляции')),
    });
    return { ok: true };
  });
  handle('live-camera', async raw=>{
    const options=objectArgument(raw);
    if(Object.keys(options).some(key=>!['action','requestId'].includes(key)) || !['ask','cancel'].includes(options.action) ||
      typeof options.requestId!=='string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(options.requestId))throw Error(tr('Некорректный запрос камеры.'));
    if(options.action==='cancel'){liveCamera.cancel(options.requestId);return false;}
    const room=roomRequired(),generation=roomGeneration;
    return liveCamera.authorize(options.requestId,{window:()=>mainWindow,dialog,current:()=>currentRoom===room && roomGeneration===generation});
  });
  handle('sources', async type => {
    const room = roomRequired();
    if (type !== 'screen' && type !== 'window') throw new Error(tr('Выберите экран или окно.'));
    const request = ++sourceRequest;
    lastSources.clear();
    const sources = await desktopCapturer.getSources({
      types: [type],
      thumbnailSize: { width: 300, height: 180 },
      fetchWindowIcons: false,
    });
    if (currentRoom !== room) throw new Error(tr('Комната закрыта.'));
    if (request !== sourceRequest) return [];
    const limited = sources.filter(source => source.id.startsWith(type + ':')).slice(0, 200);
    lastSources = new Set(limited.map(source => source.id));
    lastSourcesAt = Date.now();
    return limited.map((source) => ({
      id: source.id,
      name: source.name,
      type: source.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: source.thumbnail?.isEmpty() ? '' : source.thumbnail?.toDataURL() ?? '',
    }));
  });
  handle('select-source', (argument) => {
    roomRequired();
    const options = objectArgument(argument);
    const id = stringArgument(options.id, 256, tr('Источник'));
    if (typeof options.withAudio !== 'boolean') throw new Error(tr('Выберите режим звука.'));
    if (Date.now() - lastSourcesAt > 60_000 || !lastSources.has(id)) {
      throw new Error(tr('Список источников устарел. Обновите его и выберите окно снова.'));
    }
    if (options.withAudio && !environmentInfo().systemAudioSupported) {
      throw new Error(tr('Системный звук в этой версии поддерживается только в Windows.'));
    }
    audioGrant=null;
    const token=randomUUID();
    captureSelection = { id, token, generation: roomGeneration, withAudio: options.withAudio, expires: Date.now() + CAPTURE_SELECTION_TTL_MS };
    return {token};
  });
  handle('stream-audio', raw=>{
    const {op,token}=objectArgument(raw);
    if(typeof token!=='string' || token.length!==36)throw new Error(tr('Недействительный источник.'));
    if(op==='stop'){if(audioGrant?.token===token)audioGrant=null;streamAudio.stop(token);return;}
    roomRequired();
    if(op==='read')return streamAudio.read(token);
    if(op==='start' && audioGrant?.token===token && audioGrant.generation===roomGeneration && audioGrant.expires>=Date.now()){
      audioGrant=null;
      return streamAudio.start(token);
    }
    throw new Error(tr('Сначала выберите источник трансляции.'));
  });
  handle('copy-text', (argument) => {
    clipboard.writeText(stringArgument(argument, 128 * 1024, tr('Текст')));
    return { ok: true };
  });
}

function configurePermissions(appSession) {
  const permittedCamera=()=>[liveCamera,shelf?.camera,direct?.camera,direct?.lanCamera].find(camera=>camera?.allowed());
  const otherAllowedPermissions = new Set([
    'speaker-selection', 'fullscreen', 'screen-wake-lock',
    'local-network', 'local-network-access', 'loopback-network',
  ]);
  appSession.setPermissionCheckHandler((contents, permission, _origin, details) => {
    if (!trustedContents(contents) || details?.isMainFrame === false ||
        (details?.requestingUrl && !isAppURL(details.requestingUrl))) return false;
    if (permission === 'media') return details?.mediaType !== 'video' || !!permittedCamera();
    // The display-media request handler, not this generic permission check,
    // consumes the one-time source selection capability.
    return permission === 'display-capture' || otherAllowedPermissions.has(permission);
  });
  appSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (!trustedContents(contents) || details?.isMainFrame === false ||
        !isAppURL(details?.requestingUrl)) {
      callback(false);
      return;
    }
    if (permission === 'media') {
      const types = details.mediaTypes ?? [];
      const video=types.includes('video');
      const camera=permittedCamera();
      const allowed=types.length>0 && types.every(type=>type==='audio'?(!video||camera?.audioAllowed!==false):(type==='video' && camera?.allowed()===true));
      if(video && allowed)camera?.consume();callback(allowed);
      return;
    }
    callback(permission === 'display-capture' || otherAllowedPermissions.has(permission));
  });
  appSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const selected = captureSelection;
    captureSelection = null; // Every selection authorizes at most one request.
    if (!trustedFrame(request.frame) || !request.videoRequested || !selected || selected.expires < Date.now()) {
      callback(null);
      return;
    }
    try {
      const sources = await desktopCapturer.getSources({
        types: [selected.id.startsWith('screen:') ? 'screen' : 'window'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      });
      const source = sources.find((candidate) => candidate.id === selected.id);
      if (!source || !currentRoom || selected.generation !== roomGeneration || !trustedFrame(request.frame)) {
        callback(null);
        return;
      }
      if(selected.withAudio && environmentInfo().systemAudioSupported) audioGrant=selected;
      callback({video:source});  // No endpoint loopback, even if a renderer requests audio.

    } catch {
      callback(null);
      sendEvent({ type: 'error', message: tr('Не удалось захватить выбранное окно. Возможно, оно уже закрыто.') });
    }
  }, { useSystemPicker: false });

  // Network control lives in the main-process TLS client/server. The renderer
  // never needs to fetch remote pages, assets, telemetry, or third-party code.
  appSession.webRequest.onBeforeRequest((details, callback) => {
    const accountHttp = BOSH_SERVICES.has(details.url) && details.resourceType === 'xhr' &&
      ['POST','OPTIONS'].includes(details.method) && details.webContentsId === mainWindow?.webContents.id;
    let allowed = accountHttp || (INTERNET_SERVICES.has(details.url) && details.resourceType === 'webSocket' && details.webContentsId === mainWindow?.webContents.id) ||
      details.url.startsWith(UI_DIRECTORY_URL) ||
      details.url.startsWith('data:') || details.url.startsWith('blob:');
    if (!app.isPackaged && details.url.startsWith('devtools:')) allowed = true;
    callback({ cancel: !allowed });
  });
}

async function createWindow() {
  const appSession = session.defaultSession;
  const area = require('electron').screen.getPrimaryDisplay().workAreaSize;
  // Headless or disconnected displays can temporarily report a 1 × 1 work area.
  const {width, height} = area.width >= 320 && area.height >= 240 ? area : {width:1440, height:940};
  mainWindow = new BrowserWindow({
    title: 'CRAFTCODE LINK',
    icon: path.join(__dirname,'renderer','assets',process.platform==='win32'?'craftlink.ico':'craftlink.png'),
    width: Math.min(1440, width),
    height: Math.min(940, height),
    minWidth: Math.min(800, width),
    minHeight: Math.min(560, height),
    backgroundColor: '#101312',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      backgroundThrottling: false,
      devTools: !app.isPackaged,
      session: appSession,
    },
  });
  const stopNote=()=>{liveCamera.reset();shelf?.camera.reset();direct?.camera?.reset();direct?.lanCamera.reset();sendEvent({type:'window-hidden'});};
  mainWindow.on('hide',stopNote);
  mainWindow.on('focus',()=>{sendEvent({type:'window-focused'});updates?.announceAvailable();});
  mainWindow.on('enter-full-screen',()=>trayController?.hideUpdate());
  mainWindow.on('leave-full-screen',()=>updates?.announceAvailable());
  mainWindow.on('enter-html-full-screen',()=>trayController?.setHtmlFullscreen(true));
  mainWindow.on('leave-html-full-screen',()=>{trayController?.setHtmlFullscreen(false);updates?.announceAvailable();});
  mainWindow.on('minimize',stopNote);
  if (process.platform === 'win32') {
    mainWindow.setAppDetails({appId:windowsAppId, appIconPath:process.execPath, appIconIndex:0});
    let tray;
    try {
      tray = new Tray(path.join(__dirname, 'renderer', 'assets', 'craftlink.ico'));
      trayController = attachTray({ window: mainWindow, tray, menu: Menu, createNotification:options=>Notification.isSupported()?new Notification({...options,icon:path.join(__dirname,'renderer','assets','craftlink.ico')}):null, canOpenChat:(profile,id)=>direct?.canOpenChat(profile,id),openChat:(profile,id)=>sendEvent({type:'tray-chat',profile,id}),openGame:id=>sendEvent({type:'tray-game',id}), openRequests:kind=>sendEvent({type:'tray-requests',kind}),
        openUpdates:()=>sendEvent({type:'tray-update'}),showUpdateHint:version=>sendEvent({type:'release-offer',version}),
        stopSharing:()=>sendEvent({type:'tray-stop-sharing'}), leaveRoom:()=>sendEvent({type:'tray-leave'}), quit: () => app.quit(), isQuitting: () => quitting });
    } catch {
      tray?.destroy();
      await dialog.showMessageBox(mainWindow, { type: 'info', message: tr('Значок в трее недоступен. В этом сеансе крестик полностью закроет программу.') });
    }
  }
  const contents = mainWindow.webContents;
  contents.setWebRTCUDPPortRange({ min: UDP_MIN, max: UDP_MAX });
  const actualRange = contents.getWebRTCUDPPortRange();
  if (actualRange.min !== UDP_MIN || actualRange.max !== UDP_MAX) {
    throw new Error(tr('Не удалось установить диапазон UDP для WebRTC.'));
  }
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-frame-navigate', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('render-process-gone', () => {
    direct?.endGame();closeRoom().catch(() => {}); // Renderer died: tear down all live network access.
  });
  configurePermissions(appSession);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
    clearCapture();
    lastSources.clear();
  });
  await mainWindow.loadURL(UI_URL);
}

app.whenReady().then(async () => {
  uiLanguage.load(app.getPath('userData'));
  if(process.platform==='win32'){
    const {PartialJournal}=require('./files/partial-journal.cjs');
    partialJournal=new PartialJournal(app.getPath('userData'));
    for(const downloads of storageLocationController.downloadRoots())await partialJournal.recover(downloads).catch(()=>{});
  }
  Menu.setApplicationMenu(null);
  accountProfile = new AccountProfile(app.getPath('userData'), safeStorage);
  registerIPC();
  await createWindow();
}).catch((error) => {
  dialog.showErrorBox(tr('CRAFTCODE LINK: ошибка запуска'), String(error?.message || error));
  app.quit();
});

app.on('will-quit', () => trayController?.destroy());
app.on('window-all-closed', () => app.quit());
let releasedForQuit=false;
app.on('before-quit', event => {
  if(releasedForQuit)return;
  event.preventDefault();
  if(quitting)return;
  quitting=true;updates?.close();chatLinks?.close();
  Promise.allSettled([closeRoom(),direct?.stop()]).finally(()=>{
    releasedForQuit=true;
    app.quit();
  });
});
