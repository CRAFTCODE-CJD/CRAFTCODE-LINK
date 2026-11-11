import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {LinkQuality,audioContinuity} from '../src/renderer/link-quality.mjs';
import {streamRelays} from '../src/renderer/relay-settings.mjs';
import {RoomMedia} from '../src/renderer/peer.mjs';

test('a replacement audio source starts a fresh buffer and concealment measurement',()=>{
  const s={id:'a',mid:'2',ssrc:1,type:'inbound-rtp',kind:'audio',totalSamplesReceived:1200,concealedSamples:100,
    silentConcealedSamples:0,jitterBufferEmittedCount:1000,jitterBufferDelay:400,jitter:.035};
  let h=audioContinuity([s],new Map(),new Map()).next;
  Object.assign(s,{ssrc:2,totalSamplesReceived:10000,concealedSamples:3000,jitterBufferEmittedCount:3000,jitterBufferDelay:5});
  let r=audioContinuity([s],h,new Map());
  assert.equal(r.samples[0].bufferMs,null);assert.equal(r.samples[0].concealedPct,null);
  h=r.next;delete s.jitterBufferDelay;s.jitterBufferEmittedCount+=100;s.totalSamplesReceived+=100;
  r=audioContinuity([s],h,new Map());assert.equal(r.samples[0].bufferMs,null);
});

test('sustained congestion is scoped to one recipient and upgrade probes restore the original ceiling',()=>{
  const q=new LinkQuality(),other=new LinkQuality();
  const weak={available:920000,active:1,rttMs:85,video:[{sourceFps:30,fps:12,reason:'bandwidth',fractionLost:0.06}]};
  assert.equal(q.sample(weak),false);
  assert.equal(q.sample(weak),true);
  assert(q.limits('motion').height>0);
  assert(q.limits('detail').height>q.limits('motion').height);
  assert(q.limits('detail').fps<q.limits('motion').fps);
  assert.equal(other.limits('motion').height,0);
  for(let i=0;i<30;i++)q.sample({...weak,video:[{sourceFps:30,fps:30,reason:'none',fractionLost:0}]});
  assert.equal(q.limits('motion').bitrate,Infinity);
});
test('sustained CPU pressure reduces encoding work; a static screen does not qualify',()=>{
  const q=new LinkQuality();
  for(let i=0;i<8;i++)q.sample({active:1,available:0,rttMs:10,video:[{sourceFps:1,fps:1,reason:'cpu'}]});
  assert.equal(q.limits('detail').fps,60);
  for(let i=0;i<3;i++)q.sample({active:1,available:0,rttMs:10,video:[{sourceFps:60,fps:12,reason:'cpu'}]});
  assert.equal(q.limits('motion').fps,30);assert.equal(q.limits('motion').bitrate,Infinity);
});
test('audio playout floor reacts to non-silent concealment and releases on recovery',()=>{
  const rx={jitterBufferTarget:null},receivers=new Map([['0',rx]]);
  const s={type:'inbound-rtp',kind:'audio',mid:'0',id:'a',jitter:0.022,totalSamplesReceived:96000,concealedSamples:0,silentConcealedSamples:0,jitterBufferDelay:1920,jitterBufferEmittedCount:96000};
  const report=new Map([['a',s]]);let history=audioContinuity(report,new Map(),receivers).next;
  function tick(concealed,silent=0){
    s.totalSamplesReceived+=96000;s.concealedSamples+=concealed;s.silentConcealedSamples+=silent;
    s.jitterBufferEmittedCount+=96000;s.jitterBufferDelay+=1920;const result=audioContinuity(report,history,receivers);
    history=result.next;return result.samples[0];
  }
  tick(1500,1500);tick(1500,1500);assert.equal(rx.jitterBufferTarget,null);
  tick(1920);assert.equal(tick(1920).concealedPct,2);assert.equal(rx.jitterBufferTarget,60);
  for(let i=0;i<5;i++)tick(0);assert.equal(rx.jitterBufferTarget,null);
});
test('relay fallback retains authorized TCP/TLS URLs and never invents a hostname, port or credentials',()=>{
  const servers=[{urls:['stun:s.invalid','turn:r.invalid:3478?transport=udp','turns:r.invalid:443?transport=tcp'],username:'x',credential:'y'},{urls:'turn:r.invalid:80?transport=tcp',username:'a',credential:'b'}];
  assert.deepEqual(streamRelays(servers),[{...servers[0],urls:[servers[0].urls[2]]},{...servers[1],urls:[servers[1].urls]}]);
  assert.deepEqual(streamRelays([{urls:'turn:r.invalid:3478'}]),[]);
});
test('an acknowledged path probe keeps a healthy call on the selected route',()=>{
  const media=new RoomMedia({session:{internet:true,role:'host'},sendSignal(){}}),sent=[];
  const ep={id:'guest',pc:{close(){},connectionState:'connected',signalingState:'stable'}};
  media.endpoints.set(ep.id,ep);const ch={label:'room-chat',bufferedAmount:0,readyState:'open',send:s=>sent.push(JSON.parse(s))};
  media.installChat(ep,ch);
  try{
    media.checkRoute(ep);media.checkRoute(ep);assert.equal(sent.length,1);
    ch.onmessage({data:JSON.stringify({control:{kind:'route-pong',nonce:999}})});assert(ep.probeTimer);
    ch.onmessage({data:JSON.stringify({control:{kind:'route-pong',nonce:sent[0].control.nonce}})});
    assert.equal(ep.probeTimer,null);assert.equal(ep.recovery,undefined);
  }finally{media.close();}
});
test('protected PCM buffers onset, ramps a starvation boundary, and refills in stereo',()=>{
  let processor;const port={postMessage(){}},ctx={registerProcessor:(_,Class)=>{processor=new Class();},AudioWorkletProcessor:class{constructor(){this.port=port;}},Int16Array};
  vm.runInNewContext(fs.readFileSync(new URL('../src/renderer/stream-pcm.mjs',import.meta.url),'utf8'),ctx);
  function feed(frames){
    const block=new Int16Array(frames*2);for(let i=0;i<block.length;i+=2){block[i]=16384;block[i+1]=-16384;}
    port.onmessage({data:new Uint8Array(block.buffer)});
  }
  function render(){const l=new Float32Array(128),r=new Float32Array(128);processor.process([],[[l,r]]);return [l,r];}
  feed(480);assert(render()[0].every(x=>x===0));feed(544);
  const [l,r]=render();assert.equal(l[0],0);assert(l[127]>.48 && r[127]<-.48);
  for(let i=0;i<7;i++)render();const tail=render()[0];assert(tail[0]>.48 && tail[127]===0);
  assert(render()[0].every(x=>x===0));feed(1024);assert(render()[0][127]>.48);
});

