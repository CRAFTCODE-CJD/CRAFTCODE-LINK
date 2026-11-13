'use strict';
const fs=require('node:fs/promises');
const {receiveInstaller,partialSize,cleanupPartials}=require('./update-download.cjs');
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
async function request(url,method,fetcher,signal,headers){
  signal.throwIfAborted();
  let res;
  try{
    res=await fetcher(url,{method,headers:{'User-Agent':'CRAFTCODE-LINK-Updater',...headers},redirect:'manual',credentials:'omit',signal});
  }catch(e){
    signal.throwIfAborted();
    throw Object.assign(unavailable(),{retryable:true,cause:e});
  }
  if(res.status===429 || res.status===403&&(res.headers.has('retry-after')||res.headers.get('x-ratelimit-remaining')==='0')){
    await res.body?.cancel();
    throw Object.assign(Error(rateLimitMessage),{retryable:true,retryAfterMs:retryDelay(res)});
  }
  if(res.status===408||res.status>=500){
    await res.body?.cancel();
    throw Object.assign(unavailable(),{retryable:true,retryAfterMs:res.headers.has('retry-after')?retryDelay(res):0});
  }
  return res;
}
async function releaseAsset(url,method,fetcher,signal,headers){
  for(let hop=0;hop<=4;hop++){
    const res=await request(url,method,fetcher,signal,headers);
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
  try{
    for await(const part of res.body){
      size+=part.length;if(size>256)break;
      chunks.push(part);
    }
  }catch(e){
    signal.throwIfAborted();
    throw Object.assign(unavailable(),{retryable:true,cause:e});
  }
  if(size>256)throw invalid();
  const release=parseUpdateCode(Buffer.concat(chunks).toString('latin1'),current);
  if(release.version!==version)throw invalid();
  const url=assetPrefix+'-Setup-x64.exe';
  const info=await releaseAsset(url,'HEAD',fetcher,signal);
  await info.body?.cancel();
  const bytes=Number(info.headers.get('content-length'));
  if(info.status!==200||!Number.isSafeInteger(bytes)||bytes<2||bytes>maxSize)throw invalid();
  return {phase:'available',release:{...release,size:bytes,url}};
}
async function download(release,dir,fetcher,signal,progress,options){
  const name='CRAFTCODE-LINK-'+release.version+'-Setup-x64.exe';
  if(!stable.test(release.version)||release.name!==name||release.url!==home+'/releases/download/v'+release.version+'/'+name)throw invalid();
  return receiveInstaller(release,dir,signal,progress,(offset,watchdog)=>{
    const headers={'Accept-Encoding':'identity'};
    if(offset)headers.Range='bytes='+offset+'-';
    return releaseAsset(release.url,'GET',fetcher,watchdog,headers);
  },options);
}
function supportURL(configured=donationURL){
  if(typeof configured!=='string')return null;
  try{const u=new URL(configured);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port?u.href:null;}catch{return null;}
}
module.exports={lookup,download,partialSize,cleanupPartials,savedOffer,supportURL,removeStage,rateLimitMessage,latestURL,home};
