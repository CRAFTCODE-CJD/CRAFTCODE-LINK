'use strict';
const {createHash}=require('node:crypto');
const {tr}=require('../native-language.cjs');

const publicKey=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

// A comparison fingerprint contains public identities only. Its version and
// sorted, fixed-width inputs make both participants display the same value.
function fingerprint(first,second){
  if(!publicKey(first)||!publicKey(second)||first===second)throw Error(tr('Некорректная команда.'));
  return createHash('sha256').update('CRAFTCODE LINK identity comparison v1\n')
    .update([first,second].sort().join('\n')).digest('hex');
}

function savedChecks(profile){
  const checks={};
  for(const friend of profile.friends){
    const value=profile.contactChecks?.[friend.id];
    if(friend.state!=='friend'||!value||value.version!==1||!publicKey(value.fingerprint)||
      !Number.isSafeInteger(value.time)||value.time<=0||value.time>Date.now()||
      !Array.isArray(value.devices)||value.devices.length>16||!value.devices.every(publicKey))continue;
    checks[friend.id]={version:1,fingerprint:value.fingerprint,time:value.time,devices:[...new Set(value.devices)]};
  }
  return checks;
}

function transport(link){
  const socket=link.socket;
  if(socket?.destroyed)return null;
  if(link.route==='lan'&&socket?.encrypted&&socket.getProtocol?.()==='TLSv1.3'&&
    socket.exportKeyingMaterial(32,'CRAFTCODE LINK LAN').toString('hex')===link.binding)return 'TLS1.3';
  if(link.route==='dht'&&socket?.noiseStream===socket&&socket.handshakeHash?.byteLength===64&&
    socket.handshakeHash.toString('hex')===link.binding&&socket.remotePublicKey?.toString('hex')===link.card.device)return 'Noise';
  return null;
}

function security(service,id){
  const peer=service.contact(id);
  if(!service.me||service.paused||peer?.state!=='friend'||service.blocked(id))throw Error(tr('Некорректная команда.'));
  const digest=fingerprint(service.me.id,peer.id);
  const saved=service.profile.contactChecks?.[peer.id];
  const checked=saved?.version===1&&saved.fingerprint===digest?saved:null;
  const links=service.linksTo(id).filter(link=>!link.socket?.destroyed&&link.contactStatus!=='offline');
  const devices=peer.devices.map(id=>{
    const active=links.filter(link=>link.card.device===id);
    return {id,active:active.length>0,checked:!!checked?.devices.includes(id),
      transports:[...new Set(active.map(transport).filter(Boolean))]};
  });
  const backend=service.store.storage;
  return {version:1,localId:service.me.id,peerId:id,fingerprint:digest,
    code:digest.toUpperCase().match(/.{8}/g).join(' '),verifiedAt:checked?.time||null,
    devicesChanged:!!checked&&devices.some(device=>!device.checked),
    connection:!links.length?'offline':links.every(transport)?'encrypted':'unverified',
    transports:[...new Set(links.map(transport).filter(Boolean))],devices,
    localStorageProtected:!!backend?.isEncryptionAvailable()&&
      !(process.platform==='linux'&&backend.getSelectedStorageBackend?.()==='basic_text')};
}

function verifyContact(service,id,expected,verified,devices){
  const state=security(service,id);
  if(typeof verified!=='boolean'||expected!==state.fingerprint)throw Error(tr('Профиль LINK изменился. Откройте диалог снова.'));
  if(verified&&(!Array.isArray(devices)||devices.length>16||!devices.every(publicKey)||
    devices.length!==state.devices.length||new Set(devices).size!==devices.length||
    !state.devices.every(device=>devices.includes(device.id))))
    throw Error(tr('Список устройств изменился. Откройте защиту переписки снова.'));
  const checks={...service.profile.contactChecks};
  if(verified)checks[id]={version:1,fingerprint:state.fingerprint,time:Date.now(),devices:state.devices.map(device=>device.id)};
  else delete checks[id];
  service.save({...service.profile,contactChecks:checks});service.update();
  return security(service,id);
}

module.exports={fingerprint,savedChecks,security,verifyContact};
