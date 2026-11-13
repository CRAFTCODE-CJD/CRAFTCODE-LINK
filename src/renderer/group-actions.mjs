import {tr} from './locale.mjs';
import {groupAppearance} from './group-appearance.mjs';

export function make(tag,text,cls) {
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(text)el.textContent=text;
  return el;
}
export const roleName=role=>tr(role==='owner'?'Владелец':role==='admin'?'Администратор':'Участник');
function personLabel(person,people){
  return people.some(other=>other.id!==person.id && other.name===person.name) ? person.name+' · '+person.id.slice(-8) : person.name;
}
function groupNameError(value){
  if(!value.trim())return tr('Введите название группы.');
  if(value.length>60)return tr('Название группы должно быть не длиннее 60 символов.');
  if(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(value))return tr('Уберите управляющие символы из названия.');
  return '';
}

export function groupActions({$,context,command,confirmAction,selectGroup,showParticipant,onError}) {
  const appearance=groupAppearance({$,context,command});
  const editor=$('groupEdit'),manager=$('groupManage'),body=$('groupManageBody');
  let submit=null,kind='',last='',working=false,targetChannel=null,editorState=null,membersQuery='';
  const safe=fn=>()=>Promise.resolve().then(fn).catch(onError);
  function action(parent,title,fn,{disabled=false,danger=false}={}) {
    const btn=make('button',tr(title),'group-action'+(danger?' danger':''));
    btn.type='button';btn.disabled=disabled;btn.onclick=safe(fn);parent.append(btn);return btn;
  }
  function refreshEditor(){
    if(!editorState || !editor.open)return;
    const current=context();
    if(current.owner!==editorState.owner || current.id!==editorState.id){if(!working)editor.close();return;}
    const reason=editorState.unavailable?.()||'';
    $('groupEditSubmit').disabled=working||!!reason;
    if(reason){$('groupEditError').textContent=reason;$('groupEditError').hidden=false;$('groupEditError').dataset.unavailable='true';}
    else if($('groupEditError').dataset.unavailable){delete $('groupEditError').dataset.unavailable;$('groupEditError').hidden=true;}
  }
  function editorFor(title,caption,fields,apply,unavailable) {
    if(editor.open)return;
    const {owner,id}=context(),nodes={};
    editorState={owner,id,unavailable};
    $('groupEditTitle').textContent=tr(title);$('groupEditSubmit').textContent=tr(caption);
    $('groupEditError').hidden=true;delete $('groupEditError').dataset.unavailable;$('groupFields').replaceChildren();
    for(const f of fields){
      const field=make('div','','field'),label=make('label',tr(f.label)),input=make(f.checks?'div':f.options?'select':'input');
      input.id='groupField-'+f.key;label.htmlFor=input.id;field.append(label,input);
      if(f.options)for(const [value,name] of f.options)input.add(new Option(name,value));
      if(f.checks){
        input.className='group-allow';input.setAttribute('role','group');input.setAttribute('aria-label',tr(f.label));
        for(const m of f.checks){const line=make('label','','check-line'),check=make('input');check.type='checkbox';check.value=m.id;check.checked=f.value?.includes(m.id)===true;line.append(check,document.createTextNode(' '+personLabel(m,f.checks)));input.append(line);}
      }else{
        if(!f.options){input.type='text';input.maxLength=f.max||48;input.autocomplete='off';}
        input.required=true;if(f.value!=null)input.value=f.value;
      }
      if(f.hint){
        const hint=make('small',tr(f.hint),'group-meta');hint.id=input.id+'-hint';input.setAttribute('aria-describedby',hint.id);field.append(hint);
      }
      if(f.validate){
        const validate=()=>input.setCustomValidity(f.validate(input.value));
        input.addEventListener('input',validate);validate();
      }
      nodes[f.key]=input;$('groupFields').append(field);
    }
    if(nodes.allow && nodes.access){
      const show=()=>{nodes.allow.parentElement.hidden=nodes.access.value!=='staff'||!nodes.allow.childElementCount;};
      nodes.access.onchange=show;show();
    }
    if(nodes.device && nodes.what){
      const show=()=>{nodes.device.disabled=nodes.what.value!=='transfer';nodes.device.parentElement.hidden=nodes.device.disabled;};
      nodes.what.onchange=show;show();
    }
    submit=async()=>{
      const current=context();
      if(current.owner!==owner || current.id!==id)throw Error(tr('Группа изменилась. Откройте действие снова.'));
      const reason=unavailable?.();if(reason)throw Error(reason);
      for(const f of fields)if(f.validate){const message=f.validate(nodes[f.key].value);if(message)throw Error(message);}
      const values=Object.fromEntries(Object.entries(nodes).map(([key,el])=>[key,
        el.classList.contains('group-allow') ? [...el.querySelectorAll(':checked')].map(n=>n.value) : el.value.trim()]));
      await apply(values);
    };
    editor.showModal();refreshEditor();const first=$('groupFields').querySelector('input,select');first?.focus();if(first?.type==='text')first.select();
  }
  $('groupEditForm').onsubmit=async e=>{
    e.preventDefault();refreshEditor();if(!submit||working||$('groupEditSubmit').disabled)return;
    working=true;$('groupEditSubmit').disabled=true;$('groupEditError').hidden=true;
    try{await submit();if(editor.open)editor.close();}catch(err){
      if(editor.open){$('groupEditError').textContent=String(err?.message||err).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');$('groupEditError').hidden=false;}else onError(err);
    }finally{working=false;$('groupEditSubmit').disabled=false;refreshEditor();}
  };
  for(const id of ['groupEditCancel','groupEditClose'])$(id).onclick=()=>{if(!working)editor.close();};
  editor.oncancel=e=>{if(working)e.preventDefault();};
  editor.onclose=()=>{submit=null;editorState=null;$('groupFields').replaceChildren();};
  $('groupManageClose').onclick=()=>manager.close();
  manager.onclose=()=>{kind='';last='';membersQuery='';body.replaceChildren();};
  async function confirm(title,subject,caption,fn,danger=false) {
    const {owner,id}=context();
    if(await confirmAction(tr(title),subject,tr(caption),danger) && context().owner===owner && context().id===id)await fn();
  }
  function panel(type,channelId=null){
    kind=type;targetChannel=channelId;last='';refresh();
    if(!manager.open)manager.showModal();
  }
  function channelFields(group,channel) {
    return [{key:'access',label:'Кому доступен канал',value:channel?.access||'all',
      options:[['all',tr('Всем участникам')],['staff',tr('Администраторам и выбранным участникам')]]},
      {key:'allow',label:'Дополнительные участники',checks:group.members.filter(m=>m.role==='member'),value:channel?.allow||[]}];
  }
  function create(){
    editorFor('Создать группу','Создать',[{key:'name',label:'Название группы',max:60,validate:groupNameError,hint:'До 60 символов. Название видно всем участникам.'}],async ({name})=>{
      const result=await command('group-create',{name});if(result?.id)selectGroup(result.id);
    });
  }
  function renameUnavailable(){
    const {group,online}=context();
    if(!group || !['owner','admin'].includes(group.role))return tr('Нет доступа к этому действию.');
    if(!online)return tr('Сервер группы недоступен.');
    if(group.transferring)return tr('Идёт передача группы.');
    if(group.renameVersion!==1)return tr('Обновите LINK на компьютере владельца, чтобы переименовать группу.');
    return '';
  }
  function rename(){
    if(renameUnavailable())return;
    const {group,id,owner}=context();
    editorFor('Переименовать группу','Сохранить',[
      {key:'name',label:'Название группы',max:60,value:group.name,validate:groupNameError,hint:'До 60 символов. Название видно всем участникам.'}
    ],({name})=>command('group-rename',{id,profileId:owner,name}),renameUnavailable);
  }
  function addChannel(){
    const {group,id}=context();if(!group)return;
    editorFor('Создать канал','Создать',[{key:'name',label:'Название канала'},
      {key:'type',label:'Тип канала',options:[['text',tr('Текстовый канал')],['voice',tr('Голосовой канал')]]},...channelFields(group)],
      async ({name,type,access,allow})=>{const result=await command('group-channel-create',{id,name,type,access,allow:access==='staff'?allow:[]});if(result?.id)selectGroup(id,result.id);});
  }
  function invite(){
    const {group,id,friends}=context(), members=new Set(group.members.map(m=>m.id));
    const eligible=friends.filter(f=>f.state==='friend' && !members.has(f.id));
    const options=eligible.map(f=>[f.id,personLabel(f,eligible)]);
    if(!options.length)throw Error(tr('Добавьте друга по карточке, чтобы пригласить его в группу.'));
    editorFor('Пригласить друга','Пригласить',[{key:'person',label:'Друг',options}],({person})=>command('group-invite',{id,person}));
  }
  function memberAction(group,m){
    const {id}=context(), owner=group.role==='owner', lower=m.role==='member'||owner&&m.role==='admin';
    const name=personLabel(m,group.members);
    const possible=[];
    if(owner && m.role!=='owner')possible.push([m.role==='admin'?'demote':'promote',tr(m.role==='admin'?'Снять роль администратора':'Назначить администратором')]);
    if(lower && group.role!=='member')possible.push(['kick',tr('Удалить из группы')],['ban',tr('Заблокировать в группе')]);
    const devices=m.onlineDevices || [];
    if(owner && m.role==='admin' && (!Array.isArray(m.onlineDevices)||devices.length))possible.push(['transfer',tr('Передать владение группой')]);
    const fields=[{key:'what',label:name,options:possible}];
    if(devices.length>1)fields.push({key:'device',label:'Устройство нового владельца',options:devices.map(d=>[d,tr('Устройство')+' · '+d.slice(-10)])});
    editorFor('Действия с участником','Продолжить',fields,async ({what,device})=>{
      const label=possible.find(([op])=>op===what)[1];
      if(what==='transfer')return confirm('Передать владение группой?',name+' · '+tr('Новый владелец должен принять передачу на своём устройстве.'),'Предложить передачу',()=>{
        const target=device||devices[0];return command('group-transfer',{id,person:m.id,...(target?{device:target}:{})});
      },true);
      return confirm(label,name,label,()=>what==='kick'||what==='ban'?command('group-'+what,{id,person:m.id}):
        command('group-role',{id,person:m.id,role:what==='demote'?'member':'admin'}),true);
    });
  }
  function refresh() {
    appearance.refresh();
    refreshEditor();
    if(!kind)return;
    const {group,id,channel:selected,owner,online,friends}=context();
    if(!group){close();return;}
    const channel=kind==='channel'?group.channels.find(c=>c.id===targetChannel):selected;
    if(kind==='channel'&&(!channel||group.role==='member')){close();return;}
    const key=JSON.stringify([kind,id,group.name,group.renameVersion,channel?.id,channel?.name,channel?.access,group.members,group.bans,group.transferring,group.role,online,friends.map(f=>[f.id,f.state])]);
    if(key===last)return;last=key;
    const oldAction=document.activeElement?.dataset.groupMember;
    const oldSearch=document.activeElement?.id==='groupMemberSearch'?{start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null;
    body.replaceChildren();$('groupManageTitle').textContent=kind==='channel'?channel.name:tr(kind==='members'?'Участники':'Действия группы');
    const can=group.role==='admin'||group.role==='owner',locked=!online||!!group.transferring;
    function item(title,fn,isLocked=locked,danger=false){return action(body,title,fn,{disabled:isLocked,danger});}
    if(kind==='members'){
      if(can)item('Пригласить друга',invite);
      const field=make('div','','field'),searchLabel=make('label',tr('Найти участника')),search=make('input'),counter=make('small','','group-meta');
      search.id='groupMemberSearch';search.type='search';search.autocomplete='off';search.maxLength=80;search.value=membersQuery;
      searchLabel.htmlFor=search.id;counter.setAttribute('role','status');counter.setAttribute('aria-live','polite');field.append(searchLabel,search,counter);body.append(field);
      const memberRows=[];
      for(const m of group.members){
        const row=make('div','','group-member'),meta=make(m.id===owner?'div':'button','','group-member-info');
        const name=personLabel(m,group.members);
        if(m.id!==owner){
          meta.type='button';meta.setAttribute('aria-label',tr('Карточка участника')+' · '+name);
          meta.onclick=()=>{close();showParticipant(m,()=>context().id===id&&context().group?.members.some(p=>p.id===m.id));};
        }
        meta.append(make('strong',name),make('small',roleName(m.role)+(m.id===owner?' · '+tr('Вы'):''),'group-meta'));row.append(meta);
        if(can && m.id!==owner && (m.role==='member' || group.role==='owner'&&m.role==='admin')){
          const btn=make('button','•••','icon-button');btn.type='button';btn.setAttribute('aria-label',tr('Действия с участником')+' · '+name);
          btn.dataset.groupMember=m.id;btn.disabled=locked;btn.onclick=safe(()=>memberAction(group,m));row.append(btn);
        }
        body.append(row);memberRows.push({row,person:m});
      }
      const noMatches=make('p',tr('Участники не найдены.'),'group-meta');body.append(noMatches);
      const normalize=value=>String(value).normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е');
      const filterMembers=()=>{
        membersQuery=search.value;
        const tokens=normalize(membersQuery).trim().split(/\s+/).filter(Boolean);let count=0;
        for(const {row,person} of memberRows){
          const haystack=normalize(person.name+' '+person.id);row.hidden=!tokens.every(token=>haystack.includes(token));if(!row.hidden)count++;
        }
        counter.textContent=tr('Найдено участников')+': '+count+' / '+memberRows.length;noMatches.hidden=count>0;
      };
      search.addEventListener('input',filterMembers);filterMembers();
      if(oldSearch){search.focus({preventScroll:true});search.setSelectionRange(oldSearch.start,oldSearch.end);}
      if(can && group.bans?.length){
        body.append(make('h3',tr('Заблокированные участники')));
        for(const m of group.bans){
          const row=make('div','','group-member');
          row.append(make('span',m.name||m.id,'group-member-info'));
          const b=make('button',tr('Разблокировать'),'button button-secondary');b.type='button';b.disabled=locked;
          b.onclick=safe(()=>command('group-unban',{id,person:m.id}));row.append(b);body.append(row);
        }
      }
    }else{
      if(can&&kind==='options'){
        const reason=renameUnavailable(),renameAction=item('Переименовать группу',rename,!!reason);renameAction.title=reason;
        if(group.appearanceVersion===1)item('Оформление группы',appearance.open);
        item('Пригласить друга',invite);item('Создать канал',addChannel);
      }
      if(can && channel){
        item('Переименовать канал',()=>editorFor('Переименовать канал','Сохранить',[{key:'name',label:'Название канала',value:channel.name}],
          ({name})=>command('group-channel-rename',{id,channel:channel.id,name})));
        item('Доступ к каналу',()=>editorFor('Доступ к каналу','Сохранить',channelFields(group,channel),
          ({access,allow})=>command('group-channel-access',{id,channel:channel.id,access,allow:access==='staff'?allow:[]})));
        if(channel.type==='text')item('Очистить историю канала',()=>confirm('Очистить историю у всех участников?',channel.name,'Очистить историю канала',()=>command('group-clear',{id,channel:channel.id}),true),locked,true);
        item('Удалить канал',()=>confirm('Удалить канал?',channel.name,'Удалить канал',()=>command('group-channel-delete',{id,channel:channel.id}),true),locked,true);
      }
      if(kind==='options'&&group.role==='owner'){
        if(group.transferring)item('Отменить передачу владения',()=>command('group-transfer-cancel',{id}),!online);
        item('Удалить группу',()=>confirm('Удалить группу для всех?',group.name,'Удалить группу',()=>command('group-delete',{id}),true),locked,true);
      }else if(kind==='options')item('Выйти из группы',()=>confirm('Выйти из группы?',group.name,'Выйти из группы',()=>command('group-leave',{id}),true),locked,true);
    }
    if(oldAction)for(const b of body.querySelectorAll('[data-group-member]'))if(b.dataset.groupMember===oldAction)b.focus({preventScroll:true});
  }
  function close(){appearance.close();if(editor.open)editor.close();if(manager.open)manager.close();kind='';last='';}
  function manageMember(person){
    const {group,owner,online}=context(),m=group?.members.find(row=>row.id===person);
    if(!m||owner===person||!online||group.transferring||group.role==='member'||m.role==='owner'||group.role==='admin'&&m.role==='admin')return;
    memberAction(group,m);
  }
  return {create,addChannel,refresh,close,manageMember,members:()=>panel('members'),options:()=>panel('options'),channel:id=>panel('channel',id)};
}
