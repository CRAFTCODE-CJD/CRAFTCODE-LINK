'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),tls=require('node:tls');
const crypto=require('node:crypto'),{once}=require('node:events');
const {setTimeout:delay}=require('node:timers/promises');
const {DirectService}=require('../src/direct/service.cjs');
const {ProfileStore,friend}=require('../src/direct/identity.cjs');
const {chatCommand}=require('../src/direct/personal-chats.cjs');
const {createRoomCertificate,fingerprintOf}=require('../src/core/certificate.cjs');

const certificate=createRoomCertificate();
const history=(s,peer)=>chatCommand(s,{op:'chat-history',id:peer.me.id});
const send=(s,peer,text,clientId=crypto.randomUUID())=>chatCommand(s,{op:'chat-send',id:peer.me.id,text,clientId});
async function wait(check){
  const deadline=Date.now()+6000;
  while(!check()){if(Date.now()>deadline)throw Error('Timed out: '+check);await delay(10);}
}
function lab(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'link-personal-')),services=[];
  const key=crypto.randomBytes(32);
  const encryption={
    isEncryptionAvailable:()=>true,
    encryptString(text){
      const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);
      return Buffer.concat([nonce,cipher.update(text,'utf8'),cipher.final(),cipher.getAuthTag()]);
    },
    decryptString(b){
      const dec=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));dec.setAuthTag(b.subarray(-16));
      return Buffer.concat([dec.update(b.subarray(12,-16)),dec.final()]).toString('utf8');
    }
  };
  t.after(async()=>{await Promise.all(services.map(s=>s.stop()));fs.rmSync(root,{recursive:true,force:true});});
  return (dir,name,attachmentIO)=>{
    const store=new ProfileStore(path.join(root,dir),encryption),events=[];
    const service=new DirectService({store,attachmentIO,nics:()=>[],chatEvent:e=>events.push(e)});
    services.push(service);service.start();if(name)service.create(name);
    service.chatEvents=events;return service;
  };
}
async function connect(a,b){
  const cert=await certificate;
  const binding=s=>s.exportKeyingMaterial(32,'CRAFTCODE LINK LAN').toString('hex');
  const server=tls.createServer({key:cert.key,cert:cert.cert,minVersion:'TLSv1.3'},sock=>a.attach(sock,'lan',binding(sock),b.me.id,b.me.device));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const sock=tls.connect({host:'127.0.0.1',port:server.address().port,minVersion:'TLSv1.3',rejectUnauthorized:false});
    await once(sock,'secureConnect');assert.equal(fingerprintOf(sock.getPeerCertificate().raw),cert.fingerprint);
    b.attach(sock,'lan',binding(sock),a.me.id,a.me.device);
    await wait(()=>a.linksTo(b.me.id).some(l=>l.card.device===b.me.device) && b.linksTo(a.me.id).length);
  }finally{server.close();}
}
async function befriend(a,b){
  a.add(b.card());await connect(a,b);await wait(()=>b.requests.has(a.me.id));b.answer(a.me.id,true);
  await wait(()=>a.snapshot().friends[0]?.chat.supported && b.snapshot().friends[0]?.chat.supported);
}

test('measured private attachment transfer over loopback TLS verifies every received byte',async t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'link-dm-rate-')),open=lab(t);
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const data=crypto.randomBytes(2*1024*1024),source=path.join(temp,'sample.bin');fs.writeFileSync(source,data);
  const io={downloads:()=>temp,choose:async()=>source,reveal:p=>p};
  const a=open('a','Sender',io),b=open('b','Recipient',io);await befriend(a,b);
  const action=(s,peer,action,more={})=>chatCommand(s,{op:'chat-attachment',profileId:s.me.id,id:peer.me.id,action,...more});
  await action(a,b,'offer');await wait(()=>history(b,a).messages.length);
  const messageId=history(b,a).messages[0].id,start=performance.now();
  await action(b,a,'download',{messageId});await wait(()=>history(b,a).messages[0].attachment.state==='saved');
  const elapsed=performance.now()-start;
  assert.deepEqual(fs.readFileSync(await action(b,a,'reveal',{messageId})),data);
  t.diagnostic(`2 MiB, loopback TLS, explicit download to verified save: ${Math.round(elapsed)} ms (${(2000/elapsed).toFixed(2)} MiB/s)`);
});

