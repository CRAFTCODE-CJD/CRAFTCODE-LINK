import {tr} from './locale.mjs';

export function requestNotices({$, quiet, ring, clearBalloon, answer, onError}) {
  const notice=$('requestNotice');
  const sources=new Map(), queue=new Map();
  const controls=[$('noticeAccept'),$('noticeDecline')];
  let current, timer, returnTarget, busy=false;
  const paused=()=>notice.matches(':hover, :focus-within');
  function arm(){
    clearTimeout(timer);
    if(!notice.hidden && !busy && !paused())timer=setTimeout(skip,15000);
  }
  function skip(){if(current)queue.delete(current.source+'/'+current.id);present();}
  function dismiss(){
    queue.clear();present();
  }
  function present(){
    const modal=document.activeElement?.closest('dialog:modal') ||
      [...document.querySelectorAll('dialog:modal')].at(-1);
    const inInbox=modal ? modal.id==='internetDialog' && modal.dataset.mode!=='add' && $('onlineRequests').childElementCount>0 : $('navRequests').hasAttribute('aria-current');
    if(inInbox || quiet())queue.clear();
    const next=queue.values().next().value;
    // Never compete with a call prompt, OS-style confirmation, or fullscreen video.
    const defer=document.hidden || document.fullscreenElement || (modal && !['settingsDialog','directDialog','networkDialog','internetDialog','linkGuide'].includes(modal.id));
    if(!next || defer){
      clearTimeout(timer);
      const restore=notice.contains(document.activeElement);
      notice.hidden=true;current=null;
      if(restore && returnTarget?.isConnected && returnTarget.checkVisibility())returnTarget.focus({preventScroll:true});
      return;
    }
    const parent=modal || document.body;
    const changed=current!==next || notice.hidden || notice.parentNode!==parent;
    if(notice.parentNode!==parent){
      if(modal)modal.querySelector('header,.modal-header')?.after(notice);
      else parent.append(notice);
    }
    current=next;
    const label=queue.size>1?tr('Заявки в друзья')+' · '+queue.size:tr('Заявка в друзья');
    if($('noticeHeading').textContent!==label)$('noticeHeading').textContent=label;
    if($('noticeSender').textContent!==next.name)$('noticeSender').textContent=next.name;
    notice.hidden=false;
    if(changed)arm();
  }
  function update(source,records){
    const previous=sources.get(source) || new Map();
    const next=new Map(records.map(person=>[person.id,person]));
    sources.set(source,next);
    let fresh=null;
    for(const id of previous.keys())if(!next.has(id))queue.delete(source+'/'+id);
    for(const [id,person] of next)if(!previous.has(id) && !quiet()){
      queue.set(source+'/'+id,{source,id,name:person.name});fresh=person;
    }
    const count=[...sources.values()].reduce((n,items)=>n+items.size,0);
    const badge=$('requestBadge'), nav=$('navRequests');
    if(badge.textContent!==String(count))badge.textContent=String(count);
    badge.hidden=!count;nav.classList.toggle('has-requests',!!count);
    nav.setAttribute('aria-label',tr('Заявки')+(count?' · '+count:''));
    present();
    if(fresh && (document.hidden || !document.hasFocus() || queue.size))ring(source,fresh);
    if(!next.size && previous.size)clearBalloon(source);
  }
  async function respond(yes){
    const request=current;
    if(busy || !request || !sources.get(request.source)?.has(request.id))return;
    busy=true;clearTimeout(timer);controls.forEach(b=>b.disabled=true);
    try{await answer(request,yes);queue.delete(request.source+'/'+request.id);}
    catch(error){onError(error);}
    finally{busy=false;controls.forEach(b=>b.disabled=false);present();arm();}
  }
  controls[0].onclick=e=>{if(e.detail<2)respond(true);};
  controls[1].onclick=e=>{if(e.detail<2)respond(false);};
  $('noticeDismiss').onclick=skip;
  notice.addEventListener('pointerenter',()=>clearTimeout(timer));
  notice.addEventListener('pointerleave',arm);
  notice.addEventListener('focusin',event=>{
    if(event.relatedTarget && !notice.contains(event.relatedTarget))returnTarget=event.relatedTarget;
    clearTimeout(timer);
  });
  notice.addEventListener('focusout',()=>queueMicrotask(arm));
  document.addEventListener('visibilitychange',present);document.addEventListener('fullscreenchange',present);
  new MutationObserver(present).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open','aria-current']});
  function revealPending(){
    if(document.querySelector('dialog:modal') && !quiet()){
      for(const [source,items] of sources)for(const [id,person] of items)
        queue.set(source+'/'+id,{source,id,name:person.name});
    }
    present();
  }
  return {update,dismiss,revealPending};
}
