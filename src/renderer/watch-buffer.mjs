// Viewer buffering in milliseconds; zero selects automatic synchronization. Longer targets
// allowed by WebRTC exceeded the screen-audio buffer in the release stress test.
export const watchBufferChoices = Object.freeze([0, 500, 1000, 2000]);

function latestSound(report) {
  let latest;
  for (const row of report.values()) {
    if (row.type!=='inbound-rtp' || row.kind!=='audio' || !Number.isFinite(row.jitterBufferDelay) ||
        !(row.jitterBufferEmittedCount>0)) continue;
    // A replaced SSRC can still be listed with its lifetime counters.
    if (!latest || (row.lastPacketReceivedTimestamp??0)>(latest.lastPacketReceivedTimestamp??0)) latest=row;
  }
  return latest;
}

export class WatchBuffer {
  constructor(outputDelay = null) {
    this.outputDelay = outputDelay;
    this.preferences = new Map();
    this.applied = new Map();
    this.selected = null;
    this.timing = null;
  }

  select(peerId, milliseconds) {
    if (milliseconds !== undefined && !watchBufferChoices.includes(milliseconds)) throw new RangeError('Invalid viewing buffer');
    this.selected = peerId || null;
    if (!peerId || milliseconds === undefined) return;
    if (milliseconds) this.preferences.set(peerId, milliseconds);
    else this.preferences.delete(peerId);
  }

  release(receiver) {
    // A closed native receiver can disappear between roster and track events.
    try { receiver.jitterBufferTarget = null; } catch {}
    this.applied.delete(receiver);
  }

  apply(receiver, milliseconds) {
    if (this.applied.get(receiver) === milliseconds) return;
    receiver.jitterBufferTarget = milliseconds;
    this.applied.set(receiver, milliseconds);
  }

  stopTiming() {
    clearTimeout(this.timing?.timer);
    this.timing=null;
  }

  resetAlignment() {
    const route=this.alignment;
    if (route?.target != null && !route.requested) this.release(route.video);
    this.alignment=null;
  }

  // Chromium synchronizes RTP clocks before a system track enters our mixer.
  // Read the existing stats sample; a viewer never adjusts a forwarding receiver.
  alignOutput(endpoint, report, inbound) {
    const route=this.alignment;
    if (!route || route.endpoint!==endpoint || (route.requested ? !this.timing?.settled : this.timing)) return;
    const output=this.outputDelay(route.peerId);
    const skew=inbound.find(row=>row.slot===route.slot)?.estimatedScreenSkewMs;
    let video,audio;
    for (const row of report.values()) {
      if (row.type!=='inbound-rtp') continue;
      if (row.mid===route.videoMid && (!video || row.lastPacketReceivedTimestamp>video.lastPacketReceivedTimestamp)) video=row;
      if (row.mid===route.audioMid && (!audio || row.lastPacketReceivedTimestamp>audio.lastPacketReceivedTimestamp)) audio=row;
    }
    const previous=route.previous;
    route.previous={video,audio};
    const release=()=>{
      if (route.target!=null) {
        if (route.requested) this.apply(route.video,route.requested);
        else this.release(route.video);
      }
      route.target=null;
      route.missing=0;
    };
    if (!Number.isFinite(output) || !video || !audio) {
      release();
      route.previous=null;
      return;
    }
    if (!previous?.video || !previous.audio ||
        audio.ssrc!==previous.audio.ssrc || video.ssrc!==previous.video.ssrc ||
        !(audio.bytesReceived>previous.audio.bytesReceived && video.framesDecoded>previous.video.framesDecoded)) {
      release();
      return;
    }
    if (!Number.isFinite(skew)) {
      // A single missing clock can occur between RTCP reports. A persistent
      // failure falls back to native synchronization.
      if (++route.missing>=2) release();
      return;
    }
    route.missing=0;
    const interval=(current,old,key)=>1000*(current[key]-old[key])/
      (current.jitterBufferEmittedCount-old.jitterBufferEmittedCount);
    const actual=interval(video,previous.video,'jitterBufferDelay');
    const videoMinimum=interval(video,previous.video,'jitterBufferMinimumDelay');
    const minimum=Math.max(interval(audio,previous.audio,'jitterBufferMinimumDelay'),videoMinimum);
    if (!Number.isFinite(actual) || !Number.isFinite(minimum) || minimum<0) { release(); return; }
    // A native synchronizer can increase both delays. Bound the correction to
    // the network-only minimum, independently of any buffer our hint has added.
    const frameMs=1000/Math.max(10,video.framesPerSecond||30);
    const extra=Math.min(180,output+2*frameMs);
    const ceiling=route.requested ? route.requested+extra : Math.min(350,minimum+extra);
    const error=output-skew;
    if (Math.abs(error)<=10 && !(route.target>ceiling)) return;
    if (route.target==null && error<=0) return;
    const base=route.target??(route.requested||actual);
    const target=Math.round(Math.min(ceiling,base+Math.max(-32,Math.min(32,error*.65))));
    if (target<=(route.requested||videoMinimum)) { release(); return; }
    if (target===route.target) return;
    try {
      if (route.requested) this.apply(route.video,target);
      else route.video.jitterBufferTarget=target;
      route.target=target;
    } catch { release(); }
  }

