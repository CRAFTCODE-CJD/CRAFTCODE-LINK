import {language,tr} from './locale.mjs';
import {transferMeter} from './transfer-progress.mjs';

export function updateControls($,api,onError){
  if(!api?.releases)return {draw(){},refresh(){}};
  const help=$('networkHelpBtn');
  const badge=document.createElement('small');
  badge.className='release-hint';badge.hidden=true;help.append(badge);
  const retryFormat=new Intl.DateTimeFormat(language,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  let cooldownTimer;
  function draw(s){
    if(!s)return;
    clearTimeout(cooldownTimer);
    const delay=Math.max(0,(s.retryAt||0)-Date.now());
    if(delay)cooldownTimer=setTimeout(()=>draw(s),delay+1);
    $('githubUpdates').hidden=false;
    $('coffeeSupport').hidden=!s.donation;
    $('releaseAutomatic').checked=s.automatic;
    $('releaseAutomatic').disabled=!s.supported;
    const fetching=['checking','downloading'].includes(s.phase);
    const offered=['available','ready','downloading'].includes(s.phase);
    badge.hidden=!offered;badge.textContent=offered?s.version:'';
    help.title=offered?tr('Справка LINK')+' · '+tr('Доступна версия')+' '+s.version:tr('Справка LINK');
    help.setAttribute('aria-label',help.title);
    $('updateSummary').textContent=tr('Обновления')+(offered?' · '+s.version:'');
    $('githubCheck').disabled=!s.supported||!s.networkAllowed||fetching||s.phase==='ready'||delay>0;
    $('githubCancel').hidden=!fetching;
    $('githubDownload').hidden=s.phase!=='available';
    $('githubDownload').disabled=!s.networkAllowed||delay>0;
    $('githubDownload').textContent=tr(s.error?'Повторить загрузку':'Скачать обновление');
    $('githubInstall').hidden=s.phase!=='ready';
    const progress=$('githubProgress');
    progress.hidden=s.phase!=='downloading';
    if(!progress.hidden)transferMeter(progress,s.received,s.bytes,s.bytesPerSecond,tr('Скачиваем установщик с GitHub…'));
    const messages={
      idle:tr('Установлена версия')+' '+s.installed+'.',
      checking:tr('Проверяем выпуск на GitHub…'),current:tr('Установлена актуальная версия')+' '+s.installed+'.',
      unpublished:tr('Публичный выпуск на GitHub пока недоступен.'),
      available:tr('Доступна версия')+' '+s.version+' · '+Math.ceil(s.bytes/1048576)+' '+tr('МиБ'),
      downloading:tr('Скачиваем установщик с GitHub…'),
      ready:tr('Установщик скачан. SHA-256 совпал с данными выпуска.')+' '+s.version,
    };
    const text=!s.supported?tr('Этот установщик предназначен для Windows x64.'):
      !s.networkAllowed&&s.phase!=='ready'?tr('Проверка GitHub недоступна в режиме «Только через ретранслятор».'):
      delay?tr('GitHub ограничил запросы. Повтор будет доступен после')+' '+retryFormat.format(s.retryAt)+'.':
      s.error||messages[s.phase]||'';
    const status=$('githubReleaseStatus');
    if(status.textContent!==text)status.textContent=text;
  }
  const request=(op,extra={})=>api.releases({op,...extra}).then(draw).catch(onError);
  $('releaseAutomatic').onchange=()=>request('automatic',{enabled:$('releaseAutomatic').checked});
  for(const [id,op] of [['githubCheck','check'],['githubDownload','download'],['githubCancel','cancel'],['githubInstall','install'],['helpDonate','donate']])
    $(id).onclick=()=>request(op);
  return {draw,refresh:()=>request('state'),offered:()=>!badge.hidden};
}