test('identity comparison is symmetric, local, durable and tied to the exact profile and certified device list',async t=>{
  const open=lab(t);let a=open('verify-a','A'),b=open('verify-b','B');
  await befriend(a,b);
  const report=(s,p)=>chatCommand(s,{op:'chat-security',profileId:s.me.id,id:p.me.id});
  const verify=(s,p,fingerprint,verified,devices=report(s,p).devices.map(d=>d.id))=>
    chatCommand(s,{op:'chat-verify',profileId:s.me.id,id:p.me.id,fingerprint,verified,devices});
  const first=report(a,b),second=report(b,a);
  assert.equal(first.code,second.code);assert.match(first.code,/^(?:[A-F0-9]{8} ){7}[A-F0-9]{8}$/);
  assert.equal(first.verifiedAt,null);assert.equal(first.connection,'encrypted');assert.deepEqual(first.transports,['TLS1.3']);
  assert.equal(first.localStorageProtected,true);
  assert.throws(()=>verify(a,b,'0'.repeat(64),true));assert.throws(()=>verify(a,b,first.fingerprint,'yes'));
  assert.throws(()=>chatCommand(a,{op:'chat-verify',profileId:a.me.id,id:b.me.id,fingerprint:first.fingerprint,verified:true}));
  assert.throws(()=>chatCommand(a,{op:'chat-verify',id:b.me.id,fingerprint:first.fingerprint,verified:true}));
  assert.throws(()=>chatCommand(a,{op:'chat-security',profileId:b.me.id,id:b.me.id}));
  assert.throws(()=>chatCommand(a,{op:'chat-security',profileId:a.me.id,id:b.me.id,root:a.profile.root}));
  const marked=verify(a,b,first.fingerprint,true);assert(marked.verifiedAt>0);assert(marked.devices.every(d=>d.checked));
  assert.equal(report(b,a).verifiedAt,null);
  const epoch=a.chats.epoch(a.contact(b.me.id));
  b.linksTo(a.me.id)[0].send({kind:'chat-verify',id:b.me.id,fingerprint:first.fingerprint,verified:false});
  await delay(20);assert.equal(report(a,b).verifiedAt,marked.verifiedAt);
  await a.stop();a=open('verify-a');assert.equal(report(a,b).verifiedAt,marked.verifiedAt);assert.equal(report(a,b).connection,'offline');
  assert.equal(a.chats.epoch(a.contact(b.me.id)),epoch);
  a.save({...a.profile,name:'Renamed'});assert.equal(report(a,b).code,first.code);
  const nextDevice=crypto.randomBytes(32).toString('hex');a.setFriend({...a.contact(b.me.id),devices:[...a.contact(b.me.id).devices,nextDevice]});
  assert(report(a,b).devicesChanged);assert(report(a,b).verifiedAt);assert(!report(a,b).devices.at(-1).checked);
  assert.throws(()=>verify(a,b,first.fingerprint,true,first.devices.map(d=>d.id)),/Список устройств изменился/);
  assert.equal(report(a,b).verifiedAt,marked.verifiedAt);assert(report(a,b).devicesChanged);
  assert.throws(()=>verify(a,b,first.fingerprint,true,[first.devices[0].id,first.devices[0].id]),/Список устройств изменился/);
  verify(a,b,first.fingerprint,true);assert(!report(a,b).devicesChanged);
  chatCommand(a,{op:'chat-verify',profileId:a.me.id,id:b.me.id,fingerprint:first.fingerprint,verified:false});
  assert.equal(report(a,b).verifiedAt,null);
  verify(a,b,first.fingerprint,true);
  const exported=await a.export('private verification password');
  const {unseal}=require('../src/direct/identity.cjs');assert.equal((await unseal(exported,'private verification password')).contactChecks,undefined);
  a.forget(b.me.id,true);assert.equal(a.profile.contactChecks[b.me.id],undefined);assert.throws(()=>report(a,b));
  const state=JSON.stringify(marked);assert(!state.includes(a.profile.root));assert(!state.includes(a.profile.device));
});

test('encrypted history rejects cross-dialog ciphertext substitution and modified authentication tags',t=>{
  const open=lab(t),a=open('encrypted-a','A'),b=open('encrypted-b','B'),c=open('encrypted-c','C');
  for(const peer of [b,c])a.setFriend(friend(peer.me,'friend'));
  send(a,b,'Confidential fixture message for B');send(a,c,'Confidential fixture message for C');
  const db=a.chats.storage.db,rows=db.prepare('SELECT n,payload FROM messages ORDER BY n').all();
  assert.equal(rows.length,2);
  assert(!fs.readFileSync(a.chats.storage.file).includes(Buffer.from('Confidential fixture')));
  db.prepare('UPDATE messages SET payload=? WHERE n=?').run(rows[1].payload,rows[0].n);
  assert.throws(()=>history(a,b));assert.equal(history(a,c).messages[0].text,'Confidential fixture message for C');
  const modified=Buffer.from(rows[0].payload);modified[modified.length-1]^=1;
  db.prepare('UPDATE messages SET payload=? WHERE n=?').run(modified,rows[0].n);assert.throws(()=>history(a,b));
  db.prepare('UPDATE messages SET payload=? WHERE n=?').run(rows[0].payload,rows[0].n);
  assert.equal(history(a,b).messages[0].text,'Confidential fixture message for B');
});

