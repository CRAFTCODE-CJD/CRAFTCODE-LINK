'use strict';

// Portable packaging without installer, administrator rights, or code signing.
// The official Electron runtime is authenticated against its pinned SHA-256.
// The application may reconnect enabled contact services at launch.
// Downloading runtime and build dependencies is a separate build step.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const appPackage = require(path.join(root, 'package.json'));

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) {
    throw new Error(`Missing value after ${name}.`);
  }
  return process.argv[index + 1];
}

async function sha256(filename) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

// A release can be assembled from an existing Windows build. Refuse stale,
// missing or damaged application files before that build goes into an archive.
async function verifyAppSource(source, packaged) {
  async function compare(relative) {
    const expected = await fsp.readdir(path.join(source, relative), { withFileTypes: true });
    const entries = await fsp.readdir(path.join(packaged, relative), { withFileTypes: true });
    const actual = new Map(entries.map(entry => [entry.name, entry]));
    for (const entry of expected) {
      const name = path.join(relative, entry.name);
      const copy = actual.get(entry.name);
      actual.delete(entry.name);
      if (!copy) throw new Error('Packaged application file is missing: ' + name);
      if (entry.isDirectory() && copy.isDirectory()) {
        await compare(name);
      } else if (entry.isFile() && copy.isFile()) {
        const [original, staged] = await Promise.all([
          fsp.readFile(path.join(source, name)), fsp.readFile(path.join(packaged, name)),
        ]);
        if (!original.equals(staged)) throw new Error('Packaged application file differs: ' + name);
      } else throw new Error('Unexpected application file type: ' + name);
    }
    if (actual.size) throw new Error('Unexpected packaged application file: ' + path.join(relative, actual.keys().next().value));
  }
  await compare('');
}

async function copyProductionDependencies(appDirectory,arch) {
  const copied = new Set();
  async function copyDependency(name, parentDirectory) {
    // Packages in this project are trusted, locked build inputs. Resolving from
    // their parent mirrors Node resolution rather than copying devDependencies.
    const scopedRequire = createRequire(path.join(parentDirectory, 'package.json'));
    const packageFile = scopedRequire.resolve.paths(name).map(dir=>path.join(dir,name,'package.json')).find(f=>fs.existsSync(f));
    if(!packageFile)throw Error('Missing production dependency: '+name);
    const packageDirectory = path.dirname(packageFile);
    const metadata = JSON.parse(await fsp.readFile(packageFile, 'utf8'));
    const key = `${name}@${metadata.version}`;
    if (copied.has(key)) return;
    copied.add(key);
    const destination = path.join(appDirectory, 'node_modules', name);
    if (fs.existsSync(destination)) throw new Error(`Conflicting production dependency versions for ${name}.`);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.cp(packageDirectory, destination, {recursive:true,dereference:true,filter(source){
      const parts=path.relative(packageDirectory,source).split(path.sep);
      if(parts.includes('node_modules'))return false;
      const pre=parts.indexOf('prebuilds');
      return pre<0 || !parts[pre+1] || (parts[pre+1]==='win32-'+arch && !source.endsWith('.bare'));
    }});
    for (const childName of Object.keys(metadata.dependencies || {})) await copyDependency(childName, packageDirectory);
  }
  for (const name of Object.keys(appPackage.dependencies || {})) await copyDependency(name, root);
}

