'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {GameDiscovery}=require('../src/game/discovery.cjs');
const {stkDiscoveryMessage}=require('../src/game/stk-discovery.cjs');

const header={proto:'UDP',src:2,dst:255,sport:51473,dport:2757};
const reply={proto:'UDP',src:1,dst:2,sport:2757,dport:51473};
const query=Buffer.from('0a73746b2d736572766572','hex');
function answer(){
  const name=Buffer.from('Картинг');
  return Buffer.concat([Buffer.from([0,0,0,6,name.length]),name,Buffer.from([8,1,0x6c,0x70,2,3,0,0,0])]);
}

test('STK only grants the advertised UDP listener to the querying seat and socket',()=>{
  const discovery=new GameDiscovery();
  const data=answer();
  const invite=stkDiscoveryMessage(query,header);
  const advertisement=stkDiscoveryMessage(data,reply);
  assert.deepEqual(advertisement.session,{port:27760});
  const now=Date.now();
  assert.deepEqual(discovery.observe(advertisement,reply,now),[]);
  discovery.observe(invite,header,now);
  const wrongSeat={...reply,dst:3};
  const wrongPort={...reply,dport:51474};
  assert.deepEqual(discovery.observe(advertisement,wrongSeat,now),[]);
  assert.deepEqual(discovery.observe(stkDiscoveryMessage(data,wrongPort),wrongPort,now),[]);
  assert.equal(discovery.listener(2,1,27760),false);
  assert.deepEqual(discovery.observe(advertisement,reply,now).map(q=>q.seat),[2]);
  assert.equal(discovery.listener(2,1,27760),true);
  assert.equal(discovery.listener(3,1,27760),false);
  assert.equal(discovery.listener(2,1,27761),false);
  assert.deepEqual(discovery.observe(advertisement,reply,now+15001),[]);
  discovery.clear();
  assert.equal(discovery.listener(2,1,27760),false);
});

test('STK rejects malformed requests, unsafe listeners and malformed version 6 advertisements',()=>{
  assert.equal(stkDiscoveryMessage(query.subarray(1),header),undefined);
  assert.equal(stkDiscoveryMessage(query,{...header,proto:'TCP'}),undefined);
  assert.equal(stkDiscoveryMessage(query,{...header,dport:27015}),undefined);
  assert.equal(stkDiscoveryMessage(query,{...header,dst:1}),undefined);
  const packet=answer(),end=5+packet[4];
  for(const h of [{...reply,sport:27015},{...reply,dst:255},{...reply,proto:'TCP'}]){
    assert.equal(stkDiscoveryMessage(packet,h),undefined);
  }
  for(let n=0;n<packet.length;n++)assert.equal(stkDiscoveryMessage(packet.subarray(0,n),reply),undefined);
  for(const [offset,value] of [[3,7],[4,250],[5,255],[end,0],[end+1,9],[end+4,4],[end+5,9],[end+6,2],[end+7,2],[end+8,1]]){
    const bad=Buffer.from(packet);bad[offset]=value;
    assert.equal(stkDiscoveryMessage(bad,reply),undefined);
  }
  for(const unsafe of [0,80,5353]){
    const bad=Buffer.from(packet);bad.writeUInt16BE(unsafe,end+2);
    assert.equal(stkDiscoveryMessage(bad,reply),undefined);
  }
  assert.equal(stkDiscoveryMessage(Buffer.concat([packet,Buffer.from([0])]),reply),undefined);
  const withTrack=Buffer.from(packet);withTrack[end+8]=3;
  assert.equal(stkDiscoveryMessage(Buffer.concat([withTrack,Buffer.from('stk')]),reply).session.port,27760);
});
