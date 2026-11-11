'use strict';
// Tests the production tray handlers on a real Electron BrowserWindow. Linux
// headless needs an adapter for the notification-area icon and context menu.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require(require.resolve('playwright', {
  paths: [__dirname, process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || __dirname],
}));
const {descendants}=require('./linux-process-tree.cjs');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'link-tray-'));
const root = path.join(__dirname, '..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function running(pid) {
  try { return !/^\d+ \(.*\) [ZX]/.test(fs.readFileSync('/proc/'+pid+'/stat','utf8')); }
  catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
(async () => {
  if(process.platform !== 'linux') throw Error('Use windows-processes.ps1 for the installed Windows build');
  const client = await _electron.launch({executablePath: require('electron'),
    args: ['--headless','--ozone-platform=headless','--no-sandbox',root,'--craftlink-profile=tray'],
    env: {...process.env, XDG_CONFIG_HOME:scratch}});
  try {
    const page=await client.firstWindow();
    await page.waitForSelector('#entryStart');
    const before=await client.evaluate(({app,BrowserWindow}, trayModule) => {
      const localRequire=process.getBuiltinModule('node:module').createRequire(trayModule);
      const {EventEmitter}=localRequire('node:events');
      const win=BrowserWindow.getAllWindows()[0];
      const icon=Object.assign(new EventEmitter(),{
        isDestroyed:()=>false, destroy(){}, setToolTip(){}, displayBalloon(){},
        setContextMenu(menu){this.menu=menu;},
      });
      let quitting=false;
      localRequire(trayModule).attachTray({window:win,tray:icon,menu:{buildFromTemplate:menu=>menu},
        isQuitting:()=>quitting,quit:()=>{quitting=true;app.quit();}});
      globalThis.trayQA=icon;
      return [process.pid,win.id,win.webContents.getOSProcessId()];
    },path.resolve(root,'src/tray.cjs'));
    for(let i=0;i<12;i++){
      const result=await client.evaluate(({BrowserWindow})=>{
        const [win]=BrowserWindow.getAllWindows();
        win.close();
        const hidden=!win.isVisible();
        globalThis.trayQA.emit('click');
        return {hidden,visible:win.isVisible(),windows:BrowserWindow.getAllWindows().length,ids:[process.pid,win.id,win.webContents.getOSProcessId()]};
      });
      assert.deepEqual(result,{hidden:true,visible:true,windows:1,ids:before});
    }
    const pids=descendants().map(p=>p.id);
    assert(pids.length>=3,'Expected an Electron process tree before quitting');
    const closed=client.waitForEvent('close');
    const maintenance = process.argv.includes('--maintenance');
    if(maintenance) {
      await client.evaluate(({BrowserWindow})=>{
        const win=BrowserWindow.getAllWindows()[0];
        win.close();
        if(win.isVisible())throw Error('Expected a hidden window before maintenance');
        // Linux has no Windows Restart Manager. Deliver its Electron event to the actual hidden window.
        setTimeout(()=>win.emit('query-session-end',{reasons:['close-app']}),100);
      });
    } else {
      await client.evaluate(()=>{setTimeout(()=>globalThis.trayQA.menu.at(-1).click(),100);});
    }
    await closed;
    for(let i=0;i<100 && pids.some(running);i++)await wait(100);
    assert.deepEqual(pids.filter(running),[]);
    console.log('PASS 12 tray close/open cycles with one window and unchanged main/renderer PIDs; tray exit stopped all '+pids.length+' observed child processes ('+(maintenance?'maintenance event':'tray menu')+').');
  } finally {await client.close().catch(()=>{});fs.rmSync(scratch,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
