import {tr} from './locale.mjs';
import {voiceEnvelope,waveDrawing} from './chat-waveform.mjs';
import {fileSize} from './transfer-progress.mjs';

function element(tag,style){
  const el=document.createElement(tag);
  el.className=style;
  return el;
}
function button(style,label){
  const el=element('button',style);
  el.type='button';
  el.title=el.ariaLabel=tr(label);
  return el;
}
function stamp(seconds){
  const n=Math.max(0,Math.floor(seconds)||0);
  return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');
}
function clipInfo(container,text,unplayed=false){
  container.textContent=text;
  if(unplayed){
    const dot=element('span','clip-unplayed');dot.setAttribute('role','img');
    dot.title=dot.ariaLabel=tr('Ещё не прослушано');container.append(dot);
  }
}
export function attachmentKind(meta){
  if(meta.size>8*1024**2)return '';
  if(meta.clip==='voice'||meta.clip==='circle')return meta.clip;
  if(/\.(?:png|jpe?g|webp|gif|avif)$/i.test(meta.name))return 'photo';
  return /\.(?:web[am]|mp4|m4[va]|mp3|wav|ogg|oga|opus)$/i.test(meta.name)?'media':'';
}

// Build the same controls for a recorded draft and a verified, local chat file.
export function mediaPresentation(type,kind,url,name,onError,blob,envelope,unplayed=false){
  const image=type.startsWith('image/');
  const player=document.createElement(image?'img':type.startsWith('audio/')?'audio':'video');
  const view=element('div','clip-player');
  const events=new AbortController(),options={signal:events.signal};
  let ticker,probe,waveTask;
  function dispose(){
    events.abort();cancelAnimationFrame(ticker);
    if(probe){probe.removeAttribute('src');probe.load();}
    if(!image)player.pause();
    player.removeAttribute('src');
    if(!image)player.load();
  }
  player.src=url;view.append(player);
  player.addEventListener('error',()=>onError?.(Error(tr('Этот формат не удалось воспроизвести. Откройте файл из папки загрузок.'))),options);
  if(image){player.alt=name;view.classList.add('clip-photo');return {view,player,dispose};}
  player.preload='metadata';player.playsInline=true;
  const circle=kind==='circle'&&player.tagName==='VIDEO';
  if(!circle&&kind!=='voice'){player.controls=true;return {view,player,dispose};}
  view.classList.add(circle?'clip-round':'clip-voice');
  const toggle=button('clip-toggle','Воспроизвести'),seek=document.createElement('input');
  const elapsed=element('span','clip-time'),speed=button('clip-speed','Скорость воспроизведения');
  const controls=element('div','clip-tools');
  seek.type='range';seek.min='0';seek.max='1';seek.step='0.001';seek.value='0';seek.disabled=true;
  seek.ariaLabel=tr('Позиция воспроизведения');seek.className='clip-seek';
  toggle.append(element('span','clip-play-icon'));
  view.append(toggle);
  const track=element('div','voice-track');
  if(circle)controls.append(seek);else{track.append(seek);controls.append(track);}
  controls.append(elapsed,speed);view.append(controls);
  speed.textContent='1×';speed.onclick=()=>{
    const rates=[1,1.5,2,.75],next=rates[(rates.indexOf(player.playbackRate)+1)%rates.length];
    player.playbackRate=next;speed.textContent=next+'×';
  };
  let knownDuration=envelope?.duration||0;
  function drawWave(model){
    if(!model||events.signal.aborted||circle)return;
    knownDuration=model.duration;track.prepend(waveDrawing(model.levels));track.classList.add('has-wave');
  }
  drawWave(envelope);
  function duration(){
    return Number.isFinite(player.duration)&&player.duration>0?player.duration:knownDuration;
  }
  function progress(){
    const total=duration(),now=player.currentTime||0;
    if(!circle&&total&&!envelope&&!waveTask&&blob){
      waveTask=voiceEnvelope(blob,total).then(drawWave).catch(()=>{});
    }
    seek.disabled=!total;seek.value=total?String(Math.min(1,now/total)):'0';
    if(!circle)track.style.setProperty('--played',Number(seek.value)*100+'%');
    const label=stamp(now)+(total?' / '+stamp(total):'');
    clipInfo(elapsed,circle?label:stamp(now>0&&!player.ended?now:total)+(blob?' · '+fileSize(blob.size):''),unplayed);seek.ariaValueText=label;
    if(circle){
      view.style.setProperty('--clip-angle',Number(seek.value)*360+'deg');
      rim.ariaValueNow=String(Math.round(Number(seek.value)*100));rim.ariaValueText=label;
    }
  }
  function slide(fraction){
    if(duration())player.currentTime=Math.max(0,Math.min(1,fraction))*duration();
    progress();
  }
  seek.oninput=()=>slide(Number(seek.value));
  let rim;
  if(circle){
    // Only the outer annulus receives pointer events. The central play/pause
    // button stays clickable over the rest of the image.
    rim=element('div','clip-rim');
    rim.tabIndex=0;rim.setAttribute('role','slider');rim.ariaLabel=seek.ariaLabel;
    rim.ariaValueMin='0';rim.ariaValueMax='100';view.append(rim);
    seek.hidden=true;
    function seekAngle(e){
      const b=rim.getBoundingClientRect(),x=e.clientX-b.left-b.width/2,y=e.clientY-b.top-b.height/2;
      slide(((Math.atan2(x,-y)/(2*Math.PI))+1)%1);
    }
    rim.onpointerdown=e=>{if(e.button!==0||!duration())return;e.preventDefault();rim.setPointerCapture(e.pointerId);seekAngle(e);};
    rim.onpointermove=e=>{if(rim.hasPointerCapture(e.pointerId))seekAngle(e);};
    rim.onkeydown=e=>{
      if(!duration())return;
      const delta={ArrowRight:1,ArrowUp:1,ArrowLeft:-1,ArrowDown:-1}[e.key];
      if(delta)slide((player.currentTime+delta)/duration());
      else if(e.key==='Home'||e.key==='End')slide(e.key==='End'?1:0);
      else return;
      e.preventDefault();
    };
  }
  toggle.onclick=()=>{if(player.paused)player.play().catch(onError);else player.pause();};
  player.addEventListener('playing',()=>{unplayed=false;progress();},{once:true,...options});
  function animate(){progress();if(!player.paused&&!player.ended)ticker=requestAnimationFrame(animate);}
  function changed(){
    const playing=!player.paused&&!player.ended;
    view.classList.toggle('playing',playing);
    toggle.title=toggle.ariaLabel=tr(playing?'Пауза':'Воспроизвести');
    cancelAnimationFrame(ticker);if(circle&&playing)animate();else progress();
  }
  for(const event of ['play','pause','ended','durationchange','loadedmetadata','timeupdate'])
    player.addEventListener(event,changed,options);
  // MediaRecorder WebM files from older clients may omit the duration header.
  // Probe the end on a separate muted local element without seeking playback.
  player.addEventListener('loadedmetadata',()=>{
    if(duration()||!player.src.startsWith('blob:'))return;
    probe=document.createElement('audio');probe.preload='metadata';probe.muted=true;
    const releaseProbe=()=>{
      if(!probe)return;
      if(Number.isFinite(probe.duration)&&probe.duration>0)knownDuration=probe.duration;
      else if(probe.seekable.length)knownDuration=probe.seekable.end(probe.seekable.length-1);
      probe.removeAttribute('src');probe.load();probe=null;progress();
    };
    probe.addEventListener('loadedmetadata',()=>{if(!probe)return;if(Number.isFinite(probe.duration))releaseProbe();else probe.currentTime=86400;},{once:true,...options});
    probe.addEventListener('seeked',releaseProbe,{once:true,...options});
    probe.src=url;
  },{once:true,...options});
  progress();
  return {view,player,dispose,seekTo:slide};
}

