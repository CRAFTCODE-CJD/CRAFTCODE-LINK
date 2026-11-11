'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {pruneRtpReports} = require('../src/report-retention.cjs');

test('RTP history keeps the newest five reports and ignores other files and folders', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'link-reports-'));
  t.after(() => fs.rm(dir, {recursive:true, force:true}));
  const sample = i => 'RTP-2026-11-09T01-00-0' + i + '-000Z.json';
  for (let i = 0; i < 8; i++) await fs.writeFile(path.join(dir, sample(i)), '{}');
  await fs.mkdir(path.join(dir, sample(8)));
  await fs.writeFile(path.join(dir, 'RTP-notes.json'), '{}');
  await Promise.all([pruneRtpReports(dir), pruneRtpReports(dir)]);
  assert.deepEqual((await fs.readdir(dir)).sort(), [3,4,5,6,7,8].map(sample).concat('RTP-notes.json'));
});

test('interrupted profile replacement cleans its temporary file and preserves adjacent files', async t => {
  const {writeProfileFile} = require('../src/profile-paths.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'link-profile-write-'));
  t.after(() => fs.rm(directory, {recursive:true, force:true, maxRetries:8, retryDelay:75}));
  const file = path.join(directory, 'account.bin');
  writeProfileFile(file, Buffer.from('first'));
  writeProfileFile(file, Buffer.from('second'));
  assert.equal(await fs.readFile(file,'utf8'), 'second');
  const blocked = path.join(directory,'occupied');
  await fs.mkdir(blocked);
  await fs.writeFile(path.join(blocked,'personal.txt'),'keep');
  assert.throws(() => writeProfileFile(blocked, Buffer.from('replacement')));
  assert.deepEqual((await fs.readdir(directory)).sort(), ['account.bin','occupied']);
  assert.equal(await fs.readFile(path.join(blocked,'personal.txt'),'utf8'), 'keep');
});
