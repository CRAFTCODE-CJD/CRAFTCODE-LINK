import {language,tr} from './locale.mjs';

function element(tag,text,style){
  const node=document.createElement(tag);
  if(text)node.textContent=tr(text);
  if(style)node.className=style;
  return node;
}

export function identityVerification({api,scope,onError}){
  const dialog=element('dialog',null,'modal identity-dialog');
  dialog.id='identityDialog';
  const header=element('header'),title=element('h2','Защита переписки');
  title.id='identityTitle';dialog.setAttribute('aria-labelledby',title.id);
  const close=element('button','Закрыть','button button-secondary');
  close.type='button';close.onclick=()=>dialog.close();
  header.append(title,close);
  const body=element('section'),status=element('p');
  status.setAttribute('role','status');
  dialog.append(header,body,status);document.body.append(dialog);
  let current=null,busy=false;
  const matches=()=>{
    const next=scope();
    return !!current && next?.profileId===current.profileId && next.id===current.id;
  };
  const request=(op,fields={})=>api.direct({op,profileId:current.profileId,id:current.id,...fields});
  const date=new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'});

  function render(report){
    body.replaceChildren();status.textContent='';
    const connection=report.connection==='encrypted'?'Личное соединение зашифровано':
      report.connection==='offline'?'Доставка при следующем подключении':'Сведения о защите соединения недоступны.';
    body.append(element('h3',connection));
    if(report.transports.length)body.append(element('p',report.transports.join(' · '),'field-help'));
    body.append(element('p',report.localStorageProtected?
      'История и очередь сообщений защищены хранилищем Windows на этом ПК.':
      'Защищённое локальное хранилище недоступно.'));
    body.append(element('h3','Код безопасности'));
    body.append(element('p','Сравните весь код с собеседником лично или по независимому каналу. Код должен совпадать на обоих устройствах.','field-help'));
    const code=element('output',null,'identity-code');
    code.id='identityCode';code.setAttribute('aria-label',tr('Код безопасности'));
    for(const block of report.code.split(' '))code.append(element('span',block));
    body.append(code);
    const verified=element('p',report.verifiedAt?'Код сверён на этом ПК':'Код ещё не сверяли');
    verified.id='identityVerified';
    if(report.verifiedAt)verified.append(' · '+date.format(report.verifiedAt));
    body.append(verified);
    if(report.devicesChanged)body.append(element('p','После сверки добавилось устройство. Уточните у собеседника, принадлежит ли оно ему.','identity-change'));
    const actions=element('div',null,'identity-actions');
    const copy=element('button','Копировать код','button button-secondary');
    copy.type='button';copy.id='identityCopy';
    copy.onclick=async()=>{
      try{
        await api.copyText(report.code);
        if(matches()&&dialog.open)status.textContent=tr('Код скопирован.');
      }catch(error){onError(error);}
    };
    async function verify(value){
      if(busy||!matches())return;
      const operation=current;
      busy=true;confirm.disabled=reset.disabled=true;
      try{
        const next=await request('chat-verify',{fingerprint:report.fingerprint,verified:value,
          devices:report.devices.map(device=>device.id)});
        if(current===operation&&matches()&&dialog.open)render(next);
      }catch(error){if(current===operation&&dialog.open)status.textContent=error.message;}
      finally{if(current===operation)busy=false;confirm.disabled=reset.disabled=false;}
    }
    const confirm=element('button','Я сверил код','button button-primary');
    confirm.id='identityConfirm';confirm.type='button';confirm.onclick=()=>verify(true);
    const reset=element('button','Сбросить отметку','button button-secondary');
    reset.id='identityReset';reset.type='button';reset.hidden=!report.verifiedAt;reset.onclick=()=>verify(false);
    actions.append(copy,confirm,reset);body.append(actions);
    const devices=element('details',null,'identity-devices');
    devices.append(element('summary',tr('Устройства собеседника')+' · '+report.devices.length));
    const list=element('ul');
    for(const device of report.devices){
      const row=element('li'),key=element('code',device.id);
      key.setAttribute('aria-label',tr('Открытый ключ устройства'));
      row.append(key,element('span',device.active?'На связи':'Не в сети'));
      if(device.checked)row.append(element('small','Известно при последней сверке'));
      list.append(row);
    }
    devices.append(list);body.append(devices);
    body.append(element('p','Собеседник и устройства с доступом к его профилю могут прочитать полученные сообщения. Сохранёнными копиями управляет их владелец.','field-help'));
  }
  dialog.addEventListener('close',()=>{current=null;busy=false;body.replaceChildren();});
  async function refresh(target){
    current={...target};
    const opening=current;
    try{
      const report=await request('chat-security');
      if(current===opening&&matches()&&dialog.open)render(report);
    }catch(error){if(current===opening&&dialog.open)status.textContent=error.message;}
  }
  return {
    async open(){
      const target=scope();if(!target)return;
      busy=false;body.replaceChildren();
      title.textContent=tr('Защита переписки')+' · '+target.name;
      status.textContent=tr('Загрузка…');dialog.showModal();
      await refresh(target);
    },
    sync(){
      if(!dialog.open)return;
      if(!matches()){dialog.close();return;}
      const target=scope();
      if(!busy&&target.revision!==current.revision)refresh(target);
    }
  };
}
