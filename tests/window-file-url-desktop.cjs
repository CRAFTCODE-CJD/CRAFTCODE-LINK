'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');

// The development Electron runtime honors an external entry point. A packaged
// product executable may ignore it and start its normal user interface.
function checkWindowsInstallPath() {
  const root = path.resolve(__dirname, '..');
  const electronModule = require.resolve('electron', {paths:[root]});
  const runtime = require('./electron-runtime.cjs').testRuntime();
  const resources = path.join(path.dirname(runtime), 'resources');
  assert(fs.existsSync(path.join(resources, 'default_app.asar')));

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'link-ui-path-'));
  const dependencies = path.join(temp, 'node_modules');
  try {
    fs.symlinkSync(path.resolve(path.dirname(electronModule), '..'), dependencies, 'junction');
    for(const folder of ['CRAFTCODE-LINK','LINK 100%25 # выпуск']){
      const install = path.join(temp, folder);
      fs.cpSync(path.join(root, 'src'), path.join(install, 'src'), {recursive:true});
      fs.copyFileSync(path.join(root, 'package.json'), path.join(install, 'package.json'));
      const expected = pathToFileURL(path.join(install, 'src', 'renderer', 'index.html')).href;
      const result = spawnSync(runtime, [__filename, '--craftlink-profile=url-test'], {
        windowsHide:true, encoding:'utf8', timeout:30000,
        env:{...process.env, LINK_QA_URL_INSTALL:install, LINK_QA_URL_TEMP:temp}
      });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const {url, hidden, version} = JSON.parse(fs.readFileSync(path.join(install, 'result.json'), 'utf8'));
      assert.equal(url, expected);
      assert.equal(hidden, true);
      assert.equal(version, require(path.join(root, 'package.json')).version);
      console.log('PASS hidden Windows startup and trusted renderer IPC in '+folder);
    }
  } finally {
    if(fs.lstatSync(dependencies,{throwIfNoEntry:false})?.isSymbolicLink())fs.unlinkSync(dependencies);
    fs.rmSync(temp, {recursive:true, force:true, maxRetries:5, retryDelay:150});
  }
}

function startIsolatedApp() {
  const {app, dialog} = require('electron');
  const install = process.env.LINK_QA_URL_INSTALL, temp = process.env.LINK_QA_URL_TEMP;
  assert(process.defaultApp && path.dirname(install) === temp && fs.realpathSync(temp).startsWith(fs.realpathSync(os.tmpdir())+path.sep));
  const privateData = path.join(install, 'data');
  fs.mkdirSync(privateData);
  for (const name of ['appData','userData','sessionData','downloads']) app.setPath(name, privateData);
  app.getVersion = () => require(path.join(install, 'package.json')).version;
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('noerrdialogs');
  dialog.showErrorBox = (title, message) => {console.error(title, message);app.exit(1);};
  dialog.showMessageBox = async () => ({response:0});
  app.on('browser-window-created', (_, win) => {
    win.show = win.showInactive = win.focus = () => {};
    win.webContents.once('did-finish-load', async () => {
      try {
        const {version} = await win.webContents.executeJavaScript('window.craftlink.environment()');
        fs.writeFileSync(path.join(install, 'result.json'), JSON.stringify({url:win.webContents.getURL(), hidden:!win.isVisible(), version}));
        app.exit(0);
      } catch (error) {console.error(error);app.exit(1);}
    });
  });
  try{require(path.join(install, 'src', 'entry.cjs'));}
  catch(error){console.error(error);app.exit(1);}
}

if (process.versions.electron) startIsolatedApp();
else if (process.platform === 'win32') checkWindowsInstallPath();
else console.log('SKIP Windows file URL startup on this platform.');
