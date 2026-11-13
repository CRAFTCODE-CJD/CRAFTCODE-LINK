'use strict';
const {randomUUID,createHash}=require('node:crypto'),{tr}=require('../native-language.cjs');
const {validPixels}=require('../direct/avatars.cjs');
const extendedThemes=new Map([['cobalt','default'],['terracotta','dusk'],['paper','light']]);
const themes=new Set(['personal','default','light','dusk','forest',...extendedThemes.keys()]);
const avatarKey=pixels=>createHash('sha256').update(pixels,'ascii').digest('hex');
const uuid=v=>typeof v==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const key=v=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
const denied=()=>Error(tr('Нет доступа к этому действию.'));
const invalid=()=>Error(tr('Некорректная команда.'));
const full=()=>Error(tr('Достигнут лимит группы.'));
const roles=['member','admin','owner'];
const staff=m=>m && (m.role==='owner'||m.role==='admin');
const member=(g,id)=>g.members.find(m=>m.id===id);
function label(v,max=60){
  if(typeof v!=='string'||v.length>max||/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(v)||!v.trim())throw invalid();
  return v.trim();
}
function create(name,card){
  const text={id:randomUUID(),name:tr('общий'),type:'text',access:'all',allow:[]};
  const voice={id:randomUUID(),name:tr('Голосовой'),type:'voice',access:'all',allow:[]};
  return {id:randomUUID(),name:label(name),owner:card.id,device:card.device,epoch:1,revision:1,
    members:[{id:card.id,name:card.name,role:'owner'}],channels:[text,voice],messages:{},bans:[],invites:[]};
}
function access(g,channel,person,type){
  const m=member(g,person),c=g.channels.find(c=>c.id===channel);
  return !!(m&&c&&(!type||type===c.type)&&(staff(m)||c.access==='all'||c.allow.includes(person)));
}
function project(g,person){
  const m=member(g,person);if(!m)throw denied();
  if(g.theme!==undefined&&!themes.has(g.theme)||g.avatar!=null&&!validPixels(g.avatar))throw invalid();
  return {id:g.id,name:g.name,owner:g.owner,device:g.device,epoch:g.epoch,revision:g.revision,role:m.role,appearanceVersion:1,paletteVersion:1,renameVersion:1,
    ...(g.theme&&g.theme!=='personal'?{theme:g.theme}:{}),...(g.avatar?{avatarKey:avatarKey(g.avatar)}:{}),
    members:g.members,channels:g.channels.filter(c=>access(g,c.id,person)).map(c=>staff(m)?c:{...c,allow:c.allow.includes(person)?[person]:[]}),
    bans:staff(m)?g.bans:[]};
}
function acl(g,args){
  const allow=args.allow??[];
  if(!['all','staff'].includes(args.access)||!Array.isArray(allow)||allow.length>32||allow.some(id=>!key(id)||!member(g,id)))throw invalid();
  return {access:args.access,allow:[...new Set(allow)]};
}
function rows(g,channel){return g.messages[channel]||[];}
function append(g,channel,person,nonce,text,file,now=Date.now()){
  const m=member(g,person);
  if(!access(g,channel,person,'text'))throw denied();
  if(!uuid(nonce))throw invalid();
  const messages=g.messages[channel]??=[];
  const repeated=messages.find(row=>row.person===person && row.nonce===nonce);
  if(repeated)return {id:repeated.id};
  if(typeof text!=='string'||!file&&!text.trim()||text.length>1200||Buffer.byteLength(text)>3600)throw invalid();
  const row={id:randomUUID(),nonce,at:now,person,name:m.name,text:text.trim(),...(file?{file}:{})};
  messages.push(row);
  // Never evict a file silently while it is being handed over. The owner can
  // clear a channel to reclaim room for additional messages.
  if(messages.length>500||Buffer.byteLength(JSON.stringify(g.messages))>2*1024*1024)throw full();
  return {id:row.id};
}
function page(g,channel,person,before){
  if(!access(g,channel,person,'text'))throw denied();
  const all=rows(g,channel);const end=before?all.findIndex(r=>r.id===before):all.length;
  if(end<0)throw invalid();
  let bytes=0,start=end;
  while(start>0 && end-start<40){
    const size=Buffer.byteLength(JSON.stringify(all[start-1]));
    if(bytes+size>26000)break;bytes+=size;start--;
  }
  return {messages:all.slice(start,end).map(({nonce,...row})=>row),more:start>0};
}
function removeMember(g,id){
  g.members=g.members.filter(m=>m.id!==id);g.invites=g.invites.filter(v=>v.id!==id);
  for(const c of g.channels)c.allow=c.allow.filter(x=>x!==id);
}
function change(g,person,action,a,friend){
  const me=member(g,person);
  if(action==='join'){
    if(me)return {id:g.id};
    if(!g.invites.some(v=>v.id===person&&v.until>Date.now())||g.bans.some(b=>b.id===person)||!friend(person))throw denied();
    if(g.members.length>=32)throw full();
    g.invites=g.invites.filter(i=>i.id!==person);g.members.push({id:person,name:friend(person).name,role:'member'});return {id:g.id};
  }
  if(!me)throw denied();
  if(action==='send')return append(g,a.channel,person,a.nonce,a.text);
  if(action==='leave'){
    if(me.role==='owner')throw denied();removeMember(g,person);return true;
  }
  if(!staff(me))throw denied();
  const target=member(g,a.person);
  switch(action){
    case 'rename':
      if(Object.keys(a).length!==1 || !Object.hasOwn(a,'name'))throw invalid();
      g.name=label(a.name);return true;
    case 'appearance':{
      if(!Object.keys(a).length||Object.keys(a).some(k=>k!=='theme'&&k!=='avatar'))throw invalid();
      if(Object.hasOwn(a,'theme')&&!themes.has(a.theme)||Object.hasOwn(a,'avatar')&&a.avatar!==null&&!validPixels(a.avatar))throw invalid();
      if(Object.hasOwn(a,'theme'))g.theme=a.theme;
      if(Object.hasOwn(a,'avatar'))g.avatar=a.avatar;
      return true;
    }
    case 'invite':{
      if(!key(a.person)||!friend(a.person)||target||g.bans.some(b=>b.id===a.person))throw denied();
      g.invites=g.invites.filter(i=>i.id!==a.person&&i.until>Date.now());
      if(g.invites.length>=32||g.members.length>=32)throw full();
      g.invites.push({id:a.person,until:Date.now()+7*86400000});return true;
    }
    case 'role':
      if(me.role!=='owner'||!target||target.role==='owner'||!['admin','member'].includes(a.role))throw denied();
      target.role=a.role;return true;
    case 'ban':case 'kick':
      if(!target||roles.indexOf(target.role)>=roles.indexOf(me.role))throw denied();
      if(action==='ban'){if(g.bans.length>=64)throw full();g.bans.push({id:target.id,name:target.name});}
      removeMember(g,target.id);return true;
    case 'unban':
      if(!key(a.person))throw invalid();g.bans=g.bans.filter(b=>b.id!==a.person);return true;
    case 'channel-create':{
      if(g.channels.length>=24)throw full();if(!['text','voice'].includes(a.type))throw invalid();
      const c={id:randomUUID(),type:a.type,name:label(a.name,48),...acl(g,{...a,access:a.access||'all'})};
      g.channels.push(c);return {id:c.id};
    }
    case 'channel-access':case 'channel-rename':case 'channel-delete':case 'clear':{
      const c=g.channels.find(c=>c.id===a.channel);if(!c)throw denied();
      if(action==='channel-access')Object.assign(c,acl(g,a));
      if(action==='channel-rename')c.name=label(a.name,48);
      if(action==='channel-delete'){g.channels=g.channels.filter(row=>row!==c);delete g.messages[c.id];}
      if(action==='clear'){if(c.type!=='text')throw invalid();delete g.messages[c.id];}
      return true;
    }
    default:throw invalid();
  }
}
function validateView(v){
  if(!v || !uuid(v.id)||!key(v.owner)||!key(v.device)||!Number.isSafeInteger(v.epoch)||v.epoch<1||
    !Number.isSafeInteger(v.revision)||v.revision<1||!roles.includes(v.role)||!Array.isArray(v.members)||v.members.length>32||
    !Array.isArray(v.channels)||v.channels.length>24||!Array.isArray(v.bans)||v.bans.length>64)throw invalid();
  const {theme,avatarKey:badge,appearanceVersion,...base}=v;
  if(appearanceVersion!==undefined&&appearanceVersion!==1||v.paletteVersion!==undefined&&v.paletteVersion!==1||v.renameVersion!==undefined&&v.renameVersion!==1||theme!==undefined&&!themes.has(theme)||badge!==undefined&&!key(badge)||
    Object.hasOwn(v,'avatar')||Object.hasOwn(v,'avatarRev'))throw invalid();
  label(v.name);const people=new Set(),channels=new Set();
  for(const m of v.members){
    if(!key(m.id)||people.has(m.id)||!roles.includes(m.role)||(m.id===v.owner)!==(m.role==='owner'))throw invalid();
    people.add(m.id);label(m.name,80);
  }
  if(!people.has(v.owner))throw invalid();
  for(const c of v.channels){
    if(!uuid(c.id)||channels.has(c.id)||!['voice','text'].includes(c.type))throw invalid();
    channels.add(c.id);label(c.name,48);acl(v,c);
  }
  for(const b of v.bans){if(!key(b.id)||people.has(b.id))throw invalid();label(b.name,80);}
  if(Buffer.byteLength(JSON.stringify(base))>35000)throw full();
  return v;
}
module.exports={uuid,key,denied,invalid,full,roles,staff,member,label,create,access,project,append,page,change,removeMember,validateView,avatarKey,extendedThemes};
