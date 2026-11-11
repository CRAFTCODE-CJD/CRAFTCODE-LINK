// Test-only generators. A frequency step and a binary video timestamp encode the
// same wall clock, allowing observation after decoding on separate renderer pages.
import { RoomMedia, inboundCounters } from '../src/renderer/peer.mjs';
import { AudioMixer } from '../src/renderer/audio.mjs';
import { attachVideo } from '../src/renderer/player-controls.mjs';

const id = new URL(location.href).searchParams.get('id');
const clock = () => Date.now();
const frames = new Map(), audios = new Map(), failures = [];
const generatorTimers=[], generatedTracks=[];
const mixer = new AudioMixer();
const peers = ['host','g1','g2'].map((id,slot)=>({id,slot}));
let room, ctx, player, selectedSlot;
let timingControls=false, videoClockBias=0, soundDelay;
const pilotBins=[4,7,10,13], pulseStates=new Map();
function pulseAt(now) { return now%1500<350 ? Math.floor(now/1500)%4 : -1; }
function stampVideo() {
  const c = document.createElement('canvas'); c.width=640;c.height=360;
  const g=c.getContext('2d');
  function draw() {
    const now=clock(),code=Math.floor((now-videoClockBias)/10)%2048;
    g.fillStyle='#263842';g.fillRect(0,0,c.width,c.height);
    for(let i=0;i<11;i++){g.fillStyle=code & (1<<i)?'white':'black';g.fillRect(i*44,0,44,80);}
    if (timingControls) {
      const pulse=pulseAt(now);
      for(let i=0;i<4;i++){g.fillStyle=i===pulse?'white':'black';g.fillRect(500+i*33,0,30,80);}
    }
    for(let j=0;j<8;j++){g.fillStyle='hsl('+j*43+' 70% 55%)';g.fillRect((now/8+j*63)%630,85+j*28,60,23);}
  }
  draw();generatorTimers.push(setInterval(draw,32));
  const track=c.captureStream(30).getVideoTracks()[0];generatedTracks.push(track);return track;
}
function stampAudio(role) {
  const dest=ctx.createMediaStreamDestination(),osc=ctx.createOscillator(),gain=ctx.createGain();
  let input=dest,pilot,pilotGain;
  if (timingControls && role==='system') {
    soundDelay=ctx.createDelay(2);soundDelay.connect(dest);input=soundDelay;
    pilot=ctx.createOscillator();pilotGain=ctx.createGain();pilot.connect(pilotGain).connect(input);pilot.start();
  }
  gain.gain.value=.15;osc.connect(gain).connect(input);
  function set(){
    const now=clock();osc.frequency.value=400+64*(Math.floor(now/100)%96);
    if(pilot){
      const pulse=pulseAt(now);
      if(pulse>=0)pilot.frequency.value=pilotBins[pulse]*ctx.sampleRate/2048;
      pilotGain.gain.value=pulse>=0?.07:0;
    }
  }
  set();generatorTimers.push(setInterval(set,8));osc.start();
  const track=dest.stream.getAudioTracks()[0];generatedTracks.push(track);return track;
}
async function got({slot,role,track}) {
  if(role==='screen'){
    if (player) {
      if (slot === selectedSlot) attachVideo(player,track);
      return;
    }
    if(!track)return;
    const video=document.createElement('video');video.autoplay=true;video.muted=true;document.body.append(video);
    frames.set(slot,video);attachVideo(video,track);
  }else{
    if(!track)return;
    await mixer.attach(String(slot),role,track);
    const a=mixer.context.createAnalyser();a.fftSize=2048;a.smoothingTimeConstant=0;
    mixer.sources.get(slot+':'+role).gain.connect(a);audios.set(slot+':'+role,a);
  }
}
export async function init(port, count, sendMedia, pulses=false) {
  timingControls=pulses;
  ctx=new AudioContext({sampleRate:48000});await ctx.resume();await mixer.start();
  const permission=await navigator.mediaDevices.getUserMedia({audio:true});permission.getTracks().forEach(t=>t.stop());
  room=new RoomMedia({session:{selfId:id,hostId:'host',role:id==='host'?'host':'guest',internet:true},
    screenOutputDelay:peerId=>mixer.screenOutputDelay(String(peers.find(p=>p.id===peerId).slot)),
    peerFactory:()=>new RTCPeerConnection({iceServers:port?[{urls:'stun:127.0.0.1:'+port}]:[],bundlePolicy:'max-bundle'}),
    onTrack:x=>got(x).catch(e=>failures.push(String(e))),onError:x=>failures.push(x),
    sendSignal(msg){
      const d=msg.data;
      if(port && d.type==='ice'&&!/ typ srflx /.test(d.candidate.candidate))return;
      if(port && d.sdp)d.sdp=d.sdp.replace(/^a=candidate:[^\r\n]* typ (?!srflx)[^\r\n]*\r?\n/gm,'');
      window.qaBridge.signal(msg);
    }});
  window.qaBridge.onSignal(({from,data})=>room.acceptSignal(from,data));
  await room.updatePeers([peers.find(p=>p.id===id)]);
  if(sendMedia){await room.setLocalTrack('voice',stampAudio('voice'));await room.setLocalTrack('system',stampAudio('system'));await room.setLocalTrack('screen',stampVideo());}
}
export function calibration({legacyStampMs=0,delayAudioMs=0}) {
  if(!timingControls || !soundDelay) throw Error('Timing controls unavailable');
  videoClockBias=legacyStampMs;soundDelay.delayTime.value=delayAudioMs/1000;
}
export function roster(count) {return room.updatePeers(peers.slice(0,count));}
export function watch(source,ms) {return room.watch(source,ms);}
export function targets() {
  return Array.from(room.endpoints.values(),ep=>ep.pc.getTransceivers().map(t=>t.receiver.jitterBufferTarget));
}
export async function stats(slot) {
  const ep=room.endpoints.get(id==='host'?peers[slot].id:'host'),report=await ep.pc.getStats(),out={};
  for(const r of report.values())if(r.type==='inbound-rtp'&&Math.floor(Number(r.mid)/3)===slot){
    const role=['voice','screen','system'][Number(r.mid)%3];
    const pair=report.get(report.get(r.transportId)?.selectedCandidatePairId);
    out[role]={rttMs:Number.isFinite(pair?.currentRoundTripTime)?Math.round(pair.currentRoundTripTime*1000):null,
      jitterMs:Number.isFinite(r.jitter)?Math.round(r.jitter*1000):null,lost:r.packetsLost,
      bytes:r.bytesReceived,emitted:r.jitterBufferEmittedCount,delay:r.jitterBufferDelay,
      target:r.jitterBufferTargetDelay,frames:r.framesDecoded,freezes:r.totalFreezesDuration || 0,concealed:r.concealedSamples || 0,samples:r.totalSamplesReceived};
  }
  if (out.screen) {
    out.screen.playoutSkewMs=inboundCounters(report).find(r=>r.slot===slot)?.estimatedScreenSkewMs ?? null;
    out.screen.targetMs=ep.pc.getTransceivers()[slot*3+1]?.receiver.jitterBufferTarget??null;
  }
  return out;
}
const sampleCanvas=document.createElement('canvas');sampleCanvas.width=640;sampleCanvas.height=1;
const scan=sampleCanvas.getContext('2d',{willReadFrequently:true});
function audioAge(key,now,pilot) {
  const a=audios.get(key);if(!a)return null;
  const bins=new Float32Array(a.frequencyBinCount);a.getFloatFrequencyData(bins);
  let peak=pilot?16:0;
  if(pilot){
    const strongest=pilotBins.reduce((best,bin)=>bins[bin]>bins[best]?bin:best,pilotBins[0]);
    pilot.audio=bins[strongest]>-42?pilotBins.indexOf(strongest):-1;
  }
  for(let i=peak+1;i<bins.length;i++)if(bins[i]>bins[peak])peak=i;
  if(bins[peak]<-55)return null;
  const tone=Math.round((peak*mixer.context.sampleRate/a.fftSize-400)/64);
  if(tone<0||tone>=96)return null;
  return ((now-tone*100+9600)%9600)-50;
}
// Pair a visible flash with a low tone of the same identity. This reference
// measures arrival at the player without decoding either timestamp or consulting RTP.
function pairPulse(slot,pilot,now) {
  const state=pulseStates.get(slot);
  if(!state || now-state.sample>180) {
    pulseStates.set(slot,{...pilot,sample:now,pending:new Map()});
    return null;
  }
  state.sample=now;
  let skew=null;
  for(const side of ['audio','video']){
    const tag=pilot[side],previous=state[side];state[side]=tag;
    if(tag<0 || tag===previous)continue;
    const pair=state.pending.get(tag);
    if(pair && pair.side!==side && now-pair.time<2600){
      skew=Math.round(side==='video'?now-pair.time:pair.time-now);state.pending.delete(tag);
    }else state.pending.set(tag,{side,time:now});
  }
  return skew;
}
export function canObserve(slot) {
  return Boolean(frames.get(slot)?.videoWidth && audios.has(slot+':voice') && audios.has(slot+':system'));
}
export async function observe(slot,ms) {
  const readings=[],pulses=[],v=player ? (slot === selectedSlot ? player : null) : frames.get(slot);
  if(!v)throw Error('No live screen');
  const start=await stats(slot);
  let lastCode,gap=0,at=performance.now(),lastChange=at;
  const until=at+ms;
  while(performance.now()<until){
    await new Promise(r=>setTimeout(r,45));
    if (!v.videoWidth || v.readyState<v.HAVE_CURRENT_DATA) continue;
    const now=clock();scan.drawImage(v,0,0,v.videoWidth,Math.max(1,v.videoHeight/8),0,0,640,1);
    const pixels=scan.getImageData(0,0,640,1).data;
    let code=0;for(let i=0;i<11;i++)if(pixels[(i*44+22)*4]>128)code+=1<<i;
    const video=(now-code*10+20480)%20480;
    const pilot=timingControls?{audio:-1,video:-1}:null;
    const voice=audioAge(slot+':voice',now),system=audioAge(slot+':system',now,pilot);
    if(pilot){
      for(let i=0;i<4;i++)if(pixels[(515+i*33)*4]>128)pilot.video=i;
      const difference=pairPulse(slot,pilot,performance.now());
      if(difference!==null)pulses.push(difference);
    }
    if(voice!==null && system!==null)readings.push({video,voice,system,skew:video-system});
    if(lastCode!==code){gap=Math.max(gap,performance.now()-lastChange);lastChange=performance.now();lastCode=code;}
  }
  const end=await stats(slot),out={samples:readings.length,longestPictureMs:Math.round(Math.max(gap,performance.now()-lastChange,0)),issues:[...failures]};
  if(timingControls)out.pulseSkewMs=pulses;
  for(const k of ['voice','system','video','skew']){
    const list=readings.map(r=>r[k]).sort((a,b)=>a-b);out[k+'Ms']=list.length?Math.round(list[Math.floor(list.length/2)]):null;
  }
  out.roles={};
  for(const r of Object.keys(start)){
    const a=start[r],b=end[r],n=b.emitted-a.emitted;
    out.roles[r]={rttMs:b.rttMs,jitterMs:b.jitterMs,lost:Number.isFinite(b.lost)&&Number.isFinite(a.lost)?b.lost-a.lost:null,
      ...(r==='screen'?{playoutSkewMs:b.playoutSkewMs,targetMs:b.targetMs}:{}),bytes:b.bytes-a.bytes,frames:r==='screen'?b.frames-a.frames:undefined,bufferMs:n?Math.round(1000*(b.delay-a.delay)/n):null,
      freezeSeconds:r==='screen'?+(b.freezes-a.freezes).toFixed(2):undefined,concealed:r==='screen'?undefined:b.concealed-a.concealed};
  }return out;
}

export function selectShow(slot, milliseconds) {
  if (!player) {
    player=document.createElement('video');player.autoplay=true;player.muted=true;document.body.append(player);
    for (const video of frames.values()) { video.pause(); video.srcObject=null; video.remove(); }
    frames.clear();
  }
  selectedSlot=slot;
  for (const source of room.peers) mixer.setSetting(String(source.slot),'system',{active:source.slot===slot});
  attachVideo(player,room.getTrack(slot,'screen'));
  return watch(peers[slot].id, milliseconds);
}

export async function finishCall() {
  room.close();
  await mixer.close();
  for (const timer of generatorTimers) clearInterval(timer);
  for (const track of generatedTracks) track.stop();
  for (const video of frames.values()) { video.pause(); video.srcObject=null; video.remove(); }
  if (player) { player.pause(); player.srcObject=null; player.remove(); player=null; }
  frames.clear(); audios.clear();
  await ctx.close();
  return {endpoints:room.endpoints.size, mixerSources:mixer.sources.size, generatedLive:generatedTracks.filter(t=>t.readyState==='live').length};
}
