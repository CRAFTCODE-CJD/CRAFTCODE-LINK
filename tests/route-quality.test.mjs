import test from 'node:test';
import assert from 'node:assert/strict';
import {videoSamples} from '../src/renderer/video-stats.mjs';
import {RoomMedia} from '../src/renderer/peer.mjs';
import {LinkQuality} from '../src/renderer/link-quality.mjs';
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
    assert.equal(calls.at(-1).degradationPreference,'maintain-resolution');
    assert.equal(forwarded.encodings[0].maxBitrate,32000000);
    assert.equal(forwarded.degradationPreference,'balanced');
  }finally{media.close();}
});

test('a forwarded adaptive ceiling follows input size for a viewer on Original',async()=>{
  const media=new RoomMedia({session:{role:'host',selfId:'host'},sendSignal(){}});
  const inbound={id:'incoming',type:'inbound-rtp',kind:'video',mid:'4',framesDecoded:60,bytesReceived:200000,
    timestamp:1000,frameHeight:1080};
  let encoded={encodings:[{}]};
  const sender={track:{kind:'video',getSettings:()=>({height:1080})},getParameters:()=>structuredClone(encoded),
    async setParameters(value){encoded=value;}};
  const transceivers=Array.from({length:4},()=>({sender:{track:null}})).concat({sender,mid:'4'});
  function endpoint(id,remoteSlot,senders,report){
    return {id,remoteSlot,viewHeight:0,encodingQueue:Promise.resolve(),videoHistory:new Map(),
      pc:{getStats:async()=>report,getTransceivers:()=>senders,getConfiguration:()=>({}),
        remoteDescription:{},signalingState:'stable',close(){}}};
  }
  const source=endpoint('source',1,[],new Map([[inbound.id,inbound]]));
  const viewer=endpoint('viewer',2,transceivers,new Map());
  viewer.quality=new LinkQuality();
  const weak={active:1,available:1.1e6,rttMs:45,video:[{sourceFps:30,fps:10,reason:'bandwidth',fractionLost:.08}]};
  viewer.quality.sample(weak);viewer.quality.sample(weak);
  media.endpoints.set(source.id,source);media.endpoints.set(viewer.id,viewer);
  try{
    await media.collectStats();await viewer.encodingQueue;
    assert.equal(encoded.encodings[0].scaleResolutionDownBy,2);
    inbound.frameHeight=360;inbound.framesDecoded+=60;inbound.timestamp+=2000;
    await media.collectStats();await viewer.encodingQueue;
    assert.equal(encoded.encodings[0].scaleResolutionDownBy,1);
  }finally{media.close();}
});

test('unused audio and video slots release their bandwidth and can resume without renegotiating',async()=>{
  const room=new RoomMedia({session:{role:'host',selfId:'host'},sendSignal(){}});
  const source={id:'source',slot:1,sharing:false,micMuted:true};
  room.peers=[{id:'host',slot:0},source];
  function transceiver(){
    let params={encodings:[{active:true}]};
    return {currentDirection:'sendonly',sender:{track:null,getParameters:()=>structuredClone(params),
      async setParameters(next){params=next;}}};
  }
  const senders=Array.from({length:6},transceiver);
  const ep={quality:new LinkQuality(),pc:{remoteDescription:{},signalingState:'stable',getTransceivers:()=>senders}};
  const active=()=>senders.map(t=>t.sender.getParameters().encodings[0].active);
  try{
    await room.applyEncodingNow(ep);
    assert.deepEqual(active(),[false,false,false,false,false,false]);
    const track={readyState:'live',kind:'video',muted:false,getSettings:()=>({height:720})};
    senders[1].sender.track=track;senders[4].sender.track={...track,muted:true};
    senders[3].sender.track={readyState:'live',kind:'audio',muted:false};
    await room.applyEncodingNow(ep);
    assert.deepEqual(active(),[false,true,false,false,false,false]);
    source.sharing=true;source.micMuted=false;senders[4].sender.track.muted=false;
    await room.applyEncodingNow(ep);
    assert.deepEqual(active(),[false,true,false,true,true,false]);
    senders[1].sender.track=null;source.sharing=false;source.micMuted=true;
    await room.applyEncodingNow(ep);
    assert.deepEqual(active(),[false,false,false,false,false,false]);
  }finally{room.close();}
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
