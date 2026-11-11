'use strict';
const {tr}=require('../native-language.cjs');

const tls = require('node:tls');
const dns = require('node:dns').promises;
const { isIP } = require('node:net');
const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const {
  RoomError, DEFAULT_PORT, DEFAULT_UDP_MIN, DEFAULT_UDP_MAX,
  encodeInvite, decodeInvite, validateAddress, validatePort, validateUdpRange,
} = require('./invite.cjs');
const { createRoomCertificate, fingerprintOf } = require('./certificate.cjs');
const { LIMITS, JsonWire, TokenBucket, exactKeys, protocolError, validateName,
  validateChat, validatePresence, validateSignal, validateRoster } = require('./protocol.cjs');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function eventSink(callback) {
  const fn = typeof callback === 'function' ? callback : () => {};
  // A closed Electron window must not crash the room's network event handlers.
  return (event) => { try { fn(clone(event)); } catch { /* caller lifecycle */ } };
}

function userNetworkError(error) {
  if (error instanceof RoomError) return error;
  const messages = {
    ECONNREFUSED: tr('Создатель не принимает подключение. Проверьте, что комната открыта и TCP-порт доступен.'),
    EADDRINUSE: tr('TCP-порт уже занят. Закройте другую комнату или выберите другой порт.'),
    EACCES: tr('Нет разрешения использовать этот TCP-порт.'),
    ENOTFOUND: tr('Не удалось найти адрес создателя. Проверьте DNS-имя.'),
    EAI_AGAIN: tr('DNS временно недоступен. Проверьте подключение к интернету.'),
    ENETUNREACH: tr('Сеть создателя недоступна.'),
    EHOSTUNREACH: tr('Компьютер создателя недоступен.'),
    ECONNRESET: tr('Соединение было закрыто удалённым компьютером.'),
    ETIMEDOUT: tr('Создатель не отвечает. Проверьте адрес, брандмауэр и переадресацию TCP-порта.'),
  };
  return new RoomError(error?.code || 'NETWORK_ERROR', messages[error?.code] || tr('Ошибка защищённого соединения. Попробуйте подключиться снова.'));
}

async function resolveIPv4(address) {
  if (isIP(address) === 4) return address;
  let timer;
  try {
    const result = await Promise.race([
      dns.lookup(address, { family: 4 }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new RoomError('DNS_TIMEOUT', tr('Истекло время ожидания DNS. Укажите IPv4-адрес.'))), 6000);
      }),
    ]);
    return validateAddress(result.address);
  } catch (error) {
    throw userNetworkError(error);
  } finally { clearTimeout(timer); }
}

function endSocket(socket, finalMessage) {
  if (socket.destroyed) return;
  if (finalMessage && !socket.writableEnded) {
    socket.end(JSON.stringify(finalMessage) + '\n');
  } else if (!socket.writableEnded) {
    socket.end();
  }
  const timer = setTimeout(() => socket.destroy(), 250);
  timer.unref();
  socket.once('close', () => clearTimeout(timer));
}

function prepareSocket(socket) {
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 20000);
  socket.setTimeout(LIMITS.idleMs);
  socket.disableRenegotiation?.();
}

function createPeer(id, name, slot) {
  return { id, name, slot, micMuted: true, sharing: false, shareTitle: '' };
}

