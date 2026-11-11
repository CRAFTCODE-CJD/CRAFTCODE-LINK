'use strict';
const assert=require('node:assert/strict');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function counters(p){
  return p.evaluate(async()=>{
    const pc=window.qaPeers[0],r=await pc.getStats(),rows=[...r.values()];
    const v=rows.find(x=>x.type==='inbound-rtp' && x.mid==='1'),a=rows.find(x=>x.type==='inbound-rtp' && x.mid==='0');
    return {time:performance.now(),frames:v?.framesDecoded||0,bytes:v?.bytesReceived||0,width:v?.frameWidth||0,height:v?.frameHeight||0,
      freezes:v?.totalFreezesDuration||0,samples:a?.totalSamplesReceived||0,concealed:a?.concealedSamples||0,
      lost:a?.packetsLost||0,buffer:a?.jitterBufferDelay||0,emitted:a?.jitterBufferEmittedCount||0};
  });
}
async function period(p,ms){
  const a=await counters(p);await delay(ms);return diff(a,await counters(p));
}
function diff(a,b){
  return {height:b.height,frames:b.frames-a.frames,fps:+((b.frames-a.frames)*1000/(b.time-a.time)).toFixed(1),
    videoBytes:b.bytes-a.bytes,freezeSeconds:+(b.freezes-a.freezes).toFixed(2),voiceSamples:b.samples-a.samples,
    concealedPct:+(100*(b.concealed-a.concealed)/Math.max(1,b.samples-a.samples)).toFixed(2),
    playoutMs:+(1000*(b.buffer-a.buffer)/Math.max(1,b.emitted-a.emitted)).toFixed(1)};
}
exports.run=async function(host,guest,nat){
  const mbps=Number(process.env.CCLINK_QA_WEAK_MBPS || 0.95);
  if(process.argv.includes('--persistent-latency'))await host.evaluate(async()=>{
    const {LinkQuality}=await import('./link-quality.mjs'),original=LinkQuality.prototype.sample;
    window.qaAdapt=[];
    LinkQuality.prototype.sample=function(input){
      const result=original.call(this,input);
      if(input.active)window.qaAdapt.push({level:this.level,rtt:Math.round(input.rttMs),floor:Math.round(this.baseRtt),
        estimate:Math.round(input.available/1000),reason:input.video[0]?.reason,loss:input.video[0]?.fractionLost,
        pressure:input.receiverPressure,streak:this.stableRtts?.length});
      return result;
    };
  });
  assert(Number.isFinite(mbps) && mbps>0 && mbps<=32,'invalid link capacity');
  await delay(4500);const clear=await period(guest,6000);
  const latency=process.argv.includes('--persistent-latency')?60:0;
  nat.shape(latency?{mbps,latencyMs:latency}:{mbps});const start=await counters(guest);
  await delay(14000);const mid=await counters(guest);await delay(12000);const end=await counters(guest);
  const weak=diff(start,end),settled=diff(mid,end);
  const constrained=await host.evaluate(()=>window.qaPeers[0].getTransceivers()[1].sender.getParameters().encodings[0]);
  nat.shape(latency?{latencyMs:latency}:null);
  const recovery=await period(guest,latency?80000:34000);
  const restored=await host.evaluate(()=>window.qaPeers[0].getTransceivers()[1].sender.getParameters().encodings[0]);
  if(latency){
    const path=await host.evaluate(async()=>{
      const stats=await window.qaPeers[0].getStats();
      const t=[...stats.values()].find(r=>r.type==='transport' && r.selectedCandidatePairId);
      const pair=stats.get(t.selectedCandidatePairId);
      return {rttMs:1000*pair.currentRoundTripTime,available:pair.availableOutgoingBitrate};
    });
    console.log('TRACE',JSON.stringify(await host.evaluate(()=>window.qaAdapt.filter((_,i)=>i%3===0))));
    console.log('HIGH_RTT',JSON.stringify({path,constrained,restored}));
    assert(path.rttMs>=100, 'Recovered path must retain the added latency');
    assert((restored.maxBitrate??Infinity)>(constrained.maxBitrate??Infinity),'Sender cap did not increase after recovery');
  }
  console.log('LINK',JSON.stringify({mbps,clear,weak,settled,recovery,constrained:constrained.scaleResolutionDownBy,restored:restored.scaleResolutionDownBy,dropped:nat.stats().dropped}));
  for(const slice of [clear,weak,recovery])assert(slice.frames>0 && slice.voiceSamples>0 && slice.videoBytes>0);
  assert(nat.stats().dropped>0);
  if(!process.env.CCLINK_QA_PRODUCT)assert(restored.scaleResolutionDownBy<=constrained.scaleResolutionDownBy);
};
