'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');

const maxSize=512*1024**2;
const active=new Set();
const invalid=()=>Object.assign(Error('Установщик выпуска не прошёл проверку.'),{code:'UPDATE_INVALID_PAYLOAD'});
const interrupted=cause=>Object.assign(Error('Не удалось скачать обновление. Повторите загрузку.'),{retryable:true,cause});
const regular=s=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n;
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.birthtimeNs===b.birthtimeNs;

function partialName(release){
  if(!/^[a-f0-9]{64}$/.test(release?.sha)||!Number.isSafeInteger(release.size)||release.size<2||release.size>maxSize)throw invalid();
  return 'installer-'+release.sha+'-'+release.size+'.part';
}
async function cacheDirectory(dir,create=false){
  const absolute=path.resolve(dir),root=path.parse(absolute).root;
  let current=root;
  // Windows may spell a real directory using its 8.3 alias. Check the entries
  // themselves, including every ancestor, before creating or removing anything.
  for(const name of path.relative(root,absolute).split(path.sep).filter(Boolean)){
    current=path.join(current,name);
    let stat;
    try{stat=await fs.lstat(current);}
    catch(e){
      if(e.code!=='ENOENT'||!create)throw e;
      await fs.mkdir(current,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
      stat=await fs.lstat(current);
    }
    if(!stat.isDirectory()||stat.isSymbolicLink())throw invalid();
  }
  return fs.realpath(absolute);
}
async function partialStat(file){
  const st=await fs.lstat(file,{bigint:true});
  if(!regular(st))throw invalid();
  return st;
}
async function partialSize(dir,release){
  const name=partialName(release);
  try{
    dir=await cacheDirectory(dir);
    const {size}=await partialStat(path.join(dir,name));
    return size>BigInt(release.size)?0:Number(size);
  }catch(e){if(e.code==='ENOENT')return 0;throw e;}
}
async function cleanupPartials(dir,keepRelease=null){
  const keep=keepRelease&&partialName(keepRelease);
  try{dir=await cacheDirectory(dir);}catch(e){if(e.code==='ENOENT')return;throw e;}
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    if(entry.name===keep||!/^installer-[a-f0-9]{64}-[1-9]\d{0,8}\.part$/.test(entry.name))continue;
    if(entry.isDirectory()&&!entry.isSymbolicLink())continue;
    const file=path.resolve(dir,entry.name);
    if(active.has(file))throw Error('Дождитесь завершения текущей операции обновления.');
    // Unlink only this entry. Never traverse a replaced file or link.
    await fs.unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});
  }
}
async function openPartial(file){
  let stat;
  try{stat=await partialStat(file);}catch(e){if(e.code==='ENOENT')return fs.open(file,'wx+',0o600);throw e;}
  const handle=await fs.open(file,'r+');
  try{
    const opened=await handle.stat({bigint:true});
    if(!regular(opened)||!same(opened,stat))throw invalid();
    return handle;
  }catch(e){await handle.close();throw e;}
}
async function verify(handle,release,signal){
  const hash=crypto.createHash('sha256'),buffer=Buffer.allocUnsafe(256*1024);
  let pos=0;
  while(pos<release.size){
    signal.throwIfAborted();
    const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,release.size-pos),pos);
    if(!bytesRead||(!pos&&buffer[0]!==0x4d)||(pos<2&&pos+bytesRead>=2&&buffer[1-pos]!==0x5a))throw invalid();
    hash.update(buffer.subarray(0,bytesRead));pos+=bytesRead;
  }
  if((await handle.stat()).size!==pos||hash.digest('hex')!==release.sha)throw invalid();
}
// Reset the inactivity clock between reads. Disk writes and hashing do not use
// the network budget. A slow stream can keep making progress indefinitely.
async function appendResponse(handle,release,offset,request,signal,progress,idleTimeoutMs){
  const stalled=new AbortController(), combined=AbortSignal.any([signal,stalled.signal]);
  let timer,response,reader,received=offset,transferred=0;
  const cancelRead=()=>{reader?.cancel(combined.reason).catch(()=>{});};
  const watch=()=>{timer=setTimeout(()=>stalled.abort(interrupted()),idleTimeoutMs);};
  const fetchRange=async start=>{
    watch();try{return await request(start,combined);}finally{clearTimeout(timer);}
  };
  try{
    response=await fetchRange(offset);
    if(response.status===416&&offset){
      const total=response.headers.get('content-range');
      await response.body?.cancel();
      if(total!==null&&total!=='bytes */'+release.size)throw invalid();
      response=await fetchRange(0);
      if(response.status!==200)throw invalid();
    }
    const length=response.headers.get('content-length'),encoding=response.headers.get('content-encoding');
    if(!response.body||encoding&&encoding.toLowerCase()!=='identity')throw invalid();
    let limit=release.size;
    if(response.status===206&&offset){
      const match=/^bytes (\d+)-(\d+)\/(\d+)$/i.exec(response.headers.get('content-range')||'');
      if(!match||Number(match[1])!==offset||Number(match[3])!==release.size)throw invalid();
      limit=Number(match[2])+1;
      if(limit<=offset||limit>release.size)throw invalid();
    }else if(response.status===200&&!response.headers.has('content-range')){
      received=0;
    }else throw invalid();
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)!==limit-received))throw invalid();
    if(received!==offset){await handle.truncate(0);progress?.(0,0);}
    reader=response.body.getReader();
    combined.addEventListener('abort',cancelRead,{once:true});
    while(true){
      combined.throwIfAborted();watch();
      let result;
      try{result=await reader.read();}catch(e){combined.throwIfAborted();throw interrupted(e);}finally{clearTimeout(timer);}
      combined.throwIfAborted();
      if(result.done)break;
      const bytes=result.value;
      if(received+bytes.length>limit)throw invalid();
      // An early rejection avoids retaining an obvious non-executable on disconnect.
      if(bytes.length&&(!received&&bytes[0]!==0x4d||received<2&&received+bytes.length>=2&&bytes[1-received]!==0x5a))throw invalid();
      let written=0;
      while(written<bytes.length){
        combined.throwIfAborted();
        const {bytesWritten}=await handle.write(bytes,written,bytes.length-written,received);
        if(!bytesWritten)throw Error('Не удалось записать установщик.');
        received+=bytesWritten;transferred+=bytesWritten;written+=bytesWritten;
      }
      progress?.(received,transferred);
    }
    if(received!==release.size)throw interrupted();
  }finally{
    clearTimeout(timer);
    combined.removeEventListener('abort',cancelRead);
    // Native fetch observes the abort as well, releasing its socket on errors.
    stalled.abort();
    if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}
    else await response?.body?.cancel().catch(()=>{});
  }
}
async function receiveInstaller(release,dir,signal,progress,request,{idleTimeoutMs=45000}={}){
  signal.throwIfAborted();
  const name=partialName(release);
  dir=await cacheDirectory(dir,true);
  const file=path.join(dir,name);
  if(active.has(file))throw Error('Дождитесь завершения текущей операции обновления.');
  active.add(file);
  let handle,discard=false,stage;
  try{
    handle=await openPartial(file);
    const stat=await handle.stat({bigint:true}),pos=Number(stat.size);
    if(pos>release.size)throw invalid();
    if(pos)progress?.(pos,0);
    if(pos<release.size)await appendResponse(handle,release,pos,request,signal,progress,idleTimeoutMs);
    await handle.sync();
    await verify(handle,release,signal);
    if(!same(await partialStat(file),stat))throw invalid();
    await handle.close();handle=null;
    signal.throwIfAborted();
    stage=await fs.mkdtemp(path.join(dir,'install-'));
    const result=path.join(stage,release.name);
    await fs.rename(file,result);stage=null;
    return result;
  }catch(e){discard=e.code==='UPDATE_INVALID_PAYLOAD';throw e;}
  finally{
    try{
      if(handle){
        const empty=(await handle.stat()).size===0;
        await handle.close();
        if(discard||empty)await fs.unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});
      }
      if(stage)await fs.rmdir(stage);
    }finally{active.delete(file);}
  }
}
module.exports={cacheDirectory,receiveInstaller,partialSize,cleanupPartials};
