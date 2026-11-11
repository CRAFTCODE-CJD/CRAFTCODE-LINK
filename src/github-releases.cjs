'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {repository,donationURL}=require('./project-links.json');

const api='https://api.github.com/repos/'+repository;
const home='https://github.com/'+repository;
const latestURL=api+'/releases/latest';
const maxSize=512*1024**2, metadataLimit=1024**2;
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
function selectRelease(meta,current){
  const tag=meta?.tag_name,version=typeof tag==='string'?tag.replace(/^v/,''):'';
  if(meta?.draft!==false || meta.prerelease!==false || !stable.test(version) || !stable.test(current) ||
    meta.html_url!==home+'/releases/tag/'+tag || !Array.isArray(meta.assets))throw unavailable();
  if(!newer(version,current))return null;
  const name='CRAFTCODE-LINK-'+version+'-Setup-x64.exe', matches=meta.assets.filter(a=>a?.name===name);
  const asset=matches[0];
  if(matches.length!==1 || !Number.isSafeInteger(asset.id)||asset.id<=0 || asset.state!=='uploaded' ||
    !Number.isSafeInteger(asset.size) || asset.size<2 || asset.size>maxSize || typeof asset.digest!=='string' || !/^sha256:[a-f0-9]{64}$/.test(asset.digest) ||
    asset.url!==api+'/releases/assets/'+asset.id || asset.browser_download_url!==home+'/releases/download/'+tag+'/'+name)throw invalid();
  return {version,name,sha:asset.digest.slice(7),size:asset.size,url:asset.url,browser:asset.browser_download_url};
}
function headers(accept){return {'User-Agent':'CRAFTCODE-LINK-Updater','Accept':accept,'X-GitHub-Api-Version':'2022-11-28'};}
async function lookup(current,fetcher,signal){
  const res=await fetcher(latestURL,{headers:headers('application/vnd.github+json'),redirect:'error',credentials:'omit',signal});
  if(res.status===404){await res.body?.cancel();return {phase:'unpublished'};}
  if(res.status===429 || (res.status===403 && res.headers.get('x-ratelimit-remaining')==='0')){
    await res.body?.cancel();throw Error(rateLimitMessage);
  }
  if(!res.ok || Number(res.headers.get('content-length'))>metadataLimit){await res.body?.cancel();throw unavailable();}
  let size=0;const chunks=[];
  for await(const part of res.body){
    size+=part.length;if(size>metadataLimit)throw unavailable();
    chunks.push(part);
  }
  let meta;try{meta=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw unavailable();}
  const release=selectRelease(meta,current);return release?{phase:'available',release}:{phase:'current'};
}
function redirectTarget(value,base,release){
  let target;try{target=new URL(value,base);}catch{throw invalid();}
  if(target.protocol!=='https:' || target.username || target.password || target.port || target.hash ||
    !(target.href===release.browser || hosts.has(target.hostname)))throw invalid();
  return target.href;
}
async function download(release,dir,fetcher,signal){
  let url=release.url,res;
  for(let i=0;i<=4;i++){
    signal.throwIfAborted();
    res=await fetcher(url,{headers:url===release.url?headers('application/octet-stream'):{'User-Agent':'CRAFTCODE-LINK-Updater'},
      redirect:'manual',credentials:'omit',signal});
    if(![301,302,303,307,308].includes(res.status))break;
    const next=res.headers.get('location');await res.body?.cancel();
    if(i===4||!next)throw invalid();
    url=redirectTarget(next,url,release);
  }
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
module.exports={lookup,download,selectRelease,savedOffer,supportURL,removeStage,rateLimitMessage,latestURL,api,home};
