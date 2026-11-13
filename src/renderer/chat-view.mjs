import {language,tr} from './locale.mjs';
import {chatLinks} from './chat-links.mjs';
import {chatContext} from './chat-context.mjs';
import {appendChatText,singleEmoji} from './chat-glyphs.mjs';

const clock=new Intl.DateTimeFormat(language,{hour:'2-digit',minute:'2-digit'});
const dayAndTime=new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'});
const calendarDay=new Intl.DateTimeFormat(language,{dateStyle:'long'});
export {bindChatEmoji} from './chat-emoji.mjs';

export function chatTimestamp(time){
  const date=time==null?null:new Date(time);
  if(!date||!Number.isFinite(date.getTime()))return null;
  const stamp=document.createElement('time');stamp.className='link-chat-time chat-time';
  stamp.dataset.day=calendarDay.format(date);stamp.dateTime=date.toISOString();
  stamp.textContent=clock.format(date);stamp.title=dayAndTime.format(date);return stamp;
}

function messageCard({id,author,text,attachment,file,own=false,time,status},links){
  const card=document.createElement('article');
  card.tabIndex=0;
  card.className='link-chat-message chat-message'+(own?' is-own self':'');
  if(id!=null)card.dataset.id=String(id);
  if(author){
    const name=document.createElement('strong');
    name.className='link-chat-author chat-author';name.textContent=author;
    card.append(name);
  }
  const body=document.createElement('p');
  body.className='link-chat-body chat-body';
  if(attachment)appendChatText(body,text);
  if(!attachment&&!file&&text&&singleEmoji(text))card.classList.add('emoji-message');
  const preview=attachment?null:links.render(body,text||'');
  if(!attachment&&!file&&!preview)card.classList.add('text-message');
  card.append(body);
  if(preview)card.append(preview);
  const meta=document.createElement('footer');
  meta.className='link-chat-meta';
  const stamp=chatTimestamp(time);
  if(stamp){card.dataset.day=stamp.dataset.day;meta.append(stamp);}
  card.append(meta);
  if(own&&status)updateReceipt(meta,status);
  return card;
}
function updateReceipt(meta,status){
  const old=meta.querySelector('.link-chat-status');
  if(old?.dataset.state===status)return;
  if(['pending','delivered','read'].includes(status)){
    const label=document.createElement('span'),icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
    label.className='link-chat-status';label.dataset.state=status;
    const meaning=tr(status==='read'?'Прочитано':status==='delivered'?'Доставлено':'Ожидает доставки');
    label.setAttribute('role','img');label.setAttribute('aria-label',meaning);label.title=meaning;
    icon.setAttribute('viewBox','0 0 20 16');icon.setAttribute('aria-hidden','true');
    const path=document.createElementNS(icon.namespaceURI,'path');
    path.setAttribute('d',status==='pending'?'M16 8A6 6 0 1 1 4 8a6 6 0 1 1 12 0 M10 4.5v4l2.5 1.5':status==='read'?'M1 8l4 4L15 2 M9.5 10.5l1.5 1.5L20 3':'M3 8l4 4L17 2');
    icon.append(path);label.append(icon);
    const name=document.createElement('span');name.className='chat-accessible-label';name.textContent=meaning;label.append(name);
    if(old)old.replaceWith(label);else meta.append(label);
  }else old?.remove();
}

