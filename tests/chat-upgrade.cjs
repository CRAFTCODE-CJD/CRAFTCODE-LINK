'use strict';
// Open a real earlier database with the current application. All profile paths,
// master keys and contacts in this scenario are created solely for this run.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createRequire}=require('node:module');
async function run(){
  if(!process.argv[2])throw Error('Pass a 0.7.7, 0.7.11 or 0.7.13 SOURCE or resources/app directory');
  const old=createRequire(path.resolve(process.argv[2],'package.json'));
  const version=old('./package.json').version;
  assert(['0.7.7','0.7.11','0.7.13'].includes(version));
  const previous=old('./src/direct/identity.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'link-upgrade-history-'));
  const platform={isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=>'test',encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  const store=new previous.ProfileStore(dir,platform);
  let current;
  try{
    const profile={root:previous.seed(),device:previous.seed(),name:'А',friends:[],dht:false,lan:''};
    const other=previous.publicCard({...profile,root:previous.seed(),device:previous.seed(),name:'Б'});
    const friend=previous.friend(other,'friend'), me=previous.publicCard(profile), epoch=friend.chatKey;
    profile.friends.push(friend);store.write(profile);
    const db=store.chatHistory;db.open(me);
    const first=crypto.randomUUID(),second=crypto.randomUUID(),incoming=crypto.randomUUID();
    db.enqueue(other.id,epoch,first,'Раньше');
    assert(db.acknowledge(other.id,epoch,first,db.oldest(other.id,epoch).seq));
    db.enqueue(other.id,epoch,second,'Отправить позже');
    assert.equal(db.receive(other.id,epoch,other.device,{id:incoming,seq:1,text:'Сохранено'},()=>true),'new');
    let saved;
    if(version!=='0.7.7'){
      const folder=path.join(dir,'Downloads','CRAFTCODE LINK','DM-'+other.id.slice(0,12));
      fs.mkdirSync(folder,{recursive:true});saved=path.join(folder,'Voice-older.weba');
      const bytes=Buffer.from('1a45dfa30123','hex'),id=crypto.randomUUID();
      const attachment={name:path.basename(saved),clip:'voice',size:bytes.length,sha:crypto.createHash('sha256').update(bytes).digest('hex')};
      fs.writeFileSync(saved,bytes);
      assert.equal(db.receive(other.id,epoch,other.device,{id,seq:2,text:attachment.name,attachment},()=>true),'new');
      db.setAttachment(db.message(other.id,epoch,id).seq,'saved',Buffer.from(saved));
    }
    db.close();
    const {ProfileStore}=require('../src/direct/identity.cjs');
    const {DirectService}=require('../src/direct/service.cjs');
    current=new DirectService({store:new ProfileStore(dir,platform),nics:()=>[],attachmentIO:{downloads:()=>path.join(dir,'Downloads')}});current.start();
    const history=current.chats.history(other.id);
    assert.equal(history.unread,saved?2:1);
    assert.deepEqual(history.messages.slice(0,3).map(m=>[m.id,m.text,m.status]),[
      [first,'Раньше','delivered'],[second,'Отправить позже','pending'],[incoming,'Сохранено','received']]);
    assert.equal(current.me.id,me.id);assert.equal(current.me.device,me.device);
    assert.equal(current.snapshot().friends[0].id,other.id);
    await current.chats.clear(other.id);
    assert.equal(current.chats.history(other.id).messages.length,0);
    if(saved){
      assert(fs.existsSync(saved));
      assert.deepEqual(await current.chats.clear(other.id,true),{removed:1,kept:0,failed:0});
      assert(!fs.existsSync(saved));
      console.log('PASS retained an actual '+version+' download during text-only clear, then removed that copy on request.');
    }
    console.log('PASS '+version+' profile and encrypted SQLite migration: keys, confirmed contact, unread, delivered and pending history and local clear.');
  }finally{store.chatHistory.close();await current?.stop();fs.rmSync(dir,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
