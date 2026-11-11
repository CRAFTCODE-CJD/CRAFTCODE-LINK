import {tr} from './locale.mjs';
/* CRAFTCODE LINK media plane. Host-owned star topology. Account calls use authorized ICE services. */
import { WatchBuffer } from './watch-buffer.mjs';
import { LinkQuality, audioContinuity } from './link-quality.mjs';
import { streamRelays } from './relay-settings.mjs';
import { videoSamples } from './video-stats.mjs';
export const MAX_PARTICIPANTS = 8;
export const ROLES = Object.freeze(['voice', 'screen', 'system']);
export const UDP_MIN = 45832;
export const UDP_MAX = 45863;

export function trackIndex(slot, role) {
  const r = ROLES.indexOf(role);
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_PARTICIPANTS || r < 0) throw new Error('Invalid media slot');
  return slot * ROLES.length + r;
}

export function trackIdentity(index) {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_PARTICIPANTS * ROLES.length) return null;
  return { slot: Math.floor(index / ROLES.length), role: ROLES[index % ROLES.length] };
}

// Project WebRTC reports onto an allowlist. Never serialize raw RTCStatsReport.
export function inboundCounters(report) {
  const bySlot = new Map();
  const clocks = new Map();
  for (const stat of report.values()) {
    if (stat.type !== 'inbound-rtp' || !/^\d+$/.test(stat.mid)) continue;
    const track = trackIdentity(Number(stat.mid));
    if (!track || stat.kind !== (track.role === 'screen' ? 'video' : 'audio')) continue;
    const row = bySlot.get(track.slot) ?? { slot: track.slot, voiceBytes: 0, screenBytes: 0, systemBytes: 0, framesDecoded: 0 };
    row[track.role + 'Bytes'] += stat.bytesReceived || 0;
    if (track.role === 'screen') row.framesDecoded += stat.framesDecoded || 0;
    bySlot.set(track.slot, row);
    if (track.role === 'voice' || !Number.isFinite(stat.estimatedPlayoutTimestamp) || stat.estimatedPlayoutTimestamp <= 0) continue;
    const packetAge = stat.timestamp - stat.lastPacketReceivedTimestamp;
    if (!Number.isFinite(packetAge) || packetAge < 0 || packetAge > 1000) continue;
    const clock = clocks.get(track.slot) || new Map();
    // Two live SSRCs for one role are ambiguous during a handover.
    clock.set(track.role, clock.has(track.role) ? null : stat.estimatedPlayoutTimestamp);
    clocks.set(track.slot, clock);
  }
  for (const [slot, clock] of clocks) {
    if (Number.isFinite(clock.get('system')) && Number.isFinite(clock.get('screen'))) {
      bySlot.get(slot).estimatedScreenSkewMs = Math.round(clock.get('system') - clock.get('screen'));
    }
  }
  return [...bySlot.values()].sort((a, b) => a.slot - b.slot);
}

export function validIPv4(address) {
  return typeof address === 'string' && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)
    && address.split('.').every(x => Number(x) <= 255 && String(Number(x)) === x)
    && address !== '0.0.0.0' && Number(address.split('.')[0]) < 224;
}

/** Advertise a USER-CONFIGURED, same-port NAT mapping, never a discovered address. */
export function forwardedCandidate(init, address, min = UDP_MIN, max = UDP_MAX) {
  if (!init || typeof init.candidate !== 'string' || !validIPv4(address)) return null;
  const p = init.candidate.trim().split(/\s+/);
  if (p.length < 8 || !p[0].startsWith('candidate:') || p[2].toLowerCase() !== 'udp' || p[6] !== 'typ' || p[7] !== 'host') return null;
  const port = Number(p[5]);
  if (!Number.isInteger(port) || port < min || port > max || p[4] === address) return null;
  if (p[4].includes(':')) return null; // This release's explicit forwarding mode is IPv4 only.
  const component = Number(p[1]);
  if (component !== 1 && component !== 2) return null;
  const localAddress = validIPv4(p[4]) ? p[4] : '0.0.0.0';
  const priority = (100 * 2 ** 24) + (65535 * 256) + (256 - component);
  const extras = [];
  for (let i = 8; i + 1 < p.length; i += 2) {
    if (['generation', 'ufrag', 'network-id', 'network-cost'].includes(p[i])) extras.push(p[i], p[i + 1]);
  }
  return {
    candidate: [`candidate:cl${p[0].slice(10)}`, component, 'udp', priority, address, port,
      'typ', 'srflx', 'raddr', localAddress, 'rport', port, ...extras].join(' '),
    sdpMid: init.sdpMid ?? null,
    sdpMLineIndex: init.sdpMLineIndex ?? null,
    ...(init.usernameFragment ? { usernameFragment: init.usernameFragment } : {}),
  };
}

// A bundled Opus payload number must have identical fmtp across ALL m-lines.
// Microphone capture remains mono/64kbps; system capture can negotiate stereo.
export function stereoDescription(description) {
  const sections = description.sdp.split(/(?=^m=)/m);
  let index = -1;
  const sdp = sections.map(section => {
    if (!section.startsWith('m=')) return section;
    index++;
    if (!section.startsWith('m=audio ')) return section;
    const codec = section.match(/^a=rtpmap:(\d+) opus\/48000\/2\r?$/m)?.[1];
    if (!codec) return section;
    const re = new RegExp(`^a=fmtp:${codec} ([^\\r\\n]*)`, 'm');
    const match = section.match(re);
    const fields = (match?.[1] || '').split(';').filter(x => x && !/^(stereo|sprop-stereo|maxaveragebitrate|useinbandfec)=/.test(x));
    fields.push('stereo=1', 'sprop-stereo=1', 'maxaveragebitrate=192000','useinbandfec=1');
    const line = `a=fmtp:${codec} ${fields.join(';')}`;
    return match ? section.replace(re, line) : section.replace(`a=rtpmap:${codec} opus/48000/2\r\n`, `a=rtpmap:${codec} opus/48000/2\r\n${line}\r\n`);
  }).join('');
  return { type: description.type, sdp };
}

