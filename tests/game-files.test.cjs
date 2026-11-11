'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),tls=require('node:tls');
const {randomBytes,randomUUID}=require('node:crypto');
const {DirectService}=require('../src/direct/service.cjs');
const {friend,seed}=require('../src/direct/identity.cjs');
const {createRoomCertificate,fingerprintOf}=require('../src/core/certificate.cjs');
const {BLOCK}=require('../src/files/storage.cjs');
async function until(fn){
  for(let i=0;i<800;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}
  throw Error('Condition timed out');
}
test('three admitted LAN clients transfer consented files and clips through the host with adapters off',{timeout:35000},async t=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'link-lan-files-')),clients=[],servers=[];
  t.after(async()=>{
    await Promise.all(clients.map(s=>s.stop()));
    await Promise.all(servers.map(s=>new Promise(r=>s.close(r))));
    await fs.rm(base,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  });
  const cert=await createRoomCertificate();
  async function client(name){
    const downloads=path.join(base,name);await fs.mkdir(downloads);
    let profile={name,root:seed(),device:seed(),friends:[],dht:false,lan:''};
    const s=new DirectService({store:{read:()=>profile,write:p=>{profile=p;}},nics:()=>[],
      attachmentIO:{downloads:()=>downloads,choose:()=>s.selected,reveal:file=>{s.revealed=file;}}});
    clients.push(s);s.start();return s;
  }
  async function connect(a,b){
    a.setFriend(friend(b.me,'friend'));b.setFriend(friend(a.me,'friend'));
    const attach=(s,other,socket)=>s.attach(socket,'lan',socket.exportKeyingMaterial(32,'CRAFTCODE LINK LAN').toString('hex'),other.me.id,other.me.device);
    const server=tls.createServer({key:cert.key,cert:cert.cert,minVersion:'TLSv1.3'},socket=>attach(a,b,socket));
    await new Promise(r=>server.listen(0,'127.0.0.1',r));servers.push(server);
    const socket=tls.connect({host:'127.0.0.1',port:server.address().port,rejectUnauthorized:false,minVersion:'TLSv1.3'});
    await new Promise((r,j)=>{socket.once('secureConnect',r);socket.once('error',j);});
    assert.equal(fingerprintOf(socket.getPeerCertificate(true).raw),cert.fingerprint);attach(b,a,socket);
    await until(()=>a.linksTo(b.me.id).some(l=>l.lanFiles)&&b.linksTo(a.me.id).some(l=>l.lanFiles));
  }
  const [host,alice,bob]=await Promise.all(['Host','Alice','Bob'].map(client));
  await connect(host,alice);await connect(host,bob);
  host.game.create('Local match');const room=host.game.active.id;
  async function invite(s){
    host.game.invite(s.me.id);await until(()=>s.game.invitations.size);
    s.game.answer(s.game.state().invitations[0].id,true);
    await until(()=>!s.game.active?.waiting&&s.game.files.supported());
  }
  await invite(alice);await invite(bob);
  const command=(s,action,messageId)=>s.game.files.command({op:'game-file',profileId:s.me.id,room,action,messageId});
  assert.equal(alice.contact(bob.me.id),undefined);
  assert(clients.every(s=>s.gameNet.phase==='off'));
  const bytes=randomBytes(4*BLOCK+17),filename=path.join(base,'selected.bin');await fs.writeFile(filename,bytes);
  await alice.game.files.offer(alice.me.id,room,{filename},'Карта матча');
  const id=alice.game.active.messages.at(-1).id;
  await until(()=>bob.game.active.messages.some(e=>e.id===id));
  assert.equal(host.game.files.shelf.incoming.size,0);assert.equal(bob.game.files.shelf.incoming.size,0);
  assert.equal(bob.game.active.messages.at(-1).text,'Карта матча');
  const offered=host.game.files.items.get(id);
  await assert.rejects(host.game.files.remote(host.linksTo(bob.me.id)[0],'offer',{id,attachment:offered.attachment,text:'collision'}));
  assert.equal(host.game.files.items.get(id),offered);
  await assert.rejects(host.game.files.remote(host.linksTo(bob.me.id)[0],'offer',{id:randomUUID(),attachment:{...offered.attachment,name:'../secret'},text:''}));
  await assert.rejects(host.game.files.remote(host.linksTo(bob.me.id)[0],'read',{id,pos:BLOCK,token:randomUUID()}));
  const fake={kind:'game-file',op:'result',ok:true,id:randomUUID(),scope:room+'/'+bob.game.active.ticket,value:bytes.toString('base64')};
  await bob.game.files.receive(bob.linksTo(host.me.id)[0],fake);
  assert.equal(bob.game.files.shelf.incoming.size,0,'unsolicited bytes do not start a download');
  await command(bob,'download',id);await command(bob,'reveal',id);
  assert.deepEqual(await fs.readFile(bob.revealed),bytes);
  assert.equal(host.game.files.receipts.size,0);
  await assert.rejects(host.game.files.remote(host.linksTo(bob.me.id)[0],'withdraw',{id}));
  await assert.rejects(command(alice,'download',id));
  await command(alice,'withdraw',id);await until(()=>bob.game.files.items.get(id).withdrawn);
  assert.equal(bob.game.state().room.messages.find(e=>e.id===id).attachment.state,'saved');
  await assert.rejects(command(host,'download',id));
  const last=bob.game.active.messages.at(-1).id;
  bob.game.clearChat(room,last);assert.equal(bob.game.state().room.hasDownloads,true);
  const previousDownloads=bob.game.files.io.downloads();
  const selectedDownloads=path.join(base,'new download location');await fs.mkdir(selectedDownloads);
  bob.game.files.io.downloads=()=>selectedDownloads;
  bob.game.files.io.downloadRoots=()=>[selectedDownloads,previousDownloads];
  assert.equal((await bob.game.files.clearDownloads(room,null)).removed,1);
  await assert.rejects(fs.stat(bob.revealed),{code:'ENOENT'});
  assert.deepEqual(await fs.readFile(filename),bytes,'selected original retained');

  const png=Buffer.from('89504e470d0a1a0a00000000','hex');
  await host.game.files.offer(host.me.id,room,{name:'picture.png',bytes:png},'Снимок');
  const photo=host.game.active.messages.at(-1).id;
  await until(()=>bob.game.files.items.has(photo));await command(bob,'download',photo);
  assert.deepEqual(Buffer.from((await command(bob,'preview',photo)).bytes),png);
  await command(bob,'reveal',photo);
  assert.equal(path.relative(await fs.realpath(selectedDownloads),bob.revealed).startsWith('..'),false,'new downloads use the selected location in the current LAN');
  await fs.writeFile(bob.revealed,'my edited file');
  const result=await bob.game.files.clearDownloads(room,photo);assert.equal(result.kept,1);
  assert.equal(await fs.readFile(bob.revealed,'utf8'),'my edited file');
  for(const kind of ['voice','circle']){
    const clip=Buffer.from('1a45dfa300000000','hex');
    await alice.game.files.offer(alice.me.id,room,undefined,'',kind,clip);
    const id=alice.game.active.messages.at(-1).id;
    await until(()=>bob.game.files.items.has(id));
    await command(bob,'download',id);
    const view=await command(bob,'preview',id);
    assert.equal(view.type,kind==='voice'?'audio/webm':'video/webm');assert.deepEqual(Buffer.from(view.bytes),clip);
    assert.equal(bob.game.state().room.messages.find(e=>e.id===id).attachment.played,false);
    await command(bob,'played',id);
    assert.equal(bob.game.state().room.messages.find(e=>e.id===id).attachment.played,true);
    assert.equal(alice.game.state().room.messages.find(e=>e.id===id).attachment.played,false);
    assert.throws(()=>command(alice,'played',id));
  }
  const listened=bob.game.active.messages.at(-1).id;
  assert.throws(()=>bob.game.files.command({op:'game-file',action:'played',profileId:alice.me.id,room,messageId:listened}));
  assert.throws(()=>bob.game.files.command({op:'game-file',action:'played',profileId:bob.me.id,room:randomUUID(),messageId:listened}));
  bob.game.clearChat(room,listened);assert.throws(()=>command(bob,'played',listened));
  const source=await fs.readFile(filename);
  await host.game.files.offer(host.me.id,room,{filename});
  const altered=host.game.active.messages.at(-1).id;
  await until(()=>bob.game.files.items.has(altered));await fs.writeFile(filename,Buffer.alloc(source.length));
  await assert.rejects(command(bob,'download',altered));assert(!bob.game.files.items.get(altered).saved);
  await fs.writeFile(filename,source);

  // Capture delayed bytes at the relay, then revoke the reader's admission.
  await alice.game.files.offer(alice.me.id,room,{filename});
  const pending=alice.game.active.messages.at(-1).id;await until(()=>bob.game.files.items.has(pending));
  let release,readStarted=false;
  const read=alice.game.files.shelf.read.bind(alice.game.files.shelf);
  alice.game.files.shelf.read=async(...a)=>{readStarted=true;await new Promise(r=>{release=r;});return read(...a);};
  const job=command(bob,'download',pending);job.catch(()=>{});
  await until(()=>readStarted);
  bob.game.leave();release();assert.equal(await job,false);
  assert.equal(bob.game.files.room,null);
  assert.equal(host.game.files.shelf.incoming.size,0);
  await until(()=>bob.game.files.work.size===0);
  assert.equal((await fs.readdir(path.join(selectedDownloads,'CRAFTCODE LINK','LAN-'+room))).some(n=>n.endsWith('.part')),false);
  await until(()=>!host.game.active.roster.some(p=>p.device===bob.me.device));
  await invite(bob);
  const peer=host.linksTo(bob.me.id)[0];
  await assert.rejects(host.game.files.remote(peer,'read',{id:pending,pos:0,token:randomUUID()}),'readmission does not grant old attachments');
  const count=host.game.files.items.size;
  await host.game.files.receive(peer,{kind:'game-file',scope:fake.scope,id:randomUUID(),op:'offer',
    args:{id:randomUUID(),attachment:offered.attachment,text:'stale admission'}});
  assert.equal(host.game.files.items.size,count);
  const current=bob.linksTo(host.me.id)[0];current.lanFiles=false;
  assert.equal(bob.game.state().room.canShareFiles,false);
  await assert.rejects(bob.game.files.offer(bob.me.id,room,{filename}));
  current.lanFiles=true;
  console.log('PASS three TLS LINK profiles, non-friend guests, adapters off; file bytes 98321, captions, image/voice/circle previews, explicit save, clear/retry, edited/original retention, leave during relay and stale admission.');
});
