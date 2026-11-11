import test from 'node:test';
import assert from 'node:assert/strict';
import { WatchBuffer } from '../src/renderer/watch-buffer.mjs';
import { videoSamples } from '../src/renderer/video-stats.mjs';

function fixture(host=false){
  const ids=['host','g1','g2'],buffers=new WatchBuffer();
  const ts=Array.from({length:9},(_,i)=>({receiver:{jitterBufferTarget:i%3===0?60:(i%3===2?80:null)}}));
  const room={session:{selfId:host?'host':'g2',hostId:'host'},isHost:host,
    peers:ids.map((id,slot)=>({id,slot})),endpoints:new Map([[host?'g1':'host',{remoteSlot:1,pc:{getTransceivers:()=>ts}}]])};
  const values=()=>ts.map(t=>t.receiver.jitterBufferTarget);
  return {room,buffers,values,ts};
}
test('viewing buffer applies only to the selected picture and stream sound, then releases both',()=>{
  const {room,buffers,values}=fixture();
  buffers.select('g1',1000);buffers.update(room);
  assert.deepEqual(values(),[60,null,80,60,1000,1000,60,null,80]);
  buffers.select('host',500);buffers.update(room);
  assert.deepEqual(values(),[60,500,500,60,null,null,60,null,80]);
  buffers.select('g1');buffers.update(room);
  assert.deepEqual(values(),[60,null,null,60,1000,1000,60,null,80]);
  buffers.select('g1',0);buffers.update(room);assert.deepEqual(values().slice(3,6),[60,null,null]);
  assert.throws(()=>buffers.select('g1',5000),RangeError);
});
test('host releases forwarded receivers before guest joins, then restores the local preference',()=>{
  const {room,buffers,values}=fixture(true);
  const third=room.peers.pop();
  buffers.select('g1',1000);buffers.update(room);assert.equal(values()[4],1000);
  room.peers.push(third);assert(buffers.update(room).forwarding);assert.equal(values()[4],null);
  room.peers.pop();buffers.update(room);assert.equal(values()[4],1000);
  room.peers.pop();buffers.prune(room.peers);buffers.update(room);
  assert.equal(values()[4],null);assert.equal(buffers.preferences.size,0);
});
test('no receiver preference on an unsupported engine or own preview',()=>{
  const {room,buffers,ts}=fixture();
  for(const t of ts)t.receiver={};
  buffers.select('g1',500);assert.equal(buffers.update(room).available,false);
  buffers.select('g2',500);assert.equal(buffers.update(room).available,false);
});

test('picture follows emitted stream sound while a buffer fills and drains, without changing voice',async t=>{
  const {room,buffers,ts,values}=fixture();
  t.mock.timers.enable({apis:['setTimeout']});
  t.after(()=>buffers.close());
  let emitted=0,delay=0,minimum=0;
  const audio=ts[5].receiver;
  const previousSsrc={id:'old',ssrc:1,kind:'audio',type:'inbound-rtp',bytesReceived:50000,
    jitterBufferEmittedCount:1000,jitterBufferDelay:1980,lastPacketReceivedTimestamp:1};
  audio.getStats=async()=>new Map([['old',previousSsrc],['sound',{id:'sound',ssrc:42,kind:'audio',type:'inbound-rtp',bytesReceived:emitted*2,lastPacketReceivedTimestamp:emitted,
    jitterBufferEmittedCount:emitted,jitterBufferDelay:delay,jitterBufferMinimumDelay:minimum}]]);
  const step=async(actual,natural=0)=>{
    emitted+=1000;delay+=actual;minimum+=natural;
    t.mock.timers.tick(250);await Promise.resolve();
  };
  emitted=1000;delay=40;
  buffers.select('g1',2000);buffers.update(room);await Promise.resolve();
  assert.deepEqual(values().slice(3,6),[60,null,2000]);
  await step(160);assert.equal(values()[4],160);
  await step(1100);assert.equal(values()[4],1100);
  await step(1980);assert.equal(values()[4],2000);
  buffers.select('g1',0);buffers.update(room);await Promise.resolve();
  assert.deepEqual(values().slice(3,6),[60,2000,null]);
  await step(960);assert.equal(values()[4],960);
  await step(260,230);assert.equal(values()[4],null,'release both receivers at the natural floor');
  assert.equal(buffers.timing,null);
});

test('a video-only share can build its full buffer; a late stats result cannot alter a new source',async t=>{
  const {room,buffers,ts,values}=fixture();
  t.mock.timers.enable({apis:['setTimeout']});
  let now=0;
  t.mock.method(performance,'now',()=>now);
  t.after(()=>buffers.close());
  const audio=ts[5].receiver;
  let resolve;
  audio.getStats=async()=>new Map();
  buffers.select('g1',1000);buffers.update(room);await Promise.resolve();
  now=1250;t.mock.timers.tick(250);await Promise.resolve();
  assert.equal(values()[4],1000);
  audio.getStats=()=>new Promise(done=>{resolve=done;});
  t.mock.timers.tick(500);
  buffers.select('host',500);buffers.update(room);
  resolve(new Map());await Promise.resolve();
  assert.deepEqual(values(),[60,500,500,60,null,null,60,null,80]);
  buffers.close();assert.equal(buffers.applied.size,0);
});
test('measured video hold time uses newly emitted frames and ignores an empty interval',()=>{
  const row={id:'v',type:'inbound-rtp',kind:'video',mid:'1',timestamp:1,bytesReceived:1,framesDecoded:4,jitterBufferEmittedCount:4,jitterBufferDelay:1};
  const before=videoSamples(new Map([['v',row]]),new Map());
  Object.assign(row,{timestamp:1000,jitterBufferEmittedCount:8,jitterBufferDelay:3});
  const after=videoSamples(new Map([['v',row]]),before.next);
  assert.equal(after.samples[0].bufferMs,500);
  assert.equal(videoSamples(new Map([['v',row]]),after.next).samples[0].bufferMs,null);
});

