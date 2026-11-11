import {chatComposer} from './chat-composer.mjs';
import {bindAttachmentDraft} from './attachment-draft.mjs';
import {createChatView} from './chat-view.mjs';
import {parseUpdateCode} from './release-code.mjs';
import {updateControls} from './update-controls.mjs';
import {RoomFiles} from './room-files.mjs';
import {requestNotices} from './request-notices.mjs';
import {createWorkspace} from './workspace.mjs';
import {tr} from './locale.mjs';
import {bindProfileAppearance,paintAvatar} from './profile-appearance.mjs';
import {bindProfileWelcome} from './profile-welcome.mjs';
import {bindHelpCenter} from './help-center.mjs';
import {bindSettingsNavigation} from './settings-navigation.mjs';
import {roomPortraits} from './room-portraits.mjs';
import {participantMix} from './participant-mix.mjs';
import {participantSoundMenu} from './participant-sound-menu.mjs';
import {attachVideo, bindPlayerControls} from './player-controls.mjs';
import {outgoingScreens, videoFormat} from './stream-inspector.mjs';
import { RoomMedia, ROLES } from './peer.mjs';
import {RoomMicrophoneChoice} from './room-microphone.mjs';
import { AudioMixer, Microphone, volumeLimit } from './audio.mjs';

import { directPanel } from './direct-panel.mjs';
import { internetPanel } from './internet-panel.mjs';
import { removeDisplayAudio, openProtectedAudio } from './capture.mjs';
import { roomReport, routeProblem } from './diagnostics.mjs';

const $ = id => document.getElementById(id);
import {language,localizeStatic} from './locale.mjs';
const api = window.craftlink;
let internet, direct, workspace, projectUpdates;
const defaults = { identityMode:"auto",playerPinned:false,dnd:false,systemNotices:true,jabberBlocked:{},directoryFilter:'all',directorySort:'available',jabberFavorites:{},jabberRecent:{}, accountIntroSeen:false, registrationService:'', viewHeight:0, focusAudio:false, accountProvider:'', publicStun:true, cueEnabled:true, cueVolume:35, proxyOnly:false, name: '', profileNames:{}, address: '', port: 45831, micDevice: '', outputDevice: '', roomOutputVolume:100, micGain: 100, streamGain: 100,
  cueMessages:true,echoCancellation: true, noiseSuppression: true, autoGainControl: true, quality: '1080p30', content: 'motion', bitrate: 8 };
let settings = { ...defaults };
try {
  const saved = JSON.parse(localStorage.getItem('craftlink.settings.v1') || '{}');
  for (const key of Object.keys(defaults)) if (typeof saved[key] === typeof defaults[key]) settings[key] = saved[key];
  if(typeof saved.cueMessages!=='boolean')settings.cueMessages=settings.cueEnabled;
} catch { /* Storage is optional, never required for a call. */ }
for(const k of ['jabberFavorites','jabberRecent'])if(!settings[k]||Array.isArray(settings[k]))settings[k]={};
if (!settings.profileNames || Array.isArray(settings.profileNames)) settings.profileNames={};
if (!['720p30','720p60','1080p30','1080p60','1440p30','1440p60'].includes(settings.quality)) settings.quality = defaults.quality;
if (![0,720,1080,1440].includes(settings.viewHeight)) settings.viewHeight=0;
if (![2, 4, 8, 12, 20, 32].includes(settings.bitrate)) settings.bitrate = defaults.bitrate;
settings.micGain = Math.min(volumeLimit('voice'), Math.max(0, settings.micGain));
settings.roomOutputVolume = Math.max(0,Math.min(100,settings.roomOutputVolume));

settings.streamGain = Math.min(200, Math.max(0, settings.streamGain));

const state = {
  environment: null, session: null, media: null, peers: [], mode: 'host', starting: false,
  ready: false, queuedEvents: [], micMuted: true, deafened: false, sharing: false, shareTitle: '',
  sourceListRequest:0, sourceChoice:null, captureAbort:null, protectedSound:null, withSound:false, audioLost:false, screenStream: null, pendingScreenStream: null, sourceType: 'screen', sources: [], selectedPeerId: null,
  connectionStates: new Map(), stats: new Map(), captureBusy: false, micBusy: false,
  roomEpoch: 0, captureEpoch: 0, errorTimes: new Map(),
};
let eventQueue = Promise.resolve();
function enqueueEvent(event) {
  const epoch = state.roomEpoch;
  eventQueue = eventQueue.then(() => {
    if (epoch === state.roomEpoch) return handleEvent(event);
  }).catch(errorToast);
  return eventQueue;
}
const mixer = new AudioMixer({ onError: errorToast });
mixer.setRoomVolume(settings.roomOutputVolume);
const micProfile = () => direct?.active() ? 'link/' + direct.raw().me.id :
  internet?.account.id && internet.account.status !== 'signed-out' ? 'jabber/' + internet.account.id : null;
const roomMic = new RoomMicrophoneChoice(localStorage, micProfile);
let micRequest = null;
let captureOwner = null;

function drawMicPreference() {
  const value = roomMic.read(), signedIn = !!micProfile();
  $('joinWithMic').disabled = !signedIn;
  $('joinWithMic').checked = !!value;
  $('joinWithMicHint').textContent = tr(!signedIn ? 'Войдите в профиль, чтобы запоминать микрофон на этом ПК.' :
    value === 'on' ? 'Следующий вход — с микрофоном. В комнате с управлением голосом включите его сами, когда вам дадут слово.' :
    value === 'muted' ? 'Следующий вход — с выключенным микрофоном. Включите его в звонке, чтобы запомнить этот выбор.' :
    'При включении вы войдёте в следующую комнату с микрофоном. Затем LINK запомнит ваш выбор в звонке.');
}
function saveMicPreference(value) {
  try {
    roomMic.write(value);
    // Chromium batches localStorage commits. A local mute must also survive a crashed process.
    api.flushLocalPreferences?.().catch(errorToast);
  } catch { errorToast(tr('Не удалось сохранить настройку микрофона на этом ПК.')); }
  drawMicPreference();
}
function startSavedMic() {
  if (state.ready && !state.controlLost && state.media && roomMic.take(state.media))
    enableMicrophone(false, true).catch(errorToast);
}
let ownVoiceLevel=0;
const mic = new Microphone({
  onLevel: (level, measurement) => {
    ownVoiceLevel=level;
    if (micCheck?.tap && micCheck.recorder?.state === 'recording') updateTestLevel(micCheck, measurement);
    $('micLevel').style.width = `${Math.round(level * 100)}%`;
    $('micLevel').parentElement?.setAttribute('aria-valuenow', String(Math.round(level * 100) / 100));
  },
  onEnded: () => {
    if (micCheck?.tap) stopMicCheck(tr('Микрофон отключился. Выберите другое устройство.'));
    state.micMuted = true;
    mic.setMuted(true);
    renderControls();
    sendPresence();
    errorToast(tr('Микрофон отключился. Выберите устройство и включите его снова.'));
  },
});
const mix=participantMix({state,mixer,snapshot:()=>direct?.active()?direct.raw():null,save:opts=>api.direct(opts),changed:refreshPeerMix,onError:errorToast});
const soundMenu=participantSoundMenu({state,mixer,mix,createRow:createMixerRow,createOwnRow:createOwnMixerRow,onError:errorToast,toggleMic:()=>$('micBtn').click(),
  micDisabled:()=>$('micBtn').disabled,canViewPerson:()=>direct?.active(),openPerson:peer=>{
    const session=state.session,data=direct.raw();
    const person=(session?.direct||session?.groupVoice)&&data.mixRoom&&data.mixRoom===session.mixRoom?data.roomContacts?.[peer.id]:undefined;
    direct.participant({id:person||undefined,name:peer.name},()=>state.session===session&&state.peers.some(p=>p.id===peer.id));
  }});
const portraits=roomPortraits({grid:$('voiceGrid'),state,direct:()=>direct,mixer,mix,soundMenu,
  watch:id=>{if(id!==state.session?.selfId)closeStudio();state.selectedPeerId=id;renderStage();},
  ownLevel:()=>{
  const input=mic.stream?.getAudioTracks()[0];
  return input?.readyState==='live' && !input.muted && input.enabled && mic.outputTrack?.readyState==='live' && mic.outputTrack.enabled && mic.context?.state==='running'?ownVoiceLevel:0;
}});

function showMicProcessing(input) {
  const actual = input?.getSettings();
  const labels = {echoCancellation: tr('Подавление эха'), noiseSuppression: tr('Подавление шума'), autoGainControl: tr('Автоматическое усиление')};
  const mismatches = Object.keys(labels).filter(key => actual && typeof actual[key] === 'boolean' && actual[key] !== settings[key]);
  const notice = $('micProcessingNotice');
  notice.hidden = !mismatches.length;
  notice.textContent = mismatches.length ? tr('Устройство применило другие настройки обработки') + ' · ' + mismatches.map(key => labels[key]).join(', ') : '';
}
function voiceRoomReport() {
  const input = mic.stream?.getAudioTracks()[0];
  return roomReport({...state, micInput: input?.readyState === 'live' ? input.getSettings() : null, micGain: settings.micGain,
    outputLatency: mixer.context?.state === 'running' ? mixer.context.outputLatency : null});
}

let refreshIdentity;
function saveSettings() {
  try { localStorage.setItem('craftlink.settings.v1', JSON.stringify(settings)); } catch {}
}
let toastTimer;
function toast(message, isError = false, onOpen) {
  $('toast').textContent = String(message);
  if(onOpen){
    const button=node('button','button button-secondary',tr('Открыть приглашение'));
    button.onclick=()=>{$('toast').hidden=true;onOpen();};
    $('toast').append(' ',button);
  }
  $('toast').classList.toggle('error', isError);
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, isError || onOpen ? 9000 : 4200);
}
function errorToast(error) {
  const message = typeof error === 'string' ? error : error?.message || tr('Неизвестная ошибка');
  const clean = message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  const now = Date.now();
  if (now - (state.errorTimes.get(clean) || 0) < 5000) return;
  state.errorTimes.set(clean, now);
  if (state.errorTimes.size > 100) state.errorTimes.delete(state.errorTimes.keys().next().value);
  toast(clean, true);
}
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function showDialog(id) { const d = $(id); if (!d.open) d.showModal(); }
function closeDialog(id) { $(id).close(); }
function confirmAction(title, message, confirmLabel = tr('Продолжить'), destructive=false, option) {
  return new Promise(resolve => {
    const dialog = node('dialog', 'modal');
    const heading = node('h2', '', title);
    heading.id = 'confirmActionTitle';
    dialog.setAttribute('aria-labelledby', heading.id);
    const text = node('p', 'modal-description', message);
    const actions = node('div', 'modal-actions');
    const cancel = node('button', 'button button-secondary', tr('Отмена'));
    const confirm = node('button', destructive ? 'button button-danger' : 'button button-primary', confirmLabel);
    cancel.id = 'confirmNoBtn'; confirm.id = 'confirmYesBtn';
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(result);
    };
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', () => finish(false));
    dialog.addEventListener('close', () => finish(false));
    actions.append(cancel, confirm); dialog.append(heading, text);
    if(option)dialog.append(option);
    dialog.append(actions);
    document.body.append(dialog); dialog.showModal(); cancel.focus();
  });
}
function action(id, callback) {
  $(id).addEventListener('click', () => { Promise.resolve().then(callback).catch(errorToast); });
}
function quality() {
  const height = parseInt(settings.quality,10);
  return { width: {720:1280,1080:1920,1440:2560}[height], height,
    content:settings.content==='detail'?'detail':'motion', fps: settings.quality.endsWith('60') ? 60 : 30, bitrate: settings.bitrate * 1_000_000 };
}
function self() { return state.peers.find(p => p.id === state.session?.selfId); }

function openRoomDialog(mode, invite) {
  if (state.session || state.starting) return;
  const opening = !$('roomDialog').open;
  state.mode = mode;
  $('hostFields').hidden = mode !== 'host';
  $('joinFields').hidden = mode !== 'guest';
  $('createModeBtn').classList.toggle('active', mode === 'host');
  $('joinModeBtn').classList.toggle('active', mode === 'guest');
  $('roomSubmitBtn').textContent = mode === 'host' ? tr('Создать комнату') : tr('Присоединиться');
  $('roomError').hidden = true;
  if (opening) {
    $('nameInput').value = direct?.name() || internet?.name() || settings.name;
    $('addressInput').value = settings.address;
    $('portInput').value = String(settings.port);
  }
  $('nameInput').readOnly = internet?.account.status === 'online';
  if(invite)$('inviteInput').value=invite;
  showDialog('roomDialog');
  if(invite && $('nameInput').value)return connectRoom();
  ($('nameInput').value ? mode === 'host' ? $('addressInput') : $('inviteInput') : $('nameInput')).focus();
}

