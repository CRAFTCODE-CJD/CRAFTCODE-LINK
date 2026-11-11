'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = [];

function visit(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(filename);
    else if (/\.(?:mjs|cjs|js)$/.test(entry.name)) files.push(filename);
  }
}

for (const directory of ['src', 'scripts', 'tests']) visit(path.join(root, directory));
let failures = 0;
for (const filename of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0 || result.error) {
    failures += 1;
    process.stderr.write(`${path.relative(root, filename)}\n${result.stderr || result.error || 'Syntax check failed'}\n`);
  }
}
if (failures) {
  process.stderr.write(`${failures} file(s) failed syntax checking.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Syntax OK: ${files.length} JavaScript files.\n`);
}
