import {paintGroupMark} from './group-mark.mjs';
import {thumbnail} from './profile-appearance.mjs';

export function groupAppearance({$,context,command}){
  const dialog=$('groupAppearance'),file=$('groupPhotoFile'),theme=$('groupTheme'),error=$('groupAppearanceError');
  for(const option of $('profileTheme').options)theme.add(option.cloneNode(true));
  let draft=null;
  const close=()=>{draft?.crop?.abort();draft=null;if(dialog.open)dialog.close();};
  const showError=e=>{error.textContent=String(e?.message||e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');error.hidden=false;};
  function refresh(){
    if(!draft)return;
    const {group,owner,id,online}=context();
    if(id!==draft.id||owner!==draft.owner||!group||group.role==='member'){close();return;}
    const locked=draft.busy||!online||!!group.transferring;
    const photo=Object.hasOwn(draft,'avatar')?draft.avatar:group.avatar;
    paintGroupMark($('groupPhotoPreview'),{...group,avatar:photo});
    $('groupAppearanceName').textContent=group.name;
    theme.value=draft.theme??group.theme??'personal';theme.disabled=locked;
    for(const option of theme.querySelectorAll('[data-extended]'))option.hidden=option.disabled=group.paletteVersion!==1;
    $('groupAppearanceName').parentElement.dataset.theme=theme.value==='personal'?$('profileTheme').value:theme.value;
    $('groupChoosePhoto').disabled=locked;
    $('groupRemovePhoto').disabled=locked||!(photo||!Object.hasOwn(draft,'avatar')&&group.avatarKey);
    $('groupAppearanceSave').disabled=locked||!Object.hasOwn(draft,'avatar')&&!Object.hasOwn(draft,'theme');
    $('groupAppearanceClose').disabled=$('groupAppearanceCancel').disabled=draft.saving;
  }
  function open(){
    const {group,id,owner,online}=context();if(!group||group.role==='member'||!online||group.transferring||dialog.open)return;
    draft={id,owner,busy:false,saving:false};error.hidden=true;refresh();dialog.showModal();
  }
  theme.onchange=()=>{if(draft){draft.theme=theme.value;refresh();}};
  $('groupChoosePhoto').onclick=()=>file.click();
  file.onchange=async()=>{
    const current=draft,chosen=file.files[0];file.value='';if(!current||!chosen)return;
    current.busy=true;error.hidden=true;refresh();
    current.crop=new AbortController();
    try{const pixels=await thumbnail(chosen,current.crop.signal,false);if(draft===current&&pixels)current.avatar=pixels;}
    catch(e){if(draft===current)showError(e);}
    finally{current.crop=null;current.busy=false;refresh();}
  };
  $('groupRemovePhoto').onclick=()=>{if(draft){draft.avatar=null;error.hidden=true;refresh();}};
  $('groupAppearanceClose').onclick=$('groupAppearanceCancel').onclick=close;
  dialog.oncancel=e=>{if(draft?.saving)e.preventDefault();};
  dialog.onclose=()=>{if(!dialog.open)close();};
  $('groupAppearanceForm').onsubmit=async event=>{
    event.preventDefault();
    const current=draft;if(!current||$('groupAppearanceSave').disabled)return;
    current.busy=current.saving=true;error.hidden=true;refresh();
    try{
      const changes={id:current.id,profileId:current.owner};
      if(Object.hasOwn(current,'theme'))changes.theme=current.theme;
      if(Object.hasOwn(current,'avatar'))changes.avatar=current.avatar;
      await command('group-appearance',changes);
      if(draft===current)close();
    }catch(e){if(draft===current)showError(e);}
    finally{current.busy=current.saving=false;refresh();}
  };
  return {open,refresh,close};
}
