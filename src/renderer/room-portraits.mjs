import {paintAvatar} from './profile-appearance.mjs';
import {tr} from './locale.mjs';

export function voiceStrength(level){
  return level>0.045?Math.min(1,Math.sqrt((level-0.045)/0.55)):0;
}
export function roomPortraits({grid,speakers,state,direct,mixer,mix,soundMenu,watch,ownLevel}){
  const tiles=new Map();
  const room=grid.closest('main');
  const stage=speakers.parentElement;
  let timer,scope,video,previewId,nextPreview=0;
  function visible(){
    return !room.hidden && !document.hidden && (!document.fullscreenElement || document.fullscreenElement.contains(grid));
  }
  function hideSpeaker(item){
    item.speaker?.remove();item.speaker=null;
  }
  function drawSpeaker(item,peer,strength,now){
    if(strength){
      item.lastSpoke=now;
      if(!item.speaker){
        const card=document.createElement('li');
        card.className='stream-speaker';card.style.order=String(peer.slot);
        const portrait=document.createElement('span');portrait.className='room-avatar';
        const name=document.createElement('bdi');
        card.append(portrait,name);speakers.append(card);
        item.speaker=card;
      }
      paintAvatar(item.speaker.firstChild,peer.name,item.photo);
      if(item.speaker.lastChild.textContent!==item.caption.textContent)item.speaker.lastChild.textContent=item.caption.textContent;
      item.speaker.classList.remove('fading');
    }else if(item.speaker){
      // Keep the name readable across short gaps between syllables.
      const quiet=now-item.lastSpoke;
      if(quiet>=480)hideSpeaker(item);
      else if(quiet>=320)item.speaker.classList.add('fading');
    }
  }
  function tick(){
    const full=document.fullscreenElement===stage && !!state.selectedPeerId && !room.hidden && !document.hidden;
    const showGrid=visible(),now=performance.now();
    if(!full && speakers.childElementCount)for(const item of tiles.values())hideSpeaker(item);
    if(!full && !showGrid)return;
    if(showGrid && video && now>=nextPreview)preview(previewId,video);
    for(const p of state.peers){
      const item=tiles.get(p.id);if(!item)continue;
      const own=p.id===state.session?.selfId;
      const setting=own?null:mixer.getSetting(p.id,'voice');
      const muted=p.micMuted||state.controlLost||((own||state.media?.isHost)&&!state.media?.allowed(p.slot,'voice'))||
        (own?state.micMuted:mixer.deafened||setting.muted||!setting.active||!setting.volume);
      const level=muted?0:own?ownLevel():mixer.voiceLevel(p.id);
      const strength=voiceStrength(level);
      if(full){
        if(muted)hideSpeaker(item);
        else drawSpeaker(item,p,strength,now);
      }
      if(!showGrid)continue;
      const value=strength?String(Math.round(strength*12)/12):'0';
      if(item.tile.style.getPropertyValue('--voice-level')!==value)item.tile.style.setProperty('--voice-level',value);
      item.tile.classList.toggle('is-speaking',strength>0);
    }
  }
  document.addEventListener('fullscreenchange',tick);
  document.addEventListener('visibilitychange',tick);
  function sync(){
    mix.sync();
    const live=!!state.session;
    if(!live){clearInterval(timer);timer=null;}
    if(scope!==state.session?.mixRoom){
      soundMenu.prune(new Set());for(const item of tiles.values()){item.tile.remove();hideSpeaker(item);}tiles.clear();scope=state.session?.mixRoom;
    }
    const ids=new Set(live?state.peers.map(p=>p.id):[]);
    soundMenu.prune(ids);
    for(const [id,item] of tiles)if(!ids.has(id)){item.tile.remove();hideSpeaker(item);tiles.delete(id);}
    if(!live)return;
    const data=direct()?.active()?direct().raw():null;
    for(const p of state.peers){
      let item=tiles.get(p.id);
      if(!item){
        const tile=document.createElement('div');tile.className='voice-tile';tile.dataset.peerId=p.id;tile.dataset.slot=p.slot;tile.setAttribute('role','listitem');
        const portrait=document.createElement('span');portrait.className='room-avatar';
        const caption=document.createElement('span');caption.className='voice-name';
        const status=document.createElement('span');status.className='voice-state';
        const labels=document.createElement('div');labels.className='tile-caption';labels.append(caption,status);
        const screen=document.createElement('button');screen.type='button';screen.className='tile-watch';screen.hidden=true;
        screen.onclick=()=>watch(p.id);
        tile.append(portrait,labels,screen);soundMenu.mount(tile,p,p.id===state.session.selfId);grid.append(tile);
        item={tile,portrait,caption,status,screen};tiles.set(p.id,item);
      }
      const own=p.id===state.session.selfId;
      const person=(state.session.direct||state.session.groupVoice) && data?.mixRoom===state.session.mixRoom && data?.roomContacts?.[p.id];
      const photo=own?data?.me?.avatar:data?.friends.find(f=>person===f.id&&f.state==='friend')?.avatar;
      item.photo=photo;
      paintAvatar(item.portrait,p.name,photo);
      item.tile.classList.toggle('own-card',own);
      item.caption.textContent=p.name+(own?tr(' · вы'):'');
      refreshSound(p);
      item.tile.classList.toggle('mic-off',p.micMuted);
    }
    tick();
    if(!timer && tiles.size)timer=setInterval(tick,80);
  }
  function refreshSound(p){
    const item=tiles.get(p.id);if(!item)return;
    const own=p.id===state.session?.selfId;
    const connection=own?'connected':state.connectionStates.get(state.session.role==='host'?p.id:state.session.hostId);
    const status=[];
    if(p.sharing)status.push(tr(state.media?.videoSource(p.slot)==='camera'?'Камера':'Трансляция'));
    if(!own && mixer.getSetting(p.id,'voice').muted)status.push(tr('Заглушён у вас'));
    else if(p.micMuted)status.push(tr('Микрофон выключен'));
    if(connection && connection!=='connected')status.push(tr(connection==='failed'||connection==='unreachable'?'Нет медиа-связи':'Соединение…'));
    if(!status.length && p.slot===0&&!state.session.groupVoice)status.push(tr('Создатель'));
    item.status.textContent=status.join(' · ');
    soundMenu.draw(item.tile,p,own);
  }
  function screens(shares,selected){
    if(previewId!==selected || state.controlLost){video=null;previewId=selected;}
    for(const [id,item] of tiles){
      const share=shares.find(p=>p.id===id),active=!!share && id===selected;
      item.tile.classList.toggle('selected-screen',active);
      item.screen.hidden=!share || shares.length<2;
      if(share){
        const label=tr('Смотреть трансляцию ')+share.name;
        item.screen.setAttribute('aria-label',label);item.screen.title=label;
        item.screen.setAttribute('aria-pressed',String(active));
      }
      if((!share || share.shareTitle!==item.source || state.controlLost) && item.thumbnail){
        item.thumbnail.remove();item.thumbnail=null;
      }
      item.source=share?.shareTitle;
    }
  }
  function preview(id,player){
    const item=tiles.get(id);
    if(!item || id!==state.selectedPeerId || state.controlLost || !player.videoWidth || player.readyState<2)return;
    video=player;previewId=id;
    if(!visible())return;
    nextPreview=performance.now()+1500;
    if(!item.thumbnail){
      const thumbnail=document.createElement('canvas');thumbnail.className='tile-screen-image';thumbnail.setAttribute('aria-hidden','true');
      thumbnail.width=112;thumbnail.height=64;item.tile.prepend(thumbnail);item.thumbnail=thumbnail;
    }
    const canvas=item.thumbnail,context=canvas.getContext('2d');
    const scale=Math.min(canvas.width/player.videoWidth,canvas.height/player.videoHeight);
    const w=player.videoWidth*scale,h=player.videoHeight*scale;
    context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(player,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
  }
  return {sync,refreshSound,screens,preview};
}
