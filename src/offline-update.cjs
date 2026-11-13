'use strict';

const crypto=require('node:crypto');
const {tr}=require('./native-language.cjs');
const {stableVersion,newerVersion,installerName}=require('./release-version.cjs');
const maxSize=512*1024**2;
const signatureBytes=384;
const invalid=()=>Object.assign(Error(tr('Пакет обновления повреждён или подписан другим издателем.')),{code:'UPDATE_INVALID_PAYLOAD'});

async function offlineManifest(handle,current,key){
  // A bounded header contains the version, exact payload length and its digest.
  // The publisher signs the original bytes, including the format identifier and LF.
  const header=Buffer.alloc(128+signatureBytes);
  const stat=await handle.stat(),size=stat.size;
  if(!stat.isFile()||size<signatureBytes+2||size>maxSize+header.length)throw invalid();
  let read=0;
  while(read<header.length && read<size){
    const part=await handle.read(header,read,Math.min(header.length-read,size-read),read);
    if(!part.bytesRead)throw invalid();
    read+=part.bytesRead;
  }
  const end=header.indexOf(10)+1;
  if(!end||end>128||read<end+signatureBytes)throw invalid();
  const signed=header.subarray(0,end);
  const fields=/^LINKUPD1(\d{1,4}\.\d{1,4}\.\d{1,4}) ([1-9]\d{0,8}) ([a-f0-9]{64})\n$/.exec(signed.toString('latin1'));
  if(!fields)throw invalid();
  const [,version,length,sha]=fields,offset=end+signatureBytes,bytes=Number(length);
  if(bytes<2||bytes>maxSize||size!==offset+bytes)throw invalid();
  const publicKey=crypto.createPublicKey({format:'jwk',key:key??require('./offline-release-key.json')});
  if(!crypto.verify('sha256',signed,{key:publicKey,padding:crypto.constants.RSA_PKCS1_PSS_PADDING,saltLength:32},header.subarray(end,offset)))throw invalid();
  if(!stableVersion(version))throw invalid();
  if(!newerVersion(version,current))throw Error(tr('Эта версия уже установлена или устарела.'));
  return {version,sha,name:installerName(version),bytes,offset};
}
module.exports={offlineManifest,maxSize};
