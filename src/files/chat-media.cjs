'use strict';
const {createHash}=require('node:crypto');
const fs=require('node:fs/promises');
const MAX_CLIP=8*1024**2;
function isIsoMedia(bytes,brands){
  if(bytes.length<16||bytes.toString('latin1',4,8)!=='ftyp')return false;
  const end=bytes.readUInt32BE(0);
  if(end<16||end>bytes.length||(end%4)!==0)return false;
  if(brands.includes(bytes.toString('latin1',8,12)))return true;
  for(let p=16;p+4<=Math.min(end,1024);p+=4){
    if(brands.includes(bytes.toString('latin1',p,p+4)))return true;
  }
  return false;
}
function isMpegAudio(bytes){
  if(bytes.length<4)return false;
  if(bytes.toString('latin1',0,3)==='ID3'&&bytes.length>=10){
    return bytes[3]>=2&&bytes[3]<=4&&bytes[4]!==255&&bytes.subarray(6,10).every(byte=>byte<128);
  }
  return bytes[0]===255&&(bytes[1]&0xe0)===0xe0&&(bytes[1]&0x18)!==8&&
    (bytes[1]&6)!==0&&(bytes[2]&0xf0)!==0xf0&&(bytes[2]&12)!==12;
}
function mediaType(name,b){
  const ext=String(name).toLowerCase().split('.').pop();
  if(ext==='png'&&b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'image/png';
  if(['jpeg','jpg'].includes(ext)&&b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
  if(ext==='webp'&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return 'image/webp';
  if(ext==='gif'&&['GIF87a','GIF89a'].includes(b.toString('latin1',0,6)))return 'image/gif';
  if(ext==='avif'&&isIsoMedia(b,['avif','avis']))return 'image/avif';
  if(['mp4','m4v','m4a'].includes(ext)&&isIsoMedia(b,['isom','iso2','iso4','iso5','iso6','mp41','mp42','avc1','dash','M4V ','M4A ']))
    return ext==='m4a'?'audio/mp4':'video/mp4';
  if(ext==='mp3'&&isMpegAudio(b))return 'audio/mpeg';
  if(ext==='wav'&&b.toString('latin1',0,4)==='RIFF'&&b.toString('latin1',8,12)==='WAVE')return 'audio/wav';
  if(['ogg','oga','opus'].includes(ext)&&b.length>=28&&b.toString('latin1',0,4)==='OggS'&&b[4]===0&&(b[5]&2)){
    const first=27+b[26];
    if(b.toString('latin1',first,first+8)==='OpusHead'||b.toString('latin1',first,first+7)==='\x01vorbis')return 'audio/ogg';
  }
  if(['webm','weba'].includes(ext)&&b.subarray(0,4).equals(Buffer.from('1a45dfa3','hex')))return ext==='weba'?'audio/webm':'video/webm';
  return null;
}
const digest=b=>createHash('sha256').update(b).digest('hex');
async function readPreviewBytes(filename,size){
  if(!Number.isSafeInteger(size)||size<1||size>MAX_CLIP)throw Error('Invalid media size');
  const file=await fs.open(filename,'r');
  try{
    const stat=await file.stat();if(!stat.isFile()||stat.size!==size)throw Error('Invalid media size');
    const bytes=Buffer.alloc(size);
    for(let pos=0;pos<size;){
      const {bytesRead}=await file.read(bytes,pos,size-pos,pos);
      if(!bytesRead)throw Error('Incomplete media');pos+=bytesRead;
    }
    return bytes;
  }finally{await file.close();}
}
module.exports={MAX_CLIP,mediaType,digest,readPreviewBytes};
