'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {descendants}=require('./linux-process-tree.cjs');
const {setTimeout:sleep} = require('node:timers/promises');
const maxCheckpointGapMs = 20000;

function verifyPlayback(previous,current,slot) {
  const elapsed=current.time-previous.time;
  const gap=Math.ceil(Math.max(elapsed,current.wallTime-previous.wallTime));
  assert(elapsed>0 && gap<=maxCheckpointGapMs,'Interrupted endurance sampling: '+gap+' ms');
  const before=previous.streams[slot],after=current.streams[slot];
  assert(after.screen.frames>before.screen.frames && after.screen.bytes>before.screen.bytes &&
    after.system.bytes>before.system.bytes && after.voice.bytes>before.voice.bytes,
    'Selected screen, voice or stream sound stopped advancing between checkpoints, slot '+slot);
  return gap;
}
exports.maxCheckpointGapMs=maxCheckpointGapMs;
exports.verifyPlayback=verifyPlayback;

function checkObservation(measure) {
  assert(measure.samples>20 && measure.roles.screen.frames>12 && measure.roles.screen.bytes>0);
  assert(measure.roles.system.bytes>0 && measure.roles.voice.bytes>0 && measure.issues.length===0);
  assert(Number.isFinite(measure.skewMs) && Math.abs(measure.skewMs)<400,'Excessive screen/sound skew');
}

function footprint(directory) {
  let bytes = 0, files = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const name=path.join(dir,entry.name);
      try {
        if (entry.isDirectory()) walk(name);
        if (entry.isFile()) {
          assert(!/\.(webm|mp4|wav|mkv|y4m)$/i.test(entry.name),'Found a media file in the test profile');
          bytes += fs.statSync(name).size; files++;
        }
      } catch (error) { if (error.code!=='ENOENT') throw error; }
    }
  }
  walk(directory);
  return {bytes,files};
}

exports.run = async ({app,call,all,tmp}) => {
  const minutes=Number(process.env.LINK_QA_MINUTES || 300);
  assert(Number.isFinite(minutes) && minutes>=2 && minutes<=540);
  const profile=await app.evaluate(({app})=>app.getPath('userData'));
  assert(profile.startsWith(tmp+path.sep));
  const snapshot=async()=> {
    const streams=await Promise.all([0,1].map(slot=>call('g2','stats',slot)));
    return {streams,time:performance.now(),wallTime:Date.now()};
  };
  let previous=await snapshot(),checkpoints=0,longestGap=0;
  const baseline=footprint(profile), initial=previous.streams[0];
  const started=previous.time, target=minutes*60000;
  const interval=minutes<=10 ? 20000 : 60000;
  let cycle=0, previousSlot=-1;
  let maxRss=0,maxDisk=baseline.bytes,maxSkew=0;
  const rss=[];
  async function checkpoint(slot) {
    const current=await snapshot();
    longestGap=Math.max(longestGap,verifyPlayback(previous,current,slot));
    previous=current;
    checkpoints++;
  }
  do {
    // A guest shows a second screen briefly, then the viewer returns to the film.
    const slot=cycle%5===2 ? 1 : 0;
    const cycleEnd=Math.min(started+target,performance.now()+interval);
    if(slot!==previousSlot) {
      await call('g2','selectShow',slot,slot===0?500:0);
      previousSlot=slot;
      const transition=await call('g2','observe',slot,4000);
      console.log('SWITCH',JSON.stringify({cycle,slot,...transition}));
      checkObservation(transition);
      maxSkew=Math.max(maxSkew,Math.abs(transition.skewMs));
      await checkpoint(slot);
    }
    while(cycleEnd-performance.now()-4000>10000) {
      await sleep(10000);
      await checkpoint(slot);
    }
    await sleep(Math.max(0,cycleEnd-performance.now()-4000));
    const measure=await call('g2','observe',slot,4000);
    await checkpoint(slot);
    const disk=footprint(profile);
    const memory=process.platform==='linux'
      ? Math.round(descendants().reduce((sum,p)=>sum+p.rss,0)/1024)
      : await app.evaluate(({app})=>Math.round(app.getAppMetrics().reduce((sum,p)=>sum+p.memory.workingSetSize,0)/1024));
    if(memory!==null)rss.push(memory);
    maxRss=Math.max(maxRss,memory || 0);maxDisk=Math.max(maxDisk,disk.bytes);
    maxSkew=Math.max(maxSkew,Math.abs(measure.skewMs));
    const elapsed=Math.floor((performance.now()-started)/1000);
    console.log('EVENING',JSON.stringify({elapsed,slot,rssMiB:memory,profileBytes:disk.bytes,
      frames:measure.roles.screen.frames,videoBytes:measure.roles.screen.bytes,
      voiceBytes:measure.roles.voice.bytes,systemBytes:measure.roles.system.bytes,
      avSkewMs:measure.skewMs,voiceMs:measure.voiceMs,systemMs:measure.systemMs,videoMs:measure.videoMs,
      videoBufferMs:measure.roles.screen.bufferMs,audioBufferMs:measure.roles.system.bufferMs,
      rttMs:measure.roles.screen.rttMs,videoJitterMs:measure.roles.screen.jitterMs,audioJitterMs:measure.roles.system.jitterMs,
      videoLost:measure.roles.screen.lost,audioLost:measure.roles.system.lost,playoutSkewMs:measure.roles.screen.playoutSkewMs,
      longestPictureMs:measure.longestPictureMs,freezeSeconds:measure.roles.screen.freezeSeconds,samples:measure.samples,
      checkpoints,maxCheckpointGapMs:longestGap}));
    checkObservation(measure);
    assert(disk.bytes-baseline.bytes<8*1024*1024,'Unexpected on-disk profile growth');
    cycle++;
  } while(previous.time-started<target);
  const elapsedMs=previous.time-started;
  assert(elapsedMs>=target);
  const last=previous.streams[0];
  const closed=await Promise.all(all.map(id=>call(id,'finishCall')));
  for(const counts of closed)assert.deepEqual(counts,{endpoints:0,mixerSources:0,generatedLive:0});
  const trend=rss.length>=20 ? rss.slice(-5).sort((a,b)=>a-b)[2]-rss.slice(5,10).sort((a,b)=>a-b)[2] : null;
  console.log('ENDURANCE',JSON.stringify({minutes,seconds:Math.floor(elapsedMs/1000),elapsedMs:Math.floor(elapsedMs),cycles:cycle,
    checkpoints,maxCheckpointGapMs:longestGap,
    movieFrames:last.screen.frames-initial.screen.frames,movieBytes:last.screen.bytes-initial.screen.bytes,
    voiceBytes:last.voice.bytes-initial.voice.bytes,systemBytes:last.system.bytes-initial.system.bytes,
    finalProfileBytes:footprint(profile).bytes,maxAvSkewMs:maxSkew,firstRssMiB:rss[0],peakRssMiB:maxRss,lastRssMiB:rss.at(-1),rssGrowthAfterWarmupMiB:trend,
    initialProfileBytes:baseline.bytes,peakProfileBytes:maxDisk,closed}));
  if(trend!==null)assert(trend<160,'Sustained RSS growth after warm-up requires review');
  console.log('PASS endurance session, incoming voice and both screens, bounded profile, closed room resources.');
};
