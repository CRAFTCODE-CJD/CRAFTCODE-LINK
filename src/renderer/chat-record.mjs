import {tr} from './locale.mjs';
import {bindChatEmoji} from './chat-emoji.mjs';

const paths={
  voice:'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V5Zm-4 6a7 7 0 0 0 14 0m-7 7v4m-4 0h8',
  circle:'M4 6h10a2 2 0 0 1 2 2v1l5-3v12l-5-3v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z'
};
function recordShortcut(form,id,record){
  const group=document.createElement('div');group.className='quick-record';
  const start=document.createElement('button'),mode=document.createElement('button');
  start.type=mode.type='button';start.id=id;mode.id=id+'Mode';mode.textContent='⇄';
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),icon=document.createElementNS(svg.namespaceURI,'path');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.append(icon);start.append(svg);
  group.append(start,mode);form.append(group);let kind='voice';
  function draw(){
    const title=tr(kind==='voice'?'Записать голосовое сообщение':'Записать видеосообщение');
    const next=tr(kind==='voice'?'Переключить на видеосообщение':'Переключить на голосовое сообщение');
    start.title=title;start.setAttribute('aria-label',title);mode.title=next;mode.setAttribute('aria-label',next);
    icon.setAttribute('d',paths[kind]);
  }
  draw();start.onclick=()=>record(kind);mode.onclick=()=>{kind=kind==='voice'?'circle':'voice';draw();start.focus({preventScroll:true});};
  return enabled=>{form.dataset.recordReady=String(enabled===true);start.disabled=mode.disabled=!enabled;};
}

export function bindChatTools({$,prefix,form,input,record,offer,onError,onInput}){
  const attach=$(prefix+'Attach'),emoji=$(prefix+'Emoji');
  const choices=emoji.querySelector('.link-chat-emoji-choices');
  bindChatEmoji({menu:emoji,choices,input,onInput});
  const buttons=[['File',offer],['Voice',()=>record('voice')],['Circle',()=>record('circle')]];
  for(const [suffix,action] of buttons)$(prefix+suffix).onclick=()=>{
    attach.open=false;Promise.resolve().then(action).catch(onError);
  };
  for(const [menu,other] of [[attach,emoji],[emoji,attach]])menu.addEventListener('toggle',()=>{if(menu.open)other.open=false;});
  attach.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&attach.open){e.preventDefault();e.stopPropagation();attach.open=false;attach.querySelector('summary').focus();}
  });
  document.addEventListener('pointerdown',e=>{if(attach.open&&!attach.contains(e.target))attach.open=false;});
  const shortcut=recordShortcut(form,prefix+'Record',kind=>Promise.resolve().then(()=>record(kind)).catch(onError));
  return enabled=>{shortcut(enabled);for(const [suffix] of buttons)$(prefix+suffix).disabled=!enabled;};
}
