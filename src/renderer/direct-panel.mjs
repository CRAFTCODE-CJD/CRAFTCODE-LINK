import {tr,language} from './locale.mjs';
import {paintAvatar} from './profile-appearance.mjs';
import {contactStatusLabel} from './contact-list.mjs';
const discoveryClock=new Intl.DateTimeFormat(language,{hour:'numeric',minute:'2-digit',second:'2-digit'});
export function discoveryMessage(data,strict=false){
  if(strict)return tr('Прямой поиск отключён в режиме «Только через ретранслятор».');
  if(data.privacy?.status==='invisible')return tr('Поиск приостановлен в невидимом режиме.');
  const parts=[];
  if(data.dht){
    if(globalThis.navigator?.onLine===false)parts.push(tr('На этом ПК нет подключения к сети по данным системы.'));
    else if(data.discovery==='ready')parts.push(tr('Интернет-поиск доступен.'));
    else if(data.discovery==='retry')parts.push(tr('Не удалось подключиться к интернет-поиску. LINK попробует снова.'));
    else parts.push(tr('Подключаемся к интернет-поиску LINK…'));
  }
  if(data.lan)parts.push(tr(data.lanReady?'Поиск в выбранной локальной сети включён.':'Выбранная локальная сеть пока недоступна.'));
  if(!parts.length)return tr('Поиск друзей выключен на этом ПК.');
  const friends=data.friends?.filter(c=>c.state==='friend')||[];
  if(friends.length){
    const online=friends.filter(c=>c.online).length;
    parts.push(online?tr('Друзья на связи · {online} из {total}.').replace('{online}',online).replace('{total}',friends.length):tr('Связь с друзьями пока не установлена.'));
    if(!online&&data.dht&&data.discovery==='ready'&&globalThis.navigator?.onLine!==false)
      parts.push(tr('Попросите друга открыть LINK и проверить статус и поиск через интернет в профиле.'));
    else if(!online&&!data.dht&&data.lanReady)
      parts.push(tr('Для связи оба устройства должны выбрать одну локальную сеть.'));
  }
  if(data.lastContactRefresh>0){
    const time=discoveryClock.format(data.lastContactRefresh);
    parts.push(tr('Повторный поиск запрошен в {time}.').replace('{time}',time));
  }
  return parts.join(' ');
}
export function directPanel({showFriends,showRequests,showProfile,openChat,setMethod,identityChanged,inviteFriends,notifyRequests,contactMenu,disconnect,api,$,state,settings,saveSettings,connect,internet,node,showDialog,closeDialog,confirmAction,toast}){
  let data={me:null,nics:[],friends:[],near:[],requests:[]},route='home',transfer='',fetchNumber=0,joining=false,ringId='',pendingTransfer=false,changingNetwork=false;
  let approvedSwitch,confirmingCall=false;
  let switchReview;
  const cmd=(op,fields={})=>api.direct({op,...fields});
  function contactAvatar(element,call){
    const contact=data.friends.find(friend=>friend.id===call.peer&&friend.state==='friend');
    paintAvatar(element,call.name||tr('Контакт'),contact?.avatar);
  }
  async function confirmSwitch(call,session,room){
    const peer=node('div','call-switch-peer');
    const portrait=node('span','call-avatar');
    contactAvatar(portrait,call);
    const name=node('strong','',call.name||tr('Контакт'));name.dir='auto';
    peer.append(portrait,name);
    const controller=new AbortController();
    const review=switchReview={key:call.key,session,controller};
    try{
      return await confirmAction(tr(room?'Перейти в другую комнату?':'Перейти в другой звонок?'),
        tr(session.role==='host'&&!session.groupVoice?'Ваша текущая комната закроется для участников.':'Вы покинете текущий звонок.'),
        tr('Перейти'),false,peer,controller.signal);
    }finally{if(switchReview===review)switchReview=null;}
  }
  const hint=(text,error=false)=>{
    const message=$('settingsDialog').open && !$('directDialog').open && !$('pref-profile').hidden?$('directProfileFeedback'):$('directMessage');
    message.classList.toggle('invalid',error);
    message.textContent=text||'';
  };
  const err=e=>{const msg=String(e?.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/,'');hint(msg,true);if(!$('directDialog').open)toast(msg,true);};
  const run=fn=>Promise.resolve().then(fn).catch(err);
  const bind=(id,fn)=>$(id).addEventListener('click',()=>run(fn));
  const submit=(id,fn)=>$(id).addEventListener('submit',e=>{e.preventDefault();run(fn);});
  const act=(text,fn,title='')=>{const b=node('button','button button-secondary',text);b.type='button';if(title){b.title=title;b.setAttribute('aria-label',title);}b.onclick=()=>run(fn);return b;};
  let addTarget=null;
  function open(destination='home',person=null){
    if(internet().account.status!=='signed-out'){toast(tr('Сначала выйдите из Jabber в настройках профиля.'));return;}
    route=destination;transfer='';addTarget=destination==='add'&&person?.id?person:null;
    if(destination==='add'){$('directCode').value='';$('sendCardRequest').disabled=true;}
    $('directMessage').textContent='';
    $('directCode').removeAttribute('aria-invalid');
    $('directAtStart').checked=route!=='near' && !settings.proxyOnly;
    for(const id of ['internetDialog','settingsDialog','inviteDialog'])closeDialog(id);
    render();showDialog('directDialog');
    focusRoute();sync().catch(err);
  }
  function focusRoute(){
    const target=data.paused?'resumeLink':!data.me?'directName':({near:'directNic',identity:'directNick',add:'directCode'})[route];
    if(target)$(target).focus();
  }
  async function continueRoute(){
    settings.accountIntroSeen=true;saveSettings();await sync();
    if(route==='identity'){closeDialog('directDialog');await showProfile();return;}
    if(['near','add'].includes(route)){focusRoute();return;}
    closeDialog('directDialog');showFriends();
    if(route==='host')await cmd('host');
    else if(route==='copy'){await cmd('copy');toast(tr('Карточка скопирована. Отправьте её другу лично.'));}
    else toast(tr('Вы вошли в LINK · ')+data.me.name);
  }
  function optionsForNic(){
    const select=$('directNic'),items=[['',tr('Выключено')],...(data.nics||[]).map(n=>[n.name,n.name+' · '+n.address])];
    if(data.lan&&!items.some(([v])=>v===data.lan))items.push([data.lan,data.lan+tr(' · недоступна')]);
    const key=JSON.stringify(items);if(select.dataset.key!==key){select.replaceChildren(...items.map(([v,t])=>new Option(t,v)));select.dataset.key=key;}
    select.disabled=!!settings.proxyOnly || changingNetwork;
    if(!changingNetwork)select.value=data.lan||'';
    $('directScan').disabled=select.disabled;
  }
  async function block(c){
    if(!await confirmAction(tr('Заблокировать ')+c.name+'?',tr('Контакт будет заблокирован. История вашей переписки на этом ПК и ожидающие отправки будут удалены.'),tr('Заблокировать'),true))return;
    await cmd('block',{id:c.id});await sync();
  }
  function row(c,home=false,directory=false){
    if(c.jabber){
      const r=internet().contactCard(c.record,home);
      
      return r;
    }
    const r=node('div','contact-card'),meta=node('span','contact-copy');
    const status=c.state==='friend'?contactStatusLabel(c)+(c.onlineDevices>1?' · '+c.onlineDevices+tr(' устройства'):''):tr('Заявка отправлена');
    meta.append(node('strong','',c.name),node('small',c.online?'available':'',status));
    const call=act(state.session?tr('Пригласить'):tr('Позвонить'),async()=>{await cmd('call',{id:c.id});await sync();});
    call.disabled=!!settings.proxyOnly||!c.online||c.state!=='friend'||!!(state.session && (state.session.internet||state.session.groupVoice||state.session.role!=='host'))||!!data.outgoing;
    const avatar=node('span','contact-avatar');paintAvatar(avatar,c.name,c.avatar);
    if(directory){
      r.dataset.online=String(!!c.online);
      r.dataset.status=c.status||'';
      call.title=call.textContent;call.setAttribute('aria-label',call.title);call.classList.add('directory-icon');
      call.replaceChildren($(state.session?'contextAddFriend':'dmCall').querySelector('svg').cloneNode(true));
    }
    if(c.state==='friend'){
      const chat=node('button','open-person-chat');chat.type='button';chat.title=tr('Открыть чат')+' · '+c.name;
      chat.setAttribute('aria-label',chat.title);chat.append(avatar,meta);
      chat.onclick=()=>{closeDialog('directDialog');openChat(c.id);};
      r.append(chat,call);
    }else r.append(avatar,meta,call);
    if(!home){
      meta.title='ID: '+c.id;
      const fav=act(c.favorite?'★':'☆',async()=>{await cmd('favorite',{id:c.id});await sync();},c.favorite?tr('Убрать из избранного'):tr('В избранное'));
      fav.setAttribute('aria-pressed',String(c.favorite));const more=act('•••',()=>contactMenu(c.name,[
        act(tr('Удалить из друзей'),async()=>{if(await confirmAction(tr('Удалить контакт?'),c.name+' · '+tr('Будут удалены история переписки на этом ПК и ожидающие отправки.'),tr('Удалить'),true)){await cmd('forget',{id:c.id});await sync();}}),
        act(tr('Заблокировать'),()=>block(c))]),tr('Действия с контактом ')+c.name);
      if(directory){
        for(const [button,symbol] of [[fav,'icon-star'],[more,'icon-more']]){
          const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
          const use=document.createElementNS(svg.namespaceURI,'use');
          svg.setAttribute('class','icon');svg.setAttribute('aria-hidden','true');
          use.setAttribute('href','#'+symbol);svg.append(use);
          button.classList.add('directory-icon');button.replaceChildren(svg);
        }
      }
      r.append(fav,more);
    }
    return r;
  }
  function requestCard(c){
        const r=node('div','contact-card'),label=node('strong','contact-copy',c.name);label.title='ID: '+c.id;
        const yes=act(tr('Принять'),async()=>{await cmd('answer',{id:c.id,yes:true});await sync();});
        yes.className='button button-primary';
        r.append(label,yes,act(tr('Отклонить'),async()=>{await cmd('answer',{id:c.id,yes:false});await sync();}),
          act('•••',()=>contactMenu(c.name,[act(tr('Заблокировать'),()=>block(c))]),tr('Действия с заявкой')));return r;}
  function blockedCard(c){const line=node('div','blocked-row');line.append(node('span','',c.name),act(tr('Разблокировать'),async()=>{await cmd('unblock',{id:c.id});await sync();}));return line;}
  let checkParticipantCard;
  function participant(person,current,moderate){
    if(!current()||data.paused||!data.me||person.id===data.me.id)return;
    const owner=data.me.id,id=person.id;
    const relation=()=>{
      if(id&&data.blocked?.some(p=>p.id===id))return 'blocked';
      if(id&&data.requests.some(p=>p.id===id))return 'incoming';
      return id&&data.friends.find(p=>p.id===id)?.state||'unknown';
    };
    const introduced=()=>person.room&&person.peer&&data.roomPeople?.[person.peer]?.id===id&&
      data.roomPeople[person.peer].room===person.room;
    const initial=relation(),buttons=[];
    const add=(title,fn)=>buttons.push(act(tr(title),()=>{
      if(current()&&!data.paused&&data.me?.id===owner&&initial===relation())return fn();
    }));
    const descriptions={friend:'Вы друзья в LINK.',blocked:'Этот контакт заблокирован.',invited:'Заявка отправлена',incoming:'У вас есть заявка от этого участника.',
      unknown:'Обменяйтесь карточками LINK лично. После принятия заявки откроется личный чат.'};
    const details=[node('p','field-help',tr(initial==='unknown'&&introduced()?
      'Карточка LINK проверена для этой комнаты. Отправьте заявку, чтобы стать друзьями.':descriptions[initial]||descriptions.unknown))];
    if(id)details.push(node('small','participant-id','ID · '+id));
    if(initial==='friend')add('Личный чат',()=>openChat(id));
    else if(initial==='invited'||initial==='incoming')add('Открыть заявки',()=>showRequests(id));
    else if(initial==='blocked')add('Заблокированные контакты',()=>showFriends('blocked'));
    else{
      if(introduced())add('Добавить в друзья',async()=>{
        if(!introduced())return;
        const result=await cmd('room-add',{owner,room:person.room,peer:person.peer,person:id});
        await sync();
        toast(tr(result==='existing'?'Вы друзья в LINK.':result==='accepted'?'Заявка принята.':
          'Заявка отправлена. После принятия откроется личный чат.'));
      });
      add('Вставить карточку друга',()=>open('add',person));
      add('Скопировать мою карточку',async()=>{await cmd('copy');toast(tr('Карточка скопирована. Отправьте её другу лично.'));});
    }
    if(moderate)add('Действия с участником',moderate);
    contactMenu(person.name,buttons,details);
    const hadIntroduction=!!introduced();
    checkParticipantCard=()=>{
      if(!$('contactActions').open||!details[0].isConnected){checkParticipantCard=null;return;}
      if(!current()||data.paused||data.me?.id!==owner||relation()!==initial||!!introduced()!==hadIntroduction){
        checkParticipantCard=null;closeDialog('contactActions');
      }
    };
  }
  let formOwner;
  function render(){
    checkParticipantCard?.();
    const me=data.paused?null:data.me;identityChanged();$('directReturn').hidden=!data.paused;if(data.paused)$('returnName').textContent=data.me.name;notifyRequests('direct',data.requests||[]);
    if(formOwner!==me?.id){
      if(!me){delete $('profileAvatar').dataset.status;$('profileBtn').title=tr('Открыть профиль');}
      formOwner=me?.id;addTarget=null;$('directCode').value='';$('sendCardRequest').disabled=true;
      $('directName').value='';$('directCode').removeAttribute('aria-invalid');
    }
    $('directTitle').textContent=tr(transfer==='export'?'Сохранить профиль':transfer==='import'?'Перенести профиль на этот ПК':
      data.paused?'Войти в профиль LINK':!me?(route==='near'?'Имя для локальной сети':'Создать профиль LINK'):
      ({identity:'Мой профиль',near:'Локальная сеть',add:'Добавить друга'})[route] || 'Мой профиль')+(route==='add'&&addTarget?' · '+addTarget.name:'');
    $('startDirect').textContent=tr(data.me?'Войти в профиль LINK':'Создать профиль LINK');
    $('directAtStart').disabled=settings.proxyOnly;
    $('internetDiscoveryChoice').hidden=route==='near';
    if(settings.proxyOnly)$('directAtStart').checked=false;
    $('nameIntro').textContent=tr(route==='near'?'Введите имя, которое увидят другие участники вашей сети.':'Как вас будут видеть друзья?');
    $('directWelcome').hidden=!!data.paused||!!me||!!transfer;$('directMain').hidden=!me||!!transfer;$('transferPanel').hidden=!transfer;
    const profileBusy = Boolean(state.session || state.starting || data.incoming || data.outgoing);
    for (const id of ['directExport','directReset','directRestore']) $(id).disabled=profileBusy;
    $('directProfileBusy').hidden=!profileBusy;
    $('directAdd').hidden=route!=='add';$('directNearby').hidden=route!=='near';$('directIdentity').hidden=!me;
    $('directInvite').hidden=!me||!state.session?.invite;
    if(me){
      const nick=$('directNick');
      // Keep an edit intact when presence refreshes after the field loses focus.
      if(nick.defaultValue!==me.name || nick.dataset.owner!==me.id){
        nick.value=nick.defaultValue=me.name;
        nick.dataset.owner=me.id;
      }
      renderPrivacy();
      $('discoveryStatus').textContent=discoveryMessage(data,settings.proxyOnly);
      $('directDht').checked=!!data.dht;$('directDht').disabled=!!settings.proxyOnly;
      optionsForNic();
      $('lanName').textContent=me.name;
      const nameCounts=new Map();
      for(const c of data.near)nameCounts.set(c.name,(nameCounts.get(c.name)||0)+1);
      const near=data.near.map(c=>{
        const f=data.friends.find(v=>v.id===c.id);
        if(f?.state==='friend')return row(f,true);
        const r=node('div','contact-card'), label=node('span','contact-copy');
        label.append(node('strong','',c.name));
        if(nameCounts.get(c.name)>1)label.append(node('small','','ID · '+c.id.slice(0,8)));
        r.append(label);
        if(f)r.append(node('small','field-help',tr('Заявка отправлена')));
        else if(data.requests.some(req=>req.id===c.id))r.append(act(tr('Открыть заявку'),()=>{closeDialog('directDialog');showRequests();}));
        else r.append(act(tr('Добавить'),async()=>{await cmd('add',{value:c.id});await sync();}));
        return r;
      });
      $('nearbyList').replaceChildren(...(near.length?near:[node('p','field-help',settings.proxyOnly?tr('Поиск недоступен в режиме «Только через ретранслятор».'):data.lan?tr('Пока никого нет. Проверьте, что друг открыл LINK и выбрал ту же сеть.'):!data.nics.length?tr('Нет доступных сетей. Подключитесь к Wi-Fi, Ethernet или Radmin VPN.'):tr('Выберите сеть выше, чтобы начать поиск.'))]));
    }
    const call=data.incoming||data.outgoing;
    if(switchReview&&(data.incoming?.key!==switchReview.key||data.incoming.unavailable||state.session!==switchReview.session))switchReview.controller.abort();
    const audiblyIncoming=data.incoming && !call.taken && !call.unavailable && !settings.dnd;
    if(ringId && !audiblyIncoming){internet().hush('ring');api.internet({op:'end-ring'}).catch(()=>{});ringId='';}
    if(approvedSwitch && approvedSwitch.key!==data.incoming?.key)approvedSwitch=null;
    if(data.issue && route==='near' && $('directDialog').open && !$('directMessage').textContent)hint(data.issue);
    if(call){
      const request=call.mode==='admit',invitation=call.roomInvitation||call.mode==='invite';
      let title='Исходящий звонок';
      if(call.unavailable)title='Вызов завершён.';
      else if(call.resuming)title='Вход в комнату';
      else if(call.taken)title='Подключаемся…';
      else if(data.incoming)title=request?'Просит войти в ваш звонок':invitation?'Приглашение в комнату':call.mode==='switch'?'Вызов во время разговора':'Входящий звонок';
      else if(request||invitation)title=request?'Запрос на вход отправлен':'Ждём ответа на приглашение…';
      const status=tr(title);
      if($('peerCallTitle').textContent!==status)$('peerCallTitle').textContent=status;
      $('peerCaller').textContent=call.name||tr('Контакт');
      contactAvatar($('peerAvatar'),call);
      $('peerCallDialog').classList.toggle('is-ringing',!request&&!invitation&&!call.resuming&&!call.taken&&!call.unavailable);
      $('peerAccept').hidden=!data.incoming||call.taken||call.unavailable;
      $('peerActionIcon').setAttribute('href',request||invitation?'#icon-profile':'#icon-receiver');
      $('peerAcceptLabel').textContent=tr(request?'Разрешить вход':call.mode==='switch'?'Перейти в другой звонок':'Принять');
      $('peerRejectLabel').textContent=tr(call.unavailable?'Закрыть':data.incoming&&!call.taken?'Отклонить':'Отменить');
      if(audiblyIncoming && ringId!==call.key){ringId=call.key;internet().play('ring',false,call.mode!=='admit'&&!call.roomInvitation);}
      if(!$('peerCallDialog').open)showDialog('peerCallDialog');
    }else if($('peerCallDialog').open)closeDialog('peerCallDialog');
  }
  async function sync(){const n=++fetchNumber,s=await cmd('state');if(n!==fetchNumber)return;data=s;render();}
  window.addEventListener('online',render);
  window.addEventListener('offline',render);
  function beginTransfer(mode){transfer=mode;hint('');$('transferPass').value=$('transferRepeat').value='';$('repeatLabel').hidden=mode!=='export';
    $('transferRepeat').required=mode==='export';$('transferLabel').textContent=mode==='export'?tr('Придумайте пароль файла'):tr('Введите пароль файла');
    $('transferHint').textContent=mode==='export'?tr('От 12 символов. Файл содержит ключ профиля и текущий список друзей. Передайте файл и пароль раздельно.'):tr('Выберите ранее сохранённый файл .cclprofile. Этот компьютер получит свой ключ устройства.');
    $('transferSubmit').textContent=mode==='export'?tr('Сохранить файл…'):tr('Выбрать файл…');render();}
  bind('resumeLink',async()=>{await setMethod('link');await continueRoute();});
  bind('startDirect',()=>open('home'));bind('startNearby',()=>open('near'));
  bind('settingsDirect',()=>open('identity'));
  bind('directInvite',()=>{closeDialog('inviteDialog');inviteFriends();});
  bind('directClose',()=>closeDialog('directDialog'));
  submit('directCreateForm',async()=>{
    const button=$('directCreateForm').querySelector('button');
    if(button.disabled)return;
    button.disabled=true;
    try{
      await setMethod('link');await cmd('create',{name:$('directName').value});
      if(route!=='near' && $('directAtStart').checked && !settings.proxyOnly)await cmd('settings',{dht:true});
      await continueRoute();
    }finally{button.disabled=false;}
  });
  $('directCode').oninput=()=>{
    $('sendCardRequest').disabled=!$('directCode').value.trim();
    if($('directCode').hasAttribute('aria-invalid')){hint('');$('directCode').removeAttribute('aria-invalid');}
  };
  submit('directAddForm',async()=>{
    const input=$('directCode');
    let result;
    try{result=await cmd('add',{value:input.value.trim(),...(addTarget?{expectedPerson:addTarget.id}:{})});}
    catch(error){input.setAttribute('aria-invalid','true');input.focus();throw error;}
    input.removeAttribute('aria-invalid');input.value='';$('sendCardRequest').disabled=true;await sync();
    closeDialog('directDialog');
    if(result.addResult==='existing' || result.addResult==='accepted'){
      showFriends();toast(tr(result.addResult==='existing'?'Этот друг уже есть в ваших контактах.':'Заявка принята.'));
    }else{showRequests();toast(tr(result.addResult==='pending'?'Заявка уже отправлена. Ждём ответа друга.':'Заявка будет доставлена, когда появится связь.'));}
  });
  bind('directReset',async()=>{await cmd('reset');await sync();if(!data.me){internet().render();$('directName').value='';}hint('');});
  bind('directExport',()=>{beginTransfer('export');showDialog('directDialog');$('transferPass').focus();});bind('directRestore',()=>beginTransfer('import'));bind('transferCancel',()=>{if(!pendingTransfer){const exporting=transfer==='export';$('directTransferForm').reset();transfer='';render();if(exporting)closeDialog('directDialog');}});
  $('directDialog').addEventListener('close',()=>{if(!$('directDialog').open){$('transferPass').value=$('transferRepeat').value='';transfer='';}});
  $('settingsDialog').addEventListener('close',()=>{
    if($('settingsDialog').open)return;
    $('directNick').value=$('directNick').defaultValue;$('linkProfileTools').open=false;$('directProfileFeedback').textContent='';
  });
  submit('directTransferForm',async()=>{if(pendingTransfer)return;
    if(transfer==='export'&&$('transferPass').value!==$('transferRepeat').value)throw Error(tr('Пароли не совпадают.'));
    pendingTransfer=true;$('transferSubmit').disabled=$('transferCancel').disabled=true;
    try{const mode=transfer;
      if(mode==='import'&&!data.me)await setMethod('link');
      const ok=await cmd(mode,{password:$('transferPass').value});
      if(ok){$('transferPass').value=$('transferRepeat').value='';transfer='';
        if(mode==='import'){if(route==='home')route='identity';await continueRoute();}
        else {await sync();closeDialog('directDialog');hint(tr('Файл переноса сохранён.'));}}
    }finally{pendingTransfer=false;$('transferSubmit').disabled=$('transferCancel').disabled=false;}
  });
  const privacyFields={friendRequests:'directFriendRequests',calls:'directAllowCalls',invites:'directAllowInvites'};
  let savingPrivacy=false;
  function renderPrivacy(){
    $('directStatus').value=data.privacy?.status||'online';
    $('profileAvatar').dataset.status=$('directStatus').value;
    $('profileBtn').title=tr('Мой профиль')+' · '+$('directStatus').selectedOptions[0].textContent;
    $('directStatusHelp').hidden=$('directStatus').value!=='invisible';
    for(const [key,id] of Object.entries(privacyFields))$(id).checked=data.privacy?.[key]!==false;
  }
  for(const id of ['directStatus',...Object.values(privacyFields)])$(id).onchange=()=>run(async()=>{
    if(!data.me||savingPrivacy)return;
    savingPrivacy=true;
    const controls=['directStatus',...Object.values(privacyFields)].map($);
    const privacy={status:$('directStatus').value};
    for(const [key,id] of Object.entries(privacyFields))privacy[key]=$(id).checked;
    controls.forEach(control=>control.disabled=true);
    try{await cmd('set-contact-privacy',{owner:data.me.id,privacy});}
    finally{savingPrivacy=false;controls.forEach(control=>control.disabled=false);await sync();}
  });
  submit('directEdit',async()=>{await cmd('settings',{name:$('directNick').value});await sync();hint(tr('Имя сохранено.'));});
  $('directNic').onchange=()=>run(async()=>{
    const lan=$('directNic').value;
    if(changingNetwork)return;
    changingNetwork=true;optionsForNic();hint(tr('Меняем сеть…'));
    try{await cmd('settings',{lan});hint('');}
    finally{changingNetwork=false;await sync();}
  });
  bind('directScan',async()=>{
    if(data.lan&&!settings.proxyOnly&&data.privacy?.status!=='invisible')await cmd('refresh');
    await sync();
    hint(data.lan?discoveryMessage(data,settings.proxyOnly):tr('Список сетей обновлён.'));
  });
  $('directDht').onchange=()=>run(async()=>{try{await cmd('settings',{dht:$('directDht').checked && !settings.proxyOnly});}finally{await sync();}});
  bind('peerAccept',async()=>{
    const call=data.incoming;if(!call||call.taken||call.unavailable)return;
    if(state.session&&call.mode!=='admit'){
      if(confirmingCall)return;
      const prior=state.session;
      confirmingCall=true;
      try{
        const yes=await confirmSwitch(call,prior,call.roomInvitation);
        if(!yes){await cmd('reject',{id:call.id,key:call.key});return;}
        if((await cmd('state')).incoming?.key!==call.key || state.session!==prior)return;
        // Keep the current room live until the caller supplies a usable invitation.
        approvedSwitch={key:call.key,session:prior};
        await cmd('take',{id:call.id,key:call.key,switchRoom:true});
      }finally{confirmingCall=false;}
      return;
    }
    await cmd('take',{id:call.id,key:call.key});
  });
  const declineDisplayed=()=>data.incoming?cmd('reject',{id:data.incoming.id,key:data.incoming.key}):
    data.outgoing?cmd('cancel',{id:data.outgoing.id}):undefined;
  bind('peerReject',declineDisplayed);
  $('peerCallDialog').addEventListener('cancel',e=>{e.preventDefault();run(declineDisplayed);});
  return {open,render,sync,participant,requestRoom:r=>cmd('request-room',{id:r.id,device:r.device,door:r.door,resume:r.canReturn===true}),contactCard:row,requestCard,blockedCard,raw:()=>data,name:()=>data.paused?null:data.me?.name,active:()=>!!data.me&&!data.paused,handle(e){
    if(!e.type.startsWith('direct-'))return false;
    if(e.type==='direct-host'){closeDialog('directDialog');run(()=>connect({direct:e.info}));}
    else if(e.type==='direct-join'&&!joining){joining=true;run(async()=>{try{const s=await cmd('state');if(s.incoming){
      if(state.session){
        const session=state.session;
        const approved=approvedSwitch?.key===s.incoming.key && approvedSwitch.session===session;
        const answer=approved || await confirmSwitch(s.incoming,session,true);
        const latest=(await cmd('state')).incoming;
        if(latest?.key!==s.incoming.key || state.session!==session)return;
        if(latest.unavailable || !answer){await cmd('reject',{id:latest.id,key:latest.key});if(latest.unavailable)toast(tr('Эта комната уже недоступна.'));return;}
        const switched=await cmd('switch-join',{id:latest.id,key:latest.key});
        await disconnect(false,true);
        closeDialog('directDialog');await connect({switched});return;
      }
      closeDialog('directDialog');await connect({directJoin:s.incoming.id});
    }}finally{approvedSwitch=null;joining=false;}});}
    else if(e.type==='direct-notice')toast(e.text);
    else run(sync);
    return true;
  }};
}
