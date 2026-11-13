import assert from 'node:assert/strict';
import test from 'node:test';
import {LinkQuality} from '../src/renderer/link-quality.mjs';
import {videoSamples} from '../src/renderer/video-stats.mjs';
import {roomReport} from '../src/renderer/diagnostics.mjs';

const clean = {available:12e6,active:1,video:[{reason:'none',fractionLost:0,sourceFps:60,fps:24}]};
const weak = {...clean,available:1.1e6,rttMs:130,video:[{reason:'bandwidth',fractionLost:.07,sourceFps:60,fps:14}]};
function constrained() {
  const q=new LinkQuality();
  q.sample({...clean,pairId:'old',rttMs:8});
  for(let i=0;i<3;i++)q.sample({...weak,pairId:'old'});
  assert.equal(q.limits('motion').height,540);
  return q;
}
test('selected ICE pair changes with cap preserved until stable high-latency path carries media',()=>{
  const q=constrained();
  q.sample({...clean,rttMs:120,pairId:'new'});
  assert.equal(q.limits('motion').height,540);
  assert.equal(q.baseRtt,120);
  for(let i=0;i<12;i++)q.sample({...clean,rttMs:122,pairId:'new'});
  assert.equal(q.limits('motion').height,0);
});
test('VPN below same ICE pair can restore quality, including while sender caps its own FPS',()=>{
  const q=constrained();
  for(let i=0;i<7;i++)q.sample({...clean,pairId:'old',rttMs:120});
  assert.equal(q.baseRtt,8);
  for(let i=0;i<18;i++)q.sample({...clean,pairId:'old',rttMs:120+i%3,video:[{...clean.video[0],reason:'bandwidth'}]});
  assert.equal(q.baseRtt,120);
  assert.equal(q.limits('motion').height,0);
});
test('unstable delay, receiver pressure, low capacity and missing ICE reports do not explain away congestion',()=>{
  for(const variant of [{receiverPressure:true},{available:1e6},{available:0},{fluctuate:true},{video:weak.video}]){
    const q=constrained();
    for(let i=0;i<60;i++)q.sample({...clean,...variant,rttMs:variant.fluctuate && i%2?190:120});
    assert.equal(q.baseRtt,8); assert(q.limits('motion').height>0);
  }
});
function meter(){
  const s={kind:'video',type:'inbound-rtp',id:'rx',mid:'1',ssrc:77,timestamp:0,
    packetsLost:0,packetsReceived:0,freezeCount:0,totalFreezesDuration:0,bytesReceived:1,framesDecoded:1};
  let history=new Map();
  function tick(changes={}){
    s.timestamp+=2000;s.framesDecoded+=60;s.packetsReceived+=100;
    Object.assign(s,changes);
    const res=videoSamples(new Map([[s.id,s]]),history);history=res.next;
    return res.samples[0];
  }
  return {s,tick,history:()=>history};
}
test('reception uses up to 60 seconds of packet deltas and completed freezes, independent of lifetime totals',()=>{
  const {s,tick,history}=meter();
  assert.equal(tick().recent,null);
  let v=tick({packetsLost:20,freezeCount:2,totalFreezesDuration:1.25});
  assert.deepEqual(v.recent,{seconds:2,lost:20,lossPct:100*20/120,freezes:2,freezeSeconds:1.25});
  for(let i=0;i<30;i++)v=tick();
  assert.equal(v.recent.seconds,60);assert.equal(v.recent.lossPct,0);assert.equal(v.recent.freezes,0);
  assert.equal(v.lost,20);assert.equal(v.freezes,2);
  for(let i=0;i<900;i++)tick({timestamp:s.timestamp+4});
  assert(history().get('rx').window.length<=61);
});
test('receiver restart, source change, sleep and missing fields yield a new or unavailable measurement',()=>{
  const {tick}=meter();tick();tick();
  assert.equal(tick({ssrc:42}).recent,null);
  tick();assert.equal(tick({packetsReceived:1,freezeCount:0}).recent,null);
  tick();assert.equal(tick({timestamp:300000}).recent,null);
  assert.equal(tick({freezeCount:undefined,packetsLost:undefined}).recent.lossPct,null);
});
test('polling a previous receiver report does not count one burst of loss repeatedly',()=>{
  const tx={kind:'video',type:'outbound-rtp',id:'tx',mid:'1',ssrc:12,remoteId:'rr',mediaSourceId:'source',
    timestamp:2000,framesEncoded:50,bytesSent:10000,frameHeight:180,targetBitrate:165000};
  const rr={id:'rr',type:'remote-inbound-rtp',timestamp:1800,fractionLost:0.18};
  const report=new Map([['tx',tx],['rr',rr],['source',{width:1280,height:720,framesPerSecond:30}]]);
  let history=new Map();
  const tick=()=>{
    const result=videoSamples(report,history);
    history=result.next;
    return result.samples[0];
  };
  const initial=tick();
  assert.equal(initial.fractionLost,0.18);
  assert.deepEqual([initial.sourceWidth,initial.sourceHeight,initial.height,initial.targetBitrate],[1280,720,180,165000]);
  tx.timestamp+=2000;
  assert.equal(tick().fractionLost,null);
  rr.timestamp=3900;rr.fractionLost=0;
  assert.equal(tick().fractionLost,0);
  tx.timestamp+=60000;tx.framesEncoded+=60;rr.timestamp+=1000;
  const afterSleep=tick();
  assert.equal(afterSleep.fractionLost,null);
  assert.equal(afterSleep.fps,null);
  assert.equal(afterSleep.mbps,null);
});
test('report shows recent reception and current playback dimensions separately from lifetime counters',()=>{
  const {tick}=meter();tick();
  const v=tick({frameWidth:1280,frameHeight:720,packetsLost:2,freezeCount:1,totalFreezesDuration:0.6});
  const text=roomReport({environment:{},selectedPeerId:'host',outputLatency:0.042,session:{selfId:'me',hostId:'host',role:'guest'},
    peers:[{id:'me',slot:1},{id:'host',slot:0,sharing:true}],stats:new Map([['host',{video:[v],inbound:[{slot:0,estimatedScreenSkewMs:-17}]}]])});
  assert.match(text,/звук минус видео · слот 0 · -17 мс/);
  assert.match(text,/Устройство вывода · оценка задержки звука 42 мс/);
  assert.match(text,/1280×720/);assert.match(text,/За последние 2 с · потеряно пакетов 2 \(2.0%\) · замираний 1 · время замираний 0.6 с/);
  assert.match(text,/За весь поток · потери пакетов 2/);
});
test('nine hours of two-second samples keep bounded per-stream history and expire departed SSRCs',()=>{
  const input=new Map();
  for(const [i,mid] of ['1','4','7'].entries())input.set(mid,{
    id:mid,mid,ssrc:i+1,kind:'video',type:'inbound-rtp',timestamp:0,
    bytesReceived:1,framesDecoded:1,packetsReceived:0,packetsLost:0,freezeCount:0,totalFreezesDuration:0});
  let history=new Map();
  for(let n=0;n<9*3600/2;n++){
    for(const row of input.values()){
      row.timestamp+=2000;row.framesDecoded+=60;row.bytesReceived+=750000;row.packetsReceived+=600;
      if(n%300===0)row.packetsLost+=2;
    }
    const result=videoSamples(input,history);history=result.next;
    assert.equal(history.size,input.size);
    for(const v of result.samples){
      assert(history.get(v.mid).window.length<=31);
      if(n>=30)assert.equal(v.recent.seconds,60);
    }
    if(n===8000)input.delete('7');
  }
});

test('room diagnostics distinguish the forwarded source profile, encoder target and actual picture',()=>{
  const state={environment:{},session:{role:'host',selfId:'host'},
    peers:[{id:'host',slot:0},{id:'source',slot:1},{id:'viewer',slot:2}],
    media:{endpoints:new Map([['source',{shareProfile:{fps:30,bitrate:4000000}}]])},
    stats:new Map([['viewer',{video:[{mid:'4',direction:'out',width:320,height:180,fps:21,mbps:.6,
      sourceWidth:1280,sourceHeight:720,sourceFps:30,targetBitrate:620000}],inbound:[]}]])};
  const report=roomReport(state);
  assert.match(report,/320×180 · 21.0 FPS/);
  assert.match(report,/Источник 1280×720 · 30.0 FPS · настройки до адаптации 30 FPS \/ 4.0/);
  assert.match(report,/Целевой битрейт кодировщика · 0.62/);
});
