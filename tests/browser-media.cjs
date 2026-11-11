'use strict';
// Exercise the renderer on platforms where the Electron QA runtime is unavailable.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {setTimeout: sleep} = require('node:timers/promises');
const {chromium} = require(require.resolve('playwright', {paths: [__dirname, process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || __dirname]}));

async function run() {
  const minutes = Number(process.argv[2] || 2);
  assert(Number.isInteger(minutes) && minutes >= 2 && minutes <= 540);
  const origin = 'http://127.0.0.1:45831';
  const root = path.resolve(__dirname, '..');
  const browser = await chromium.launch({channel: process.env.LINK_QA_BROWSER || undefined,
    args: ['--allow-loopback-in-peer-connection', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']});
  // A failed renderer launch or a pending device request must not keep the test process alive.
  const deadline=setTimeout(()=>browser.close().catch(()=>{}),(minutes*60+120)*1000);
  try {
    const context = await browser.newContext();
    // Only these fixture resources exist on this synthetic origin. No HTTP listener or external signaling.
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/') return route.fulfill({contentType:'text/html', body:'<!doctype html><body></body>'});
      if (url.pathname === '/src/renderer/l10n/en.json') return route.fulfill({contentType:'application/json',body:await fs.readFile(path.join(root,'src/renderer/l10n/en.json'))});
      if (!/^\/(tests\/(watch-buffer-lab|file-recovery-lab)|src\/renderer\/[a-z-]+)\.mjs$/.test(url.pathname)) return route.abort();
      return route.fulfill({contentType:'text/javascript', body:await fs.readFile(path.join(root,url.pathname.slice(1)))});
    });
    await context.addInitScript(() => {
      const id = new URL(location.href).searchParams.get('id');
      const channel = new BroadcastChannel('link-qa');
      window.qaBridge = {
        signal(message) { channel.postMessage({from:id, ...message}); },
        onSignal(callback) { channel.onmessage = ({data}) => { if (data.peerId === id) callback(data); }; },
      };
    });
    const ids = ['host','g1','g2'];
    const pages = new Map();
    for (const id of ids) {
      const page = await context.newPage();
      await page.goto(origin+'/?id='+id);
      await page.evaluate(async () => { window.lab=await import('/tests/watch-buffer-lab.mjs'); });
      pages.set(id,page);
    }
    const call = (id,method,...args) => pages.get(id).evaluate(([method,args])=>window.lab[method](...args),[method,args]);
    const file = await pages.get('host').evaluate(async ()=>(await import('/tests/file-recovery-lab.mjs')).recover());
    console.log('FILE',JSON.stringify(file));
    await Promise.all(ids.map(id=>call(id,'init',0,3,id!=='g2')));
    for (const id of ['g1','g2','host']) await call(id,'roster',3);
    await pages.get('g2').bringToFront();
    await pages.get('g2').waitForFunction(() => window.lab.canObserve(0) && window.lab.canObserve(1),null,{timeout:45000});
    const started=performance.now(), duration=minutes*60000;
    let cycle=0, maxSkew=0, decoded=0;
    do {
      const slot=cycle%2;
      await call('g2','selectShow',slot,slot===0?500:0);
      for(const phase of ['switch','settled']){
        if(phase==='settled')await sleep(Math.max(0,Math.min(12000,duration-(performance.now()-started)-4000)));
        const m=await call('g2','observe',slot,4000);
        console.log('SWITCH',JSON.stringify({cycle,slot,phase,...m}));
        assert(m.samples>20 && m.roles.screen.frames>12 && m.roles.screen.bytes>0);
        assert(m.roles.voice.bytes>0 && m.roles.system.bytes>0 && m.issues.length===0);
        assert(Number.isFinite(m.skewMs) && Math.abs(m.skewMs)<400,'Excessive screen/sound skew');
        maxSkew=Math.max(maxSkew,Math.abs(m.skewMs));decoded+=m.roles.screen.frames;
      }
      cycle++;
    } while (performance.now()-started<duration);
    const closed=await Promise.all(ids.map(id=>call(id,'finishCall')));
    for(const counts of closed)assert.deepEqual(counts,{endpoints:0,mixerSources:0,generatedLive:0});
    console.log('PASS browser media',JSON.stringify({browser:browser.version(),elapsedMs:Math.floor(performance.now()-started),
      windows:cycle*2,framesInWindows:decoded,maxWindowMedianSkewMs:maxSkew,closed}));
  } finally { clearTimeout(deadline); await browser.close(); }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