const roomChat=createChatView({
  log:$('chatMessages'),scroll:$('chatMessages').parentElement,empty:$('emptyChat'),
  form:$('chatForm'),input:$('chatInput'),send:$('sendChatBtn'),maxLength:4000,dayDividers:true,onError:errorToast,
  onSend:text=>{
    if(!state.session||state.controlLost)return false;
    return state.session.internet?state.media.sendChat(text):api.sendChat({text});
  }
});
const composer=chatComposer({$,room:()=>state.media?.files,onError:errorToast,micDevice:()=>settings.micDevice});
bindAttachmentDraft({area:$('roomSidebar'),input:$('chatInput'),onError:errorToast,
  scope:()=>state.media?.files?.scope && !$('roomPage').hidden && !$('roomSidebar').hidden ?
    {type:'room',scope:state.media.files.scope,key:state.media.files.scope}:null,
  async publish(target,file,caption){
    const shelf=state.media.files;
    const meta=await api.offerSelectedFile(target,file,caption);
    if(shelf!==state.media?.files)return false;
    shelf.publish(meta);return true;
  }});
let chatPreference=null, compactRoom=false;
async function prepareMedia(info){
    const scope=await api.files({op:'open',label:info.peers.find(p=>p.slot===0)?.name||'LINK'});
    const shelf=new RoomFiles(info,opts=>api.files({...opts,scope}),()=>{if(state.media?.files===shelf){for(const p of state.peers)shelf.names.set(p.id,p.name);shelf.render($('shelfItems'));shelf.render($('chatMessages'),true);$('emptyChat').hidden=!!$('chatMessages').childElementCount;if($('networkDialog').open&&$('updatePanel').open)renderRelease();}},errorToast);
    shelf.scope=scope;shelf.view=(id,v)=>composer.view(shelf,id,v);
    const media=state.media = new RoomMedia({
      screenOutputDelay:id=>mixer.screenOutputDelay(id),
      files:shelf,rightsChanged:()=>{
        if(state.media!==media)return;
        if(!media.isHost&&media.moderated){
          roomMic.pending=null;
          if((!media.allowedVoice || micRequest?.remembered) && (micRequest || mic.outputTrack)){
            revokeRoomMic();
          }
          if(state.sharing||state.captureBusy){state.captureEpoch++;stopCapture().catch(errorToast);}
        }
        startSavedMic();renderControls();renderParticipants();
      },
      refreshIce:info.internet?()=>internet.networkServices():(info.direct||info.groupVoice)&&info.usePeerIce?()=>internet.peerServices(true):null,signalingReady:()=>!info.internet || internet.account.status==='online',
      session: info, sendSignal: data => info.internet ? internet.room.signal(data) : api.sendSignal(data), onChat:appendChat, onTrack: receivedTrack,
      onControl:(peerId,packet)=>internet?.room.fromChannel(peerId,packet),
      onState: event => { state.connectionStates.set(event.peerId, event.state); renderConnection(); renderParticipants(); },
      onError: errorToast,
      onStats: stats => { state.stats.set(stats.peerId, stats); renderStatistics(); if(state.session?.internet)renderConnection(); },
    });
    if(media.isHost&&!info.groupVoice&&$('nextCommentary').checked)media.moderated=true;
    $('nextCommentary').checked=false;shelf.render($('shelfItems'));
    if(info.internet){
      media.chatChanged=renderAvailability;
      media.backupReady=id=>internet.account.status==='online' && internet.room.text?.ready(id);
      media.backupWrite=(id,msg)=>internet.room.text.write(id,msg);
      internet.room.onText=(id,msg)=>{if(state.media===media)media.deliverChat(media.isHost?id:msg.from,msg.text,media.isHost).catch(errorToast);};
    }
    media.setViewHeight(settings.viewHeight);
    await media.updatePeers(info.peers);
    if(state.media===media)await media.setQuality(quality());
}

async function openGroupVoice(group,channel) {
  if(state.starting)return;
  const prior=state.session;
  if(prior?.groupVoice?.group===group && prior.groupVoice.channel===channel){workspace.navigate('room');return;}
  if(prior){
    const detail=prior.role==='host'&&!prior.groupVoice?'Ваша текущая комната закроется для участников.':'Вы покинете текущий звонок.';
    if(!await confirmAction(tr('Перейти в другую комнату?'),tr(detail),tr('Перейти'))||state.session!==prior)return;
    const key=await api.direct({op:'group-voice-switch',group,channel});
    await disconnectRoom(false,true);
    await connectRoom({groupVoice:{group,channel,key}});return;
  }
  await connectRoom({groupVoice:{group,channel}});
}

async function connectRoom(friend) {
  if (state.starting || state.session) return;
  const name = $('nameInput').value.trim();
  if (!friend && !name) { $('nameInput').focus(); throw new Error(tr('Введите своё имя.')); }
  if (!friend && state.mode === 'host' && !$('addressInput').value.trim()) { $('addressInput').focus(); throw new Error(tr('Укажите доступный IP-адрес создателя комнаты.')); }
  if (!friend && state.mode === 'guest' && !$('inviteInput').value.trim()) { $('inviteInput').focus(); throw new Error(tr('Вставьте приглашение от создателя комнаты.')); }
  if (!friend && state.mode === 'host' && (!$('portInput').value || !$('portInput').validity.valid)) {
    $('portInput').focus();
    $('roomError').textContent = tr('Введите целый TCP-порт от 1024 до 65535.');
    $('roomError').hidden = false;
    return;
  }
  const submittedInvite = !friend && state.mode === 'guest' ? $('inviteInput').value : '';
  state.starting = true;
  roomMic.begin();
  state.ready = false;
  state.queuedEvents.length = 0;
  state.roomEpoch++;
  $('roomSubmitBtn').disabled = true;
  for (const id of ['closeRoomDialog','createModeBtn','joinModeBtn','nameInput','addressInput','portInput','inviteInput']) $(id).disabled = true;
  $('roomError').hidden = true;
  $('roomSubmitBtn').textContent = tr('Подключение…');
  try {
    await mixer.start();
    const info = friend?.direct || (friend?.groupVoice ? await api.direct({op:'group-voice-join',...friend.groupVoice}) :
      friend?.switched ? await api.direct({op:'join-switched',key:friend.switched}) :
      friend?.directJoin ? await api.direct({op:'join',id:friend.directJoin}) : null) || (friend?.online ? await internet.prepare() : state.mode === 'host'
      ? await api.hostRoom({ name, address: $('addressInput').value.trim(), port: Number($('portInput').value) })
      : await api.joinRoom({ name, invite: $('inviteInput').value.trim() }));
    if(info.direct||info.groupVoice){info.iceServers=internet.peerServices(info.usePeerIce);}
    state.session = info;
    if (!friend && internet?.account.status !== 'online') settings.name = name;
    if (!friend && info.role === 'host') { settings.address = $('addressInput').value.trim(); settings.port = Number($('portInput').value); }
    saveSettings();
    state.peers = info.peers;
    if(info.direct)await direct.sync();
    mix.sync();
    state.micMuted = true;
    state.deafened = false;
    mixer.setDeafened(false);
    if (settings.outputDevice) {
      try { await mixer.setOutput(settings.outputDevice); }
      catch {
        await mixer.setOutput('');
        settings.outputDevice = '';
        saveSettings();
        errorToast(tr('Выбранный аудиовыход недоступен. Используется устройство по умолчанию.'));
      }
    }
    roomChat.reset();
    setSidebar(null);
    await prepareMedia(info);
    state.ready = true;
    $('inviteInput').value = '';
    closeDialog('roomDialog');
    renderAll();
    for (const event of state.queuedEvents.splice(0)) enqueueEvent(event);
    await eventQueue;
    startSavedMic();
    if (!friend && state.session?.role === 'host') {
      $('inviteOutput').value = info.invite;
      showDialog('inviteDialog');
    } else if (state.session && !friend?.online) toast(tr('Вы в комнате.'));
  } catch (error) {
    await disconnectRoom(false);
    if (friend) throw error;
    $('inviteInput').value = submittedInvite;
    $('roomError').textContent = error?.message?.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') || String(error);
    $('roomError').hidden = false;
    if (!$('roomDialog').open) showDialog('roomDialog');
  } finally {
    state.starting = false; internet?.render();
    $('roomSubmitBtn').disabled = false;
    for (const id of ['closeRoomDialog','createModeBtn','joinModeBtn','nameInput','addressInput','portInput','inviteInput']) $(id).disabled = false;
    $('roomSubmitBtn').textContent = state.mode === 'host' ? tr('Создать комнату') : tr('Присоединиться');
  }
}

async function handleEvent(event) {
  if (!state.ready) { if (state.starting) state.queuedEvents.push(event); return; }
  if (!state.session) return;
  if (event.type === 'tray-stop-sharing') { if(state.sharing) await stopCapture(); return; }
  if (event.type === 'tray-leave') { if(!document.getElementById('confirmActionTitle')) $('leaveBtn').click(); return; }
  if (event.type === 'roster') {
    const before = state.peers;
    state.peers = event.peers;
    mix.sync();
    if(state.session.internet && state.session.role==='host' && event.peers.length>before.length){ internet.play('joined');closeDialog('internetDialog');internet.hub.joined(); }
    for (const participant of before) {
      if (!state.peers.some(p => p.id === participant.id)) {
        mixer.removeParticipant(participant.id);
        state.connectionStates.delete(participant.id);
        state.stats.delete(participant.id);
        toast(`${participant.name}${tr(" вышел из комнаты")}`);
      }
    }
    await state.media.updatePeers(state.peers);
    await syncRemoteAudio();
    renderAll();
  } else if(event.type==='network-reconnecting'){
    if(!state.controlLost){
      roomMic.reconnect(!state.micMuted);
      if(micCheck?.tap)stopMicCheck();
      releaseRoomMic().catch(errorToast);
    }
    state.controlLost=true;
    state.media?.close();state.media=null;state.stats.clear();state.connectionStates.clear();
    for (const participant of state.peers) {
      mixer.detach(participant.id,'voice');
      mixer.detach(participant.id,'system');
    }
    renderStage();renderControls();renderConnection();
  } else if(event.type==='network-rejoined' && state.controlLost){
    const info=event.info;
    const elected=info.groupVoice && info.mixRoom!==state.session.mixRoom;
    for(const p of state.peers){
      if(elected||!info.peers.some(next=>next.id===p.id))mixer.removeParticipant(p.id);
    }
    if(state.session?.direct)Object.assign(info,{direct:true,mixRoom:state.session.mixRoom,hostPerson:state.session.hostPerson,iceServers:state.session.iceServers});
    if(info.groupVoice)info.iceServers=state.session.iceServers;
    state.controlLost=false;state.session=info;state.peers=info.peers;
    soundMenu.prune(new Set());
    await prepareMedia(info);
    const media=state.media;
    if(state.session!==info || !media)return;
    for(const [role,track] of [['screen',state.screenStream?.getVideoTracks()[0]],['system',state.protectedSound?.track]]){
      if(track?.readyState==='live')await media.setLocalTrack(role,track);
    }
    if(state.session===info){await sendPresence();startSavedMic();renderAll();}
  } else if(event.type==='network-route-changed'){
    if(state.session.internet)internet.account.probe();
    for(const ep of state.media?.endpoints.values() || [])state.media.checkRoute(ep);
  } else if (event.type === 'internet-restart') {
    const ep=state.media?.endpoints.get(event.peerId);
    if(ep)state.media.checkRoute(ep);
  } else if (event.type === 'signal') {
    await state.media.acceptSignal(event.from, event.data);
  } else if (event.type === 'chat') {
    appendChat(event);
  } else if (event.type === 'closed') {
    await disconnectRoom(false);
    toast(event.reason || tr('Комната закрыта создателем.'), !event.notice);
  } else if (event.type === 'error') errorToast(event.message);
}

async function disconnectRoom(notify = true, nativeAlreadyClosed = false) {
  composer.clearFor('room');
  if(micCheck)stopMicCheck();
  internet?.hub.reset();
  if (state.session?.internet || internet?.room.room) { internet.hush(); internet.room.leave(); if(notify)internet.play('ended'); }
  state.ready = false;
  roomMic.pending = null;
  state.controlLost=false;
  state.roomEpoch++;
  state.captureEpoch++;
  releaseCaptureSound();
  state.captureBusy = false;
  state.pendingScreenStream?.getTracks().forEach(track => track.stop());
  state.pendingScreenStream = null;
  state.sources = [];
  $('sourcesGrid').replaceChildren();
  state.media?.close();
  state.media = null;
  state.screenStream?.getTracks().forEach(t => t.stop());
  state.screenStream = null;
  state.sharing = false;
  state.shareTitle = '';
  state.micMuted = true;
  state.deafened = false;
  state.session = null;
  state.peers = [];
  portraits.sync();
  state.selectedPeerId = null;
  closeStudio();
  state.connectionStates.clear();
  state.stats.clear();
  state.queuedEvents.length = 0;
  showMicProcessing(null);
  await Promise.all([releaseRoomMic(), mixer.close(), nativeAlreadyClosed ? undefined : api.leaveRoom().catch(() => {})]);
  $('inviteOutput').value = '';
  $('inviteInput').value = '';
  $('chatInput').value = '';
  roomChat.reset();
  setSidebar(null);
  for (const id of ['inviteDialog', 'sourceDialog']) if ($(id).open) closeDialog(id);
  renderAll();
  if (notify) toast(tr('Вы вышли. Захват экрана и микрофона остановлен.'));
}

