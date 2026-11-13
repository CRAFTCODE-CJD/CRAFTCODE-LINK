'use strict';
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const {randomBytes, createHmac, timingSafeEqual} = require('node:crypto');
const {spawn} = require('node:child_process');
const {tr} = require('../native-language.cjs');

const setupErrors = new Map([
  ['busy', 'Игровая сеть уже используется другим экземпляром LINK. Завершите ту сессию и повторите попытку.'],
  ['stale', 'Windows сохранила адаптер LINK от предыдущей сессии. Восстановите подключение, чтобы снова играть.'],
  ['name-conflict', 'Имя или идентификатор адаптера заняты другим устройством. LINK сохранил настройки этого устройства.'],
  ['repair-failed', 'Windows не освободила адаптер LINK. Перезагрузите ПК и повторите подключение.'],
  ['restart-required', 'Для завершения восстановления Windows требуется перезагрузка.'],
  ['overlap', 'Подсеть занята. Создайте новую игровую LAN.'],
  ['mtu', 'Windows не установила размер пакета игрового адаптера. Повторите подключение.'],
  ['driver-file', 'Не удалось проверить или загрузить wintun.dll. Распакуйте ZIP целиком в локальную папку или восстановите установку LINK.'],
  ['driver-create', 'Windows не создала игровой адаптер. Скопируйте диагностику LAN и проверьте журнал защиты Windows.'],
  ['driver-session', 'Windows не открыла сеанс игрового адаптера. Повторите подключение.'],
  ['adapter-identity', 'Windows не подтвердила идентификатор игрового адаптера. Скопируйте диагностику LAN.'],
  ['address', 'Windows не назначила адрес игровому адаптеру. Скопируйте диагностику LAN.'],
  ['access-denied', 'Windows запретила запуск сетевого помощника LINK. Проверьте разрешения на этом ПК.'],
  ['launcher', 'Не удалось запустить сетевой помощник LINK. Проверьте распаковку приложения и журнал защиты Windows.'],
  ['approval-timeout', 'Сетевой помощник не ответил. Повторите включение и подтвердите запрос Windows.'],
  ['setup-timeout', 'Windows не завершила настройку адаптера вовремя. Повторите попытку или скопируйте диагностику LAN.'],
  ['cancelled', 'Включение отменено в Windows. Чат остаётся доступен.'],
]);
const failed = 'Windows не включила игровой адаптер. Проверьте разрешение и повторите попытку.';

