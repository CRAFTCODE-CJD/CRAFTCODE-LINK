import {ChatPlayer,attachmentKind} from './chat-player.mjs';
import {fileSize,transferMeter} from './transfer-progress.mjs';
import {tr} from './locale.mjs';

function label(tag,style,value){
  const el=document.createElement(tag);el.className=style;el.textContent=value;return el;
}
export function downloadCleanupOption(id,all=false){
  const option=document.createElement('label'),checkbox=document.createElement('input');
  option.className='chat-clear-downloads';checkbox.type='checkbox';checkbox.id=id;
  option.append(checkbox,tr(all?'Также удалить файлы, скачанные в этих чатах':'Также удалить файлы, скачанные в этом чате'));
  return {option,checkbox};
}

export function chatAttachments({scope,refresh,onError}){
  const player=new ChatPlayer();
  function decorateFile(card,m){
    const a=m.attachment;if(!a)return;
    const active=scope(),info=document.createElement('div'),actions=document.createElement('div');
    info.className='chat-file';actions.className='chat-file-actions';
    const line=label('small','',[
      fileSize(a.size),a.state==='saved'?tr('Сохранено'):a.state==='withdrawn'?tr('Доступ отозван'):
      a.state==='offline'?tr('Устройство отправителя не в сети'):a.state==='failed'?tr('Не удалось скачать файл.'):
      a.state==='disk-full'?tr('Недостаточно места в папке загрузок.'):
      a.state==='update-required'?tr('Другу нужно обновить LINK. Чтобы доставить следующие сообщения раньше, отзовите файл.'):
      a.originalRequired?tr('Оставьте исходный файл на месте до скачивания.'):''
    ].filter(Boolean).join(' · '));
    if(['sending','receiving'].includes(a.state))info.append(label('div','chat-file-progress',''));
    if(!a.clip && m.text!==a.name)info.append(label('strong','file-name',a.name));
    function button(title,action,onClick){
      const b=label('button','',tr(title));b.type='button';b.dataset.action=action;
      b.onclick=async()=>{
        if(!active.current())return;
        b.disabled=true;
        try{
          if(onClick)await onClick(b);else await active.doFile(action,{messageId:m.id});
          if(active.current())await refresh();
        }catch(error){onError(error);}finally{b.disabled=false;}
      };if(card.classList.contains('local-media')&&['withdraw','reveal'].includes(action))b.classList.add('media-menu-action');
      actions.append(b);return b;
    }
    const previewable=attachmentKind(a);
    card.dataset.attachmentKind=previewable;
    if((m.own && a.state!=='withdrawn' || a.state==='saved') && previewable){
      const title=a.clip==='voice'?'Прослушать':a.clip==='circle'?'Смотреть кружок':previewable==='photo'?'Показать фото':'Просмотреть';
      if(['voice','circle','photo'].includes(previewable)){
        card.classList.add('local-media');
        const body=card.querySelector('.link-chat-body');
        if(a.clip||a.name===m.text)body.hidden=true;
        info.querySelector('.file-name')?.remove();
        line.className='media-file-info';line.title=a.name;
      }
      const read=()=>active.doFile('preview',{messageId:m.id});
      const meta={...a,id:m.id,own:m.own};
      const played=async()=>{if(active.current()){await active.doFile('played',{messageId:m.id});if(active.current())await refresh();}};
      const trigger=button(title,'preview',button=>player.toggle(info,button,m.id,meta,read,onError,played));
      player.styleTrigger(trigger,meta,read);
    }
    if(m.own && a.state!=='withdrawn')button('Отозвать доступ','withdraw');
    if(!m.own && ['offered','failed','disk-full'].includes(a.state)){
      const download=button(a.state==='offered'?'Скачать':'Повторить попытку','download');
      if(a.clip==='circle'||a.clip==='voice')player.styleTrigger(download,a);
    }
    if(a.state==='receiving')button('Отмена','cancel');
    if(a.state==='saved')button('Показать в папке','reveal');
    info.append(line,actions);
    card.querySelector('.link-chat-body').after(info);
  }
  function updateRow(card,m){
    const meter=card.querySelector('.chat-file-progress'),a=m.attachment;
    if(meter)transferMeter(meter,a.pos,a.size,a.bytesPerSecond,a.name);
    if(a?.played)player.markPlayed(m.id,card);
  }
  return {decorate:decorateFile,updateRow,reconcile:()=>player.reconcile(),close:()=>player.close(),clear:()=>player.clear()};
}