async function sendPresence() {
  if (!state.session) return;
  const presence = { micMuted: state.micMuted, sharing: state.sharing, shareTitle: state.shareTitle };
  const me = self();
  if (me) Object.assign(me, presence);
  renderParticipants();
  renderStage();
  try { if(state.session.internet) internet.room.presence(presence); else await api.setPresence(presence); } catch (e) { if (state.session) errorToast(e); }
}

function micBusy(value) {
  state.micBusy = value;
  for (const id of ['testMic','micDevice','echoCancellation','noiseSuppression','autoGainControl']) $(id).disabled = value;
  if (value) $('micBtn').disabled = true;
}
function releaseRoomMic() {
  micRequest = null;
  captureOwner = null;
  micBusy(false);
  state.micMuted = true;
  mic.setMuted(true);
  showMicProcessing(null);
  return mic.close();
}
function revokeRoomMic() {
  if(micCheck?.tap)stopMicCheck();
  releaseRoomMic().then(renderControls).catch(errorToast);
  state.media?.setLocalTrack('voice',null).catch(errorToast);
  sendPresence().catch(errorToast);
}
async function enableMicrophone(reconfigure = false, remembered = false) {
  const media = state.media;
  if (!state.ready || !media || state.controlLost || state.micBusy || !media.allowed(media.selfSlot,'voice')) return;
  roomMic.pending = null;
  const request = micRequest = {remembered, owner:micProfile()};
  captureOwner=request.owner;
  const current = () => micRequest === request && state.media === media && state.ready && !state.controlLost;
  micBusy(true);
  try {
    if (micCheck) stopMicCheck();
    if (!mic.outputTrack || mic.stream?.getAudioTracks()[0]?.readyState !== 'live' || reconfigure) {
      const created = await mic.open(settings);
      try {
        if (!current()) return;
        await media.setLocalTrack('voice', created.track);
      }
      finally { await created.releasePrevious(); }
      if (!current()) return;
      await populateDevices();
      if (!current()) return;
      showMicProcessing(mic.stream?.getAudioTracks()[0]);
    }
    if(!media.allowed(media.selfSlot,'voice') || remembered && (micProfile() !== request.owner || media.moderated && !media.isHost)) {
      await releaseRoomMic();
      await media.setLocalTrack('voice',null);
      renderControls();return;
    }
    if (!reconfigure) state.micMuted = remembered ? false : !state.micMuted;
    mic.setMuted(state.micMuted);
    if (!reconfigure && !remembered && roomMic.read()) saveMicPreference(state.micMuted ? 'muted' : 'on');
    await sendPresence();
  } catch (error) {
    if (!current()) return;
    // Fail closed: neither an old nor a partially replaced mic may keep sending.
    state.micMuted = true;
    mic.setMuted(true);
    await mic.close();
    if (!current()) return;
    showMicProcessing(null);
    await media.setLocalTrack('voice', null).catch(() => {});
    if (!current()) return;
    await sendPresence();
    throw error;
  } finally {
    if (micRequest === request) {
      micRequest = null;micBusy(false);renderControls();
    }
  }
}

async function receivedTrack({ slot, role, track }) {
  const participant = state.peers.find(p => p.slot === slot);
  if (!participant || participant.id === state.session?.selfId) return;
  if (role === 'screen') {
    if (track) track.addEventListener('unmute', renderStage, { once: true });
    renderStage();
  } else {
    mixer.setSetting(participant.id, role, { active: role === 'voice' ? !participant.micMuted : audibleShare(participant) });
    mix.sync();
    await mixer.attach(participant.id, role, track).catch(errorToast);
  }
}

async function syncRemoteAudio() {
  const epoch = state.roomEpoch;
  const media = state.media;
  for (const p of state.peers) {
    if (p.id === state.session?.selfId) continue;
    for (const role of ['voice', 'system']) {
      if (epoch !== state.roomEpoch || media !== state.media || !state.peers.some(current => current.id === p.id && current.slot === p.slot)) return;
      mixer.setSetting(p.id, role, { active: role === 'voice' ? !p.micMuted : audibleShare(p) });
      await mixer.attach(p.id, role, media?.getTrack(p.slot, role)).catch(errorToast);
    }
  }
}

function drawMixerRow(row,participant,role) {
  const setting=mixer.getSetting(participant.id,role);
  const slider=row.querySelector('input'),mute=row.querySelector('button');
  slider.value=String(setting.volume);
  slider.setAttribute('aria-valuetext',setting.volume+'%');
  row.querySelector('output').textContent=setting.volume+'%';
  mute.textContent=setting.muted?tr('Вкл.'):tr('Выкл.');
  mute.setAttribute('aria-pressed',String(setting.muted));
  mute.setAttribute('aria-label',(setting.muted?tr('Включить'):tr('Отключить'))+' '+(role==='voice'?tr('голос'):tr('звук стрима'))+' · '+participant.name);
  mute.title=mute.getAttribute('aria-label');
  mute.classList.toggle('is-muted',setting.muted);row.classList.toggle('is-muted',setting.muted);
}
function refreshPeerMix(id) {
  const peer=state.peers.find(p=>p.id===id);
  if(!peer)return;
  for(const row of document.querySelectorAll('.mixer-row[data-mix-peer]')){
    if(row.dataset.mixPeer===id)drawMixerRow(row,peer,row.dataset.role);
  }
  portraits.refreshSound(peer);
  renderPlayerVolume();
}
function createMixerRow(participant,role) {
  const row=node('div','mixer-row');
  row.dataset.mixPeer=participant.id;row.dataset.role=role;
  const label=node('label','mixer-label',role==='voice'?tr('Голос'):tr('Стрим'));
  const slider=node('input','mixer-slider');
  slider.type='range';slider.min='0';slider.max=String(volumeLimit(role));slider.step='1';
  slider.id='menu-mix'+'-'+participant.slot+'-'+role;
  slider.dataset.role=role;label.htmlFor=slider.id;
  slider.setAttribute('aria-label',participant.name+': '+(role==='voice'?tr('громкость голоса'):tr('громкость трансляции')));
  const value=node('output','mixer-value');value.htmlFor=slider.id;
  const mute=node('button','mixer-mute');
  mute.type='button';mute.dataset.mute=role;
  slider.addEventListener('input',()=>mix.set(participant.id,role,{volume:Number(slider.value)},false));
  slider.addEventListener('change',()=>mix.set(participant.id,role,{volume:Number(slider.value)},true));
  mute.addEventListener('click',()=>mix.set(participant.id,role,{muted:!mixer.getSetting(participant.id,role).muted},true));
  row.append(label,slider,value,mute);drawMixerRow(row,participant,role);
  return row;
}

function createOwnMixerRow(role){
  const key=role==='voice'?'micGain':'streamGain',label=tr(role==='voice'?'Голос':'Стрим');
  const row=node('div','mixer-row own-row'),input=node('input','mixer-slider');
  input.type='range';input.min='0';input.max=String(volumeLimit(role));input.value=settings[key];input.id='own-'+role;
  const title=node('label','mixer-label',label);title.htmlFor=input.id;
  input.setAttribute('aria-label',tr('Для друзей · ')+label);
  input.setAttribute('aria-valuetext',input.value+'%');
  const output=node('output','mixer-value',input.value+'%');output.id=input.id+'Value';output.htmlFor=input.id;
  input.addEventListener('input',()=>setSendLevel(role,input.value));
  row.append(title,input,output);return row;
}

function renderParticipants(){
  $('participantsCount').textContent=state.peers.length+' / '+(state.session?.internet?3:8);
  portraits.sync();
}

function screenTrack(participant) {
  if (!participant) return null;
  return participant.id === state.session?.selfId
    ? state.screenStream?.getVideoTracks()[0] || null
    : state.media?.getTrack(participant.slot, 'screen') || null;
}

function renderPlayerVolume() {
  const participant=state.peers.find(p=>p.sharing && p.id===state.selectedPeerId);
  $('playerVolumeBox').hidden=!participant;
  $('broadcastStatus').hidden=!participant || !state.sharing || participant.id!==state.session?.selfId;
  if(!participant)return;
  const own=participant.id===state.session?.selfId;
  const setting=own?{volume:settings.streamGain,muted:false}:mixer.getSetting(participant.id,'system');
  $('playerVolumeLabel').textContent=own?tr('Звук для друзей'):tr('Громкость стрима');
  $('playerVolume').value=String(setting.volume);
  $('playerVolume').disabled=own?!state.withSound:setting.muted;
  $('playerVolumeValue').textContent=setting.muted?tr('Выкл.'):setting.volume+'%';
}

function audibleShare(p) {
  return p.sharing && (!settings.focusAudio || p.id === state.selectedPeerId);
}
function renderStage() {
  const shares = state.peers.filter(p => p.sharing);
  if (!shares.some(p => p.id === state.selectedPeerId)) state.selectedPeerId = shares.find(p => p.id !== state.session?.selfId)?.id || shares[0]?.id || null;
  const selected = shares.find(p => p.id === state.selectedPeerId);
  for (const p of state.peers) if (p.id !== state.session?.selfId && mixer.getSetting(p.id,'system').active !== audibleShare(p)) {
    mixer.setSetting(p.id,'system',{active:audibleShare(p)});
  }
  const remote = selected && selected.id !== state.session?.selfId ? selected.id : null;
  const buffer = state.media?.watch(remote);
  if (!remote || !buffer?.available || buffer.forwarding) mixer.releaseScreenMeter();
  $('watchBufferBox').hidden = !remote || !buffer?.available;
  $('watchBuffer').disabled = !!buffer?.forwarding;
  $('watchBuffer').value = String(buffer?.forwarding ? 0 : buffer?.requested || 0);
  const hint = buffer?.forwarding ? tr('При пересылке третьему участнику создатель смотрит в режиме «Авто».') : tr('Буфер только для экрана и его звука на вашем ПК. Голос остаётся в реальном времени.');
  $('watchBufferBox').title = hint;
  $('watchBufferNote').textContent = hint;
  $('watchBufferNote').hidden = !(buffer?.forwarding && buffer.requested);
  const track = screenTrack(selected);
  $('stageEmpty').hidden = Boolean(selected||state.session);
  const grid=$('voiceGrid'),filmstrip=$('roomFilmstrip'),stage=$('streamStage');
  const gridParent=selected?filmstrip:stage;
  if(grid.parentElement!==gridParent)gridParent.append(grid);
  grid.hidden=!state.session;filmstrip.hidden=!selected;
  stage.classList.toggle('voice-stage',!!state.session && !selected);
  $('stageTitle').closest('.stage-heading').hidden=!selected;
  $('lobbyTitle').textContent = state.session ? tr('Вы в комнате') : tr('Начать звонок');
  $('remoteVideo').hidden = !selected;
  const player=$('remoteVideo');
  attachVideo(player,track);
  if(frameTrack!==track || framePeer!==selected?.id){
    if(frameTicket)player.cancelVideoFrameCallback(frameTicket);
    firstFrameShown=false;frameTicket=0;frameTrack=track;framePeer=selected?.id;
    if(track)frameTicket=player.requestVideoFrameCallback(()=>{
      frameTicket=0;firstFrameShown=true;renderAvailability();
      portraits.preview(selected.id,player);
    });
  }
  const screenName=selected ? selected.id===state.session?.selfId ? tr('Ваш экран') : tr('Экран · ')+selected.name : '';
  $('stageTitle').textContent=screenName;
  $('stageTitle').title=[screenName,selected?.shareTitle].filter(Boolean).join(' — ');
  $('stageBadge').hidden=!!state.session&&!selected;
  $('stageBadge').textContent=tr('В эфире');
  $('stageName').textContent = selected ? `${selected.name}${selected.id === state.session?.selfId ? tr(' · локальный предпросмотр') : ''}` : tr('Трансляция ещё не началась');
  $('stageSubtitle').textContent = state.session
    ? tr('Включите микрофон для разговора или нажмите «Показать экран».')
    : tr('Создайте комнату и пригласите друзей или введите код приглашения.');
  $('fullscreenBtn').disabled = !track;
  if(!selected && document.fullscreenElement===$('streamStage')) document.exitFullscreen().catch(()=>{});
  $('studioBtn').hidden=!state.session;
  portraits.screens(shares,selected?.id);
  renderAvailability();
  renderPlayerVolume();
  $('stageName').parentElement.hidden = !selected && !state.sharing;
  renderStatistics();
}