test('live PCM keeps packet boundaries continuous and crossfades to fresh stereo after a stall',()=>{
  let processor;
  const scope={registerProcessor:(_,Class)=>{processor=new Class();},AudioWorkletProcessor:class{constructor(){this.port={postMessage(){}};}},Int16Array};
  vm.runInNewContext(fs.readFileSync(new URL('../src/renderer/stream-pcm.mjs',import.meta.url),'utf8'),scope);
  function feed(frames,sample){
    const input=new Int16Array(frames*2);
    for(let i=0;i<frames;i++){input[i*2]=sample(i);input[i*2+1]=-sample(i);}
    processor.port.onmessage({data:new Uint8Array(input.buffer)});
  }
  function render(){
    const left=new Float32Array(128),right=new Float32Array(128);
    processor.process([],[[left,right]]);return {left,right};
  }
  let supplied=0,played=0;
  const sample=i=>1000+i%15000;
  for(let frame=0;frame<48000;frame+=128){
    if(frame+128>=supplied+480){
      feed(480,i=>sample(supplied+i));supplied+=480;
    }
    const {left,right}=render();
    if(!played && left[127]===0)continue;
    for(let i=0;i<128;i++,played++){
      if(played<128)continue;
      assert.equal(left[i]*32768,sample(played));assert.equal(right[i],-left[i]);
    }
  }
  assert(played>46000);
  const previous=sample(played-1)/32768;
  feed(9600,()=>-16384);
  let {left,right}=render();
  assert.equal(left[0],previous);assert(left[127]<-.48);assert.equal(right[127],-left[127]);
  for(let i=0;i<14;i++){({left}=render());assert(left.every(value=>value===-.5));}
  assert(render().left[127]===0,'A stalled consumer replayed more than 40 ms');
  assert(processor.discardedFrames>=9600-1920);
  assert.equal(processor.underruns,1);
});

test('unchanged encoder limits do not reconfigure the encoder when a participant joins or repeats a preference',async()=>{
  const room=new RoomMedia({session:{internet:true,role:'host',selfId:'host'},sendSignal(){}});
  let updates=0,params={encodings:[{}]};
  const sender={track:{kind:'video',getSettings:()=>({height:1440})},getParameters:()=>structuredClone(params),
    async setParameters(next){updates++;params=next;}};
  const pc={remoteDescription:{},signalingState:'stable',getTransceivers:()=>[{sender:{track:null}},{sender}]};
  const ep={pc,viewHeight:720,quality:new LinkQuality()};
  try{
    await room.applyEncodingNow(ep);assert.equal(updates,1);assert.equal(params.encodings[0].scaleResolutionDownBy,2);
    await room.applyEncodingNow(ep);assert.equal(updates,1);
    ep.viewHeight=1440;await room.applyEncodingNow(ep);
    assert.equal(updates,2);assert.equal(params.encodings[0].scaleResolutionDownBy,1);
    const origin={id:'guest-a',remoteSlot:1};room.peers=[{id:'host',slot:0},{id:origin.id,slot:1}];
    room.endpoints.set(origin.id,origin);
    try{
      pc.getTransceivers=()=>[...Array.from({length:4},()=>({sender:{track:null}})),{sender}];
      const profile={content:'detail',bitrate:4000000,fps:30};room.receiveShareProfile(origin,profile);
      room.receiveShareProfile(origin,{...profile,fps:120});assert.deepEqual(origin.shareProfile,profile);
      await room.applyEncodingNow(ep);assert.equal(params.degradationPreference,'maintain-resolution');
      assert.equal(params.encodings[0].maxBitrate,4000000);assert.equal(params.encodings[0].maxFramerate,30);
      room.receiveShareProfile(origin,{content:'motion',bitrate:12000000,fps:60});
      await room.applyEncodingNow(ep);assert.equal(params.degradationPreference,'maintain-framerate');
      assert.equal(params.encodings[0].maxBitrate,12000000);assert.equal(params.encodings[0].maxFramerate,60);
    }finally{room.endpoints.delete(origin.id);}

  }finally{room.close();}
});
