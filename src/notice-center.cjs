'use strict';
const {tr}=require('./native-language.cjs');

const titles={
  call:'Входящий звонок', invite:'Приглашение в комнату', join:'Запрос на вход в звонок',
  game:'Приглашение в игровую LAN', 'game-request':'Запрос на вход в игровую LAN', 'friend-direct':'Новая заявка в друзья', 'friend-jabber':'Новая заявка в друзья',
  message:'Личное сообщение',tray:'CRAFTCODE LINK остаётся в трее',update:'Доступна новая версия LINK',
};

function createNoticeCenter({window,tray,createNotification,open}) {
  const active=new Map();
  let fallback=null, enabled=true, quiet=false;
  const channel=kind=>['call','invite','join'].includes(kind)?'call':kind;
  function remove(key) {
    const item=active.get(key);
    if(!item)return;
    active.delete(key);
    if(fallback===item){fallback=null;if(!tray.isDestroyed())tray.removeBalloon?.();}
    item.native?.close();
    if(!active.size && !window.isDestroyed())window.flashFrame(false);
  }
  function activate(item) {
    if(!item || active.get(item.key)!==item)return;
    remove(item.key);open(item.kind,item);
  }
  function balloon(item) {
    if(active.get(item.key)!==item||tray.isDestroyed())return;
    if(fallback && fallback!==item)active.delete(fallback.key);
    fallback=item;
    tray.displayBalloon({title:item.title,content:item.body,noSound:true,respectQuietTime:true});
  }
  tray.on('balloon-click',()=>activate(fallback));
  function show(kind='call', info={}) {
    if(!Object.hasOwn(titles,kind)||!enabled||quiet||tray.isDestroyed()||window.isDestroyed())return;
    if(window.isVisible() && window.isFocused())return;
    if(kind==='message' && ![info.id,info.profile].every(value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value)))return;
    const id=String(info?.id||kind).slice(0,180);
    const key=kind==='message'?'message/'+id:channel(kind);
    if(active.get(key)?.id===id || (kind==='tray'&&active.size))return;
    if(kind==='update'){
      if([...active.values()].some(item=>item.kind!=='tray'&&item.kind!=='update'))return;
      remove('tray');
    }
    remove(key);
    const name=typeof info?.name==='string'?info.name.replace(/[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,' ').replace(/\s+/gu,' ').trim().slice(0,60):'';
    const hint=kind==='update'?'Открыть обновления':kind==='tray'?'Звонок и показ экрана продолжаются, если они включены. Для выхода нажмите значок правой кнопкой.':
      kind==='message'?'Открыть переписку':kind.startsWith('friend-')?'Откройте заявку, чтобы принять или отклонить её.':'Откройте CRAFTCODE LINK, чтобы ответить.';
    const item={key,kind,id,profile:info?.profile,title:tr(titles[kind]),body:name?name+' · '+tr(hint):tr(hint)};
    active.set(key,item);
    if(kind!=='tray'&&kind!=='update'&&window.isVisible())window.flashFrame(true);
    try{
      const native=createNotification?.({title:item.title,body:item.body,silent:true});
      if(!native){balloon(item);return true;}
      item.native=native;
      native.once('click',()=>activate(item));
      native.once('close',()=>{if(active.get(key)===item && fallback!==item){active.delete(key);if(!active.size&&!window.isDestroyed())window.flashFrame(false);}});
      native.once('failed',()=>balloon(item));
      native.show();
    }catch{balloon(item);}
    return true;
  }
  function clear(){for(const key of [...active.keys()])remove(key);}
  return {show,remove,clear,
    clearChat(id){if(id){remove('message/'+id);return;}for(const [key,item] of active)if(item.kind==='message')remove(key);},
    restrictGame(ids){for(const key of ['game','game-request']){const item=active.get(key);if(item&&!ids.includes(item.id))remove(key);}},
    policy(on,dnd){enabled=on;quiet=dnd;if(!enabled||quiet)clear();},
  };
}
module.exports={createNoticeCenter};