function renderStudio() {
  if($('studioDock').hidden)return;
  const live=$('studioLive'), track=state.screenStream?.getVideoTracks()[0];
  live.hidden=!state.sharing||!track;
  if(live.hidden)return;
  const capture=track.getSettings();
  $('studioCapture').textContent=videoFormat(capture.width,capture.height,capture.frameRate)||tr('Определяем…');
  $('studioSource').textContent=state.shareTitle;
  $('studioSound').textContent=state.withSound?(settings.streamGain===0?tr('Громкость 0%'):tr('Включён')):state.audioLost?tr('Недоступен'):tr('Выключен');
  const send=outgoingScreens(state.peers,state.session,state.stats,state.shareStarted);
  const target=$('studioSend'), key=JSON.stringify(send);
  if(target.dataset.stats===key)return;
  target.dataset.stats=key;
  if(!send.length){target.textContent=tr('Пока вы одни. Видно, что именно захватывается.');return;}
  const rows=send.map(row=>{
    const group=node('div','send-row');
    group.append(node('span','',tr('Отправка · ')+row.name),node('strong','',row.value));
    if(row.encoder)group.append(node('small','',tr('Кодировщик · ')+row.encoder));
    return group;
  });
  target.replaceChildren(...rows);
}
function roomRelease(){
  const shelf=state.media?.files,code=$('releaseCode').value.trim();
  if(!code)return {};
  const {name,sha,error}=parseUpdateCode(code,state.environment?.version);
  if(error||!shelf)return {error};
  const entry=[...shelf.entries.values(),...[...shelf.downloads.values()].map(d=>d.v)].find(v=>v.name===name&&v.sha===sha&&!shelf.local.has(v.id));
  return {shelf,entry,download:entry&&shelf.downloads.get(entry.id)};
}
function renderRelease(){
  const {entry,download,error}=roomRelease(),button=$('downloadRelease');
  button.hidden=!entry;button.disabled=!!download&&!download.final&&!download.paused;
  button.textContent=tr(download?.final?'Установить':download?.paused?'Продолжить в файлах комнаты':'Скачать обновление');
  $('chooseRelease').disabled=!!error||!$('releaseCode').value.trim();
  $('releaseStatus').textContent=error?tr(error):download?.final?tr('Загрузка завершена.'):download&&!download.paused?Math.floor(download.pos/entry.size*100)+'%':!entry&&$('releaseCode').value.trim()?tr('Подходящий установщик пока недоступен в комнате.'):'';
}
function stageFormat(value) {
  $('stageStats').textContent=value;
  $('playerFormat').textContent=value;
}
function renderStatistics() {
  renderStudio();
  if ($('networkDialog').open && !$('helpNetwork').hidden && $('technicalReport').open && state.environment) $('mediaDiagnostics').textContent = voiceRoomReport();
  if (!state.session) { stageFormat('—'); $('diagnosticsText').textContent = ''; return; }
  const stats = [...state.stats.values()];
  const outgoing = stats.reduce((n, s) => n + s.outgoingMbps, 0);
  const incoming = stats.reduce((n, s) => n + s.incomingMbps, 0);
  const rtts = stats.map(s => s.rttMs).filter(n => n !== null);
  $('diagnosticsText').textContent = stats.length ? `↑ ${outgoing.toFixed(1)} · ↓ ${incoming.toFixed(1)}${tr(" Мбит/с")}${rtts.length ? ` · ${Math.max(...rtts)}${tr(" мс")}` : ''}` : '';
  const participant = state.peers.find(p => p.id === state.selectedPeerId);
  if (!participant) { stageFormat('—'); return; }
  if (participant.id === state.session.selfId) {
    const s = screenTrack(participant)?.getSettings() || {};
    stageFormat(s.width ? videoFormat(s.width,s.height,s.frameRate)+tr(' · захват') : tr('Подготовка…'));
  } else {
    const endpoint=state.stats.get(state.session.role==='host'?participant.id:state.session.hostId);
    const video=endpoint?.state==='connected' && endpoint.videos.find(v=>String(v.mid)===String(participant.slot*3+1));
    stageFormat(video?.width?videoFormat(video.width,video.height,video.fps)+tr(' · приём'):tr('Ожидание кадров…'));
  }
}

function renderConnection() {
  const connected = state.session !== null;
  const states = [...state.connectionStates.values()];
  const hasFailure = states.some(s => ['failed', 'unreachable'].includes(s));
  const needed=state.session?.role==='host'?state.peers.length-1:1;
  const allConnected=state.peers.length>1 && states.length===needed && states.every(s=>s==='connected');
  renderAvailability();
  $('statusText').textContent = !connected ? tr('Не в комнате') : state.controlLost ? tr('Восстанавливаем связь…') : state.session.internet && (hasFailure || states.includes('disconnected') || (!allConnected && internet.account.status==='reconnecting')) ? tr('Восстанавливаем связь…') : hasFailure ? tr('Проверьте UDP') : allConnected ? tr('На связи') : state.peers.length === 1 ? tr('Ждём друзей') : tr('Соединение…');
  $('statusBadge').title = $('statusText').textContent;
  $('statusBadge').classList.toggle('connected', allConnected);
  $('statusBadge').classList.toggle('warning', hasFailure);
  $('roomLabel').textContent = !connected ? tr('Комната') : state.session.groupVoice ? state.session.groupChannelName||tr('Голосовой канал') : state.session.role === 'host' ? tr('Ваша комната') : `${tr("Комната · ")}${state.peers.find(p => p.slot === 0)?.name || tr('друг')}`;
  $('connectionHint').textContent = !connected ? tr('Для прямого соединения выберите «Создать комнату → Создать комнату по IP».')
    : state.session.internet && allConnected && internet.account.status==='reconnecting' ? tr('Звонок продолжается. Восстанавливаем доступ к списку друзей.')
    : state.session.internet ? (hasFailure ? tr('Медиасвязь прервана. Проверяем доступный маршрут.') : tr('Звонок друзьям · ')+([...state.stats.values()].some(s=>s.candidateType==='relay')?tr('через ретранслятор'):allConnected?tr('прямое соединение'):tr('установка связи')))
    : state.session.groupVoice ? (hasFailure ? tr('Медиасвязь прервана. Проверяем доступный маршрут.') : state.session.groupChannelName)
    : hasFailure ? tr('Чат подключён, медиа — нет. Откройте справку и проверьте UDP-порты создателя.')
      : state.peers.length > 3 ? tr('4–8 участников: экспериментальный режим. Снизьте качество и количество одновременных стримов.')
        : state.session.role === 'host' ? tr('Вы — сервер. Не закрывайте приложение во время встречи. Приглашение действует только для этой комнаты.')
          : tr('Медиа передаётся через компьютер создателя комнаты.');
}

function renderAvailability(){
  const session=state.session, internetRoom=Boolean(session?.internet), networkHelp=internetRoom||!!session?.usePeerIce;
  const routes=state.media?.textRoutes() || [], online=routes.filter(Boolean).length;
  const ready=!!session && !state.controlLost && state.peers.length > 1 && (!internetRoom || online>0);
  roomChat.setEnabled(ready);
  composer.roomRecord(ready && !!state.media?.files);
  $('chatEmoji').hidden=!ready;$('chatAttach').hidden=!session||!state.media?.files;
  $('chatStatus').textContent=!ready?(state.peers.length===1?tr('Ждём участника'):tr('Подключение…')):
    online && online<routes.length?tr('Доступен не всем'):routes.includes('backup')?tr('Через сервис · зашифровано'):tr('На связи');
  $('chatStatus').classList.toggle('waiting',!ready && state.peers.length>1);
  const active=state.peers.filter(p=>p.id!==session?.selfId);
  const selected=state.peers.find(p=>p.id===state.selectedPeerId && p.sharing);
  const needed=selected && selected.id!==session?.selfId?[session.role==='host'?selected.id:session.hostId]:
    session?.role==='host'?active.map(p=>p.id):[session?.hostId];
  const states=needed.map(id=>state.connectionStates.get(id));
  const samples=needed.map(id=>state.stats.get(id)).filter(Boolean);
  const {stalled,hostOnly,offerStun}=routeProblem(networkHelp?samples:[],settings);
  const good=states.some(s=>s==='connected'),failed=states.some(s=>['unreachable','disconnected','failed'].includes(s));
  const mine=selected && selected.id===session?.selfId;
  const waitingFrames=selected && !mine && (!screenTrack(selected) || !firstFrameShown);
  const visible=!!session && !!active.length && ((!mine && (!good || waitingFrames)) || (mine && !good && (failed || stalled)));
  const el=$('mediaNotice');el.hidden=!visible;el.classList.toggle('over-preview',!!mine);
  $('stageStun').hidden=!offerStun;
  if(visible){
    $('mediaTitle').textContent=hostOnly?tr('Прямой маршрут не найден'):stalled?tr('Голос и экран пока недоступны'):failed?tr('Медиасвязь прервана'):good?tr('Ждём первый кадр'):tr('Подключаем голос и экран');
    $('mediaHint').textContent=offerStun?tr('Cloudflare может определить ваш внешний IP. Голос и видео через STUN не проходят.'):
      stalled?(ready?tr('Чат работает. '):'')+(mine?tr('Друг пока не получает ваш экран. '):'')+(hostOnly?tr('У обоих участников найдены только локальные адреса.'):tr('Продолжаем искать маршрут между участниками.')):
      failed?(ready?tr('Чат доступен. Можно переписываться, пока восстанавливается связь.'):tr('Проверяем маршрут между участниками.')):
      good?tr('Изображение появится после получения видео.'):tr('Участники уже в комнате. Устанавливаем соединение.');
    el.classList.toggle('waiting',!failed && !stalled);$('routeHelp').hidden=!networkHelp || offerStun || (!failed && !stalled);
  }
  if((internetRoom||session?.direct) && mine){
    const ownSlot=state.peers.find(p=>p.id===session.selfId)?.slot;
    const transmitting=[...state.stats.values()].some(sample=>sample.state==='connected' && sample.video?.some(v=>v.direction==='out' && Number(v.mid)===ownSlot*3+1 && v.mbps>0));
    $('stageName').textContent=transmitting?tr('Локальный предпросмотр · идёт отправка видео'):!active.length?tr('Локальный предпросмотр · ждём участников'):!good?tr('Локальный предпросмотр · ждём медиасвязь'):tr('Локальный предпросмотр · ждём отправку видео');
  }
  if(session && !selected && active.length && good){
    $('lobbyTitle').textContent=tr('На связи');$('stageSubtitle').textContent=tr('Никто пока не показывает экран.');
  }
  $('routeActions').hidden=$('customRelay').hidden=!networkHelp;
  $('vpnHelp').hidden=!networkHelp || !(stalled || failed);
  if(networkHelp){
    const types=[...state.stats.values()].flatMap(s=>s.servers || []),configured=types.length?types:(session.iceServers || []).map(s=>s.urls.split(':')[0]);
    const turn=configured.some(t=>t==='turn'||t==='turns');
    const external=samples.some(s=>s.localTypes?.includes('srflx'));
    const detail=configured.includes('stun')?(external?tr('Внешний адрес получен. '):tr('STUN настроен. Внешний адрес пока не виден в статистике. ')):'';
    $('routeSummary').textContent=detail+(turn?tr('TURN настроен. Выбранный маршрут показан в отчёте ниже.'):tr('TURN не получен. Если прямое соединение недоступно, голосу и экрану нужен доступный ретранслятор или общая виртуальная сеть.'));
    $('showLinkExecutable').hidden=state.environment?.platform!=='win32';
    $('useStun').hidden=$('stunHint').hidden=!!settings.proxyOnly || !!settings.publicStun || configured.includes('stun');
  }
}
let firstFrameShown=false, frameTicket=0,frameTrack,framePeer;
let trayState;
let audienceSignature='';
function saveAudience(){
  const mode=$('audienceMode').value,ids=[...$('audiencePeople').querySelectorAll('input:checked')].map(x=>x.value);
  return api.direct({op:'audience',mode,ids}).then(()=>direct.sync()).then(()=>{audienceSignature='';drawAudience();}).catch(errorToast);
}
function drawAudience(){
  const raw=direct?.raw(),policy=raw?.audience;if(!policy)return;
  const friends=raw.friends.filter(p=>p.state==='friend'),sig=JSON.stringify([policy,friends.map(p=>[p.id,p.name])]);
  if(audienceSignature===sig)return;audienceSignature=sig;
  $('audienceMode').value=policy.mode;$('audiencePeople').hidden=policy.mode!=='selected';
  $('audiencePeople').replaceChildren(...friends.map(p=>{const label=node('label',''),box=node('input','');box.type='checkbox';box.value=p.id;box.checked=policy.ids.includes(p.id);box.onchange=saveAudience;label.append(box,document.createTextNode(p.name));return label;}));
  const admitted=friends.filter(p=>policy.admitted?.includes(p.id));
  $('returnAccess').hidden=!admitted.length;
  $('returnMembers').replaceChildren(...admitted.map(p=>{
    const row=node('div','file-row'),name=node('strong','',p.name),revoke=node('button','button button-secondary',tr('Отозвать возврат'));
    revoke.type='button';revoke.setAttribute('aria-label',revoke.textContent+' · '+p.name);
    revoke.onclick=async()=>{
      try{await api.direct({op:'revoke-room-return',scope:policy.scope,person:p.id});await direct.sync();}
      catch(error){errorToast(error);}
    };
    row.append(name,revoke);return row;
  }));
}
function renderControls() {
  const connected = Boolean(state.session);
  const next = [connected,state.sharing,settings.systemNotices,settings.dnd].join('/');
  if (trayState !== next) {
    trayState = next;
    api?.setTrayState?.({connected,sharing:state.sharing,systemNotices:settings.systemNotices,dnd:settings.dnd}).catch(()=>{trayState=undefined;});
  }
  workspace?.schedule();
  if (!connected) chatPreference=null;
  drawChatPanel();
  if(direct&&internet)refreshIdentity?.();
  $('lobbyActions').hidden=connected;
  $('roomMeta').hidden=!connected;
  renderGraphics();
  $('callControls').hidden=!connected; $('localMicMeter').hidden=!connected; $('leaveBtn').hidden=!connected;
  $('broadcastStatus').hidden=!state.sharing || state.selectedPeerId!==state.session?.selfId;
  $('broadcastStatus').dataset.audio=state.withSound?'on':'off';
  $('broadcastStatus').textContent=state.withSound?(settings.streamGain===0?tr('Ваш показ · громкость 0%'):tr('Ваш показ · со звуком')):state.audioLost?tr('Ваш показ · звук недоступен'):tr('Ваш показ · без звука');
  $('createBtn').hidden = connected;
  $('joinBtn').hidden = connected;
  $('copyInviteBtn').hidden = !state.session || !!state.session.groupVoice || (!state.session.internet && state.session.role!=='host');
  $('copyInviteBtn').disabled=Boolean(state.session?.internet && state.peers.length>=3);
  for (const id of ['deafenBtn', 'shareBtn', 'leaveBtn']) $(id).disabled = !connected;
  const media=state.media;
  $('roomOptionsBtn').hidden=!media?.isHost||!!state.session?.groupVoice;
  if($('roomOptionsBtn').hidden && $('hostAccess').matches(':popover-open'))$('hostAccess').hidePopover();
  $('linkAccess').hidden=!media?.isHost||!state.session?.direct;
  $('roomModerated').checked=!!media?.moderated;
  if(!$('linkAccess').hidden)drawAudience();
  $('micBtn').disabled = !state.ready || !media || state.controlLost || state.micBusy || !media.allowed(media.selfSlot,'voice');
  const me=self();if(me)portraits.refreshSound(me);
  $('shareBtn').disabled = !connected || state.controlLost || state.captureBusy || !!media&&!media.allowed(media.selfSlot,'screen');
  if(state.controlLost){$('chatInput').disabled=true;$('sendChatBtn').disabled=true;}
  $('micBtn').classList.toggle('is-muted', state.micMuted);
  $('micBtn').setAttribute('aria-pressed', String(!state.micMuted));
  $('micLabel').textContent = state.micMuted ? tr('Включить микрофон') : tr('Микрофон включён');
  $('micBtn').setAttribute('aria-label', state.micMuted ? tr('Включить микрофон') : tr('Выключить микрофон'));
  $('deafenBtn').classList.toggle('is-muted', state.deafened);
  $('deafenBtn').setAttribute('aria-pressed', String(state.deafened));
  $('deafenBtn').title = state.deafened ? tr('Включить входящий звук') : tr('Отключить весь входящий звук');
  $('deafenBtn').setAttribute('aria-label', $('deafenBtn').title);
  $('shareLabel').textContent = state.sharing ? tr('Сменить источник') : tr('Показать экран');
  $('stopShareBtn').hidden = !state.sharing;
}

