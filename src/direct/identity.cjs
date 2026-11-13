'use strict';
const {tr}=require('../native-language.cjs');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {promisify}=require('node:util');
const {ChatStore}=require('./chat-store.cjs');
const {validAvatar,validStyleRecord}=require('./avatars.cjs');
const derive=promisify(crypto.scrypt);
const hex32 = v=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
const nameOf = s=>typeof s==='string'?s.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu,'').trim().slice(0,48):'';
const seed=()=>crypto.randomBytes(32).toString('hex');
function privateKey(s){
  if(!hex32(s))throw Error(tr('Некорректный ключ профиля.'));
  return crypto.createPrivateKey({format:'der',type:'pkcs8',key:Buffer.from('302e020100300506032b657004220420'+s,'hex')});
}
function publicId(s){return crypto.createPublicKey(privateKey(s)).export({format:'der',type:'spki'}).subarray(-32).toString('hex');}
function sign(s,fields){return crypto.sign(null,Buffer.from(JSON.stringify(fields)),privateKey(s)).toString('base64');}
function verify(id,fields,sig){
  if(!hex32(id) || typeof sig!=='string' || sig.length!==88)return false;
  const key={format:'der',type:'spki',key:Buffer.from('302a300506032b6570032100'+id,'hex')};
  return crypto.verify(null,Buffer.from(JSON.stringify(fields)),key,Buffer.from(sig,'base64'));
}
function publicCard(p){
  const id=publicId(p.root),device=publicId(p.device);
  return {id,device,name:p.name,cert:sign(p.root,['device-v1',id,device])};
}
function validCard(c){return c && hex32(c.device) && typeof c.name==='string' && c.name.length>0 && c.name.length<=48 && c.name===nameOf(c.name) && verify(c.id,['device-v1',c.id,c.device],c.cert);}
function shareCard(p){const c=publicCard(p);c.signature=sign(p.device,['card-v1',c.id,c.name]);return 'CCF1:'+Buffer.from(JSON.stringify(c)).toString('base64url');}
function parseCard(text){
  if(typeof text!=='string'||text.length>1500||!/^CCF1:[A-Za-z0-9_-]+$/.test(text.trim()))throw Error(tr('Вставьте карточку друга CCF1.'));
  let c;try{c=JSON.parse(Buffer.from(text.trim().slice(5),'base64url'));}catch{}
  if(!validCard(c)||!verify(c.device,['card-v1',c.id,c.name],c.signature))throw Error(tr('Не удалось проверить ключ карточки.'));
  return {id:c.id,device:c.device,name:nameOf(c.name),cert:c.cert};
}
function friend(c,state='invited'){return {id:c.id,name:nameOf(c.name),devices:[c.device],state,favorite:false,added:Date.now(),lastCall:0,chatKey:crypto.randomUUID()};}
function cleanSnapshot(p){
  if(!hex32(p?.root)||!nameOf(p.name)||!Array.isArray(p.friends)||p.friends.length>256)throw Error(tr('Повреждённый профиль.'));
  const seen=new Set(),friends=[];
  for(const f of p.friends){
    if(!hex32(f.id)||seen.has(f.id)||!nameOf(f.name)||!Array.isArray(f.devices)||f.devices.length>16||!f.devices.every(hex32)||!['friend','invited','requested'].includes(f.state))throw Error(tr('Повреждённая адресная книга.'));
    seen.add(f.id);friends.push({id:f.id,name:nameOf(f.name),devices:[...new Set(f.devices)],state:f.state,favorite:f.favorite===true,added:Number.isSafeInteger(f.added)?f.added:0,lastCall:Number.isSafeInteger(f.lastCall)?f.lastCall:0,
      ...(typeof f.chatKey==='string' && /^[a-f0-9-]{36}$/.test(f.chatKey)?{chatKey:f.chatKey}:{})});
  }
  const blocked=(p.blocked??[]),requests=(p.requests??[]);
  if(!Array.isArray(blocked)||blocked.length>256||!blocked.every(c=>hex32(c?.id)&&nameOf(c.name))||
     !Array.isArray(requests)||requests.length>48||!requests.every(validCard))throw Error(tr('Повреждён список контактов.'));
  const denied=new Set(blocked.map(c=>c.id));
  return {root:p.root,name:nameOf(p.name),friends:friends.filter(c=>!denied.has(c.id)),...(validAvatar(p.avatar)?{avatar:p.avatar}:{}),
    ...(validStyleRecord(p.cardStyle)?{cardStyle:p.cardStyle}:{}),
    ...(blocked.length?{blocked:blocked.map(c=>({id:c.id,name:nameOf(c.name)}))}:{}),
    ...(requests.length?{requests:requests.filter(c=>!denied.has(c.id)&&!seen.has(c.id))}:{})};
}
function passOk(p){if(typeof p!=='string'||p.length<12||p.length>256)throw Error(tr('Пароль переноса должен содержать от 12 до 256 символов.'));}
async function seal(profile,password){
  passOk(password);
  const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12),key=await derive(password,salt,32,{N:65536,r:8,p:1,maxmem:96*1024*1024});
  try{
    const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('CCLINK profile v1'));
    const cipherText=Buffer.concat([cipher.update(JSON.stringify(cleanSnapshot(profile)),'utf8'),cipher.final()]);
    return Buffer.concat([Buffer.from('CCPROF1\n'),salt,iv,cipher.getAuthTag(),cipherText]);
  }finally{key.fill(0);}
}
async function unseal(bytes,password){
  passOk(password);
  if(bytes.length>512*1024||bytes.length<54||bytes.subarray(0,8).toString()!=='CCPROF1\n')throw Error(tr('Выберите файл переноса CRAFTCODE LINK.'));
  const key=await derive(password,bytes.subarray(8,24),32,{N:65536,r:8,p:1,maxmem:96*1024*1024});
  try{
    const dec=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(24,36));dec.setAAD(Buffer.from('CCLINK profile v1'));dec.setAuthTag(bytes.subarray(36,52));
    return cleanSnapshot(JSON.parse(Buffer.concat([dec.update(bytes.subarray(52)),dec.final()]).toString()));
  }catch{throw Error(tr('Неверный пароль или повреждённый файл.'));}finally{key.fill(0);}
}
function protectedWrite(file,storage,data){
  if(!storage.isEncryptionAvailable() || (process.platform==='linux' && storage.getSelectedStorageBackend?.()==='basic_text'))throw Error(tr('Хранилище ключей ОС недоступно.'));
  const bytes=storage.encryptString(JSON.stringify(data));
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  require('../profile-paths.cjs').writeProfileFile(file,bytes);
  return bytes.length;
}
class ProfileStore {
  constructor(dir,storage){this.file=path.join(dir,'link-direct-v1.bin');this.storage=storage;this.chatHistory=new ChatStore(dir,storage);}
  read(){
    if(!fs.existsSync(this.file))return null;
    const p=JSON.parse(this.storage.decryptString(fs.readFileSync(this.file)));
    if(!hex32(p.device))throw Error(tr('Не удалось открыть устройство.'));
    const profile=cleanSnapshot(p);
    const contactAvatars=Object.fromEntries(profile.friends.filter(f=>f.state==='friend' && validAvatar(p.contactAvatars?.[f.id])).map(f=>[f.id,p.contactAvatars[f.id]]));
    const contactStyles=Object.fromEntries(profile.friends.filter(f=>f.state==='friend' && validStyleRecord(p.contactStyles?.[f.id])).map(f=>[f.id,p.contactStyles[f.id]]));
    const contactMix=require('./contact-mix.cjs').readMix(profile.friends,p.contactMix);
    const contactSeen=Object.fromEntries(profile.friends.flatMap(f=>{
      const time=p.contactSeen?.[f.id];
      return f.state==='friend'&&Number.isSafeInteger(time)&&time>0&&time<=Date.now()?[[f.id,time]]:[];
    }));
    const contactChecks=require('./identity-verification.cjs').savedChecks({...profile,contactChecks:p.contactChecks});
    const gameLaunch=require('../game/launcher.cjs').launchSelection(p.gameLaunch);
    const discoverySeeds=p.dht===true&&require('./discovery-seeds.cjs').readSeeds(p.discoverySeeds);
    return {...profile,contactChecks,contactSeen,contactAvatars,contactStyles,contactMix,...(gameLaunch?{gameLaunch}:{}),...(discoverySeeds?{discoverySeeds}:{}),privacy:require('./privacy.cjs').privacyOf(p.privacy),device:p.device,dht:p.dht===true,lan:typeof p.lan==='string'?p.lan:''};
  }
  erase(){this.chatHistory.erase();require('../groups/store.cjs').eraseGroups(path.dirname(this.file));fs.rmSync(this.file,{force:true});fs.rmSync(this.file+'.tmp',{force:true});}
  write(p){
    protectedWrite(this.file,this.storage,p);
  }
}
module.exports={hex32,seed,publicId,nameOf,publicCard,validCard,shareCard,parseCard,sign,verify,friend,seal,unseal,ProfileStore};
