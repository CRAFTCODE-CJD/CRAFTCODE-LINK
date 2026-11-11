import {tr} from './locale.mjs';
import { loginAddress, loginProvider } from './account-address.mjs';

import { profileName } from './profile-name.mjs';
import { getProvider } from './providers.mjs';
import { checkProvider } from './provider-probe.mjs';
const titles = { start:tr('Добро пожаловать в LINK'), create:tr('Создать аккаунт'), login:tr('Вход в аккаунт'), recovery:tr('Восстановление доступа') };
export function accountEntry({ $, api, account, showDialog, closeDialog, err, busy, confirmAction, toast, settings, saveSettings }) {
  let mode = 'start', note = '', touched = false, remember = false, wasOnline = false;
  let autoLogin=false, forgottenGeneration=-1;
  let probe, probeStatus = '', retry = false, operation = '';
  let externalRequest = 0, displayedProfile = '';
  function stopProbe() {
    probe?.abort();
    probe = null;
  }
  async function checkService() {
    stopProbe();
    const key = $('xmppProvider').value, site = getProvider(key);
    retry = ['jabberru','jabberclub'].includes(key);
    if (!retry) {
      probeStatus = site ? tr('Сервис выбран вручную.') : tr('Выберите сервис для регистрации.');
      render(); return;
    }
    const current = probe = new AbortController();
    probeStatus = tr('Проверяем доступность ') + site.name + '…';
    render();
    const {login, form} = await checkProvider(key,current.signal,provider=>call('check-registration',{provider}));
    if (probe !== current) return;
    probe = null;
    probeStatus = login && form ? tr('Регистрация и служба входа отвечают.')
      : tr('Автопроверка не подтвердила доступность. Можно открыть сайт в браузере или выбрать другой сервис.');
    render();
  }
  function createAccount(key='jabberru', choose=false) {
    ++externalRequest;
    $('accountJid').value='';
    $('rememberAccount').checked=false;
    markSeen('');
    $('xmppProvider').value=key;
    select('create');
    if(choose){ $('serviceDetails').open=true; $('xmppProvider').focus(); }
    return checkService();
  }
  function markSeen(pending = settings.registrationService) {
    if (!settings.accountIntroSeen || pending !== settings.registrationService) {
      settings.accountIntroSeen = true;
      settings.registrationService = pending;
      saveSettings();
    }
  }
  const call = (op, data={}) => api.internet({op,...data});
  const provider = () => (account.status!=='signed-out' && loginProvider(account.id)) || $('xmppProvider').value;
  const act = (id, fn) => $(id).addEventListener('click', () => Promise.resolve().then(fn).catch(err));

  function preview() {
    const text = $('accountJid').value.trim();
    let address = '';
    if (text) {
      try { address = loginAddress(text, provider()); } catch {}
    }
    $('loginPreview').textContent = address ? tr('Ваш адрес: ') + address : '';
  }
  function render() {
    const signedOut = account.status === 'signed-out', ready = account.status === 'online';
    const service = provider(), site = getProvider(service);
    $('onlineTitle').textContent = signedOut ? titles[mode] : tr('Друзья');
    $('onlineStatus').hidden = signedOut;
    $('onlineLogin').hidden = !signedOut;
    $('entryStart').hidden = mode !== 'start';
    $('entrySetup').hidden = mode === 'start';
    $('entryCreate').hidden = mode !== 'create';
    $('entryLogin').hidden = mode !== 'login';
    $('entryRecovery').hidden = mode !== 'recovery';
    $('accountDataHelp').hidden = signedOut && mode === 'start';
    $('openConnectionSettings').hidden = signedOut;
    $('saveCardBox').hidden = !ready;
    $('accountJid').placeholder = site ? tr('alex или alex@') + site.domain : tr('Полный адрес, например alex@jabber.ru');
    $('providerStatus').textContent = probeStatus;
    $('retryProvider').hidden = !retry;
    $('registerAccount').disabled = !site;
    $('registerAccount').textContent = site ? tr('Открыть регистрацию на ')+site.name+' ↗' : tr('Открыть регистрацию ↗');
    $('retryProvider').disabled = Boolean(probe);
    $('loginCreate').hidden=Boolean(getProvider(settings.registrationService));
    $('registrationReturn').hidden = mode!=='login' || !getProvider(settings.registrationService);
    $('entryBack').textContent = mode==='login' && settings.registrationService ? tr('← Вернуться к выбору аккаунта') : tr('← Назад');
    $('serviceSummary').textContent = site ? site.name + tr(' · Изменить сервис') : tr('Выбрать сервис аккаунта');
    $('createEmailTip').hidden = !site?.emailTip;
    $('createEmailTip').textContent = site?.emailTip || '';
    $('loginGuide').textContent = note || tr('Введите полный адрес. Для входа по короткому имени выберите свой сервис.');
    const admin = service === 'jabberes';
    $('resetPassword').disabled = $('accountHelpLink').disabled = !site;
    $('recoveryNote').textContent = !site ? tr('Выберите сервис своего аккаунта вверху.')
      : admin ? tr('С восстановлением доступа помогут администраторы JabberES.')
      : tr('Для восстановления потребуется почта, привязанная к вашему аккаунту ') + site.name + '.';
    $('resetPassword').textContent = admin ? tr('Контакты JabberES ↗') : tr('Сбросить пароль ↗');
    $('accountRemovalNote').textContent = !site ? tr('Выберите сервис аккаунта, чтобы открыть настройки удаления.')
      : admin ? tr('Обратитесь к администраторам JabberES для удаления аккаунта.')
      : service === 'xmppjp' ? tr('Войдите в личный кабинет на сайте XMPP.JP и выберите удаление аккаунта.')
      : tr('Удалить аккаунт навсегда можно на сайте ') + site.name + '.';
    if (['jabberru','jabberclub','jabberes'].includes(service)) $('accountRemovalNote').textContent = tr('Войдите в аккаунт. В приложении выберите «Настройки → Мой профиль → Удалить аккаунт…». Если сервис отклонит запрос, появится ссылка на помощь.');
    if (service === 'jabberclub') {
      $('recoveryNote').textContent = tr('На сайте указан контакт администратора admin@jabber.club. Автоматический сброс пароля не заявлен.');
      $('resetPassword').textContent = tr('Контакты на сайте ↗');
    }
    $('accountHelpLink').textContent = admin ? tr('Контакты JabberES ↗') : tr('Открыть сайт аккаунта ↗');
    const hasSession = !signedOut && Boolean(account.id);
    $('settingsIdentity').hidden=!hasSession;
    $('settingsGuest').hidden=hasSession;
    const identity = hasSession ? account.id : '';
    $('profileId').value = identity;
    if (identity !== displayedProfile) {
      displayedProfile = identity;
      $('profileName').value = profileName(identity, settings.profileNames, '');
    }
    $('profileName').readOnly = !ready;
    const locked = busy() || Boolean(operation);
    $('profileSwitch').disabled=$('profileLogout').disabled=$('logoutAccount').disabled=locked;
    $('profileDelete').disabled=locked || !ready;
    $('profileForm').querySelector('button').disabled=!ready || Boolean(operation);
    $('profileSaveCard').disabled=!ready;
    const hint=operation==='delete' ? tr('Ожидаем ответ сервиса…') : busy() ? tr('Для управления аккаунтом завершите звонок или закройте приглашение.')
      : !ready && hasSession ? tr('Ожидаем подключения. Можно выйти или выбрать другой аккаунт.') : '';
    $('profileActionHint').hidden=!hint; $('profileActionHint').textContent=hint;
    preview();
  }
  function select(next, message='') {
    if(next==='start')$('entryFallback').open=false;
    stopProbe();
    touched = true; mode = next; note = message;
    $('onlineError').hidden = true;
    $('serviceDetails').open = false;
    $('accountPass').value = '';
    render();
    const focusId = {start:'startDirect', create:'registerAccount', login:'accountJid', recovery:'recoverCard'}[mode];
    $(focusId).focus();
  }
  function dismiss() {
    stopProbe();
    if (mode === 'create') select('start');
    touched = true;
    markSeen();
  }
  $('internetDialog').addEventListener('close', () => { dismiss(); $('accountPass').value=''; });
  act('entryLater', () => { markSeen(''); closeDialog('internetDialog'); });
  act('loginCreate',()=>createAccount());
  act('startCreate', () => createAccount());
  act('retryProvider', checkService);
  function existingLogin() {
    $('xmppProvider').value = loginProvider($('accountJid').value) || settings.registrationService || settings.accountProvider || '';
    select('login');
  }
  act('startLogin', existingLogin);
  act('alreadyCreated', () => select('login'));
  act('changeRegistration', () => createAccount($('xmppProvider').value || 'jabberru',true));
  act('reopenRegistration', () => call('register',{provider:settings.registrationService}));
  act('entryBack', () => {
    ++externalRequest;
    if(mode==='recovery'){select('login');return;}
    if(settings.registrationService){markSeen('');$('accountJid').value='';$('xmppProvider').value='';}
    select('start');
  });
  act('openRecovery', () => select('recovery'));
  act('returnLogin', () => select('login'));
  act('registerAccount', async () => {
    const selected = provider();
    if (!getProvider(selected)) return;
    const intent=++externalRequest;
    stopProbe();
    await call('register',{provider:selected});
    if (intent!==externalRequest || ! $('internetDialog').open || mode!=='create' || account.status !== 'signed-out') return;
    markSeen(selected);
    select('login',tr('Завершите регистрацию на сайте и вернитесь сюда. Введите выбранное имя или полный адрес, если выбрали другой домен.'));
  });
  act('resetPassword', () => call('recover',{provider:provider()}));
  act('accountHelpLink', () => call('account-help',{provider:provider()}));
  $('xmppProvider').addEventListener('change', () => {
    ++externalRequest;
    stopProbe();
    if(mode==='login' && settings.registrationService && provider()!==settings.registrationService){ markSeen('');note=''; }
    $('accountJid').value='';
    probeStatus = provider() ? tr('Сервис выбран вручную.') : tr('Выберите сервис или повторите проверку.');
    retry = true;
    $('accountPass').value = '';
    if(mode==='create'){checkService().catch(err);return;}
    render();
  });
  $('accountJid').addEventListener('input', () => {
    const service = loginProvider($('accountJid').value.trim().replace(/^xmpp:/i,''));
    if (service && service !== $('xmppProvider').value) {
      $('accountPass').value = '';
      $('xmppProvider').value = service;
      if(settings.registrationService && service!==settings.registrationService){ markSeen(''); note=''; }
    }
    render();
  });
  async function importAddress() {
    const id = await call('read-card');
    if (!id || account.status !== 'signed-out') return;
    if(settings.registrationService && loginProvider(id)!==settings.registrationService)markSeen('');
    $('xmppProvider').value = loginProvider(id);
    $('accountJid').value = id;
    select('login',tr('Адрес из карточки подставлен. Введите пароль от аккаунта.'));
    $('accountPass').focus();
  }
  act('openCard',importAddress);
  act('recoverCard',importAddress);
  act('saveCard', async () => {
    if (account.status !== 'online') return;
    if (await call('save-card',{id:account.id})) {
      $('cardFeedback').textContent=tr('Карточка сохранена. Её можно открыть после переустановки.');
    }
  });
  $('accountForm').addEventListener('submit', async event => {
    event.preventDefault(); touched = true;
    $('onlineError').hidden=true;
    try {
      const id = loginAddress($('accountJid').value,provider());
      $('xmppProvider').value=loginProvider(id);
      remember=$('rememberAccount').checked;
      const password=$('accountPass').value;
      $('accountPass').value='';
      await account.login(id,password);
    } catch (e) { remember=false; err(e); }
  });
  function resetSession(next) {
    remember=false;autoLogin=false;wasOnline=false;note='';
    settings.accountProvider='';settings.identityMode='signed-out';
    markSeen('');saveSettings();
    account.logout();
    for(const id of ['accountJid','accountPass','contactFilter','contactJid','profileId','profileName']) $(id).value='';
    $('xmppProvider').value='';
    $('rememberAccount').checked=false;
    $('profileFeedback').textContent=''; $('profileHelp').hidden=true;
    $('cardFeedback').textContent=tr('Сохраните свой адрес на случай переустановки. Пароля в карточке нет.');
    select(next);
  }
  async function manage(kind) {
    if(operation || busy() || account.status==='signed-out') return;
    const id=account.id, key=loginProvider(id), site=getProvider(key), generation=account.generation;
    operation=kind; $('profileHelp').hidden=true; render();
    try {
      if(kind==='delete'){
        if(account.status!=='online' || !site)return;
        if(['xmppjp','jix','hotchilli'].includes(key)){
          await call('account-help',{provider:key});
          $('profileFeedback').textContent=tr('Завершите удаление на сайте ')+site.name+tr('. Затем нажмите «Выйти из аккаунта» на этом ПК.');
          return;
        }
        const approved=await confirmAction(tr('Удалить аккаунт ')+id+'?', tr('Вы потеряете доступ к этому логину и его списку друзей. Чтобы просто войти под другим именем, выберите «Сменить аккаунт».'),tr('Удалить навсегда'),true);
        if(!approved || busy() || generation!==account.generation || account.id!==id)return;
        await account.unregister(id);
        delete settings.profileNames[id];
        resetSession('start');
        try { await call('forget'); }
        catch { toast(tr('Сервис подтвердил удаление. Не удалось очистить сохранённый вход на этом ПК.'),true); return; }
        toast(tr('Сервис подтвердил удаление аккаунта ')+id+'.');
      } else {
        remember=false; autoLogin=false;
        await call('forget');
        resetSession(kind==='switch'?'login':'start');
        if(kind==='switch'){
          closeDialog('settingsDialog');showDialog('internetDialog');$('accountJid').focus();
        } else toast(tr('Вы вышли из аккаунта на этом ПК.'));
      }
    } catch(e) {
      const message=e?.message || String(e);
      $('profileFeedback').textContent=message;
      if(kind==='delete'){ $('profileHelp').hidden=false; toast(message,true); }
      if($('internetDialog').open)err(e);
    } finally {operation='';render();}
  }
  act('logoutAccount',()=>manage('logout'));
  act('profileLogout',()=>manage('logout'));
  act('profileSwitch',()=>manage('switch'));
  act('profileDelete',()=>manage('delete'));
  act('profileHelp',()=>call('account-help',{provider:loginProvider(account.id)}));
  function changed() {
    if (account.status === 'online') {
      autoLogin=false;
      if (!wasOnline) {
        if (settings.accountProvider !== loginProvider(account.id)) { settings.accountProvider = loginProvider(account.id); saveSettings(); }
        markSeen('');
        if (remember) { remember=false; call('save',{id:account.id,password:account.secret}).catch(err); }
      }
      wasOnline = true;
    } else {
      wasOnline = false;
      if (account.status==='signed-out' && account.error && forgottenGeneration !== account.generation) {
        forgottenGeneration=account.generation;
        if(autoLogin && !busy() && !document.querySelector('dialog[open]'))showDialog('internetDialog');
        autoLogin=false;
        remember=false; mode='login';
        call('forget').catch(err);
      }
    }
  }
  async function start() {
    let saved;
    try { saved = await call('load'); } catch (e) { err(e); }
    if (touched || busy() || account.status !== 'signed-out') return;
    if (saved && !['link','signed-out'].includes(settings.identityMode) && loginProvider(saved.id)) {
      autoLogin=true; mode='login'; $('accountJid').value=saved.id; $('xmppProvider').value=loginProvider(saved.id);
      try { await account.login(saved.id,saved.password); } catch (e) { err(e); }
      return;
    }
    const pending=settings.registrationService;
    if (getProvider(pending)) {
      $('xmppProvider').value=pending; mode='login'; note=tr('Уже зарегистрировались? Введите имя и пароль с сайта сервиса.');
    }
    render();
    if ((!settings.accountIntroSeen || getProvider(pending)) && !document.querySelector('dialog[open]')) showDialog('internetDialog');
  }
  return { render, changed, start, picker(){touched=true;select('start');}, loginScreen(){touched=true;existingLogin();}, changing:()=>Boolean(operation), opened(){ touched=true; } };
}
