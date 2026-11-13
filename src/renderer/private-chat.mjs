import {createChatView} from './chat-view.mjs';
import {language, tr} from './locale.mjs';
import {contactStatusLabel} from './contact-list.mjs';
import {paintAvatar} from './profile-appearance.mjs';
import {paintGroupMark} from './group-mark.mjs';
import {bindChatTools} from './chat-record.mjs';
import {bindAttachmentDraft} from './attachment-draft.mjs';
import {chatAttachments,downloadCleanupOption} from './chat-attachments.mjs';
import {appendChatText} from './chat-glyphs.mjs';
import {identityVerification} from './identity-verification.mjs';

const clock = new Intl.DateTimeFormat(language, {hour:'2-digit', minute:'2-digit'});
const day = new Intl.DateTimeFormat(language, {day:'numeric', month:'short'});
const fullDate=new Intl.DateTimeFormat(language,{dateStyle:'long'});
const collator = new Intl.Collator(language, {sensitivity:'base', numeric:true});
const lastContact=new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'});
function label(tag, style, value) {
  const el=document.createElement(tag);
  el.className=style; el.textContent=value;
  return el;
}

export function privateChats({$,direct,api,state,composer,confirmAction,onError,openGroup,openList,selected:onSelected,messageCue}) {
  let owner=null, selected=null, visible=false, contacts=[], sequence=0, readThrough=null;
  let latest=[], listKey='', readRequest=null, loadError=false, loading=false;
  let cursors=[null], hasMore=false;
  let clearingFiles=null;
  const drafts=new Map();
  const attachments=chatAttachments({scope:fileScope,refresh:()=>load(),onError});
  const request=(op, fields={})=>api.direct({op,profileId:owner,...fields});
  const friend=()=>contacts.find(c=>c.id===selected);
  const security=identityVerification({api,onError,scope:()=>{
    const contact=friend();
    return visible&&contact?{profileId:owner,id:selected,name:contact.name,
      revision:JSON.stringify([contact.online,contact.routes,contact.devices])}:null;
  }});
  $('dmSecurity').onclick=()=>{$('dmActions').open=false;security.open();};
  const input=$('dmInput'), log=$('dmLog'), scroll=$('dmScroll');
  const validateAttachment=bindAttachmentDraft({area:$('dmConversation'),input,onError,
    scope:()=>visible && (friend()?.chat?.canQueueFiles||friend()?.chat?.files) && !$('strictProxy').checked ?
      {type:'dm',id:selected,profile:owner,key:owner+'/'+selected}:null,
    async publish(target,file,caption){
      const sent=await api.offerSelectedFile(target,file,caption);
      if(visible && target.profile===owner && target.id===selected){cursors=[null];await load('end');}
      return sent;
    }});
  const chat=createChatView({log,input,scroll,form:$('dmForm'),send:$('dmSend'),
    maxLength:4000,maxMessages:128,dayDividers:true,onError,decorate:attachments.decorate,
    rowVersion:m=>m.attachment?.state||'',
    updateRow:attachments.updateRow,
    async onSend(text,clientId) {
      const id=selected, person=owner;
      if(!friend() || !visible)return false;
      await request('chat-send',{id,text,clientId});
      if(id===selected && owner===person){cursors=[null];await load();}
      return true;
    }});
  const emoji=$('dmEmoji');
  function fileScope(){
    const id=selected,profileId=owner;
    const current=()=>selected===id && owner===profileId && !!friend() && visible;
    const doFile=(action,fields={})=>api.direct({op:'chat-attachment',id,profileId,action,...fields});
    return {context:'dm',current,doFile,
      api:({op,id:messageId,requestId})=>doFile(op,messageId?{messageId}:{requestId}),
      async sendClip(kind,bytes){
        if(!current() || $('strictProxy').checked)throw Error(tr('Профиль LINK изменился. Откройте диалог снова.'));
        await doFile('clip',{kind,bytes});if(current()){cursors=[null];await load('end');}
      }};
  }
  const dmRecord=bindChatTools({$,prefix:'dm',form:$('dmForm'),input,onError,
    record:kind=>{const scope=fileScope();if(scope.current())return composer.record(kind,scope);},
    async offer(){const scope=fileScope();if(scope.current()&&await scope.doFile('offer')&&scope.current()){cursors=[null];await load('end');}}
  });
  let backgroundChat=null;
  function markRead() {
    if(!visible||!selected||loading||backgroundChat===selected||!friend()?.chat?.unread||document.hidden||!document.hasFocus()||document.querySelector('dialog[open]'))return;
    const bounds=scroll.getBoundingClientRect(),unread=new Set(latest.filter(m=>m.direction==='in'&&m.unread).map(m=>m.id));
    const ids=[];
    for(const row of log.children){
      if(!unread.has(row.dataset.id))continue;
      const rect=row.getBoundingClientRect(),amount=Math.min(bounds.bottom,rect.bottom)-Math.max(bounds.top,rect.top);
      if(rect.height>0&&amount>=Math.min(rect.height,24))ids.push(row.dataset.id);
    }
    const id=selected,person=owner,key=ids.join('/');
    if(!ids.length||readThrough===key||readRequest===key)return;
    readRequest=key;
    request('chat-read',{id,ids}).then(result=>{
      if(selected===id&&owner===person&&result?.readApplied!==false)readThrough=key;
    }).catch(onError).finally(()=>{if(readRequest===key)readRequest=null;});
  }
  let wide=false,wideProfile=true,narrowProfile=false,sharedKey='';
  const profile=$('dmProfile'),profileToggle=$('dmProfileToggle'),conversation=$('dmConversation');
  const closeProfile=$('dmCloseProfile'),thread=conversation.querySelector('.dm-thread-body');
  function profileLayout(){
    const focused=document.activeElement;
    const hadProfileFocus=profile.contains(focused);
    if(visible&&!conversation.hidden)wide=conversation.clientWidth>=740;
    const show=visible&&!!friend()&&(wide?wideProfile:narrowProfile);
    profile.hidden=!show;
    conversation.classList.toggle('with-profile',show);
    conversation.classList.toggle('compact-profile',!wide);
    profileToggle.setAttribute('aria-expanded',String(show));
    if(visible&&friend()&&hadProfileFocus&&(!show||(wide&&focused===closeProfile))){
      profileToggle.focus({preventScroll:true});
    }
    if(show)sharedGroups();
  }
  function sharedGroups(){
    const groups=direct.raw().groups?.items||[],list=$('dmSharedList');
    const key=JSON.stringify([owner,selected,groups.map(g=>[g.id,g.epoch,g.revision,g.avatarRev])]);
    if(sharedKey===key)return;
    sharedKey=key;list.replaceChildren();$('dmSharedGroups').hidden=true;
    if(!groups.length||$('strictProxy').checked)return;
    request('group-shared-with',{person:selected}).then(items=>{
      if(sharedKey!==key||!Array.isArray(items))return;
      for(const group of items){
        const button=document.createElement('button'),mark=document.createElement('span');
        button.type='button';paintGroupMark(mark,group);
        button.append(mark,label('span','',group.name));button.onclick=()=>openGroup(group.id);
        list.append(button);
      }
      $('dmSharedGroups').hidden=!items.length;
    }).catch(()=>{if(sharedKey===key)sharedKey='';});
  }
  profileToggle.onclick=()=>{
    if(wide)wideProfile=!wideProfile;else narrowProfile=!narrowProfile;
    profileLayout();
    if(!wide&&narrowProfile)closeProfile.focus({preventScroll:true});
  };
  function dismissProfile(){
    narrowProfile=false;
    profileLayout();
    profileToggle.focus({preventScroll:true});
  }
  closeProfile.onclick=dismissProfile;
  thread.addEventListener('focusin',()=>{
    if(!wide&&narrowProfile){narrowProfile=false;profileLayout();}
  });
  new ResizeObserver(profileLayout).observe(conversation);
  conversation.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!wide&&!profile.hidden&&!conversation.querySelector('details[open]')){
      event.preventDefault();dismissProfile();
    }
  });
  function showInfo() {
    validateAttachment();
    security.sync();
    const c=friend();
    $('dmConversation').hidden=!c; $('dmIdle').hidden=!!c;
    $('messagesPage').classList.toggle('has-dialog',!!c);
    profileLayout();
    if(!c){sharedKey='';if($('dmSharedList').childElementCount)$('dmSharedList').replaceChildren();return;}
    paintAvatar($('dmAvatar'),c.name,c.avatar);
    $('dmTitle').textContent=c.name;
    const online=c.online===true;
    const seen=!online&&c.status==='offline'&&Number.isFinite(c.lastSeen)&&c.lastSeen>0&&c.lastSeen<=Date.now();
    $('dmPresence').textContent=seen?tr('Последний раз в сети · {date}').replace('{date}',()=>lastContact.format(c.lastSeen)):contactStatusLabel(c);
    $('dmPresence').classList.toggle('available',online);
    $('dmIntro').hidden=loading||loadError||hasMore;
    for(const id of ['dmIntroAvatar','dmProfileAvatar'])paintAvatar($(id),c.name,c.avatar);
    $('dmProfileAvatar').dataset.online=String(online);
    $('dmProfileAvatar').dataset.status=c.status||'';
    $('dmIntroName').textContent=$('dmProfileName').textContent=c.name;
    $('dmProfileStatus').textContent=$('dmPresence').textContent;
    $('dmProfileCover').dataset.cover=c.cardStyle?.cover||'default';
    $('dmAboutText').textContent=c.cardStyle?.about||'';
    $('dmAbout').hidden=!c.cardStyle?.about;
    const date=new Date(c.added);
    const dated=Number.isFinite(c.added)&&c.added>0&&Number.isFinite(date.getTime());
    $('dmFriendSince').hidden=!dated;
    if(dated){
      const time=$('dmFriendSince').querySelector('time');time.dateTime=date.toISOString();time.textContent=fullDate.format(date);
    }
    input.placeholder=tr('Сообщение · {name}').replace('{name}',()=>c.name);
    const data=direct.raw();
    const callText=tr(state.session?'Пригласить в звонок':'Позвонить');
    $('dmCall').title=callText; $('dmCall').setAttribute('aria-label',callText);
    $('dmCall').disabled=!online || !!data.outgoing || !!data.incoming || !!state.starting ||
      $('strictProxy').checked || !!(state.session && (state.session.internet || state.session.groupVoice || state.session.role!=='host'));
    const strict=$('strictProxy').checked;
    const canAttach=!strict && !loading && !loadError && (c.chat?.canQueueFiles===true||c.chat?.files===true);
    dmRecord(canAttach);
    $('dmFileHint').hidden=canAttach;
    $('dmFileHint').textContent=canAttach?'':tr('Подключите устройство друга с поддержкой вложений.');
    const note=clearingFiles?.owner===owner?'Удаляем скачанные файлы…':loadError?'Не удалось открыть историю.':loading?'Загрузка переписки…':strict?'Личные сообщения LINK недоступны в строгом режиме.':!online?
      'Сообщения будут доставлены, когда друг появится в сети.':!c.chat?.supported?
      'Для доставки личных сообщений другу нужна версия LINK с чатами.':'';
    $('dmNotice').textContent=tr(note); $('dmNotice').hidden=!note;
    $('dmRetry').hidden=!loadError;
    $('dmEarlier').hidden=!hasMore || loadError || loading;
    $('dmPast').hidden=cursors.length<2;
    $('dmLatest').hidden=cursors.length<3;
    $('dmClear').disabled=clearingFiles?.owner===owner || loading || (!loadError && !latest.length && !c.chat?.downloads);
    chat.setEnabled(!loadError && !loading && !strict);
  }
  async function load(position) {
    const id=selected, revision=++sequence;
    if(!id || !visible)return;
    try {
      const before=cursors.at(-1);
      const history=await request('chat-history',before?{id,before}:{id});
      if(revision!==sequence || selected!==id || !visible)return;
      latest=history.messages;
      hasMore=history.hasMore===true;
      chat.replace(latest.map(m=>({id:m.id,text:m.attachment?.clip==='voice'?tr('Голосовое сообщение'):m.attachment?.clip==='circle'?tr('Видеосообщение'):m.text,attachment:m.attachment,time:m.time,own:m.direction==='out',
        status:m.direction==='out'?m.status:null})));
      attachments.reconcile();loadError=false; loading=false; showInfo();
      if(position==='end')scroll.scrollTop=scroll.scrollHeight;
      if(position==='start')scroll.scrollTop=0;
      markRead();
    } catch(error) {
      if(revision!==sequence)return;
      loading=false; loadError=true; showInfo(); onError(error);
    }
  }
  function select(id,focus=true) {
    if(id && !contacts.some(c=>c.id===id))return;
    if(selected!==id) {
      attachments.clear();composer?.clearFor('dm');$('dmAttach').open=false;
      const previous=chat.reset(drafts.get(id));
      if(selected && friend() && previous)drafts.set(selected,previous); else drafts.delete(selected);
      selected=id; sequence++; latest=[]; cursors=[null]; hasMore=false; readThrough=readRequest=null; loadError=false; loading=!!id;
      sharedKey='';narrowProfile=false;
      $('dmActions').open=false; emoji.open=false;
    }
    drawList(); showInfo();
    if(id){
      void load().then(()=>{if(focus && selected===id && visible && document.activeElement===$('dmTitle'))input.focus({preventScroll:true});});
      if(focus)$('dmTitle').focus({preventScroll:true});
    } else if(focus)$('dmSearch').focus({preventScroll:true});
  }
  function drawList() {
    const query=$('dmSearch').value.trim().toLocaleLowerCase();
    const rows=contacts.filter(c=>c.name.toLocaleLowerCase().includes(query)).sort((a,b)=>
      (b.chat?.last?.time||0)-(a.chat?.last?.time||0) || Number(!!b.online)-Number(!!a.online) || collator.compare(a.name,b.name));
    const key=JSON.stringify([owner,selected,query,rows.map(c=>[c.id,c.name,c.avatarRev,c.online,c.status,c.inCall,c.chat?.last,c.chat?.unread])]);
    if(listKey===key)return;
    listKey=key;
    const previous=document.activeElement?.closest('.dm-entry')?.dataset.person;
    const buttons=rows.map(c=>{
      const b=document.createElement('button'); b.type='button'; b.className='dm-entry'; b.dataset.person=c.id;
      if(c.id===selected)b.setAttribute('aria-current','true');
      const avatar=label('span','dm-avatar','');paintAvatar(avatar,c.name,c.avatar);
      avatar.dataset.online=String(!!c.online);
      avatar.dataset.status=c.status||'';
      const last=c.chat?.last, copy=document.createElement('span');
      copy.className='dm-entry-copy';
      const preview=label('span','dm-preview','');
      appendChatText(preview,last?(last.direction==='out'?tr('Вы · '):'')+
        (last.clip==='voice'?tr('Голосовое сообщение'):last.clip==='circle'?tr('Видеосообщение'):last.text):contactStatusLabel(c));
      copy.append(label('strong','dm-entry-name',c.name),preview);
      const meta=document.createElement('span'); meta.className='dm-entry-meta';
      if(last){
        const when=new Date(last.time);
        meta.append(label('time','dm-stamp',when.toDateString()===new Date().toDateString()?clock.format(when):day.format(when)));
      }
      if(c.chat?.unread)meta.append(label('span','dm-unread',String(c.chat.unread)));
      b.append(avatar,copy,meta); b.onclick=()=>{onSelected?.();select(c.id);}; return b;
    });
    $('dmList').replaceChildren(...buttons);
    if(previous)buttons.find(b=>b.dataset.person===previous)?.focus({preventScroll:true});
    $('dmListEmpty').hidden=!!buttons.length;
    $('dmListEmpty').textContent=tr(!owner?'Войдите в профиль LINK, чтобы открыть личные чаты.':
      query?'Совпадений нет. Измените поиск или фильтр.':'Здесь появятся ваши друзья.');
  }
  function sync(isVisible) {
    const data=direct.raw(), nextOwner=direct.active()?data.me.id:null;
    const fresh=nextOwner?data.friends.filter(c=>c.state==='friend'):[];
    const entering=!visible && isVisible;
    if((visible && !isVisible) || nextOwner!==owner){if(nextOwner!==owner)attachments.clear();else attachments.close();composer?.clearFor('dm');}
    else if($('strictProxy').checked)composer?.clearFor('dm',true);
    visible=isVisible;
    if(owner!==nextOwner){
      backgroundChat=null;
      owner=nextOwner; selected=null; latest=[]; cursors=[null]; hasMore=false; sequence++; readThrough=readRequest=null; loadError=loading=false;
      drafts.clear(); chat.reset(); $('dmSearch').value=''; listKey='';
      $('dmStorage').open=$('dmActions').open=emoji.open=false;
      $('dmList').replaceChildren(); $('dmTitle').textContent='';paintAvatar($('dmAvatar'),'',null);
    }
    contacts=fresh;
    if(drafts.size){
      const friends=new Set(contacts.map(c=>c.id));
      for(const id of drafts.keys())if(!friends.has(id))drafts.delete(id);
    }
    if(selected && !friend()){
      const returnToList=visible&&conversation.contains(document.activeElement);
      drafts.delete(selected);select(null,false);
      if(returnToList){openList();$('dmSearch').focus({preventScroll:true});}
    }
    const unread=contacts.reduce((n,c)=>n+(c.chat?.unread||0),0);
    $('dmBadge').hidden=!unread; $('dmBadge').textContent=unread>99?'99+':String(unread);
    if(!visible){validateAttachment();return;}
    const bytes=data.chatStorage?.bytes||0;
    const clearing=!!owner && clearingFiles?.owner===owner;
    $('dmStorage').setAttribute('aria-busy',String(clearing));
    $('dmStorageSize').textContent=clearing?tr('Удаляем скачанные файлы…'):tr('История на этом ПК')+' · '+new Intl.NumberFormat(language,{style:'unit',unit:'kilobyte',maximumFractionDigits:1}).format(bytes/1000);
    $('dmClearAll').disabled=clearing || !owner || !(data.chatStorage?.messages || data.chatStorage?.downloads);
    drawList(); showInfo();
    if(entering && selected)void load();
    else markRead();
  }
  async function clear(all) {
    const person=owner, id=selected;
    const title=tr(all?'Очистить все личные чаты':'Очистить переписку');
    $('dmActions').open=$('dmStorage').open=false;
    const detail=all?tr('На этом ПК будут удалены сообщения всех личных чатов профиля LINK и отменена их ожидающая отправка.'):
      (friend()?.name||'')+' · '+tr('На этом ПК будут удалены сообщения этого чата и отменена их ожидающая отправка.');
    const {option,checkbox}=downloadCleanupOption('dmClearDownloads',all);
    if(!person || !await confirmAction(title,detail,title,true,option))return;
    if(owner!==person || (!all && selected!==id))return;
    attachments.close();
    const operation={owner:person};
    if(checkbox.checked){clearingFiles=operation;sync(visible);}
    let result;
    try{result=await request(all?'chat-clear-all':'chat-clear',{...(!all && {id}),deleteDownloads:checkbox.checked});}
    finally{if(clearingFiles===operation){clearingFiles=null;sync(visible);}}
    if(owner!==person)return;
    if(all)drafts.clear();else drafts.delete(id);
    if(all || selected===id){sequence++; chat.reset(); latest=[]; cursors=[null]; hasMore=false; readThrough=null;}
    await direct.sync(); if(visible && selected)await load();
    if(result?.failed)onError(tr('Часть загрузок удалить не удалось. Закройте открытые файлы и повторите очистку.'));
    else if(result?.kept)onError(tr('Изменённые файлы и вложения, используемые в других чатах, сохранены.'));
  }
  $('dmClear').onclick=()=>clear(false).catch(onError);
  $('dmClearAll').onclick=()=>clear(true).catch(onError);
  $('dmCall').onclick=()=>{if(friend() && !$('dmCall').disabled)request('call',{id:selected}).then(()=>direct.sync()).catch(onError);};
  $('dmBack').onclick=()=>{select(null,false);openList?.();};
  $('dmEarlier').onclick=()=>{
    if(!hasMore || !latest.length || loading)return;
    cursors.push(latest[0].id); loading=true; showInfo(); void load('end');
  };
  $('dmLater').onclick=()=>{
    if(cursors.length<2 || loading)return;
    cursors.pop(); loading=true; showInfo(); void load('start');
  };
  $('dmLatest').onclick=()=>{cursors=[null]; loading=true; showInfo(); void load('end');};
  $('dmSearch').oninput=drawList;
  $('dmRetry').onclick=()=>void load();
  scroll.addEventListener('scroll',markRead,{passive:true});
  window.addEventListener('focus',markRead);
  document.addEventListener('visibilitychange',markRead);
  for(const menu of [$('dmStorage'),$('dmActions')]){
    menu.addEventListener('keydown',e=>{if(e.key==='Escape' && menu.open){e.stopPropagation();menu.open=false;menu.querySelector('summary').focus();}});
    document.addEventListener('pointerdown',e=>{if(menu.open && !menu.contains(e.target))menu.open=false;});
  }
  return {select,sync,focused(){backgroundChat=null;markRead();},changed({id,profile,incoming,background}){
    const data=direct.raw();
    const open=visible && selected===id;
    if(incoming && profile===owner && open)backgroundChat=background?id:null;
    if(incoming && direct.active() && profile===data.me.id && data.friends.some(f=>f.state==='friend' && f.id===id) &&
       !data.blocked?.some(f=>f.id===id) && (background || !open || document.hidden || !document.hasFocus()))messageCue();
    if(visible && selected && (id===null || open))void load();
  }};
}