async function startHost(options = {}) {
  const name = validateName(options.name);
  const address = validateAddress(options.address);
  const requestedPort = validatePort(options.port ?? DEFAULT_PORT, { allowZero: true });
  const { udpMin, udpMax } = validateUdpRange(options.udpMin ?? DEFAULT_UDP_MIN, options.udpMax ?? DEFAULT_UDP_MAX);
  const publicAddress = await resolveIPv4(address);
  const credentials = await createRoomCertificate();
  const secret = randomBytes(32);
  const token = secret.toString('base64url');
  const deliver = eventSink(options.onEvent);
  const hostPeer = createPeer('host', name, 0);
  const guests = new Map();
  const allSockets = new Set();
  const connectionRates = new Map();
  const localChatRate = new TokenBucket(4, 12);
  let port = requestedPort;
  let invitation;
  let closed = false;
  let closePromise;
  let listening = false;

  const peers = () => [hostPeer, ...[...guests.values()].map((guest) => guest.peer)].sort((a, b) => a.slot - b.slot);
  function ensureOpen() {
    if (closed) throw new RoomError('ROOM_CLOSED', tr('Встреча уже завершена.'));
  }
  function info(role = 'host', selfId = 'host') {
    return clone({ role, selfId, hostId: 'host', ...(role === 'host' ? { invite: invitation } : {}),
      address, publicAddress, port, udpMin, udpMax, peers: peers() });
  }
  function broadcast(message, local = true) {
    for (const guest of guests.values()) guest.wire.send(message);
    if (local) deliver(message);
  }
  function roster() { if (!closed) broadcast({ type: 'roster', peers: peers() }); }
  function chat(peer, text) {
    const event = { type: 'chat', id: randomUUID(), from: peer.id, name: peer.name,
      text: validateChat(text), time: Date.now() };
    broadcast(event);
  }

  const server = tls.createServer({
    key: credentials.key,
    cert: credentials.cert,
    minVersion: 'TLSv1.2',
    handshakeTimeout: LIMITS.handshakeMs,
    requestCert: false,
  }, (socket) => {
    if (closed) return socket.destroy();
    prepareSocket(socket);
    let guest = null;
    let rejecting = false;
    const authTimer = setTimeout(() => reject('AUTH_TIMEOUT', tr('Не получено подтверждение приглашения.')), LIMITS.handshakeMs);
    authTimer.unref();
    const chatRate = new TokenBucket(4, 12);
    const presenceRate = new TokenBucket(10, 20);
    function reject(code, message) {
      if (rejecting) return;
      rejecting = true;
      clearTimeout(authTimer);
      endSocket(socket, { type: 'rejected', code, message });
    }
    const wire = new JsonWire(socket, {
      onFault: (error) => reject(error.code, error.message),
      onMessage: (message) => {
        if (rejecting || closed) return;
        if (!guest) {
          if (message.type !== 'hello' || !exactKeys(message, ['type', 'v', 'token', 'name']) || message.v !== 1 ||
              typeof message.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(message.token)) {
            return reject('AUTH_FAILED', tr('Приглашение не подходит для этой комнаты.'));
          }
          const offered = Buffer.from(message.token, 'base64url');
          if (offered.length !== secret.length || !timingSafeEqual(secret, offered)) {
            return reject('AUTH_FAILED', tr('Приглашение не подходит для этой комнаты.'));
          }
          const peerName = validateName(message.name);
          if (guests.size >= LIMITS.participants - 1) return reject('ROOM_FULL', tr('В комнате уже восемь участников.'));
          const used = new Set([...guests.values()].map((entry) => entry.peer.slot));
          const slot = Array.from({ length: LIMITS.participants - 1 }, (_, index) => index + 1).find((value) => !used.has(value));
          guest = { peer: createPeer(randomBytes(12).toString('base64url'), peerName, slot), wire, socket,
            lastInbound: performance.now(), reject };
          guests.set(guest.peer.id, guest);
          options.onGuestJoined?.(socket.remotePort,invitation,guest.peer.id,socket.remoteAddress);
          clearTimeout(authTimer);
          wire.send({ type: 'welcome', v: 1, session: info('guest', guest.peer.id) });
          roster();
          return;
        }
        guest.lastInbound = performance.now();
        switch (message.type) {
          case 'signal': {
            if (!exactKeys(message, ['type', 'to', 'data']) || message.to !== 'host') throw protocolError(tr('Гость может согласовывать медиа только с создателем.'));
            deliver({ type: 'signal', from: guest.peer.id, data: validateSignal(message.data) });
            break;
          }
          case 'chat': {
            if (!exactKeys(message, ['type', 'text']) || !chatRate.take()) throw new RoomError('RATE_LIMIT', tr('Слишком много сообщений в чате.'));
            chat(guest.peer, message.text);
            break;
          }
          case 'presence': {
            if (!exactKeys(message, ['type', 'presence']) || !presenceRate.take()) throw new RoomError('RATE_LIMIT', tr('Слишком частое изменение состояния.'));
            Object.assign(guest.peer, validatePresence(message.presence));
            if (!guest.peer.sharing) guest.peer.shareTitle = '';
            roster();
            break;
          }
          case 'pong':
            if (!exactKeys(message, ['type'])) throw protocolError();
            break;
          case 'bye':
            if (!exactKeys(message, ['type'])) throw protocolError();
            options.onGuestGoodbye?.(socket.remotePort,invitation,socket.remoteAddress);
            endSocket(socket);
            break;
          default: throw protocolError();
        }
      },
    });
    socket.on('timeout', () => reject('IDLE_TIMEOUT', tr('Связь потеряна. Подключитесь к комнате снова.')));
    socket.on('error', () => { /* handled by close; never log invite/SDP */ });
    socket.on('close', () => {
      clearTimeout(authTimer);
      if (guest && guests.delete(guest.peer.id)) roster();
    });
  });

  server.maxConnections = LIMITS.maxConnections;
  server.on('connection', (socket) => {
    allSockets.add(socket);
    socket.on('close', () => allSockets.delete(socket));
    socket.on('error', () => {});
    const now = Date.now();
    const key = socket.remoteAddress || '';
    if (connectionRates.size > 512) {
      for (const [ip, entry] of connectionRates) if (now - entry.seen > 30000) connectionRates.delete(ip);
    }
    if (!connectionRates.has(key)) {
      if (connectionRates.size >= 1024) return socket.destroy();
      connectionRates.set(key, { limiter: new TokenBucket(2, 8), seen: now });
    }
    const entry = connectionRates.get(key);
    entry.seen = now;
    if (closed || !entry.limiter.take()) socket.destroy();
  });
  server.on('tlsClientError', (_error, socket) => socket.destroy());
  server.on('error', (error) => {
    if (listening && !closed) {
      deliver({ type: 'error', message: userNetworkError(error).message });
      void close();
    }
  });

  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => { server.off('listening', onReady); reject(userNetworkError(error)); };
      const onReady = () => { server.off('error', onError); resolve(); };
      server.once('error', onError);
      server.once('listening', onReady);
      server.listen({ port: requestedPort, host: options.bindAddress || '0.0.0.0', backlog: 16 });
    });
    listening = true;
    port = server.address().port;
    invitation = encodeInvite({ address, port, token, fingerprint: credentials.fingerprint, udpMin, udpMax });
  } catch (error) {
    for (const socket of allSockets) socket.destroy();
    server.close();
    throw error;
  }

  const heartbeat = setInterval(() => {
    for (const guest of guests.values()) {
      // Socket timeouts also reset on outgoing writes, so ping alone is not
      // proof that the other side is alive. Require inbound protocol traffic.
      if (performance.now() - guest.lastInbound > LIMITS.idleMs) {
        guest.reject('IDLE_TIMEOUT', tr('Связь потеряна. Подключитесь к комнате снова.'));
      } else {
        guest.wire.send({ type: 'ping' });
      }
    }
  }, LIMITS.heartbeatMs);
  heartbeat.unref();

  function close() {
    if (closePromise) return closePromise;
    let resolveClose;
    closePromise = new Promise((resolve) => { resolveClose = resolve; });
    closed = true;
    clearInterval(heartbeat);
    deliver({ type: 'closed', reason: tr('Встреча завершена.') });
    for (const guest of guests.values()) {
      endSocket(guest.socket, { type: 'closed', reason: tr('Создатель завершил встречу.') });
    }
    // Include sockets that have not completed TLS/authentication yet.
    const cleanup = setTimeout(() => { for (const socket of allSockets) socket.destroy(); }, 300);
    cleanup.unref();
    server.close(() => {
      clearTimeout(cleanup);
      guests.clear();
      connectionRates.clear();
      secret.fill(0);
      resolveClose();
    });
    return closePromise;
  }

  return Object.freeze({
    getInfo: () => info(),
    sendSignal(peerId, data) {
      ensureOpen();
      const guest = guests.get(peerId);
      if (!guest) throw new RoomError('PEER_NOT_FOUND', tr('Участник уже вышел из комнаты.'));
      if (!guest.wire.send({ type: 'signal', from: 'host', data: validateSignal(data) })) {
        throw new RoomError('PEER_DISCONNECTED', tr('Соединение с участником закрывается.'));
      }
    },
    sendChat(text) {
      ensureOpen();
      if (!localChatRate.take()) throw new RoomError('RATE_LIMIT', tr('Слишком много сообщений. Подождите секунду.'));
      chat(hostPeer, text);
    },
    setPresence(presence) {
      ensureOpen();
      Object.assign(hostPeer, validatePresence(presence));
      if (!hostPeer.sharing) hostPeer.shareTitle = '';
      roster();
    },
    close,
  });
}