function supervise({packet, closed, abort}, startHelper) {
  const secret = randomBytes(32);
  return new Promise((resolve, reject) => {
    let active, launcher, ready = false, stopping = false, forceClose;
    let drained;
    const released = new Promise(done => {drained = done;});
    const sockets = new Set();
    const server = net.createServer(accept);
    // Time spent reading the UAC prompt must not consume the driver installation budget.
    let startup = setTimeout(() => stop(setupErrors.get('approval-timeout'),'approval-timeout'), 120000);

    function stop(message = failed, code) {
      if (stopping) return released;
      stopping = true;
      clearTimeout(startup);
      if (server.listening) server.close();
      for (const socket of sockets) if (socket !== active) socket.destroy();
      if (!ready) {
        launcher?.kill();
        reject(Object.assign(Error(tr(message)),{code}));
      }
      if (active && !active.destroyed) {
        // EOF asks the helper to tear down. Its FIN follows adapter cleanup.
        active.end();
        forceClose = setTimeout(() => active.destroy(), 16000);
        forceClose.unref();
      } else drained();
      if (ready) closed();
      return released;
    }
    function accept(socket) {
      if (stopping || active || sockets.size >= 4) {socket.destroy(); return;}
      sockets.add(socket);
      let buf = Buffer.alloc(0);
      socket.setTimeout(2500, () => socket.destroy());
      socket.on('error', () => socket.destroy());
      socket.on('close', () => {
        sockets.delete(socket);
        if (socket !== active) return;
        clearTimeout(forceClose);
        stop();
        drained();
      });
      socket.on('data', data => {
        if (stopping) return;
        buf = Buffer.concat([buf, data]);
        if (active !== socket) {
          if (buf.length < 64) return;
          const nonce = buf.subarray(0, 32);
          const mac = label => createHmac('sha256', secret).update(label).update(nonce).digest();
          if (active || !timingSafeEqual(buf.subarray(32, 64), mac('helper'))) {socket.destroy(); return;}
          active = socket;
          clearTimeout(startup);
          startup = setTimeout(() => stop(setupErrors.get('setup-timeout'),'setup-timeout'), 90000);
          socket.setTimeout(0);
          socket.write(mac('app'));
          buf = buf.subarray(64);
          server.close();
          for (const other of sockets) if (other !== active) other.destroy();
        }
        while (buf.length >= 2) {
          const size = buf.readUInt16BE(0);
          if (size > 1500) {stop(); return;}
          if (buf.length < size + 2) return;
          const frame = buf.subarray(2, size + 2);
          buf = buf.subarray(size + 2);
          if (!ready) {
            if (size) {
              const match=/^([a-z-]+)(?::([0-9]{1,10}))?$/.exec(frame.toString('ascii'));
              const reason=match?.[1], message=setupErrors.get(reason);
              stop(message, message ? match[0] : undefined);
              return;
            }
            ready = true;
            clearTimeout(startup);
            resolve({close: stop, write(data) {
              if (stopping || socket.writableLength >= 65536) return false;
              const out = Buffer.allocUnsafe(data.length + 2);
              out.writeUInt16BE(data.length);
              data.copy(out, 2);
              socket.write(out);
              return true;
            }});
          } else if (size) packet(frame);
        }
      });
    }
    server.once('error', () => stop());
    server.listen(0, '127.0.0.1', () => {
      if (stopping) {server.close(); return;}
      try {
        launcher = startHelper(server.address().port, secret.toString('hex'));
        launcher.on('error', () => stop(setupErrors.get('launcher'),'launcher'));
        launcher.on('exit', code => {
          if (code && !ready) {
            const reason=code===23?'cancelled':code===24?'access-denied':'launcher';
            stop(setupErrors.get(reason),reason);
          }
        });
      } catch {stop();}
    });
    abort(stop);
  });
}

async function launch(options) {
  if (process.platform !== 'win32') throw Error(tr('Игровой адаптер доступен в Windows.'));
  const exe = path.resolve(__dirname, '../../bin/link-game.exe');
  if (!fs.existsSync(exe)) throw Object.assign(Error(tr('Не найден компонент игровой сети.')),{code:'helper-missing'});
  const sys = path.join(process.env.SystemRoot, 'System32');
  return supervise(options, (port, token) => {
    const env = {...process.env, CC_GAME_HELPER: exe, CC_GAME_IP: options.ip, CC_GAME_PORT: String(port), CC_GAME_TOKEN: token, CC_GAME_REPAIR: options.repair===true?'1':'0'};
    const command = [
      "$ErrorActionPreference='Stop'",
      "$helperArgs=@($env:CC_GAME_IP,$env:CC_GAME_PORT,$env:CC_GAME_TOKEN); if ($env:CC_GAME_REPAIR -eq '1') { $helperArgs+='repair' }",
      'try { Start-Process -FilePath $env:CC_GAME_HELPER -ArgumentList $helperArgs -Verb RunAs -WorkingDirectory ([Environment]::SystemDirectory) }',
      'catch { $e=$_.Exception; while ($e) { if ($e.NativeErrorCode -eq 1223 -or ($e.HResult -band 65535) -eq 1223) { exit 23 }; if ($e.NativeErrorCode -eq 5 -or ($e.HResult -band 65535) -eq 5) { exit 24 }; $e=$e.InnerException }; exit 1 }',
    ].join('\n');
    return spawn(path.join(sys, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', command], {cwd: sys, windowsHide: true, stdio: 'ignore', env});
  });
}
module.exports = {launch, supervise};
