'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {ProtectedAudio}=require('../src/protected-audio.cjs');
function fixture(){
  const children=[];
  const audio=new ProtectedAudio(()=>{
    const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stdin:new PassThrough(),kill(){this.killed=true;}});
    children.push(child);return child;
  });
  return {audio,children};
}
test('fragmented native handshake and PCM frames remain aligned; excess frames are discarded',async()=>{
  const {audio,children}=fixture();const started=audio.start('a'),child=children[0];
  child.stdout.write(Buffer.from('CCP'));child.stdout.write(Buffer.from('CM01\n'));await started;
  child.stdout.write(Buffer.from([1,2,3]));const read=audio.read('a');child.stdout.write(Buffer.from([4,5,6]));
  assert.deepEqual([...await read],[1,2,3,4]);
  child.stdout.write(Buffer.alloc(24000,7));child.stdout.write(Buffer.from([8,9]));
  let bytes=0;
  while(audio.current.buffer.length>=4){const block=await audio.read('a');assert.equal(block.length%4,0);bytes+=block.length;}
  assert(bytes<=5760);audio.stop();assert(child.killed);
});
test('after a stalled read only the latest 30 ms of complete stereo frames remain',async()=>{
  const {audio,children}=fixture(),started=audio.start('screen'),pcm=Buffer.alloc(4800*4);
  const child=children[0];child.stdout.write(Buffer.from('CCPCM01\n'));await started;
  for(let i=0;i<4800;i++){
    pcm.writeInt16LE(i,4*i);pcm.writeInt16LE(-i,4*i+2);
  }
  // Include a partial frame from the next packet to exercise byte alignment.
  child.stdout.write(pcm.subarray(0,4111));child.stdout.write(pcm.subarray(4111));
  child.stdout.write(Buffer.from([1,2]));
  const recent=Buffer.from(await audio.read('screen'));
  assert.equal(recent.length,1439*4);
  assert.deepEqual(recent,pcm.subarray(pcm.length-recent.length));
  child.stdout.write(Buffer.from([3,4]));
  assert.deepEqual([...await audio.read('screen')],[1,2,3,4]);audio.stop();
});
test('fault, invalid native header and stale tokens cannot publish or stop a replacement',async()=>{
  const {audio,children}=fixture();
  const bad=audio.start('old');children[0].stdout.write(Buffer.from('unfiltered'));await assert.rejects(bad);assert(children[0].killed);
  const first=audio.start('a');children[1].stdout.write(Buffer.from('CCPCM01\n'));await first;
  const pending=audio.read('a'), second=audio.start('b');children[2].stdout.write(Buffer.from('CCPCM01\n'));await second;
  assert.equal((await pending).length,0);assert.throws(()=>audio.read('a'));audio.stop('a');assert(!children[2].killed);
  children[1].emit('exit',0);assert.equal(audio.current.token,'b');
  children[2].emit('exit',1);assert.throws(()=>audio.read('b'));
});
