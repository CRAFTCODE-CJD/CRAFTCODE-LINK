// Receiver counters accumulate over the stream lifetime. Keep only a minute of
// samples per inbound video SSRC; discard the baseline after sleep or a reset.
function recentReception(s, previous) {
  const sample = {time:s.timestamp, received:s.packetsReceived, lost:s.packetsLost,
    freezes:s.freezeCount, duration:s.totalFreezesDuration, frames:s.framesDecoded, ssrc:s.ssrc};
  let window = previous?.window ?? [];
  const last = window.at(-1);
  if (last && (sample.ssrc !== last.ssrc || sample.time < last.time || sample.time - last.time > 10000 ||
      sample.frames < last.frames || sample.received < last.received || sample.freezes < last.freezes ||
      sample.duration < last.duration)) window = [];
  window = window.filter(row => row.time >= sample.time - 60000);
  const first = window[0];
  if (!first || sample.time - window.at(-1).time >= 1000) window.push(sample);
  if (!first || sample.time <= first.time) return {window, recent:null};
  const diff = key => Number.isFinite(sample[key]) && Number.isFinite(first[key])
    ? Math.max(0,sample[key]-first[key]) : null;
  const lost = diff('lost'), received = diff('received');
  const recent = {seconds:(sample.time-first.time)/1000, lost,
    lossPct:lost !== null && received !== null && lost+received > 0 ? 100*lost/(lost+received) : null,
    freezes:diff('freezes'), freezeSeconds:diff('duration')};
  return {window,recent};
}

// Keep source, encoded and decoded rates separate. Counter deltas include a frozen interval.
export function videoSamples(report, history) {
  const samples=[];
  const next=new Map();
  const nonnegative=value=>Number.isFinite(value)&&value>=0?value:null;
  for(const s of report.values()){
    if(s.kind!=='video'||!['inbound-rtp','outbound-rtp'].includes(s.type)||!/^\d+$/.test(s.mid))continue;
    const outbound=s.type==='outbound-rtp';
    const frames=outbound?s.framesEncoded:s.framesDecoded;
    const bytes=outbound?s.bytesSent:s.bytesReceived;
    if(!frames && !bytes)continue;
    const record=history.get(s.id);
    const reset=record && (frames<record.frames || bytes<record.bytes);
    const continuous=record && record.ssrc===s.ssrc && !reset && s.timestamp>=record.time &&
      s.timestamp-record.time<=10000;
    const prev=continuous ? record : undefined;
    const feedback=outbound?report.get(s.remoteId):s;
    // A remote-inbound timestamp is the arrival time of a receiver report.
    // Polling getStats again does not make that packet-loss observation new.
    const feedbackTime=feedback?.timestamp;
    const freshFeedback=outbound && Number.isFinite(feedbackTime) &&
      feedbackTime<=s.timestamp && s.timestamp-feedbackTime<=10000 &&
      (record?.feedbackTime===undefined || record.ssrc!==s.ssrc || feedbackTime>record.feedbackTime);
    const work=outbound?s.totalEncodeTime:s.totalDecodeTime;
    const emitted=s.jitterBufferEmittedCount,delay=s.jitterBufferDelay;
    const bufferMs=prev && emitted>prev.emitted && delay>=prev.delay
      ? 1000*(delay-prev.delay)/(emitted-prev.emitted) : null;
    const {window,recent} = outbound ? {} : recentReception(s,prev);
    next.set(s.id,{bytes,frames,work,emitted,delay,window,ssrc:s.ssrc,time:s.timestamp,
      feedbackTime:outbound ? (feedbackTime ?? prev?.feedbackTime) : undefined,lost:s.packetsLost,received:s.packetsReceived});
    const workMs=prev && frames>prev.frames && Number.isFinite(prev.work) && Number.isFinite(work) && work>=prev.work
      ? (work-prev.work)*1000/(frames-prev.frames):null;
    const seconds=prev?(s.timestamp-prev.time)/1000:0;
    const delta=(value,old)=>seconds>0&&Number.isFinite(value)&&Number.isFinite(old)&&value>=old?(value-old)/seconds:null;
    const rate=delta(bytes,prev?.bytes);
    const source=outbound?report.get(s.mediaSourceId):null;
    const mime=String(report.get(s.codecId)?.mimeType||'').split('/')[1];
    const received=delta(s.packetsReceived,prev?.received),lost=delta(s.packetsLost,prev?.lost);
    const inboundLoss=received!==null && lost!==null && received+lost>0?lost/(received+lost):null;
    samples.push({mid:s.mid,direction:outbound?'out':'in',width:s.frameWidth,height:s.frameHeight,
      encoder:outbound && typeof s.encoderImplementation==='string' ? s.encoderImplementation.slice(0,96):null,
      codec:/^(VP8|VP9|AV1|H264|H265)$/i.test(mime)?mime:null,
      fps:delta(frames,prev?.frames)??nonnegative(s.framesPerSecond),frames,
      mbps:rate===null?null:rate*8/1e6,sourceFps:nonnegative(source?.framesPerSecond),
      sourceWidth:nonnegative(source?.width),sourceHeight:nonnegative(source?.height),
      targetBitrate:outbound?nonnegative(s.targetBitrate):null,
      reason:['bandwidth','cpu','none','other'].includes(s.qualityLimitationReason)?s.qualityLimitationReason:null,
      workMs,bufferMs,recent,fractionLost:outbound?(freshFeedback?nonnegative(feedback.fractionLost):null):inboundLoss,
      dropped:nonnegative(s.framesDropped),freezes:nonnegative(s.freezeCount),lost:nonnegative(feedback?.packetsLost),
      jitterMs:nonnegative(feedback?.jitter)===null?null:feedback.jitter*1000});
  }
  return {samples,next};
}
