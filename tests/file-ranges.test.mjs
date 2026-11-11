import test from 'node:test';
import assert from 'node:assert/strict';
import {FRAME,RANGE,frame,unpack,RangeSender} from '../src/renderer/file-ranges.mjs';
import {RoomFiles} from '../src/renderer/room-files.mjs';
import {randomUUID} from 'node:crypto';

for (const failRead of [false, true]) {
  test('withdrawing an attachment during a pending read preserves the next file, read failed: '+failRead, async t => {
    const withdrawn=randomUUID(), keep=randomUUID(), errors=[], sent=[], loads=[];
    let finishRead;
    const pending=new Promise((resolve,reject)=>{finishRead=()=>failRead?reject(Error('removed')):resolve(new Uint8Array(FRAME));});
    const shelf=new RoomFiles({role:'host',selfId:'host'},async r=>{
      if(r.op==='read-range'){
        loads.push(r.id);
        return r.id===withdrawn ? pending : new Uint8Array(r.length).fill(7);
      }
    },()=>{},e=>errors.push(String(e)));
    t.after(()=>shelf.close());
    const ch={label:'link-files-v1',readyState:'open',bufferedAmount:0,close(){},
      send(bytes){if(typeof bytes!=='string')sent.push(unpack(bytes.buffer));}};
    shelf.attach('guest',ch);
    await shelf.message('guest',{op:'capabilities',ranges:1});
    for(const id of [withdrawn,keep])shelf.publish({id,name:id+'.bin',size:2*FRAME,sha:'0'.repeat(64)});
    for(const [id,pos] of [[withdrawn,0],[withdrawn,FRAME],[keep,0]]){
      await shelf.message('guest',{op:'range',id,pos,length:FRAME});
    }
    shelf.withdraw(withdrawn);
    finishRead();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(sent.map(p=>p.id),[keep]);
    assert.deepEqual(loads,[withdrawn,keep]);
    assert.equal(sent[0].bytes.length,FRAME);
    assert(sent[0].bytes.every(b=>b===7));
    assert.deepEqual(errors,[]);
  });
}

test('Range sender drains bounded frames after backpressure and closes outstanding work',async()=>{
  const chunks=[],id=randomUUID(),ch={readyState:'open',bufferedAmount:1024**2,send:data=>chunks.push(unpack(data.buffer))};
  const sender=new RangeSender(ch,async()=>new Uint8Array(RANGE),assert.fail);
  sender.request(id,FRAME,RANGE);assert.equal(chunks.length,0);ch.bufferedAmount=0;await ch.onbufferedamountlow();
  assert.equal(chunks.length,12);assert(chunks.every((c,i)=>c.pos===(i+1)*FRAME&&c.id===id&&c.bytes.length===FRAME));
  for(const pos of [1,-1,Infinity])assert.equal(unpack(frame(id,pos,new Uint8Array(1)).buffer),undefined);
  sender.close();assert.equal(ch.onbufferedamountlow,null);
});
test('Old host can fetch from a guest without a forwarded requester field',async()=>{
  const api=async req=>req.op==='read'?'AQ==':null,id=randomUUID();
  const room=new RoomFiles({role:'guest',selfId:'guest',hostId:'host'},api);
  try{
    const sent=[];room.send=(to,m)=>{sent.push({to,...m});return true;};room.local.add(id);room.entries.set(id,{id,author:'guest',size:1});
    await room.message('host',{op:'pull',id,pos:0});
    assert.deepEqual(sent,[{to:'host',op:'block',id,pos:0,data:'AQ==',who:'host'}]);
  }finally{room.close();}
});