function renderAll() { internet?.render(); direct?.render(); renderControls(); renderConnection(); renderParticipants(); renderStage(); }

function appendChat(message) {
  roomChat.append({author:message.name,text:message.text,time:message.time,own:message.from===state.session?.selfId});
}

async function openSources() {
  if(state.media&&!state.media.allowed(state.media.selfSlot,'screen'))return;
  if (!state.session || state.captureBusy) return;
  const env = state.environment;
  $('withSystemAudio').disabled = !env?.systemAudioSupported;
  state.sourceChoice=null;
  $('withSystemAudio').checked=Boolean(env?.systemAudioSupported && (!state.sharing || state.withSound));
  $('captureSoundHint').textContent=env?.systemAudioSupported
    ? tr('Игры, музыка и другие приложения. Голоса из звонка исключаются.')
    : tr('На этой системе доступен показ без звука компьютера. Микрофон работает отдельно.');
  renderChoice();
  showDialog('sourceDialog');
  await refreshSources();
}

async function refreshSources() {
  const epoch = state.roomEpoch, request=++state.sourceListRequest;
  const stale=()=>epoch!==state.roomEpoch || request!==state.sourceListRequest || !$('sourceDialog').open;
  state.sources=[];
  state.sourceChoice=null;renderChoice();
  const windows = state.sourceType === 'window';
  for (const [id, active] of [['screenTabBtn', !windows], ['windowTabBtn', windows]]) {
    $(id).classList.toggle('active', active);
    $(id).setAttribute('aria-pressed', String(active));
  }
  $('sourcesGrid').setAttribute('aria-busy','true');
  $('sourcesGrid').replaceChildren(node('p', 'field-help', windows ? tr('Ищем открытые окна…') : tr('Ищем экраны…')));
  $('refreshSourcesBtn').disabled = true;
  try {
    const sources = await api.sources(state.sourceType);
    if(stale())return;
    state.sources = sources;
    renderSources();
  } catch (error) {
    if(stale())return;
    $('sourcesGrid').replaceChildren(node('p', 'error-text', tr('Не удалось получить список. Проверьте разрешение на запись экрана и нажмите «Обновить».')));
    throw error;
  } finally { if(!stale()) { $('refreshSourcesBtn').disabled=false; $('sourcesGrid').setAttribute('aria-busy','false'); } }
}

function renderSources() {
  if(state.sourceChoice?.type!==state.sourceType)state.sourceChoice=null;
  renderChoice();
  const entries = state.sources.filter(s => s.type === state.sourceType);
  $('sourcesGrid').replaceChildren();
  if (!entries.length) {
    $('sourcesGrid').append(node('p', 'field-help', state.sourceType === 'window' ? tr('Окна не найдены. Разверните нужное окно браузера или игры, затем нажмите «Обновить».') : tr('Экраны не найдены. Проверьте разрешения системы.')));
  }
  for (const source of entries) {
    const button = node('button', 'source-card');
    button.type = 'button';
    button.title = source.name;
    if (source.thumbnail) {
      const image = node('img', 'source-thumbnail');
      image.src = source.thumbnail;
      image.alt = '';
      button.append(image);
    } else {
      const placeholder=node('div','source-thumbnail source-placeholder',tr('Нет предпросмотра'));
      placeholder.setAttribute('aria-hidden','true');
      button.append(placeholder);
    }
    button.append(node('span', 'source-name', source.name));
    button.dataset.sourceId=source.id;
    button.setAttribute('aria-pressed', String(state.sourceChoice?.id===source.id));
    button.addEventListener('click', () => {state.sourceChoice=source;renderChoice();});
    $('sourcesGrid').append(button);
  }
}

function renderChoice() {
  $('startShare').textContent=state.captureBusy?tr('Начинаем показ…'):state.sharing?tr('Сменить источник'):tr('Начать показ');
  for(const id of ['closeSourceDialog','screenTabBtn','windowTabBtn'])$(id).disabled=state.captureBusy;
  $('withSystemAudio').disabled=state.captureBusy || !state.environment?.systemAudioSupported;
  $('startShare').disabled=state.captureBusy || !state.sourceChoice;
  $('sourceSelection').textContent=state.sourceChoice?.name || tr('Выберите экран или окно');
  for(const button of $('sourcesGrid').querySelectorAll('.source-card'))
    button.setAttribute('aria-pressed',String(button.dataset.sourceId===state.sourceChoice?.id));
}
function releaseCaptureSound() {
  state.captureAbort?.abort();state.captureAbort=null;
  state.protectedSound?.close();state.protectedSound=null;
  state.withSound=false;state.audioLost=false;
}
async function startCapture(source) {
  if(state.media&&!state.media.allowed(state.media.selfSlot,'screen'))return;
  if (!source || !state.session || state.captureBusy) return;
  const epoch = state.roomEpoch;
  const audioRequested=$('withSystemAudio').checked && state.environment.systemAudioSupported;
  const captureEpoch = ++state.captureEpoch;
  state.captureBusy = true; $('refreshSourcesBtn').disabled=true;
  for (const button of $('sourcesGrid').querySelectorAll('button')) button.disabled = true;
  renderControls();
  renderChoice();
  const controller=new AbortController();
  state.captureAbort=controller;
  let stream, sound, committed=false;
  try {
    const {token}=await api.selectSource({id:source.id, withAudio:audioRequested});
    const q = quality();
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: q.width, max: q.width }, height: { ideal: q.height, max: q.height }, frameRate: { ideal: q.fps, max: q.fps } },
      audio:false, systemAudio:'exclude', selfBrowserSurface:'exclude',
    });
    if (epoch !== state.roomEpoch || captureEpoch !== state.captureEpoch || !state.media) { stream.getTracks().forEach(t => t.stop()); return; }
    state.pendingScreenStream = stream;
    const video = stream.getVideoTracks()[0];
    if (!video || video.readyState !== 'live') throw new Error(tr('Выбранное окно не отдаёт изображение. Попробуйте оконный режим игры или захват экрана.'));
    captureFormats.set(video,captureFormat(q));
    video.contentHint = q.content;
    removeDisplayAudio(stream);
    // Tear down the preceding audio before a new source can reach a sender.
    state.protectedSound?.close();state.protectedSound=null;state.withSound=false;
    if(audioRequested) {
      try {
        sound=await openProtectedAudio(api,token,controller.signal,()=>{
          if(state.screenStream!==stream || epoch!==state.roomEpoch)return;
          state.protectedSound=null;state.withSound=false;state.audioLost=true;renderControls();renderPlayerVolume();
          state.media?.setLocalTrack('system',null).catch(errorToast);
          errorToast(tr('Звук компьютера прервался. Показ продолжается без звука.'));
        },settings.streamGain);
      } catch { /* Video remains available when the protected capture cannot be opened. */ }
    }
    const system=sound?.track.readyState==='live' ? sound.track : null;
    if(controller.signal.aborted || captureEpoch!==state.captureEpoch){stream.getTracks().forEach(t=>t.stop());return;}
    const previous = state.screenStream;
    const media = state.media;
    await media.setLocalTrack('screen', video);
    if (epoch !== state.roomEpoch || captureEpoch !== state.captureEpoch) { stream.getTracks().forEach(t => t.stop()); return; }
    await media.setLocalTrack('system', system);
    if (epoch !== state.roomEpoch || captureEpoch !== state.captureEpoch || !state.session) {
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    state.pendingScreenStream = null;
    state.screenStream = stream;
    state.protectedSound=sound;sound?.setGain(settings.streamGain);committed=true;state.withSound=system?.readyState==='live';state.audioLost=audioRequested && !state.withSound;
    internet?.hush();
    state.sharing = true;
    state.shareTitle = source.name.slice(0, 160);
    state.shareStarted=Date.now();
    state.selectedPeerId=state.session.selfId;
    video.addEventListener('ended', () => { if (state.screenStream === stream) stopCapture().catch(errorToast); });
    previous?.getTracks().forEach(t => t.stop());
    await media.setQuality(q);
    if (captureEpoch !== state.captureEpoch) return;
    await sendPresence();
    if (captureEpoch !== state.captureEpoch) return;
    closeDialog('sourceDialog');
    renderStage();
    if (!state.withSound && audioRequested) {
      toast(tr('Windows не открыла защищённый звук. Показ идёт без звука компьютера. Микрофон работает отдельно.'), true);
    } else toast(state.withSound ? tr('Трансляция со звуком началась.') : tr('Трансляция началась. Системный звук выключен.'));
  } catch (error) {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      if (epoch === state.roomEpoch && captureEpoch === state.captureEpoch) {
        // Replacement may have reached only some senders. Stop both generations.
        state.screenStream?.getTracks().forEach(t => t.stop());
        releaseCaptureSound();state.screenStream = null; state.sharing = false; state.shareTitle = '';
        await Promise.allSettled([state.media?.setLocalTrack('screen', null), state.media?.setLocalTrack('system', null)]);
        await sendPresence();
        renderStage();
      }
    }
    if (error.name === 'NotAllowedError') throw new Error(tr('Захват не разрешён или отменён. Выберите источник снова и разрешите запись экрана.'));
    throw error;
  } finally {
    if(!committed)sound?.close();
    if(state.captureAbort===controller)state.captureAbort=null;
    if (state.pendingScreenStream === stream) state.pendingScreenStream = null;
    if (epoch === state.roomEpoch) {
      state.captureBusy = false;$('refreshSourcesBtn').disabled=false;renderChoice();
      for (const button of $('sourcesGrid').querySelectorAll('button')) button.disabled = false;
      renderControls();
    }
  }
}

async function stopCapture() {
  state.captureEpoch++;
  releaseCaptureSound();
  state.pendingScreenStream?.getTracks().forEach(track => track.stop());
  state.pendingScreenStream = null;
  const previous = state.screenStream;
  state.screenStream = null;
  state.sharing = false;
  state.shareTitle = '';
  const media = state.media;
  previous?.getTracks().forEach(t => t.stop());
  const results = await Promise.allSettled([media?.setLocalTrack('screen', null), media?.setLocalTrack('system', null)]);
  if (media !== state.media) return;
  await sendPresence();
  renderControls(); renderStage();
  const failure = results.find(r => r.status === 'rejected');
  if (failure) throw failure.reason;
}

