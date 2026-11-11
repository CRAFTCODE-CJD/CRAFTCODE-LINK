'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {linkSync,writeFileSync}=require('node:fs');
const {createHash,randomUUID}=require('node:crypto');
const {tr}=require('../native-language.cjs');
const {MAX_CLIP,mediaType,digest,readPreviewBytes}=require('./chat-media.cjs');
const {fileIdentity,ownedFile,unlinkOwned}=require('./saved-download.cjs');
const BLOCK=24*1024,MAX=64*1024**3;
const RANGE=48*1024*12;
const hashOK=h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h);
const fail=()=>{throw Error(tr('Не удалось выполнить операцию с файлом.'));};
function safe(s){
  const name=String(s||'').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,'_').replace(/^\.+/,'').slice(0,112).replace(/[ .]+$/,'');
  return !name||/^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(name)?'_'+(name||'file'):name;
}
async function folder(parent,name){
  const dir=path.join(parent,safe(name));try{await fs.mkdir(dir,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  const stat=await fs.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||path.relative(await fs.realpath(parent),await fs.realpath(dir))!==path.basename(dir))fail();
  return dir;
}
class ShelfStorage{
  constructor(downloads,journal=null){this.downloads=downloads;this.journal=journal;this.sources=new Map();this.completed=new Map();this.incoming=new Map();this.closed=false;}
  async offer(filename,limit=MAX){
    if(this.closed||this.sources.size>=24)fail();
    const id=randomUUID(),file=await fs.open(filename,'r');
    if(this.closed||this.sources.size>=24){await file.close();fail();}this.sources.set(id,file);
    try{
      const start=await file.stat();if(!start.isFile()||start.size>Math.min(MAX,limit))fail();
      const hash=createHash('sha256'),block=Buffer.alloc(512*1024);
      for(let offset=0;offset<start.size;){
        if(this.closed)fail();const {bytesRead}=await file.read(block,0,Math.min(block.length,start.size-offset),offset);
        if(!bytesRead)fail();hash.update(block.subarray(0,bytesRead));offset+=bytesRead;
      }
      const end=await file.stat();if(start.mtimeMs!==end.mtimeMs||start.size!==end.size||this.closed)fail();
      file.location=filename;file.size=start.size;file.stamp=start.mtimeMs;return {id,name:safe(path.basename(filename)),size:start.size,sha:hash.digest('hex')};
    }catch(e){this.sources.delete(id);await file.close().catch(()=>{});throw e;}
  }
  clip(kind,bytes){
    if(this.closed||!['voice','circle'].includes(kind)||!(bytes instanceof Uint8Array)||bytes.length<4||bytes.length>MAX_CLIP||this.sources.size>=24)fail();
    const name=(kind==='voice'?'Voice-':'Video-')+new Date().toISOString().replace(/[:.]/g,'-')+(kind==='voice'?'.weba':'.webm');
    if(!mediaType(name,Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength)))fail();
    return this.memory(name,bytes);
  }
  memory(name,bytes){
    if(this.closed||typeof name!=='string'||!name.trim()||!(bytes instanceof Uint8Array)||bytes.length>MAX_CLIP||this.sources.size>=24)fail();
    const size=[...this.sources.values()].reduce((n,f)=>n+(f.clip?.length||0),bytes.length);if(size>MAX_CLIP*3)fail();
    const clip=Buffer.from(bytes);
    const id=randomUUID();this.sources.set(id,{clip,size:clip.length});
    return {id,name:safe(name.trim()),size:clip.length,sha:digest(clip)};
  }
  location(id){const p=this.sources.get(id)?.location||this.completed.get(id);if(!p)fail();return p;}
  async preview(id,meta){
    if(!hashOK(meta?.sha)||!Number.isSafeInteger(meta.size)||meta.size<1||meta.size>MAX_CLIP)fail();
    let bytes=this.sources.get(id)?.clip;
    if(!bytes)bytes=await readPreviewBytes(this.location(id),meta.size).catch(fail);
    if(this.closed||bytes.length!==meta.size||digest(bytes)!==meta.sha)fail();
    const type=mediaType(meta.name,bytes);if(!type)fail();return {bytes,type};
  }
  async read(id,pos){
    return (await this.readBytes(id,pos,BLOCK)).toString('base64');
  }
  async readBytes(id,pos,length){
    if(!Number.isSafeInteger(length)||length<1||length>RANGE)fail();
    const f=this.sources.get(id);if(!f||!Number.isSafeInteger(pos)||pos<0||pos>=f.size||pos%BLOCK)fail();
    if(f.clip)return f.clip.subarray(pos,pos+length);
    const st=await f.stat();if(st.mtimeMs!==f.stamp||st.size!==f.size)fail();
    const b=Buffer.alloc(Math.min(length,st.size-pos));let offset=0;
    while(offset<b.length){const {bytesRead}=await f.read(b,offset,b.length-offset,pos+offset);if(!bytesRead)fail();offset+=bytesRead;}
    return b;
  }
  async begin(meta,room){
    if(this.closed||this.incoming.size>=4||!hashOK(meta?.sha)||!Number.isSafeInteger(meta.size)||meta.size<0||meta.size>MAX||typeof meta.name!=='string')fail();
    const downloads=await fs.realpath(this.downloads),base=await folder(downloads,'CRAFTCODE LINK'),dir=await folder(base,room);
    const disk=await fs.statfs(dir);if(disk.bavail*disk.bsize<meta.size)throw Error(tr('Недостаточно места в папке загрузок.'));
    const id=randomUUID(),tmp=path.join(dir,'.link-'+id+'.part');
    const file=await fs.open(tmp,'wx+',0o600);
    let identity;
    try{
      identity=fileIdentity(await file.stat({bigint:true}));
      if(!ownedFile(tmp,dir,identity))fail();
      // Keep Windows origin checks available when a user opens a received
      // attachment. On NTFS the zone follows the verified file's hard link.
      if(process.platform==='win32'){
        try{writeFileSync(tmp+':Zone.Identifier','[ZoneTransfer]\r\nZoneId=3\r\n',{flag:'wx'});}
        catch(e){if(!['EINVAL','ENOTSUP','ENOSYS'].includes(e.code))throw e;}
      }
      await this.journal?.track(id,downloads,safe(room),identity);
      if(this.closed||this.incoming.size>=4)fail();
      this.incoming.set(id,{file,tmp,dir,identity,name:safe(meta.name),expected:meta.sha,size:meta.size,pos:0});
      return id;
    }catch(e){
      try{unlinkOwned(tmp,dir,identity);}finally{await file.close();}
      await this.journal?.forget(id);throw e;
    }
  }
  async put(id,pos,str,onCommit){
    const t=this.incoming.get(id);
    if(!t||t.busy||pos!==t.pos||typeof str!=='string'||str.length>32768)fail();
    const b=Buffer.from(str,'base64');
    if(b.toString('base64')!==str||b.length!==Math.min(BLOCK,t.size-pos)) {await this.cancel(id);fail();}
    return this.putBytes(id,pos,b,onCommit);
  }
  async putBytes(id,pos,bytes,onCommit){
    const t=this.incoming.get(id);if(!t||t.busy||pos!==t.pos||!(bytes instanceof Uint8Array)||bytes.byteLength>RANGE)fail();
    const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(pos+b.length>t.size||(!b.length&&t.size))fail();
    t.busy=this.writeChunk(id,t,pos,b,onCommit);
    try{return await t.busy;}catch(e){await this.discard(id,t);throw e;}finally{t.busy=null;}
  }
  async writeChunk(id,t,pos,b,onCommit){
    let offset=0;
    while(offset<b.length){
      const {bytesWritten}=await t.file.write(b,offset,b.length-offset,pos+offset);
      if(!bytesWritten)fail();
      offset+=bytesWritten;
    }
    if(t.cancelled||this.closed)fail();
    t.pos+=b.length;
    if(t.pos<t.size)return {pos:t.pos};
    await t.file.sync();
    const before=ownedFile(t.tmp,t.dir,t.identity);
    if(!before||before.size!==BigInt(t.size))fail();
    // Verify the bytes on disk, including earlier blocks, before publishing.
    const hash=createHash('sha256');
    if(t.size)for await(const chunk of t.file.createReadStream({start:0,end:t.size-1,autoClose:false,highWaterMark:512*1024})){
      if(t.cancelled||this.closed)fail();hash.update(chunk);
    }
    if(hash.digest('hex')!==t.expected)throw Error(tr('Контрольная сумма файла не совпала.'));
    const {name,ext}=path.parse(t.name);
    for(let n=0;n<1000;n++){
      if(this.closed||t.cancelled||this.incoming.get(id)!==t)fail();
      const target=path.join(t.dir,name+(n?' ('+n+')':'')+ext);
      if(ownedFile(t.tmp,t.dir,t.identity)?.mtimeNs!==before.mtimeNs)fail();
      try{linkSync(t.tmp,target);}
      catch(e){if(e.code==='EEXIST')continue;throw e;}
      try{
        if(ownedFile(target,t.dir,t.identity)?.mtimeNs!==before.mtimeNs)fail();
        onCommit?.(target,t.identity);
      }catch(e){unlinkOwned(target,t.dir,t.identity);throw e;}
      // The verified name is now committed. A journal cleanup error must not trigger a second download.
      try{await this.discard(id,t);}catch(error){if(!this.journal)throw error;this.incoming.delete(id);}
      const released=this.completed.size>=256?this.completed.keys().next().value:undefined;
      if(released)this.completed.delete(released);
      if(!this.closed)this.completed.set(id,target);
      return {pos:t.pos,done:true,path:target,released};
    }
    fail();
  }
  async discard(id,t){
    if(!t.cleanup)t.cleanup=(async()=>{
      await t.file.close();
      unlinkOwned(t.tmp,t.dir,t.identity);
      await this.journal?.forget(id);
      this.incoming.delete(id);
    })().catch(error=>{t.cleanup=null;throw error;});
    return t.cleanup;
  }
  async cancel(id){
    const t=this.incoming.get(id);if(!t)return;
    t.cancelled=true;if(t.busy)await t.busy.catch(()=>{});
    await this.discard(id,t);
  }
  async remove(id){const f=this.sources.get(id);this.sources.delete(id);if(f?.close)await f.close().catch(()=>{});}
  async close(){this.closed=true;this.completed.clear();await Promise.allSettled([...this.sources.keys()].map(id=>this.remove(id)).concat([...this.incoming.keys()].map(id=>this.cancel(id))));}
}
module.exports={ShelfStorage,safe,BLOCK,MAX};
