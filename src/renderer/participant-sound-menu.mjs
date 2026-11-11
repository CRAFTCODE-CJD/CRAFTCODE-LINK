import {tr} from './locale.mjs';

const symbols = {
  speaker:'M11 5 6 9H3v6h3l5 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  muted:'M11 5 6 9H3v6h3l5 4V5Zm5 5 5 5m0-5-5 5',
  microphone:'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V5Zm-4 6a7 7 0 0 0 14 0m-7 7v4m-4 0h8',
  micOff:'M3 3l18 18M9 9v2a3 3 0 0 0 5.1 2.1M9.2 4a3 3 0 0 1 5.8 1v5M5 11a7 7 0 0 0 11.9 5M19 11c0 .8-.1 1.5-.4 2.2M12 18v4m-4 0h8',
  more:'M4 12h1m6 0h1m6 0h1',
  close:'m6 6 12 12m0-12L6 18',
};
function iconButton(cls, label) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = cls;
  button.setAttribute('aria-label',label); button.title=label;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true');
  svg.append(document.createElementNS(svg.namespaceURI,'path')); button.append(svg);
  return button;
}
function symbol(button, kind) {
  if(button.dataset.icon===kind)return;
  button.dataset.icon=kind; button.querySelector('path').setAttribute('d',symbols[kind]);
}
export function participantSoundMenu({state,mixer,mix,createRow,createOwnRow,toggleMic,micDisabled,onError,canViewPerson,openPerson}) {
  const popup=document.createElement('div'), heading=document.createElement('strong'), hint=document.createElement('small');
  popup.id='participantSoundMenu'; popup.className='room-popover'; popup.popover='auto'; popup.setAttribute('role','dialog');
  heading.id='participantSoundHeading'; popup.setAttribute('aria-labelledby',heading.id);
  const close=iconButton('tile-sound-button',tr('Закрыть'));symbol(close,'close');
  const header=document.createElement('div');header.className='sound-menu-head';header.append(heading,close);
  const body=document.createElement('div'), permission=document.createElement('button');
  permission.type='button';permission.className='button button-secondary speaker-permission';permission.hidden=true;
  const person=document.createElement('button');person.type='button';person.className='button button-secondary';person.hidden=true;
  person.textContent=tr('Карточка участника');
  person.onclick=()=>{const peer=state.peers.find(p=>p.id===target);hide(true);if(peer&&canViewPerson())openPerson(peer);};
  popup.append(header,hint,body,permission,person);document.body.append(popup);
  let target=null, anchor=null;
  function hide(restore=false){
    if(!target)return;
    const returnTo=anchor; popup.hidePopover();target=null;anchor=null;
    returnTo?.setAttribute('aria-expanded','false');
    if(restore && returnTo?.isConnected)returnTo.focus({preventScroll:true});
  }
  close.onclick=()=>hide(true);
  popup.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();hide(true);}});
  popup.addEventListener('toggle',()=>{if(!popup.matches(':popover-open')){anchor?.setAttribute('aria-expanded','false');target=null;anchor=null;}});
  window.addEventListener('resize',()=>hide());
  function canGrant(id){
    return state.media?.isHost && state.media.moderated && !state.session?.groupVoice &&
      id!==state.session?.selfId && state.peers.some(p=>p.id===id);
  }
  permission.onclick=()=>{
    if(canGrant(target))state.media.setRights(true,target,!state.media.speakers.has(target)).catch(onError);
  };
  function refreshMenu(peer,own){
    person.hidden=own||!canViewPerson();
    hint.textContent=tr(own?'Моя громкость для друзей':mix.remembered(peer.id)?'Настройки сохраняются для этого друга':'Настройки действуют в этой комнате');
    permission.hidden=!canGrant(peer.id);
    if(!permission.hidden)permission.textContent=tr(state.media.speakers.has(peer.id)?'Забрать слово':'Дать слово');
  }
  function show(peer, button, point){
    const same=target===peer.id;hide();if(same && !point)return;
    if(!state.session || !state.peers.some(p=>p.id===peer.id))return;
    const own=peer.id===state.session.selfId;
    target=peer.id;anchor=button;button.setAttribute('aria-expanded','true');
    heading.textContent=peer.name;
    refreshMenu(peer,own);
    body.replaceChildren(...['voice','system'].map(role=>own?createOwnRow(role):createRow(peer,role)));
    popup.showPopover();
    const rect=button.getBoundingClientRect();
    const x=point?.x??rect.left,y=point?.y??rect.bottom+5;
    popup.style.left=Math.max(6,Math.min(x,window.innerWidth-popup.offsetWidth-6))+'px';
    popup.style.top=Math.max(6,Math.min(y,window.innerHeight-popup.offsetHeight-6))+'px';
    body.querySelector('input').focus({preventScroll:true});
  }
  function mount(tile,peer,own){
    const controls=document.createElement('div');controls.className='tile-actions';
    const mute=iconButton('tile-sound-button tile-mute','');
    mute.onclick=()=>own?toggleMic():mix.set(peer.id,'voice',{muted:!mixer.getSetting(peer.id,'voice').muted},true);
    controls.append(mute);
    const menu=iconButton('tile-sound-button tile-sound-menu',tr(own?'Моя громкость для друзей':'Настроить звук')+' · '+peer.name);
    menu.setAttribute('aria-haspopup','dialog');menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-controls',popup.id);symbol(menu,'more');
    menu.onclick=()=>show(peer,menu); controls.append(menu);
    tile.addEventListener('contextmenu',e=>{e.preventDefault();show(peer,menu,e.button===2?{x:e.clientX,y:e.clientY}:undefined);});
    tile.addEventListener('keydown',e=>{
      if(e.key==='ContextMenu'||e.key==='F10'&&e.shiftKey){e.preventDefault();show(peer,menu);}
    });
    tile.append(controls);
  }
  function draw(tile,peer,own){
    const button=tile.querySelector('.tile-mute'), muted=own ? state.micMuted : mixer.getSetting(peer.id,'voice').muted;
    const label=own ? tr(muted?'Включить микрофон':'Выключить микрофон') : tr(muted?'Вернуть голос у меня':'Заглушить голос у меня')+' · '+peer.name;
    button.title=label;button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(muted));
    button.disabled=own&&micDisabled();symbol(button,own?(muted?'micOff':'microphone'):(muted?'muted':'speaker'));
    if(target===peer.id)refreshMenu(peer,own);
  }
  function prune(ids){if(target && !ids.has(target))hide();}
  return {mount,draw,prune};
}
