const unsafe=/[\s\\\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u;
const candidates=/(?<![\p{L}\p{N}_@./:\\-])(?:https?:\/\/[^\s<>"«»]+|(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,32}(?![\p{L}\p{N}@_-])(?::\d{1,5})?(?:[/?#][^\s<>"«»]*)?)/giu;
const bareSuffix=new Set('com org net ru xn--p1ai io dev app gg me tv info edu uk de fr eu co ai wiki site online xyz'.split(' '));

export function webAddress(raw){
  if(typeof raw!=='string' || raw.length>2048 || unsafe.test(raw) || !/^https?:\/\/[^/\\]/i.test(raw))return null;
  try{
    const u=new URL(raw);
    if(!u.hostname || u.username || u.password || u.href.length>2048)return null;
    return u;
  }catch{return null;}
}

function trimEnd(raw){
  let text=raw.replace(/[.,:;!?…'’]+$/u,'');
  for(const [opening,closing] of [['(',')'],['[',']'],['{','}']]){
    let extra=text.split(closing).length-text.split(opening).length;
    while(extra-->0 && text.endsWith(closing))text=text.slice(0,-1);
  }
  return text;
}

export function splitAddresses(text){
  const parts=[];let from=0;
  for(const match of text.matchAll(candidates)){
    const shown=trimEnd(match[0]);
    const absolute=/^https?:\/\//i.test(shown);
    const url=webAddress(absolute?shown:'https://'+shown);
    if(!url || !absolute && !bareSuffix.has(url.hostname.split('.').at(-1)))continue;
    if(match.index>from)parts.push({text:text.slice(from,match.index)});
    parts.push({text:shown,href:url.href});
    from=match.index+shown.length;
  }
  if(from<text.length)parts.push({text:text.slice(from)});
  return parts;
}

export function describeAddress(url){
  const host=url.hostname.toLowerCase(),segments=url.pathname.split('/').filter(Boolean);
  let title='';
  try{title=decodeURIComponent(segments.at(-1)||'').replace(/[-_]+/g,' ').replace(/[\p{Cc}\p{Cf}]/gu,'').slice(0,90);}catch{}
  const card={host:url.host,title:title||url.host,kind:'Веб-страница'};
  if(url.protocol!=='https:' || url.port)return card;
  if(host==='github.com' && /^[a-z\d-]{1,39}$/i.test(segments[0]||'') && /^[a-z\d_.-]{1,100}$/i.test(segments[1]||'')){
    const repository=segments[0]+'/'+segments[1];
    const number=/^\d{1,12}$/.test(segments[3]||'') && ['issues','pull'].includes(segments[2])?' #'+segments[3]:'';
    return {...card,kind:'Репозиторий GitHub',title:repository+number,provider:'github',resource:repository};
  }
  if(['youtu.be','youtube.com','www.youtube.com','m.youtube.com'].includes(host)){
    const id=host==='youtu.be'?segments[0]:url.pathname==='/watch'?url.searchParams.get('v'):
      ['shorts','live','embed'].includes(segments[0])?segments[1]:null;
    if(/^[A-Za-z\d_-]{11}$/.test(id||''))return {...card,kind:'Видео на YouTube',title:'YouTube',provider:'youtube',resource:id};
  }
  if(host==='t.me' && /^[a-z\d_]{3,40}$/i.test(segments[0]||''))return {...card,kind:'Telegram',title:'@'+segments[0]};
  return card;
}