test('offline text, immutable files, images and recordings survive restart and wait for explicit download',async t=>{
  const open=lab(t),root=fs.mkdtempSync(path.join(os.tmpdir(),'link-offline-files-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,'archive.zip'),downloads=path.join(root,'downloads');fs.mkdirSync(downloads);
  const data=crypto.randomBytes(740000),photo=Buffer.from('89504e470d0a1a0a0123','hex');fs.writeFileSync(source,data);
  const io={downloads:()=>downloads,choose:async()=>source,reveal:p=>p,askCamera:async()=>true};
  let a=open('sender','Sender',io),b=open('recipient','Recipient',io);await befriend(a,b);
  await b.stop();await wait(()=>!a.linksTo(b.me.id).length);
  const command=(s,p,action,more={})=>chatCommand(s,{op:'chat-attachment',id:p.me.id,profileId:s.me.id,action,...more});
  const voice=Buffer.concat([Buffer.from('1a45dfa3','hex'),crypto.randomBytes(93)]),circle=Buffer.concat([voice,Buffer.from('circle')]);
  send(a,b,'Offline text');await command(a,b,'offer');await a.chats.files.offer(b.me.id,undefined,undefined,{name:'Image.png',bytes:photo},'Photo caption');
  for(const [kind,bytes] of [['voice',voice],['circle',circle]])await command(a,b,'clip',{kind,bytes});
  const requestId=crypto.randomUUID();assert(await command(a,b,'camera',{requestId}));await command(a,b,'camera-end',{requestId});
  assert(history(a,b).messages.every(m=>m.status==='pending'));fs.unlinkSync(source);
  assert(!fs.readFileSync(a.chats.storage.file).includes(data.subarray(0,64)));
  await a.stop();a=open('sender',undefined,io);b=open('recipient',undefined,io);
  await connect(a,b);await wait(()=>history(a,b).messages.every(m=>m.status==='delivered'));
  const rows=history(b,a).messages;assert.equal(rows.length,5);assert.equal(rows[0].text,'Offline text');assert.equal(rows[2].text,'Photo caption');
  assert.deepEqual(fs.readdirSync(downloads),[]);
  for(const [index,expected] of [data,photo,voice,circle].entries()){
    const messageId=rows[index+1].id;await command(b,a,'download',{messageId});
    await wait(()=>history(b,a).messages.find(m=>m.id===messageId).attachment.state==='saved');
    assert.deepEqual(fs.readFileSync(await command(b,a,'reveal',{messageId})),expected);
  }
  await command(a,b,'withdraw',{messageId:rows[1].id});
  assert.equal(a.chats.storage.db.prepare('SELECT count(*) AS n FROM attachment_parts').get().n,0);
  await b.stop();await wait(()=>!a.linksTo(b.me.id).length);fs.writeFileSync(source,data);
  await command(a,b,'offer');assert(a.chats.storage.db.prepare('SELECT count(*) AS n FROM attachment_parts').get().n>0);
  a.forget(b.me.id,true);assert.equal(a.chats.storage.db.prepare('SELECT count(*) AS n FROM attachment_parts').get().n,0);
  assert.deepEqual(fs.readFileSync(source),data);
});

test('only visible messages acknowledged by their addressed device gain read receipts, including after offline restart',async t=>{
  const open=lab(t);let a=open('a','A'),b=open('b','B');await befriend(a,b);
  const ids=[crypto.randomUUID(),crypto.randomUUID()];send(a,b,'First',ids[0]);send(a,b,'Second',ids[1]);
  await wait(()=>history(a,b).messages.every(m=>m.status==='delivered'));
  const through={op:'chat-read',id:a.me.id,ids:[ids[1]],profileId:b.me.id};
  assert.equal(chatCommand(b,through,false).readApplied,false);assert.equal(history(b,a).unread,2);
  const row=a.chats.storage.message(b.me.id,a.chats.epoch(a.contact(b.me.id)),ids[1]),out=a.linksTo(b.me.id)[0];
  const forged={kind:'friend-read',to:a.me.id,origin:a.me.device,items:[[row.id,row.seq]]};
  b.linksTo(a.me.id)[0].send({...forged,items:[[row.id,row.seq+1]]});b.linksTo(a.me.id)[0].send({...forged,origin:b.me.device});
  const device=crypto.randomBytes(32).toString('hex'),extra={...out,card:{...out.card,device},send:()=>true};
  a.setFriend({...a.contact(b.me.id),devices:[...a.contact(b.me.id).devices,device]});a.links.add(extra);
  a.chats.readPacket(extra,forged);a.links.delete(extra);await delay(10);
  assert(history(a,b).messages.every(m=>m.status==='delivered'));
  await a.stop();await wait(()=>!b.linksTo(a.me.id).length);
  assert.equal(chatCommand(b,through).unread,1);await b.stop();b=open('b');a=open('a');await connect(a,b);
  await wait(()=>history(a,b).messages[1].status==='read');assert.equal(history(a,b).messages[0].status,'delivered');
  await wait(()=>b.chats.storage.db.prepare('SELECT count(*) AS n FROM message_reads').get().n===1);
  assert.equal(history(b,a).unread,1);await a.stop();a=open('a');assert.equal(history(a,b).messages[1].status,'read');
});

test('legacy peers use the original block size and delivery receipt without claiming a read',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'link-legacy-files-')),open=lab(t);
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const filename=path.join(root,'file.bin'),bytes=crypto.randomBytes(95000);fs.writeFileSync(filename,bytes);
  const io={downloads:()=>root,choose:async()=>filename,reveal:p=>p};
  const a=open('a','A',io),b=open('b','B',io);
  for(const s of [a,b]){
    const signal=s.friendSignal.bind(s);s.friendSignal=kind=>{const m=signal(kind);delete m.readReceipts;delete m.fileChunks;return m;};
  }
  await befriend(a,b);
  const link=a.linksTo(b.me.id)[0],send=link.send.bind(link),blocks=[];
  link.send=m=>{if(m.kind==='friend-file'&&typeof m.data==='string')blocks.push([m.op,m.data.length]);return send(m);};
  const cmd=(s,p,action,fields={})=>chatCommand(s,{op:'chat-attachment',profileId:s.me.id,id:p.me.id,action,...fields});
  await cmd(a,b,'offer');await wait(()=>history(a,b).messages[0]?.status==='delivered');
  const messageId=history(a,b).messages[0].id;chatCommand(b,{op:'chat-read',id:a.me.id,ids:[messageId]});
  await cmd(b,a,'download',{messageId});await wait(()=>history(b,a).messages[0].attachment.state==='saved');
  assert.deepEqual(fs.readFileSync(await cmd(b,a,'reveal',{messageId})),bytes);
  assert.equal(blocks.length,4);assert(blocks.every(([op,size])=>op==='block'&&size<=32768));
  assert.equal(history(a,b).messages[0].status,'delivered');
});

