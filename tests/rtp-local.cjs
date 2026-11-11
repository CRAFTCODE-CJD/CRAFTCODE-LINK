'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { app, dialog } = require('electron');
const { readEvidence, advancing } = require('./rtp-evidence.cjs');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const slots = ['host', 'g1', 'g2'].map((id, slot) => ({ id, name: id, slot, micMuted: false, sharing: true }));
// All method names and arguments here are fixed test inputs. No room IPC is exposed.
function call(windows, id, method, ...args) {
  const script = 'window.qa[' + JSON.stringify(method) + '](...' + JSON.stringify(args) + ')';
  return windows.get(id).webContents.executeJavaScript(script);
}

async function measure(windows, peers, stage) {
  const snapshots = () => Promise.all(peers.map(({ id }) => call(windows, id, 'snapshot')));
  const deadline = Date.now() + 30_000;
  let before = null;
  while (Date.now() < deadline) {
    const samples = await snapshots();
    stage.links = samples.flatMap(s => s.connections.map(c => ({
      receiver: s.id, peer: c.id, ice: c.iceState, gathering: c.gatheringState,
      transport: c.selectedTransport, localCandidates: c.candidates.length, signaledCandidates: s.signals.filter(sig => sig.to === c.id && sig.type === 'ice').length,
    })));
    const after = readEvidence(samples, peers);
    stage.measurements = { before, after };
    if (samples.some(s => s.errors.length)) throw new Error('Ошибка при согласовании или обработке тестовых дорожек.');
    const selectedUDP = stage.links.every(({ transport }) => transport?.protocol === 'udp' &&
      [transport.localPort, transport.remotePort].every(port => port >= 45832 && port <= 45863));
    if (before && selectedUDP && advancing(before, after)) {
      stage.status = 'PASS';
      return;
    }
    before = after;
    await pause(1500);
  }
  throw new Error('За 30 с не подтверждён одновременный приём двух тестовых тонов и рост числа декодированных кадров на всех маршрутах.');
}

async function runLocalTest(windows) {
  const { version } = require('../package.json');
  const report = { application: 'CRAFTCODE LINK', version, started: new Date().toISOString(),
    platform: process.platform, arch: process.arch, osRelease: os.release(), electron: process.versions.electron,
    scope: 'One PC. Synthetic voice, system audio and video. IPC signaling.', status: 'FAIL', stages: [] };
  let exitCode = 1;
  try {
    for (const count of [2, 3]) {
      const stage = { participants: count, status: 'FAIL' };
      report.stages.push(stage);
      const peers = slots.slice(0, count);
      const added = count === 2 ? peers : peers.slice(-1);
      for (const { id } of added) await call(windows, id, 'init', peers);
      for (const { id } of [...peers].reverse()) await call(windows, id, 'roster', peers);
      await measure(windows, peers, stage);
    }
    report.status = 'PASS';
    exitCode = 0;
  } catch (error) {
    // Raw exceptions may include local paths. Keep shared reports anonymous.
    report.reason = ['За 30 с', 'Ошибка при согласовании'].some(s => error.message.startsWith(s)) ?
      error.message : 'Не удалось завершить локальный медиатест.';
  } finally {
    report.finished = new Date().toISOString();
    await Promise.allSettled([...windows.keys()].map(id => call(windows, id, 'close')));
  }
  const directory = path.join(app.getPath('appData'), 'CRAFTCODE LINK', 'reports');
  const file = path.join(directory, 'RTP-' + report.started.replace(/[:.]/g, '-') + '.json');
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    await require('../src/report-retention.cjs').pruneRtpReports(directory).catch(() => {});
    const message = report.status === 'PASS' ? 'На этом ПК тестовые дорожки переданы для двух и трёх участников.' :
      'Локальная передача всех тестовых дорожек не подтверждена.';
    if (process.platform === 'win32') await dialog.showMessageBox({ type: exitCode ? 'warning' : 'info',
      title: 'CRAFTCODE LINK · тест RTP', message, detail: (report.reason ? report.reason + '\n\n' : '') + 'Отчёт: ' + file, buttons: ['Закрыть'] });
    console.log(report.status, file);
  } catch {
    exitCode = 1;
    if (process.platform === 'win32') dialog.showErrorBox('CRAFTCODE LINK', 'Не удалось сохранить отчёт в папке отчётов CRAFTCODE LINK.');
  }
  app.exit(exitCode);
}
module.exports = { runLocalTest };
