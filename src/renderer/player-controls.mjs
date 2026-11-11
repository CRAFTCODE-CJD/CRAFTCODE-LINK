import {tr} from './locale.mjs';

export function attachVideo(video, track) {
  if ((video.srcObject?.getVideoTracks()[0] || null) === track) return;
  video.srcObject = track ? new MediaStream([track]) : null;
  if (track) video.play().catch(() => {});
}

export function bindPlayerControls(stage,bar,enter,exit,onError,{pin,pinned,savePin}){
  let timer,overBar=false,dragging=false,keyboard=false;
  const fullscreen=()=>document.fullscreenElement===stage;
  function show(){
    clearTimeout(timer);
    stage.classList.remove('controls-asleep');
    if(bar.hidden || pinned || overBar || dragging || (keyboard && bar.contains(document.activeElement)))return;
    timer=setTimeout(()=>stage.classList.add('controls-asleep'),1800);
  }
  function drawPin(){
    pin.setAttribute('aria-pressed',String(pinned));
    pin.title=pinned?tr('Открепить панель'):tr('Закрепить панель');
    pin.setAttribute('aria-label',pin.title);
  }
  drawPin();
  pin.addEventListener('click',()=>{pinned=!pinned;drawPin();savePin(pinned);show();});
  new MutationObserver(show).observe(bar,{attributes:true,attributeFilter:['hidden']});
  stage.addEventListener('pointermove',event=>{
    if(bar.hidden || event.pointerType==='touch')return;
    keyboard=false;
    const inside=event.clientY>=stage.getBoundingClientRect().bottom-Math.max(62,bar.offsetHeight+22);
    if(inside || inside!==overBar){overBar=inside;show();}
  });
  stage.addEventListener('pointerleave',()=>{overBar=false;show();});
  stage.addEventListener('pointerdown',event=>{keyboard=false;if(event.pointerType==='touch')show();});
  bar.addEventListener('pointerdown',()=>{dragging=true;show();});
  const release=()=>{if(dragging){dragging=false;show();}};
  window.addEventListener('pointerup',release);
  window.addEventListener('pointercancel',release);
  document.addEventListener('keydown',event=>{
    if(fullscreen() && event.key==='Escape'){event.preventDefault();document.exitFullscreen().catch(onError);return;}
    if(event.key==='Tab'){keyboard=true;if(fullscreen() || stage.contains(document.activeElement))show();}
  },true);
  bar.addEventListener('focusin',show);
  bar.addEventListener('focusout',()=>queueMicrotask(show));
  document.addEventListener('fullscreenchange',()=>{
    overBar=dragging=keyboard=false;show();
    if(!fullscreen() && !enter.disabled && !document.fullscreenElement)enter.focus({preventScroll:true});
  });
  enter.addEventListener('click',()=>stage.requestFullscreen().catch(onError));
  exit.addEventListener('click',()=>document.exitFullscreen().catch(onError));
}