test('private attachments require a confirmed peer and a receiver click; TLS transfer, restart, retries, revoke and cleanup use real files',async t=>{
  const open=lab(t),temp=fs.mkdtempSync(path.join(os.tmpdir(),'link-dm-attachments-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const downloads=path.join(temp,'received'),fixture=path.join(temp,'Photo.png');
  fs.mkdirSync(downloads);
  const payload=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),crypto.randomBytes(512*1024+19)]);
  fs.writeFileSync(fixture,payload);
  const io={downloads:()=>downloads,choose:async()=>fixture,askCamera:async()=>false,reveal:name=>name};
  const call=(s,peer,action,fields={})=>chatCommand(s,{op:'chat-attachment',profileId:s.me.id,id:peer.me.id,action,...fields});
  let a=open('a','Anna',io),b=open('b','Boris',io);
  await assert.rejects(call(a,b,'offer'));await befriend(a,b);
  assert.throws(()=>chatCommand(a,{op:'chat-attachment',profileId:b.me.id,id:b.me.id,action:'offer'}));
  await assert.rejects(call(a,b,'offer',{path:fixture}));assert.equal(await call(a,b,'camera',{requestId:crypto.randomUUID()}),false);
  const offer=async()=>{
    const previous=history(b,a).messages.at(-1)?.id;await call(a,b,'offer');
    await wait(()=>history(b,a).messages.at(-1)?.id!==previous);
    return history(b,a).messages.at(-1);
  };
  const first=await offer(), fields={messageId:first.id};
  assert.equal(first.attachment.state,'offered');assert.deepEqual(fs.readdirSync(downloads),[]);
  await assert.rejects(call(b,a,'preview',fields));await assert.rejects(call(b,a,'reveal',fields));
  assert.equal(first.attachment.sha,crypto.createHash('sha256').update(payload).digest('hex'));
  assert.equal(fs.readFileSync(a.store.chatHistory.file).includes(Buffer.from(fixture)),false);
  await a.stop();await wait(()=>b.linksTo(a.me.id).length===0);a=open('a',undefined,io);await connect(a,b);
  await wait(()=>history(b,a).messages[0].attachment.state==='offered');
  await call(b,a,'download',fields);
  await wait(()=>history(b,a).messages[0].attachment.state==='saved');
  const location=await call(b,a,'reveal',fields);
  assert.deepEqual(fs.readFileSync(location),payload);
  const photo=await call(b,a,'preview',fields);assert.equal(photo.type,'image/png');assert.deepEqual(photo.bytes,payload);
  b.strict=true;
  assert.deepEqual((await call(b,a,'preview',fields)).bytes,payload);
  assert.equal(await call(b,a,'reveal',fields),location);
  await assert.rejects(call(b,a,'offer'));
  b.strict=false;
  assert.equal(fs.readFileSync(b.store.chatHistory.file).includes(Buffer.from(location)),false);
  const second=await offer(),id2={messageId:second.id},folder=path.dirname(location);
  await call(b,a,'download',id2);await wait(()=>history(b,a).messages.at(-1).attachment.pos>0);
  await call(b,a,'cancel',id2);assert.deepEqual(fs.readdirSync(folder),[path.basename(location)]);
  fs.writeFileSync(fixture,Buffer.from('source was replaced'));
  await call(b,a,'download',id2);await wait(()=>history(b,a).messages.at(-1).attachment.state==='failed');
  await wait(()=>fs.readdirSync(folder).length===1);
  assert.deepEqual(fs.readdirSync(folder),[path.basename(location)]);
  fs.writeFileSync(fixture,payload);
  await call(b,a,'download',id2);await wait(()=>history(b,a).messages.at(-1).attachment.pos>0);
  await call(a,b,'withdraw',id2);await wait(()=>history(b,a).messages.at(-1).attachment.state==='withdrawn');
  await wait(()=>fs.readdirSync(folder).length===1);await assert.rejects(call(b,a,'download',id2));
  const clip=Buffer.concat([Buffer.from('1a45dfa3','hex'),crypto.randomBytes(32000)]);
  await call(a,b,'clip',{kind:'voice',bytes:clip});
  await wait(()=>history(b,a).messages.at(-1).attachment.clip==='voice');
  const clipId={messageId:history(b,a).messages.at(-1).id};
  await a.stop();await wait(()=>b.linksTo(a.me.id).length===0);a=open('a',undefined,io);await connect(a,b);
  await wait(()=>a.snapshot().friends[0].chat.files);
  const localClip=await call(a,b,'preview',clipId);assert.deepEqual(localClip.bytes,clip);
  await call(b,a,'download',clipId);await wait(()=>history(b,a).messages.at(-1).attachment.state==='saved');
  assert.deepEqual((await call(b,a,'preview',clipId)).bytes,clip);
  const offlineOffer=await offer();
  await wait(()=>history(a,b).messages.at(-1).status==='delivered');
  await a.stop();await wait(()=>b.linksTo(a.me.id).length===0);a=open('a',undefined,io);a.strict=true;
  await call(a,b,'withdraw',{messageId:offlineOffer.id});
  assert.equal(history(a,b).messages.at(-1).attachment.state,'withdrawn');a.strict=false;
  await connect(a,b);await wait(()=>history(b,a).messages.at(-1).attachment.state==='offered');
  await call(b,a,'download',{messageId:offlineOffer.id});await wait(()=>history(b,a).messages.at(-1).attachment.state==='withdrawn');
  await offer();
  const third={messageId:history(b,a).messages.at(-1).id};
  await call(b,a,'download',third);await wait(()=>history(b,a).messages.at(-1).attachment.pos>0);
  b.forget(a.me.id,true);await wait(()=>fs.readdirSync(folder).every(name=>!name.endsWith('.part')));
  await assert.rejects(call(b,a,'download',third));assert.equal(b.chats.footprint().messages,0);
  assert.equal(a.store.chatHistory.db.prepare("SELECT count(*) AS n FROM attachment_data WHERE kind='clip'").get().n,1);
  chatCommand(a,{op:'chat-clear',id:b.me.id});
  assert.equal(a.store.chatHistory.db.prepare('SELECT count(*) AS n FROM attachment_data').get().n,0);
});

