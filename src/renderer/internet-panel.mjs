import {tr} from './locale.mjs';
import {selectContacts} from './contact-list.mjs';
import { readRelay } from './relay-settings.mjs';
import { CallAccess } from './call-access.mjs';
import { roomHub } from './room-hub.mjs';
import { profileName, cleanDisplayName } from './profile-name.mjs';
import { jid } from './account-address.mjs';
import { accountEntry } from './account-entry.mjs';
import { InternetAccount } from './internet-account.mjs';
import { InternetRoom } from './internet-room.mjs';
import {notificationSounds} from './notification-sounds.mjs';

const paths = {
  call:'M6 3h3l2 5-2 2a15 15 0 0 0 5 5l2-2 5 2v3a3 3 0 0 1-3 3A18 18 0 0 1 3 6a3 3 0 0 1 3-3z',
  copy:'M8 8h12v12H8zM16 8V4H4v12h4',
  remove:'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7',
  accept:'m4 12 5 5L20 6', decline:'m6 6 12 12M18 6 6 18'
};
function symbol(key) {
  const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg'), p=document.createElementNS(ns,'path');
  svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('class','icon'); svg.setAttribute('aria-hidden','true'); p.setAttribute('d',paths[key]);svg.append(p);return svg;
}
export function internetPanel({routeCue,localActive,showRequests,switchFromLink,identityChanged,notifyRequests,contactMenu,api,$,node,showDialog,closeDialog,confirmAction,action,state,settings,saveSettings,connect,disconnect,openManual,event,errorToast,toast,connectionChanged}) {
  let account, room, entry, hub, access, customRelay;
  const name=()=>profileName(account.status!=='signed-out' ? account.id : '', settings.profileNames, settings.name);
  const busy=()=>Boolean(state.session || state.starting || entry?.changing());
  const err=e=>{ const msg=(e?.message || String(e)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); $('onlineError').hidden=false; $('onlineError').textContent=msg; };
  const {play,hush,refresh:refreshSounds}=notificationSounds({state,settings,routeCue});
  let ringingToken;
  function ringFor(prompt,kind){
    if(settings.dnd || !prompt || ringingToken===prompt.token)return;
    ringingToken=prompt.token;play('ring',false,kind==='call');api.internet({op:'ring',kind,id:prompt.token,name:prompt.name}).catch(()=>{});
  }
  function clearRing(){
    if(!ringingToken)return;
    const incoming=room.pending || access?.pending;
    if(incoming?.token===ringingToken && !incoming.accepted && !['waiting-contact','invited','asking'].includes(incoming.type))return;
    ringingToken=null;hush('ring');api.internet({op:'end-ring'}).catch(()=>{});
  }
  const button=(label,icon,cb,disabled=false,primary=false)=>{
    const b=node('button','button '+(primary?'button-primary':'button-secondary'));b.type='button'; b.disabled=disabled;
    if(icon)b.append(symbol(icon));b.append(document.createTextNode(label));b.addEventListener('click',()=>Promise.resolve().then(cb).catch(err));return b;
  };
  const accountChanged=()=>{
    if(room?.returnees && account?.status==='online')for(const full of room.returnees)if(!account.mutual(full.split('/')[0]))room.returnees.delete(full);
    if(!account || !room)return;
    entry?.changed();
    if(account.status==='online')hub?.signedIn();
    if(access && account.status==='signed-out'){
      access.clear();customRelay=undefined;$('relayForm').reset();$('relayFeedback').textContent='';$('clearRelay').hidden=true;
    }
    if(access){account.syncActivity(access.update());connectionChanged?.();}
    render();
  };
  const blockedList=()=>settings.jabberBlocked?.[account?.id]||[];
  async function blockJabber(id){
    if(!await confirmAction(tr('Заблокировать ')+id+'?',tr('Заявки и звонки этого аккаунта будут скрыты на этом ПК.'),tr('Заблокировать'),true))return;
    const list=blockedList();if(list.length>=256)throw Error(tr('Достигнут предел списка блокировки.'));
    if(room.pending?.full.split('/')[0]===id)room.decline();
    if(room.outgoing?.full.split('/')[0]===id)room.cancel();
    if(room.joining?.owner===id)room.endJoin();
    if(access.pending?.full.split('/')[0]===id)access.cancel();
    room.forgetReturn(id);const cleanup=account.remove(id).catch(()=>{}); // Local enforcement also works if roster removal fails.
    settings.jabberBlocked[account.id]=[...new Set([...list,id])];saveSettings();
    account.requests.delete(id);account.contacts.delete(id);account.clearResources(id);render();connectionChanged?.();
    await cleanup;
  }
  async function acceptIncoming(owner){
    const p=owner.pending;if(!p)return;
    if(p.switchCall && state.session){
      if(!await confirmAction(tr('Перейти в другой звонок?'),state.session.role==='host'?tr('Ваша текущая комната закроется для участников.'):tr('Вы покинете текущий звонок.'),tr('Перейти')))return;
      if(owner.pending!==p)return;
      owner.keepPending=p;try{await disconnect(false);}finally{owner.keepPending=null;}
      if(owner.pending!==p)return;
    }
    return owner.accept();
  }
  account=new InternetAccount({blocked:id=>blockedList().includes(id),changed:accountChanged,ownName:()=>profileName(account.id,settings.profileNames,''),packet:(full,data)=>{
    if(data?.version!==1 || access.receive(full,data))return;
    room.receive(full,data);
  },resumed:retry=>{if(retry)room.resume();}});
  room=new InternetRoom({account,event,quiet:()=>settings.dnd,inCall:()=>!!state.session,sendControl:(id,packet)=>state.media?.sendControl(id,packet) || false,changed:accountChanged,busy,promptBusy:()=>!!access?.pending,myName:name,requestEnded:(reason,origin)=>{if(origin==='contact'){if(reason)toast(reason);}else hub?.message(reason);},accepted:async()=>{
    hush();try{ await connect({online:true}); if(state.session?.internet) {room.ready();hub.joined();closeDialog('internetDialog');play('joined');} }
    catch(e){ room.leave();hub.open('guest');hub.message(e); }
  },error:msg=>toast(msg),ring:()=>{hub.incoming();ringFor(room.pending,room.pending.purpose==='entry'?'join':room.pending.purpose);}});
  function card(c,home) {
    const ready=account.status==='online' && account.mutual(c.id) && !!account.full(c.id);
    const activity=account.activity(c.id),inRoom=Boolean(state.session?.internet);
    const inviting=home==='invite' || inRoom;
    const joining=ready && !state.session && !!activity;
    const already=room.hostFull?.split('/')[0]===c.id || [...room.members.keys()].some(f=>f.split('/')[0]===c.id);
    const full=activity?.count===3;
    const locked=!ready || !!room.joining || !!room.outgoing || !!room.pending || !!access?.pending || !!state.starting ||
      (state.session && (!inRoom || room.room?.peers.length>=3 || already)) || joining && full;
    const name=account.contactName(c.id), row=node('div','contact-card'),copy=node('span','contact-copy');
    const status = account.status !== 'online' ? tr('Статус неизвестен')
      : !account.mutual(c.id) ? tr('Ожидаем подтверждение') : ready && activity ? tr('В звонке · ')+activity.count+tr(' из 3') : ready ? tr('Онлайн') : tr('Не в сети');
    const label=node('small',ready?'available':'',status+(home===true?'':' · '+c.id));label.title=c.id;
    copy.append(node('strong','',name),label);
    row.append(node('span','contact-avatar',name.slice(0,2).toUpperCase()),copy,
      button(already?tr('В вашем звонке'):inviting?tr('Пригласить'):joining?(full?tr('Мест нет'):tr('Присоединиться')):tr('Позвонить'),'call',()=>{
        if(inviting){if(room.room.role==='guest')return access.inviteGuest(c.id);room.invite(c.id);hub.showCall();return;}
        if(joining)return access.knock(c.id,activity);
        return call(c.id);
      },locked,ready && !locked));
    if(!home) {
      const copyAddress=button('', 'copy', async()=>{await api.copyText(c.id);toast(tr('Адрес друга скопирован.'));});
      copyAddress.title=tr('Скопировать адрес друга');copyAddress.setAttribute('aria-label',tr('Скопировать адрес ')+c.id);row.append(copyAddress);
      const favKey=account.id+'|'+c.id;
      const fav=node('button','button button-secondary',settings.jabberFavorites[favKey]?'★':'☆');
      fav.title=tr('Избранное');fav.setAttribute('aria-label',tr('Избранное'));fav.setAttribute('aria-pressed',String(!!settings.jabberFavorites[favKey]));
      fav.onclick=()=>{settings.jabberFavorites[favKey]=!settings.jabberFavorites[favKey];saveSettings();render();fav.dispatchEvent(new CustomEvent('favorite-changed',{bubbles:true}));};row.append(fav);
      const rem=button(tr('Удалить из друзей'),'remove',async()=>{if(await confirmAction(tr('Удалить контакт?'),c.id,tr('Удалить'))){room.forgetReturn(c.id);await account.remove(c.id);}},already || account.status!=='online');
      rem.title=tr('Удалить контакт');rem.setAttribute('aria-label',tr('Удалить ')+c.id);
      const more=button('•••',null,()=>contactMenu(name,[rem,button(tr('Заблокировать'),null,()=>blockJabber(c.id),already)]));more.setAttribute('aria-label',tr('Действия с контактом ')+name);row.append(more);}
    return row;
  }
  function requestCard(id) {
    const box=node('div','online-notice'), actions=node('div','friend-actions');
    box.append(node('strong','',tr('Запрос в друзья · ')+id),actions);
    actions.append(button(tr('Добавить'),'accept',()=>account.answer(id,true),false,true),button(tr('Отклонить'),'decline',()=>account.answer(id,false)),button(tr('Заблокировать'),null,()=>blockJabber(id)));
    return box;
  }
  function blockedCard(id){const line=node('div','blocked-row');line.append(node('span','',id),button(tr('Разблокировать'),null,()=>{
      settings.jabberBlocked[account.id]=blockedList().filter(value=>value!==id);saveSettings();render();
    }));return line;}
  function openFriends(adding=false) { if(localActive())return switchFromLink(true);if(room.pending || room.outgoing || access?.pending || room.joining?.origin==='contact')return hub.showCall();$('internetDialog').dataset.mode=adding===true?'add':'manage';entry.opened();showDialog('internetDialog');render();if(adding===true)$('contactJid').focus(); }
  access=new CallAccess(account,room,msg=>{
    if(msg){toast(msg);return;}
    hub.showCall();
    if(access.pending?.type==='intro' || access.pending?.type==='knock')ringFor(access.pending,access.pending.type==='knock'?'join':'invite');
  },()=>render());
  hub=roomHub({access,$,node,account,room,state,connect,openManual,openFriends,showDialog,closeDialog,api,contactCard:card,name,hush,acceptIncoming});
  function render() {
    if (!room) return;
    clearRing();entry?.render(); hub?.render();
    identityChanged();
    const ready=account.status==='online', logged=['online','reconnecting','connecting'].includes(account.status);
    if(ready && $('internetDialog').dataset.mode==='add')$('onlineTitle').textContent=tr('Добавить друга');
    $('onlineStatus').textContent=({online:tr('На связи'),connecting:tr('Входим…'),reconnecting:tr('Восстанавливаем связь…'),'signed-out':tr('Войдите, чтобы позвонить')})[account.status];
    $('onlineStatus').dataset.state=account.status; $('onlineLogin').hidden=logged; $('onlineActive').hidden=!ready && !account.contacts.size;
    $('logoutAccount').hidden=!logged;
    $('signedAddress').textContent=account.id; $('strictProxy').disabled=busy() || !!room.pending || !!room.joining || !!room.outgoing;
    if(account.error)err(account.error);
    const list=$('internetRoster'),requests=$('onlineRequests');
    list.replaceChildren();requests.replaceChildren();
    const contacts=[...account.contacts.values()].sort((a,b)=> Number(!!account.full(b.id))-Number(!!account.full(a.id)) || a.id.localeCompare(b.id));
    $('filterBox').hidden=!contacts.length;
    for(const c of selectContacts(directory(),{query:$('contactFilter').value,filter:$('jabberFilter').value,sort:$('jabberSort').value}))list.append(card(c.record,false));
    if(contacts.length && !list.childElementCount) list.append(node('p','field-help',tr('В ваших контактах совпадений нет. Нового друга можно добавить по полному логину.')));
    if(!contacts.length && ready) list.append(node('p','field-help',tr('Здесь появятся ваши друзья.')));
    for(const id of account.requests)requests.append(requestCard(id));
    notifyRequests('jabber',[...account.requests].map(id=>({id,name:id})));
    const blocked=blockedList();$('jabberDenied').hidden=!blocked.length;
    $('jabberBlockedList').replaceChildren(...blocked.map(blockedCard));
    $('copyInviteBtn').textContent=access?.pending?tr('Запрос на звонок'):room.outgoing?tr('Вызов…'):tr('Пригласить');
    $('joinBtn').textContent=access?.pending?tr('Запрос на звонок'):room.pending?tr('Приглашение (1)'):room.joining?.origin==='contact'?tr('Подключаемся…'):tr('По приглашению');
    
    
  }
  async function call(id){
    settings.jabberRecent[account.id+'|'+id]=Date.now();saveSettings();
    $('onlineError').hidden=true;
    let created=false;
    if(!state.session){room.host();created=true;}
    try {room.invite(id);hub.showCall();if(created)await connect({online:true});}
    catch(e){if(created){room.leave();await disconnect(false);}throw e;}
  }
  $('internetDialog').addEventListener('close',()=>{delete $('internetDialog').dataset.mode;});
  action('closeInternet',()=>closeDialog('internetDialog'));
  entry=accountEntry({ $,api,account,showDialog,closeDialog,err,busy:()=>Boolean(access?.pending || state.session || state.starting || room.room || room.pending || room.joining || room.outgoing),confirmAction,toast,settings,saveSettings });
  action('internetBtn',()=>{if(account.status==='signed-out' && !localActive()){entry.loginScreen();showDialog('internetDialog');render();}else openFriends();});
  $('contactFilter').addEventListener('input',render);
  for(const [id,key] of [['jabberFilter','directoryFilter'],['jabberSort','directorySort']]){
    $(id).value=settings[key];$(id).onchange=()=>{settings[key]=$(id).value;saveSettings();render();};
  }
  action('profileCopy',async()=>{await api.copyText(account.id);$('profileFeedback').textContent=tr('Логин скопирован. Отправьте его другу.');});
  action('profileSaveCard',async()=>{if(await api.internet({op:'save-card',id:account.id}))$('profileFeedback').textContent=tr('Карточка сохранена.');});
  $('profileForm').addEventListener('submit',e=>{
    e.preventDefault(); if(account.status!=='online')return;
    const value=cleanDisplayName($('profileName').value);
    if(!value){$('profileFeedback').textContent=tr('Введите имя для комнаты.');return;}
    settings.profileNames[account.id]=value; saveSettings(); account.announce(); render(); $('profileName').value=value;
    $('profileFeedback').textContent=state.session?tr('Имя сохранено. Оно появится в следующей комнате.'):tr('Имя сохранено.');
  });
  action('copyAccount',async()=>{await api.copyText(account.id);toast(tr('Адрес скопирован.'));});
  $('addContactForm').addEventListener('submit',e=>{e.preventDefault();$('onlineError').hidden=true;const target=jid($('contactJid').value.trim().replace(/^xmpp:/i,''));
    if(account.mutual(target)) {err(tr('Этот друг уже есть в ваших контактах.'));return;}
    if(account.contacts.get(target)?.asked) {err(tr('Заявка уже отправлена. Ждём ответа друга.'));return;}
    account.add(target).then(()=>{$('contactJid').value='';if($('internetDialog').dataset.mode==='add'){closeDialog('internetDialog');showRequests();}toast(tr('Запрос отправлен.'));}).catch(err);});
  for(const [id,setting] of [['cueEnabled','cueEnabled'],['cueMessages','cueMessages'],['strictProxy','proxyOnly']]){
    $(id).checked=settings[setting];$(id).addEventListener('change',()=>{settings[setting]=$(id).checked;saveSettings();refreshSounds();});}
  $('cueVolume').value=String(settings.cueVolume);$('cueVolume').addEventListener('input',()=>{settings.cueVolume=Number($('cueVolume').value);saveSettings();refreshSounds();});
  action('previewCue',()=>play('ring',true));
  action('previewMessageCue',()=>play('message',true));
  setInterval(()=>{try{room.monitor();}catch{}},6000);
  render();
  
  async function networkServices(){
    const offered=await account.ice();
    const services=settings.proxyOnly?offered.filter(s=>/^turns?:/.test(s.urls)):offered.slice();
    if(settings.publicStun && !settings.proxyOnly && !services.some(s=>s.urls.startsWith('stun:')))
      services.push({urls:'stun:stun.cloudflare.com:3478'});
    if(customRelay)services.push(customRelay);
    return services;
  }
  function directory(){return [...account.contacts.values()].map(c=>{
    const k=account.id+'|'+c.id;return {id:c.id,name:account.contactName(c.id),online:!!account.full(c.id)&&account.status==='online',state:account.mutual(c.id)?'friend':'invited',favorite:!!settings.jabberFavorites[k],lastCall:settings.jabberRecent[k]||0,jabber:true,record:c,favKey:k};
  });}
  function peerServices(usePeerIce){
    return [...(usePeerIce&&settings.publicStun&&!settings.proxyOnly?[{urls:'stun:stun.cloudflare.com:3478'}]:[]),...(usePeerIce&&customRelay?[customRelay]:[])];
  }
  return {start:()=>entry.start().catch(err),picker(login=false){if(login)entry.loginScreen();else entry.picker();showDialog('internetDialog');render();},peerServices,directory,requestCard,blockedCard,blockedContacts:()=>blockedList().map(id=>({id,name:id})),contactCard:card,room,hub,account,access,render,play,hush,name,openFriends,networkServices,setRelay(url,user,password){customRelay=url?readRelay(url,user,password):undefined;},async prepare(){
    const info=room.info(), services=await networkServices();
    if(settings.proxyOnly && !services.some(s=>s.urls.startsWith('turn:') || s.urls.startsWith('turns:')))
      toast(tr('Сервис не выдал TURN. В строгом режиме доступны контакты и резервный чат.'));
    if(!room.room || info.selfId!==room.info().selfId)throw new Error(tr('Вызов отменён.'));
    await api.internet({op:'open',proxyOnly:settings.proxyOnly});
    return {...info, iceServers:services, relayOnly:settings.proxyOnly};
  }};
}
