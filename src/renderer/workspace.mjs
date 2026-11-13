import {discoveryMessage} from './direct-panel.mjs';
import {gamePanel} from './game-panel.mjs';
import {privateChats} from './private-chat.mjs';
import {groupPanel} from './groups.mjs';
import {tr} from './locale.mjs';
import {workspaceShell} from './workspace-shell.mjs';
import {paintAvatar} from './profile-appearance.mjs';
import {selectContacts} from './contact-list.mjs';
import {friendRooms,newestPeerVersion} from './room-directory.mjs';

const discoveryActions={strictProxy:'Настройки соединения',directStatus:'Изменить статус',directNic:'Выбрать локальную сеть',directDht:'Настройки поиска'};

export function createWorkspace({$, state, direct, internet, composer, closeStudio, openSettings, copyCard, removeRequest, action, actionError, confirmAction,openGroupVoice}) {
  const shell = document.querySelector('.app-shell');
  const game=gamePanel({$,api:window.craftlink,direct,state,composer,actionError,confirmAction});
  const chats=privateChats({$,direct,api:window.craftlink,state,composer,confirmAction,onError:actionError,openGroup,openList:()=>layout.openDrawer(),selected:()=>layout.closeDrawer(),messageCue:()=>internet.play('message')});
  const groups=groupPanel({$,direct,api:window.craftlink,state,confirmAction,onError:actionError,openChat,selectionChanged:schedule,
    showGroup:()=>{navigate('groups',false);layout.closeDrawer();},
    openVoice:(group,channel)=>{
      layout.closeDrawer();
      return state.session?.groupVoice?.group===group && state.session.groupVoice.channel===channel ? navigate('room') : openGroupVoice(group,channel);
    }});
  const sections = {groups:'Группы',chats:'Чаты',game:'Игровая LAN',friends: 'Друзья', requests: 'Заявки', room: 'Комната',rooms:'Комнаты друзей'};
  $('openRoomWorkspace').onclick=()=>navigate('room');
  const navigation = {groups:$('navGroups'),chats:$('navChats'),game:$('navGame'),friends: $('navFriends'), requests: $('navRequests'), room: $('navRoom'),rooms:$('navRooms')};
  let view = 'friends', filter = 'all', session, cinema = false, lastBook, lastRail;
  let queued = false, identity, clockTimer;
  let refreshingProfile=null;
  const layout=workspaceShell({$,shell,openGroup,openPerson,refresh});
  function startClock(active) {
    clearInterval(clockTimer);
    const clock = $('callElapsed');
    clock.hidden = !active;
    if (!active) return;
    const started = performance.now();
    const tick = () => {
      const seconds = Math.floor((performance.now()-started)/1000);
      const pad = n => String(n).padStart(2,'0');
      const hours = Math.floor(seconds/3600);
      clock.textContent = (hours ? hours+':' : '') + pad(Math.floor(seconds/60)%60)+':'+pad(seconds%60);
      clock.dateTime = 'PT'+seconds+'S';
    };
    tick(); clockTimer = setInterval(tick,1000);
  }

  function navigate(next, focus = true) {
    layout.closeDrawer();
    if (next !== 'room') {
      document.querySelectorAll('.room-popover:popover-open, #participantSoundMenu:popover-open').forEach(el=>el.hidePopover());
      closeStudio();
      cinema = false;
    }
    view = next;
    refresh();
    if (focus) {
      let heading=$('directoryTitle');
      if(view==='room')heading=$('roomLabel');
      if(view==='chats')heading=$('dmConversation').hidden?$('dmListTitle'):$('dmTitle');
      if(view==='groups')heading=$('groupContent').hidden?$('groupWelcomeTitle'):$('groupChannelName');
      if(view==='game'&&!$('gameSession').hidden)heading=$('gameName');
      if(heading)heading.focus({preventScroll:true});
      if(view==='chats'&&$('dmConversation').hidden)layout.openDrawer();
    }
  }
  function openChat(id) {
    if(!direct.active()||!direct.raw().friends.some(p=>p.id===id&&p.state==='friend'))return;
    navigate('chats',false); chats.select(id);
  }
  function openPerson(id){
    if(direct.active()){openChat(id);return;}
    setFilter('all');$('bookQuery').value='';navigate('friends',false);
    const row=[...$('workspaceContacts').children].find(el=>el.dataset.person===id);
    if(row){row.tabIndex=-1;row.focus({preventScroll:true});row.scrollIntoView({block:'nearest'});}
  }
  function openGroup(id){
    const previous=state.session?.groupVoice;
    if(previous && previous.group===id && groups.opensCall(id)){groups.select(id,previous.channel);navigate('room');}
    else{navigate('groups',false);if(id)groups.select(id);}
  }
  let callChat=null;
  function callContact(){
    return callChat && direct.active() && direct.raw().me.id===callChat.profile &&
      direct.raw().friends.find(f=>f.id===callChat.id && f.state==='friend');
  }
  $('roomConversation').onclick=()=>{
    const voice=state.session?.groupVoice;
    if(voice){navigate('groups');groups.select(voice.group,voice.channel);}
    else if(callContact())openChat(callChat.id);
  };

  function fill(container, rows, empty) {
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'collection-empty';
      p.textContent = tr(empty);
      rows = [p];
    }
    const active = document.activeElement;
    const row = active?.closest('[data-person]');
    const focusIndex = row ? [...row.querySelectorAll('button')].indexOf(active) : -1;
    container.replaceChildren(...rows);
    if (focusIndex >= 0 && row.parentNode === null) {
      const replacement = rows.find(el => el.dataset.person === row.dataset.person);
      (replacement?.querySelectorAll('button')[focusIndex] || container.closest('section')?.querySelector('button'))?.focus({preventScroll:true});
    }
  }
  function model() {
    const local = direct.active();
    const jabber = internet.account.status !== 'signed-out' && !!internet.account.id;
    const data = direct.raw();
    const contacts = local ? data.friends : jabber ? internet.directory() : [];
    const incoming = local ? data.requests : jabber ? [...internet.account.requests].map(id => ({id,name:id})) : [];
    const blocked = local ? data.blocked || [] : jabber ? internet.blockedContacts() : [];
    return {local, jabber, contacts, incoming, blocked};
  }
  function drawBook({local,jabber,contacts,incoming,blocked}) {
    const showRooms=view==='rooms';
    $('roomsDirectory').hidden=!showRooms;
    $('gamePage').hidden=view!=='game';
    $('peopleDirectory').hidden=showRooms||view==='game';
    $('bookFilters').hidden=view!=='friends';
    $('linkFriends').hidden=showRooms||view==='game';
    if(showRooms||view==='game'){$('directoryCount').textContent='';return;}
    const query = $('bookQuery').value, sort = $('bookSort').value;
    const connected = Boolean(state.session);
    const friends = contacts.filter(c => c.state === 'friend');
    const data=direct.raw(), strict=$('strictProxy').checked;
    const showPresence=view==='friends'&&friends.length>0&&(local?friends.some(c=>!c.online):!friends.some(c=>c.online));
    $('bookPresence').hidden=!showPresence;
    if(showPresence){
      const text=local?discoveryMessage(data,strict):internet.account.status==='online'?tr('Вы подключены к Jabber. Контакты пока не появились в сети.'):tr('Подключаемся к Jabber…');
      const status=$('bookPresenceText'),button=$('bookPresenceAction');
      const busy=local&&refreshingProfile===data.me.id;
      const feedback=busy?tr('Запрашиваем повторный поиск…'):text;
      if(status.textContent!==feedback)status.textContent=feedback;
      const invisible=data.privacy?.status==='invisible';
      const missingLan=!data.dht&&data.lan&&!data.lanReady&&!data.nics?.some(n=>n.name===data.lan);
      const target=strict?'strictProxy':invisible?'directStatus':missingLan?'directNic':!data.dht&&!data.lan?'directDht':null;
      button.hidden=!local;
      button.disabled=busy;
      button.textContent=tr(discoveryActions[target]||'Обновить связь');
      button.onclick=async()=>{
        if(!local||busy)return;
        try{
          if(target){
            if(target==='directNic'){direct.open('near');return;}
            const opening=openSettings(strict?'connection':'profile');
            if(strict)$('advancedRouting').open=true;
            $(target).focus();
            await opening;
            return;
          }
          refreshingProfile=data.me.id;drawBook(model());
          await window.craftlink.direct({op:'refresh'});
          await direct.sync();
        }catch(e){actionError(e);}
        finally{if(refreshingProfile===data.me.id){refreshingProfile=null;schedule();}}
      };
    }
    const outgoing = contacts.filter(c => c.state !== 'friend');
    $('directoryCount').textContent = view === 'requests' ? '' : friends.filter(c=>c.online).length + tr(' в сети');
    $('myCardBox').hidden = !local && !jabber;
    $('myCardHint').hidden=!jabber;
    $('myCardHint').textContent=jabber?internet.account.id:'';
    $('bookCopy').querySelector('span').textContent = jabber ? tr('Скопировать адрес') : tr('Скопировать карточку');
    $('bookCopy').title=jabber?internet.account.id:tr('Отправьте карточку другу, чтобы он мог добавить вас в LINK.');
    $('linkFriends').textContent = local || jabber ? tr('Добавить друга') : tr('Открыть профиль LINK');
    $('linkHost').querySelector('span').textContent = connected ? tr('Вернуться в звонок') : jabber ? tr('Создать комнату') : tr('Создать комнату LINK');
    $('lobbyFallback').hidden = connected;
    $('bookNearby').hidden = jabber;
    $('internetBtn').textContent=tr(jabber?'Контакты Jabber':local?'Перейти на Jabber':'Войти в Jabber');
    $('internetBtn').title=$('internetBtn').textContent;
    $('workspaceBook').hidden = view !== 'friends';
    $('workspaceRequests').hidden = view !== 'requests';
    const key = JSON.stringify([view,filter,query,sort,local,jabber,contacts.map(c=>[c.id,c.name,c.avatarRev,c.alias,c.state,c.online,c.status,c.favorite,c.lastCall,c.onlineDevices,c.jabber && internet.account.activity(c.id)]),incoming,blocked,state.session?.role,!!state.session?.internet,state.peers.map(p=>p.id),state.starting,direct.raw().outgoing?.id,internet.account.status,!!internet.room.pending,!!internet.room.joining,!!internet.room.outgoing,!!internet.access.pending, $('strictProxy').checked]);
    if (key === lastBook) return;
    lastBook = key;
    const mark = (row,c) => {row.dataset.person=c.id;return row;};
    const card = c => mark(local ? direct.contactCard(c,false,true) : internet.contactCard(c.record,false),c);
    if (view === 'requests') {
      fill($('inRequests'),incoming.map(c=>mark(local ? direct.requestCard(c) : internet.requestCard(c.id),c)),'Входящих заявок пока нет.');
      fill($('outRequests'),outgoing.map(c=>{
        const row=document.createElement('div'),name=document.createElement('strong'),info=document.createElement('small'),remove=document.createElement('button');
        row.className='sent-request';name.textContent=c.name;info.textContent=tr('Ожидаем подтверждение');
        remove.className='button button-secondary';remove.type='button';remove.textContent=tr('Убрать из списка');
        remove.disabled=!local && internet.account.status!=='online';
        remove.onclick=()=>removeRequest(c,local);
        row.append(name,info,remove);return mark(row,c);
      }),'Отправленных заявок пока нет.');
    } else {
      const list = selectContacts(filter === 'blocked' ? blocked : friends,{query,sort,filter:filter === 'blocked'?'all':filter});
      fill($('workspaceContacts'),list.map(c=>filter==='blocked' ? mark(local ? direct.blockedCard(c) : internet.blockedCard(c.id),c) : card(c)),
        query ? 'Совпадений нет. Измените поиск или фильтр.' : filter==='all' ? 'Здесь появятся ваши друзья.' : filter==='blocked' ? 'Заблокированных контактов нет.' : filter==='online' ? 'Сейчас никого нет в сети.' : 'Здесь появятся избранные друзья.');
    }
  }
  function refresh() {
    if (state.session !== session) {
      const prior=session;
      session = state.session;
      if(!prior || !session){
        startClock(!!session);cinema=false;
        if(session){
          const id=session.direct && (session.conversation || session.hostPerson);
          callChat=id && direct.active()?{id,profile:direct.raw().me.id}:null;
          view='room';
        }else{
          const resume=prior && view==='room' && callContact()?callChat:null;
          const voice=prior?.groupVoice && view==='room'?prior.groupVoice:null;
          if(!prior || view==='room')view=voice?'groups':resume?'chats':'friends';
          callChat=null;
          if(voice)queueMicrotask(()=>{if(view==='groups'&&!state.session)groups.select(voice.group,voice.channel);});
          if(resume)queueMicrotask(()=>{if(view==='chats'&&!state.session && direct.raw().me?.id===resume.profile)chats.select(resume.id,false);});
        }
      }
    }
    $('roomConversation').hidden=!session || !!session.groupVoice || !callContact();
    $('roomConversation').textContent=tr(session?.groupVoice?'К группе':'Личный чат');
    const inRoom = view === 'room';
    shell.classList.toggle('cinema',cinema);
    shell.classList.toggle('in-call',!!session);
    $('cinemaBtn').hidden = !session;
    $('cinemaBtn').setAttribute('aria-pressed',String(cinema));
    $('cinemaBtn').textContent = cinema ? tr('Показать панели') : tr('Кинорежим');
    $('cinemaBtn').title=$('cinemaBtn').textContent;$('cinemaBtn').setAttribute('aria-label',$('cinemaBtn').title);
    $('roomPage').hidden = !inRoom;
    $('directoryPage').hidden = inRoom || view==='chats' || view==='groups';
    $('groupsPage').hidden = view!=='groups';
    groups.sync(view==='groups'||!!(inRoom && session?.groupVoice),inRoom?session?.groupVoice:null);
    $('messagesPage').hidden = view!=='chats';
    chats.sync(view==='chats');
    $('backToCall').hidden = inRoom || !session;
    $('crumb').textContent = $('directoryTitle').textContent = tr(sections[view]);
    for (const [key,button] of Object.entries(navigation)) {
      if (key === view) button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    }
    const data = model();
    const accountKey = data.local ? 'link/'+direct.raw().me.id : data.jabber ? 'jabber/'+internet.account.id : '';
    if (accountKey !== identity) {
      identity = accountKey; lastBook = undefined;$('friendContextSearch').value='';
      setFilter('all'); $('bookQuery').value = ''; $('bookSort').value = 'available';
    }
    layout.draw({view,session,cinema,identity,local:data.local,contacts:data.contacts,items:data.local?direct.raw().groups?.items||[]:[],
      group:inRoom?session?.groupVoice?.group:groups.selected});
    const rooms=friendRooms(data.contacts,data.local,internet.account,state.session,internet.room.hostFull);
    const busy=!!(state.starting || direct.raw().incoming || direct.raw().outgoing || internet.room.pending || internet.room.outgoing || internet.room.joining || internet.access.pending);
    const peerVersion=newestPeerVersion(data.contacts,state.environment?.version);
    $('peerVersionHint').hidden=!peerVersion;
    if(peerVersion && $('updatePanel').dataset.seen!==peerVersion){$('updatePanel').dataset.seen=peerVersion;$('updatePanel').open=true;}
    $('peerVersionHint').textContent=peerVersion?tr('У друга доступна версия ')+peerVersion:'';
    const games=data.local?direct.raw().game?.returns||[]:[];
    const railKey=JSON.stringify([identity,view,rooms,games,busy,!!session,data.contacts.map(c=>[c.id,c.avatarRev])]);
    if(railKey!==lastRail){
      lastRail=railKey;
      const row=(r,compact=false)=>{
        const item=document.createElement('div'),label=document.createElement('strong'),button=document.createElement('button');
        item.className='room-list-row';item.dataset.person=r.id+'/'+r.door;label.textContent=r.name;
        const capacity=r.count+' / '+r.limit;
        const join=async()=>{
          if(button.disabled)return;
          try{if(r.local){await direct.requestRoom(r);await direct.sync();}else internet.access.knock(r.id,r);}
          catch(error){actionError(error);}
        };
        if(compact){
          button.type='button';button.className='rail-room';button.title=r.name+' · '+capacity;
          const hint=document.createElement('small');
          if(r.canReturn && r.count<r.limit){
            hint.textContent=tr('Вернуться в комнату');button.dataset.returnRoom=r.door;button.disabled=busy;
            button.setAttribute('aria-label',hint.textContent+' · '+r.name);button.onclick=join;
          }else{
            hint.textContent=capacity;button.onclick=()=>{navigate('rooms');const target=[...$('friendRooms').children].find(el=>el.dataset.person===item.dataset.person);target?.querySelector('button:not(:disabled)')?.focus();};
          }
          button.append(label,hint);
          item.append(button);return item;
        }
        const detail=document.createElement('span');detail.className='room-count';detail.textContent=capacity;
        button.type='button';button.className='button button-secondary';button.disabled=busy || r.count>=r.limit;
        button.textContent=tr(r.count>=r.limit?'Мест нет':r.canReturn?'Вернуться в комнату':'Попроситься в комнату');
        button.onclick=join;
        const glyph=document.createElement('span');glyph.className='room-glyph';glyph.setAttribute('aria-hidden','true');glyph.append($('navRoom').querySelector('svg').cloneNode(true));
        item.append(glyph,label,detail,button);return item;
      };
      $('quickRoomSection').hidden=!rooms.length;
      $('quickRooms').replaceChildren(...rooms.slice(0,3).map(r=>row(r,true)));
      const activity=(person,title,detail,section)=>{
        const button=document.createElement('button'),avatar=document.createElement('span'),copy=document.createElement('span');
        const heading=document.createElement('strong'),hint=document.createElement('small');
        avatar.className='dm-avatar';avatar.dataset.online='true';paintAvatar(avatar,person.name,person.avatar);
        copy.className='context-contact-label';heading.textContent=title;hint.textContent=detail;copy.append(heading,hint);
        button.type='button';button.className='context-contact';button.append(avatar,copy);
        button.onclick=()=>navigate(section);return button;
      };
      const active=[
        ...rooms.map(r=>activity(data.contacts.find(c=>c.id===r.id)||r,r.name,tr('Голосовая комната')+' · '+r.count+' / '+r.limit,'rooms')),
        ...games.map(g=>activity(data.contacts.find(c=>c.id===g.person)||g,g.title,g.name+' · '+tr('Игровая LAN')+' · '+g.count,'game'))
      ];
      fill($('homeActivities'),active,'Сейчас у друзей нет открытых комнат и игровых LAN.');
      $('roomsEmpty').hidden=!!rooms.length;
      $('friendRooms').hidden=!rooms.length;
      if(rooms.length)fill($('friendRooms'),rooms.map(r=>row(r)),'');else $('friendRooms').replaceChildren();
      $('lobbyRooms').hidden=!!session || !rooms.length;
      fill($('lobbyRoomList'),rooms.slice(0,3).map(r=>row(r)),'');
    }
    $('copyInviteBtn').textContent=tr(view==='game'?'Пригласить в звонок':'Пригласить');
    game.draw(view==='game');
    if (!inRoom && view!=='chats' && view!=='groups') drawBook(data);
  }
  function schedule() {
    if (queued) return;
    queued=true;
    queueMicrotask(()=>{queued=false;refresh();});
  }
  function setFilter(value) {
    filter = value;
    for(const b of $('bookFilters').querySelectorAll('button')) b.setAttribute('aria-pressed',String(b.dataset.filter===value));
  }
  for(const [key,button] of Object.entries(navigation)) button.onclick = () => navigate(key);
  $('navGroups').onclick=()=>{openGroup(groups.selected);if(layout.compact())layout.openDrawer();};
  $('homeDirectory').onclick=()=>navigate('friends');
  $('backToCall').onclick = () => navigate('room');
  $('bookFilters').addEventListener('click',e=>{if(e.target.dataset.filter){setFilter(e.target.dataset.filter);refresh();}});
  $('bookQuery').oninput = $('bookSort').onchange = refresh;
  $('roomLabel').tabIndex = -1;
  $('cinemaBtn').onclick = () => {closeStudio();cinema=!cinema;refresh();};
  $('studioBtn').addEventListener('click',()=>{if(cinema){cinema=false;refresh();}},true);
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape' && cinema && !document.fullscreenElement && !document.querySelector('dialog[open]')) {
      cinema=false;refresh();$('cinemaBtn').focus();
    }
  });
  action('bookCopy',copyCard);
  $('roomCreate').onclick=()=>$('linkHost').click();
  $('roomCode').onclick=()=>$('joinBtn').click();
  return {navigate,schedule,openChat,openGameNotice(id){
    const g=direct.raw().game;
    if(!g?.requests?.some(item=>item.actionId===id)&&!g?.invitations?.some(item=>item.id===id))return;
    navigate('game',false);
    requestAnimationFrame(()=>{if(view==='game')game.openNotice(id);});
  },showRequests(person){
    navigate('requests');
    const row=person&&[...$('workspaceRequests').querySelectorAll('[data-person]')].find(el=>el.dataset.person===person);
    if(row){row.tabIndex=-1;row.focus({preventScroll:true});row.scrollIntoView({block:'nearest'});}
  },showFriends(choice='all'){
    setFilter(choice);$('bookQuery').value='';navigate('friends');
  },chatChanged:chats.changed,windowFocused:chats.focused,invite(){
    setFilter('online'); $('bookQuery').value=''; navigate('friends');
  }};
}
