import {attachVideo} from './player-controls.mjs';
import {tr} from './locale.mjs';

export function pipPosition(area,box,position){
  const inset=8;
  const maxX=Math.max(0,area.width-box.width-inset*2),maxY=Math.max(0,area.height-box.height-inset*2);
  return {x:Math.min(inset,Math.max(0,(area.width-box.width)/2))+maxX*(position.side==='left'?0:1),
    y:Math.min(inset,Math.max(0,(area.height-box.height)/2))+maxY*Math.max(0,Math.min(1,Number(position.y)||0))};
}
export function callPictureInPicture({stage,storage=localStorage,swap}){
  const button=document.createElement('button');button.type='button';button.id='callPip';button.className='call-pip';button.hidden=true;
  const video=document.createElement('video');video.autoplay=true;video.muted=true;video.playsInline=true;
  const label=document.createElement('span');label.className='call-pip-label';
  const hint=document.createElement('span');hint.className='call-pip-swap';hint.textContent='⇄';hint.setAttribute('aria-hidden','true');
  button.append(video,label,hint);stage.append(button);
  let position={side:'right',y:0},drag=null,suppressClick=false,peer=null;
  try{const saved=JSON.parse(storage.getItem('craftlink.call-pip.v1'));if(saved&&['left','right'].includes(saved.side)&&Number.isFinite(saved.y))position={side:saved.side,y:Math.max(0,Math.min(1,saved.y))};}catch{}
  function place(){if(button.hidden||drag)return;const p=pipPosition(stage.getBoundingClientRect(),button.getBoundingClientRect(),position);button.style.left=p.x+'px';button.style.top=p.y+'px';}
  function save(){try{storage.setItem('craftlink.call-pip.v1',JSON.stringify(position));}catch{}}
  const observer=new ResizeObserver(place);observer.observe(stage);observer.observe(button);
  button.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    suppressClick=false;
    const b=button.getBoundingClientRect(),s=stage.getBoundingClientRect();
    drag={id:event.pointerId,startX:event.clientX,startY:event.clientY,x:b.left-s.left,y:b.top-s.top,moved:false};
    button.setPointerCapture(event.pointerId);button.classList.add('is-dragging');
  });
  button.addEventListener('pointermove',event=>{
    if(!drag||drag.id!==event.pointerId)return;
    const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;
    if(Math.abs(dx)+Math.abs(dy)>5)drag.moved=true;
    if(!drag.moved)return;
    const maxX=Math.max(0,stage.clientWidth-button.offsetWidth),maxY=Math.max(0,stage.clientHeight-button.offsetHeight);
    button.style.left=Math.max(0,Math.min(maxX,drag.x+dx))+'px';button.style.top=Math.max(0,Math.min(maxY,drag.y+dy))+'px';
  });
  function release(event){
    if(!drag||drag.id!==event.pointerId)return;
    if(drag.moved){
      position={side:button.offsetLeft+button.offsetWidth/2<stage.clientWidth/2?'left':'right',
        y:Math.max(0,Math.min(1,(button.offsetTop-8)/Math.max(1,stage.clientHeight-button.offsetHeight-16)))};
      suppressClick=event.type==='pointerup';save();
    }
    drag=null;button.classList.remove('is-dragging');place();
  }
  button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);
  button.addEventListener('click',()=>{if(suppressClick){suppressClick=false;return;}if(peer)swap(peer);});
  button.addEventListener('keydown',event=>{
    suppressClick=false;
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    event.preventDefault();
    if(event.key==='ArrowLeft')position.side='left';if(event.key==='ArrowRight')position.side='right';
    if(event.key==='ArrowUp')position.y-=0.1;if(event.key==='ArrowDown')position.y+=0.1;
    if(event.key==='Home')position={side:'right',y:0};if(event.key==='End')position={side:'left',y:1};
    position.y=Math.max(0,Math.min(1,position.y));save();place();
  });
  return {render(participant,track,{own=false,mirror=false}={}){
    peer=participant?.id||null;button.hidden=!peer||!track;
    if(button.hidden){
      if(drag && button.hasPointerCapture(drag.id))button.releasePointerCapture(drag.id);
      drag=null;suppressClick=false;button.classList.remove('is-dragging');attachVideo(video,null);return;
    }
    attachVideo(video,track);video.classList.toggle('mirrored',mirror);
    label.textContent=own?tr('Вы'):participant.name;
    button.title=tr('Поменять видео местами. Перетащите окно или используйте стрелки для перемещения.');
    button.setAttribute('aria-label',tr('Поменять видео местами')+' · '+label.textContent);place();
  }};
}
