import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {RoomFiles} from '../src/renderer/room-files.mjs';
import {FRAME} from '../src/renderer/file-ranges.mjs';
import {ShelfStorage} from '../src/files/storage.cjs';
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function receiver(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'link-incoming-')),store=new ShelfStorage(dir);
  const ops={begin:r=>store.begin(r.meta,'Lobby'),'put-range':r=>store.putBytes(r.id,r.pos,r.bytes),cancel:r=>store.cancel(r.id),clear:()=>store.close()};
  const shelf=new RoomFiles({role:'guest',selfId:'receiver',hostId:'host'},r=>Promise.resolve(ops[r.op](r)));
  t.after(async()=>{shelf.close();await store.close();await rm(dir,{recursive:true,force:true});});
  const attach=()=>{const ch={label:'link-files-v1',readyState:'open',bufferedAmount:0,send(){},close(){this.readyState='closed';}};shelf.attach('host',ch);ch.onopen();return ch;};
  const data=Buffer.alloc(FRAME*3+3,0x2a),meta={op:'offer',author:'host',id:randomUUID(),name:'Build.zip',size:data.length,sha:createHash('sha256').update(data).digest('hex')};
  const ch=attach();await shelf.message('host',{op:'capabilities',ranges:1});await shelf.message('host',meta);
  const entry=shelf.entries.get(meta.id);await shelf.start(entry);await shelf.receive(entry,0,data.subarray(0,FRAME));
  return {dir,store,shelf,ch,attach,data,entry,meta};
}
test('temporary file-channel loss resumes the same download with verified bytes and no duplicate file',async t=>{
  const {dir,store,shelf,ch,attach,data,entry,meta}=await receiver(t);
  const d=shelf.downloads.get(meta.id),token=d.token;ch.readyState='closed';ch.onclose();
  assert(d.unavailableSince);attach();await shelf.message('host',{op:'capabilities',ranges:1});
  await shelf.message('host',{...meta,sha:'1'.repeat(64)});assert(!shelf.entries.has(meta.id));
  await shelf.message('host',meta);assert.equal(d.unavailableSince,0);assert.equal(d.token,token);
  assert.equal(d.pos,FRAME);
  for(let i=FRAME;i<data.length;i+=FRAME)await shelf.receive(entry,i,data.subarray(i,i+FRAME));
  assert.deepEqual(await readFile(d.final),data);assert.deepEqual(await readdir(path.join(dir,'CRAFTCODE LINK','Lobby')),['Build.zip']);assert.equal(store.incoming.size,0);
});
test('a withdrawn or timed-out partial download releases its disk file and handle',async t=>{
  const {dir,store,shelf,meta}=await receiver(t);
  await shelf.message('host',{op:'gone',id:meta.id});
  assert.equal(store.incoming.size,0);assert.deepEqual(await readdir(path.join(dir,'CRAFTCODE LINK','Lobby')),[]);
});
test('manual pause survives a replacement channel and a late close event from its predecessor',async t=>{
  const {shelf,ch,attach,meta}=await receiver(t);const d=shelf.downloads.get(meta.id);
  d.paused=true;ch.readyState='closed';ch.onclose();const next=attach();
  await shelf.message('host',meta);ch.onclose();
  assert.equal(shelf.channels.get('host'),next);assert(d.paused);assert.equal(d.pending.size,0);
});
test('an interrupted download expires and frees the temporary file',async t=>{
  const {shelf,ch,meta,store,dir}=await receiver(t);ch.onclose();
  const d=shelf.downloads.get(meta.id);shelf.maintain(d.unavailableSince+60001);
  for(let i=0;i<100&&store.incoming.size;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(store.incoming.size,0);assert.deepEqual(await readdir(path.join(dir,'CRAFTCODE LINK','Lobby')),[]);
});

function fileChannel(shelf,peer){
  const messages=[];
  const channel={label:'link-files-v1',readyState:'open',bufferedAmount:0,
    send(data){messages.push(JSON.parse(data));},close(){this.readyState='closed';}};
  shelf.attach(peer,channel);
  channel.onopen();
  return {channel,messages};
}

test('a withdrawal made while the file channel is down releases the partial as soon as contact returns',async t=>{
  const {shelf,ch,store,dir,meta,attach}=await receiver(t);
  const author=new RoomFiles({role:'host',selfId:'host'},async()=>{});
  t.after(()=>author.close());
  author.publish(meta);
  const first=fileChannel(author,'receiver');
  ch.onclose();first.channel.onclose();
  author.withdraw(meta.id);
  assert.equal(store.incoming.size,1);
  attach();
  for(const packet of fileChannel(author,'receiver').messages)await shelf.message('host',packet);
  assert.equal(store.incoming.size,0);
  assert.deepEqual(await readdir(path.join(dir,'CRAFTCODE LINK','Lobby')),[]);
});

test('a returning guest reconciles only the authors whose inventory the host actually received',async t=>{
  const {shelf,ch,store,meta,attach}=await receiver(t);
  const host=new RoomFiles({role:'host',selfId:'host'},async()=>{});
  const author=new RoomFiles({role:'guest',selfId:'other',hostId:'host'},async()=>{});
  t.after(()=>{host.close();author.close();});
  // The host download is unrelated to the file offered by the second guest.
  const relayed={...meta,id:randomUUID(),author:'other'};
  author.publish(relayed);
  fileChannel(host,'other');
  for(const packet of fileChannel(author,'host').messages)await host.message('other',packet);
  await shelf.message('host',relayed);
  await shelf.start(shelf.entries.get(relayed.id));
  ch.onclose();
  assert.equal(store.incoming.size,2);
  host.publish(meta);
  host.detach('other');author.detach('host');author.withdraw(relayed.id);
  attach();
  for(const packet of fileChannel(host,'receiver').messages)await shelf.message('host',packet);
  assert(shelf.downloads.get(relayed.id).unavailableSince);
  assert.equal(store.incoming.size,2);
  fileChannel(host,'other');
  const downstream=host.channels.get('receiver');
  const forwarded=[];
  downstream.send=data=>forwarded.push(JSON.parse(data));
  for(const packet of fileChannel(author,'host').messages)await host.message('other',packet);
  for(const packet of forwarded)await shelf.message('host',packet);
  assert.equal(store.incoming.size,1);
  assert(!shelf.downloads.has(relayed.id));
  assert(shelf.downloads.has(meta.id));
});

test('a returning guest sees current offers from confirmed authors and cannot revoke another author’s files',async t=>{
  const host=new RoomFiles({role:'host',selfId:'host'},async()=>{});
  t.after(()=>host.close());
  const original=randomUUID(),replacement=randomUUID();
  const offer=id=>({op:'offer',id,name:'file.bin',size:3,sha:'0'.repeat(64)});
  fileChannel(host,'author');fileChannel(host,'legacy');fileChannel(host,'neighbor');
  await host.message('author',offer(original));
  await host.message('legacy',offer(randomUUID()));
  await host.message('neighbor',{op:'inventory',author:'author',ids:[]});
  await host.message('author',{op:'inventory',author:'author',ids:[original]});
  await host.message('author',{op:'gone',id:original});
  await host.message('author',offer(replacement));
  const current=fileChannel(host,'returning').messages.filter(m=>m.op==='inventory');
  assert.deepEqual(current,[{op:'inventory',author:'host',ids:[]},{op:'inventory',author:'author',ids:[replacement]}]);
});

test('a missing source is withdrawn once and removes the unavailable offer for other users',async t=>{
  const sent=[],removed=[];
  const shelf=new RoomFiles({role:'host',selfId:'me'},async r=>{
    if(r.op==='read-range')throw Error('Missing file');
    if(r.op==='remove')removed.push(r.id);
  });
  t.after(()=>shelf.close());
  const channel={label:'link-files-v1',readyState:'open',bufferedAmount:0,send:data=>sent.push(JSON.parse(data)),close(){}};
  shelf.attach('guest',channel);const id=randomUUID();shelf.publish({id,name:'demo.zip',size:123,sha:'0'.repeat(64)});
  await assert.rejects(shelf.readShared({op:'read-range',id,pos:0,length:123}));
  assert.equal(shelf.local.size,0);assert(!shelf.entries.size);assert.deepEqual(removed,[id]);
  assert.deepEqual(sent.at(-1),{op:'gone',id});
});

test('a silent open channel frees a stalled download while an intentional pause is preserved',async t=>{
  const {shelf,meta,store}=await receiver(t),d=shelf.downloads.get(meta.id);
  d.paused=true;shelf.maintain(d.lastData+65000);assert.equal(store.incoming.size,1);
  d.paused=false;shelf.maintain(d.lastData+65000);
  for(let i=0;i<100&&store.incoming.size;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(store.incoming.size,0);assert(shelf.entries.has(meta.id));
});