  async followAudio(timing) {
    const {video,audio,requested}=timing;
    // During a downward step Chromium can discard hundreds of milliseconds
    // between normal stats updates. Poll more often only while following it.
    let interval=100;
    try {
      const report=await audio.getStats();
      if (this.timing!==timing) return;
      const row=latestSound(report);
      const old=timing.previous;
      timing.previous=row;
      let target;
      if (row && old && row.id===old.id && row.ssrc===old.ssrc &&
          row.jitterBufferEmittedCount>old.jitterBufferEmittedCount && row.jitterBufferDelay>=old.jitterBufferDelay &&
          row.bytesReceived>old.bytesReceived) {
        const emitted=row.jitterBufferEmittedCount-old.jitterBufferEmittedCount;
        const actual=Math.round(1000*(row.jitterBufferDelay-old.jitterBufferDelay)/emitted);
        // Chromium fills and drains the Opus buffer gradually. A step on the
        // video receiver takes effect immediately and can put the picture seconds away.
        const minimum=1000*(row.jitterBufferMinimumDelay-old.jitterBufferMinimumDelay)/emitted;
        const nearTarget=Math.abs(actual-requested)<=80 || (!requested && actual<=minimum+80);
        timing.settled=requested>0 && nearTarget;
        if (!timing.settled && this.alignment) this.alignment.target=null;
        target=nearTarget ? (this.alignment?.target??requested) : Math.min(timing.ceiling,actual);
        if (nearTarget) interval=500;
        timing.lastMedia=performance.now();
      } else if (performance.now()-timing.lastMedia>1000) {
        timing.settled=false;
        if (this.alignment) this.alignment.target=null;
        target=requested; // A screen can be shared without any sound.
        interval=500;
      }
      if (target!==undefined) {
        if (!requested && target===0) {
          this.release(video);
          this.stopTiming();
          return;
        }
        this.apply(video,target);
      }
    } catch {
      if (this.timing!==timing) return;
      try { if (requested) this.apply(video,requested); else this.release(video); } catch {}
      this.stopTiming();
      return;
    }
    timing.timer=setTimeout(()=>this.followAudio(timing),interval);
  }

  close() {
    this.stopTiming();
    this.resetAlignment();
    for (const receiver of this.applied.keys()) this.release(receiver);
    this.preferences.clear();
    this.selected=null;
  }

  update(room) {
    const peer = room.peers.find(p => p.id === this.selected && p.id !== room.session.selfId);
    const requested = peer ? this.preferences.get(peer.id) || 0 : 0;
    // On the host, an incoming guest track is also the input to another
    // participant's sender. Reset it before that forwarding route is attached.
    const forwarding = Boolean(peer && room.isHost && room.peers.length > 2);
    const ep = peer && room.endpoints.get(room.isHost ? peer.id : room.session.hostId);
    const tracks = ep?.pc.getTransceivers();
    const first = peer ? peer.slot * 3 : -1;
    const pair = tracks && [tracks[first + 1]?.receiver, tracks[first + 2]?.receiver];
    let available = Boolean(pair?.every(receiver => receiver && 'jitterBufferTarget' in receiver));
    const align=this.outputDelay && available && !forwarding;
    const prior=this.alignment;
    if (!align || !prior || prior.requested!==requested || prior.peerId!==peer.id || prior.endpoint!==ep || prior.video!==pair[0] ||
        prior.audio!==pair[1] || prior.videoMid!==tracks[first+1].mid || prior.audioMid!==tracks[first+2].mid) {
      this.resetAlignment();
      if (align) this.alignment={endpoint:ep,peerId:peer.id,slot:peer.slot,requested,video:pair[0],audio:pair[1],
        videoMid:tracks[first+1].mid,audioMid:tracks[first+2].mid,missing:0,target:null};
    }
    const timing=this.timing;
    if (timing && available && !forwarding && timing.video===pair[0] && timing.audio===pair[1] && timing.requested===requested)
      return {requested,forwarding,available};
    this.stopTiming();
    for (const receiver of this.applied.keys()) {
      if (!available || forwarding || !pair.includes(receiver)) this.release(receiver);
    }
    if (available && !forwarding) {
      try {
        const [video,audio]=pair;
        const ceiling=Math.max(requested,this.applied.get(video)||0);
        if (requested) this.apply(audio,requested);
        else if (this.applied.has(audio)) this.release(audio);
        if (ceiling && typeof audio.getStats==='function') {
          this.timing={video,audio,requested,ceiling,lastMedia:performance.now(),
            previous:timing?.audio===audio ? timing.previous : undefined};
          this.followAudio(this.timing);
        } else if (requested) this.apply(video,requested);
        else if (this.applied.has(video)) this.release(video);
      } catch {
        this.stopTiming();
        for (const receiver of this.applied.keys()) this.release(receiver);
        available = false;
      }
    }
    return {requested, forwarding, available};
  }

  prune(peers) {
    for (const id of this.preferences.keys()) if (!peers.some(p => p.id === id)) this.preferences.delete(id);
  }
}
