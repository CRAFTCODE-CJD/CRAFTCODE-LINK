import {tr} from './locale.mjs';
export function readRelay(address,user,password){
  const value=address.trim();
  const m=/^(turns?):(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?(?:\?transport=(udp|tcp))?$/i.exec(value);
  if(!m || (m[3] && (+m[3]<1 || +m[3]>65535)) || (m[1].toLowerCase()==='turns' && m[4]?.toLowerCase()==='udp'))
    throw Error(tr('Введите адрес TURN, например turns:relay.example.org:443?transport=tcp.'));
  try {new URL('https://'+m[2]);}catch{throw Error(tr('Проверьте имя сервера TURN.'));}
  if(!user.trim() || !password || user.length>512 || password.length>1024)throw Error(tr('Введите выданные сервисом имя и пароль TURN.'));
  return {urls:value.toLowerCase(),username:user.trim(),credential:password};
}

// Only transports actually offered by the authenticated provider or entered by this user.
export function streamRelays(servers) {
  const result=[];
  for(const server of servers){
    const urls=[].concat(server.urls).filter(url=>typeof url==='string' &&
      (/^turns:/i.test(url) || /^turn:.*\?transport=tcp$/i.test(url)));
    if(urls.length)result.push({...server,urls});
  }
  return result;
}
