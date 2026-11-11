import {createChatView,bindChatEmoji} from './chat-view.mjs';
import {tr} from './locale.mjs';
import {groupActions,make} from './group-actions.mjs';
import {groupFeed} from './group-feed.mjs';
import {ChatPlayer,attachmentKind} from './chat-player.mjs';
import {bindAttachmentDraft} from './attachment-draft.mjs';
import {paintGroupMark} from './group-mark.mjs';
import {paintAvatar} from './profile-appearance.mjs';
import {fileSize,transferMeter} from './transfer-progress.mjs';

export function groupPanel({$,direct,api,state,confirmAction,onError,openVoice,showGroup,openChat,selectionChanged}) {
  let owner=null,id=null,group=null,channel=null,visible=false,token=0,reading=false,rerun=false,rawSeen,files=[],messages=[],before=null,more=false;
  let joining=null;
  const player=new ChatPlayer();
  const selections=new Map(),drafts=new Map(),keys=new Map(),busy=new Set();
  const empty={items:[],invites:[],transfers:[]};
  const source=()=>direct.active() && direct.raw().groups || empty;
  const isOnline=()=>!!group && (group.role==='owner'||group.online===true);
  const current=()=>({owner,id,group,channel,online:isOnline(),friends:direct.raw().friends||[]});
  const call=(op,args={})=>api.direct({op,...args});
  async function command(op,args={}){
    const stamp=owner,action=op+JSON.stringify(args);
    if(!stamp||!direct.active()||stamp!==direct.raw().me.id||busy.has(action))throw Error(tr('Дождитесь завершения операции.'));
    busy.add(action);
    try{
      const result=await call(op,args);
      if(owner===stamp){await direct.sync();if(owner===stamp)reload();}
      return result;
    }finally{busy.delete(action);}
  }
  const showSelection=(next,preferred)=>{showGroup();selectGroup(next,preferred);};
  const actions=groupActions({$,context:current,command,confirmAction,selectGroup:showSelection,showParticipant:direct.participant,onError});
  const feed=groupFeed({$,openChat,showParticipant:direct.participant,manageMember:person=>actions.manageMember(person)});
  const draftKey=()=>owner+'/'+id+'/'+channel?.id;
  bindAttachmentDraft({area:$('groupText'),input:$('groupInput'),onError,scope:()=>visible && channel?.type==='text' && isOnline() && !group.transferring && !$('strictProxy').checked ?
    {type:'group',profile:owner,group:id,channel:channel.id,key:draftKey()}:null,
    async publish(target,file,caption){await api.offerSelectedFile(target,file,caption);if(target.key===draftKey())reload();}});
  function closeChannel(){
    player.clear();
    if(channel){if($('groupInput').value)drafts.set(draftKey(),$('groupInput').value);else drafts.delete(draftKey());}
    channel=null;messages=[];files=[];before=null;more=false;chat.reset();keys.delete('files');
    $('groupShelf').open=false;$('groupEmoji').open=false;$('groupFiles').replaceChildren();feedback(null);
  }
  function selectGroup(next,preferred){
    if(!source().items?.some(g=>g.id===next))return;
    if(next!==id){actions.close();closeChannel();group=null;id=next;token++;selectionChanged();}
    if(preferred){selections.set(next,preferred);if(channel?.id!==preferred){closeChannel();token++;}}
    draw();reload();
  }
  async function enterVoice(target){
    if(joining)return;
    joining=target.id;draw();
    try{await openVoice(id,target.id);}catch(error){onError(error);}
    finally{joining=null;draw();}
  }
  function chooseChannel(target){
    if(target.type==='voice' && isOnline() && !group.transferring)return enterVoice(target);
    if(channel?.id!==target.id){
      closeChannel();channel=target;selections.set(id,target.id);token++;
      $('groupInput').value=drafts.get(draftKey())||'';
    }
    showGroup();draw();reload();$('groupChannelName').focus({preventScroll:true});
  }
  const chat=createChatView({log:$('groupLog'),scroll:$('groupScroll'),form:$('groupComposer'),input:$('groupInput'),empty:$('groupEmptyChat'),send:$('groupSend'),
    dayDividers:true,maxLength:1200,onError,rowVersion:m=>JSON.stringify([m.author,m.text,m.file,m.time,m.file&&files.find(f=>f.id===m.file.id)?.status,m.file&&group.role]),
    updateRow:(card,m)=>{
      const transfer=card.querySelector('.group-chat-transfer');
      if(transfer){
        const f=files.find(f=>f.id===m.file.id);
        if(f)transferMeter(transfer,f.done,f.size,f.bytesPerSecond,f.name);
      }
    },
    decorate:(card,m)=>{
      if(!m.file)return;
      const file=files.find(f=>f.id===m.file.id);
      if(file?.canDownload && attachmentKind(file) && (group.role==='owner'||file.canReveal)){
        const scope={group:id,channel:channel.id,file:file.id},key=draftKey();
        const box=make('div','','group-attachment-preview'),trigger=make('button',tr(attachmentKind(file)==='photo'?'Показать фото':'Просмотреть'),'button button-secondary');
        trigger.type='button';trigger.setAttribute('aria-expanded','false');trigger.dataset.action='preview';
        const read=()=>call('group-file-preview',scope);
        trigger.onclick=()=>{if(visible&&key===draftKey())player.toggle(box,trigger,file.id,file,read,onError).catch(onError);};
        card.dataset.attachmentKind=attachmentKind(file);
        player.styleTrigger(trigger,file,read);
        box.append(trigger);card.append(box);
      }
      if(file&&['downloading','uploading'].includes(file.status))card.append(make('div','','group-chat-transfer'));
      const b=make('button',m.file.name||tr('Файл канала'),'button button-secondary');b.type='button';
      b.onclick=()=>{$('groupShelf').open=true;const row=[...$('groupFiles').children].find(el=>el.dataset.file===m.file.id);(row?.querySelector('button')||$('groupShelf').querySelector('summary')).focus();};card.append(b);
    },
    onSend:async text=>{
      if(!channel||channel.type!=='text'||!isOnline())return false;
      const old=draftKey();await command('group-send',{id,channel:channel.id,text,nonce:crypto.randomUUID()});drafts.delete(old);return true;
    }});
  function once(key,value,fn){
    const encoded=JSON.stringify(value);if(keys.get(key)===encoded)return;
    keys.set(key,encoded);fn();
  }
  function little(parent,title,fn){
    const b=make('button',tr(title),'button button-secondary');b.type='button';b.onclick=()=>{b.disabled=true;Promise.resolve().then(fn).catch(onError).finally(()=>{b.disabled=false;});};parent.append(b);return b;
  }
  function invitations(list,transfers){
    const box=$('groupInvites');box.replaceChildren();
    for(const [items,isTransfer] of [[list,false],[transfers,true]])for(const offer of items){
      const row=make('div','','group-invite'),buttons=make('div','','group-invite-actions');
      row.append(make('small',tr(isTransfer?'Предложение владения':'Приглашение в группу')),make('strong',offer.name),make('small',offer.fromName));
      for(const yes of [true,false])little(buttons,yes?'Принять':'Отклонить',async()=>{
        const recipient=owner;
        if(isTransfer && yes && !await confirmAction(tr('Принять владение группой?'),offer.name+' · '+tr('Этот компьютер станет хранилищем группы.'),tr('Принять владение')))return;
        if(owner!==recipient)return;
        await command(isTransfer?'group-transfer-answer':'group-answer',{id:offer.id,accept:yes});
        if(yes && owner===recipient)showSelection(offer.id);
      });
      row.append(buttons);box.append(row);
    }
  }
  function occupants(data){
    if(!group)return {};
    const summary=source().items.find(item=>item.id===id);
    const result=isOnline()?{...(summary?.voiceRooms??group.voiceRooms)}:{};
    const session=state.session,voice=session?.groupVoice;
    if(voice?.group===id && !state.controlLost){
      const contacts=data.mixRoom===session.mixRoom?data.roomContacts:null;
      result[voice.channel]=state.peers.map(peer=>({id:peer.id===session.selfId?owner:contacts?.[peer.id],
        name:peer.name,seat:peer.id,micMuted:peer.micMuted,sharing:peer.sharing,own:peer.id===session.selfId}));
    }
    return result;
  }
  function participantList(channel,people,data){
    const list=make('ul','','group-voice-members');list.setAttribute('aria-label',channel.name);
    const screenIcon=$('navRoom').querySelector('svg'),muteIcon=$('groupMutedIcon').content.firstElementChild;
    for(const person of people){
      const row=make('li','','group-voice-member'),avatar=make('span','','group-voice-avatar');
      const photo=person.id===owner?data.me?.avatar:data.friends?.find(f=>f.id===person.id&&f.state==='friend')?.avatar;
      paintAvatar(avatar,person.name,photo);
      const label=person.name+(person.own?tr(' · вы'):'');
      row.dataset.groupSeat=person.seat;row.title=label;
      row.append(avatar,make('span',label,'group-voice-name'));
      for(const [shown,icon,status] of [[person.sharing,screenIcon,'Показывает экран'],[person.micMuted,muteIcon,'Микрофон выключен']]){
        if(!shown)continue;
        const glyph=icon.cloneNode(true);glyph.classList.add('group-voice-status');
        row.append(glyph,make('span',tr(status),'sr-only'));row.title+=' · '+tr(status);
      }
      list.append(row);
    }
    return list;
  }
  function drawChannels(people,data){
    const list=$('groupChannels'),active=document.activeElement?.dataset;
    const focusId=active?.groupChannel||active?.channelSettings;list.replaceChildren();
    if(!group)return;
    for(const type of ['text','voice']){
      const channels=group.channels.filter(c=>c.type===type);if(!channels.length)continue;
      list.append(make('h2',tr(type==='text'?'Текстовые каналы':'Голосовые каналы'),'group-section-title'));
      for(const c of channels){
        const row=make('div','','group-channel-row'),b=make('button','','group-channel');
        b.type='button';b.dataset.groupChannel=c.id;b.setAttribute('aria-current',String(c.id===channel?.id));
        const joined=state.session?.groupVoice?.group===id&&state.session.groupVoice.channel===c.id;
        row.classList.toggle('is-selected',c.id===channel?.id);row.classList.toggle('is-connected',joined);
        if(type==='voice'){
          b.title=tr(joined?'Вернуться в звонок':'Войти в голосовой канал')+' · '+c.name;
          b.setAttribute('aria-label',b.title);b.disabled=joining!==null;
        }
        if(type==='voice')b.append($('groupVoicePane').querySelector('svg').cloneNode(true));
        else {const mark=make('b','#');mark.setAttribute('aria-hidden','true');b.append(mark);}
        b.append(make('span',c.name));b.onclick=()=>chooseChannel(c);row.append(b);
        if(group.role==='owner'||group.role==='admin'){
          const edit=make('button','···','group-channel-settings');edit.type='button';edit.dataset.channelSettings=c.id;
          edit.title=tr('Настройки канала')+' · '+c.name;edit.setAttribute('aria-label',edit.title);edit.onclick=()=>actions.channel(c.id);row.append(edit);
          b.oncontextmenu=e=>{e.preventDefault();actions.channel(c.id);};
        }
        list.append(row);
        if(people[c.id]?.length)list.append(participantList(c,people[c.id],data));
        if(focusId===c.id)(active.groupChannel?b:row.querySelector('[data-channel-settings]'))?.focus({preventScroll:true});
      }
    }
  }
  function drawFiles(){
    const box=$('groupFiles'),focused=document.activeElement?.closest('[data-group-file-action]');
    const previous=focused && [focused.parentElement.dataset.file,focused.dataset.groupFileAction];box.replaceChildren();
    const count=files.filter(file=>file.canAccept).length;
    $('groupFileRequests').hidden=!count;$('groupFileRequests').textContent=count||'';
    const shelfTitle=tr('Файлы канала')+(count?' · '+tr('Ожидает принятия')+' · '+count:'');
    const summary=$('groupShelf').querySelector('summary');summary.title=shelfTitle;summary.setAttribute('aria-label',shelfTitle);
    if(!files.length)box.append(make('p',tr('В канале пока нет файлов.'),'group-meta'));
    const names={available:'Доступно',offered:'Ожидает принятия',uploading:'Отправка',downloading:'Скачивание',saved:'Сохранено',failed:'Не удалось передать файл'};
    for(const f of files){
      const row=make('div','','group-file'),info=make('div','','group-file-info');row.dataset.file=f.id;
      const status=tr(names[f.status]||'Доступно'),author=group?.members.find(m=>m.id===f.author)?.name;
      const transferring=['uploading','downloading'].includes(f.status);
      info.append(make('strong',f.name),make('small',[author,transferring?'':fileSize(f.size),status].filter(Boolean).join(' · '),'group-meta'));row.append(info);
      if(transferring){
        const transfer=make('div');transferMeter(transfer,f.done,f.size,f.bytesPerSecond,f.name);info.append(transfer);
      }
      for(const [can,op,text] of [['canAccept','accept','Принять файл'],['canDecline','decline','Отклонить'],['canDownload','download','Скачать'],['canCancel','cancel','Отменить'],['canReveal','reveal','Показать в папке'],['canWithdraw','withdraw','Отозвать файл']]){
        if(!(f[can] || can==='canDecline'&&f.canAccept))continue;
        const scope={group:id,channel:channel.id,file:f.id},person=owner;
        const button=little(row,text,async()=>{
          if(op==='withdraw' && !await confirmAction(tr('Отозвать файл?'),f.name,tr('Отозвать файл'),true))return;
          if(person!==owner||scope.group!==id||scope.channel!==channel?.id)return;
          await command('group-file-'+op,scope);
        });button.dataset.groupFileAction=op;
      }box.append(row);
    }
    if(previous){const row=[...box.children].find(el=>el.dataset.file===previous[0]);
      (row?.querySelector('[data-group-file-action="'+previous[1]+'"]')||row?.querySelector('button')||$('groupShelf').querySelector('summary')).focus({preventScroll:true});}
  }
  function feedback(e){
    const box=$('groupFeedback');box.hidden=!e;
    box.textContent=e?String(e.message||e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''):'';
    $('groupRetry').hidden=!e;
  }
  function draw(){
    const {invites=[],transfers=[]}=source(),badge=$('groupBadge'),count=owner?invites.length+transfers.length:0;
    badge.hidden=!count;badge.textContent=count||'';
    const data=direct.raw();
    feed.members(group,data,visible && !$('groupsPage').hidden && channel?.type==='text');
    if(!visible)return;
    once('header',[group?.id,group?.name,group?.avatarRev],()=>{
      $('groupsTitle').textContent=group?.name||tr('Группы');
      $('groupContextMark').hidden=!group;
      if(group)paintGroupMark($('groupContextMark'),group);
    });
    $('groupMembersButton').hidden=$('groupOptions').hidden=!group;
    if(group)$('groupMembersButton').querySelector('small').textContent=String(group.members.length);
    once('invites',[owner,invites,transfers],()=>invitations(owner?invites:[],owner?transfers:[]));
    const people=occupants(data);
    once('channels',[group?.id,group?.role,channel?.id,group?.channels,state.session?.groupVoice,joining,people],()=>drawChannels(people,data));
    const manager=group?.role==='admin'||group?.role==='owner',online=isOnline();
    $('groupAddChannel').hidden=!manager;$('groupAddChannel').disabled=!online||!!group?.transferring;
    $('groupWelcome').hidden=!!group;$('groupContent').hidden=!group;
    if(!group){
      $('groupWelcomeTitle').textContent=tr(id?'Открываем группу…':!owner?'Войдите в профиль LINK':'Пока нет групп');
      $('groupWelcomeText').textContent=tr(!owner?'Группы доступны в профиле LINK на этом ПК.':'Создайте группу для друзей или примите приглашение.');
      $('groupBegin').hidden=!!id;$('groupBegin').textContent=tr(owner?'Создать группу':'Открыть профиль LINK');
      if(id && $('groupFeedback').textContent){$('groupWelcomeText').textContent=$('groupFeedback').textContent;$('groupBegin').hidden=false;$('groupBegin').textContent=tr('Попробовать снова');}
      return;
    }
    $('groupChannelName').textContent=channel?(channel.type==='text'?'# ':'')+channel.name:tr('Каналы');
    $('groupConnection').textContent=tr(group.transferring?'Идёт передача владения':online?'':'Компьютер владельца вне сети. Сообщения и файлы станут доступны при подключении.');
    const text=channel?.type==='text',voice=channel?.type==='voice';
    $('groupText').hidden=!text;$('groupVoicePane').hidden=!voice;
    $('groupShelf').hidden=!text;
    $('groupVoiceTitle').textContent=voice?channel.name:'';
    $('groupVoiceJoin').disabled=!!joining||!online||group.transferring;
    $('groupVoiceJoin').textContent=tr(joining?'Подключение…':'Войти в голосовой канал');
    $('groupInput').disabled=!text||!online||!!group.transferring;$('groupAttach').disabled=$('groupInput').disabled;
    $('groupEmoji').hidden=$('groupInput').disabled;
    if(text)$('groupInput').placeholder=tr('Сообщение в канал')+' #'+channel.name;
    $('groupEarlier').hidden=!more;$('groupLatest').hidden=!before;
    if(text){
      feed.messages(chat,messages,group,data);
      player.reconcile();
      once('files',[id,channel.id,files,group.members.map(m=>m.name)],drawFiles);
    }
    actions.refresh();
  }
  async function reload(){
    if(!visible||!id||!owner)return;
    if(reading){rerun=true;return;}reading=true;
    const generation=token,selected=id;
    try{
      const info=await call('group-open',{id:selected});
      if(!visible||generation!==token||selected!==id)return;
      if(!info?.id)throw Error(tr('Группа недоступна.'));
      group=info;
      const next=info.channels.find(c=>c.id===selections.get(id)) || info.channels[0];
      if(channel?.id!==next?.id){closeChannel();channel=next||null;if(next)selections.set(id,next.id);$('groupInput').value=drafts.get(draftKey())||'';}
      else channel=next||null;
      let readError;
      if(channel?.type==='text' && isOnline() && !group.transferring){
        const [history,list]=await Promise.allSettled([call('group-history',{id,channel:channel.id,...(before?{before}:{})}),call('group-file-list',{group:id,channel:channel.id})]);
        if(!visible||token!==generation)return;
        if(history.status==='fulfilled'){messages=history.value.messages||[];more=!!history.value.more;}
        else{messages=[];more=false;before=null;readError=history.reason;}
        if(list.status==='fulfilled')files=Array.isArray(list.value)?list.value:[];
        else{files=[];readError??=list.reason;}
      }else{files=[];more=false;}
      feedback(readError);draw();
    }catch(e){if(visible&&generation===token){actions.close();closeChannel();group=null;feedback(e);draw();}}
    finally{reading=false;if(rerun){rerun=false;void reload();}}
  }
  function sync(shown,roomVoice){
    const who=direct.active()?direct.raw().me.id:null;
    if(who!==owner){actions.close();closeChannel();drafts.clear();selections.clear();keys.clear();id=group=null;owner=who;token++;rawSeen=null;}
    const was=visible;visible=shown;
    if(!shown&&was){actions.close();player.close();token++;}
    const snapshot=direct.raw(),items=source().items||[];
    if(!items.some(g=>g.id===id)){const next=items[0]?.id||null;if(id!==next){actions.close();closeChannel();id=next;group=null;token++;}}
    if(roomVoice && items.some(g=>g.id===roomVoice.group) && (id!==roomVoice.group||selections.get(id)!==roomVoice.channel)){
      selectGroup(roomVoice.group,roomVoice.channel);return;
    }
    draw();
    if(shown && (snapshot!==rawSeen||!was)){rawSeen=snapshot;reload();}
  }
  $('groupCreate').onclick=()=>{if(owner){showGroup();actions.create();}else direct.open('home');};
  $('groupBegin').onclick=()=>id?reload():owner?actions.create():direct.open('home');
  $('groupAddChannel').onclick=actions.addChannel;$('groupMembersButton').onclick=actions.members;$('groupOptions').onclick=actions.options;
  $('groupEarlier').onclick=()=>{if(more&&messages.length){before=messages[0].id;token++;reload();}};
  $('groupLatest').onclick=()=>{before=null;token++;reload();};
  $('groupRetry').onclick=reload;
  const shelf=$('groupShelf');
  shelf.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&shelf.open){e.preventDefault();e.stopPropagation();shelf.open=false;shelf.querySelector('summary').focus();}
  });
  document.addEventListener('pointerdown',e=>{if(shelf.open&&!shelf.contains(e.target))shelf.open=false;});
  const emoji=$('groupEmoji');
  bindChatEmoji({menu:emoji,choices:emoji.querySelector('.link-chat-emoji-choices'),input:$('groupInput')});
  $('groupAttach').onclick=()=>{if(channel){const target=draftKey();command('group-file-offer',{group:id,channel:channel.id}).then(()=>{if(visible&&target===draftKey())$('groupShelf').open=true;}).catch(onError);}};
  $('groupVoiceJoin').onclick=()=>{if(channel?.type==='voice'&&isOnline()&&!group.transferring)enterVoice(channel);};
  function opensCall(groupId=id){
    const voice=state.session?.groupVoice;
    return !!voice && voice.group===groupId && selections.get(groupId)===voice.channel;
  }
  return {sync,select:selectGroup,opensCall,get selected(){return id;}};
}
