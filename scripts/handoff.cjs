'use strict';
// Assemble a self-contained Windows + canonical source handoff. No publication.
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const out = path.join(root, 'out');
const portable = path.join(out, `CRAFTCODE-LINK-${version}-win-x64`);
const installerRelease = process.argv.includes('--installer');
const base = `CRAFTCODE-LINK-${version}-${installerRelease ? 'Installer-Handoff' : 'Windows-x64'}`;
const bundle = path.join(out, base);
const sourceNames = ['AGENTS.md', 'src', 'native', 'installer', 'scripts', 'tests', 'package.json', 'package-lock.json', 'README_RU.md', 'README.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE', 'QA_REPORT.md', 'WORK_HANDOFF_RU.md', 'MESSENGER_ROADMAP_RU.md', 'FIRST_START_RU.txt', 'IMPLEMENTATION_CONTRACT.md', 'START.cmd', 'BUILD-WINDOWS.cmd', 'TEST-RTP.cmd', 'CHECK-STREAM-AUDIO.cmd', 'WINDOWS_TEST_RU.md', 'QA_EVIDENCE.json', 'FRIENDS_RU.md'];

async function hash(file) {
  const h = crypto.createHash('sha256');
  for await (const block of fss.createReadStream(file)) h.update(block);
  return h.digest('hex');
}
async function manifest(directory) {
  const lines = [];
  async function walk(current) {
    for (const entry of (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name !== 'FILES.sha256') lines.push(`${await hash(full)}  ${path.relative(directory, full).split(path.sep).join('/')}`);
    }
  }
  await walk(directory);
  await fs.writeFile(path.join(directory, 'FILES.sha256'), lines.join('\n') + '\n');
}
function zip(file, cwd, item) {
  if (fss.existsSync(file)) throw new Error(`Archive already exists: ${file}`);
  let result;
  if (process.platform === 'win32') {
    result = spawnSync('tar.exe', ['-a', '-cf', file, item], { cwd, stdio: 'inherit' });
  } else result = spawnSync('zip', ['-q', '-r', '-9', file, item], { cwd, stdio: 'inherit' });
  if (result.status !== 0 || result.error) throw result.error || new Error('ZIP creation failed');
}
(async () => {
  if (fss.existsSync(bundle)) throw new Error(`Handoff already exists: ${bundle}`);
  if (!fss.existsSync(path.join(portable, 'CRAFTCODE-LINK.exe'))) throw new Error('Build portable Windows output first.');
  await require('./package-win.cjs').verifyAppSource(path.join(root, 'src'), path.join(portable, 'resources', 'app', 'src'));
  if (installerRelease) await fs.mkdir(bundle);
  else await fs.cp(portable, bundle, { recursive: true });
  const source = path.join(bundle, 'SOURCE');
  await fs.mkdir(source);
  for (const name of [...sourceNames,'.gitignore','.github','docs','CONTRIBUTING.md','licenses','third-party-sources']) {
    await fs.cp(path.join(root, name), path.join(source, name), {
      recursive: true, filter: file => path.basename(file) !== '__pycache__',
    });
    if (/\.md$/.test(name) || name === 'FIRST_START_RU.txt') await fs.copyFile(path.join(root, name), path.join(bundle, name));
  }
  await fs.copyFile(path.join(portable,require('./third-party-notices.cjs').noticeName),path.join(source,'THIRD-PARTY-NPM.txt'));
  await fs.copyFile(path.join(portable,'LICENSE'),path.join(source,'licenses','Electron-LICENSE.txt'));
  await fs.copyFile(path.join(portable,'LICENSES.chromium.html'),path.join(source,'licenses','LICENSES.chromium.html'));
  await manifest(source);
  const fullZip = path.join(out, `${base}.zip`);
  const sourceZip = path.join(out, `CRAFTCODE-LINK-${version}-Source.zip`);
  if (!installerRelease) zip(fullZip, out, base);
  zip(sourceZip, bundle, 'SOURCE');
  const artifacts = [];
  if (installerRelease) {
    const portableName = `CRAFTCODE-LINK-${version}-Portable-x64`;
    const portableZip = path.join(out, portableName + '.zip');
    const python = process.platform === 'win32' ? 'python' : 'python3';
    const result = spawnSync(python, [path.join(root, 'scripts', 'package-portable.py'),
      portable, portableZip], { stdio: 'inherit' });
    if (result.status !== 0 || result.error) throw result.error || new Error('Portable ZIP creation failed.');
    artifacts.push({ file: portableZip, bytes: (await fs.stat(portableZip)).size, sha256: await hash(portableZip) });
  }
  const application = installerRelease ? path.join(out, `CRAFTCODE-LINK-${version}-Setup-x64.exe`) : fullZip;
  for (const file of [application, sourceZip]) artifacts.push({ file, bytes: (await fs.stat(file)).size, sha256: await hash(file) });
  if(installerRelease){
    const code=path.join(out,`CRAFTCODE-LINK-${version}-Update-Code.txt`);
    const digest=artifacts.find(a=>a.file===application).sha256;
    await fs.writeFile(code,`LINK-UPDATE ${version} ${digest}\n`);
    artifacts.push({file:code,bytes:(await fs.stat(code)).size,sha256:await hash(code)});
  }
  const sums = path.join(out, `CRAFTCODE-LINK-${version}-SHA256SUMS.txt`);
  await fs.writeFile(sums, artifacts.map(a => `${a.sha256}  ${path.basename(a.file)}`).join('\n') + '\n');
  console.log(JSON.stringify({ artifacts, sums }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