async function populateDevices() {
  let devices;
  try { devices = await navigator.mediaDevices.enumerateDevices(); } catch { return; }
  for (const [id, kind, saved] of [['micDevice', 'audioinput', settings.micDevice], ['outputDevice', 'audiooutput', settings.outputDevice]]) {
    const select = $(id);
    select.replaceChildren();
    const option = node('option', '', tr('По умолчанию')); option.value = ''; select.append(option);
    for (const [index, device] of devices.filter(d => d.kind === kind && d.deviceId && d.deviceId !== 'default').entries()) {
      const entry = node('option', '', device.label || `${kind === 'audioinput' ? tr('Микрофон') : tr('Устройство вывода')} ${index + 1}`);
      entry.value = device.deviceId; select.append(entry);
    }
    if (saved && ![...select.options].some(o => o.value === saved)) {
      const missing = node('option', '', tr('Ранее выбранное устройство недоступно')); missing.value = saved; select.append(missing);
    }
    select.value = saved;
  }
}

let micCheck;
const previewHint = tr('Скажите несколько слов. Через 4 секунды вы услышите запись в выбранных наушниках или колонках.');
function previewStatus(phase, button, hint) {
  $('testMic').dataset.phase = phase;
  $('testMic').textContent = button;
  $('testHint').textContent = hint;
}
const previewSeconds=4;
function showPreviewTime(check,phase) {
  clearInterval(check.clock);
  const started=performance.now();
  $('testProgress').hidden=false;
  const update=()=>{
    if(micCheck!==check)return;
    const recording=phase==='recording';
    const elapsed=Math.min(previewSeconds,recording?(performance.now()-started)/1000:check.player.currentTime || 0);
    const remaining=Math.ceil(previewSeconds-elapsed);
    const text=(recording?tr('Запись'):tr('Прослушивание'))+' · '+remaining+tr(' с');
    if($('testClock').textContent!==text)$('testClock').textContent=text;
    $('testTimeline').value=elapsed;
  };
  update();check.clock=setInterval(update,100);
}
function stopMicCheck(message = previewHint) {
  const check = micCheck;
  micCheck = null;
  if (check) {
    clearTimeout(check.timer);clearInterval(check.clock);
    if (check.recorder?.state === 'recording') check.recorder.stop();
    releaseTestInput(check);
    if (check.player) {
      check.player.onended = check.player.onerror = null;
      check.player.pause();
      check.unroute?.();
      check.player.removeAttribute('src');
      check.player.load();
    }
    if (check.url) URL.revokeObjectURL(check.url);
    mic.setPreviewPlaying(false, check.player ? 0.20 : 0);
  }
  $('testProgress').hidden=true; $('testTimeline').value=0; $('testClock').textContent='';
  $('testLevel').style.width = '0%';
  $('testLevel').parentElement.setAttribute('aria-valuenow', '0');
  previewStatus('idle', tr('Проверить'), message);
}

function releaseTestInput(check) {
  if (check.tap) { check.tap.close(); check.tap = null; }
  return check.input?.close().catch(errorToast);
}

function updateTestLevel(check, measurement) {
  if (!measurement || micCheck !== check) return;
  const {level, rms, peak, reduction} = measurement;
  const value = Math.round(100 * level);
  $('testLevel').style.width = value + '%';
  $('testLevel').parentElement.setAttribute('aria-valuenow', String(value));
  check.levels.push(rms);
  if (peak >= 0.34 || reduction < -4) check.limited++;
}

function micCheckResult(check) {
  if (!check.levels.length) return tr('Запись почти без звука. Проверьте устройство ввода и громкость микрофона.');
  const sorted = check.levels.sort((a,b) => a - b);
  // The loudest quarter of short windows makes pauses between words less influential.
  const rms = sorted[Math.floor(sorted.length * 0.75)];
  if (rms < 0.001) return tr('Запись почти без звука. Проверьте устройство ввода и громкость микрофона.');
  const db = Math.round(20 * Math.log10(rms));
  const advice = check.limited >= 3 ? tr('Громкие звуки ограничены. Можно убавить усиление.') :
    db < -32 ? tr('Тихая запись. Подвиньте микрофон ближе или увеличьте громкость голоса.') : tr('Уровень записи достаточный.');
  return advice + ' (' + db + ' dBFS)';
}

async function playMicCheck(check, blob) {
  if (check !== micCheck) return;
  try {
    await releaseTestInput(check);
    if (check !== micCheck) return;
    if (!blob || !blob.size) {
      stopMicCheck(tr('Запись оказалась пустой. Запустите проверку ещё раз.'));
      return;
    }
    const player = check.player = new Audio();
    player.volume = settings.roomOutputVolume / 100;
    if (state.session) check.unroute = mixer.routeLocal(player);
    if (!check.unroute && settings.outputDevice) await player.setSinkId(settings.outputDevice);
    if (check !== micCheck) return;
    check.url = URL.createObjectURL(blob);
    player.src = check.url;
    player.onerror = () => { if (micCheck === check) stopMicCheck(tr('Не удалось воспроизвести запись. Проверьте устройство вывода.')); };
    player.onended = () => {
      if (micCheck === check) stopMicCheck(micCheckResult(check));
    };
    previewStatus('playing', tr('Остановить'), tr('Слушайте свой голос.') + (state.session ? tr(' На время воспроизведения микрофон в звонке на паузе.') : ''));
    check.timer = setTimeout(() => {
      if (micCheck === check) stopMicCheck(tr('Воспроизведение остановлено. Проверьте выбранное устройство вывода.'));
    }, 8000);
    await player.play();
    if(micCheck===check)showPreviewTime(check,'playing');
  } catch {
    if (micCheck === check) stopMicCheck(tr('Не удалось воспроизвести запись. Проверьте выбранные наушники или колонки.'));
  }
}

async function toggleMicCheck() {
  if (state.micBusy) return;
  if (micCheck) { stopMicCheck(); return; }
  const check = { levels: [], limited: 0 };
  micCheck = check;
  // The test phrase and speaker playback both remain private during an active call.
  mic.setPreviewPlaying(true);
  previewStatus('opening', tr('Отмена'), tr('Открываем выбранный микрофон…'));
  try {
    let track;
    if (mic.outputTrack && mic.stream?.getAudioTracks()[0]?.readyState === 'live') {
      check.tap = mic.previewTap();
      track = check.tap.track;
    } else {
      check.input = new Microphone({
        onLevel: (_, measurement) => updateTestLevel(check, measurement),
        onEnded() { if (micCheck === check) stopMicCheck(tr('Микрофон отключился. Выберите другое устройство.')); }
      });
      const opened = await check.input.open(settings);
      await opened.releasePrevious();
      if (micCheck !== check) return;
      check.input.setMuted(false);
      showMicProcessing(check.input.stream.getAudioTracks()[0]);
      track = opened.track;
    }
    const recorder = check.recorder = new MediaRecorder(new MediaStream([track]), {audioBitsPerSecond: 96000});
    let blob;
    recorder.ondataavailable = event => { if (micCheck === check) blob = event.data; };
    recorder.onerror = () => { if (micCheck === check) stopMicCheck(tr('Не удалось записать звук. Повторите проверку.')); };
    recorder.onstop = () => {clearInterval(check.clock);playMicCheck(check, blob);};
    recorder.start();
    previewStatus('recording', tr('Отмена'), tr('Говорите. Через 4 секунды вы услышите запись.') + (state.session ? tr(' Микрофон в звонке на паузе.') : ''));
    showPreviewTime(check,'recording');
    check.timer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, previewSeconds*1000);
    populateDevices().catch(() => {});
  } catch {
    if (micCheck === check) stopMicCheck(tr('Не удалось начать запись. Проверьте микрофон и разрешение на его использование.'));
  }
}
function setSendLevel(role, value) {
  const key=role==='voice'?'micGain':'streamGain';
  const volume=Math.min(volumeLimit(role),Math.max(0,Number(value)||0));
  settings[key]=volume;
  $(key).style.setProperty('--filled',100*volume/volumeLimit(role)+'%');
  if(role==='voice'){mic.setGain(volume);micCheck?.input?.setGain(volume);}
  else state.protectedSound?.setGain(volume);
  for(const id of [key,'own-'+role]){
    if($(id)){$(id).value=String(volume);$(id).setAttribute('aria-valuetext',volume+'%');$(id+'Value').textContent=volume+'%';}
  }
  if(role==='system'){renderPlayerVolume();renderControls();}
  saveSettings();
}
function settingsPane(pane) {
  if(pane!=='voice' && micCheck)stopMicCheck();
  for(const button of document.querySelectorAll('.pref-nav button')){
    const selected=button.dataset.pane===pane;
    button.setAttribute('aria-pressed',String(selected));
    $('pref-'+button.dataset.pane).hidden=!selected;
  }
  if(internet && pane==='profile'){
    internet.render();
    $('profileName').value=internet.name();
  }
  document.querySelector('.pref-content').scrollTop=0;
}
const settingsHome=document.createComment('settings position');
$('settingsDialog').before(settingsHome);
let graphicsState,graphicsPending=false,graphicsRequest=0;
function renderGraphics() {
  const g=graphicsState;if(!g)return;
  state.graphics=g;
  const changed=g.automatic!==g.applied, busy=!!state.session||state.starting;
  $('graphicsAuto').value=g.automatic?'gpu':'cpu';
  $('graphicsAuto').disabled=graphicsPending;
  const available=String(g.encode);
  const label=!g.applied?tr('Кодирование на CPU.'):available.startsWith('enabled')?tr('Аппаратный кодировщик доступен.'):
    /^(disabled|unavailable)/.test(available)?tr('Аппаратное кодирование недоступно. Используется CPU.'):tr('Доступность аппаратного кодировщика пока неизвестна.');
  $('graphicsState').textContent=tr('Сейчас: ')+label;
  $('graphicsNext').hidden=!changed;
  $('graphicsNext').textContent=busy?tr('Выбор сохранён. Он вступит в силу после завершения звонка и перезапуска приложения.'):tr('Выбор сохранён. Для применения перезапустите приложение.');
  $('graphicsRestart').hidden=!changed||busy;
}
async function refreshGraphics(){
  if(graphicsPending)return;
  const version=++graphicsRequest,g=await api.graphicsStatus();
  if(!graphicsPending&&version===graphicsRequest){graphicsState=g;renderGraphics();}
}
function restoreSettingsHome(){
  if($('studioDock').hidden)return;
  settingsHome.after($('settingsDialog'));
  $('studioDock').hidden=true;
  $('settingsTitle').textContent=tr('Настройки');$('studioLive').hidden=true;
  $('studioBtn').setAttribute('aria-expanded','false');
  drawChatPanel();
}
function closeStudio(){
  if($('studioDock').hidden)return;
  if($('settingsDialog').open)$('settingsDialog').close();
  restoreSettingsHome();
}
function openStudio(){
  if(!state.session)return;
  const d=$('settingsDialog');
  if(d.open)d.close();
  $('studioDock').append(d);$('studioDock').hidden=false;
  settingsPane('stream');fillSettings();
  $('studioBtn').setAttribute('aria-expanded','true');$('settingsTitle').textContent=tr('Настройки показа');
  drawChatPanel();
  if(state.sharing)state.selectedPeerId=state.session.selfId;
  d.show();$('closeSettingsDialog').focus({preventScroll:true});renderStage();refreshGraphics().catch(errorToast);
}
function fillSettings() {
  $('qualityFeedback').textContent=tr('Настройки применяются во время показа.');
  for(const key of ['micGain','streamGain','roomOutputVolume']){
    $(key).value=String(settings[key]);
    $(key).style.setProperty('--filled',100*settings[key]/Number($(key).max)+'%');
    $(key).setAttribute('aria-valuetext',settings[key]+'%');
    $(key+'Value').textContent=settings[key]+'%';
  }
  for (const id of ['echoCancellation', 'noiseSuppression', 'autoGainControl']) $(id).checked = settings[id];
  $('viewHeight').value = String(settings.viewHeight);
  $('focusAudio').checked = settings.focusAudio;
  $('qualitySelect').value = settings.quality;
  $('shareContent').value=quality().content;
  $('bitrateSelect').value = String(settings.bitrate);
}
async function openSettings(pane='voice') {
  if(pane==='stream'&&state.peers.some(p=>p.sharing)){openStudio();return;}
  closeStudio();settingsPane(pane);fillSettings();
  showDialog('settingsDialog');
  refreshGraphics().catch(errorToast);
  await populateDevices();
}

const captureFormats=new WeakMap();
const captureFormat=q=>[q.width,q.height,q.fps].join('/');
let qualityTail=Promise.resolve(),qualityRevision=0;
function applyQuality() {
  settings.quality=$('qualitySelect').value;
  settings.content=$('shareContent').value;
  settings.bitrate=Number($('bitrateSelect').value);
  saveSettings();
  const q=quality(), revision=++qualityRevision;
  const apply=async()=>{
    if(revision!==qualityRevision)return;
    const media=state.media,track=state.screenStream?.getVideoTracks()[0];
    let captureLimited=false;
    if(track){
      if(track.contentHint!==q.content)track.contentHint=q.content;
    }
    if(track && captureFormats.get(track)!==captureFormat(q)){
      try{await track.applyConstraints({width:{ideal:q.width,max:q.width},height:{ideal:q.height,max:q.height},frameRate:{ideal:q.fps,max:q.fps}});captureFormats.set(track,captureFormat(q));}
      catch{captureLimited=true;}
    }
    if(revision!==qualityRevision||media!==state.media)return;
    await media?.setQuality(q);
    if(revision!==qualityRevision)return;
    $('qualityFeedback').textContent=captureLimited?tr('Источник сохранил прежний формат захвата. Лимиты отправки обновлены.'):track?tr('Параметры показа обновлены.'):tr('Выбор сохранён для следующего показа.');
    renderStatistics();
  };
  const next=qualityTail.then(apply);qualityTail=next.catch(()=>{});return next;
}

