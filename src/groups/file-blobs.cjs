'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID,randomBytes,createHash,createHmac,createCipheriv,createDecipheriv}=require('node:crypto');
const {safe,BLOCK}=require('../files/storage.cjs');
const {tr}=require('../native-language.cjs');
const MAX=32*1024**2,GROUP_MAX=256*1024**2,COUNT=64;
const uuid=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
const invalid=()=>Error(tr('Не удалось выполнить операцию с файлом.'));
function validMeta(m){
  return !!m && uuid(m.id) && typeof m.name==='string' && m.name.trim()===m.name && safe(m.name)===m.name &&
    Number.isSafeInteger(m.size) && m.size>=0 && m.size<=MAX && typeof m.sha==='string' && /^[a-f0-9]{64}$/.test(m.sha);
}
function entries(group){
  const out=[];
  for(const [channel,rows] of Object.entries(group.messages||{}))for(const row of rows){
    if(row.file){if(!uuid(channel)||!validMeta(row.file)||out.some(r=>r.file.id===row.file.id))throw invalid();out.push({channel,author:row.person,file:row.file});}
  }
  if(out.length>COUNT || out.reduce((n,r)=>n+r.file.size,0)>GROUP_MAX)throw invalid();
  return out;
}
async function checkedDir(parent,name){
  const file=path.join(parent,name);await fs.mkdir(file,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const st=await fs.lstat(file);if(!st.isDirectory()||st.isSymbolicLink())throw invalid();return file;
}
async function readAt(f,length,pos){
  const data=Buffer.alloc(length);let done=0;
  while(done<length){const {bytesRead}=await f.read(data,done,length-done,pos+done);if(!bytesRead)throw invalid();done+=bytesRead;}
  return data;
}
class GroupBlobs{
  constructor(directory,secret,retained){this.directory=directory;this.secret=secret;this.retained=retained;this.recovered=new Map();}
  async recover(profile){
    for(const g of await fs.readdir(profile,{withFileTypes:true})){
      if(!g.isDirectory()||!uuid(g.name))continue;
      for(const d of await fs.readdir(path.join(profile,g.name),{withFileTypes:true})){
        if(!d.isDirectory() || (d.name!=='data'&&!uuid(d.name)))continue;
        const dir=path.join(profile,g.name,d.name);
        for(const f of await fs.readdir(dir,{withFileTypes:true})){
          const id=f.name.slice(0,-5);
          if(!f.isFile()||!uuid(id))continue;
          if(f.name.endsWith('.part')||f.name.endsWith('.blob')&&this.retained&&!this.retained(g.name,d.name,id))await fs.unlink(path.join(dir,f.name));
        }
      }
    }
  }
  async directoryFor(id,token){
    if(!uuid(id)||token!==undefined&&!uuid(token))throw invalid();
    const root=await checkedDir(this.directory,'group-files-v1');
    const secret=this.secret();if(!/^[a-f0-9]{64}$/.test(secret))throw invalid();
    const profile=await checkedDir(root,createHash('sha256').update(secret).digest('hex'));
    if(!this.recovered.has(profile))this.recovered.set(profile,this.recover(profile).catch(e=>{this.recovered.delete(profile);throw e;}));
    await this.recovered.get(profile);
    const group=await checkedDir(profile,id);
    return checkedDir(group,token||'data');
  }
  key(id,m){return createHmac('sha256',Buffer.from(this.secret(),'hex')).update('LINK group file v1\n'+id+'\n'+m.id+'\n'+m.sha).digest();}
  async begin(id,m,token){
    if(!validMeta(m))throw invalid();
    const dir=await this.directoryFor(id,token),disk=await fs.statfs(dir);
    if(disk.bavail*disk.bsize<m.size+28*Math.ceil(m.size/BLOCK))throw Error(tr('Недостаточно места в папке загрузок.'));
    const tmp=path.join(dir,randomUUID()+'.part'),handle=await fs.open(tmp,'wx',0o600);
    return {group:id,meta:{...m},pos:0,handle,tmp,target:path.join(dir,m.id+'.blob'),key:this.key(id,m),hash:createHash('sha256')};
  }
  async write(w,pos,bytes){
    if(w.operation||w.closed||w.cancelled||pos!==w.pos||!Buffer.isBuffer(bytes)||bytes.length!==Math.min(BLOCK,w.meta.size-pos)||!bytes.length)throw invalid();
    w.operation=(async()=>{
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',w.key,iv);
      cipher.setAAD(Buffer.from(String(pos)));const enc=Buffer.concat([cipher.update(bytes),cipher.final()]);
      await w.handle.writeFile(Buffer.concat([iv,cipher.getAuthTag(),enc]));
      if(w.cancelled)throw invalid();
      w.hash.update(bytes);w.pos+=bytes.length;
    })();
    try{await w.operation;}finally{w.operation=null;}
  }
  async finish(w){
    if(!w||w.closed||w.operation||w.cancelled||w.pos!==w.meta.size||w.hash.digest('hex')!==w.meta.sha)throw Error(tr('Контрольная сумма файла не совпала.'));
    w.closed=true;
    w.operation=(async()=>{
      await w.handle.sync();await w.handle.close();
      if(w.cancelled)throw invalid();
      await fs.link(w.tmp,w.target);w.published=true;
      if(w.cancelled)throw invalid();
      await fs.unlink(w.tmp);w.key.fill(0);
    })();
    try{await w.operation;}finally{w.operation=null;}
  }
  async abort(w){
    if(!w)return;
    if(w.aborting)return w.aborting;
    w.cancelled=true;w.closed=true;
    w.aborting=(async()=>{
      await w.operation?.catch(()=>{});await w.handle.close().catch(()=>{});
      await fs.rm(w.tmp,{force:true});
      if(w.published){await fs.rm(w.target,{force:true});w.published=false;}
      w.key.fill(0);
    })();
    return w.aborting;
  }
  async read(id,m,pos,token){
    if(!validMeta(m)||!Number.isSafeInteger(pos)||pos<0||pos%BLOCK||pos>=m.size)throw invalid();
    const dir=await this.directoryFor(id,token),filename=path.join(dir,m.id+'.blob');
    const st=await fs.lstat(filename);if(!st.isFile()||st.isSymbolicLink()||st.size!==m.size+28*Math.ceil(m.size/BLOCK))throw invalid();
    const h=await fs.open(filename,'r');let chunk;
    try{chunk=await readAt(h,28+Math.min(BLOCK,m.size-pos),pos+28*(pos/BLOCK));}finally{await h.close();}
    const key=this.key(id,m);try{
      const cipher=createDecipheriv('aes-256-gcm',key,chunk.subarray(0,12));cipher.setAuthTag(chunk.subarray(12,28));cipher.setAAD(Buffer.from(String(pos)));
      return Buffer.concat([cipher.update(chunk.subarray(28)),cipher.final()]);
    }finally{key.fill(0);}
  }
  async verify(id,m,token){
    const dir=await this.directoryFor(id,token),st=await fs.lstat(path.join(dir,m.id+'.blob'));
    if(!st.isFile()||st.isSymbolicLink()||st.size!==m.size+28*Math.ceil(m.size/BLOCK))throw invalid();
    const hash=createHash('sha256');for(let p=0;p<m.size;p+=BLOCK)hash.update(await this.read(id,m,p,token));
    if(hash.digest('hex')!==m.sha)throw Error(tr('Контрольная сумма файла не совпала.'));
  }
  async activate(id,m,token){
    const target=path.join(await this.directoryFor(id),m.id+'.blob');
    try{await fs.link(path.join(await this.directoryFor(id,token),m.id+'.blob'),target);}
    catch(e){if(e.code!=='EEXIST')throw e;await this.verify(id,m);}
  }
  async prune(id,keep,token){
    const dir=await this.directoryFor(id,token);
    for(const name of await fs.readdir(dir)){
      if(name.endsWith('.blob')&&uuid(name.slice(0,-5))&&!(typeof keep==='function'?keep(name.slice(0,-5)):keep.has(name.slice(0,-5))))
        await fs.rm(path.join(dir,name),{force:true});
    }
  }
}
module.exports={GroupBlobs,entries,validMeta,uuid,MAX,GROUP_MAX,COUNT,invalid};
