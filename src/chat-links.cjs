'use strict';
const {tr}=require('./native-language.cjs');

function clean(value,max){
  return typeof value==='string'?value.replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
}
async function readPublic(endpoint,fetcher,signal,accept,limit){
  const response=await fetcher(endpoint,{redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',
    headers:{Accept:accept,'User-Agent':'CRAFTCODE-LINK'},signal});
  if(!response.ok || !response.body){await response.body?.cancel();throw Error();}
  const reader=response.body.getReader(),chunks=[];let total=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      total+=value.byteLength;if(total>limit)throw Error();
      chunks.push(Buffer.from(value));
    }
  }finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks,total);
}
async function metadata(card,fetcher,signal){
  let endpoint;
  if(card.provider==='github')endpoint='https://api.github.com/repos/'+card.resource;
  else if(card.provider==='youtube')endpoint='https://www.youtube.com/oembed?format=json&url='+encodeURIComponent('https://www.youtube.com/watch?v='+card.resource);
  else throw Error(tr('Для этой ссылки доступна локальная карточка.'));
  const json=await readPublic(endpoint,fetcher,signal,'application/json',64*1024);
  const item=JSON.parse(json.toString('utf8'));
  const title=clean(card.provider==='github'?item.full_name:item.title,150);
  const description=clean(card.provider==='github'?item.description:item.author_name,240);
  if(!title)throw Error();
  const info={title,description};
  if(card.provider==='youtube' && typeof item.thumbnail_url==='string'){
    // An oEmbed document may contain arbitrary URLs and HTML. Build the one
    // permitted thumbnail from our validated video ID, never follow its URL.
    try{
      const bytes=await readPublic('https://i.ytimg.com/vi/'+card.resource+'/mqdefault.jpg',fetcher,signal,'image/jpeg',128*1024);
      if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)
        info.thumbnail='data:image/jpeg;base64,'+bytes.toString('base64');
    }catch{if(signal.aborted)throw signal.reason;} // The title remains useful when the CDN is unavailable.
  }
  return info;
}

function registerChatLinks({handle,allowed,openExternal,player,fetcher=fetch}){
  const active=new Set();
  const cancel=()=>{for(const request of active)request.abort();player?.close();};
  handle('chat-link',async raw=>{
    const {webAddress,describeAddress}=await import('./renderer/chat-address.mjs');
    const url=webAddress(raw?.url);
    if(!url)throw Error(tr('Недопустимый адрес ссылки.'));
    if(raw.action==='open'){await openExternal(url.href);return true;}
    if(!allowed())throw Error(tr('Загрузка описаний ссылок отключена в строгом режиме.'));
    if(raw.action==='play'){
      const card=describeAddress(url);
      if(card.provider!=='youtube'||!player)throw Error(tr('Не удалось открыть видео.'));
      return player.open(card.resource);
    }
    if(raw.action!=='describe')throw Error(tr('Недопустимый адрес ссылки.'));
    if(active.size>=3)throw Error(tr('Дождитесь загрузки описания ссылки.'));
    const request=new AbortController();active.add(request);
    try{
      const result=await metadata(describeAddress(url),fetcher,AbortSignal.any([request.signal,AbortSignal.timeout(5000)]));
      if(!allowed())throw Error();
      return result;
    }catch{throw Error(tr('Не удалось загрузить описание ссылки.'));}
    finally{active.delete(request);}
  });
  return {policy(){if(!allowed())cancel();},close:cancel};
}
module.exports={registerChatLinks};
