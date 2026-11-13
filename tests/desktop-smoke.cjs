const {capture}=require('./visual-capture.cjs');
const {clickPath}=require('./qa-navigation.cjs');
'use strict';
const {testRuntime}=require('./electron-runtime.cjs');
const {roomMix,roomChat,closeRoomMenu}=require('./participant-controls.cjs');

// Real application UI + main/preload + TLS control integration. These checks
// deliberately do NOT equate a joined room with a working media connection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const root = path.resolve(__dirname, '..');
let playwright;
try { playwright = require('playwright'); }
catch {
  const runtimeModules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
  if (!runtimeModules) throw new Error('Install Playwright to run desktop QA: npm install --no-save playwright');
  playwright = require(path.join(runtimeModules, 'playwright'));
}

const output = path.join(root, 'out', 'qa');
fs.mkdirSync(output, { recursive: true });
const result = {
  suite: 'CRAFTCODE LINK actual desktop UI and TLS control integration',
  started: new Date().toISOString(),
  checks: [],
  liveMedia: process.argv.includes('--live-media'),
  notes: [
    'Launches the actual application entry point in separate Electron processes.',
    'Linux headless/no-sandbox and synthetic microphone flags are test-only, never added to the distributed app.',
    'Optional --live-media checks voice RTP and received video in separate instances on loopback. Windows capture, WAN port forwarding and 4–8-person media performance require other tests.',
    'Screenshots are internal QA evidence only; they must not be saved to Library or included as user deliverables.',
  ],
  pageErrors: [],
  consoleErrors: [],
  dialogs: [],
};
const instances = [];
const profileSuffix = `${Date.now().toString(36)}-${process.pid}`;
const profiles = ['host', 'guest1', 'guest2'].map(name => `qa-${name}-${profileSuffix}`);
const check = (name, detail) => {
  result.checks.push({ name, pass: true, ...(detail === undefined ? {} : { detail }) });
  console.log(`PASS ${name}`);
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function launch(label, profile) {
  const args = [root, `--craftlink-profile=${profile}`, '--use-fake-device-for-media-stream'];
  // This integration scenario explicitly joins 127.0.0.1 on a single test PC.
  args.push('--allow-loopback-in-peer-connection');
  if (process.platform === 'linux') args.unshift('--headless', '--ozone-platform=headless', '--no-sandbox');
  const app = await playwright._electron.launch({
    executablePath: testRuntime(), args, timeout: 30_000,
  });
  const instance = { app, page: null, label, closed: false };
  instances.push(instance);
  app.process().stderr.on('data', data => {
    if (process.env.CCLINK_QA_VERBOSE) process.stderr.write(`[${label}] ${data}`);
  });
  const page = instance.page = await app.firstWindow({ timeout: 20_000 });
  page.on('pageerror', error => result.pageErrors.push({ label, message: error.message }));
  page.on('console', message => {
    if (message.type() === 'error') result.consoleErrors.push({ label, text: message.text() });
  });
  page.on('dialog', async dialog => {
    result.dialogs.push({ label, type: dialog.type(), message: dialog.message() });
    await dialog.accept();
  });
  await page.waitForFunction(() => window.craftlink && document.getElementById('statusText')?.textContent === 'Не в комнате', null, { timeout: 20_000 });
  await page.setViewportSize({ width: 1440, height: 940 });
  return instance;
}

async function waitCount(page, number) {
  await page.waitForFunction(expected => document.getElementById('participantsCount').textContent === `${expected} / 8`, number, { timeout: 20_000 });
}

async function join(instance, invite, name) {
  const page = instance.page;
  await clickPath(page,'#joinBtn');
  const remembered=await page.evaluate(()=>JSON.parse(localStorage.getItem('craftlink.settings.v1') || '{}').name);
  await page.fill('#hubCode',invite);await page.click('#hubEnter');
  if(!remembered){await page.fill('#nameInput',name);await page.click('#roomSubmitBtn');}
  await page.waitForFunction(() => !document.getElementById('roomDialog').open && !document.getElementById('chatInput').disabled, null, { timeout: 20_000 });
}

async function sendChat(page, message) {
  await page.locator('#chatInput').fill(message);
  await page.locator('#sendChatBtn').click();
}

async function waitChat(page, message) {
  await page.waitForFunction(text => [...document.querySelectorAll('.chat-body')].some(element => element.textContent === text), message, { timeout: 12_000 });
}

async function closeInstance(instance) {
  if (!instance || instance.closed) return;
  instance.closed = true;
  await instance.app.close();
}

async function layoutSnapshot(page) {
  return page.evaluate(() => {
    const viewport = { width: innerWidth, height: innerHeight };
    const bounds = id => {
      const element = document.getElementById(id);
      const r = element.getBoundingClientRect();
      return { id, left: r.left, top: r.top, right: r.right, bottom: r.bottom,
        width: r.width, height: r.height, hidden: !element.checkVisibility(),
        overflowX: element.scrollWidth > element.clientWidth + 1,
        overflowY: element.scrollHeight > element.clientHeight + 1 };
    };
    return { viewport, document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      items: ['directoryPage','linkHost','linkFriends','navRequests','profileBtn','streamStage', 'voiceGrid', 'chatInput', 'sendChatBtn', 'micBtn', 'deafenBtn', 'shareBtn', 'settingsBtn', 'leaveBtn'].map(bounds) };
  });
}

async function assertNoControlClipping(page, label) {
  const snapshot = await layoutSnapshot(page);
  assert.ok(snapshot.document.width <= snapshot.viewport.width + 1, `${label}: horizontal document overflow`);
  assert.ok(snapshot.document.height <= snapshot.viewport.height + 1, `${label}: vertical document overflow`);
  for (const item of snapshot.items) {
    if (item.hidden) continue;
    assert.ok(item.width > 0 && item.height > 0, `${label}: ${item.id} zero-size`);
    assert.ok(item.left >= -1 && item.right <= snapshot.viewport.width + 1, `${label}: ${item.id} horizontally clipped`);
    assert.ok(item.top >= -1 && item.bottom <= snapshot.viewport.height + 1, `${label}: ${item.id} vertically clipped`);
  }
  return snapshot;
}

(async () => {
  try {
    const port = await unusedPort();
    const host = await launch('host', profiles[0]);
    const guest1 = await launch('guest1', profiles[1]);
    let guest2 = await launch('guest2', profiles[2]);
    const pHost = host.page;
    const p1 = guest1.page;
    let p2 = guest2.page;
    for (const p of [p1,p2]) await p.locator('#entryLater').click();
    await clickPath(pHost,'#startLogin');
    await pHost.locator('.account-help summary').click();
    assert.equal(await pHost.locator('#rememberAccount').isChecked(), false);
    await host.app.evaluate(({shell}) => { globalThis.qaExternalPages=[]; shell.openExternal=async url=>{globalThis.qaExternalPages.push(url);}; });
    await pHost.locator('#serviceSummary').click();
    await pHost.locator('#xmppProvider').selectOption('hotchilli');
    await pHost.locator('#accountHelpLink').click();
    await pHost.locator('#xmppProvider').selectOption('jabberes');
    await pHost.locator('#accountHelpLink').click();
    assert.deepEqual(await host.app.evaluate(()=>globalThis.qaExternalPages),[
      'https://jabber.hot-chilli.net/forms/remove/', 'https://www.jabberes.org/acerca-de/#contacto']);
    await pHost.locator('#closeInternet').click();
    check('Account help before login: optional saved login and both provider actions open only the intended pages');
    await pHost.click('#settingsBtn');
    await pHost.click('#testMic');
    await pHost.waitForFunction(()=>Number(document.querySelector('.test-meter').getAttribute('aria-valuenow'))>0);
    await pHost.click('[data-pane="profile"]');
    assert(await pHost.locator('#settingsDirect').isVisible());
    assert(await pHost.locator('#settingsLogin').isHidden());
    await pHost.click('[data-pane="voice"]');
    assert.equal(await pHost.textContent('#testMic'),'Проверить');
    assert.equal(await pHost.getAttribute('.test-meter','aria-valuenow'),'0');
    await pHost.evaluate(() => {
      const NativePeer = window.RTCPeerConnection;
      window.qaPeers = [];
      window.RTCPeerConnection = class extends NativePeer {
        constructor(...args) { super(...args); window.qaPeers.push(this); }
      };
      const NativeAudio = window.Audio;
      const nativeCreate = URL.createObjectURL.bind(URL);
      const nativeRevoke = URL.revokeObjectURL.bind(URL);
      window.qaPreview = {plays:0, elapsed:0, revokes:0};
      URL.createObjectURL = blob => {
        if (blob.type.startsWith('audio/')) window.qaPreview.blob = blob;
        return nativeCreate(blob);
      };
      URL.revokeObjectURL = url => { window.qaPreview.revokes++; nativeRevoke(url); };
      window.Audio = class extends NativeAudio {
        constructor(...args) {
          super(...args);
          this.addEventListener('playing', () => { window.qaPreview.plays++; });
          this.addEventListener('timeupdate', () => { window.qaPreview.elapsed = Math.max(this.currentTime, window.qaPreview.elapsed); });
        }
      };
    });
    await pHost.click('#testMic');
    await pHost.waitForFunction(() => document.querySelector('#testClock').textContent === 'Запись · 4 с');
    await pHost.waitForFunction(() => document.querySelector('#testClock').textContent === 'Запись · 3 с');
    assert(await pHost.locator('#testProgress').isVisible());
    await capture(pHost,'mic-recording');await pHost.screenshot({path:path.join(output,'mic-countdown.png')});
    await pHost.waitForFunction(() => window.qaPreview.plays === 1);
    await pHost.waitForFunction(() => document.querySelector('#testClock').textContent === 'Прослушивание · 3 с'
      && document.querySelector('#testTimeline').value >= 1);
    await capture(pHost,'mic-playback');
    await pHost.waitForFunction(() => window.qaPreview.revokes === 1 && document.querySelector('#testMic').dataset.phase === 'idle');
    assert(await pHost.locator('#testProgress').isHidden());
    check('Recording and playback clocks count down independently and disappear on completion');
    const preview = await pHost.evaluate(async () => {
      const bytes = await window.qaPreview.blob.arrayBuffer();
      const audio = new OfflineAudioContext(1, 1, 48000);
      const decoded = await audio.decodeAudioData(bytes);
      const samples = decoded.getChannelData(0);
      const rms = Math.sqrt(samples.reduce((sum,v) => sum + v*v,0) / samples.length);
      return {duration:decoded.duration, rms, playedSeconds:window.qaPreview.elapsed};
    });
    assert(preview.duration > 3 && preview.duration < 6 && preview.rms > .001 && preview.playedSeconds > 3, JSON.stringify(preview));
    check('Microphone check records processed audio, plays a non-silent clip locally and releases its blob URL', preview);
    await pHost.click('#closeSettingsDialog');
    check('Pre-call microphone check reads the selected synthetic input and stops on section change');
    const environment = await pHost.evaluate(() => window.craftlink.environment());
    assert.equal(environment.version, require('../package.json').version);
    assert.equal(environment.udpMin, 45832);
    assert.equal(environment.udpMax, 45863);
    const safety = await pHost.evaluate(() => ({ require: typeof require, process: typeof process, api: Object.keys(window.craftlink).sort() }));
    assert.equal(safety.require, 'undefined');
    assert.equal(safety.process, 'undefined');
    assert.ok(!safety.api.includes('ipcRenderer'));
    check('Three actual desktop instances initialize; isolated bridge IPC returns environment', environment);

    await pHost.screenshot({ path: path.join(output, 'desktop-initial-1440.png') });
    check('Initial1440×940 controls fit viewport', await assertNoControlClipping(pHost, 'initial1440'));

    await clickPath(pHost,'#createBtn');
    await pHost.click('#hubManual');
    await pHost.locator('#nameInput').fill('Анна QA');
    await pHost.locator('#addressInput').fill('127.0.0.1');
    await pHost.locator('#portInput').fill(String(port));
    await pHost.locator('#roomSubmitBtn').click();
    await pHost.waitForFunction(() => document.getElementById('inviteDialog').open, null, { timeout: 20_000 });
    const invite = await pHost.locator('#inviteOutput').inputValue();
    assert.ok(invite.startsWith('CL1:'));
    await pHost.locator('#inviteDoneBtn').click();
    await waitCount(pHost, 1);
    assert.equal(await pHost.locator('#micBtn').getAttribute('aria-pressed'), 'false');
    check('Host creates a TLS room through real UI, microphone remains off', { tcpPort: port, invitationBytes: invite.length });

    await join(guest1, invite, 'Друг один QA');
    await waitCount(pHost, 2); await waitCount(p1, 2);
    check('Second participant joins through invitation UI and actual pinned TLS');
    await guest2.app.evaluate(()=>{
      const tls=process.getBuiltinModule('tls'),connect=tls.connect;
      tls.connect=function(...args){const socket=connect.apply(this,args);globalThis.qaControlSocket=socket;return socket;};
    });
    if (result.liveMedia) await p2.evaluate(()=>{
      window.qaAudio=[];
      window.Audio=class extends Audio {
        constructor(...args){super(...args);window.qaAudio.push(this);}
      };
    });
    await join(guest2, invite, 'Друг два QA');
    for (const page of [pHost, p1, p2]) await waitCount(page, 3);
    check('Third participant joins and each UI shows all3 identities');

    await host.page.locator('#chatInput').fill('Одна отправка при двойном Enter');
    await host.page.evaluate(()=>{
      const form=document.querySelector('#chatForm'), input=document.querySelector('#chatInput');
      form.requestSubmit();form.requestSubmit();
      input.value='Новый черновик';input.dispatchEvent(new Event('input'));
    });
    await waitChat(guest1.page,'Одна отправка при двойном Enter');
    await host.page.waitForFunction(()=>!document.querySelector('#sendChatBtn').disabled);
    assert.equal(await host.page.inputValue('#chatInput'),'Новый черновик');
    assert.equal(await guest1.page.getByText('Одна отправка при двойном Enter',{exact:true}).count(),1);
    check('double submit delivered once and a newer draft survived pending delivery');
    const messages = ['Сообщение создателя <script>never executed</script>', 'Привет от первого друга', 'Привет от второго друга'];
    for (const [index, page] of [pHost, p1, p2].entries()) {
      await sendChat(page, messages[index]);
      for (const recipient of [pHost, p1, p2]) await waitChat(recipient, messages[index]);
    }
    assert.equal(await pHost.locator('#chatMessages script').count(), 0);
    check('All3 participants exchange text through UI and TLS; HTML remains literal text');

    await clickPath(pHost,'#networkHelpBtn');
    await pHost.waitForFunction(() => document.querySelector('#mediaDiagnostics').textContent.includes('Источник 2'));
    await pHost.locator('#copyDiagnosticsBtn').click();
    const copied = await host.app.evaluate(({ clipboard }) => clipboard.readText());
    for (const field of ['Мой слот 0', 'Источник 1', 'Источник 2', 'кадров декодировано']) assert.ok(copied.includes(field));
    for (const secret of [invite, 'CL1:', '127.0.0.1', 'Анна QA', ...messages]) assert.ok(!copied.includes(secret));
    await pHost.locator('#closeNetworkDialog').click();
    check('The copy-report button returns per-slot inbound counters through the real bridge without chat, IP, name or invite');

    await roomMix(pHost,1);
    await pHost.locator('#menu-mix-1-voice').focus(); await pHost.keyboard.press('Home');
    await pHost.locator('#menu-mix-1-system').focus(); await pHost.keyboard.press('End');
    await roomMix(pHost,1);
    assert.equal(await pHost.locator('#menu-mix-1-voice').inputValue(), '0');
    assert.equal(await pHost.locator('#menu-mix-1-system').inputValue(), '200');
    await roomMix(pHost,2);
    assert.equal(await pHost.locator('#menu-mix-2-voice').inputValue(), '100');
    assert.equal(await pHost.locator('#menu-mix-2-system').inputValue(), '100');
    await roomMix(p2,1);
    assert.equal(await p2.locator('#menu-mix-1-voice').inputValue(), '100');
    assert.equal(await p2.locator('#menu-mix-1-system').inputValue(), '100');
    await roomMix(pHost,1);
    const voiceRow = pHost.locator('.mixer-row').filter({ has: pHost.locator('#menu-mix-1-voice') });
    const streamRow = pHost.locator('.mixer-row').filter({ has: pHost.locator('#menu-mix-1-system') });
    await voiceRow.locator('button').click();
    assert.equal(await voiceRow.locator('button').getAttribute('aria-pressed'), 'true');
    assert.equal(await streamRow.locator('button').getAttribute('aria-pressed'), 'false');
    await streamRow.locator('button').click();
    assert.equal(await streamRow.locator('button').getAttribute('aria-pressed'), 'true');
    assert.equal(await p2.locator('.mixer-row').filter({ has: p2.locator('#menu-mix-1-system') }).locator('button').getAttribute('aria-pressed'), 'false');
    await closeRoomMenu(pHost);await closeRoomMenu(p2);
    check('Per-person voice/stream sliders reach0/200 and independent local mute UI does not affect other participants');

    await pHost.locator('#deafenBtn').click();
    assert.equal(await pHost.locator('#deafenBtn').getAttribute('aria-pressed'), 'true');
    assert.equal(await pHost.locator('#micBtn').getAttribute('aria-pressed'), 'false');
    await pHost.locator('#deafenBtn').click();
    assert.equal(await pHost.locator('#deafenBtn').getAttribute('aria-pressed'), 'false');
    check('Master deafen toggles independently from microphone state');

    // No --use-fake-ui-for-media-stream: the real Electron permission handler
    // must approve audio and reject camera; only the physical device is fake.
    await pHost.locator('#micBtn').click();
    await pHost.waitForFunction(() => document.getElementById('micBtn').getAttribute('aria-pressed') === 'true', null, { timeout: 8000 });
    await pHost.click('#settingsBtn');
    await pHost.click('#testMic');
    await pHost.waitForFunction(() => document.querySelector('#testMic').dataset.phase === 'playing');
    const voiceEnabled = () => pHost.evaluate(() => window.qaPeers.filter(pc => pc.connectionState === 'connected')
      .map(pc => pc.getTransceivers().find(t => t.mid === '0')?.sender.track?.enabled));
    assert.deepEqual(await voiceEnabled(), [false, false]);
    assert.equal(await pHost.getAttribute('#micBtn','aria-pressed'), 'true');
    await pHost.click('#testMic');
    assert.deepEqual(await voiceEnabled(), [true, true]);
    await pHost.click('#closeSettingsDialog');
    check('Local playback pauses both outgoing voice tracks and cancellation restores their original state');
    await pHost.locator('#micBtn').click();
    await pHost.waitForFunction(() => document.getElementById('micBtn').getAttribute('aria-pressed') === 'false');
    check('Synthetic microphone opens and mutes through real main-frame permission handler');
    const camera = await p1.evaluate(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        stream.getTracks().forEach(track => track.stop());
        return { allowed: true };
      } catch (error) { return { allowed: false, error: error.name }; }
    });
    assert.equal(camera.allowed, false, 'Camera is not an application permission');
    check('Unneeded camera access is denied', camera);

    await p2.locator('#settingsBtn').click();
    await p2.locator('#micGain').focus();
    await p2.keyboard.press('Home');
    for (let index = 0; index < 14; index++) await p2.keyboard.press('ArrowRight');
    await p2.click('[data-pane="stream"]');
    await p2.locator('#qualitySelect').selectOption('720p30');
    await p2.locator('#bitrateSelect').selectOption('4');
    await p2.click('[data-pane="voice"]');
    await p2.locator('#echoCancellation').uncheck();
    await p2.locator('#noiseSuppression').uncheck();
    await p2.locator('#autoGainControl').check();
    const settingsBefore = await p2.evaluate(() => JSON.parse(localStorage.getItem('craftlink.settings.v1')));
    assert.equal(settingsBefore.micGain, 14);
    assert.equal(settingsBefore.quality, '720p30');
    assert.equal(settingsBefore.bitrate, 4);
    assert.equal(settingsBefore.echoCancellation, false);
    assert.equal(settingsBefore.noiseSuppression, false);
    assert.equal(settingsBefore.autoGainControl, true);
    await p2.screenshot({ path: path.join(output, 'desktop-settings-1440.png') });
    await p2.locator('#closeSettingsDialog').click();
    check('Microphone processing, gain and stream-quality settings save locally');

    await pHost.screenshot({ path: path.join(output, 'desktop-room-1440.png') });
    await pHost.setViewportSize({ width: 1000, height: 700 });
    await pHost.screenshot({ path: path.join(output, 'desktop-room-1000.png') });
    check('Three-participant1000×700 layout fits, essential controls remain inside viewport', await assertNoControlClipping(pHost, 'room1000'));
    const avatar = await pHost.locator('#profileAvatar').boundingBox();
    assert(avatar && avatar.width >= 28 && avatar.height >= 28);
    await roomChat(pHost);
    const compact = await pHost.locator('#roomPage').evaluate(page => page.classList.contains('compact-room'));
    const stageWithChat = await pHost.locator('#streamStage').boundingBox();
    await pHost.click('#closeRoomChat');
    const expanded = await pHost.locator('#streamStage').boundingBox();
    if(compact)assert(Math.abs(expanded.width - stageWithChat.width) <= 1);
    else assert(expanded.width - stageWithChat.width > 200);
    assert.equal(await pHost.locator('#chatInput').isVisible(), false);
    await roomChat(pHost);
    assert(await pHost.locator('#chatInput').isVisible());
    check('Room chat opens and closes at minimum size; the stage retains its width in overlay mode',
      {compact,regular:stageWithChat,expanded});
    await pHost.setViewportSize({ width: 1440, height: 940 });

    // Two test sources and a real canvas track exercise the normal picker and
    // sender lifecycle without reading a private screen or a physical device.
    for (const instance of [host, guest2]) {
      await instance.app.evaluate(({ desktopCapturer }) => {
        desktopCapturer.getSources = async () => [
          { id: 'screen:77:0', name: 'Synthetic QA desktop' }, { id: 'window:78:0', name: 'Synthetic QA window' },
        ];
      });
      await instance.page.evaluate(() => {
        window.qaCaptures = [];
        navigator.mediaDevices.getDisplayMedia = async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 320; canvas.height = 180;
          const ctx = canvas.getContext('2d');
          ctx.fillRect(0, 0, 320, 180);
          const stream = canvas.captureStream(12);
          let frame = 0;
          const timer = setInterval(() => {
            if (stream.getVideoTracks()[0].readyState !== 'live') { clearInterval(timer); return; }
            ctx.fillStyle = frame++ % 2 ? '#44aa88' : '#113344';
            ctx.fillRect(0, 0, 320, 180);
          }, 80);
          window.qaCaptures.push(stream);
          return stream;
        };
      });
    }
    const shareSynthetic = async (tab, page=p2) => {
      await page.locator('#shareBtn').click();
      await page.locator(tab).click();
      if (await page.locator('#withSystemAudio').isChecked()) await page.locator('#withSystemAudio').uncheck();
      await page.locator('#sourcesGrid .source-card').first().click();
      assert.equal(await page.locator('#sourceDialog').isVisible(),true);
      await page.click('#startShare');
      await page.waitForFunction(() => !document.querySelector('#sourceDialog').open);
    };
    await p2.click('#shareBtn');assert(await p2.locator('#startShare').isDisabled());
    await p2.locator('#sourcesGrid .source-card').first().click();
    await p2.screenshot({path:path.join(output,'source-picker.png')});
    await p2.click('#closeSourceDialog');assert.equal(await p2.evaluate(()=>window.qaCaptures.length),0);
    check('Picker selection previews a choice; cancelling never starts capture');
    await shareSynthetic('#screenTabBtn');
    await p2.waitForFunction(() => document.querySelector('#sourcesGrid').childElementCount === 0);
    assert.equal(await p2.locator('.tile-watch:visible').count(),0);
    assert.equal(await p2.locator('.stage-column video').count(), 1);
    check('Single broadcast has one video element and the closed picker releases all previews');
    await shareSynthetic('#screenTabBtn', pHost);
    const choices = p1.locator('.tile-watch:visible');
    await p1.waitForFunction(() => document.querySelectorAll('.tile-watch:not([hidden])').length === 2);
    for (const button of await choices.all()) {
      await button.click();
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      assert.equal(await button.getAttribute('aria-label'),'Смотреть трансляцию '+await p1.textContent('#stageName'));
    }
    assert.equal(await p1.locator('.stage-column video').count(), 1);
    await pHost.click('#stopShareBtn');
    await p1.waitForFunction(() => !document.querySelector('.tile-watch:not([hidden])'));
    check('Two broadcasters switch by name in one player and the chooser disappears after one stops');
    await shareSynthetic('#windowTabBtn');
    const captureStates = () => p2.evaluate(() => window.qaCaptures.map(s => s.getVideoTracks()[0].readyState));
    assert.deepEqual(await captureStates(), ['ended', 'live']);
    await p2.locator('#stopShareBtn').click();
    await p2.waitForFunction(() => document.querySelector('#stopShareBtn').hidden);
    assert.deepEqual(await captureStates(), ['ended', 'ended']);
    check('Real picker and sender replacement release the preceding synthetic capture and stop the active one');
    await shareSynthetic('#screenTabBtn');
    if (process.argv.includes('--live-media')) {
      await p2.locator('#micBtn').click();
      await shareSynthetic('#screenTabBtn',pHost);
      await p2.getByRole('button',{name:'Смотреть трансляцию Анна QA',exact:true}).click();
      await p2.waitForFunction(()=>document.querySelector('#remoteVideo').videoWidth>0 &&
        window.qaAudio.some(el=>el.srcObject?.getAudioTracks().length));
      await p2.evaluate(()=>{window.qaOldPlayback=window.qaAudio.filter(el=>el.srcObject?.getAudioTracks().length);});
      for (const receiver of [pHost, p1]) await clickPath(receiver,'#networkHelpBtn');
      const oldPeer=await pHost.locator('.voice-tile').filter({hasText:'Друг два QA'}).getAttribute('data-peer-id');
      await guest2.app.evaluate(()=>globalThis.qaControlSocket.destroy());
      await p2.waitForFunction(()=>document.querySelector('#statusText').textContent==='Восстанавливаем связь…' &&
        document.querySelector('#remoteVideo').srcObject===null && window.qaOldPlayback.every(el=>el.paused && el.srcObject===null));
      await pHost.waitForFunction(old=>[...document.querySelectorAll('.voice-tile')].some(card=>card.textContent.includes('Друг два QA') && card.dataset.peerId!==old),oldPeer);
      await p2.waitForFunction(()=>document.querySelector('#micBtn').getAttribute('aria-pressed')==='true' && !document.querySelector('#stopShareBtn').hidden);
      await sendChat(p2,'После потери TCP');await waitChat(pHost,'После потери TCP');
      await p2.waitForFunction(()=>document.querySelector('#remoteVideo').videoWidth>0 &&
        window.qaAudio.some(el=>!window.qaOldPlayback.includes(el) && el.srcObject?.getAudioTracks().length));
      await pHost.click('#stopShareBtn');
      check('Broken TLS socket automatically rejoins the pinned room with capture and microphone retained');
      // Exercise the production close handler with a real BrowserWindow. Linux CI supplies
      // only the shell surface that normally belongs to Explorer's notification area.
      const hidden=await guest2.app.evaluate(({ app, BrowserWindow, Menu })=>{
        const win=BrowserWindow.getAllWindows()[0];
        if(process.platform!=='win32'){
          const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json');
          const tray=new (req('node:events').EventEmitter)();
          Object.assign(tray,{setToolTip(){},setContextMenu(){},displayBalloon(){},isDestroyed:()=>false});
          let quitting=false;app.once('before-quit',()=>{quitting=true;});
          req('./src/tray.cjs').attachTray({window:win,tray,menu:Menu,quit:()=>app.quit(),isQuitting:()=>quitting});
        }
        win.close();
        return !win.isDestroyed() && !win.isVisible();
      });
      assert.equal(hidden,true);
      // Use exactly the report available to someone testing the portable build.
      const deliveries = await Promise.all([pHost, p1].map(async receiver => {
        const handle = await receiver.waitForFunction(() => {
          const text = document.querySelector('#mediaDiagnostics').textContent;
          const matches = text.match(/Источник 2 · голос (\d+) Б · экран (\d+) Б · звук стрима \d+ Б · кадров декодировано (\d+)/);
          if (!matches) return false;
          const now = matches.slice(1).map(Number);
          const before = window.qaLastDelivery;
          window.qaLastDelivery = now;
          return before && before.every((value, i) => value > 0 && now[i] > value) ? { before, now } : false;
        }, null, { timeout: 30000, polling: 500 });
        return handle.jsonValue();
      }));
      check('Live: guest microphone RTP and synthetic display frames advance at both host and another guest through real TLS room UI', deliveries);
      assert.ok(await guest2.app.evaluate(({app,BrowserWindow})=>{
        app.emit('second-instance'); return BrowserWindow.getAllWindows()[0].isVisible();
      }));
      check('Closing the sharing window hides it; voice RTP and decoded frames keep growing until the same window reopens');
      for (const receiver of [pHost, p1]) await receiver.locator('#closeNetworkDialog').click();
    }
    await p2.locator('#leaveBtn').click();
    await waitCount(p2, 0); await waitCount(pHost, 2); await waitCount(p1, 2);
    assert.deepEqual(await captureStates(), ['ended', 'ended', 'ended']);
    check('Leaving the room stops every synthetic display track');
    await roomMix(pHost,1);
    assert.equal(await pHost.locator('#menu-mix-1-voice').inputValue(), '0');
    assert.equal(await pHost.locator('#menu-mix-1-system').inputValue(), '200');
    await sendChat(p1, 'Оставшаяся комната продолжает работать');
    await waitChat(pHost, 'Оставшаяся комната продолжает работать');
    check('Guest departure leaves the room and surviving participant local volume settings intact');

    await closeInstance(guest2);
    guest2 = await launch('guest2-restarted', profiles[2]);
    p2 = guest2.page;
    await p2.locator('#settingsBtn').click();
    assert.equal(await p2.locator('#micGain').inputValue(), '14');
    assert.equal(await p2.locator('#qualitySelect').inputValue(), '720p30');
    assert.equal(await p2.locator('#bitrateSelect').inputValue(), '4');
    assert.equal(await p2.locator('#echoCancellation').isChecked(), false);
    assert.equal(await p2.locator('#noiseSuppression').isChecked(), false);
    assert.equal(await p2.locator('#autoGainControl').isChecked(), true);
    const storage = await p2.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    assert.deepEqual(Object.keys(storage), ['craftlink.settings.v1']);
    assert.ok(!JSON.stringify(storage).includes('CL1:'));
    for (const message of messages) assert.ok(!JSON.stringify(storage).includes(message));
    await p2.locator('#closeSettingsDialog').click();
    check('Settings survive real application restart; invitation/chat are absent from Local Storage');

    await join(guest2, invite, 'Друг два снова QA');
    for (const page of [pHost, p1, p2]) await waitCount(page, 3);
    assert.equal(await p2.locator('.chat-message').count(), 0, 'No old chat replayed to rejoining guest');
    await sendChat(p2, 'Вернулся по приглашению');
    for (const page of [pHost, p1, p2]) await waitChat(page, 'Вернулся по приглашению');
    check('Guest rejoins same room after process restart and all3 continue chatting');

    // Test both branches of the actual in-app confirmation, not a stubbed
    // window.confirm or a platform-native dialog that cannot run headlessly.
    await pHost.locator('#leaveBtn').click();
    await pHost.locator('#confirmNoBtn').waitFor({ state: 'visible' });
    await pHost.screenshot({ path: path.join(output, 'desktop-confirm-1440.png') });
    await pHost.locator('#confirmNoBtn').click();
    for (const page of [pHost, p1, p2]) await waitCount(page, 3);
    await sendChat(p1, 'После отмены завершения все остаются в комнате');
    for (const page of [pHost, p1, p2]) await waitChat(page, 'После отмены завершения все остаются в комнате');
    check('Host leave cancellation preserves all3 participants and working chat');

    await pHost.locator('#leaveBtn').click();
    await pHost.locator('#confirmYesBtn').click();
    for (const page of [pHost, p1, p2]) await waitCount(page, 0);
    for (const page of [pHost, p1, p2]) {
      assert.equal(await page.locator('#chatInput').isDisabled(), true);
      assert.equal(await page.locator('#micBtn').isDisabled(), true);
      assert.equal(await page.locator('#shareBtn').isDisabled(), true);
      assert.equal(await page.locator('#inviteOutput').inputValue(), '');
    }
    check('Host confirms leave in actual HTML dialog; room closes for all guests and capture/chat controls disable');

    await clickPath(pHost,'#createBtn');
    await pHost.click('#hubManual');
    await pHost.locator('#roomSubmitBtn').click();
    await pHost.waitForFunction(() => document.getElementById('inviteDialog').open, null, { timeout: 20_000 });
    const newInvite = await pHost.locator('#inviteOutput').inputValue();
    assert.notEqual(newInvite, invite, 'A new room must have fresh credentials');
    await pHost.locator('#inviteDoneBtn').click();
    await join(guest1, newInvite, 'Друг один, новая комната');
    await join(guest2, newInvite, 'Друг два, новая комната');
    for (const page of [pHost, p1, p2]) await waitCount(page, 3);
    check('Host recreates room on same port with a fresh invitation and both guests reconnect');
    await closeInstance(host);
    for (const page of [p1, p2]) {
      await waitCount(page, 0);
      assert.equal(await page.locator('#chatInput').isDisabled(), true);
      assert.equal(await page.locator('#micBtn').isDisabled(), true);
      assert.equal(await page.locator('#shareBtn').isDisabled(), true);
    }
    check('Actual host process quit also closes both guests cleanly');

    assert.deepEqual(result.pageErrors, [], 'No uncaught JavaScript errors in actual renderers');
    check('No uncaught renderer JavaScript errors');
    result.passed = true;
  } catch (error) {
    result.passed = false;
    result.failure = error.stack || String(error);
    console.error(error);
    result.failureUI = [];
    for (const instance of instances.filter(item => !item.closed && item.page)) {
      result.failureUI.push(await instance.page.evaluate(label => ({ label,
        status: document.getElementById('statusText')?.textContent,
        diagnostics: document.getElementById('mediaDiagnostics')?.textContent,
        count: document.getElementById('participantsCount')?.textContent,
        error: document.getElementById('roomError')?.textContent,
        toast: document.getElementById('toast')?.textContent,
      }), instance.label).catch(error => ({ label: instance.label, error: error.message })));
      await instance.page.screenshot({ path: path.join(output, `desktop-failure-${instance.label}.png`) }).catch(() => {});
    }
    process.exitCode = 1;
  } finally {
    await Promise.all(instances.map(instance => closeInstance(instance).catch(() => {})));
    result.finished = new Date().toISOString();
    const file = result.liveMedia ? 'desktop-live-report.json' : 'desktop-report.json';
    fs.writeFileSync(path.join(output, file), JSON.stringify(result, null, 2));
    console.log(`Desktop QA: ${result.passed ? 'PASS' : 'FAIL'}; ${result.checks.length} checks. out/qa/${file}`);
  }
})();
