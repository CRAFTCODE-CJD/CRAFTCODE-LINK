'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),tls=require('node:tls');
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const {DirectService}=require('../src/direct/service.cjs');
const {friend,seed}=require('../src/direct/identity.cjs');
const {createRoomCertificate,fingerprintOf}=require('../src/core/certificate.cjs');
const {GroupFiles}=require('../src/groups/files.cjs');
const {GroupBlobs,validMeta,MAX}=require('../src/groups/file-blobs.cjs');
async function until(fn){for(let i=0;i<700;i++){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,12));}throw Error('Condition timed out');}

test('an authenticated connection without a current trusted device cannot read group history or join voice',async t=>{
  const {publicCard}=require('../src/direct/identity.cjs');
  const root=seed(),trusted=publicCard({root,device:seed(),name:'Member'}),other=publicCard({root,device:seed(),name:'Member'});
  const contact=friend(trusted,'friend');
  for(let i=1;i<16;i++)contact.devices.push(publicCard({root,device:seed(),name:'Member'}).device);
  let profile={root:seed(),device:seed(),name:'Host',friends:[contact],dht:false,lan:''};
  const service=new DirectService({store:{read:()=>profile,write:p=>{profile=p;}},nics:()=>[]});
  service.start();t.after(()=>service.stop());
  const groups=service.groups,{id}=await groups.command({op:'group-create',name:'Group'});
  await groups.command({op:'group-invite',id,person:trusted.id});
  await groups.perform(groups.records.get(id),trusted.id,trusted.device,'join',{});
  const [text,voice]=groups.authority(id).channels;
  await groups.command({op:'group-send',id,channel:text.id,nonce:randomUUID(),text:'private group text'});
  const received=[],link={card:other,groups:true,socket:{destroyed:false},send:p=>{received.push(p);return true;}};
  service.links.add(link);
  await groups.receive(link,{op:'request',id,epoch:1,req:randomUUID(),action:'history',args:{channel:text.id}});
  service.voiceChannels.receive(link,{message:{op:'join',group:id,channel:voice.id,ticket:randomUUID(),epoch:1}});
  assert(!received.some(p=>p.ok&&p.data?.messages?.length),'unlisted device read channel history');
  assert.equal(service.voiceChannels.rooms.size,0,'unlisted device acquired a voice seat');
  assert(!groups.fileAllowed({...link,card:trusted}),'detached link must be rejected');
});

