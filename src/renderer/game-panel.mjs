import {tr} from './locale.mjs';
import {paintAvatar} from './profile-appearance.mjs';
import {createChatView} from './chat-view.mjs';
import {chatAttachments,downloadCleanupOption} from './chat-attachments.mjs';
import {bindAttachmentDraft} from './attachment-draft.mjs';
import {bindChatTools} from './chat-record.mjs';
function element(tag,text,cls){
  const el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;
}
export function gamePanel({$,api,direct,composer,actionError,confirmAction}){
  let last='',noticeIds,chatRoom,visible=false;
  const tabs=[$('gameChatTab'),$('gameNetworkTab')],session=$('gameSession'),members=$('gameMembers');
  const memberToggle=$('gameMembersToggle');
  let compact=false,wideMembers=true,narrowMembers=false;
  function showMembers(){
    const open=compact?narrowMembers:wideMembers;
    members.hidden=!open;session.classList.toggle('show-members',open);
    memberToggle.setAttribute('aria-expanded',String(open));
  }
  new ResizeObserver(([entry])=>{
    if(entry.contentRect.width){compact=entry.contentRect.width<710;session.classList.toggle('lan-compact',compact);showMembers();}
  }).observe(session);
  memberToggle.onclick=()=>{if(compact)narrowMembers=!narrowMembers;else wideMembers=!wideMembers;showMembers();};
  session.addEventListener('keydown',e=>{if(e.key==='Escape'&&compact&&narrowMembers){narrowMembers=false;showMembers();memberToggle.focus();}});
  function showTab(tab){
    for(const item of tabs){
      const selected=item===tab;item.setAttribute('aria-selected',String(selected));
      item.tabIndex=selected?0:-1;$(item.getAttribute('aria-controls')).hidden=!selected;
    }
    if(compact){narrowMembers=false;showMembers();}
    if(tab!==tabs[0])closeMedia();
  }
  for(const [i,tab] of tabs.entries()){
    tab.onclick=()=>showTab(tab);
    tab.onkeydown=e=>{
      if(!['ArrowRight','ArrowLeft','End','Home'].includes(e.key))return;
      e.preventDefault();const next=tabs[e.key==='Home'?0:e.key==='End'?1:1-i];showTab(next);next.focus();
    };
  }
  const pending=new Set();
  async function command(op,args={}){
    if(pending.has(op))return false;pending.add(op);
    try{await api.direct({op,...args});await direct.sync();return true;}catch(e){
      await direct.sync().catch(()=>{});
      if(!(['game-enable','game-repair'].includes(op)&&direct.raw().game?.network.error))actionError(e);
      return false;
    }finally{pending.delete(op);}
  }
  function button(text,fn){const b=element('button',tr(text),'button button-secondary');b.type='button';b.onclick=fn;return b;}
  $('gameCreate').onsubmit=async e=>{e.preventDefault();await command('game-create',{title:$('gameTitle').value.trim(),listed:$('lanPublish').checked});};
  $('gameLeave').onclick=async()=>{
    const room=direct.raw().game?.room;if(!room)return;
    if(room.host && room.roster.length>1 && !await confirmAction(tr('Завершить игровую LAN?'),tr('Все участники отключатся от игровой сети. Голосовые звонки продолжатся.'),tr('Завершить LAN'),true))return;
    if(direct.raw().game?.room?.id===room.id)await command('game-leave');
  };
  $('gameActivate').onclick=()=>command(['ready','starting'].includes(direct.raw().game?.network.phase)?'game-disable':direct.raw().game?.network.reason==='stale'?'game-repair':'game-enable');
  const history=$('gameHistory'),input=$('gameMessage'),form=$('gameComposer');
  function fileScope(){
    const data=direct.raw(),room=data.game?.room?.id,profileId=data.me?.id;
    const current=()=>{
      const d=direct.raw(),r=d.game?.room;
      return !!room&&profileId===d.me?.id&&room===r?.id&&!r.waiting&&r.canShareFiles===true&&
        visible&&!$('gameChatPane').hidden&&direct.active()&&!$('strictProxy').checked;
    };
    const doFile=(action,fields={})=>api.direct({op:'game-file',profileId,room,action,...fields});
    return {context:'lan',current,doFile,
      api:({op,requestId})=>api.lanCamera(op==='camera'?'request':'cancel',{room,requestId}),
      async sendClip(kind,bytes){
        if(!current())throw Error(tr('Чат изменился. Выберите вложение снова.'));
        await doFile('clip',{kind,bytes});await direct.sync();
      }};
  }
  const attachments=chatAttachments({scope:fileScope,refresh:()=>direct.sync(),onError:actionError});
  function closeMedia(){
    attachments.close();composer.clearFor('lan');$('gameAttach').open=$('gameEmoji').open=false;
  }
  const tools=bindChatTools({$,prefix:'game',form,input,onError:actionError,
    record:kind=>{const scope=fileScope();if(scope.current())return composer.record(kind,scope);},
    async offer(){const scope=fileScope();if(scope.current()&&await scope.doFile('offer'))await direct.sync();}
  });
  const validateDraft=bindAttachmentDraft({area:$('gameChatPane'),input,onError:actionError,
    scope:()=>{
      if(!fileScope().current())return null;
      const d=direct.raw(),id=d.game.room.id,profile=d.me.id;
      return {type:'lan',id,profile,key:profile+'/'+id};
    },
    async publish(target,file,caption){
      const result=await api.offerSelectedFile(target,file,caption);await direct.sync();return result;
    }
  });
  const chat=createChatView({log:history,input,form,
    send:$('gameSendMessage'),empty:$('gameChatEmpty'),maxLength:1000,dayDividers:true,onError:actionError,
    decorate:attachments.decorate,updateRow:attachments.updateRow,rowVersion:m=>m.attachment?.state||'',
    onSend:text=>visible&&chatRoom===direct.raw().me?.id+'/'+direct.raw().game?.room?.id&&
      command('game-chat',{room:direct.raw().game.room.id,text})});
  $('gameClearChat').onclick=async()=>{
    const room=direct.raw().game?.room,profileId=direct.raw().me?.id,through=room?.messages.at(-1)?.id;
    if(!room||!through&&!room.hasDownloads)return;
    const {option,checkbox}=downloadCleanupOption('gameClearDownloads');
    if(await confirmAction(tr('Очистить чат матча у вас?'),tr('Сообщения останутся у других участников.'),tr('Очистить у меня'),true,option)
      &&direct.raw().game?.room?.id===room.id&&direct.raw().me?.id===profileId){
      attachments.close();
      $('gameClearChat').disabled=true;
      try{
        const result=await api.direct({op:'game-clear-chat',profileId,room:room.id,through:through||null,deleteDownloads:checkbox.checked});
        await direct.sync();
        if(result?.failed)actionError(tr('Часть загрузок удалить не удалось. Закройте открытые файлы и повторите очистку.'));
        else if(result?.kept)actionError(tr('Изменённые файлы и вложения, используемые в других чатах, сохранены.'));
      }catch(error){actionError(error);}
      finally{$('gameClearChat').disabled=false;}
    }
  };
  $('lanVisible').onchange=()=>command('game-visibility',{listed:$('lanVisible').checked});
  $('gameSendInvite').onclick=()=>command('game-invite',{id:$('gameFriend').value});
  $('gameCopyDiag').onclick=async()=>{
    const d=direct.raw(),g=d.game,r=g?.room,n=g?.network;if(!r||!n)return;
    const me=r.roster.find(p=>p.device===d.me.device),p=r.roster.find(p=>p.device===$('gameTarget').value),result=n.path||{};
    const t=n.traffic||{},tested=result.device===p?.device;
    const lines=['CRAFTCODE LINK · LAN · '+new Date().toISOString(),
      tr('Этот ПК')+' '+r.prefix+'.'+(me?.slot??'?')+' / '+n.phase+' · UDP '+(result.port||result.code||result.state),
      tr('Участник')+' '+(p?r.prefix+'.'+p.slot+' / '+(p.ready?'ready':'off')+' · UDP '+(p.probePort??45879):'—'),
      tr('Проверка UDP')+' '+(result.device&&!tested?'idle':result.state)+(tested&&Number.isFinite(result.ms)?' · '+result.ms+tr(' мс'):''),
      tr('Игровые пакеты')+' · TX '+(t.tx||0)+' / RX '+(t.rx||0)+' · '+tr('Широковещательные')+' TX '+(t.broadcastTx||0)+' / RX '+(t.broadcastRx||0),
      tr('Передано в соединения участников, включая проверку')+' '+(t.relayed||0),
      tr('Отклонено фильтром')+' TX '+(t.blockedTx||0)+' '+(t.lastBlockedTx||'')+' / RX '+(t.blockedRx||0)+' '+(t.lastBlockedRx||''),
      tr('Дополнительные игровые порты')+' · '+(n.ports||'—')];
    if(t.queriesTx||t.queriesRx||t.answersTx||t.answersRx){
      lines.push(tr('Поиск матчей')+' TX '+t.queriesTx+' / RX '+t.queriesRx,
        tr('Ответы игры на поиск')+' TX '+t.answersTx+' / RX '+t.answersRx);
      lines.push(tr('Ответы на запрос этого ПК для игрового адаптера')+' · '+(t.matchedRx||0));
    }
    if(t.lastMatch)lines.push(tr('Обнаруженный игровой сервер')+' · '+r.prefix+'.'+t.lastMatch.seat+':'+t.lastMatch.port+
      (Number.isInteger(t.lastMatch.build)?' · build '+t.lastMatch.build:'')+(t.lastMatch.corrected?' · '+tr('Исправлен адрес адаптера'):''));
    if(t.adapterDrops)lines.push(tr('Не передано адаптеру')+' · '+t.adapterDrops);
    try{await api.copyText(lines.join('\n'));$('gamePathResult').textContent=tr('Скопировано');}catch(e){actionError(e);}
  };
  $('gameTestPath').onclick=()=>command('game-check-path',{device:$('gameTarget').value});
  $('gameEosPorts').onclick=()=>{
    const input=$('gamePorts'),rules=input.value.split(',').map(rule=>rule.trim()).filter(Boolean);
    if(!rules.some(rule=>/^udp\s+7777\s*[-–]\s*7876$/i.test(rule)))rules.push('UDP 7777-7876');
    input.value=rules.join(', ');input.focus();
  };
  $('gamePortsForm').onsubmit=async event=>{
    event.preventDefault();
    const room=direct.raw().game?.room;if(!room)return;
    if(await command('game-ports',{room:room.id,ports:$('gamePorts').value}))
      $('gamePorts').value=direct.raw().game.network.ports||'';
  };
  $('ueJoin').onclick=()=>command('game-launch-unreal',{device:$('gameTarget').value,port:$('gameLaunchPort').valueAsNumber});
  $('gameTarget').onchange=()=>{last='';draw();};
  $('ueLaunch').onclick=()=>command('game-launch-unreal',{port:$('gameLaunchPort').valueAsNumber});
  $('gameProfile').onclick=()=>direct.open('home');
  function draw(show=visible){
    if(visible&&!show)closeMedia();
    visible=show;
    validateDraft();
    const d=direct.raw(),g=d.game||{},r=g.room,net=g.network||{},invites=g.invitations||[],friends=(d.friends||[]).filter(c=>c.state==='friend'&&c.online&&c.game);
    const contacts=new Map((d.friends||[]).filter(c=>c.state==='friend').map(c=>[c.id,c]));
    const likeness=r?.roster.map(p=>p.id===d.me?.id?d.me?.avatar:contacts.get(p.id)?.avatar);
    const sig=JSON.stringify([visible,d.me?.id,d.paused,$('strictProxy').checked,g,likeness,friends.map(c=>[c.id,c.name])]);if(sig===last)return;last=sig;
    const ids=invites.map(i=>i.id);if(noticeIds!==ids.join(',')){noticeIds=ids.join(',');api.internet({op:'sync-game-notices',ids}).catch(()=>{});}
    const ready=direct.active();
    $('gameBadge').hidden=!invites.length;$('gameBadge').textContent=String(invites.length);
    $('gameProfile').hidden=ready;$('gameCreate').hidden=!ready||!!r;
    $('gameLobby').hidden=!!r;
    $('gameSession').hidden=!r;$('gameInvites').replaceChildren();
    for(const i of invites){
      const row=element('div','','game-row');row.append(element('strong',i.name+' · '+i.title),
        button('Принять',()=>command('game-answer',{id:i.id,yes:true})),button('Отклонить',()=>command('game-answer',{id:i.id,yes:false})));$('gameInvites').append(row);
    }
    const returns=$('gameReturns');returns.hidden=!ready || (!!r && !g.returns?.length);
    if(r && returns!==$('gamePage').lastElementChild)$('gamePage').append(returns);
    else if(!r && returns.nextElementSibling!==$('gameInvites'))$('gamePage').insertBefore(returns,$('gameInvites'));
    returns.replaceChildren();
    if(!returns.hidden)returns.append(element('h3',tr('Игровые сети друзей')));
    if(!returns.hidden && g.asked){const pending=element('div','','game-row');pending.append(element('span',tr('Запрос отправлен')+' · '+g.askedTitle),button('Отменить запрос',()=>command('game-cancel-request')));returns.append(pending);}
    if(!returns.hidden && !g.asked && !g.returns?.length)returns.append(element('p',tr('Сейчас у друзей нет открытых игровых сетей.'),'field-help'));
    if(!returns.hidden)for(const item of [...(g.returns||[])].sort((a,b)=>Number(b.again)-Number(a.again)||a.name.localeCompare(b.name))){
      if(item.id===g.asked)continue;
      const row=element('div','','game-row surface'),full=item.count>=17;
      const back=button(full?'Мест нет':item.again?'Вернуться в LAN':'Попроситься в LAN',()=>command(item.again?'game-return':'game-ask',{id:item.id,device:item.device,person:item.person}));
      back.disabled=full||!!g.asked||!!r;if(r)back.title=tr('Сначала выйдите из своей игровой LAN.');row.append(element('strong',item.title),element('span',item.name+' · '+tr('Участники')+' '+item.count),back);returns.append(row);
    }
    const roomKey=r?d.me.id+'/'+r.id:null;
    if(chatRoom!==roomKey){chatRoom=roomKey;$('gameLaunchPort').value='7777';attachments.clear();closeMedia();chat.reset();showTab(tabs[0]);delete history.dataset.key;}
    if(!r)return;
    $('lanVisibility').hidden=!r.host;$('lanVisible').checked=!!g.listed;
    const requests=$('lanRequests'),requestsKey=JSON.stringify((g.requests||[]).map(req=>[req,contacts.get(req.id)?.avatar]));
    if(requests.dataset.key!==requestsKey){
      requests.dataset.key=requestsKey;
      requests.replaceChildren(...(g.requests||[]).map(req=>{
        const row=element('div','','lan-request'),caption=element('div','','lan-request-title'),actions=element('div','','lan-request-actions');
        const avatar=element('span','','lan-request-avatar'),who=element('div');
        paintAvatar(avatar,req.name,contacts.get(req.id)?.avatar);
        who.append(element('strong',req.name),element('small',tr('Просится в игровую LAN')));
        caption.append(avatar,who);
        actions.append(button('Принять',()=>command('game-review',{device:req.device,yes:true})),button('Отклонить',()=>command('game-review',{device:req.device,yes:false})));
        row.append(caption,actions);return row;
      }));
    }
    $('gameRole').textContent=tr(r.host?'Вы организатор':'Игровая комната');
    $('gameLeave').textContent=tr(r.host&&r.roster.length>1?'Завершить LAN':'Выйти из LAN');
    $('gameConnection').dataset.phase=net.error?'error':net.phase;
    $('gameStateTitle').textContent=tr(net.error?'Подключение приостановлено':r.waiting?'Вход в комнату':net.phase==='ready'?'Игровая сеть подключена':net.phase==='starting'?'Подключаем игровую сеть':'Подключение к игре');
    $('gameName').textContent=r.title;$('gameCount').textContent=String(r.roster.length);
    $('ueDiscovery').hidden=net.phase!=='ready';
    const others=r.roster.filter(p=>p.ready && p.device!==d.me?.device);
    const target=$('gameTarget'),optionsKey=JSON.stringify(others.map(p=>[p.name,p.device]));
    if(target.dataset.key!==optionsKey){
      const previous=target.value;target.dataset.key=optionsKey;
      target.replaceChildren(...others.map(p=>new Option(p.name,p.device)));
      if(others.some(p=>p.device===previous))target.value=previous;
    }
    $('gamePath').hidden=net.phase!=='ready'||!others.length;
    const check=net.path||{}, waiting=check.state==='testing', chosen=target.value===check.device;
    $('gameTestPath').disabled=!['idle','ok','timeout','error','unavailable','peer-unavailable','port-compatibility'].includes(check.state);
    const messages={testing:'Проверяем путь между адаптерами…',ok:'Ответ от игрового адаптера получен',timeout:'Ответ не пришёл. Сверьте версии LINK и состояние игровой сети у обоих.',error:'Связь с участником изменилась. Повторите проверку.','peer-unavailable':'У участника недоступна проверка UDP. Попросите его повторить проверку на своём ПК.','port-compatibility':'Ответ на проверку с запасного порта не пришёл. Обновите LINK у игроков и организатора сети.'};
    const bindErrors={EADDRINUSE:'Диагностические порты заняты. Закройте использующее их приложение и повторите проверку.',
      EACCES:'Windows отклонила привязку диагностического порта. Повторите проверку.',
      EADDRNOTAVAIL:'Адрес игрового адаптера пока недоступен. Повторите проверку.'};
    $('gamePathResult').textContent=check.state==='unavailable'?tr(bindErrors[check.code]||'Не удалось открыть диагностический сокет игрового адаптера.'):
      check.state==='binding'?tr('Ждём адрес игрового адаптера…'):chosen && messages[check.state]?tr(messages[check.state])+(check.state==='ok'?' · '+check.ms+tr(' мс'):''):'';
    target.disabled=waiting;$('ueJoin').hidden=!others.length;
    const counts=net.traffic||{};
    const match=counts.lastMatch;
    const selected=others.find(p=>p.device===target.value);
    const found=selected&&selected.slot===match?.seat;
    const portInput=$('gameLaunchPort'),portKeyAuto=JSON.stringify([r.id,selected?.slot,found?match.port:null]);
    if(portInput.dataset.auto!==portKeyAuto){portInput.dataset.auto=portKeyAuto;portInput.value=found?match.port:7777;}
    $('gameSearchStatus').textContent=match?tr('Обнаруженный игровой сервер')+' · '+r.prefix+'.'+match.seat+':'+match.port:
      counts.matchedRx?tr('Ответ на поиск передан игровому адаптеру.'):
      counts.answersTx?tr('Ваша игра ответила на поиск участников.'):
      counts.queriesTx?tr('Игра ищет матчи. Ожидаем ответ сервера.'):'';
    $('ueTraffic').textContent=tr('Игровые пакеты')+' · '+tr('с этого ПК')+' '+(counts.tx||0)+' · '+tr('от участников')+' '+(counts.rx||0);
    if(counts.queriesTx||counts.queriesRx||counts.answersTx||counts.answersRx){
      $('ueTraffic').textContent+=' · '+tr('Поиск матчей')+' ↑'+counts.queriesTx+' ↓'+counts.queriesRx+
        ' · '+tr('Ответы игры на поиск')+' ↑'+counts.answersTx+' ↓'+counts.answersRx;
    }
    const ports=$('gamePorts'),portKey=JSON.stringify([r.id,net.ports]);
    if(ports.dataset.saved!==portKey){ports.dataset.saved=portKey;ports.value=net.ports||'';}
    ports.disabled=!!r.waiting;
    $('gameEosPorts').disabled=ports.disabled;
    $('gameActivate').disabled=r.waiting;
    $('gameActivate').textContent=tr(net.phase==='ready'?'Отключить игровую сеть':net.phase==='starting'?'Отменить включение':net.reason==='stale'?'Восстановить подключение':net.error?'Повторить попытку':'Включить игровую сеть Windows');
    $('gameStatus').textContent=net.error||tr(r.waiting?'Ждём подтверждения создателя…':net.phase==='starting'?'Ожидаем включения адаптера Windows…':net.phase==='ready'?'Теперь можно открыть список LAN-серверов в игре.':'Чат доступен. Для игры включите адаптер и подтвердите запрос Windows.');
    const roster=$('gameRoster'),key=JSON.stringify([r.prefix,r.roster,likeness]);
    if(roster.dataset.key!==key){
      roster.dataset.key=key;roster.replaceChildren(...r.roster.map(p=>{
        const row=element('div','','roster-row'),ip=r.prefix+'.'+p.slot;
        const avatar=element('span','','roster-avatar');
        paintAvatar(avatar,p.name,p.id===d.me?.id?d.me.avatar:contacts.get(p.id)?.avatar);
        row.dataset.ready=String(!!p.ready);
        const label=element('div','','roster-person'),title=p.name+(d.me?.device===p.device?tr(' · вы'):'');
        label.append(element('strong',title),element('small',tr(p.ready?'В игровой сети':'В чате'),'roster-meta'));
        row.append(avatar,label);
        if(p.ready){
          const copy=button(ip,async()=>{try{await api.copyText(ip);copy.textContent=tr('Скопировано');setTimeout(()=>{if(copy.isConnected)copy.textContent=ip;},1400);}catch(e){actionError(e);}});
          copy.title=tr('Скопировать IP');copy.setAttribute('aria-label',tr('Скопировать IP')+' '+ip);row.append(copy);
        }
        return row;
      }));
    }
    const available=friends.filter(c=>!r.roster.some(p=>p.id===c.id)&&!(g.invited||[]).includes(c.id));
    $('gameInviteBox').hidden=!r.host||r.roster.length>=17||!available.length;
    $('gameInviteHint').hidden=!r.host||r.roster.length>=17||!!available.length||(!g.invited?.length && friends.some(c=>r.roster.some(p=>p.id===c.id)));
    $('gameInviteHint').textContent=tr(g.invited?.length?'Приглашение отправлено. Ждём ответа.':'Когда друзья будут в сети, вы сможете их пригласить.');
    const select=$('gameFriend'),previous=select.value;
    const options=JSON.stringify(available.map(c=>[c.id,c.name]));
    if(select.dataset.options!==options){
      select.dataset.options=options;select.replaceChildren(...available.map(c=>new Option(c.name,c.id)));
      if(available.some(c=>c.id===previous))select.value=previous;
      if(!available.length)select.add(new Option(tr('Нет доступных друзей'),''));
    }
    $('gameSendInvite').disabled=!available.length;
    const chatKey=JSON.stringify([r.id,r.messages]);
    if(history.dataset.key!==chatKey){
      history.dataset.key=chatKey;
      chat.replace(r.messages.map(m=>({id:m.id,author:m.name,time:m.time,text:m.text||m.attachment?.name||'',attachment:m.attachment,own:!!m.device&&m.device===d.me?.device})));
      attachments.reconcile();
    }
    chat.setEnabled(!r.waiting);
    const canAttach=r.canShareFiles===true&&!r.waiting&&!$('strictProxy').checked;
    tools(canAttach);
    $('gameFileHint').hidden=canAttach||r.waiting;
    if(!canAttach)composer.clearFor('lan');
    $('gameAttach').hidden=!!r.waiting;
    $('gameEmoji').hidden=!!r.waiting;$('gameClearChat').hidden=!r.messages.length&&!r.hasDownloads;
  }
  return {draw};
}