async function joinHost(options = {}) {
  const name = validateName(options.name);
  const invitation = decodeInvite(options.invite);
  const publicAddress = options.transportFactory ? invitation.address : await resolveIPv4(invitation.address);
  const deliver = eventSink(options.onEvent);
  const chatRate = new TokenBucket(4, 12);
  let info;
  let initialized = false;
  let closed = false;
  let pendingError;
  let intentional=false;
  let reason = tr('Соединение с создателем закрыто.');
  let wire;
  let lastInbound = performance.now();
  let heartbeat;
  let resolveJoin;
  let rejectJoin;
  let closePromise;

  const joinResult = new Promise((resolve, reject) => { resolveJoin = resolve; rejectJoin = reject; });
  const socket = tls.connect({
    signal: options.signal,
    ...(options.transportFactory ? {socket:options.transportFactory()} : {}),
    host: publicAddress,
    localAddress: options.bindAddress,
    port: invitation.port,
    family: 4,
    minVersion: 'TLSv1.2',
    // Private self-signed room certificates are authenticated by the exact
    // SHA-256 pin in the invitation, not by public CAs. Do not remove the pin
    // check below and never send credentials before secureConnect verifies it.
    rejectUnauthorized: false,
  });
  const connectTimer = setTimeout(() => fail(new RoomError('ETIMEDOUT', tr('Создатель не отвечает. Проверьте адрес, TCP-порт и брандмауэр.'))), LIMITS.connectMs);
  connectTimer.unref();

  function fail(error) {
    if (closed) return;
    pendingError = userNetworkError(error);
    reason = pendingError.message;
    socket.destroy();
  }
  function ensureOpen() {
    if (closed || !initialized || socket.destroyed || socket.writableEnded) throw new RoomError('ROOM_CLOSED', tr('Подключение к комнате закрыто.'));
  }
  function send(message) {
    ensureOpen();
    if (!wire.send(message)) throw new RoomError('ROOM_CLOSED', tr('Подключение к комнате закрывается.'));
  }
  const session = Object.freeze({
    getInfo: () => clone(info),
    sendSignal(peerId, data) {
      if (peerId !== 'host') throw protocolError(tr('Гость подключается к медиа через создателя комнаты.'));
      send({ type: 'signal', to: 'host', data: validateSignal(data) });
    },
    sendChat(text) {
      if (!chatRate.take()) throw new RoomError('RATE_LIMIT', tr('Слишком много сообщений. Подождите секунду.'));
      send({ type: 'chat', text: validateChat(text) });
    },
    setPresence(presence) { send({ type: 'presence', presence: validatePresence(presence) }); },
    close() {
      if (closePromise) return closePromise;
      intentional=true;
      reason = tr('Вы вышли из встречи.');
      closePromise = new Promise((resolve) => {
        if (closed || socket.destroyed) return resolve();
        socket.once('close', resolve);
        endSocket(socket, initialized ? { type: 'bye' } : null);
      });
      return closePromise;
    },
  });

  socket.once('secureConnect', () => {
    if (socket.destroyed) return;
    const raw = socket.getPeerCertificate().raw;
    const actual = raw ? Buffer.from(fingerprintOf(raw), 'hex') : Buffer.alloc(0);
    const expected = Buffer.from(invitation.fingerprint, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return fail(new RoomError('CERT_PIN_MISMATCH', tr('Сертификат не совпадает с приглашением. Подключение остановлено до отправки секретного кода. Получите новое приглашение у друга.')));
    }
    prepareSocket(socket);
    wire = new JsonWire(socket, {
      onFault: fail,
      onMessage: (message) => {
        lastInbound = performance.now();
        if (!initialized) {
          if (message.type === 'rejected') {
            const code = typeof message.code === 'string' && /^[A-Z_]{1,40}$/.test(message.code) ? message.code : 'AUTH_FAILED';
            const known = {
              ROOM_FULL: tr('В комнате уже восемь участников.'),
              AUTH_FAILED: tr('Приглашение не подходит для этой комнаты. Попросите новое.'),
              AUTH_TIMEOUT: tr('Не удалось подтвердить приглашение вовремя.'),
            };
            return fail(new RoomError(code, known[code] || tr('Создатель отклонил подключение.')));
          }
          if (message.type !== 'welcome' || message.v !== 1 || !exactKeys(message.session,
            ['role', 'selfId', 'hostId', 'address', 'publicAddress', 'port', 'udpMin', 'udpMax', 'peers'])) throw protocolError();
          const data = message.session;
          const roomPeers = validateRoster(data.peers);
          if (data.role !== 'guest' || data.hostId !== 'host' || !roomPeers.some((peer) => peer.id === data.selfId && peer.slot !== 0) ||
              data.port !== invitation.port || data.udpMin !== invitation.udpMin || data.udpMax !== invitation.udpMax) throw protocolError();
          info = { role: 'guest', selfId: data.selfId, hostId: 'host', address: invitation.address,
            publicAddress, port: invitation.port, udpMin: invitation.udpMin, udpMax: invitation.udpMax, peers: roomPeers };
          initialized = true;
          clearTimeout(connectTimer);
          heartbeat = setInterval(() => {
            if (performance.now() - lastInbound > LIMITS.idleMs) {
              fail(new RoomError('IDLE_TIMEOUT', tr('Связь с создателем потеряна. Подключитесь снова.')));
            }
          }, LIMITS.heartbeatMs);
          heartbeat.unref();
          resolveJoin(session);
          return;
        }
        switch (message.type) {
          case 'roster': {
            const roomPeers = validateRoster(message.peers);
            if (!roomPeers.some((peer) => peer.id === info.selfId)) throw protocolError();
            info.peers = roomPeers;
            deliver({ type: 'roster', peers: roomPeers });
            break;
          }
          case 'signal':
            if (message.from !== 'host') throw protocolError();
            deliver({ type: 'signal', from: 'host', data: validateSignal(message.data) });
            break;
          case 'chat': {
            const author = info.peers.find((peer) => peer.id === message.from);
            if (!author || typeof message.id !== 'string' || !/^[a-f0-9-]{36}$/.test(message.id) ||
                !Number.isSafeInteger(message.time) || message.time < 0) throw protocolError();
            deliver({ type: 'chat', id: message.id, from: author.id, name: author.name,
              text: validateChat(message.text), time: message.time });
            break;
          }
          case 'ping': wire.send({ type: 'pong' }); break;
          case 'closed':
            intentional=true;
            reason = tr('Создатель завершил встречу.');
            endSocket(socket);
            break;
          case 'rejected':
            if(message.code==='IDLE_TIMEOUT')return fail(new RoomError('IDLE_TIMEOUT',tr('Восстанавливаем связь с создателем.')));
            intentional=true;
            return fail(new RoomError('CONNECTION_REJECTED', tr('Соединение закрыто создателем из-за ошибки протокола или превышения лимитов.')));
          default: throw protocolError();
        }
      },
    });
    wire.send({ type: 'hello', v: 1, token: invitation.token, name });
  });
  socket.on('timeout', () => fail(new RoomError('IDLE_TIMEOUT', tr('Связь с создателем потеряна. Подключитесь снова.'))));
  socket.on('error', (error) => {
    pendingError = userNetworkError(error);
    reason = pendingError.message;
  });
  socket.once('close', () => {
    if (closed) return;
    closed = true;
    clearTimeout(connectTimer);
    clearInterval(heartbeat);
    if (!initialized) rejectJoin(pendingError || new RoomError('CONNECTION_CLOSED', reason));
    else deliver({ type: 'closed', reason, retryable:!intentional && (!pendingError || ['EPIPE','ETIMEDOUT','ECONNRESET','EHOSTUNREACH','ENETUNREACH','ENETDOWN','IDLE_TIMEOUT'].includes(pendingError.code)) });
  });
  return joinResult;
}

module.exports = { startHost, joinHost, resolveIPv4, LIMITS };
