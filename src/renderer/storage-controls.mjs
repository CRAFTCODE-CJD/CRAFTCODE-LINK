import {tr,language} from './locale.mjs';
export function bindStorageControls($,api){
  const panel=$('pref-storage'),status=$('storageStatus');let busy=false,state;
  const buttons=[...panel.querySelectorAll('button')];
  const size=value=>{
    if(!Number.isFinite(value))return '—';
    const units=['Б','КиБ','МиБ','ГиБ','ТиБ'];let i=0;
    while(value>=1024&&i<units.length-1){value/=1024;i++;}
    return new Intl.NumberFormat(language,{maximumFractionDigits:i?1:0}).format(value)+' '+tr(units[i]);
  };
  function render(){
    if(state){
      $('storagePath').textContent=state.directory;$('downloadsPath').textContent=state.downloads;
      $('storageUsed').textContent=size(state.bytes);$('storageFree').textContent=size(state.free);$('storageCache').textContent=size(state.cacheBytes);
      $('storageEstimate').hidden=!state.incomplete;
      $('storageRetained').hidden=!state.retainedStages;
      $('storageRetained').textContent=state.retainedStages?tr('Незавершённые копии данных: ')+state.retainedStages+'. '+tr('Они будут удалены при удалении LINK.'):'';
      const destination=state.pending?.directory||state.selection?.directory;
      $('storageMove').hidden=!destination;
      $('storageDestination').textContent=destination||'';
      $('storageMoveHelp').textContent=tr(state.pending?'Перенос начнётся при следующем запуске LINK.':'Профиль, история и настройки будут перенесены. Скачанные файлы останутся на своих местах.');
      $('storageConfirmMove').hidden=!!state.pending;
      $('storageRestart').hidden=!state.pending;
    }
    panel.setAttribute('aria-busy',String(busy));buttons.forEach(b=>b.disabled=busy);
    $('storageChoose').disabled=busy||!!state?.pending;
  }
  async function act(op){
    if(busy)return;
    const opening=op==='open-profile'||op==='open-downloads';
    busy=true;status.textContent=tr(opening?'Открываем папку…':op==='clear-cache'?'Очищаем кэш…':'Проверяем хранилище…');render();
    try{
      const result=await api.storage({op,...(op==='schedule-move'?{token:state.selection?.token}:{})});
      if(opening){status.textContent='';return;}
      state=result;
      status.textContent=state.error|| (op==='clear-cache'?tr('Освобождено: ')+size(state.freed):'');
    }catch(e){status.textContent=e.message||tr('Не удалось открыть хранилище. Повторите попытку.');}
    finally{busy=false;render();}
  }
  for(const [id,op] of Object.entries({storageRefresh:'state',storageChoose:'choose-location',storageOpen:'open-profile',downloadsOpen:'open-downloads',storageConfirmMove:'schedule-move',storageCancelMove:'cancel-move',storageRestart:'restart',downloadsChoose:'choose-downloads',storageClearCache:'clear-cache'}))$(id).onclick=()=>act(op);
  return {refresh:()=>act('state')};
}
