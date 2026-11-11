import {tr} from './locale.mjs';
import {contactStatusLabel,selectContacts} from './contact-list.mjs';
import {paintAvatar} from './profile-appearance.mjs';
import {paintGroupMark} from './group-mark.mjs';
import {viewGroupTheme} from './theme.mjs';

const text = (tag, value, cls) => {
  const el=document.createElement(tag);
  el.textContent=value;
  if(cls)el.className=cls;
  return el;
};

export function workspaceShell({$,shell,openGroup,openPerson,refresh}) {
  const mobile=matchMedia('(max-width:880px)');
  let pane, lastGroups, lastFriends, drawer=false;
  const mic=$('micBtn'),deafen=$('deafenBtn'),dock=$('callControls');
  const micSlot=document.createComment('microphone'),deafenSlot=document.createComment('headphones');
  mic.before(micSlot);deafen.before(deafenSlot);
  const searches=['friendContextSearch','dmSearch'].map(id=>{
    const label=$(id).closest('label'),slot=document.createComment(id);
    label.before(slot);
    return {label,slot};
  });
  function closeDrawer(restore=false){
    if(!drawer)return;
    drawer=false;
    shell.classList.remove('context-open');
    $('contextScrim').hidden=true;
    $('contextToggle').setAttribute('aria-expanded','false');
    if(restore && mobile.matches)$('contextToggle').focus({preventScroll:true});
  }
  function openDrawer(){
    if(!mobile.matches||!pane)return;
    drawer=true;shell.classList.add('context-open');
    $('contextToggle').setAttribute('aria-expanded','true');
    $('contextScrim').hidden=false;
    const preferred=pane.querySelector('input[type="search"],[data-group-channel][aria-current="true"]');
    (preferred||pane.querySelector('button:not(:disabled),input,select'))?.focus({preventScroll:true});
  }
  $('contextToggle').onclick=()=>drawer?closeDrawer(true):openDrawer();
  $('contextScrim').onclick=()=>closeDrawer(true);
  document.addEventListener('keydown',event=>{
    if(!drawer||document.querySelector('dialog[open], :popover-open'))return;
    if(event.key==='Escape'){event.preventDefault();closeDrawer(true);return;}
    if(event.key==='Tab'){
      const controls=[...pane.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"],summary')].filter(el=>el.checkVisibility());
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
      if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  mobile.addEventListener('change',()=>{if(!mobile.matches)closeDrawer();refresh();});
  $('friendContextSearch').oninput=refresh;
  $('contextAddFriend').onclick=()=>$('linkFriends').click();
  function spaces(items,selected,local){
    const list=$('spaceList');
    const key=JSON.stringify([local,items.map(g=>[g.id,g.name,g.avatarRev]),selected]);
    if(key===lastGroups)return;
    lastGroups=key;
    const previous=document.activeElement?.dataset.spaceGroup;
    const nodes=items.map(g=>{
      const button=document.createElement('button'),mark=document.createElement('span');
      button.className='space-button group-shortcut';button.type='button';button.title=g.name;
      button.dataset.spaceGroup=g.id;button.setAttribute('aria-label',g.name);
      if(g.id===selected)button.setAttribute('aria-current','page');
      paintGroupMark(mark,g);button.append(mark);
      button.onclick=()=>{openGroup(g.id);if(mobile.matches)openDrawer();};
      return button;
    });
    list.replaceChildren(...nodes);
    if(previous)(nodes.find(n=>n.dataset.spaceGroup===previous)||$('navFriends')).focus({preventScroll:true});
  }
  function friends(people,identity){
    const query=$('friendContextSearch').value.trim();
    const items=selectContacts(people.filter(c=>c.state==='friend'),{query});
    const key=JSON.stringify([identity,query,items.map(c=>[c.id,c.name,c.online,c.status,c.avatarRev,c.chat?.unread])]);
    if(key===lastFriends)return;
    lastFriends=key;
    const active=document.activeElement?.closest('#quickPeople [data-person]')?.dataset.person;
    const rows=items.map(c=>{
      const row=document.createElement('button'),avatar=document.createElement('span'),copy=document.createElement('span');
      row.type='button';row.className='context-contact';row.dataset.person=c.id;
      avatar.className='dm-avatar';avatar.dataset.online=String(!!c.online);avatar.dataset.status=c.status||'';paintAvatar(avatar,c.name,c.avatar);
      copy.className='context-contact-label';
      copy.append(text('strong',c.name),text('small',contactStatusLabel(c)));
      row.append(avatar,copy);row.title=c.name+' · '+contactStatusLabel(c);
      if(c.chat?.unread)row.append(text('span',c.chat.unread>99?'99+':String(c.chat.unread),'dm-unread'));
      row.onclick=()=>{closeDrawer();openPerson(c.id);};
      return row;
    });
    $('quickPeople').replaceChildren(...rows);
    if(active)rows.find(row=>row.dataset.person===active)?.focus({preventScroll:true});
    $('friendContextEmpty').hidden=!!items.length;
    $('friendContextEmpty').textContent=tr(query?'Совпадений нет. Измените поиск или фильтр.':'Здесь появятся ваши друзья.');
  }
  function draw({view,group,items,session,cinema,contacts,identity,local}){
    const groupView=view==='groups'||(view==='room'&&!!session?.groupVoice);
    viewGroupTheme(groupView?items.find(g=>g.id===group)?.theme:null);
    const next=groupView?$('groupContext'):view==='chats'?$('dmContext'):$('friendsContext');
    if(pane!==next){closeDrawer();pane=next;}
    shell.dataset.scope=groupView?'group':'personal';shell.dataset.view=view;
    for(const panel of [$('friendsContext'),$('dmContext'),$('groupContext')]){
      if(panel)panel.hidden=panel!==next;
    }
    for(const {label,slot} of searches){
      const parent=!mobile.matches && next.contains(slot)?$('sidebarSearch'):slot.parentElement;
      if(label.parentElement!==parent){
        if(parent===slot.parentElement)slot.after(label);else parent.append(label);
      }
    }
    $('contextToggle').setAttribute('aria-controls',next?.id||'friendsContext');
    const caption=tr(groupView?'Каналы':view==='chats'?'Чаты':'Друзья');
    $('contextToggle').title=caption;$('contextToggle').setAttribute('aria-label',caption);
    spaces(items,groupView?group:null,local);
    if(!groupView && view!=='chats')friends(contacts,identity);
    $('homeDirectory').toggleAttribute('data-active',view==='friends');
    if(view==='friends')$('homeDirectory').setAttribute('aria-current','page');else $('homeDirectory').removeAttribute('aria-current');
    $('friendContextTitle').textContent=tr(local?'Личные сообщения':'Друзья');
    $('navFriends').toggleAttribute('data-home-active',!groupView);
    $('voiceDockStatus').hidden=!session;
    $('voiceQuickControls').hidden=!session;
    if(cinema){
      closeDrawer();
      if(mic.parentElement!==dock){micSlot.after(mic);deafenSlot.after(deafen);}
    }else if(mic.parentElement!==$('voiceQuickControls'))$('voiceQuickControls').append(mic,deafen);
  }
  return {draw,openDrawer,closeDrawer,compact:()=>mobile.matches};
}
