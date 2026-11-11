'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const lock = require('../package-lock.json');
const noticeName = 'THIRD-PARTY-NPM.txt';

async function writeNotices(app, output) {
  const versions = require('../package.json');
  if (versions.devDependencies.electron !== '45.2.3' || lock.packages['node_modules/sodium-native']?.version !== '5.2.0' ||
      lock.packages['node_modules/udx-native']?.version !== '1.22.1')
    throw Error('Refresh native dependency notices and matching FFmpeg source for these runtime versions.');
  const modules = path.join(app, 'node_modules');
  const entries = await fs.readdir(modules, {withFileTypes:true});
  const names = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      for (const child of await fs.readdir(path.join(modules, entry.name))) names.push(entry.name+'/'+child);
    } else names.push(entry.name);
  }
  const sections = [];
  const expected = Object.entries(lock.packages).filter(([key,p]) => key && !p.dev);
  const found = new Set();
  for (const name of names.sort()) {
    const directory = path.join(modules, name);
    const meta = JSON.parse(await fs.readFile(path.join(directory,'package.json'), 'utf8'));
    const entry = expected.find(([key,p]) => key.endsWith('node_modules/'+name) && p.version === meta.version);
    if (meta.name !== name || !entry || !entry[1].resolved || !entry[1].license)
      throw Error('Unexpected runtime package or incomplete lock entry: '+name+'@'+meta.version);
    found.add(entry[0]);
    const lines = [name+'@'+meta.version, 'License: '+entry[1].license, 'Source: '+entry[1].resolved];
    const notices = (await fs.readdir(directory,{withFileTypes:true}))
      .filter(f => f.isFile() && /^(?:licen[cs]e|copying|notice)(?:$|[._-])/i.test(f.name)).map(f=>f.name).sort();
    if (notices.length) {
      for (const file of notices) lines.push(file,await fs.readFile(path.join(directory,file),'utf8'));
    } else if (name === 'noise-curve-ed' && meta.version === '2.1.0' && entry[1].license === 'ISC') {
      lines.push('Upstream declares ISC in package.json and supplies no separate license file or named copyright holder.',
        'A reference copy of the ISC terms is in licenses/ISC-template.txt.');
    } else throw Error('Missing upstream license: '+name+'@'+meta.version);
    sections.push(lines.join('\n'));
  }
  if (found.size !== expected.length) throw Error('Missing production packages: '+expected.filter(([key])=>!found.has(key)).map(([key])=>key).join(', '));
  await fs.writeFile(path.join(output, noticeName),sections.join('\n\n'+'='.repeat(72)+'\n\n')+'\n');
  return names.length;
}
module.exports={writeNotices,noticeName};
