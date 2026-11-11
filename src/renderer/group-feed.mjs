import {tr,language} from './locale.mjs';
import {paintAvatar} from './profile-appearance.mjs';
import {contactStatusLabel} from './contact-list.mjs';

const roles=[['owner','Владелец'],['admin','Администраторы'],['member','Участники']];
const collator=new Intl.Collator(language,{sensitivity:'base',numeric:true});
function node(tag,className,text){
  const el=document.createElement(tag);
  if(className)el.className=className;
  if(text)el.textContent=text;
  return el;
}

export function groupFeed({$,openChat,showParticipant,manageMember}){
  const roster=$('groupRoster'),toggle=$('groupRosterToggle'),content=$('groupContent');
  let show=false,wide=false,people=new Map(),data=null,space=null;
  let previous='',wideChoice=true,narrowChoice=false;
  function layout(){
    const open=show&&(wide?wideChoice:narrowChoice);
    toggle.hidden=!show;roster.hidden=!open;
    content.classList.toggle('with-member-list',!!open);
    content.classList.toggle('compact-members',!wide);
    toggle.setAttribute('aria-expanded',String(!!open));
    toggle.setAttribute('aria-pressed',String(!!open));
  }
  function showPerson(person,context=false){
    const group=space?.id;
    const current=()=>show&&space?.id===group&&space.members.some(m=>m.id===person.id);
    if(!current()||person.id===data.me.id)return;
    const canManage=space.role==='owner'&&person.role!=='owner'||space.role==='admin'&&person.role==='member';
    if(!context&&!canManage&&people.has(person.id)){openChat(person.id);return;}
    showParticipant(person,current,canManage?()=>manageMember(person.id):null);
  }
  toggle.onclick=()=>{
    if(wide)wideChoice=!wideChoice;else narrowChoice=!narrowChoice;
    layout();
  };
  const observer=new ResizeObserver(([entry])=>{
    if(!entry.contentRect.width)return;
    wide=entry.contentRect.width>=750;layout();
  });
  observer.observe(content);
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&show&&!wide&&narrowChoice&&!document.querySelector('dialog[open]')){
      e.preventDefault();narrowChoice=false;layout();toggle.focus();
    }
  });
  function members(group,snapshot,visible){
    if(group?.id!==space?.id||!visible)narrowChoice=false;
    space=group;data=snapshot;show=!!(group&&visible);
    people=new Map((data?.friends||[]).filter(f=>f.state==='friend').map(f=>[f.id,f]));
    layout();
    if(!show){previous='';roster.replaceChildren();return;}
    const live=new Set(Object.values(group.voiceRooms||{}).flat().map(seat=>seat.id));
    const identity=m=>m.id===data.me.id?data.me:people.get(m.id);
    const status=m=>m.id===data.me.id ? (data.privacy?.status==='invisible'?'offline':data.privacy?.status||'online') :
      people.get(m.id)?.online ? people.get(m.id).status||'online' : live.has(m.id)?'online':identity(m)?'offline':'unknown';
    const key=JSON.stringify([group.id,group.role,data.me.id,group.members.map(m=>[m.id,m.role,m.name,status(m),identity(m)?.avatar])]);
    if(previous===key)return;
    previous=key;const focused=roster.contains(document.activeElement)?document.activeElement?.dataset.person:null;
    const fragment=document.createDocumentFragment();
    for(const [role,title] of roles){
      const persons=group.members.filter(m=>m.role===role).sort((a,b)=>collator.compare(a.name,b.name));
      if(!persons.length)continue;
      const section=node('section','feed-role');
      const heading=node('h3','',tr(title));heading.append(node('span','role-count',String(persons.length)));section.append(heading);
      for(const m of persons){
        const canAct=m.id!==data.me.id;
        const row=node(canAct?'button':'div','feed-member');
        row.dataset.person=m.id;
        if(canAct){row.type='button';row.onclick=()=>showPerson(m);
          row.oncontextmenu=e=>{e.preventDefault();showPerson(m,true);};
          row.onkeydown=e=>{if(e.key==='ContextMenu'||e.key==='F10'&&e.shiftKey){e.preventDefault();showPerson(m,true);}};
        }
        const holder=node('span','feed-member-portrait'),avatar=node('span','feed-avatar');
        paintAvatar(avatar,m.name,identity(m)?.avatar);holder.append(avatar);
        const presence=status(m);
        if(presence!=='unknown'){
          const badge=node('i','feed-presence '+presence);
          badge.title=contactStatusLabel({online:presence!=='offline',status:presence});holder.append(badge);
        }
        row.append(holder,node('span','feed-member-name',m.name));
        if(m.id===data.me.id)row.append(node('small','',tr('Вы')));
        section.append(row);
      }
      fragment.append(section);
    }
    roster.replaceChildren(fragment);
    if(focused)[...roster.querySelectorAll('button')].find(el=>el.dataset.person===focused)?.focus({preventScroll:true});
  }
  function messages(chat,items,group,snapshot){
    const contacts=new Map((snapshot.friends||[]).filter(p=>p.state==='friend').map(p=>[p.id,p]));
    const mapped=items.map(m=>({id:m.id,person:m.person,author:m.name||group.members.find(p=>p.id===m.person)?.name,
      time:m.at,text:m.text,own:m.person===snapshot.me.id,file:m.file}));
    chat.replace(mapped);chat.refresh();
    let last;
    const cards=$('groupLog').querySelectorAll(':scope > article');
    for(let i=0;i<cards.length;i++){
      const card=cards[i],m=mapped[i];if(!m)continue;
      const follow=last?.person===m.person&&card.previousElementSibling?.matches('article')&&m.time>=last.time&&m.time-last.time<300000;
      card.classList.toggle('feed-followup',!!follow);
      let avatar=card.querySelector(':scope > .feed-avatar');
      if(!avatar){avatar=node('span','feed-avatar');card.prepend(avatar);}
      paintAvatar(avatar,m.author,m.own?snapshot.me.avatar:contacts.get(m.person)?.avatar);
      last=m;
    }
  }
  return {members,messages};
}
