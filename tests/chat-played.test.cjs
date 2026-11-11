'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {DirectService}=require('../src/direct/service.cjs');
const {ProfileStore,publicCard,friend,seed}=require('../src/direct/identity.cjs');
const {chatCommand}=require('../src/direct/personal-chats.cjs');

test('played media is local, encrypted, scoped to a received saved clip, retained on reopen and erased with chat',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'link-played-')),key=crypto.randomBytes(32),services=[];
  t.after(async()=>{await Promise.all(services.map(s=>s.stop()));fs.rmSync(dir,{recursive:true,force:true});});
  const encryption={isEncryptionAvailable:()=>true,encryptString(text){
    const nonce=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,nonce);
    return Buffer.concat([nonce,c.update(text,'utf8'),c.final(),c.getAuthTag()]);
  },decryptString(bytes){
    const c=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));c.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([c.update(bytes.subarray(12,-16)),c.final()]).toString('utf8');
  }};
  function open(){
    const s=new DirectService({store:new ProfileStore(dir,encryption),nics:()=>[],
      attachmentIO:{downloads:()=>dir,choose:()=>false,reveal:()=>{}}});
    services.push(s);if(s.profile)s.start();else s.create('Listener');return s;
  }
  let s=open();
  const p=publicCard({root:seed(),device:seed(),name:'Sender'}),other=publicCard({root:seed(),device:seed(),name:'Other'});
  s.setFriend(friend(p,'friend'));s.setFriend(friend(other,'friend'));
  const f=s.chats.friend(p.id),epoch=s.chats.epoch(f),clip=Buffer.from('1a45dfa300000000','hex');
  const meta={name:'Voice.weba',size:clip.length,sha:crypto.createHash('sha256').update(clip).digest('hex'),clip:'voice'};
  const id=crypto.randomUUID(),store=s.store.chatHistory;
  store.receive(p.id,epoch,p.device,{id,seq:1,text:'Voice.weba',attachment:meta},()=>true,true);
  const action=(owner,person=p.id,message=id)=>chatCommand(owner,{op:'chat-attachment',profileId:owner.me.id,id:person,action:'played',messageId:message});
  const history=()=>chatCommand(s,{op:'chat-history',id:p.id}).messages;
  assert.equal(history()[0].attachment.played,false);
  await assert.rejects(action(s));
  const row=store.message(p.id,epoch,id),filename=path.join(dir,'Voice.weba');fs.writeFileSync(filename,clip);
  store.setAttachment(row.seq,'saved',Buffer.from(filename));
  let sent=0;s.chats.flush=()=>{sent++;};
  assert.equal(await action(s),true);assert.equal(await action(s),true);
  assert.equal(sent,0);assert.equal(history()[0].status,'received');assert.equal(history()[0].attachment.played,true);
  assert.equal(store.db.prepare('SELECT unread FROM messages WHERE n=?').get(row.seq).unread,1);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM message_reads').get().n,1);
  assert(!fs.readFileSync(store.file).includes(Buffer.from('"played":true')));
  await assert.rejects(action(s,other.id));
  assert.throws(()=>chatCommand(s,{op:'chat-attachment',profileId:p.id,id:p.id,action:'played',messageId:id}));
  const textId=crypto.randomUUID();
  store.receive(p.id,epoch,p.device,{id:textId,seq:2,text:'text'},()=>true);
  await assert.rejects(action(s,p.id,textId));
  const outgoing=crypto.randomUUID();
  store.enqueue(p.id,epoch,outgoing,'Voice.weba',meta,{kind:'clip',bytes:clip});
  await assert.rejects(action(s,p.id,outgoing));
  await s.stop();s=open();
  assert.equal(history().find(e=>e.id===id).attachment.played,true);
  chatCommand(s,{op:'chat-clear',profileId:s.me.id,id:p.id});
  await assert.rejects(action(s));assert.equal(history().length,0);
});
