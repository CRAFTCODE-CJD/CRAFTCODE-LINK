// All notification audio is routed to the selected local output. A single player
// keeps a burst of messages from interrupting a ring or stacking chimes.
export function notificationSounds({state,settings,routeCue}) {
  let active=null,lastMessage=-Infinity;
  const volume=()=>Math.max(0,Math.min(1,settings.cueVolume/100));
  function allowed(kind,preview){
    const enabled=kind==='message'?settings.cueMessages:settings.cueEnabled;
    return volume()>0 && !state.deafened && !state.sharing && (preview || (enabled && !settings.dnd));
  }
  function hush(kind){
    const item=active;
    if(!item || (kind && item.kind!==kind))return;
    active=null;
    clearTimeout(item.timer);
    item.audio.onended=item.audio.onerror=null;
    item.audio.pause();
    item.unroute?.();
  }
  function play(kind,preview=false,repeat=false){
    if(!allowed(kind,preview))return;
    const now=performance.now();
    if(kind==='message' && !preview){
      if(active?.kind==='ring' || now-lastMessage<1200)return;
      lastMessage=now;
    }
    hush();
    const audio=new Audio(new URL('./assets/'+kind+'.wav',import.meta.url));
    const item=active={audio,kind,preview};
    const stop=()=>{if(active===item)hush();};
    audio.onerror=stop;
    async function start(){
      if(active!==item)return;
      if(!allowed(kind,preview))return stop();
      audio.volume=volume();
      try{await audio.play();}catch{stop();}
    }
    audio.onended=()=>{
      if(active!==item)return;
      if(repeat && kind==='ring' && allowed(kind,preview)){
        item.timer=setTimeout(()=>{audio.currentTime=0;void start();},2800);
      }else stop();
    };
    void (async()=>{
      // The exit cue outlives the room mixer.
      if(kind!=='ended')item.unroute=routeCue(audio)||null;
      if(!item.unroute && settings.outputDevice && audio.setSinkId)await audio.setSinkId(settings.outputDevice);
      await start();
    })().catch(stop);
  }
  function refresh(){
    if(!active)return;
    if(allowed(active.kind,active.preview))active.audio.volume=volume();
    else hush();
  }
  return {play,hush,refresh};
}
