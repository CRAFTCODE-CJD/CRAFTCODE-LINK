import {splitAddresses,describeAddress} from './chat-address.mjs';
import {tr} from './locale.mjs';
import {appendChatText} from './chat-glyphs.mjs';

function anchor(part){
  const a=document.createElement('a');a.href=part.href;a.textContent=part.text;
  a.className='chat-url';a.target='_blank';a.rel='noopener noreferrer';return a;
}
export function chatLinks(log,onError,options){
  const descriptions=new Map(),pending=new Set();
  function display(card,model){
    const info=descriptions.get(card.dataset.url);
    card.querySelector('strong').textContent=info?.title||model.title;
    const detail=card.querySelector('small');
    detail.textContent=info?.description||'';detail.hidden=!detail.textContent;
    const button=card.querySelector('[data-action=describe]');
    if(button){button.hidden=!!info;button.disabled=pending.has(card.dataset.url);}
    const poster=card.querySelector('.chat-video-poster');
    if(poster && info?.thumbnail && !poster.querySelector('img')){
      const image=document.createElement('img');
      image.alt=info.title;image.src=info.thumbnail;poster.prepend(image);
    }
  }
  function render(body,text){
    const parts=splitAddresses(text),first=parts.find(p=>p.href);
    if(!first){appendChatText(body,text);return;}
    for(const part of parts){if(part.href)body.append(anchor(part));else appendChatText(body,part.text);}
    const model=describeAddress(new URL(first.href));
    const card=document.createElement('div');card.className='chat-link-card';card.dataset.url=first.href;
    const a=anchor(first),domain=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small');
    domain.textContent=tr(model.kind)+' · '+model.host;
    a.replaceChildren(domain,name,detail);card.append(a);
    if(model.provider==='youtube'){
      const play=document.createElement('button'),badge=document.createElement('span');
      play.type='button';play.className='chat-video-poster';play.dataset.action='play-video';
      play.title=play.ariaLabel=tr('Смотреть видео в LINK');
      badge.textContent='▶';badge.ariaHidden='true';play.append(badge);card.prepend(play);
    }
    if(model.provider){
      const more=document.createElement('button');more.type='button';more.textContent=tr('Загрузить описание');
      more.dataset.action='describe';more.title=tr(model.provider==='youtube'?'Загрузить название и обложку с YouTube':'Запросить название у сайта');card.append(more);
    }
    display(card,model);return card;
  }
  async function act(event){
    const a=event.target.closest('a.chat-url');
    const button=event.target.closest('.chat-link-card button');
    if(!a && !button)return;
    event.preventDefault();
    if(!event.isTrusted || (event.type==='auxclick' && event.button!==1))return;
    const api=window.craftlink;
    try{
      if(a){await api.chatLink({action:'open',url:a.href});return;}
      const card=button.closest('.chat-link-card'),url=card.dataset.url;
      if(button.dataset.action==='play-video'){
        button.disabled=true;
        try{await api.chatLink({action:'play',url});}finally{button.disabled=false;}
        return;
      }
      if(pending.has(url))return;
      pending.add(url);button.disabled=true;
      const generation=scope;
      try{
        const result=await api.chatLink({action:'describe',url});
        if(scope!==generation)return;
        if(descriptions.size>=48)descriptions.delete(descriptions.keys().next().value);
        descriptions.set(url,result);
      }finally{
        if(scope===generation){
          pending.delete(url);
          for(const el of log.querySelectorAll('.chat-link-card'))if(el.dataset.url===url)display(el,describeAddress(new URL(url)));
        }
      }
    }catch(error){onError?.(error);}
  }
  let scope=0;
  log.addEventListener('click',act,options);log.addEventListener('auxclick',act,options);
  return {render,clear(){scope++;pending.clear();descriptions.clear();}};
}
