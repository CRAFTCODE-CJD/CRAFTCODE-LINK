import {tr} from './locale.mjs';

let openDraft;
function attachmentDialog(){
  const dialog=document.getElementById('attachmentDraft'),list=document.getElementById('attachmentDraftItems');
  const caption=document.getElementById('attachmentCaption'),send=document.getElementById('attachmentDraftSend');
  const cancel=document.getElementById('attachmentDraftCancel'),note=document.getElementById('attachmentDraftStatus');
  let active=null;
  function clearPreviews(){
    for(const url of active.urls)URL.revokeObjectURL(url);
    active.urls=[];list.replaceChildren();
  }
  function paint(){
    clearPreviews();
    for(const file of active.files){
      const row=document.createElement('div'),name=document.createElement('span');
      row.className='draft-file';
      if(file.size<=8*1024**2 && /^image\/(?:png|jpeg|webp|gif|avif)$/.test(file.type)){
        const image=document.createElement('img'),url=URL.createObjectURL(file);
        active.urls.push(url);image.alt='';image.src=url;row.append(image);
      }
      name.textContent=file.name;row.append(name);
      const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.disabled=active.busy;
      remove.setAttribute('aria-label',tr('Убрать')+' · '+file.name);
      remove.onclick=()=>{active.files=active.files.filter(item=>item!==file);if(active.files.length)paint();else dialog.close();};
      row.append(remove);list.append(row);
    }
    send.disabled=cancel.disabled=caption.disabled=active.busy;
  }
  cancel.onclick=()=>dialog.close();
  dialog.addEventListener('cancel',e=>{if(active?.busy)e.preventDefault();});
  dialog.addEventListener('close',()=>{if(dialog.open)return;if(active)clearPreviews();active=null;caption.value='';note.textContent='';});
  send.onclick=async()=>{
    const draft=active;if(!draft||draft.busy)return;
    draft.busy=true;paint();note.textContent=tr('Отправка…');
    try{
      while(draft.files.length){
        if(draft.scope()?.key!==draft.target.key){dialog.close();return;}
        const sent=await draft.publish(draft.target,draft.files[0],caption.value.trim());
        if(active!==draft||!dialog.open)return;
        if(sent===false)throw Error(tr('Не удалось отправить вложение.'));
        draft.consumeText?.();draft.consumeText=null;
        draft.files.shift();caption.value='';
      }
      dialog.close();
    }catch(error){
      if(active===draft&&dialog.open){
        const message=String(error?.message||error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
        note.textContent=message.includes('CLIPBOARD_FILE_TOO_LARGE')?tr('Из буфера можно вставить до 8 МиБ. Перетащите исходный файл из папки.'):message;
        draft.busy=false;paint();
      }
    }
  };
  caption.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send.click();}
  });
  const open=(draft,text)=>{
    if(dialog.open)return;
    if(active)clearPreviews();
    active={...draft,urls:[],busy:false};caption.value=text.slice(0,caption.maxLength);note.textContent='';
    paint();dialog.showModal();caption.focus();
  };
  open.reconcile=scope=>{
    if(active?.scope===scope&&scope()?.key!==active.target.key&&dialog.open)dialog.close();
  };
  return open;
}

export function bindAttachmentDraft({area,input,scope,publish,onError}){
  const hasFiles=transfer=>Array.from(transfer?.types||[]).includes('Files');
  function stage(files,text=''){
    const target=scope();
    if(!target||!files.length)return;
    if(files.length>12){onError(Error(tr('Можно прикрепить до 12 файлов за раз.')));return;}
    const original=input.value;
    const useDraft=!!original.trim() && original.length<=1024;
    const consumeText=()=>{
      if(useDraft && scope()?.key===target.key && input.value===original){
        input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));
      }
    };
    openDraft??=attachmentDialog();
    openDraft({target,scope,files,publish,consumeText},useDraft?original:text);
  }
  area.addEventListener('dragover',event=>{
    if(!hasFiles(event.dataTransfer))return;
    event.preventDefault();const enabled=!!scope();event.dataTransfer.dropEffect=enabled?'copy':'none';
    area.classList.toggle('accepts-drop',enabled);
  });
  area.addEventListener('dragleave',event=>{
    if(!area.contains(event.relatedTarget))area.classList.remove('accepts-drop');
  });
  area.addEventListener('drop',event=>{
    area.classList.remove('accepts-drop');
    if(hasFiles(event.dataTransfer)){event.preventDefault();stage(Array.from(event.dataTransfer.files));}
  });
  area.addEventListener('paste',event=>{
    const files=Array.from(event.clipboardData?.files||[]);
    if(files.length){event.preventDefault();stage(files,event.clipboardData.getData('text/plain'));}
  });
  return ()=>openDraft?.reconcile(scope);
}
