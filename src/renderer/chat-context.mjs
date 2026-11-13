import {tr} from './locale.mjs';

export function chatContext(log,onError,options){
  const menu=document.createElement('div');
  menu.className='chat-context-menu';menu.popover='auto';menu.setAttribute('role','menu');
  menu.ariaLabel=tr('Действия с сообщением');document.body.append(menu);
  let anchor,source;
  function close(restore=false){
    if(menu.matches(':popover-open'))menu.hidePopover();
    if(restore&&anchor?.isConnected)anchor.focus({preventScroll:true});
    anchor=null;source=null;
  }
  function show(card,point,topic){
    close();source=card;
    anchor=topic?.closest('button,a[href],input,[tabindex]')||card;
    menu.replaceChildren();
    const add=(label,act)=>{
      const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitem');b.textContent=label;
      b.onclick=async()=>{
        const valid=source?.isConnected && log.contains(source) && source.getClientRects().length>0;
        close(true);if(!valid)return;
        try{await act();}catch(error){onError?.(error);}
      };
      menu.append(b);
    };
    const message=card.querySelector('.attachment-caption,.link-chat-body:not([hidden])')?.textContent||
      card.querySelector('.file-name')?.textContent;
    if(message)add(tr('Копировать текст'),()=>window.craftlink.copyText(message));
    const url=(topic?.closest('a.chat-url')||card.querySelector('a.chat-url'))?.href;
    if(url){
      add(tr('Копировать ссылку'),()=>window.craftlink.copyText(url));
      add(tr('Открыть ссылку'),()=>window.craftlink.chatLink({action:'open',url}));
    }
    for(const b of card.querySelectorAll(':is(.chat-file-actions,.file-actions,.group-attachment-preview) button[data-action]:not(:disabled,[hidden]),button[data-action=channel-file]:not(:disabled,[hidden])')){
      const label=b.dataset.action==='channel-file'?tr('Файлы канала'):
        b.getAttribute('aria-expanded')==='true'?tr('Закрыть просмотр'):b.ariaLabel||b.textContent;
      add(label,()=>b.click());
    }
    if(!menu.childElementCount){close();return;}
    menu.showPopover();
    const bounds=(anchor||card).getBoundingClientRect();
    menu.style.left=Math.max(5,Math.min(point?.x??bounds.left,innerWidth-menu.offsetWidth-5))+'px';
    menu.style.top=Math.max(5,Math.min(point?.y??bounds.bottom,innerHeight-menu.offsetHeight-5))+'px';
    menu.firstElementChild.focus({preventScroll:true});
  }
  const row=target=>target.closest('article.link-chat-message,article.chat-attachment');
  log.addEventListener('contextmenu',e=>{
    const card=row(e.target);if(!card)return;
    e.preventDefault();show(card,e.button===2?{x:e.clientX,y:e.clientY}:null,e.target);
  },options);
  log.addEventListener('keydown',e=>{
    if(e.key!=='ContextMenu'&&!(e.shiftKey&&e.key==='F10'))return;
    const card=row(e.target);if(card){e.preventDefault();show(card,null,e.target);}
  },options);
  menu.onkeydown=e=>{
    if(e.key==='Escape'){e.preventDefault();close(true);return;}
    if(e.key==='Tab'){close(true);return;}
    const items=[...menu.children],index=items.indexOf(document.activeElement);
    const next={ArrowDown:index+1,ArrowUp:index-1,Home:0,End:items.length-1}[e.key];
    if(next!==undefined){e.preventDefault();items[(items.length+next)%items.length].focus();}
  };
  menu.addEventListener('toggle',()=>{
    if(!menu.matches(':popover-open')){anchor=null;source=null;menu.replaceChildren();}
  });
  options.signal.addEventListener('abort',()=>menu.remove(),{once:true});
  return {close,refresh(){if(source&&!source.isConnected)close();}};
}
