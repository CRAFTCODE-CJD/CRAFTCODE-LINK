'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {parseUpdateCode}=require('./renderer/release-code.mjs');
const {repository,donationURL}=require('./project-links.json');

const home='https://github.com/'+repository;
const latestURL=home+'/releases/latest';
const maxSize=512*1024**2;
const stable=/^(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})$/;
const hosts=new Set(['release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com']);
const unavailable=()=>Error('Не удалось получить выпуск с GitHub. Повторите проверку позже.');
const invalid=()=>Error('Установщик выпуска не прошёл проверку.');
const rateLimitMessage='GitHub временно ограничил частоту проверок. Повторите позже.';
function removeStage(directory){return fs.rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:75});}
function newer(a,b){
  const left=a.split('.').map(Number),right=b.split('.').map(Number);
  return (left.map((n,i)=>n-right[i]).find(n=>n!==0)||0)>0;
}
function savedOffer(value,current){
  if(typeof value?.version!=='string' || !stable.test(value.version) || !stable.test(current) || !newer(value.version,current) ||
    !Number.isSafeInteger(value.size) || value.size<2 || value.size>maxSize)return null;
  return {version:value.version,size:value.size};
}
const redirects=new Set([301,302,303,307,308]);
function retryDelay(res){
  const raw=res.headers.get('retry-after');
  if(!raw)return 60000;
  const delay=/^\d+$/.test(raw)?Number(raw)*1000:Date.parse(raw)-Date.now();
  return Number.isFinite(delay)?Math.max(1000,Math.min(delay,7*86400000)):60000;
}
async function request(url,method,fetcher,signal){
  signal.throwIfAborted();
  const res=await fetcher(url,{method,headers:{'User-Agent':'CRAFTCODE-LINK-Updater'},redirect:'manual',credentials:'omit',signal});
  if(res.status===429 || res.status===403&&(res.headers.has('retry-after')||res.headers.get('x-ratelimit-remaining')==='0')){
    await res.body?.cancel();
    throw Object.assign(Error(rateLimitMessage),{retryAfterMs:retryDelay(res)});
  }
  return res;
}
async function releaseAsset(url,method,fetcher,signal){
  for(let hop=0;hop<=4;hop++){
    const res=await request(url,method,fetcher,signal);
    if(!redirects.has(res.status))return res;
    await res.body?.cancel();
    const location=res.headers.get('location');
    if(!location||hop===4)throw invalid();
    const target=new URL(location,url);
    if(target.protocol!=='https:'||!hosts.has(target.hostname)||target.username||target.password||target.port||target.hash)throw invalid();
    url=target.href;
  }
}
async function lookup(current,fetcher,signal){
  if(!stable.test(current))throw unavailable();
  // GitHub's public permalink points directly to the latest stable tag.
  // A current installation needs one HEAD and no release assets or REST quota.
  const head=await request(latestURL,'HEAD',fetcher,signal);
  await head.body?.cancel();
  if(head.status===404)return {phase:'unpublished'};
  if(!redirects.has(head.status)||!head.headers.has('location'))throw unavailable();
  const tagURL=new URL(head.headers.get('location'),latestURL).href;
  const prefix=home+'/releases/tag/v',version=tagURL.slice(prefix.length);
  if(!tagURL.startsWith(prefix)||!stable.test(version))throw invalid();
  if(!newer(version,current))return {phase:'current'};

  const assetPrefix=home+'/releases/download/v'+version+'/CRAFTCODE-LINK-'+version;
  const res=await releaseAsset(assetPrefix+'-Update-Code.txt','GET',fetcher,signal);
  if(res.status!==200||!res.body||Number(res.headers.get('content-length'))>256){await res.body?.cancel();throw invalid();}
  let size=0;const chunks=[];
  for await(const part of res.body){
    size+=part.length;if(size>256)throw invalid();
    chunks.push(part);
  }
  const release=parseUpdateCode(Buffer.concat(chunks).toString('latin1'),current);
  if(release.version!==version)throw invalid();
  const url=assetPrefix+'-Setup-x64.exe';
  const info=await releaseAsset(url,'HEAD',fetcher,signal);
  await info.body?.cancel();
  const bytes=Number(info.headers.get('content-length'));
  if(info.status!==200||!Number.isSafeInteger(bytes)||bytes<2||bytes>maxSize)throw invalid();
  return {phase:'available',release:{...release,size:bytes,url}};
}
async function download(release,dir,fetcher,signal,progress){
  const res=await releaseAsset(release.url,'GET',fetcher,signal);
  const length=res.headers.get('content-length');
  if(res.status!==200 || !res.body || length!==null&&Number(length)!==release.size){await res.body?.cancel();throw invalid();}
  await fs.mkdir(dir,{recursive:true,mode:0o700});
  const work=await fs.mkdtemp(path.join(dir,'install-')),file=path.join(work,release.name);
  let handle,committed=false;
  try{
    handle=await fs.open(file,'wx',0o700);
    const hash=crypto.createHash('sha256'),magic=Buffer.alloc(2);let received=0;
    for await(const part of res.body){
      signal.throwIfAborted();
      const bytes=Buffer.from(part);
      if(received<2)bytes.copy(magic,received,0,Math.min(2-received,bytes.length));
      received+=bytes.length;if(received>release.size)throw invalid();
      hash.update(bytes);await handle.writeFile(bytes);
      progress?.(received);
    }
    if(received!==release.size || magic[0]!==0x4d || magic[1]!==0x5a || hash.digest('hex')!==release.sha)throw invalid();
    await handle.sync();await handle.close();handle=null;committed=true;return file;
  }finally{
    await handle?.close().catch(()=>{});
    if(!committed)await removeStage(work);
  }
}
function supportURL(configured=donationURL){
  if(typeof configured!=='string')return null;
  try{const u=new URL(configured);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port?u.href:null;}catch{return null;}
}
module.exports={lookup,download,savedOffer,supportURL,removeStage,rateLimitMessage,latestURL,home};
