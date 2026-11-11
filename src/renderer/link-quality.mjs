// A ceiling on top of Chromium's congestion controller. Enter only on evidence from
// active media; leave room for Opus and retransmissions. Probe upward on clean samples
// even when the encoder is capped and the bandwidth estimate cannot grow on its own.
const levels = [
  { budget:780000, rate:430000, motion:[360,20], detail:[540,10] },
  { budget:1500000, rate:740000, motion:[540,24], detail:[720,12] },
  { budget:3000000, rate:1550000, motion:[720,30], detail:[1080,15] },
  { budget:5200000, rate:3000000, motion:[900,40], detail:[1440,20] },
];
export class LinkQuality {
  constructor(){
    this.level=levels.length;this.bad=0;this.good=0;this.cpu=false;this.cpuCount=0;this.cpuGood=0;
  }
  observeRoute(pairId) {
    if (!pairId || pairId === this.pairId) return;
    this.pairId = pairId;
    this.baseRtt = undefined;
    this.good = this.bad = 0;
    this.stableRtts = [];
    // Keep the sender ceiling until the new path has delivered clean samples.
  }

  sample({available,rttMs,video,active,receiverPressure=false,pairId}){
    this.observeRoute(pairId);
    const before=this.level,oldCpu=this.cpu;
    if(!active || !video.length){
      this.level=levels.length;this.cpu=false;this.good=this.bad=this.cpuCount=this.cpuGood=0;this.stableRtts=[];
      return this.level!==before || this.cpu!==oldCpu;
    }
    if(Number.isFinite(rttMs))this.baseRtt=Math.min(this.baseRtt??rttMs,rttMs);
    const loss=video.some(v=>v.fractionLost>=0.04);
    const slow=video.some(v=>v.sourceFps>=12 && Number.isFinite(v.fps) && v.fps<0.65*v.sourceFps);
    const cpu=slow && video.some(v=>v.reason==='cpu');
    this.cpuCount=cpu?this.cpuCount+1:0;this.cpuGood=cpu?0:this.cpuGood+1;
    if(this.cpuCount>=3)this.cpu=true;
    if(this.cpuGood>=5)this.cpu=false;
    const budget=available>0?(available*.82-84000)/active:Infinity;
    let wanted=levels.findIndex(v=>budget<v.budget);
    if(wanted<0)wanted=levels.length;
    // A VPN can change the network below the existing ICE pair. Relearn the
    // RTT floor only after sustained headroom and clean, consistently higher RTT.
    let queued=Number.isFinite(rttMs) && rttMs>(this.baseRtt??rttMs)+85;
    const headroom = available > 0 && budget > (levels[this.level]?.budget ?? levels.at(-1).budget);
    if (queued && headroom && !loss && !receiverPressure && video.every(v=>(v.reason==='none' || v.reason==='bandwidth') && v.fps>0)) {
      this.stableRtts ??= [];
      this.stableRtts.push(rttMs);
      if (this.stableRtts.length >= 8) {
        const floor = Math.min(...this.stableRtts);
        if (Math.max(...this.stableRtts) - floor <= Math.max(20, floor * 0.15)) {
          this.baseRtt = floor;
          queued = false;
          this.stableRtts = [];
        } else this.stableRtts.shift();
      }
    } else this.stableRtts = [];
    const pressured=receiverPressure || loss || queued || video.some(v=>v.reason==='bandwidth');
    if(receiverPressure && (loss || queued || slow))wanted=Math.min(wanted,Math.max(0,this.level-2));
    else if(loss && (queued || slow))wanted=Math.min(wanted,Math.max(0,this.level-1));
    if(pressured && wanted<this.level){
      this.good=0;this.bad+=receiverPressure && loss?2:1;
      if(this.bad>=2){this.level=wanted;this.bad=0;}
    }else{
      this.bad=0;
      const clean=!receiverPressure && !loss && !queued && !cpu;
      this.good=clean?this.good+1:0;
      if(this.level<levels.length && this.good>=(wanted>this.level?3:7)){
        this.level++;this.good=0;
      }
    }
    return before!==this.level || oldCpu!==this.cpu;
  }
  limits(content){
    const level=levels[this.level];
    const [height,fps]=level?.[content==='detail'?'detail':'motion'] || [0,60];
    return {height,fps:this.cpu?Math.min(30,fps):fps,bitrate:level?.rate??Infinity};
  }
}

// WebRTC's own jitter buffer remains in control. Request a small playout floor only
// when measurable non-silent concealment coincides with jitter, then release it.
export function audioContinuity(report,history,receivers){
  const next=new Map(),samples=[];
  for(const s of report.values()){
    if(s.type!=='inbound-rtp' || s.kind!=='audio' || !/^\d+$/.test(s.mid) || !s.totalSamplesReceived)continue;
    const concealed=s.concealedSamples||0,silent=s.silentConcealedSamples||0;
    const record=history.get(s.id);
    const previous=record && record.ssrc===s.ssrc && s.totalSamplesReceived>=record.total &&
      concealed>=record.concealed && silent>=record.silent ? record : null;
    const count=previous ? s.totalSamplesReceived-previous.total : 0;
    const pct=count>0?Math.min(100,100*Math.max(0,concealed-silent-(previous.concealed-previous.silent))/count):null;
    const emitted=s.jitterBufferEmittedCount,delay=s.jitterBufferDelay;
    const bufferMs=previous && Number.isFinite(delay) && Number.isFinite(previous.delay) &&
      emitted>previous.emitted && delay>=previous.delay ? 1000*(delay-previous.delay)/(emitted-previous.emitted) : null;
    const jitter=(s.jitter||0)*1000,rough=pct!==null && pct>0.6 && jitter>12;
    const bad=rough?(previous?.bad||0)+1:0,good=count>0 && !rough?(previous?.good||0)+1:0;
    const receiver=receivers.get(s.mid);
    if(receiver && 'jitterBufferTarget' in receiver){
      const floor=Number(s.mid)%3===0?60:80;
      let desired=receiver.jitterBufferTarget;
      if(good>=5 || bufferMs>floor*1.75)desired=null;
      else if(bad>=2 && bufferMs!==null && bufferMs<floor)desired=floor;
      if(desired!==receiver.jitterBufferTarget)try{receiver.jitterBufferTarget=desired;}catch{}
    }
    next.set(s.id,{ssrc:s.ssrc,total:s.totalSamplesReceived,concealed,silent,emitted,delay,bad,good});
    samples.push({mid:s.mid,concealedPct:pct,jitterMs:jitter,bufferMs});
  }
  return {next,samples};
}