async function main() {
  const version = appPackage.devDependencies.electron;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Electron must be pinned to one exact stable version.');
  const arch = argument('--arch') || 'x64';
  if (!['x64', 'arm64'].includes(arch)) throw new Error('Supported Windows architectures: x64 or arm64.');
  const filename = `electron-v${version}-win32-${arch}.zip`;
  const checksums = require(path.join(root, 'node_modules', 'electron', 'checksums.json'));
  const expectedHash = checksums[filename];
  if (!/^[a-f0-9]{64}$/.test(expectedHash || '')) throw new Error(`No trusted checksum for ${filename}.`);

  let runtimeZip = argument('--runtime-zip');
  if (runtimeZip) runtimeZip = path.resolve(runtimeZip);
  else {
    const { downloadArtifact } = await import('@electron/get');
    process.stdout.write(`Downloading/caching official Electron ${version} for Windows ${arch}...\n`);
    runtimeZip = await downloadArtifact({
      version,
      artifactName: 'electron',
      platform: 'win32',
      arch,
      checksums,
    });
  }
  const actualHash = await sha256(runtimeZip);
  if (actualHash !== expectedHash) throw new Error('Electron ZIP SHA-256 mismatch. Packaging stopped.');
  process.stdout.write(`Electron SHA-256 verified: ${actualHash}\n`);

  const output = argument('--output')
    ? path.resolve(argument('--output'))
    : path.join(root, 'out', `CRAFTCODE-LINK-${appPackage.version}-win-${arch}`);
  if (fs.existsSync(output)) throw new Error(`Output already exists; choose a new --output directory: ${output}`);
  await fsp.mkdir(path.dirname(output), { recursive: true });
  await fsp.mkdir(output);
  const { default: extract } = await import('@electron-internal/extract-zip');
  await extract(runtimeZip, { dir: output });
  await fsp.rename(path.join(output, 'electron.exe'), path.join(output, 'CRAFTCODE-LINK.exe'));
  const { brandWindows } = await import('./brand-windows.mjs');
  await brandWindows(path.join(output,'CRAFTCODE-LINK.exe'),path.join(root,'src/renderer/assets/craftlink.ico'),appPackage.version);
  const applicationDirectory = path.join(output, 'resources', 'app');
  await fsp.mkdir(applicationDirectory, { recursive: true });
  await fsp.cp(path.join(root, 'src'), path.join(applicationDirectory, 'src'), { recursive: true });
  require('./build-audio.cjs').buildAudio(path.join(applicationDirectory,'bin'),arch);
  require('./build-game.cjs').buildGame(path.join(applicationDirectory,'bin'),arch);
  const testDirectory = path.join(applicationDirectory, 'tests');
  await fsp.mkdir(testDirectory);
  for (const name of ['qa-main.cjs', 'qa-preload.cjs', 'qa-media.html', 'qa-renderer.mjs', 'rtp-local.cjs', 'rtp-evidence.cjs']) {
    await fsp.copyFile(path.join(root, 'tests', name), path.join(testDirectory, name));
  }
  const runtimePackage = { ...appPackage };
  delete runtimePackage.devDependencies;
  delete runtimePackage.scripts;
  await fsp.writeFile(path.join(applicationDirectory, 'package.json'), JSON.stringify(runtimePackage, null, 2) + '\n');
  await copyProductionDependencies(applicationDirectory,arch);
  await require('./third-party-notices.cjs').writeNotices(applicationDirectory,output);
  // The source distribution keeps copies here, and Electron already provides
  // the same notices at the top of the Windows distribution.
  const runtimeNotices = new Set(['Electron-LICENSE.txt', 'LICENSES.chromium.html']);
  await fsp.cp(path.join(root, 'licenses'), path.join(output, 'licenses'), {
    recursive: true,
    filter: source => !runtimeNotices.has(path.basename(source)),
  });
  for (const docName of ['README_RU.md', 'README.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE', 'QA_REPORT.md', 'FIRST_START_RU.txt', 'START.cmd', 'TEST-RTP.cmd', 'CHECK-STREAM-AUDIO.cmd', 'WINDOWS_TEST_RU.md', 'FRIENDS_RU.md']) {
    const source = path.join(root, docName);
    // Preserve Electron's own LICENSE instead of overwriting it with ours.
    const targetName = docName === 'LICENSE' ? 'CRAFTCODE-LINK-LICENSE.txt' : docName;
    if (fs.existsSync(source)) await fsp.copyFile(source, path.join(output, targetName));
  }
  await fsp.copyFile(path.join(root, 'tests', 'windows-processes.ps1'), path.join(output, 'CHECK-PROCESSES.ps1'));
  await fsp.copyFile(path.join(root, 'tests', 'windows-game-lan.ps1'), path.join(output, 'CHECK-GAME-LAN.ps1'));
  const manifest = {
    application: 'CRAFTCODE LINK',
    version: appPackage.version,
    platform: 'win32',
    arch,
    electron: version,
    electronRuntimeSHA256: expectedHash,
    builtAt: new Date().toISOString(),
    signedByCRAFTCODE: false,
    updateChecks: 'Packaged Windows x64 only: public GitHub release metadata once a day by default after network policy is loaded; adjustable in Help / Updates. Relay-only mode suppresses all GitHub checks. Installer downloads require a user action.',
    servicesByMode: {manual:[],localFriends:['Selected LAN interface only'],directInternet:['HyperDHT (opt-in)','STUN when enabled'],friends: ['Selected XMPP account provider', 'STUN/TURN announced by that provider'] },
    note: 'Windows capture and WAN connectivity require verification on actual user machines.',
  };
  await fsp.writeFile(path.join(output, 'BUILD-INFO.json'), JSON.stringify(manifest, null, 2) + '\n');
  await verifyAppSource(path.join(root, 'src'), path.join(applicationDirectory, 'src'));
  process.stdout.write(`Portable application ready: ${output}\nRun CRAFTCODE-LINK.exe; Node.js is not required on the receiving computer.\n`);
}

module.exports = { verifyAppSource };

if (require.main === module) main().catch((error) => {
  process.stderr.write(`Packaging failed: ${error?.message || error}\n`);
  process.exitCode = 1;
});
