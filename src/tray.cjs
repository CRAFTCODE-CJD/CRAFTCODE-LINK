'use strict';
const {tr}=require('./native-language.cjs');

function reveal(window) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  window.flashFrame(false);
}

function attachTray({ window, tray, menu, quit, isQuitting, stopSharing, leaveRoom, openRequests, openGame, canOpenChat, openChat, createNotification }) {
  let explained = false;
  let endingSession = false;
  const show = () => reveal(window);
  const notices=require('./notice-center.cjs').createNoticeCenter({window,tray,createNotification,open(kind,item){
    if(kind==='message' && !canOpenChat?.(item.profile,item.id))return;
    show();
    if(kind==='message')openChat?.(item.profile,item.id);
    else if(kind==='game'||kind==='game-request')openGame?.(item.id);
    else if(kind.startsWith('friend-'))openRequests?.(kind);
  }});
  tray.setToolTip('CRAFTCODE LINK');
  let lastCallState;
  function setCall(connected, sharing) {
    const state = connected ? (sharing ? 'sharing' : 'call') : 'idle';
    if (state === lastCallState || tray.isDestroyed()) return;
    lastCallState = state;
    const items = [{ label:tr('Открыть CRAFTCODE LINK'), click:show }];
    if (connected && sharing) items.push({label:tr('Остановить показ'), click:stopSharing});
    if (connected) items.push({label:tr('Завершить звонок…'), click:()=>{ show(); leaveRoom(); }});
    items.push({type:'separator'},{label:tr('Выйти из программы'), click:quit});
    tray.setContextMenu(menu.buildFromTemplate(items));
  }
  setCall(false,false);
  tray.on('click', show);
  const endSession = () => {
    if (endingSession) return;
    endingSession = true;
    quit();
  };
  window.on('query-session-end', event => {
    if (event.reasons?.includes('close-app')) endSession();
  });
  window.on('session-end', endSession);
  window.on('close', event => {
    if (endingSession || isQuitting() || tray.isDestroyed()) return;
    event.preventDefault();
    window.hide();
    if (!explained) {
      explained = true;
      notices.show('tray');
    }
  });
  return {
    setCall,
    setNoticePolicy:notices.policy,
    syncGameNotices:notices.restrictGame,
    clearChatNotice:notices.clearChat,
    clearRequestNotice(source){if(source)notices.remove('friend-'+source);else {notices.remove('friend-direct');notices.remove('friend-jabber');}},
    endRing(){notices.remove('call');},
    ring:notices.show,
    destroy(){notices.clear();if(!tray.isDestroyed())tray.destroy();},
  };
}
module.exports={attachTray,reveal};