test('optional local download cleanup survives text clears and restart, respects other offers, modified files and pre-index history',async t=>{
  const open=lab(t), temp=fs.mkdtempSync(path.join(os.tmpdir(),'link-clean-downloads-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const original=path.join(temp,'original.txt');
  fs.writeFileSync(original,'user-owned file');
  let chosen=original;
  const io={downloads:()=>temp,choose:async()=>chosen,reveal:filename=>filename};
  const a=open('first','Ann',io),c=open('third','Chris',io);
  let b=open('second','Ben',io);
  await befriend(a,b);await befriend(c,b);
  const attachment=(s,peer,action,extra={})=>chatCommand(s,{op:'chat-attachment',id:peer.me.id,profileId:s.me.id,action,...extra});
  async function receive(kind){
    const before=history(b,a).messages.at(-1)?.id;
    if(kind)await attachment(a,b,'clip',{kind,bytes:Buffer.concat([Buffer.from('1a45dfa3','hex'),crypto.randomBytes(140)])});
    else await attachment(a,b,'offer');
    await wait(()=>history(b,a).messages.at(-1)?.id!==before);
    const messageId=history(b,a).messages.at(-1).id;
    await attachment(b,a,'download',{messageId});
    await wait(()=>history(b,a).messages.at(-1).attachment.state==='saved');
    return attachment(b,a,'reveal',{messageId});
  }
  const used=await receive(),voice=await receive('voice'),changed=await receive('circle');
  const keep=path.join(path.dirname(voice),'personally saved.txt');
  fs.writeFileSync(keep,'manual');fs.appendFileSync(changed,'edited');
  // This fixture has an old saved-path row with no independent receipt.
  const last=b.chats.storage.message(a.me.id,b.chats.epoch(b.contact(a.me.id)),history(b,a).messages.at(-1).id);
  b.chats.storage.forgetDownload(last.seq);
  chosen=used;await attachment(b,c,'offer');
  await wait(()=>history(c,b).messages.some(m=>m.attachment));
  const clear=(s,peer,extra={})=>chatCommand(s,{op:peer?'chat-clear':'chat-clear-all',...(peer && {id:peer.me.id}),profileId:s.me.id,...extra});
  assert.throws(()=>clear(b,a,{deleteDownloads:'yes'}));
  assert.throws(()=>clear(b,a,{deleteDownloads:true,path:original}));
  assert.throws(()=>chatCommand(b,{op:'chat-clear',id:a.me.id,deleteDownloads:true}));
  assert.equal(clear(b,a).messages.length,0);
  for(const name of [used,voice,changed,keep,original])assert(fs.existsSync(name));
  assert(b.snapshot().friends.find(f=>f.id===a.me.id).chat.downloads);
  assert(!fs.readFileSync(b.chats.storage.file).includes(Buffer.from(voice)));
  await b.stop();b=open('second',undefined,io);
  io.downloads=()=>{throw Object.assign(Error('offline volume'),{code:'EACCES'});};
  const unavailable=await clear(b,a,{deleteDownloads:true});
  assert.equal(unavailable.failed,2);assert(b.snapshot().chatStorage.downloads);
  io.downloads=()=>temp;
  const result=await clear(b,a,{deleteDownloads:true});
  assert.deepEqual(result,{removed:1,kept:2,failed:0});
  assert(!fs.existsSync(voice));assert.equal(fs.readFileSync(used,'utf8'),'user-owned file');
  assert(fs.readFileSync(changed).subarray(-6).equals(Buffer.from('edited')));
  assert.equal(history(b,c).messages.length,1);assert.equal(history(a,b).messages.length,3);
  assert.deepEqual(await clear(b,null,{deleteDownloads:true}),{removed:1,kept:0,failed:0});
  assert(!fs.existsSync(used));assert(fs.existsSync(original));assert(fs.existsSync(changed));assert(fs.existsSync(keep));
  assert(!b.snapshot().chatStorage.downloads);
  assert.deepEqual(await clear(b,null,{deleteDownloads:true}),{removed:0,kept:0,failed:0});
});

test('download cleanup checks the file identity and never follows a replaced conversation folder',async t=>{
  const {fileIdentity,removeSavedDownload}=require('../src/files/saved-download.cjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'link-clean-identity-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const person='a'.repeat(64),dir=path.join(root,'CRAFTCODE LINK','DM-'+person.slice(0,12));
  const filename=path.join(dir,'note.txt'),bytes=Buffer.from('same bytes');
  fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(filename,bytes);
  const receipt={filename,person,size:bytes.length,sha:crypto.createHash('sha256').update(bytes).digest('hex'),
    identity:fileIdentity(fs.statSync(filename,{bigint:true}))};
  fs.renameSync(filename,filename+'.original');fs.writeFileSync(filename,bytes);
  assert.equal(await removeSavedDownload(root,receipt,()=>true),'kept');
  assert.deepEqual(fs.readFileSync(filename),bytes);
  const elsewhere=path.join(root,'user folder');
  fs.renameSync(dir,elsewhere);fs.symlinkSync(elsewhere,dir,'junction');
  assert.equal(await removeSavedDownload(root,{...receipt,identity:undefined},()=>true),'kept');
  assert.deepEqual(fs.readFileSync(filename),bytes);
});

test('personal text uses confirmed TLS contacts, survives restart offline, and is ACKed only once after durable storage',async t=>{
  const open=lab(t);
  let a=open('a','Anna'),b=open('b','Boris');
  assert.throws(()=>send(a,b,'no grant'));
  await befriend(a,b);
  await b.stop();await wait(()=>!a.linksTo(b.me.id).length);
  const id=crypto.randomUUID(),text='Секретная проверка 🟢';
  assert.equal(send(a,b,text,id).messages[0].status,'pending');
  assert.equal(send(a,b,text,id).messages.length,1);
  assert.throws(()=>send(a,b,'different',id));assert.throws(()=>send(a,b,'x'.repeat(4001)));
  assert.equal(fs.readFileSync(a.store.chatHistory.file).includes(Buffer.from(text)),false);
  await a.stop();a=open('a');b=open('b');
  assert.equal(history(a,b).messages[0].status,'pending');
  await connect(a,b);
  await wait(()=>history(a,b).messages[0].status==='delivered');
  assert.deepEqual(history(b,a).messages.map(r=>[r.text,r.direction,r.id,r.status]),[[text,'in',id,'received']]);
  assert(b.chatEvents.every(e=>e.type==='direct-chat-updated'&&!('text' in e)));
  assert.equal(b.snapshot().chatStorage.bytes,fs.statSync(b.store.chatHistory.file).size);
  const second=send(a,b,'Следом').messages.at(-1);
  await wait(()=>history(b,a).unread===2);
  assert.equal(chatCommand(b,{op:'chat-read',id:a.me.id,through:id}).unread,1);
  assert.equal(chatCommand(b,{op:'chat-read',id:a.me.id,through:second.id}).unread,0);
  assert.throws(()=>chatCommand(b,{op:'chat-clear-all',profileId:a.me.id}));
  assert.throws(()=>chatCommand(b,{op:'chat-clear'}));
  assert.throws(()=>chatCommand(b,{op:'chat-clear-all',id:a.me.id}));
  b.strict=true;assert.throws(()=>send(b,a,'strict'));
  assert.equal(chatCommand(b,{op:'chat-clear',id:a.me.id,profileId:b.me.id}).messages.length,0);
  assert.equal(history(a,b).messages.length,2);
  await b.stop();b=open('b');assert.equal(history(b,a).messages.length,0);
});

test('a lost ACK, local clear and reconnect acknowledge the retry without restoring deleted text',async t=>{
  const open=lab(t);let a=open('a','Anna'),b=open('b','Boris');
  await befriend(a,b);
  const inbound=b.linksTo(a.me.id)[0],transmit=inbound.send.bind(inbound);
  inbound.send=m=>m.kind==='friend-text-ack'?true:transmit(m);
  const receive=b.store.chatHistory.receive.bind(b.store.chatHistory);
  b.store.chatHistory.receive=()=>{throw Error('disk offline');};
  const id=send(a,b,'Один раз').messages[0].id;
  await wait(()=>b.issue);
  assert.equal(history(b,a).messages.length,0);assert.equal(history(a,b).messages[0].status,'pending');
  b.store.chatHistory.receive=receive;
  // Reconnect the sender so its same durable outbox item is sent again immediately.
  await a.stop();await wait(()=>!b.linksTo(a.me.id).length);a=open('a');
  const original=b.message.bind(b);let seq;
  b.message=(link,msg)=>{
    if(msg.kind==='friend-text'){
      seq=msg.seq;
      const send=link.send.bind(link);link.send=m=>m.kind==='friend-text-ack'?true:send(m);
    }
    return original(link,msg);
  };
  await connect(a,b);await wait(()=>history(b,a).messages.length===1);
  assert.equal(history(a,b).messages[0].status,'pending');
  const link=a.linksTo(b.me.id)[0];
  a.message(link,{kind:'friend-text-ack',to:b.me.id,origin:a.me.device,id,seq});
  a.message(link,{kind:'friend-text-ack',to:a.me.id,origin:b.me.device,id,seq});
  assert.equal(history(a,b).messages[0].status,'pending');
  chatCommand(b,{op:'chat-clear-all'});await b.stop();await a.stop();a=open('a');b=open('b');
  await connect(a,b);await wait(()=>history(a,b).messages[0].status==='delivered');
  assert.equal(history(b,a).unread,0);assert.deepEqual(history(b,a).messages,[]);
});

test('SQLite full leaves earlier history intact, withholds ACK, and retries after space returns',async t=>{
  const open=lab(t);let a=open('a','Anna');const b=open('b','Boris');
  await befriend(a,b);
  send(a,b,'Сохранено');await wait(()=>history(a,b).messages[0].status==='delivered');
  const db=b.store.chatHistory.db,pages=db.prepare('PRAGMA page_count').get().page_count;
  db.exec('PRAGMA max_page_count='+pages);
  const text='界'.repeat(4000),id=send(a,b,text).messages[1].id;
  await wait(()=>b.issue==='Не удалось сохранить личную переписку на этом ПК.');
  assert.equal(history(a,b).messages[1].status,'pending');
  assert.deepEqual(history(b,a).messages.map(r=>r.text),['Сохранено']);
  assert.equal(b.snapshot().chatStorage.messages,1);
  db.exec('PRAGMA max_page_count=1000000');
  await a.stop();await wait(()=>!b.linksTo(a.me.id).length);a=open('a');
  await connect(a,b);await wait(()=>history(a,b).messages[1].status==='delivered');
  assert.deepEqual(history(b,a).messages.map(r=>r.id),history(a,b).messages.map(r=>r.id));
  assert.equal(history(b,a).messages[1].id,id);
});

test('encrypted pages retain old conversations beyond 512 messages, support stable cursors, and shrink after a local clear',async t=>{
  const open=lab(t);let a=open('a','Anna');
  const b=open('b','Boris'),c=open('c','Carol');
  for(const other of [b,c])a.setFriend(friend(other.me,'friend'));
  const sequences=new Map();
  for(const other of [b,c]){
    const ids=[],epoch=a.chats.epoch(a.contact(other.me.id));
    for(let i=0;i<270;i++){
      const id=crypto.randomUUID();
      const text=other.me.name+' '+i+' '+'a'.repeat(2000);
      a.store.chatHistory.enqueue(other.me.id,epoch,id,text);
      const {seq}=a.store.chatHistory.oldest(other.me.id,epoch);
      assert(a.store.chatHistory.acknowledge(other.me.id,epoch,id,seq));
      ids.push(id);
    }
    sequences.set(other.me.id,ids);
  }
  await a.stop();a=open('a');
  const before=a.snapshot().chatStorage;
  assert.equal(before.messages,540);
  assert.equal(before.bytes,fs.statSync(a.store.chatHistory.file).size);
  for(const other of [b,c]){
    let page=history(a,other),ids=page.messages.map(r=>r.id);
    assert.equal(ids.length,128);assert(page.hasMore);
    while(page.hasMore){
      page=chatCommand(a,{op:'chat-history',id:other.me.id,before:page.messages[0].id});
      ids=[...page.messages.map(r=>r.id),...ids];
    }
    assert.deepEqual(ids,sequences.get(other.me.id));
  }
  chatCommand(a,{op:'chat-clear',id:b.me.id});
  assert.equal(a.snapshot().chatStorage.messages,270);
  assert(a.snapshot().chatStorage.bytes<before.bytes);
  assert.equal(history(a,c).messages.length,128);
  assert.deepEqual(history(a,b).messages,[]);
  assert(chatCommand(a,{op:'chat-clear-all'}));
  assert.equal(a.snapshot().chatStorage.messages,0);
  await a.stop();a=open('a');assert.deepEqual(history(a,c).messages,[]);
});

test('two certified devices share a contact, receive once each across duplicate routes, and keep independent histories',async t=>{
  const open=lab(t),a=open('a','Anna'),b=open('b','Boris'),c=open('c');
  await befriend(a,b);
  const pass='a local transfer passphrase';
  await c.import(await b.export(pass),pass);
  assert.equal(c.me.id,b.me.id);assert.notEqual(c.me.device,b.me.device);
  await connect(a,c);await connect(a,b);
  await wait(()=>a.linksTo(b.me.id).filter(l=>l.chatCapable).length===3 && c.snapshot().friends[0].chat.supported);
  send(a,b,'Два устройства');await wait(()=>history(b,a).messages.length===1 && history(c,a).messages.length===1);
  assert.equal(history(b,a).messages[0].id,history(c,a).messages[0].id);
  send(b,a,'С первого');send(c,a,'Со второго');
  await wait(()=>history(a,b).unread===2);
  assert.deepEqual(history(a,b).messages.slice(1).map(r=>r.text).sort(),['С первого','Со второго']);
  chatCommand(c,{op:'chat-clear-all'});assert.equal(history(b,a).messages.length,2);
  await c.stop();fs.copyFileSync(b.store.chatHistory.file,c.store.chatHistory.file);
  c.start();assert.throws(()=>history(c,a),/недоступна/);
  c.store.erase();assert.equal(fs.existsSync(c.store.chatHistory.file),false);
  assert(fs.existsSync(b.store.chatHistory.file));
});

test('a damaged pending message stays isolated from the friend list and can be cleared locally',async t=>{
  const open=lab(t);let a=open('a','Anna');const b=open('b','Boris');
  a.setFriend(friend(b.me,'friend'));send(a,b,'One local message');
  a.store.chatHistory.db.exec('UPDATE messages SET payload=zeroblob(64)');
  await a.stop();a=open('a');
  const state=a.snapshot();
  assert.equal(state.friends.length,1);assert.equal(state.chatStorage.messages,1);
  assert.throws(()=>history(a,b));
  assert.equal(chatCommand(a,{op:'chat-clear',id:b.me.id}).messages.length,0);
  assert.equal(a.snapshot().chatStorage.messages,0);
});

test('blocking an offline contact cancels queued text across a restart and renewed friendship',async t=>{
  const open=lab(t);let a=open('a','Anna'),b=open('b','Boris');
  await befriend(a,b);await b.stop();await wait(()=>!a.linksTo(b.me.id).length);
  for(let i=0;i<24;i++)send(a,b,'queued '+i);
  assert.throws(()=>send(a,b,'over limit'),/заполнена/);
  a.forget(b.me.id,true);
  assert.throws(()=>send(a,b,'blocked'));assert.throws(()=>history(a,b));
  await a.stop();a=open('a');b=open('b');assert.throws(()=>send(a,b,'blocked'));
  a.unblock(b.me.id);a.add(b.card());await connect(a,b);
  await wait(()=>a.snapshot().friends[0]?.chat.supported);
  assert.deepEqual(history(a,b).messages,[]);assert.deepEqual(history(b,a).messages,[]);
  send(a,b,'После подтверждения');await wait(()=>history(a,b).messages[0].status==='delivered');
  assert.equal(history(b,a).messages[0].text,'После подтверждения');
});