function drawChatPanel(){
  const chat=$('roomSidebar'),toggle=$('togglePanelBtn');
  const visible=!!state.session && (chatPreference??!compactRoom);
  const shown=visible && $('studioDock').hidden;
  chat.hidden=!visible;toggle.hidden=!state.session;
  toggle.setAttribute('aria-expanded',String(shown));
  const label=tr(shown?'Закрыть чат комнаты':'Открыть чат комнаты');
  toggle.title=label;toggle.setAttribute('aria-label',label);
}
function setSidebar(visible){
  chatPreference=visible;
  drawChatPanel();
}

function bindUI() {
  $('watchBuffer').addEventListener('change', () => {
    if (!state.media || !state.selectedPeerId) return;
    state.media.watch(state.selectedPeerId, Number($('watchBuffer').value));
    renderStage();
  });
  $('viewHeight').addEventListener('change',()=>{
    settings.viewHeight=Number($('viewHeight').value); saveSettings(); state.media?.setViewHeight(settings.viewHeight);
  });
  $('focusAudio').addEventListener('change',()=>{
    settings.focusAudio=$('focusAudio').checked; saveSettings(); renderStage();
  });
  action('linkFriends',()=>{if(internet.account.status==='signed-out'){direct.open(direct.active()?'add':'home');return;}internet.openFriends(true);});
  action('bookNearby',()=>direct.open('near'));
  action('linkHost',async()=>{if(state.session){workspace.navigate('room');return;}if(internet.account.status!=='signed-out')return internet.hub.open('host');if(!direct.active())return direct.open('host');await api.direct({op:'host'});});
  action('startIP',()=>{closeDialog('internetDialog');internet.hub.open('guest');});
  action('createBtn', () => internet.hub.open('host'));
  action('joinBtn', () => internet.hub.open(internet.access.pending?'access':'guest'));
  action('createModeBtn', () => openRoomDialog('host'));
  action('joinModeBtn', () => openRoomDialog('guest'));
  action('roomSubmitBtn', connectRoom);
  $('roomDialog').addEventListener('cancel', e => { if (state.starting) e.preventDefault(); });
  $('roomDialog').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !state.starting) { e.preventDefault(); connectRoom().catch(errorToast); }
  });
  $('releaseCode').addEventListener('input',renderRelease);
  projectUpdates=updateControls($,api,errorToast);
  $('updatePanel').addEventListener('toggle',renderRelease);
  action('chooseRelease',()=>api.installRelease({code:$('releaseCode').value}));
  action('downloadRelease',async()=>{
    const {shelf,entry,download}=roomRelease();if(!entry)return;
    if(download?.final)return api.installRelease({code:$('releaseCode').value,token:download.token});
    if(download?.paused){
      closeDialog('networkDialog');$('navRoom').click();closeStudio();
      if(document.querySelector('.app-shell.cinema'))$('cinemaBtn').click();
      setSidebar(true);$('roomShelf').open=true;return;
    }
    await shelf.start(entry);renderRelease();
  });
  action('shelfOffer',()=>state.media?.files.offer());
  $('roomModerated').onchange=()=>state.media?.setRights($('roomModerated').checked).catch(errorToast);
  $('audienceMode').onchange=()=>saveAudience();
  action('micBtn', () => enableMicrophone());
  $('joinWithMic').onchange = () => {
    const checked = $('joinWithMic').checked;
    saveMicPreference(checked ? 'on' : null);
    if (!checked && micRequest?.remembered) {
      revokeRoomMic();renderControls();
    }
  };
  action('deafenBtn', async () => {
    if (!state.session) return;
    await mixer.start();
    state.deafened = !state.deafened; if(state.deafened)internet?.hush();
    mixer.setDeafened(state.deafened);
    renderControls();
    toast(state.deafened ? tr('Входящий звук выключен. Ваш микрофон управляется отдельно.') : tr('Входящий звук включён.'));
  });
  action('shareBtn', openSources);
  action('startShare',()=>startCapture(state.sourceChoice));
  $('sourceDialog').addEventListener('cancel',e=>{if(state.captureBusy)e.preventDefault();});
  action('stopShareBtn', stopCapture);
  action('settingsBtn', openSettings);
  const retryRoutes=()=>{
    if(!state.session?.internet && !state.session?.usePeerIce)return;
    if(state.session.internet && internet.account.status==='online')internet.account.probe();
    if(state.media)state.media.iceQuery=null;
    for(const ep of state.media?.endpoints.values() || []){state.media.routeChanged(ep);}
    toast(tr('Повторяем подключение голосовой связи и экрана.'));
  };
  $('relayForm').addEventListener('submit',e=>{
    e.preventDefault();
    try{internet.setRelay($('relayAddress').value,$('relayUser').value,$('relaySecret').value);$('relayForm').reset();
      $('relayFeedback').textContent=tr('TURN добавлен для этого сеанса. Проверяем маршрут.');$('clearRelay').hidden=false;retryRoutes();}
    catch(err){$('relayFeedback').textContent=err.message;}
  });
  action('clearRelay',()=>{internet.setRelay('');$('clearRelay').hidden=true;$('relayFeedback').textContent=tr('Дополнительный TURN отключён.');retryRoutes();});
  action('retryMedia',retryRoutes);
  action('showLinkExecutable',()=>api.internet({op:'show-executable'}));
  function help(network=false){
    const jabber=internet.account.status!=='signed-out' && !!internet.account.id;
    $('helpFriendText').textContent=tr(jabber?'Отправьте другу свой адрес Jabber или введите его адрес. Получатель может ответить в разделе «Заявки».':'Отправьте другу свою карточку LINK. Когда он вставит её и отправит заявку, вы сможете принять её в разделе «Заявки».');
    $('helpCopyCard').textContent=tr(jabber?'Скопировать адрес':'Скопировать мою карточку');
    $('helpAddCard').textContent=tr(jabber?'Ввести адрес друга':'Вставить карточку друга');
    $('helpTopics').hidden=network;$('helpNetwork').hidden=!network;$('technicalReport').open=false;
    $('networkTitle').textContent=network?tr('Диагностика связи'):tr('Справка LINK');
    showDialog('networkDialog');renderRelease();if(network)renderStatistics();
  }
  $('technicalReport').addEventListener('toggle',()=>{if($('technicalReport').open)renderStatistics();});
  action('helpHome',()=>help());action('helpConnectivity',()=>help(true));
  action('helpCopyCard',async()=>{if(direct.active()){await api.direct({op:'copy'});$('helpCardStatus').textContent=tr('Карточка скопирована. Отправьте её другу лично.');}else if(internet.account.id){await api.copyText(internet.account.id);$('helpCardStatus').textContent=tr('Адрес скопирован.');}else{closeDialog('networkDialog');direct.open('copy');}});
  action('helpAddCard',()=>{closeDialog('networkDialog');if(internet.account.id)internet.openFriends(true);else direct.open('add');});
  action('routeHelp',()=>help(true));
  const enableStun=()=>{settings.publicStun=true;$('publicStun').checked=true;saveSettings();renderAvailability();retryRoutes();};
  action('useStun',enableStun);action('stageStun',enableStun);
  $('publicStun').checked=!!settings.publicStun;
  $('publicStun').addEventListener('change',()=>{settings.publicStun=$('publicStun').checked;saveSettings();if(state.session?.internet||state.session?.usePeerIce)retryRoutes();});
  action('networkHelpBtn',()=>{$('helpCardStatus').textContent='';help();if(projectUpdates?.offered?.())$('updatePanel').open=true;});
  action('copyDiagnosticsBtn', async () => {
    await api.copyText(voiceRoomReport());
    toast(tr('Отчёт скопирован.'));
  });
  action('leaveBtn', async () => {
    if (state.session?.role === 'host' && !state.session.groupVoice && state.peers.length > 1 && !await confirmAction(tr('Завершить встречу?'), tr('Вы — создатель. При выходе комната закроется для всех участников.'), tr('Завершить'))) return;
    await disconnectRoom();
  });
  action('copyInviteBtn', () => {
    if (state.session?.internet) { internet.hub.open('invite'); return; }
    if(state.session?.direct && direct.active()){workspace.invite();return;}
    if (!state.session?.invite) return;
    $('inviteOutput').value = state.session.invite; showDialog('inviteDialog');
  });
  action('inviteCopyBtn', async () => { await api.copyText($('inviteOutput').value); toast(tr('Приглашение скопировано. Отправьте его другу лично.')); });
  action('inviteDoneBtn', () => closeDialog('inviteDialog'));
  $('sourceDialog').addEventListener('close', () => {
    if ($('sourceDialog').open) return;
    state.sourceListRequest++;
    state.sources = [];
    state.sourceChoice = null;
    $('sourcesGrid').replaceChildren();
  });
  action('closeSourceDialog',()=>{if(!state.captureBusy)closeDialog('sourceDialog');});
  for (const name of ['Room', 'Settings', 'Network']) action(`close${name}Dialog`, () => closeDialog(`${name.toLowerCase()}Dialog`));
  for (const [id, type] of [['screenTabBtn','screen'], ['windowTabBtn','window']]) {
    action(id, () => {
      if (state.sourceType === type) return;
      state.sourceType = type;
      return refreshSources();
    });
  }
  action('refreshSourcesBtn', refreshSources);
  for(const event of ['input','change'])$('playerVolume').addEventListener(event,()=>{
    const p=state.peers.find(peer=>peer.sharing && peer.id===state.selectedPeerId);
    if(!p)return;
    if(p.id===state.session.selfId)setSendLevel('system',$('playerVolume').value);
    else mix.set(p.id,'system',{volume:Number($('playerVolume').value)},event==='change');
  });
  action('studioBtn',()=>{if($('studioDock').hidden)openStudio();else closeStudio();});
  action('togglePanelBtn',()=>{
    if(!$('studioDock').hidden){closeStudio();setSidebar(true);}else setSidebar($('roomSidebar').hidden);
    if(compactRoom&&!$('roomSidebar').hidden)($('chatInput').disabled?$('closeRoomChat'):$('chatInput')).focus({preventScroll:true});
  });
  bindPlayerControls($('streamStage'),$('playerBar'),$('fullscreenBtn'),$('exitPlayer'),errorToast,{pin:$('pinPlayer'),pinned:settings.playerPinned,savePin:value=>{settings.playerPinned=value;saveSettings();}});
  $('graphicsDetails').addEventListener('toggle',()=>{if($('graphicsDetails').open)refreshGraphics().catch(errorToast);});
  $('graphicsAuto').addEventListener('change',async()=>{
    if(graphicsPending)return;
    const choice=$('graphicsAuto').value==='gpu';
    ++graphicsRequest;graphicsPending=true;$('graphicsAuto').disabled=true;
    try{graphicsState=await api.saveGraphics(choice);}catch(e){errorToast(e);}
    finally{graphicsPending=false;renderGraphics();$('graphicsAuto').disabled=false;}
  });
  action('graphicsRestart',()=>api.restartGraphics());
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&!document.fullscreenElement&&!$('studioDock').hidden&&!document.querySelector('dialog:modal')){
      closeStudio();$('studioBtn').focus();e.preventDefault();
    }
  });
  const closeChat=()=>{setSidebar(false);$('togglePanelBtn').focus({preventScroll:true});};
  $('closeRoomChat').onclick=closeChat;
  $('roomSidebar').addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!event.defaultPrevented && !event.target.closest('details[open]')){event.preventDefault();closeChat();}
  });
  new ResizeObserver(([entry])=>{
    const width=entry.contentRect.width;
    if(width>0){
      compactRoom=width<680;
      $('roomPage').classList.toggle('compact-room',compactRoom);
      drawChatPanel();
    }
  }).observe($('roomPage'));
  for(const [id,role] of [['micGain','voice'],['streamGain','system']]){
    $(id).addEventListener('input',()=>setSendLevel(role,$(id).value));
  }
  for(const button of document.querySelectorAll('.pref-nav button')){
    button.addEventListener('click',()=>button.dataset.pane==='stream'&&state.peers.some(p=>p.sharing)?openStudio():settingsPane(button.dataset.pane));
  }
  action('profileBtn',()=>openSettings('profile'));
  action('settingsLogin',()=>{closeDialog('settingsDialog');internet.picker(true);});
  action('openConnectionSettings',()=>openSettings('connection'));
  action('testMic',toggleMicCheck);
  $('roomOutputVolume').oninput=()=>{
    settings.roomOutputVolume=$('roomOutputVolume').valueAsNumber;
    $('roomOutputVolumeValue').textContent=settings.roomOutputVolume+'%';
    $('roomOutputVolume').style.setProperty('--filled',settings.roomOutputVolume+'%');
    $('roomOutputVolume').setAttribute('aria-valuetext',settings.roomOutputVolume+'%');
    mixer.setRoomVolume(settings.roomOutputVolume);
    if(micCheck?.player)micCheck.player.volume=settings.roomOutputVolume/100;
  };
  $('roomOutputVolume').onchange=()=>{
    saveSettings();api.flushLocalPreferences?.().catch(errorToast);
  };
  $('settingsDialog').addEventListener('close',()=>{
    if($('settingsDialog').open)return;
    stopMicCheck();
    if(!$('studioDock').hidden){restoreSettingsHome();if(state.session)$('studioBtn').focus({preventScroll:true});}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden && micCheck)stopMicCheck();});
  for (const id of ['echoCancellation', 'noiseSuppression', 'autoGainControl', 'micDevice']) $(id).addEventListener('change', () => {
    if(micCheck)stopMicCheck(tr('Настройки изменились. Запустите проверку ещё раз.'));
    showMicProcessing(null);
    settings[id] = id === 'micDevice' ? $(id).value : $(id).checked;
    saveSettings();
    if (mic.outputTrack) enableMicrophone(true).catch(errorToast);
  });
  $('outputDevice').addEventListener('change', async () => {
    if (micCheck) stopMicCheck(tr('Устройство вывода изменилось. Запустите проверку ещё раз.'));
    const old = settings.outputDevice;
    try {
      await mixer.setOutput($('outputDevice').value);
      settings.outputDevice = $('outputDevice').value;
      saveSettings();
    } catch (error) { $('outputDevice').value = old; errorToast(error); }
  });
  for (const id of ['qualitySelect', 'bitrateSelect','shareContent']) $(id).addEventListener('change', () => applyQuality().catch(errorToast));
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyM' && state.session) { e.preventDefault(); enableMicrophone().catch(errorToast); }
  });
  navigator.mediaDevices.addEventListener('devicechange', () => populateDevices().catch(() => {}));
}

