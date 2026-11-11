'use strict';
const {createHash,createHmac}=require('node:crypto');

// Exactly 48 × 48 opaque RGB pixels. Received bytes never enter an image decoder.
const PIXELS_LENGTH=48*48*4;
const validPixels=value=>typeof value==='string' && value.length===PIXELS_LENGTH && /^[A-Za-z0-9+/]+$/.test(value);
const covers=new Set(['default','lagoon','twilight','ember','glacier','blossom']);
function validStyle(cover,about){
  return covers.has(cover) && typeof about==='string' && about.length<=160 && about===about.trim() &&
    !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(about);
}
function validStyleRecord(v){
  return !!v && Object.keys(v).length===4 && validStyle(v.cover,v.about) && Number.isSafeInteger(v.time) && v.time>0 &&
    typeof v.device==='string' && /^[a-f0-9]{64}$/.test(v.device);
}
const publicStyle=v=>v?{cover:v.cover,about:v.about}:undefined;
function validAvatar(v){
  return !!v && typeof v==='object' && Object.keys(v).length===3 && Number.isSafeInteger(v.time) && v.time>0 && typeof v.device==='string' && /^[a-f0-9]{64}$/.test(v.device) && (v.pixels===null||validPixels(v.pixels));
}
function newer(next,old){
  return !old || next.time>old.time || next.time===old.time && next.device>old.device;
}
function validRoomMap(m){
  return typeof m.room==='string' && /^[a-f0-9]{64}$/.test(m.room) && Array.isArray(m.members) && m.members.length<=7 &&
    m.members.every(row=>Array.isArray(row) && row.length===3 && typeof row[0]==='string' && /^[A-Za-z0-9_-]{16}$/.test(row[0]) && typeof row[1]==='string' && /^[a-f0-9]{64}$/.test(row[1]) && typeof row[2]==='string' && /^[A-Za-z0-9+/]{86}==$/.test(row[2])) &&
    new Set(m.members.map(row=>row[0])).size===m.members.length;
}
const roomTag=invite=>createHash('sha256').update('LINK room avatars v1\n'+invite).digest('hex');
const memberTag=(room,recipient,person)=>createHmac('sha256',room).update(recipient+person).digest('hex');
const witnessFields=(room,peer)=>['LINK room appearance v1',room,peer];
module.exports={validPixels,validAvatar,validStyle,validStyleRecord,publicStyle,newer,roomTag,memberTag,validRoomMap,witnessFields};
