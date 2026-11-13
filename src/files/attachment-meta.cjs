'use strict';
const {exactKeys}=require('../core/protocol.cjs');
const {safe,MAX:MAX_FILE}=require('./storage.cjs');
const {MAX_CLIP}=require('./chat-media.cjs');
const LEGACY_FILE_LIMIT=256*1024**2;
function validMeta(m){
  return exactKeys(m,['name','size','sha','clip']) && typeof m.name==='string' && safe(m.name)===m.name && m.name.trim()===m.name &&
    Number.isSafeInteger(m.size) && m.size>=0 && m.size<=MAX_FILE && typeof m.sha==='string' && /^[a-f0-9]{64}$/.test(m.sha) &&
    (!Object.hasOwn(m,'clip') || m.size>=4 && m.size<=MAX_CLIP &&
      (m.clip==='voice'&&m.name.endsWith('.weba') || m.clip==='circle'&&m.name.endsWith('.webm')));
}
module.exports={MAX_FILE,LEGACY_FILE_LIMIT,validMeta};