async function init() {
  if (!api) {
    $('statusText').textContent = tr('Нужно настольное приложение');
    $('connectionHint').textContent = tr('Запустите CRAFTCODE-LINK.exe. Этот HTML не является самостоятельной браузерной версией.');
    $('createBtn').disabled = $('joinBtn').disabled = true;
    return;
  }
  localizeStatic(document);
  const refreshAppearance=bindProfileAppearance({$,api,direct:()=>direct,onError:errorToast});
  const welcome=bindProfileWelcome({$,storage:localStorage,openProfile:()=>openSettings('profile'),openGuide:()=>$('helpTutorial').click(),flush:()=>api.flushLocalPreferences?.().catch(errorToast)});
  bindUI();
  bindSettingsNavigation($);
  bindHelpCenter({$,showDialog,closeDialog});
  function changeLanguage(value){
    if(!['ru','en'].includes(value))return;
    localStorage.setItem('craftcode.language',value);
    api.setLanguage(value).then(()=>{
      $('displayLanguage').value=$('introLanguage').value=value;
      if(value===language){$('languageNote').hidden=true;return;}
      const active=state.session||state.starting||micCheck||direct?.raw().incoming||direct?.raw().outgoing||
        internet?.room.pending||internet?.room.joining||internet?.room.outgoing||internet?.access.pending||internet?.account.status!=='signed-out';
      if(active){$('languageNote').hidden=false;$('languageNote').textContent=tr('Язык изменится при следующем запуске. Текущий звонок и вход в аккаунт сохраняются.');return;}
      return api.applyLanguage();
    }).catch(errorToast);
  }
  for(const id of ['displayLanguage','introLanguage']){$(id).value=localStorage.getItem('craftcode.language')||language;$(id).onchange=()=>changeLanguage($(id).value);}

  const notices=requestNotices({$,quiet:()=>settings.dnd,
    ring:(source,person)=>api.internet({op:'ring',kind:'friend-'+source,id:person.id,name:person.name}).catch(()=>{}),
    clearBalloon:source=>api.internet({op:'clear-request-notice',source}).catch(()=>{}),
    answer:async({source,id},yes)=>{
      if(source==='direct'){
        await api.direct({op:'answer',id,yes});await direct.sync();
      }else{await internet.account.answer(id,yes);internet.render();}
    },onError:errorToast});
  const notifyRequests=notices.update;
  function contactMenu(label,buttons,details=[]){
    $('contactActionsTitle').textContent=label;$('contactChoices').replaceChildren(...details,...buttons);
    for(const button of buttons)button.addEventListener('click',()=>closeDialog('contactActions'),{once:true,capture:true});
    showDialog('contactActions');
  }
  action('closeContactActions',()=>closeDialog('contactActions'));
  function identityChanged(){
    if(!direct||!internet)return;
    if(state.session?.direct && state.session.role==='host')drawAudience();
    const local=direct.active(),account=internet.account,jabber=account.status!=='signed-out'&&!!account.id;
    const owner=micProfile();
    if (roomMic.pending && roomMic.pending.owner !== owner) roomMic.pending=null;
    if ((micRequest || mic.outputTrack) && captureOwner !== owner) revokeRoomMic();
    drawMicPreference();
    if(jabber&&settings.identityMode!=='jabber'){settings.identityMode='jabber';saveSettings();}
    const label=local?direct.name():jabber?internet.name():tr('Войти');
    workspace?.schedule();
    $('profileLabel').textContent=label;paintAvatar($('profileAvatar'),local||jabber?label:tr('Я'),local?direct.raw().me?.avatar:null);
    refreshAppearance();welcome(local?direct.raw().me:null);if(state.session)portraits.sync();
    $('profileBtn').title=local?tr('Профиль LINK · ')+label:jabber?'Jabber · '+account.id:tr('Мой профиль');
    $('identitySummary').textContent=local?tr('Вы вошли в LINK · ')+label:jabber?tr('Аккаунт Jabber · ')+account.id:tr('Вы не вошли в профиль');
    $('linkSessionActions').hidden=!local;$('settingsGuest').hidden=local||jabber;$('settingsIdentity').hidden=local||!jabber;
    $('settingsDirect').hidden=local||jabber;$('settingsDirect').textContent=tr(direct.raw().me?'Войти в профиль LINK':'Создать профиль LINK');
    const locked=!!(state.session||state.starting||direct.raw().incoming||direct.raw().outgoing||internet.room.pending||internet.room.outgoing||internet.access.pending);
    $('linkLogout').disabled=$('changeMethod').disabled=locked;
  }
  async function setMethod(next){
    await api.direct({op:'session',active:next==='link'});
    settings.identityMode=next;saveSettings();
  }
  async function switchFromLink(jabber=false,signOut=false){
    if(state.session||state.starting||direct.raw().incoming||direct.raw().outgoing){toast(tr('Для смены профиля завершите звонок.'));return;}
    if(direct.active()&&!await confirmAction(signOut?tr('Выйти из LINK?'):tr('Сменить способ входа?'),tr('Профиль и друзья сохранятся на этом ПК. До следующего входа звонки LINK поступать не будут.'),signOut?tr('Выйти'):tr('Продолжить')))return;
    await setMethod('signed-out');await direct.sync();closeDialog('settingsDialog');closeDialog('directDialog');
    if(!signOut)internet.picker(jabber);else toast(tr('Вы вышли из LINK. Профиль сохранён на этом ПК.'));
  }
  refreshIdentity=identityChanged;
  action('changeMethod',()=>switchFromLink());action('linkLogout',()=>switchFromLink(false,true));
  internet=internetPanel({showRequests:()=>workspace.navigate('requests'),routeCue: sound => state.session && mixer.routeLocal(sound),localActive:()=>direct?.active(),switchFromLink,identityChanged,notifyRequests,contactMenu,api,$,node,showDialog,closeDialog,confirmAction,action,state,settings,saveSettings,connect:connectRoom,disconnect:disconnectRoom,openManual:openRoomDialog,
    event:e=>{if(!state.ready){if(state.starting)state.queuedEvents.push(e);}else if(state.session?.internet)enqueueEvent(e);},errorToast,toast,connectionChanged:renderAvailability});
  direct=directPanel({openChat:id=>workspace.openChat(id),showProfile:()=>openSettings('profile'),showFriends:filter=>workspace.showFriends(filter),showRequests:id=>workspace.showRequests(id),setMethod,identityChanged,inviteFriends:()=>workspace.invite(),notifyRequests,contactMenu,disconnect:disconnectRoom,api,$,state,settings,saveSettings,connect:connectRoom,internet:()=>internet,node,showDialog,closeDialog,confirmAction,toast});
  workspace=createWorkspace({$, state, direct, internet, composer, closeStudio, confirmAction, action, actionError:errorToast, openGroupVoice, removeRequest:async(c,local)=>{
    try{
      if(!await confirmAction(tr('Убрать отправленную заявку?'),c.name+' · '+tr('Друг мог уже получить уведомление.'),tr('Убрать из списка')))return;
      if(local && direct.active() && direct.raw().friends.some(f=>f.id===c.id && f.state==='invited')){await api.direct({op:'forget',id:c.id});await direct.sync();}
      else if(!local && internet.account.status==='online' && !internet.account.mutual(c.id))await internet.account.remove(c.id);
    }catch(e){errorToast(e);}
  },copyCard:async()=>{
    if(direct.active()){await api.direct({op:'copy'});toast(tr('Карточка скопирована. Отправьте её другу лично.'));}
    else if(internet.account.id){await api.copyText(internet.account.id);toast(tr('Адрес скопирован.'));}
  }});
  $('strictProxy').addEventListener('change',()=>api.direct({op:'policy',strict:!!settings.proxyOnly,dnd:settings.dnd}).then(()=>direct.sync()).catch(errorToast));
  $('systemNotices').checked=settings.systemNotices!==false;
  $('systemNotices').onchange=()=>{settings.systemNotices=$('systemNotices').checked;saveSettings();renderControls();};
  $('dnd').checked=settings.dnd;
  $('dnd').addEventListener('change',async()=>{
    settings.dnd=$('dnd').checked;saveSettings();renderControls();
    internet.account.syncActivity(internet.access.update());
    if(settings.dnd){notices.dismiss();api.internet({op:'clear-request-notice'}).catch(()=>{});internet.hush();if(internet.room.pending&&!internet.room.pending.accepted)internet.room.decline('busy');
      if(['intro','knock'].includes(internet.access.pending?.type))internet.access.cancel('busy');api.internet({op:'end-ring'}).catch(()=>{});}
    try{await api.direct({op:'policy',strict:!!settings.proxyOnly,dnd:settings.dnd});await direct.sync();}catch(e){errorToast(e);}
  });
  api.onEvent(event => {
    if(event.type==='release-updated'){projectUpdates?.draw(event.state);return;}
    if(event.type==='window-hidden'){composer.stopCapture();return;}
    if(event.type==='window-focused'){workspace.windowFocused();return;}
    if(event.type==='tray-game'){workspace.navigate('game');return;}
    if(event.type==='tray-chat'){
      void direct.sync().then(()=>{
        const data=direct.raw();
        if(direct.active() && data.me.id===event.profile && data.friends.some(f=>f.id===event.id && f.state==='friend'))workspace.openChat(event.id);
      }).catch(errorToast);
      return;
    }
    if(event.type==='game-notice'){toast(event.name+' · '+event.text);return;}
    if(event.type==='game-invited'){if(!settings.dnd && document.hasFocus() && !document.fullscreenElement)toast(event.name+' · '+tr('Приглашение в игровую LAN'),false,()=>workspace.navigate('game'));return;}
    if(event.type==='game-ended')return;
    if(event.type==='tray-requests'){
      workspace.navigate('requests',!document.querySelector('dialog:modal'));
      notices.revealPending();return;
    }
    if(event.type==='graphics-updated'){if($('settingsDialog').open)refreshGraphics().catch(errorToast);return;}
    if(event.type==='direct-chat-updated')workspace.chatChanged(event);
    if(direct.handle(event))return;
    if (!state.ready) { if (state.starting) state.queuedEvents.push(event); return; }
    enqueueEvent(event);
  });
  await api.direct({op:'policy',strict:!!settings.proxyOnly,dnd:settings.dnd,paused:['signed-out','jabber'].includes(settings.identityMode)});
  await projectUpdates?.refresh();
  await direct.sync().catch(errorToast);
  if(direct.active()&&settings.identityMode==='auto'){settings.identityMode='link';saveSettings();}
  if(!direct.active())await internet.start();
  identityChanged();
  state.environment = await api.environment();
  const windows=state.environment.platform==='win32';
  $('captureBorderInfo').hidden=!windows;
  const supported=windows && Number(state.environment.osRelease.split('.')[2])>=20348;
  $('borderSettings').hidden=!supported;
  $('captureBorderHint').textContent=tr(supported?'Цветная рамка отмечает окно, которое вы показываете. Windows управляет разрешением на захват без рамки. В этой версии LINK рамка может остаться включённой.':'Цветная рамка отмечает окно, которое вы показываете. Эта версия Windows сохраняет рамку на время показа.');
  action('borderSettings',()=>api.openBorderSettings());
  await refreshGraphics().catch(errorToast);
  renderAll();
}

init().catch(errorToast);