export function createChatView({log,input,form,send,onSend,maxLength=600,onError,empty,scroll=log,maxMessages=300,dayDividers=false,decorate,rowVersion,updateRow}){
  const events=new AbortController();
  const options={signal:events.signal};
  const links=chatLinks(log,onError,options);
  const context=chatContext(log,onError,options);
  const metadataSize=new ResizeObserver(entries=>{
    for(const {target} of entries)target.closest('article')?.style.setProperty('--chat-meta-width',Math.ceil(target.getBoundingClientRect().width)+'px');
  });
  function observeCard(card){const meta=card.querySelector('.link-chat-meta');if(meta)metadataSize.observe(meta);}
  function forgetCard(card){const meta=card.querySelector('.link-chat-meta');if(meta)metadataSize.unobserve(meta);}
  let cached=new Map();
  const blankDraft=()=>({text:'',clientId:null,pending:false});
  let draft=blankDraft();
  input.maxLength=maxLength;
  log.classList.add('link-chat-log');
  scroll.classList.add('chat-wallpaper');
  form.classList.add('link-chat-compose');
  const nearBottom=()=>scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop<72;
  const renderEmpty=()=>{if(empty)empty.hidden=!!log.childElementCount;context.refresh();};
  function refresh(){
    if(draft.text!==input.value){draft.text=input.value;draft.clientId=null;}
    const text=input.value.trim();
    form.classList.toggle('chat-draft',!!text);
    send.disabled=input.disabled||draft.pending||!text||input.value.length>maxLength;
    renderEmpty();
  }
  function addCard(parent,message){
    const card=messageCard(message,links),day=card.dataset.day;
    decorate?.(card,message);
    observeCard(card);
    if(dayDividers&&day&&parent.lastElementChild?.dataset.day!==day){
      const line=document.createElement('div');
      line.className='link-chat-day';line.textContent=day;
      parent.append(line);
    }
    parent.append(card);
    return card;
  }
  function append(message){
    const follow=nearBottom()||message.own;
    const card=addCard(log,message);
    const messages=log.querySelectorAll(':scope > .link-chat-message');
    if(messages.length>maxMessages){
      const first=messages[0],before=first.previousElementSibling,next=first.nextElementSibling;
      forgetCard(first);first.remove();
      if(before?.classList.contains('link-chat-day')&&next?.dataset.day!==first.dataset.day)before.remove();
    }
    renderEmpty();
    if(follow)scroll.scrollTop=scroll.scrollHeight;
    return card;
  }
  function replace(messages){
    const follow=nearBottom(),top=scroll.scrollTop;
    const visible=follow?null:[...log.children].find(row=>row.dataset.id&&row.getBoundingClientRect().bottom>scroll.getBoundingClientRect().top);
    const offset=visible?.getBoundingClientRect().top;
    const page=messages.slice(-maxMessages);
    if(rowVersion){
      const next=new Map(),nodes=[];
      let previousDay;
      for(const message of page){
        const key=rowVersion(message),old=cached.get(message.id);
        let card=old?.card;
        if(!card || old.key!==key){card=messageCard(message,links);decorate?.(card,message);observeCard(card);}
        if(old?.card===card&&old.status!==message.status&&message.own)updateReceipt(card.querySelector('.link-chat-meta'),message.status);
        updateRow?.(card,message);
        const day=card.dataset.day;
        let divider;
        if(dayDividers && day && day!==previousDay){
          divider=old?.divider || document.createElement('div');
          divider.className='link-chat-day';divider.textContent=day;nodes.push(divider);
        }
        previousDay=day;next.set(message.id,{key,card,divider,status:message.status});nodes.push(card);
      }
      const retained=new Set(nodes);
      for(const node of [...log.children])if(!retained.has(node)){forgetCard(node);node.remove();}
      nodes.forEach((node,i)=>{if(log.children[i]!==node)log.insertBefore(node,log.children[i]||null);});
      cached=next;
    }else{
      metadataSize.disconnect();
      const list=document.createDocumentFragment();
      for(const message of page)addCard(list,message);
      log.replaceChildren(list);
    }
    renderEmpty();
    if(follow)scroll.scrollTop=scroll.scrollHeight;
    else{
      scroll.scrollTop=top;
      const anchor=visible&&[...log.children].find(row=>row.dataset.id===visible.dataset.id);
      if(anchor)scroll.scrollTop+=anchor.getBoundingClientRect().top-offset;
    }
  }
  // The caller can keep this draft in memory and restore it on return to its conversation.
  function reset(next){
    refresh();
    const previous=draft;
    draft=next||blankDraft();
    cached.clear();links.clear();metadataSize.disconnect();input.value=draft.text;log.replaceChildren();refresh();
    return previous.text||previous.pending?previous:null;
  }
  async function submit(){
    refresh();
    if(send.disabled)return;
    const submitted=draft,clientId=(submitted.clientId??=crypto.randomUUID());
    submitted.pending=true;refresh();
    try{
      const result=await onSend(submitted.text.trim(),clientId);
      if(result===false)return;
      if(submitted===draft)refresh();
      if(submitted.clientId===clientId){
        submitted.text='';
        submitted.clientId=null;
        if(submitted===draft)input.value='';
      }
      if(submitted===draft&&document.activeElement===send)input.focus({preventScroll:true});
    }catch(error){if(submitted===draft)onError?.(error);}
    finally{submitted.pending=false;if(submitted===draft)refresh();}
  }
  input.addEventListener('input',refresh,options);
  input.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){
      event.preventDefault();
      void submit();
    }
  },options);
  form.addEventListener('submit',event=>{event.preventDefault();void submit();},options);
  refresh();
  return {append,replace,reset,refresh,
    setEnabled(enabled){input.disabled=!enabled;refresh();},
    destroy(){draft=blankDraft();events.abort();metadataSize.disconnect();},
  };
}