export class RoomMedia {
  constructor({ session, sendSignal, files=null, rightsChanged=()=>{}, videoSourceChanged=()=>{}, onTrack = () => {}, onState = () => {}, onError = () => {}, onStats = () => {}, onChat = () => {}, onControl = () => {}, refreshIce = null, signalingReady = () => true, peerFactory, screenOutputDelay = null }) {
    this.session = session;
    this.rightsKnown = this.isHost || !!session.groupVoice;
    this.files=files;this.rightsChanged=rightsChanged;this.moderated=false;this.speakers=new Set();this.allowedVoice=true;
    this.rawTracks=new Map();
    this.slots=session.internet ? 3 : MAX_PARTICIPANTS;
    this.sendSignal = sendSignal;
    this.refreshIce = refreshIce;
    this.signalingReady = signalingReady;
    this.onTrack = onTrack;
    this.onChat = onChat;
    this.onControl = onControl;
    this.watchBuffer = new WatchBuffer(screenOutputDelay);
    this.videoSources = new Map();
    this.videoSourceChanged = videoSourceChanged;
    this.screenGroups = new Map();
    this.voiceGroups = new Map();
    this.viewHeight = 0;
    this.inputHeights = new Map();
    this.onState = onState;
    this.onError = onError;
    this.onStats = onStats;
    this.peerFactory = peerFactory || (() => new RTCPeerConnection({ iceServers: session.internet || session.direct || session.groupVoice ? session.iceServers || [] : [], iceTransportPolicy:session.internet && session.relayOnly ? 'relay' : 'all', bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' }));
    this.endpoints = new Map();
    this.peers = [];
    this.tracks = new Map();
    this.bitrate = 8_000_000;
    this.fps = 30;
    this.closed = false;
    this.rosterQueue = Promise.resolve();
    this.statHistory = new Map();
    this.statsTimer = setInterval(() => {
      if(this.readingStats)return;
      this.readingStats=this.collectStats().catch(()=>{}).finally(()=>{this.readingStats=null;});
    },2000);
  }

  get selfSlot() { return this.peers.find(p => p.id === this.session.selfId)?.slot ?? (this.session.role === 'host' ? 0 : -1); }
  get isHost() { return this.session.role === 'host'; }
  getTrack(slot, role) { return this.tracks.get(`${slot}:${role}`) || null; }

  videoSource(slot) {
    const peer = this.peers.find(p => p.slot === slot);
    return this.videoSources.get(peer?.id) || 'screen';
  }

  updateVideoSource(peer, source, refresh = false) {
    if (!refresh && (this.videoSources.get(peer.id) || 'screen') === source) return false;
    if (source === 'camera') this.videoSources.set(peer.id, source);
    else this.videoSources.delete(peer.id);
    for (const ep of this.endpoints.values()) {
      const transceiver = ep.pc.getTransceivers()[trackIndex(peer.slot, 'screen')];
      if (transceiver && (this.isHost ? ep.remoteSlot !== peer.slot : peer.id === this.session.selfId)) {
        transceiver.sender.setStreams(...this.senderStreams(peer.slot, 'screen'));
      }
      if (this.isHost) this.scheduleVideoNegotiation(ep);
    }
    this.watchBuffer.update(this);
    this.videoSourceChanged();
    return true;
  }

  setVideoSource(source) {
    const peer = this.peers.find(p => p.id === this.session.selfId);
    if (this.closed || !peer || !['camera', 'screen'].includes(source)) return;
    if (source === 'camera' && !this.allowed(peer.slot, 'screen')) return;
    this.updateVideoSource(peer, source, true);
    this.publishVideoSources(undefined, true);
  }

  publishVideoSources(target, renegotiate = false) {
    const peers = this.isHost ? this.peers : this.peers.filter(p => p.id === this.session.selfId);
    const targets = target ? [target] : [...this.endpoints.values()];
    const sources = peers.map(peer => ({peerId: peer.id, slot: peer.slot, source: this.videoSource(peer.slot)}));
    for (const ep of targets) {
      if (renegotiate && !this.isHost) ep.videoSourceNegotiation = true;
      const packet = this.isHost ? {kind: 'video-sources', sources} : sources.length && {
        kind: 'video-source', ...sources[0], ...(ep.videoSourceNegotiation ? {renegotiate: true} : {}),
      };
      if (!packet) continue;
      if (this.sendControl(ep.id, packet)) {
        clearTimeout(ep.videoSourceRetry);
        ep.videoSourceRetry = null;
        ep.videoSourceNegotiation = false;
      } else if (!this.closed && ep.channel?.readyState === 'open' && !ep.videoSourceRetry) {
        ep.videoSourceRetry = setTimeout(() => {
          ep.videoSourceRetry = null;
          if (!this.closed && this.endpoints.get(ep.id) === ep) this.publishVideoSources(ep);
        }, 250);
      }
    }
  }

  receiveVideoSources(ep, packet) {
    if (this.isHost || ep.id !== this.session.hostId ||
        Object.keys(packet).some(key => !['kind', 'sources'].includes(key)) ||
        !Array.isArray(packet.sources) || packet.sources.length > MAX_PARTICIPANTS) return;
    const ids = new Set();
    for (const row of packet.sources) {
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
          Object.keys(row).some(key => !['peerId', 'slot', 'source'].includes(key)) ||
          !Number.isInteger(row.slot) || !['camera', 'screen'].includes(row.source) || ids.has(row.peerId) ||
          !this.peers.some(peer => peer.id === row.peerId && peer.slot === row.slot)) return;
      ids.add(row.peerId);
    }
    for (const row of packet.sources) this.receiveVideoSource(ep, {kind: 'video-source', ...row});
  }

  receiveVideoSource(ep, packet) {
    if (Object.keys(packet).some(key => !['kind', 'peerId', 'slot', 'source', 'renegotiate'].includes(key)) ||
        !Number.isInteger(packet.slot) || !['camera', 'screen'].includes(packet.source) ||
        (packet.renegotiate !== undefined && packet.renegotiate !== true)) return;
    const peer = this.peers.find(p => p.id === packet.peerId && p.slot === packet.slot);
    if (!peer || peer.id === this.session.selfId) return;
    if (this.isHost) {
      if (peer.id !== ep.id || peer.slot !== ep.remoteSlot ||
          (packet.source === 'camera' && !this.allowed(peer.slot, 'screen'))) return;
    } else if (ep.id !== this.session.hostId) return;
    const changed = this.updateVideoSource(peer, packet.source);
    if (this.isHost) {
      if (changed) this.publishVideoSources();
      else if (packet.renegotiate) this.scheduleVideoNegotiation(ep);
    }
  }

  scheduleVideoNegotiation(ep) {
    ep.videoNegotiationPending = true;
    ep.queue = ep.queue.then(async () => {
      if (this.closed || this.endpoints.get(ep.id) !== ep || ep.pc.signalingState !== 'stable' || !ep.videoNegotiationPending) return;
      ep.videoNegotiationPending = false;
      await this.offer(ep);
    }).catch(error => { if (!this.closed) this.onError(error.message); });
  }

  allowed(slot,role){
    if(!this.moderated||slot===0)return true;
    if(!this.isHost)return role==='voice'&&this.allowedVoice;
    const peer=this.peers.find(p=>p.slot===slot);
    return role==='voice'&&!!peer&&this.speakers.has(peer.id);
  }
  sendRights(ep){
    if(this.isHost&&!this.session.groupVoice)this.sendControl(ep.id,{kind:'room-rights',moderated:this.moderated,voice:this.speakers.has(ep.id)});
  }
  async setRights(enabled,id,grant){
    if(!this.isHost||this.session.groupVoice)return;
    this.moderated=!!enabled;
    if(!enabled)this.speakers.clear();
    if(id&&this.endpoints.has(id)){if(grant)this.speakers.add(id);else this.speakers.delete(id);}
    for(const ep of this.endpoints.values())this.sendRights(ep);
    for (const peer of this.peers) {
      if (!this.allowed(peer.slot, 'screen')) this.updateVideoSource(peer, 'screen');
    }
    this.publishVideoSources();
    for(const [key,track] of this.rawTracks){
      const [n,role]=key.split(':'),slot=Number(n),next=this.allowed(slot,role)&&track.readyState==='live'?track:null;
      if(this.getTrack(slot,role)===next)continue;
      if(next)this.tracks.set(key,next);else this.tracks.delete(key);
      this.onTrack({slot,role,track:next});await this.forwardTrack(slot,role,next);
    }
    this.rightsChanged();
  }
  screenGroup(slot) {
    if (!this.screenGroups.has(slot)) this.screenGroups.set(slot, new MediaStream());
    return this.screenGroups.get(slot);
  }

  senderStreams(slot, role) {
    if (role === 'voice' || (role === 'screen' && this.videoSource(slot) === 'camera')) {
      if (!this.voiceGroups.has(slot)) this.voiceGroups.set(slot, new MediaStream());
      return [this.voiceGroups.get(slot)];
    }
    return [this.screenGroup(slot)];
  }

  restoreCameraStreams(ep) {
    // Chromium can restore the original MSID during replaceTrack/setParameters.
    // Reapply the current camera/voice grouping after native sender mutations.
    const transceivers = ep.pc.getTransceivers();
    for (const id of this.videoSources.keys()) {
      const peer = this.peers.find(p => p.id === id);
      if (!peer || (this.isHost ? peer.slot === ep.remoteSlot : id !== this.session.selfId)) continue;
      transceivers[trackIndex(peer.slot, 'screen')]?.sender.setStreams(...this.senderStreams(peer.slot, 'screen'));
    }
  }

  watch(peerId, milliseconds) {
    this.watchBuffer.select(peerId, milliseconds);
    return this.watchBuffer.update(this);
  }

  updatePeers(peers) {
    this.rosterQueue = this.rosterQueue.then(async () => {
      if (this.closed) return;
      const oldPeers = this.peers;
      this.peers = peers.slice();
      for (const id of this.videoSources.keys()) {
        if (!peers.some(peer => peer.id === id)) this.videoSources.delete(id);
      }
      this.watchBuffer.prune(peers);
      this.watchBuffer.update(this);
      if (this.isHost) {
        for (const old of oldPeers) {
          if (old.id !== this.session.selfId && !peers.some(p => p.id === old.id)) await this.removeEndpoint(old.id, old.slot);
        }
        for (const peer of peers) {
          if (peer.id !== this.session.selfId && !this.endpoints.has(peer.id)) {
            const ep = this.createEndpoint(peer.id, peer.slot);
            const slots=this.session.internet && peer.mediaSlots===3 ? this.slots : MAX_PARTICIPANTS;
            for (let slot = 0; slot < slots; slot++) {
              for (const role of ROLES) {
                const t = ep.pc.addTransceiver(role === 'screen' ? 'video' : 'audio', {
                  direction: slot === peer.slot ? 'recvonly' : 'sendonly',
                  streams: slot !== peer.slot ? this.senderStreams(slot, role) : [],
                });
                const track = this.getTrack(slot, role);
                if (slot !== peer.slot && track?.readyState === 'live') await t.sender.replaceTrack(track);
              }
            }
            await this.offer(ep);
          }
        }
      } else if (!this.endpoints.has(this.session.hostId)) {
        this.createEndpoint(this.session.hostId, 0);
      }
      this.publishVideoSources();
      if (!this.isHost) this.sendControl(this.session.hostId, {kind: 'video-source-sync'});
    }).catch(e => this.onError(`${tr("Не удалось подготовить соединение: ")}${e.message}`));
    return this.rosterQueue;
  }

  createEndpoint(id, remoteSlot) {
    const pc = this.peerFactory();
    const ep = { id, remoteSlot, pc, quality:new LinkQuality(), audioHistory:new Map(), createdAt:Date.now(), iceErrors:new Set(), queue: Promise.resolve(), encodingQueue: Promise.resolve(), candidates: [], candidateSet: new Set(), restartCount: 0, lastRestart: 0, recovery: false, videoHistory: new Map(), disconnectedTimer: null, connectionTimer: null };
    this.endpoints.set(id, ep);
    if(this.isHost && (this.session.internet||this.files))this.installChat(ep,pc.createDataChannel('room-chat'));
    if(this.isHost && this.files)this.files.attach(id,pc.createDataChannel('link-files-v1'));
    if(!this.isHost)pc.ondatachannel=({channel})=>{
      if(this.closed||this.endpoints.get(id)!==ep){channel.close();return;}
      if(channel.label==='link-files-v1'&&this.files)this.files.attach(id,channel);else this.installChat(ep,channel);
    };
    pc.onicecandidate = e => {
      if (!e.candidate || this.closed) return;
      const candidate = e.candidate.toJSON();
      this.emitSignal(id, { type: 'ice', candidate });
      const advertised = this.session.internet || (this.session.direct && !this.session.forwardPublic) ? null : this.isHost ? this.session.publicAddress : null;
      if (advertised) {
        const configured = forwardedCandidate(candidate, advertised, this.session.udpMin, this.session.udpMax);
        if (configured) this.emitSignal(id, { type: 'ice', candidate: configured });
      }
    };
    pc.onicecandidateerror=e=>{if(Number.isInteger(e.errorCode) && ep.iceErrors.size<8)ep.iceErrors.add(e.errorCode);};
    pc.ontrack = event => {
      const index = pc.getTransceivers().indexOf(event.transceiver);
      const identity = trackIdentity(index);
      if (!identity || (this.isHost && identity.slot !== ep.remoteSlot) || (!this.isHost && identity.slot === this.selfSlot)) return;
      const { slot, role } = identity;
      const track = event.track;
      this.watchBuffer.update(this);
      if(this.isHost && role==='screen' && ep.shareProfile)track.contentHint=ep.shareProfile.content;
      if(this.isHost)this.rawTracks.set(`${slot}:${role}`,track);
      if(this.isHost&&!this.allowed(slot,role))return;
      this.tracks.set(`${slot}:${role}`, track);
      this.onTrack({ slot, role, track });
      if (this.isHost) this.forwardTrack(slot, role, track).catch(e => this.onError(`${tr("Пересылка медиа: ")}${e.message}`));
      track.addEventListener('ended', () => {
        if (this.getTrack(slot, role) !== track) return;
        this.tracks.delete(`${slot}:${role}`);
        this.onTrack({ slot, role, track: null });
        if (this.isHost) this.forwardTrack(slot, role, null).catch(() => {});
      });
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      this.onState({ peerId: id, state });
      if (state === 'connected') {
        if(pc.signalingState==='stable')this.recovered(ep);
        clearTimeout(ep.connectionTimer);
        ep.advertisedHeight=undefined;this.publishViewHeights();this.publishShareProfile();
        this.applyEncoding(ep).catch(() => {});
      } else if (state === 'failed' || state === 'disconnected') {
        this.scheduleRestart(ep,state==='failed'?300:2500);
      }
    };
    pc.oniceconnectionstatechange=()=>{
      if(['disconnected','failed'].includes(pc.iceConnectionState))this.scheduleRestart(ep,2500);
    };
    ep.connectionTimer = setTimeout(() => {
      if (!this.closed && pc.connectionState !== 'connected') {
        this.onState({ peerId: id, state: 'unreachable' });
        if(this.session.internet)this.scheduleRestart(ep,200);
        if(!this.session.internet)this.onError(tr('Управление комнатой работает, но медиа не соединяется. Проверьте UDP 45832–45863, брандмауэр и переадресацию портов у создателя.'));
      }
    }, 25_000);
    return ep;
  }

  installChat(ep,channel) {
    if (channel.label !== 'room-chat' || ep.channel) { channel.close(); return; }
    ep.channel = channel;
    channel.onclose=()=>this.chatChanged?.();
    channel.onopen=()=>{
      this.sendRights(ep);this.chatChanged?.();ep.advertisedHeight=undefined;this.publishViewHeights();this.publishShareProfile();
      this.publishVideoSources(ep);
      if (!this.isHost) this.sendControl(ep.id, {kind: 'video-source-sync'});
    };
    channel.onmessage = ({data}) => {
      if (this.closed || this.endpoints.get(ep.id)!==ep || typeof data !== 'string' || data.length>25000) return;
      let message; try { message=JSON.parse(data); } catch { return; }
      if (message?.control) {
        const now=performance.now();
        if (now-(ep.controlWindow ?? -Infinity)>2000) { ep.controlWindow=now; ep.controlCount=0; }
        if (++ep.controlCount>32) return;
        const {kind,nonce}=message.control;
        if(kind==='room-rights'){
          if(!this.session.groupVoice&&!this.isHost&&ep.id===this.session.hostId&&typeof message.control.moderated==='boolean'&&typeof message.control.voice==='boolean'){
            this.rightsKnown=true;this.moderated=message.control.moderated;this.allowedVoice=message.control.voice;this.rightsChanged();
          }
        }else if(kind==='route-ping' && Number.isSafeInteger(nonce)){
          this.sendControl(ep.id,{kind:'route-pong',nonce});
        }else if(kind==='playout-pressure' && typeof message.control.rough==='boolean'){
          ep.remotePressureUntil=message.control.rough?Date.now()+6500:0;
        }else if(kind==='route-pong'){
          if(nonce===ep.probeNonce){clearTimeout(ep.probeTimer);ep.probeTimer=null;}
        }else if(kind==='video-source'){
          this.receiveVideoSource(ep,message.control);
        }else if(kind==='video-sources'){
          this.receiveVideoSources(ep,message.control);
        }else if(kind==='video-source-sync'){
          if(this.isHost && Object.keys(message.control).length===1)this.publishVideoSources(ep);
        }else if(kind==='share-profile'){
          this.receiveShareProfile(ep,message.control);
        }else if(kind==='view-height'){
          this.receiveViewHeight(ep,message.control.height);
        } else this.onControl(ep.id,message.control);
        return;
      }
      if (typeof message?.text !== 'string' || !message.text.trim() || message.text.length>4000) return;
      const from=this.isHost ? ep.id : message.from;
      if (!this.peers.some(p=>p.id===from)) return;
      const now=Date.now(); ep.chatTimes=(ep.chatTimes || []).filter(t=>now-t<2000);
      if(ep.chatTimes.length>=16)return;
      ep.chatTimes.push(now);
      this.deliverChat(from,message.text,this.isHost).catch(e=>this.onError(e.message));
    };
  }
  sendControl(peerId,packet) {
    const channel=this.endpoints.get(peerId)?.channel;
    if(this.closed || channel?.readyState!=='open' || channel.bufferedAmount>65536)return false;
    try { channel.send(JSON.stringify({control:packet})); return true; } catch { return false; }
  }
  publishShareProfile() {
    if(this.isHost)return;
    const ep=this.endpoints.get(this.session.hostId);
    if(ep?.pc.connectionState!=='connected')return;
    const profile={content:this.content,bitrate:this.bitrate,fps:this.fps};
    if(!this.sendControl(ep.id,{kind:'share-profile',...profile}))this.emitSignal(ep.id,{type:'share-profile',...profile});
  }
  receiveShareProfile(ep,p) {
    if(!this.isHost || !['detail','motion'].includes(p.content) || !Number.isInteger(p.bitrate) ||
        p.bitrate<1000000 || p.bitrate>32000000 || !Number.isInteger(p.fps) || p.fps<15 || p.fps>60)return;
    const old=ep.shareProfile;
    if(old?.content===p.content && old.bitrate===p.bitrate && old.fps===p.fps)return;
    ep.shareProfile={content:p.content,bitrate:p.bitrate,fps:p.fps};
    const track=this.getTrack(ep.remoteSlot,'screen');if(track)track.contentHint=p.content;
    for(const target of this.endpoints.values())if(target!==ep)this.applyEncoding(target);
  }
  requestedHeight(ep) {
    // A guest's single upload also supplies the other viewers behind the host.
    const limits=[this.viewHeight];
    if(this.isHost) for(const other of this.endpoints.values()) if(other!==ep)limits.push(other.viewHeight || 0);
    return limits.includes(0) ? 0 : Math.max(...limits);
  }
  publishViewHeights() {
    for (const ep of this.endpoints.values()) {
      if (ep.pc.connectionState!=='connected') continue;
      const height=this.requestedHeight(ep);
      if(ep.advertisedHeight===height)continue;
      ep.advertisedHeight=height;
      if(!this.sendControl(ep.id,{kind:'view-height',height})) this.emitSignal(ep.id,{type:'view-height',height});
    }
  }
  setViewHeight(height) {
    if(![0,720,1080,1440].includes(height))return;
    this.viewHeight=height;
    this.publishViewHeights();
  }
  receiveViewHeight(ep,height) {
    if(![0,720,1080,1440].includes(height) || ep.viewHeight===height)return;
    ep.viewHeight=height;
    this.applyEncoding(ep);
    if(this.isHost)this.publishViewHeights();
  }
  scaleFor(ep,slot,track,networkHeight=0) {
    const height=(slot!==this.selfSlot && this.inputHeights.get(slot)) || track.getSettings?.().height || 0;
    const limit=Math.min(ep.viewHeight || Infinity,networkHeight || Infinity);
    return height ? Math.max(1,height/limit) : 1;
  }
  textRoutes() {
    return [...this.endpoints.values()].map(ep=>ep.channel?.readyState==='open' ? 'direct' : this.backupReady?.(ep.id) ? 'backup' : '');
  }
  async writeChat(ep,message){
    if(ep.channel?.readyState==='open' && ep.channel.bufferedAmount<65536){
      try{ep.channel.send(JSON.stringify(message));return;}catch{}
    }
    if(this.backupReady?.(ep.id))return this.backupWrite(ep.id,message);
    throw Error(tr('Канал чата недоступен.'));
  }
  async deliverChat(from,text,broadcast) {
    const author=this.peers.find(p=>p.id===from);
    if(!author || typeof text!=='string' || !text.trim() || text.length>4000)return;
    if(broadcast){
      const outputs=[...this.endpoints.values()];
      const results=await Promise.allSettled(outputs.map(ep=>this.writeChat(ep,{from,text})));
      if(!results.some(r=>r.status==='fulfilled') && from===this.session.selfId)throw Error(tr('Сообщение не отправлено.'));
      if(results.some(r=>r.status==='rejected'))this.onError(tr('Сообщение отправлено не всем участникам.'));
    }
    if(!this.closed)this.onChat({type:'chat',from,name:author.name,text,time:Date.now()});
  }
  async sendChat(text) {
    if(!text.trim() || text.length>4000)throw new Error(tr('Сообщение должно содержать от 1 до 4000 символов.'));
    if(!this.textRoutes().some(Boolean))throw Error(tr('Чат ещё подключается.'));
    if(this.isHost)return this.deliverChat(this.session.selfId,text,true);
    return this.writeChat(this.endpoints.get(this.session.hostId),{text});
  }

  emitSignal(peerId, data) {
    if (this.closed) return;
    if (data.type==='offer' || data.type==='answer') data={...data,viewHeight:this.requestedHeight(this.endpoints.get(peerId))};
    Promise.resolve(this.sendSignal({ peerId, data })).catch(e => { if (!this.closed) this.onError(`${tr("Сигнализация: ")}${e.message}`); });
  }

  async offer(ep, restart = false) {
    await ep.encodingQueue;
    if (this.closed || ep.pc.signalingState === 'closed') return;
    this.restoreCameraStreams(ep);
    await ep.pc.setLocalDescription(stereoDescription(await ep.pc.createOffer({ iceRestart: restart })));
    ep.round=(ep.round || 0)+1;
    this.emitSignal(ep.id, { type: 'offer', sdp: ep.pc.localDescription.sdp, round:ep.round });
  }

  recovered(ep) {
    clearTimeout(ep.disconnectedTimer);
    ep.disconnectedTimer=null;
    ep.restartCount=0;ep.nextAttempt=0;
    ep.recovery=false;
  }

  scheduleRestart(ep,delay) {
    if(this.closed || this.endpoints.get(ep.id)!==ep || ep.disconnectedTimer)return;
    ep.disconnectedTimer=setTimeout(()=>{
      ep.disconnectedTimer=null;
      if(!ep.recovery && ep.pc.connectionState==='connected' && !['failed','disconnected'].includes(ep.pc.iceConnectionState))return;
      this.maybeRestart(ep);
    },delay);
  }

  async updateIce(ep) {
    if(!this.refreshIce)return;
    // One provider query shared by all peers during a network transition.
    if(!this.iceQuery || Date.now()-this.iceQuery.time>10000){
      this.iceQuery={time:Date.now(),services:Promise.resolve().then(this.refreshIce).catch(()=>[])};
    }
    const servers=await this.iceQuery.services;
    if(this.closed || this.endpoints.get(ep.id)!==ep)return;
    const tcp=streamRelays(servers);
    // Pin a recovery attempt to advertised TCP/TLS relay transports. Retry the complete
    // permitted set on the following window if that path also fails.
    const recovering=ep.recovery && ep.pc.connectionState!=='connected';
    const fallback=recovering && tcp.length>0 && Math.floor((Date.now()-ep.recoveryStarted)/35000)%2===0;
    const keepWorking=ep.tcpFallback && ep.pc.connectionState==='connected' && !ep.freshOffer && tcp.length>0;
    ep.tcpFallback=Boolean(fallback || keepWorking);
    ep.pc.setConfiguration({...ep.pc.getConfiguration(),iceServers:ep.tcpFallback?tcp:servers,
      iceTransportPolicy:this.session.relayOnly || ep.tcpFallback?'relay':'all'});
  }

  checkRoute(ep){
    if(this.closed || this.endpoints.get(ep.id)!==ep)return;
    if(ep.pc.connectionState!=='connected' || ep.pc.signalingState!=='stable' || ep.recovery || !this.session.internet){
      this.routeChanged(ep);return;
    }
    if(ep.probeTimer)return;
    ep.probeNonce=(ep.probeNonce || 0)+1;
    if(!this.sendControl(ep.id,{kind:'route-ping',nonce:ep.probeNonce})){this.routeChanged(ep);return;}
    ep.probeTimer=setTimeout(()=>{ep.probeTimer=null;this.routeChanged(ep);},3500);
  }

  routeChanged(ep){
    clearTimeout(ep.disconnectedTimer);ep.disconnectedTimer=null;
    clearTimeout(ep.probeTimer);ep.probeTimer=null;
    ep.freshOffer=true;ep.nextAttempt=0;ep.iceErrors.clear();this.iceQuery=null;
    this.maybeRestart(ep);
  }

  maybeRestart(ep) {
    if(this.closed || this.endpoints.get(ep.id)!==ep || ep.pc.signalingState==='closed')return;
    if(!ep.recovery)ep.recoveryStarted=Date.now();
    ep.recovery=true;
    const wait=Math.max(ep.lastRestart+1500,ep.nextAttempt || 0)-Date.now();
    if(wait>0){this.scheduleRestart(ep,wait);return;}
    if(!this.signalingReady()){this.scheduleRestart(ep,2000);return;}
    ep.lastRestart=Date.now();
    ep.restartCount++;
    // Give an answered ICE generation time to nominate a pair, even if both peers request retries.
    const checking=ep.pc.signalingState==='stable' && ep.pc.remoteDescription && ep.pc.connectionState!=='connected';
    const interval=checking?Math.min(60000,12000*Math.pow(2,Math.min(ep.restartCount-1,3))):Math.min(15000,3000*Math.pow(2,Math.min(ep.restartCount-1,3)));
    ep.nextAttempt=ep.lastRestart+interval;
    ep.queue=ep.queue.then(async()=>{
      if(this.closed || this.endpoints.get(ep.id)!==ep || !ep.recovery)return;
      await this.updateIce(ep);
      if(this.closed || this.endpoints.get(ep.id)!==ep)return;
      if(this.isHost){
        if(ep.pc.signalingState==='have-local-offer'){
          // The offer or answer may have been lost while signaling was offline.
          if(ep.freshOffer || ep.restartCount%3===0){
            ep.freshOffer=false;
            await this.offer(ep,true);
          }else this.emitSignal(ep.id,{type:'offer',sdp:ep.pc.localDescription.sdp,round:ep.round});
        } else if(ep.pc.signalingState==='stable'){ep.freshOffer=false;await this.offer(ep,true);}
      } else {this.emitSignal(ep.id,{type:'restart',routeChanged:!!ep.freshOffer});ep.freshOffer=false;}
    }).catch(e=>{if(!this.closed)this.onError(e.message);});
    this.scheduleRestart(ep,interval);
  }

  async acceptSignal(from, data) {
    await this.rosterQueue;
    if (this.closed || !data || typeof data !== 'object') return;
    const ep = this.endpoints.get(from);
    if (!ep) return;
    ep.queue = ep.queue.then(async () => {
      if (this.closed || ep.pc.signalingState === 'closed') return;
      if(data.type==='share-profile'){this.receiveShareProfile(ep,data);return;}
      if (data.type === 'view-height') { this.receiveViewHeight(ep,data.height); return; }
      if (data.type === 'offer' || data.type === 'answer') this.receiveViewHeight(ep,data.viewHeight);
      if (data.type === 'ice' && data.candidate && typeof data.candidate.candidate === 'string') {
        const key = JSON.stringify(data.candidate);
        if (ep.candidateSet.has(key)) return;
        if(ep.candidateSet.size>=512)ep.candidateSet.delete(ep.candidateSet.values().next().value);
        ep.candidateSet.add(key);
        if(!this.candidateMatches(ep,data.candidate)){
          if(ep.candidates.length>=128)ep.candidates.shift();
          ep.candidates.push(data.candidate);
        }else await ep.pc.addIceCandidate(data.candidate);
      } else if (data.type === 'offer' && !this.isHost && typeof data.sdp === 'string') {
        if(Number.isSafeInteger(data.round) && data.round < (ep.remoteRound || 0))return;
        if(Number.isSafeInteger(data.round) && data.round===ep.remoteRound && ep.pc.localDescription?.type==='answer'){
          this.emitSignal(from,{type:'answer',sdp:ep.pc.localDescription.sdp,round:data.round});
          return;
        }
        if(ep.pc.remoteDescription)await this.updateIce(ep);
        if(this.closed || this.endpoints.get(ep.id)!==ep)return;
        await ep.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        const transceivers = ep.pc.getTransceivers();
        if (transceivers.length !== this.slots * ROLES.length && !(this.session.internet && transceivers.length===MAX_PARTICIPANTS*ROLES.length)) throw new Error(tr('Несовместимая версия структуры медиа'));
        for (let index = 0; index < transceivers.length; index++) {
          const { slot, role } = trackIdentity(index);
          const t = transceivers[index];
          const mine = slot === this.selfSlot;
          t.direction = mine ? 'sendonly' : 'recvonly';
          if (mine) {
            await t.sender.replaceTrack(this.getTrack(slot, role));
            t.sender.setStreams(...this.senderStreams(slot, role));
          }
        }
        this.restoreCameraStreams(ep);
        await ep.pc.setLocalDescription(stereoDescription(await ep.pc.createAnswer()));
        ep.answeredAt=Date.now();
        ep.remoteRound=Number.isSafeInteger(data.round)?data.round:undefined;
        this.emitSignal(from, { type: 'answer', sdp: ep.pc.localDescription.sdp,round:ep.remoteRound });
        await this.flushCandidates(ep);
        await this.applyEncoding(ep);
      } else if (data.type === 'answer' && this.isHost && typeof data.sdp === 'string') {
        if (ep.pc.signalingState !== 'have-local-offer' || (data.round!==undefined && data.round!==ep.round)) return;
        await ep.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        await this.flushCandidates(ep);
        await this.applyEncoding(ep);
        if (ep.videoNegotiationPending) {
          ep.videoNegotiationPending = false;
          await this.offer(ep);
        }
      } else if (data.type === 'restart' && this.isHost) {
        if(data.routeChanged===true)this.routeChanged(ep);else this.maybeRestart(ep);
      }
    }).catch(e => { if (!this.closed) this.onError(`${tr("Медиа: ")}${e.message}`); });
    return ep.queue;
  }

  candidateMatches(ep,candidate) {
    const sdp=ep.pc.remoteDescription?.sdp;
    if(!sdp)return false;
    const ufrag=candidate.usernameFragment || candidate.candidate?.match(/ ufrag (\S+)/)?.[1];
    return !ufrag || sdp.split(/\r?\n/).includes('a=ice-ufrag:'+ufrag);
  }

  async flushCandidates(ep) {
    for (const candidate of ep.candidates.splice(0)) {
      if(this.candidateMatches(ep,candidate))await ep.pc.addIceCandidate(candidate);
    }
  }

  async setLocalTrack(role, track) {
    if (!ROLES.includes(role) || this.selfSlot < 0 || this.closed) return;
    const slot = this.selfSlot;
    if(track&&!this.isHost&&!this.allowed(slot,role))return;
    if (track) this.tracks.set(`${slot}:${role}`, track);
    else this.tracks.delete(`${slot}:${role}`);
    if (this.isHost) await this.forwardTrack(slot, role, track);
    else {
      const ep = this.endpoints.get(this.session.hostId);
      const sender = ep?.pc.getTransceivers()[trackIndex(slot, role)]?.sender;
      if (sender) {
        await sender.replaceTrack(track);
        sender.setStreams(...this.senderStreams(slot, role));
      }
      if (ep) await this.applyEncoding(ep);
    }
  }

  async forwardTrack(slot, role, track) {
    if (!this.isHost) return;
    const outcomes = await Promise.allSettled([...this.endpoints.values()].map(async ep => {
      if (ep.remoteSlot === slot || ep.pc.signalingState === 'closed') return;
      const sender = ep.pc.getTransceivers()[trackIndex(slot, role)]?.sender;
      if (sender) {
        await sender.replaceTrack(track);
        sender.setStreams(...this.senderStreams(slot, role));
      }
      await this.applyEncoding(ep);
    }));
    const failure = outcomes.find(o => o.status === 'rejected');
    if (failure) throw failure.reason;
  }

  async setQuality({ bitrate, fps, content }) {
    this.bitrate = Math.max(1_000_000, Math.min(32_000_000, Number(bitrate) || 8_000_000));
    this.content=content==='detail'?'detail':'motion';
    this.fps = Math.max(15, Math.min(60, Number(fps) || 30));
    this.publishShareProfile();
    await Promise.all([...this.endpoints.values()].map(ep => this.applyEncoding(ep)));
  }

  applyEncoding(ep) {
    ep.encodingQueue = ep.encodingQueue.then(() => this.applyEncodingNow(ep)).catch(error => {
      if (!this.closed) this.onError(`${tr("Настройка кодирования: ")}${error.message}`);
    });
    return ep.encodingQueue;
  }

  async applyEncodingNow(ep) {
    if (this.closed || !ep.pc.remoteDescription || ep.pc.signalingState !== 'stable') return;
    const transceivers = ep.pc.getTransceivers();
    for (let i = 0; i < transceivers.length; i++) {
      const { sender } = transceivers[i];
      if (!sender.track) continue;
      const {role,slot} = trackIdentity(i);
      const forwarded=slot!==this.selfSlot;
      const params = sender.getParameters();
      if (!params.encodings?.length) continue;
      const origin=forwarded ? this.endpoints.get(this.peers.find(p=>p.slot===slot)?.id)?.shareProfile : this;
      const limits=ep.quality?.limits(origin?.content || 'motion') || {height:0,fps:60,bitrate:Infinity};
      const ceiling=origin?.bitrate ?? 32000000;
      const wanted={
        maxBitrate:role==='screen'?Math.min(ceiling,limits.bitrate):role==='system'?192000:64000,
        priority:role==='voice'?'high':role==='screen' && limits.height?'low':'medium',
      };
      let changed=false;
      if(role==='screen'){
        wanted.maxFramerate=Math.min(origin?.fps ?? 60,limits.fps);
        wanted.scaleResolutionDownBy=this.scaleFor(ep,slot,sender.track,limits.height);
        const preference=!origin?'balanced':origin.content==='detail'?'maintain-resolution':'maintain-framerate';
        if(params.degradationPreference!==preference){params.degradationPreference=preference;changed=true;}
      }
      for(const encoding of params.encodings){
        for(const [key,value] of Object.entries(wanted)){
          if(encoding[key]!==value){encoding[key]=value;changed=true;}
        }
      }
      if(!changed)continue;
      try { await sender.setParameters(params); } catch (error) {
        // A disappearing sender during leave is benign. Actual parameter failures are surfaced.
        if (!this.closed && sender.track && ep.pc.connectionState !== 'closed') this.onError(`${tr("Ограничение битрейта не применено: ")}${error.message}`);
      }
    }
    this.restoreCameraStreams(ep);
  }

  restoreFileChannel(ep){
    if(!this.isHost || !this.files || ep.pc.connectionState!=='connected' || ep.pc.sctp?.state!=='connected')return;
    if(this.files.channels.has(ep.id)){
      if(this.files.bulk.has(ep.id))ep.fileRetries=0;
      return;
    }
    const now=Date.now();
    if((ep.fileRetries||0)>=3 || now<(ep.fileRetryAt||0))return;
    ep.fileRetries=(ep.fileRetries||0)+1;ep.fileRetryAt=now+6000;
    try{this.files.attach(ep.id,ep.pc.createDataChannel('link-files-v1'));}
    catch{ /* The next observation retries if SCTP is still connected. */ }
  }

  async collectStats() {
    if (this.closed) return;
    for (const ep of this.endpoints.values()) {
      this.restoreFileChannel(ep);
      const report = await ep.pc.getStats();
      if (this.closed || this.endpoints.get(ep.id) !== ep) continue;
      let sent = 0, received = 0, rtt = null, candidateType = '', timestamp = 0;
      const {samples:video,next}=videoSamples(report,ep.videoHistory);
      ep.videoHistory=next;
      const videos=video.filter(v=>v.direction==='in');
      if(this.isHost) for(const sample of videos){
        const identity=trackIdentity(Number(sample.mid));
        if(identity?.role==='screen' && identity.slot===ep.remoteSlot && sample.height>0 && this.inputHeights.get(identity.slot)!==sample.height){
          this.inputHeights.set(identity.slot,sample.height);
          for(const other of this.endpoints.values())if(other!==ep && other.viewHeight)this.applyEncoding(other);
        }
      }
      let protocol=null,relayProtocol=null,pairId=null;
      let localCandidates = 0, available = 0;
      const localTypes=new Set(),remoteTypes=new Set();
      report.forEach(s => {
        if (s.type === 'local-candidate'){localCandidates++;localTypes.add(s.candidateType);}
        if (s.type === 'remote-candidate')remoteTypes.add(s.candidateType);
        if (s.type === 'outbound-rtp') { sent += s.bytesSent || 0; timestamp = Math.max(timestamp, s.timestamp); }
        if (s.type === 'inbound-rtp') {
          received += s.bytesReceived || 0;
          timestamp = Math.max(timestamp, s.timestamp);
        }
        if (s.type === 'transport' && s.selectedCandidatePairId) {
          const pair = report.get(s.selectedCandidatePairId);
          if (pair) pairId=s.selectedCandidatePairId;
          rtt = pair?.currentRoundTripTime ?? null;
          const types=[pair?.remoteCandidateId,pair?.localCandidateId].map(id=>report.get(id)?.candidateType);
          candidateType=types.includes('relay')?'relay':types[0] || '';
          const local=report.get(pair?.localCandidateId);
          protocol=['udp','tcp'].includes(local?.protocol)?local.protocol:null;
          relayProtocol=['udp','tcp','tls'].includes(local?.relayProtocol)?local.relayProtocol:null;
          available=pair?.availableOutgoingBitrate || 0;
        }
      });
      if(ep.recovery && ep.pc.signalingState==='stable' && ep.pc.connectionState==='connected' &&
          ['connected','completed'].includes(ep.pc.iceConnectionState) &&
          Date.now()-ep.lastRestart>1800 && (this.isHost || ep.answeredAt>=ep.recoveryStarted))this.recovered(ep);
      const senders=ep.pc.getTransceivers();
      const audio=audioContinuity(report,ep.audioHistory || new Map(),new Map(senders.filter(t=>!this.watchBuffer.applied.get(t.receiver)).map(t=>[t.mid,t.receiver])));
      ep.audioHistory=audio.next;
      const screens=new Set(senders.filter(t=>t.sender.track?.kind==='video' && t.sender.track.readyState==='live').map(t=>t.mid));
      if(ep.quality && ep.pc.connectionState==='connected'){
        const outbound=video.filter(v=>v.direction==='out' && screens.has(v.mid) && (v.mbps>0 || v.sourceFps>0));
        const rough=audio.samples.some(a=>a.concealedPct>1.5) ||
          videos.some(v=>v.fractionLost>0.05 && v.mbps>0 && v.fps<12);
        if((rough || ep.reportedRough) && this.sendControl(ep.id,{kind:'playout-pressure',rough}))ep.reportedRough=rough;
        const changed=ep.quality.sample({pairId,available,rttMs:rtt===null?null:rtt*1000,active:outbound.length,
          video:outbound,receiverPressure:Date.now()<(ep.remotePressureUntil||0)});
        if(changed)await this.applyEncoding(ep);
      }
      const adaptive=ep.quality?.limits(this.content);
      const previous = this.statHistory.get(ep.id);
      const seconds = previous ? (timestamp - previous.timestamp) / 1000 : 0;
      this.statHistory.set(ep.id, { sent, received, timestamp });
      const inbound=inboundCounters(report);
      this.watchBuffer.alignOutput(ep,report,inbound);
      this.onStats({ peerId: ep.id, state: ep.pc.connectionState, rttMs: rtt === null ? null : Math.round(rtt * 1000),
        outgoingMbps: seconds > 0 ? Math.max(0, (sent - previous.sent) * 8 / seconds / 1e6) : 0,
        incomingMbps: seconds > 0 ? Math.max(0, (received - previous.received) * 8 / seconds / 1e6) : 0,
        candidateType, protocol, relayProtocol, available, video, videos, bitrateLimit:this.bitrate, fpsLimit:this.fps, localCandidates, inbound, sampledAt: new Date().toISOString(),
        audio:audio.samples,adaptiveHeight:adaptive?.height,adaptiveFps:adaptive?.fps,adaptiveRate:Number.isFinite(adaptive?.bitrate)?adaptive.bitrate:null,
        tcpFallback:!!ep.tcpFallback,routeAge:Date.now()-ep.createdAt,iceErrors:[...(ep.iceErrors || [])],localTypes:[...localTypes],remoteTypes:[...remoteTypes],chatState:ep.channel?.readyState || '—',
        sdpState:ep.pc.signalingState,remoteSdp:Boolean(ep.pc.remoteDescription),attempts:ep.restartCount,
        servers:(ep.pc.getConfiguration().iceServers || []).flatMap(s=>[].concat(s.urls)).map(u=>u.split(':')[0]),
        iceState: ep.pc.iceConnectionState, gatheringState: ep.pc.iceGatheringState });
    }
  }

  async removeEndpoint(id, slot) {
    const ep = this.endpoints.get(id);
    if (ep) {
      clearTimeout(ep.probeTimer);clearTimeout(ep.disconnectedTimer);
      clearTimeout(ep.connectionTimer);
      clearTimeout(ep.videoSourceRetry);
      this.files?.detach?.(id);ep.pc.ondatachannel=null;
      ep.pc.ontrack = null;
      ep.pc.onicecandidate = ep.pc.onicecandidateerror = null;
      ep.pc.onconnectionstatechange = ep.pc.oniceconnectionstatechange = null;
      ep.pc.close();
      this.endpoints.delete(id); this.inputHeights.delete(slot); this.publishViewHeights();
      this.statHistory.delete(id);
    }
    this.speakers.delete(id);
    if (this.isHost && Number.isInteger(slot)) {
      for (const role of ROLES) {
        this.rawTracks.delete(`${slot}:${role}`);this.tracks.delete(`${slot}:${role}`);
        this.onTrack({ slot, role, track: null });
        await this.forwardTrack(slot, role, null);
      }
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.statsTimer);
    this.watchBuffer.close();
    for (const ep of this.endpoints.values()) {
      clearTimeout(ep.probeTimer);clearTimeout(ep.disconnectedTimer);
      clearTimeout(ep.connectionTimer);
      clearTimeout(ep.videoSourceRetry);
      ep.pc.ontrack = ep.pc.onicecandidate = ep.pc.onicecandidateerror = ep.pc.onconnectionstatechange = ep.pc.oniceconnectionstatechange = null;
      ep.pc.close();
    }
    this.endpoints.clear();
    this.screenGroups.clear();
    this.voiceGroups.clear();
    this.videoSources.clear();
    this.rawTracks.clear();this.tracks.clear();this.files?.close();
    this.statHistory.clear();
  }
}
