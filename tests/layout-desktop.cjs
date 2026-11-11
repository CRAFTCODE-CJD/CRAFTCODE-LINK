const {capture}=require('./visual-capture.cjs');
const {clickPath}=require('./qa-navigation.cjs');
// Exercise the same dialogs, navigation and CSS shipped with the desktop app.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {_electron} = require(require.resolve('playwright', {paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || __dirname]}));
const {providers} = require('../src/renderer/providers.mjs');
const {Fixture} = require('./xmpp-fixture.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'link-layout-'));
const net = require('node:net');
const sizes = [[910,500],[1000,650],[1280,720],[1440,900],[800,560]];
const results = [];
let app, page;
async function audit(name) {
  for (const [width,height] of sizes) {
    await page.setViewportSize({width,height});
    const errors = await page.evaluate(() => {
      const modal = [...document.querySelectorAll('dialog[open]')].at(-1);
      const root = modal || document.querySelector('.app-shell');
      const area = root.getBoundingClientRect(), issues = [];
      if (area.left < -1 || area.right > innerWidth+1 || area.top < -1 || area.bottom > innerHeight+1)
        issues.push('frame outside viewport');
      for (const box of [document.documentElement,root,...root.querySelectorAll('.pref-content, .preferences, .modal-header, .header-actions, .entry-screen')]) {
        if (box.clientWidth && box.scrollWidth > box.clientWidth + 1)
          issues.push('horizontal overflow ' + (box.id || box.className || box.tagName));
      }
      const selector = 'button, input:not([type=checkbox]), select, textarea, summary';
      const buttons = [...root.querySelectorAll(selector)].filter(el=>el.checkVisibility() && el.getBoundingClientRect().width);
      for(const select of buttons.filter(el=>el.tagName==='SELECT')){
        const css=getComputedStyle(select);
        if(css.backgroundImage==='none'||parseFloat(css.paddingInlineEnd)<32||!css.backgroundPositionX.includes('12px'))issues.push('select indicator inset '+select.id+' '+css.backgroundPositionX);
      }
      for (const el of buttons) {
        const r = el.getBoundingClientRect();
        if (r.left < area.left-1 || r.right > area.right+1)
          issues.push('control outside frame '+(el.id||el.textContent));
      }
      for (const row of root.querySelectorAll('.account-actions, .profile-address, .entry-actions, .registration-return, .test-heading, .header-actions, .call-controls, .utility-controls')) {
        const items = [...row.children].map(el=>el.getBoundingClientRect()).filter(r=>r.width && r.height);
        for (let i=0;i<items.length;i++) for (const b of items.slice(i+1)) {
          const a=items[i];
          if (Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)
            issues.push('overlap '+row.className);
        }
      }
      for(const row of root.querySelectorAll('.fallback-routes, #linkSessionActions, .entry-tools')){
        const controls=[...row.querySelectorAll('button')].filter(el=>el.checkVisibility()).map(el=>el.getBoundingClientRect()).filter(r=>r.width);
        for(const [i,a] of controls.entries()){
          if(a.height<36)issues.push('small target in '+(row.id||row.className));
          for(const b of controls.slice(i+1)){
            if(Math.max(b.left-a.right,a.left-b.right,b.top-a.bottom,a.top-b.bottom)<7.9)
              issues.push('missing separation in '+(row.id||row.className));
          }
        }
      }
      if(issues.length && document.documentElement.scrollWidth>innerWidth+1){
        const outside=[...document.querySelectorAll('.app-shell *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1);
        issues.push(...outside.slice(0,12).map(el=>(el.id||el.className)+' right='+Math.round(el.getBoundingClientRect().right)));
      }
      return issues;
    });
    assert.deepEqual(errors,[],name+' '+width+'x'+height+': '+errors.join(', '));
    results.push({name,width,height});
  }
  await page.setViewportSize({width:1000,height:650});
  if(process.env.LINK_UI_QA_IMAGES) await page.screenshot({path:path.join(process.env.LINK_UI_QA_IMAGES,name.replaceAll(' ','-')+'.png')});
  await capture(page,name);
  console.log('PASS',name);
}
(async()=>{
  app = await _electron.launch({executablePath:require('electron'),args:['--headless','--ozone-platform=headless','--no-sandbox',path.join(__dirname,'..'),'--craftlink-profile=layout'],env:{...process.env,XDG_CONFIG_HOME:dir}});
  page=await app.firstWindow();page.setDefaultTimeout(9000);
  const fixture=new Fixture({});
  await page.context().routeWebSocket(providers.jabberru.service,s=>fixture.route(s,'jabber.ru'));
  await app.evaluate(({session,desktopCapturer,safeStorage})=>{
    Object.assign(safeStorage,{isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=>'fixture',encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()});
    session.fromPartition('link-registration-check',{cache:false}).fetch=async()=>new Response('',{status:503});
    desktopCapturer.getSources=async options=>{
      if(options.types.length!==1 || options.fetchWindowIcons!==false) throw Error('Unexpected capture scope');
      const windows=options.types[0]==='window';
      return [{id:windows?'window:88:0':'screen:77:0',name:windows?'Тестовый браузер':'Тестовый экран'}];
    };
  });
  await page.reload();
  await page.waitForFunction(()=>!!document.querySelector('#internetBtn'));
  if(!await page.locator('#internetDialog').isVisible()) await clickPath(page,'#internetBtn');
  const click=id=>clickPath(page,'#'+id);
  await page.waitForSelector('#entryStart');await audit('account welcome');
  if(process.env.LINK_VISUAL_DIR){
    await click('guideIntro');for(const n of [1,2,3]){await capture(page,'guide-'+n);await click('guideNext');}
    await page.locator('#entryFallback summary').click();await capture(page,'welcome-alternatives');await page.locator('#entryFallback summary').click();
  }
  await click('startDirect');await audit('local profile welcome');
  await click('directRestore');await audit('profile import');await click('transferCancel');
  await page.fill('#directName','Локальная проверка');await page.uncheck('#directAtStart');await page.locator('#directCreateForm button').click();
  await page.locator('#directDialog').waitFor({state:'hidden'});await audit('friends workspace');
  if(process.env.LINK_VISUAL_DIR){
    await click('navRequests');await capture(page,'requests-empty');await click('navRoom');await capture(page,'room-idle');await click('navFriends');
    await click('linkFriends');await capture(page,'add-card');await page.fill('#directCode','invalid');
    await click('sendCardRequest');await page.locator('#directMessage').filter({hasText:/.+/}).waitFor();assert.match(await page.innerText('#directMessage'),/CCF1/);
    assert.equal(await page.getAttribute('#directCode','aria-invalid'),'true');
    await capture(page,'card-error');await page.fill('#directCode','new value');
    assert.equal(await page.innerText('#directMessage'),'');await click('directClose');
    await click('profileBtn');await capture(page,'link-settings-profile');await click('closeSettingsDialog');
    await page.click('#networkHelpBtn');await capture(page,'help');await page.locator('#helpTopics details').first().locator('summary').click();await capture(page,'help-article');await click('closeNetworkDialog');
  }await click('bookNearby');await page.waitForSelector('#directNearby');
  assert.equal(await page.innerText('#directTitle'),'Локальная сеть');await audit('nearby and network selection');
  await click('directClose');await click('profileBtn');await page.waitForSelector('#directIdentity');
  assert(await page.locator('#pref-profile').isVisible());
  assert.equal(await page.locator('#settingsDialog').getByRole('button',{name:'Друзья',exact:true}).count(),0);
  await page.fill('#directNick','Черновик имени');
  await page.locator('#directEdit button').focus();
  await page.evaluate(()=>window.craftlink.direct({op:'settings',name:'Локальная проверка'}));
  await page.waitForTimeout(220); // The service batches presence updates.
  assert.equal(await page.inputValue('#directNick'),'Черновик имени');
  await page.fill('#directNick','Локальная проверка');await audit('local identity');
  await page.click('#linkProfileTools summary');await capture(page,'profile-transfer-actions');await click('directExport');await audit('profile export');
  await page.fill('#transferPass','sample transfer password');await click('transferCancel');assert.equal(await page.inputValue('#transferPass'),'');
  await click('closeSettingsDialog');await clickPath(page,'#internetBtn');await click('confirmYesBtn');await click('entryBack');
  await click('startCreate');await click('serviceSummary');await audit('registration and provider selection');
  await click('alreadyCreated');await audit('login');await click('openRecovery');await audit('recovery');
  await click('returnLogin');await page.fill('#accountJid','layout@jabber.ru');await page.fill('#accountPass','fixture-password');
  await click('loginAccount');await page.waitForSelector('#onlineActive');await audit('friends');await click('closeInternet');
  await audit('lobby');
  await click('linkFriends');await page.waitForSelector('#contactJid');
  assert.equal(await page.textContent('#onlineTitle'),'Добавить друга');
  assert(await page.locator('#saveCardBox').isHidden());
  assert(await page.locator('#internetRoster').isHidden());
  await audit('jabber add friend');await click('closeInternet');
  const sendRequest=name=>fixture.clients.get('layout@jabber.ru').ws.send('<presence xmlns="jabber:client" type="subscribe" from="'+name+'@jabber.ru"/>');
  await page.focus('#bookQuery');sendRequest('alpha');sendRequest('beta');sendRequest('beta');
  await page.waitForFunction(()=>document.querySelector('#requestBadge').textContent==='2');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'bookQuery');
  assert.equal(await page.textContent('#noticeSender'),'alpha@jabber.ru');
  await audit('friend notification');await click('noticeDecline');
  await page.waitForFunction(()=>document.querySelector('#noticeSender').textContent==='beta@jabber.ru');
  await click('noticeDismiss');assert.equal(await page.textContent('#requestBadge'),'1');
  sendRequest('beta');await page.waitForTimeout(180);assert(await page.locator('#requestNotice').isHidden());
  await click('settingsBtn');await page.click('[data-pane=connection]');await page.check('#dnd');sendRequest('quiet');
  await page.waitForFunction(()=>document.querySelector('#requestBadge').textContent==='2');
  assert(await page.locator('#requestNotice').isHidden());await page.uncheck('#dnd');await click('closeSettingsDialog');
  await click('navRequests');const incoming=page.locator('#inRequests').getByRole('button',{name:'Отклонить'});
  await incoming.first().click();await incoming.first().click();await page.waitForSelector('#requestBadge',{state:'hidden'});
  await click('navFriends');await click('profileBtn');await audit('signed-in profile');
  await click('profileDelete');await page.waitForSelector('#confirmYesBtn');await audit('account deletion confirmation');await click('confirmNoBtn');
  for(const pane of ['voice','stream','connection']){await page.click('[data-pane="'+pane+'"]');await audit('settings '+pane);
    if(process.env.LINK_VISUAL_DIR && pane==='stream'){await page.click('#graphicsDetails summary');await capture(page,'graphics');await page.click('#graphicsDetails summary');}
    if(process.env.LINK_VISUAL_DIR && pane==='connection'){await page.click('#advancedRouting summary');await capture(page,'routing');await page.click('#advancedRouting summary');}}
  await click('closeSettingsDialog');await click('networkHelpBtn');await audit('diagnostics');await click('closeNetworkDialog');
  await click('joinBtn');await audit('invitation entry');
  await page.fill('#hubCode','CCF1:example');await click('hubEnter');assert.match(await page.locator('#hubError').innerText(),/карточка друга/);await capture(page,'invite-error');
  await click('closeHub');
  await click('createBtn');await audit('room creation');await click('hubManual');await audit('direct hosting');
  await page.fill('#addressInput','127.0.0.1');await page.fill('#portInput','70000');await click('roomSubmitBtn');
  assert.match(await page.locator('#roomError').innerText(),/65535/);await capture(page,'port-error');
  await click('joinModeBtn');await audit('direct invitation');
  await page.fill('#inviteInput','CL1:mistyped');await click('roomSubmitBtn');await page.waitForSelector('#roomError');
  assert.equal(await page.inputValue('#inviteInput'),'CL1:mistyped');await click('createModeBtn');
  assert.equal(await page.inputValue('#addressInput'),'127.0.0.1');assert.equal(await page.inputValue('#portInput'),'70000');await click('closeRoomDialog');
  await click('createBtn');await click('hubStart');await page.waitForSelector('#hubInvite');await audit('room invite');await click('closeHub');
  await audit('active room');await click('shareBtn');await page.waitForSelector('#sourcesGrid .source-card');await audit('source picker');
  await page.locator('#sourcesGrid button').first().click();await click('windowTabBtn');
  await page.getByRole('button',{name:'Тестовый браузер'}).waitFor();assert(await page.locator('#startShare').isDisabled());
  await audit('window picker');await click('closeSourceDialog');
  assert(await page.locator('#chatInput').isDisabled());
  await click('profileBtn');await audit('profile during call');for(const id of ['profileSwitch','profileLogout','profileDelete']) assert(await page.locator('#'+id).isDisabled());
  await click('closeSettingsDialog');await click('leaveBtn');await page.waitForSelector('#directoryPage');
  await click('profileBtn');assert(await page.locator('#profileLogout').isEnabled());
  await click('closeSettingsDialog');await click('createBtn');await click('hubManual');
  const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));
  const port=probe.address().port;await new Promise(r=>probe.close(r));
  await page.fill('#addressInput','127.0.0.1');await page.fill('#portInput',String(port));await click('roomSubmitBtn');
  await page.waitForSelector('#inviteDoneBtn');await audit('direct invitation to copy');await click('inviteDoneBtn');await click('leaveBtn');
  console.log('PASS',results.length,'screen/viewport combinations, and call protection released on exit');
})().catch(async e=>{console.error(e);if(page)console.error(await page.evaluate(()=>({dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id),toast:document.querySelector('#toast').textContent,entry:document.querySelector('#onlineTitle').textContent})).catch(()=>null));process.exitCode=1;}).finally(async()=>{if(app)await app.close();fs.rmSync(dir,{recursive:true,force:true});});
