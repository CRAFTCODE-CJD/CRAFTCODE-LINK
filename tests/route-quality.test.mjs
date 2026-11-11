import test from 'node:test';
import assert from 'node:assert/strict';
import {videoSamples} from '../src/renderer/video-stats.mjs';
import {RoomMedia} from '../src/renderer/peer.mjs';
import recovery from '../src/core/reconnect.cjs';

test('an early bandwidth estimate does not permanently cap outgoing bitrate or cut the configured FPS',async()=>{
  const calls=[];
  const sender={track:{readyState:'live'},getParameters:()=>({encodings:[{}]}),setParameters:async params=>calls.push(params)};
  const report=new Map([['transport',{type:'transport',selectedCandidatePairId:'path'}],['path',{type:'candidate-pair',availableOutgoingBitrate:310000}]]);
  let forwarded;
  const relay={...sender,setParameters:async params=>{forwarded=params;}};
  const transceivers=[{sender:{track:null}},{sender},{sender:{track:null}},{sender:{track:null}},{sender:relay}];
  const pc={getConfiguration:()=>({iceServers:[]}),getStats:async()=>report,remoteDescription:{},signalingState:'stable',getTransceivers:()=>transceivers,close(){}};
  const media=new RoomMedia({session:{role:'host',selfId:'host',internet:true},sendSignal:()=>{}});
  const ep={id:'friend',pc,encodingQueue:Promise.resolve(),videoHistory:new Map()};
  media.endpoints.set(ep.id,ep);media.tracks.set('0:screen',sender.track);
  try{
    await media.setQuality({fps:60,bitrate:12000000,content:'motion'});
    await media.collectStats();await media.collectStats();
    assert.equal(calls.at(-1).encodings[0].maxFramerate,60);
    assert.equal(calls.at(-1).encodings[0].maxBitrate,12000000);
    assert.equal(calls.at(-1).degradationPreference,'maintain-framerate');
    assert.equal(forwarded.encodings[0].maxBitrate,32000000);
    assert.equal(forwarded.degradationPreference,'balanced');
  }finally{media.close();}
});

test('interval stats detect a frozen receiver even if its last nominal frame rate remains 60',()=>{
  const stat={type:'inbound-rtp',mid:'1',kind:'video',id:'screen',framesPerSecond:60,framesDecoded:1800,bytesReceived:250000,timestamp:1000};
  const src=new Map([['screen',stat]]);
  const first=videoSamples(src,new Map());
  stat.timestamp=3000;
  const second=videoSamples(src,first.next);
  assert.equal(second.samples[0].fps,0);
  assert.equal(second.samples[0].mbps,0);
  stat.timestamp=5000;stat.framesDecoded+=60;stat.bytesReceived+=500000;
  const third=videoSamples(src,second.next);
  assert.equal(third.samples[0].fps,30);
  assert.equal(third.samples[0].mbps,2);
});

test('leaving a manual room during recovery cancels the pending retry',async()=>{
  let calls=0,notify;
  const events=[];
  const guest=await recovery.joinRecoveringGuest({onEvent:e=>events.push(e)},async options=>{
    ++calls;notify=options.onEvent;return {getInfo:()=>({}),close:async()=>{}};
  });
  notify({type:'closed',retryable:true,reason:'network'});
  assert.equal(events[0].type,'network-reconnecting');
  await guest.close();
  await new Promise(r=>setTimeout(r,1100));
  assert.equal(calls,1);
});
test('a graceful room close does not initiate an automatic new call',async()=>{
  const events=[];let notify;
  const guest=await recovery.joinRecoveringGuest({onEvent:e=>events.push(e)},async options=>{
    notify=options.onEvent;return {getInfo:()=>({}),close:async()=>{}};
  });
  notify({type:'closed',retryable:false,reason:'host left'});
  assert.deepEqual(events,[{type:'closed',reason:'host left'}]);
  await guest.close();
});
