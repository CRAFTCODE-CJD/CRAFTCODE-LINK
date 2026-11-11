'use strict';
const statuses=['online','away','busy','invisible'];
const switches=['friendRequests','calls','invites'];
function privacyOf(value){
  return {status:statuses.includes(value?.status)?value.status:'online',
    ...Object.fromEntries(switches.map(key=>[key,value?.[key]!==false]))};
}
function validPrivacy(value){
  return !!value && typeof value==='object' && Object.keys(value).length===4 &&
    statuses.includes(value.status) && switches.every(key=>typeof value[key]==='boolean');
}
function contactStatus(links){
  const states=links.map(l=>l.contactStatus||'online');
  return ['busy','online','away'].find(status=>states.includes(status))||'offline';
}
module.exports={privacyOf,validPrivacy,contactStatus};