test('unaccepted invitations and attachment offers from one friend cannot exhaust other groups',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'link-group-spam-'));
  let profile={root:seed(),device:seed(),name:'Recipient',friends:[],dht:false,lan:''};
  const service=new DirectService({store:{read:()=>profile,write:p=>{profile=p;}},nics:()=>[]});
  service.start();t.after(async()=>{await service.stop();await fs.rm(directory,{recursive:true,force:true});});
  const peer=(name)=>{
    const card=require('../src/direct/identity.cjs').publicCard({root:seed(),device:seed(),name});
    service.setFriend(friend(card,'friend'));
    const link={card,groups:true,socket:{destroyed:false,destroy(){}},send:()=>true};
    service.links.add(link);return link;
  };
  const sender=peer('Sender'),other=peer('Other'),groups=service.groups;
  groups.files=new GroupFiles(groups,{directory});
  const invite=(link)=>groups.receive(link,{op:'invite',id:randomUUID(),epoch:1,name:'Group'});
  for(let i=0;i<48;i++)await invite(sender);
  await invite(other);
  assert(groups.snapshot().invites.some(g=>g.owner===other.card.id),'another friend can still invite');
  const {id}=await groups.command({op:'group-create',name:'Owned'});
  const record=groups.records.get(id),channel=record.group.channels[0].id;
  for(const link of [sender,other]){
    await groups.perform(groups.records.get(id),service.me.id,service.me.device,'invite',{person:link.card.id});
    await groups.perform(groups.records.get(id),link.card.id,link.card.device,'join',{},link);
  }
  const offer=(link)=>groups.files.remote(link,'offer',{group:id,channel,meta:{id:randomUUID(),name:'note.txt',size:0,sha:'0'.repeat(64)}});
  for(let i=0;i<16;i++)await offer(sender).catch(()=>{});
  assert.equal(await offer(other),true,'another member can still offer a file');
});
test('group files require host acceptance and recipient download, and the next owner really receives the verified bytes',{timeout:40000},async t=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'link-group-test-')),peers=[],servers=[];
  t.after(async()=>{await Promise.allSettled(peers.map(p=>p.stop()));await Promise.all(servers.map(s=>new Promise(r=>s.close(r))));await fs.rm(base,{recursive:true,force:true,maxRetries:8,retryDelay:100});});
  const cert=await createRoomCertificate();
  async function client(name){
    const directory=path.join(base,name),downloads=path.join(directory,'Downloads');await fs.mkdir(downloads,{recursive:true});
    let p={name,root:seed(),device:seed(),friends:[],dht:false,lan:''};
    const s=new DirectService({store:{read:()=>p,write:x=>{p=x;}},nics:()=>[]});
    s.start();peers.push(s);const io={directory,downloads:()=>downloads,choose:()=>s.selected,reveal:file=>{s.revealed=file;}};
    s.groups.files=new GroupFiles(s.groups,io);return s;
  }
  async function connect(a,b){
    a.setFriend(friend(b.me,'friend'));b.setFriend(friend(a.me,'friend'));
    const attach=(s,other,socket)=>s.attach(socket,'lan',socket.exportKeyingMaterial(32,'CRAFTCODE LINK LAN').toString('hex'),other.me.id,other.me.device);
    const listener=tls.createServer({key:cert.key,cert:cert.cert,minVersion:'TLSv1.3'},socket=>attach(a,b,socket));
    await new Promise(r=>listener.listen(0,'127.0.0.1',r));servers.push(listener);
    const socket=tls.connect({host:'127.0.0.1',port:listener.address().port,rejectUnauthorized:false,minVersion:'TLSv1.3'});
    await new Promise((r,j)=>{socket.once('error',j);socket.once('secureConnect',r);});
    assert.equal(fingerprintOf(socket.getPeerCertificate(true).raw),cert.fingerprint);attach(b,a,socket);
    await until(()=>a.groups.link(b.me.id,b.me.device)&&b.groups.link(a.me.id,a.me.device));
  }
  const owner=await client('Host'),member=await client('Member'),outsider=await client('Other');
  await connect(owner,member);await connect(owner,outsider);
  const act=(s,op,args={})=>s.groups.command({op:'group-'+op,...args});
  const {id}=await act(owner,'create',{name:'Friends'}),channel=owner.groups.authority(id).channels[0].id;
  await act(owner,'invite',{id,person:member.me.id});await until(()=>member.groups.snapshot().invites.length);
  await act(member,'answer',{id,accept:true});await until(()=>owner.groups.authority(id).members.length===2);
  const fileAction=(s,op,extra={})=>s.groups.files.command(op,{group:id,channel,...extra});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1EAAAAASUVORK5CYII=','base64');
  await owner.groups.files.offer(id,channel,{name:'Picture.png',bytes:png},'Готово');
  const [photo]=await fileAction(owner,'list'),photoId={file:photo.id};
  assert.deepEqual((await fileAction(owner,'preview',photoId)).bytes,png);
  await assert.rejects(fileAction(member,'preview',photoId));await assert.rejects(fileAction(outsider,'preview',photoId));
  await fileAction(member,'download',photoId);
  const preview=await fileAction(member,'preview',photoId);assert.equal(preview.type,'image/png');assert.deepEqual(preview.bytes,png);
  await fileAction(member,'reveal',photoId);await fs.writeFile(member.revealed,Buffer.alloc(png.length));
  await assert.rejects(fileAction(member,'preview',photoId));
  await fileAction(owner,'withdraw',photoId);await assert.rejects(fileAction(member,'preview',photoId));
  await fs.unlink(member.revealed);
  const data=randomBytes(196625),sha=createHash('sha256').update(data).digest('hex');
  member.selected=path.join(base,'build.bin');await fs.writeFile(member.selected,data);
  await fileAction(member,'offer');const [declined]=await fileAction(owner,'list');
  assert(declined.canAccept);assert.equal(owner.groups.authority(id).messages[channel]?.length||0,0);
  await fileAction(owner,'decline',{file:declined.id});await until(()=>!member.groups.files.tasks.size);
  const wire=member.groups.files.wire,request=wire.request;
  wire.request=function(l,op,a){return request.call(this,l,op,op==='offer'?{...a,meta:{...a.meta,sha:'0'.repeat(64)}}:a);};
  try{await fileAction(member,'offer');}finally{wire.request=request;}
  const [damaged]=await fileAction(owner,'list');await assert.rejects(fileAction(owner,'accept',{file:damaged.id}),/Контрольная сумма/);
  await until(()=>!member.groups.files.tasks.size);assert.equal((await fileAction(owner,'list')).length,0);
  await fileAction(member,'offer');const [offer]=await fileAction(owner,'list');
  assert(offer.canAccept);await fileAction(owner,'accept',{file:offer.id});
  await until(()=>!member.groups.files.tasks.size);const [ready]=await fileAction(member,'list');
  assert.equal(ready.sha,sha);assert.equal(ready.status,'available');
  assert.deepEqual((await fs.readdir(path.join(base,'Member','Downloads'),{recursive:true,withFileTypes:true})).filter(e=>e.isFile()),[]);
  const blob=path.join(await owner.groups.files.blobs.directoryFor(id),ready.id+'.blob');
  const ciphertext=await fs.readFile(blob);assert(!ciphertext.includes(data.subarray(0,64)));
  const stranger=outsider.groups.link(owner.me.id,owner.me.device);
  await assert.rejects(outsider.groups.files.wire.request(stranger,'read',{group:id,channel,file:ready.id,pos:0}));
  await fileAction(member,'download',{file:ready.id});await fileAction(member,'reveal',{file:ready.id});
  assert.deepEqual(await fs.readFile(member.revealed),data);
  // Deny unapproved handoffs; the group owner has not offered one yet.
  const toMember=owner.groups.link(member.me.id,member.me.device);
  await assert.rejects(owner.groups.files.wire.request(toMember,'move-start',{group:id,token:randomUUID(),meta:ready}));
  await connect(member,outsider);await act(owner,'invite',{id,person:outsider.me.id});
  await until(()=>outsider.groups.snapshot().invites.length);await act(outsider,'answer',{id,accept:true});
  await act(owner,'role',{id,person:member.me.id,role:'admin'});
  await act(owner,'transfer',{id,person:member.me.id,device:member.me.device});
  await until(()=>member.groups.snapshot().transfers.length);
  await act(member,'transfer-answer',{id,accept:true});
  await until(()=>member.groups.authority(id)&&owner.groups.host(id)?.owner===member.me.id&&!owner.groups.records.get(id).move);
  const newBlob=path.join(await member.groups.files.blobs.directoryFor(id),ready.id+'.blob');
  assert.notDeepEqual(await fs.readFile(newBlob),ciphertext);await assert.rejects(fs.stat(blob),{code:'ENOENT'});
  await fileAction(owner,'download',{file:ready.id});await fileAction(owner,'reveal',{file:ready.id});
  assert.deepEqual(await fs.readFile(owner.revealed),data);
  await owner.stop();await until(()=>!outsider.linksTo(owner.me.id).length && outsider.groups.host(id)?.owner===member.me.id);
  await fileAction(outsider,'download',{file:ready.id});await fileAction(outsider,'reveal',{file:ready.id});
  assert.deepEqual(await fs.readFile(outsider.revealed),data);
  await fileAction(member,'withdraw',{file:ready.id});await until(async()=>!(await fileAction(member,'list')).length);
  await assert.rejects(fileAction(outsider,'download',{file:ready.id}));assert.deepEqual(await fs.readFile(outsider.revealed),data);
  console.log('TLS group transfer verified on three profiles with the previous owner stopped, bytes='+data.length+', sha256='+sha);
});
test('file metadata bounds reject oversized files and unsafe names',()=>{
  const meta={id:randomUUID(),size:0,name:'notes',sha:'a'.repeat(64)};
  assert(validMeta(meta));for(const name of ['../../x','NUL','trailing.','a:b'])assert(!validMeta({...meta,name}));
  assert(!validMeta({...meta,size:MAX+1}));assert(!validMeta({...meta,sha:'A'.repeat(64)}));
});
test('cancelling while an encrypted blob is being committed leaves neither temporary nor published data',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'link-blob-cancel-')),secret=seed(),group=randomUUID();
  t.after(()=>fs.rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:100}));
  const blobs=new GroupBlobs(directory,()=>secret),data=Buffer.from('unfinished attachment');
  const m={id:randomUUID(),size:data.length,name:'notes',sha:createHash('sha256').update(data).digest('hex')};
  const w=await blobs.begin(group,m);await blobs.write(w,0,data);
  let resume;const sync=w.handle.sync.bind(w.handle);
  w.handle.sync=async()=>{await new Promise(r=>{resume=r;});await sync();};
  const commit=blobs.finish(w);const aborted=blobs.abort(w);resume();
  await assert.rejects(commit);await aborted;
  assert.deepEqual(await fs.readdir(await blobs.directoryFor(group)),[]);
});
test('restart cleans unreferenced group bytes and abandoned staging while retaining a fenced backup until ACK',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'link-blob-recover-')),secret=seed(),id=randomUUID(),stage=randomUUID();
  t.after(()=>fs.rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:100}));
  const original=new GroupBlobs(directory,()=>secret),size=0,sha=createHash('sha256').digest('hex');
  const m={id:randomUUID(),name:'empty.bin',size,sha};
  for(const token of [undefined,stage])await original.finish(await original.begin(id,m,token));
  const groups={s:{profile:{device:secret}},records:new Map([[id,{move:{side:'retired'}}]])};
  const make=()=>new GroupFiles(groups,{directory}).blobs;
  const fenced=make();await fenced.verify(id,m);await assert.rejects(fenced.verify(id,m,stage),{code:'ENOENT'});
  groups.records.delete(id);await assert.rejects(make().verify(id,m),{code:'ENOENT'});
});
