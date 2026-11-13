import {tr} from './locale.mjs';
import {paintAvatar} from './profile-appearance.mjs';
import { parseRoomCode, roomCode } from './room-code.mjs';

export function roomHub({ access, $, node, account, room, state, connect, openManual, openFriends, showDialog, closeDialog, api, contactCard, name, hush, acceptIncoming }) {
  let mode = 'host', resumeLogin = false;
  const message = text => {
    $('hubError').textContent = text?.message || text || '';
    $('hubError').hidden = !$('hubError').textContent;
  };
  const handle = fn => e => {
    e.preventDefault();
    Promise.resolve().then(fn).catch(message);
  };
  const click = (id,fn) => $(id).addEventListener('click',handle(fn));
  function open(next, fresh = true) {
    if (currentPrompt()) return showCall();
    mode = next;
    if (fresh) { message(''); $('hubWaiting').textContent=''; }
    render();
    showDialog('hubDialog');
  }
  function render() {
    const online = account.status === 'online', hosting = mode === 'invite';
    const join = mode === 'guest', pending = room.pending;
    renderCall();
    $('hubTitle').textContent = hosting ? tr('Пригласить в комнату') : join ? tr('По приглашению') : tr('Создать комнату');
    $('hubStatus').textContent = online ? name()+' · '+account.id : account.status==='signed-out' ? (join ? tr('Вставьте полученный код комнаты.') : tr('Выберите способ подключения.')) : tr('Подключаемся к аккаунту…');
    $('hubCreate').hidden = mode !== 'host';
    $('hubStart').hidden = !online;
    $('hubStart').disabled = state.starting || !!room.joining || !!pending;
    $('hubJoin').hidden = !join;
    $('hubInvite').hidden = !hosting;
    $('hubDirect').hidden = mode !== 'host' || !!pending || !!room.joining;
    $('hubManual').textContent = tr('Создать комнату по IP');
    $('directHint').textContent=tr('Для домашней сети, Radmin VPN или публичного IPv4. Аккаунт не требуется.');
    $('hubAccount').hidden = online || hosting || account.status!=='signed-out';
    $('hubEnter').disabled = !!room.joining || !!pending;
    $('hubEnter').textContent = room.joining || pending?.accepted ? tr('Подключаемся…') : tr('Войти по коду');
    $('cancelJoin').hidden = !room.joining;
    if (hosting) {
      $('inviteIntro').textContent=room.room?.role==='host'?tr('Пригласите друга из списка или скопируйте код комнаты.'):tr('Пригласите друга в текущий звонок. Если он ещё не знаком с создателем, приложение предложит добавить его в друзья.');
      const list=$('inviteFriends'); list.replaceChildren();
      const contacts=[...account.contacts.values()].filter(c=>account.mutual(c.id)).sort((a,b)=>Number(!!account.full(b.id))-Number(!!account.full(a.id)) || a.id.localeCompare(b.id));
      for(const c of contacts) list.append(contactCard(c,'invite'));
      if(!contacts.length) list.append(node('p','field-help',tr('Пока нет подтверждённых друзей. Отправьте другу заявку, затем пригласите его в комнату.')));
      $('hubCopy').hidden=room.room?.role!=='host';$('hubCopy').disabled=!online;
    }
  }
  function currentPrompt(){return room.pending || room.outgoing || access.pending || (room.joining?.origin==='contact'?room.joining:null);}
  function showCall(){
    if(!currentPrompt())return;
    closeDialog('internetDialog');closeDialog('hubDialog');
    $('callError').hidden=true;
    renderCall();showDialog('callDialog');
  }
  function renderCall(){
    const p=currentPrompt();
    if(!p){if($('callDialog').open){closeDialog('callDialog');hush();}return;}
    const id=p.full.split('/')[0], label=account.contactName(id) || id.split('@')[0];
    $('callName').textContent=label;
    paintAvatar($('callAvatar'),label);
    $('callAddress').hidden=label===id;
    $('callAddress').textContent=id;
    const incoming=p===room.pending,outgoing=p===room.outgoing,joining=p===room.joining,door=p===access.pending;
    $('hubRing').hidden=!incoming;$('hubOutgoing').hidden=!outgoing && !joining;$('hubAccess').hidden=!door;
    $('callDialog').classList.toggle('is-ringing',(incoming||outgoing)&&p.purpose==='call'&&!p.accepted);
    $('hubAccept').hidden=!!p.accepted;$('hubAcceptLabel').textContent=p.purpose==='entry'?tr('Разрешить вход'):p.switchCall?tr('Перейти в другой звонок'):tr('Принять');
    $('hubActionIcon').setAttribute('href',p.purpose==='call'?'#icon-receiver':'#icon-profile');
    $('hubDeclineLabel').textContent=p.accepted?tr('Отменить'):tr('Отклонить');
    $('accessText').textContent='';
    if(joining){$('callState').textContent=tr('Подключаемся к комнате…');}
    else if(incoming || outgoing){
      $('callState').textContent=incoming ? (p.accepted?tr('Подключаемся…'):p.purpose==='entry'?tr('Просит войти в ваш звонок'):p.switchCall?tr('Вызов во время разговора'):p.purpose==='call'?tr('Входящий звонок'):tr('Приглашение в комнату'))
        : p.purpose==='call'?tr('Исходящий звонок'):tr('Ждём ответа на приглашение…');
    }else{
      const need=p.target && !account.mutual(p.target.owner);
      $('callState').textContent=({asking:tr('Запрос на вход отправлен'),knock:tr('Просит войти в звонок'),invited:tr('Приглашение отправлено'),intro:tr('Приглашает в звонок'),'waiting-contact':tr('Ожидаем создателя комнаты')})[p.type];
      if(need)$('accessText').textContent=p.type==='waiting-contact'?tr('Ждём подтверждения дружбы от ')+p.target.owner+'.':tr('Создатель комнаты — ')+p.target.owner+tr('. Для входа добавьте его в друзья.');
      $('accessAccept').hidden=!['knock','intro'].includes(p.type);
      $('accessAccept').textContent=p.type==='knock'?tr('Разрешить вход'):p.switchCall?tr('Перейти в другой звонок'):need?tr('Добавить создателя и войти'):tr('Войти в звонок');
      $('accessCancel').textContent=['knock','intro'].includes(p.type)?tr('Отклонить'):tr('Отменить');
    }
  }
  click('minimizeCall',()=>{hush();closeDialog('callDialog');});
  $('callDialog').addEventListener('cancel',()=>hush('ring'));
  $('accessAccept').addEventListener('click',()=>acceptIncoming(access).catch(e=>{$('callError').hidden=false;$('callError').textContent=e.message;}));
  click('accessCancel',()=>access.cancel());
  click('closeHub',()=>closeDialog('hubDialog'));
  click('hubManual',()=>{closeDialog('hubDialog');openManual('host');});
  click('hubFriends',openFriends);
  click('hubAccount',()=>{resumeLogin=true;openFriends();});
  click('hubStart',async()=>{
    if(state.starting || state.session)return;
    room.host(true);
    try { await connect({online:true}); open('invite'); } catch(e){room.leave();open('host');throw e;}
  });
  click('hubCopy',async()=>{
    if (room.room?.role!=='host')return;
    await api.copyText(roomCode(account,room.room.id));
    $('hubWaiting').textContent=tr('Код скопирован. Отправьте его подтверждённому другу. Он действует, пока открыта эта комната.');
  });
  click('hubCancelCall',()=>room.joining?room.endJoin(tr('Вход отменён.')):room.cancel());
  click('hubAccept',()=>{hush();return acceptIncoming(room);});
  click('hubDecline',()=>{hush();room.decline();});
  click('cancelJoin',()=>room.endJoin(tr('Подключение отменено.')));
  $('hubCodeForm').addEventListener('submit',handle(()=>{
    message('');
    const value=$('hubCode').value.trim();
    if (/^CL1:/i.test(value)) {
      closeDialog('hubDialog'); $('hubCode').value='';return openManual('guest',value);
    }
    if (/^CCF1:/i.test(value)) {
      message(tr('Это карточка друга. Откройте «Друзья» → «Добавить друга» и вставьте её туда.'));
      return;
    }
    const target=parseRoomCode(value);
    if(account.status!=='online') {message(tr('Войдите в свой аккаунт, затем нажмите «Войти по коду».'));return;}
    room.requestJoin(target);
  }));
  function signedIn() {
    if (resumeLogin && $('hubDialog').open && $('internetDialog').open) closeDialog('internetDialog');
    resumeLogin=false;
  }
  $('internetDialog').addEventListener('close',()=>{resumeLogin=false;});
  return {open,render,message,signedIn,showCall, joined(){closeDialog('hubDialog');$('hubCode').value='';},
    incoming:showCall, reset(){closeDialog('callDialog');closeDialog('hubDialog');$('hubCode').value='';resumeLogin=false;}};
}