test('automatic A/V alignment is bounded by network minimum and releases a silent, replaced or forwarded route',()=>{
  const {room,ts}=fixture(true);
  room.peers.pop();
  ts.forEach((t,i)=>{t.mid=String(i);});
  let output=52,energy=0,n=0;
  const buffers=new WatchBuffer(()=>output);
  const ep=room.endpoints.get('g1'),picture=ts[4].receiver;
  buffers.select('g1',0);buffers.update(room);
  const sample=(skew=-100,sound=true,endpoint=ep)=>{
    n++;if (sound)energy++;
    const common={type:'inbound-rtp',bytesReceived:n*300,jitterBufferEmittedCount:n,
      jitterBufferMinimumDelay:n*.025,jitterBufferDelay:n*.25,ssrc:17,lastPacketReceivedTimestamp:n*1000};
    const report=new Map([['v',{...common,mid:'4',framesDecoded:n*30,framesPerSecond:30}],
      ['a',{...common,mid:'5',totalAudioEnergy:energy}]]);
    buffers.alignOutput(endpoint,report,[{slot:1,estimatedScreenSkewMs:skew}]);
  };
  sample();sample();
  // Even if the native audio and video queues have grown to 250ms, the
  // application floor cannot ratchet up in response.
  assert.equal(picture.jitterBufferTarget,144);
  for(let i=0;i<10;i++)sample();
  assert.equal(picture.jitterBufferTarget,144);
  assert.equal(ts[3].receiver.jitterBufferTarget,60);
  assert.equal(ts[5].receiver.jitterBufferTarget,80);
  sample(null);assert.equal(picture.jitterBufferTarget,144);
  sample(null);assert.equal(picture.jitterBufferTarget,null);
  sample();assert.equal(picture.jitterBufferTarget,144);
  sample(-100,false);assert.equal(picture.jitterBufferTarget,144,'decoded audible stereo may report zero energy');
  output=null;sample();assert.equal(picture.jitterBufferTarget,null);
  output=52;sample();assert.equal(picture.jitterBufferTarget,null);
  sample();assert.equal(picture.jitterBufferTarget,144);

  room.peers.push({id:'g2',slot:2});
  buffers.update(room);sample();assert.equal(picture.jitterBufferTarget,null);
  room.peers.pop();buffers.update(room);sample();sample();
  assert.equal(picture.jitterBufferTarget,144);

  // The same receiver and slot may be reused on another connection.
  const replacement={...ep};
  room.peers[1]={id:'another',slot:1};
  room.endpoints.set('another',replacement);
  buffers.select('another');buffers.update(room);sample(-100,true,ep);
  assert.equal(picture.jitterBufferTarget,null);
  sample(-100,true,replacement);sample(-100,true,replacement);
  assert.equal(picture.jitterBufferTarget,144);
  buffers.select('another',500);buffers.update(room);
  sample(-100,true,replacement);assert.equal(picture.jitterBufferTarget,500);
  buffers.close();assert.equal(picture.jitterBufferTarget,null);
});

test('output calibration waits for a manual buffer to fill, preserves its audio target and clears on drain',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {room,ts}=fixture();
  ts.forEach((item,i)=>{item.mid=String(i);});
  const buffers=new WatchBuffer(()=>50),ep=room.endpoints.get('host');
  t.after(()=>buffers.close());
  let count=1,delay=0;
  const audio=ts[2].receiver,video=ts[1].receiver,report=()=>new Map([
    ['a',{type:'inbound-rtp',kind:'audio',mid:'2',id:'a',ssrc:21,bytesReceived:count*500,
      jitterBufferDelay:delay,jitterBufferMinimumDelay:.06*count,jitterBufferEmittedCount:count}],
    ['v',{type:'inbound-rtp',kind:'video',mid:'1',id:'v',ssrc:22,bytesReceived:count*900,framesDecoded:count,
      jitterBufferDelay:delay,jitterBufferMinimumDelay:.01*count,jitterBufferEmittedCount:count}]
  ]);
  audio.getStats=async()=>report();
  const sample=async buffer=>{
    count++;delay+=buffer/1000;
    t.mock.timers.tick(500);await Promise.resolve();
    buffers.alignOutput(ep,report(),[{slot:0,estimatedScreenSkewMs:-30}]);
  };
  buffers.select('host',500);buffers.update(room);await Promise.resolve();
  await sample(130);assert.equal(video.jitterBufferTarget,130);
  await sample(300);assert.equal(video.jitterBufferTarget,300);
  await sample(495);assert.equal(video.jitterBufferTarget,500);
  await sample(495);assert.equal(video.jitterBufferTarget,532);
  await sample(495);assert.equal(video.jitterBufferTarget,564);
  assert.equal(audio.jitterBufferTarget,500);
  buffers.select('host',0);buffers.update(room);await Promise.resolve();
  await sample(200);assert.equal(video.jitterBufferTarget,200);
  await sample(55);assert.equal(video.jitterBufferTarget,null);
  assert.equal(audio.jitterBufferTarget,null);
});
