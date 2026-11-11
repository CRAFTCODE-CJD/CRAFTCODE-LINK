'use strict';
const assert=require('node:assert/strict');
const median=values=>values.slice().sort((a,b)=>a-b)[Math.floor(values.length/2)];

exports.run=async ({call,all})=>{
  async function measure(label,slot,ms,windows,calibration) {
    await call('g2','selectShow',slot,ms);
    if(calibration) await call('host','calibration',calibration);
    const markers=[],pulses=[],playout=[];
    let frames=0,voiceBytes=0,soundBytes=0;
    for(let i=0;i<windows;i++){
      const m=await call('g2','observe',slot,900);
      console.log('TIMING',JSON.stringify({label,slot,requestedMs:ms,window:i+1,skew:m.skewMs,pulses:m.pulseSkewMs,
        videoMs:m.videoMs,soundMs:m.systemMs,videoBufferMs:m.roles.screen.bufferMs,soundBufferMs:m.roles.system.bufferMs,
        playoutMs:m.roles.screen.playoutSkewMs,frames:m.roles.screen.frames,videoBytes:m.roles.screen.bytes,
        voiceBytes:m.roles.voice.bytes,soundBytes:m.roles.system.bytes,pictureGap:m.longestPictureMs,samples:m.samples}));
      assert(m.samples>=6 && m.issues.length===0);
      frames+=m.roles.screen.frames;voiceBytes+=m.roles.voice.bytes;soundBytes+=m.roles.system.bytes;
      // A calibration changes the source itself. A pulse already on the wire can
      // straddle this deliberate change. Transition tests retain every sample.
      if(calibration && i<2)continue;
      markers.push(m.skewMs);pulses.push(...m.pulseSkewMs);
      if(Number.isFinite(m.roles.screen.playoutSkewMs))playout.push(m.roles.screen.playoutSkewMs);
    }
    assert(frames>0 && voiceBytes>0 && soundBytes>0 && pulses.length>=2,'Missing decoded content or reference pulses: '+label);
    return {label,markers,pulses,playout,frames,voiceBytes,soundBytes};
  }
  const clean=[];
  for(const args of [
    ['auto',0,0,7],['raise',0,2000,24],['lower',0,0,22],['medium',0,1000,10],
    ['second-source',1,500,8],['return-to-film',0,2000,20],['reduce',0,500,16],['restore-auto',0,0,10]
  ]) clean.push(await measure(...args));
  const shiftedStamp=await measure('incorrect-video-timestamp',0,0,9,{legacyStampMs:720});
  const delayedSound=await measure('real-source-audio-delay',0,0,10,{delayAudioMs:720});
  const recovered=await measure('calibration-removed',0,0,9,{});
  clean.push(recovered);
  const summary=clean.map(row=>({label:row.label,worstWindowMedian:Math.max(...row.markers.map(Math.abs)),
    worstPulse:Math.max(...row.pulses.map(Math.abs)),pulseCount:row.pulses.length,frames:row.frames,voiceBytes:row.voiceBytes,soundBytes:row.soundBytes}));
  const controls=[shiftedStamp,delayedSound].map(row=>({label:row.label,stamp:median(row.markers),
    pulse:median(row.pulses),pulseCount:row.pulses.length,rtpEstimate:median(row.playout)??null}));
  console.log('SUMMARY',JSON.stringify({clean:summary,controls}));
  const closed=await Promise.all(all.map(id=>call(id,'finishCall')));
  for(const counts of closed)assert.deepEqual(counts,{endpoints:0,mixerSources:0,generatedLive:0});
  assert(controls[0].stamp>500 && Math.abs(controls[0].pulse)<250,'Independent pulse accepted an incorrect video timestamp');
  assert(controls[1].stamp < -500 && controls[1].pulse < -500,'The two references missed the delayed audio content');
  for(const row of summary)assert(row.worstWindowMedian<400 && row.worstPulse<400,'Picture and sound diverged during '+row.label);
  console.log('PASS Windows-compatible RTP switch timing and independent flash/tone controls.');
};