export class ChatPlayer {
  constructor(){this.posters=new Map();this.envelopes=new WeakMap();this.played=new Set();}
  markPlayed(id,row){this.played.add(id);row?.querySelectorAll('.clip-unplayed').forEach(dot=>dot.remove());}
  close(){
    const old=this.current;this.current=null;
    if(!old)return;
    old.media?.dispose();old.box.remove();if(old.url)URL.revokeObjectURL(old.url);
    old.trigger.setAttribute('aria-expanded','false');
    if(old.label)old.trigger.title=old.trigger.ariaLabel=old.label;
  }
  // Only locally available images/video are sampled, one visible card at a time.
  // Retain a small raster, never a live decoder or a full-size attachment URL.
  styleTrigger(trigger,meta,read){
    const kind=attachmentKind(meta);
    if(!['circle','photo','voice'].includes(kind))return;
    trigger.classList.add('clip-preview-trigger','preview-'+kind);
    trigger.title=trigger.ariaLabel=trigger.textContent;
    const glyph=element('span','clip-preview-icon');
    glyph.setAttribute('aria-hidden','true');
    const unplayed=meta.own===false&&!meta.played&&!this.played.has(meta.id);
    if(kind==='voice'){
      const label=element('span','clip-preview-label');clipInfo(label,fileSize(meta.size),unplayed);trigger.replaceChildren(glyph,label);
    }
    else{
      trigger.replaceChildren(glyph);
      if(kind==='circle'&&unplayed){const label=element('span','clip-preview-label');clipInfo(label,'',true);trigger.append(label);}
    }
    if(!read)return;
    this.observer??=new IntersectionObserver(entries=>{
      for(const entry of entries){
        const item=this.posters.get(entry.target);if(item)item.visible=entry.isIntersecting;
      }
      void this.nextPoster();
    });
    this.posters.set(trigger,{kind,read,meta,visible:false});this.observer.observe(trigger);
  }
  async nextPoster(){
    if(this.drawing)return;
    const next=[...this.posters].find(([button,media])=>button.isConnected&&media.visible);
    if(!next)return;
    const [trigger,item]=next;
    this.posters.delete(trigger);this.observer.unobserve(trigger);this.drawing=true;
    let url,video,img,timeout;
    try{
      const data=await item.read();if(!trigger.isConnected)return;
      const blob=new Blob([data.bytes],{type:data.type}),size=item.kind==='photo'?276:200;
      if(item.kind==='voice'&&data.type.startsWith('audio/')){
        video=document.createElement('audio');video.muted=true;video.preload='metadata';
        const duration=await new Promise((resolve,reject)=>{
          timeout=setTimeout(reject,3000);video.onerror=reject;
          video.onloadedmetadata=()=>{if(Number.isFinite(video.duration))resolve(video.duration);else video.currentTime=86400;};
          video.onseeked=()=>resolve(Number.isFinite(video.duration)?video.duration:video.seekable.length?video.seekable.end(video.seekable.length-1):0);
          url=URL.createObjectURL(blob);video.src=url;
        });
        if(!trigger.isConnected)return;
        const envelope=await voiceEnvelope(blob,duration);
        if(!envelope||!trigger.isConnected)return;
        this.envelopes.set(trigger,envelope);
        clipInfo(trigger.querySelector('.clip-preview-label'),stamp(envelope.duration)+' · '+fileSize(item.meta.size),
          item.meta.own===false&&!item.meta.played&&!this.played.has(item.meta.id));
        const wave=waveDrawing(envelope.levels);
        wave.addEventListener('click',event=>{
          const box=wave.getBoundingClientRect();
          if(event.detail&&box.width)envelope.seekFrom=Math.max(0,Math.min(1,(event.clientX-box.left)/box.width));
        });
        trigger.append(wave);return;
      }
      if(item.kind==='circle' && data.type.startsWith('video/')){
        video=document.createElement('video');video.muted=true;video.preload='auto';
        await new Promise((resolve,reject)=>{
          timeout=setTimeout(reject,2500);video.onloadeddata=resolve;video.onerror=reject;
          url=URL.createObjectURL(blob);video.src=url;
        });
      }else if(item.kind==='photo'&&data.type.startsWith('image/')){
        img=new Image();img.decoding='async';url=URL.createObjectURL(blob);img.src=url;await img.decode();
      }else return;
      if(!trigger.isConnected)return;
      const width=video?video.videoWidth:img.naturalWidth,height=video?video.videoHeight:img.naturalHeight;
      if(!width||!height)return;
      const canvas=document.createElement('canvas');canvas.ariaHidden='true';
      const scale=Math.min(1,size/width,size/height);
      canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
      canvas.getContext('2d').drawImage(video||img,0,0,canvas.width,canvas.height);trigger.prepend(canvas);
      if(item.kind==='photo'){
        const card=trigger.closest('article')||trigger;
        card.style.setProperty('--photo-width',canvas.width+'px');
        trigger.style.setProperty('--photo-ratio',String(width/height));
      }
    }catch{/* The explicit preview control also handles a missing/invalid file. */}
    finally{
      clearTimeout(timeout);img?.removeAttribute('src');
      if(video){video.onloadeddata=video.onloadedmetadata=video.onseeked=video.onerror=null;video.removeAttribute('src');video.load();}
      if(url)URL.revokeObjectURL(url);
      this.drawing=false;void this.nextPoster();
    }
  }
  async toggle(row,trigger,id,meta,read,onError=()=>{},onPlayed){
    const same=this.current?.id===id;this.close();if(same)return;
    const box=element('div','chat-media-preview');row.append(box);
    const current=this.current={box,trigger,id,label:trigger.ariaLabel||trigger.textContent};trigger.setAttribute('aria-expanded','true');
    trigger.title=trigger.ariaLabel=tr('Закрыть просмотр');
    try{
      const data=await read();
      if(this.current!==current || !row.isConnected){if(this.current===current)this.close();return;}
      const blob=new Blob([data.bytes],{type:data.type});
      current.url=URL.createObjectURL(blob);
      const envelope=this.envelopes.get(trigger);
      current.media=mediaPresentation(data.type,meta.clip,current.url,meta.name,onError,blob,envelope,
        meta.own===false&&!meta.played&&!this.played.has(id));
      if(meta.own===false&&['voice','circle'].includes(meta.clip))current.media.player.addEventListener('playing',()=>{
        this.markPlayed(id,row.closest('article')||row);
        Promise.resolve().then(()=>onPlayed?.()).catch(onError);
      },{once:true});
      box.append(current.media.view);
      if(envelope?.seekFrom!==undefined){current.media.seekTo(envelope.seekFrom);delete envelope.seekFrom;}
      await current.media.player.play?.().catch(onError);
    }catch(e){if(this.current===current){this.close();throw e;}}
  }
  reconcile(){
    if(this.current && !this.current.box.isConnected)this.close();
    for(const trigger of this.posters.keys())if(!trigger.isConnected){this.observer.unobserve(trigger);this.posters.delete(trigger);}
  }
  clear(){
    this.close();this.observer?.disconnect();this.posters.clear();this.played.clear();
  }
}
