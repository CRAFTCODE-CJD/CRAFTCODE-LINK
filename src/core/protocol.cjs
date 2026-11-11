'use strict';
const {tr}=require('../native-language.cjs');

const { RoomError } = require('./invite.cjs');

const LIMITS = Object.freeze({
  participants: 8,
  frameBytes: 128 * 1024,
  signalBytes: 120 * 1024,
  queuedBytes: 512 * 1024,
  handshakeMs: 8000,
  connectMs: 12000,
  idleMs: 60000,
  heartbeatMs: 15000,
  maxConnections: 16,
});

function protocolError(message = tr('Получено некорректное сообщение.')) {
  return new RoomError('INVALID_MESSAGE', message);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).every((key) => keys.includes(key));
}

function validateName(value) {
  if (typeof value !== 'string') throw new RoomError('INVALID_NAME', tr('Введите имя участника.'));
  const name = value.trim();
  if (name.length < 1 || name.length > 48 || /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(name)) {
    throw new RoomError('INVALID_NAME', tr('Имя должно содержать от 1 до 48 символов без управляющих знаков.'));
  }
  return name;
}

function validateChat(value) {
  if (typeof value !== 'string') throw protocolError(tr('Введите текст сообщения.'));
  const text = value.trim();
  if (!text || text.length > 4000 || Buffer.byteLength(text, 'utf8') > 16000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) {
    throw protocolError(tr('Сообщение должно содержать от 1 до 4000 символов.'));
  }
  return text;
}

function validatePresence(value) {
  if (!exactKeys(value, ['micMuted', 'sharing', 'shareTitle']) || Object.keys(value).length === 0) throw protocolError();
  const result = {};
  for (const key of ['micMuted', 'sharing']) {
    if (Object.hasOwn(value, key)) {
      if (typeof value[key] !== 'boolean') throw protocolError();
      result[key] = value[key];
    }
  }
  if (Object.hasOwn(value, 'shareTitle')) {
    if (typeof value.shareTitle !== 'string' || value.shareTitle.length > 160 || /[\x00-\x1f\x7f]/.test(value.shareTitle)) throw protocolError();
    result.shareTitle = value.shareTitle;
  }
  if (result.sharing === false) result.shareTitle = '';
  return result;
}

function validateSignal(data) {
  if (!isRecord(data)) throw protocolError(tr('Неверное сообщение согласования медиа.'));
  let json;
  try { json = JSON.stringify(data); } catch { throw protocolError(); }
  if (!json || Buffer.byteLength(json, 'utf8') > LIMITS.signalBytes) throw protocolError(tr('Слишком большое сообщение согласования.'));
  const cloned = JSON.parse(json);
  const stack = [[cloned, 0]];
  let visited = 0;
  while (stack.length) {
    const [entry, depth] = stack.pop();
    if (++visited > 4096 || depth > 12) throw protocolError();
    if (entry && typeof entry === 'object') {
      for (const [key, child] of Object.entries(entry)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw protocolError();
        stack.push([child, depth + 1]);
      }
    }
  }
  return cloned;
}

function validatePeer(peer) {
  if (!exactKeys(peer, ['id', 'name', 'slot', 'micMuted', 'sharing', 'shareTitle']) ||
      typeof peer.id !== 'string' || !/^(host|[A-Za-z0-9_-]{16})$/.test(peer.id) ||
      !Number.isInteger(peer.slot) || peer.slot < 0 || peer.slot >= LIMITS.participants ||
      (peer.slot === 0) !== (peer.id === 'host') ||
      typeof peer.micMuted !== 'boolean' || typeof peer.sharing !== 'boolean' || typeof peer.shareTitle !== 'string') {
    throw protocolError();
  }
  return { id: peer.id, name: validateName(peer.name), slot: peer.slot,
    ...validatePresence({ micMuted: peer.micMuted, sharing: peer.sharing, shareTitle: peer.shareTitle }) };
}

function validateRoster(peers) {
  if (!Array.isArray(peers) || peers.length < 1 || peers.length > LIMITS.participants) throw protocolError();
  const roster = peers.map(validatePeer).sort((a, b) => a.slot - b.slot);
  if (roster[0].id !== 'host' || new Set(roster.map((peer) => peer.id)).size !== roster.length ||
      new Set(roster.map((peer) => peer.slot)).size !== roster.length) throw protocolError();
  return roster;
}

class TokenBucket {
  constructor(rate, capacity) {
    this.rate = rate;
    this.capacity = capacity;
    this.tokens = capacity;
    this.last = performance.now();
  }
  take(amount = 1) {
    const now = performance.now();
    this.tokens = Math.min(this.capacity, this.tokens + Math.max(0, now - this.last) * this.rate / 1000);
    this.last = now;
    if (this.tokens < amount) return false;
    this.tokens -= amount;
    return true;
  }
}

/** Bounded newline-delimited UTF-8 JSON over an already authenticated TLS pipe. */
class JsonWire {
  constructor(socket, { onMessage, onFault }) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.faulted = false;
    this.rate = new TokenBucket(160, 240);
    this.bytes = new TokenBucket(2 * 1024 * 1024, 4 * 1024 * 1024);
    this.onFault = onFault;
    socket.on('data', (chunk) => {
      if (this.faulted) return;
      if (!this.bytes.take(chunk.length)) return this.fail('RATE_LIMIT', tr('Превышен лимит сетевого обмена.'));
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
      while (!this.faulted) {
        const end = this.buffer.indexOf(10);
        if (end < 0) {
          if (this.buffer.length > LIMITS.frameBytes) this.fail('FRAME_TOO_LARGE', tr('Слишком большое сетевое сообщение.'));
          return;
        }
        if (end > LIMITS.frameBytes) return this.fail('FRAME_TOO_LARGE', tr('Слишком большое сетевое сообщение.'));
        const line = this.buffer.subarray(0, end);
        this.buffer = this.buffer.subarray(end + 1);
        if (!this.rate.take()) return this.fail('RATE_LIMIT', tr('Слишком много сетевых сообщений.'));
        try {
          const message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
          if (!isRecord(message) || typeof message.type !== 'string') throw protocolError();
          onMessage(message);
        } catch (error) {
          this.fail(error.code || 'INVALID_MESSAGE', error instanceof RoomError ? error.message : tr('Получено некорректное сообщение.'));
        }
      }
    });
  }
  send(message) {
    if (this.faulted || this.socket.destroyed || this.socket.writableEnded) return false;
    let line;
    try { line = JSON.stringify(message) + '\n'; } catch { return false; }
    const length = Buffer.byteLength(line, 'utf8');
    if (length - 1 > LIMITS.frameBytes) throw protocolError(tr('Слишком большое сетевое сообщение.'));
    if (this.socket.writableLength + length > LIMITS.queuedBytes) {
      this.fail('SLOW_CLIENT', tr('Соединение слишком медленное; подключитесь снова.'));
      return false;
    }
    this.socket.write(line);
    return true;
  }
  fail(code, message) {
    if (this.faulted) return;
    this.faulted = true;
    this.buffer = Buffer.alloc(0);
    try { this.onFault(new RoomError(code, message)); } catch { this.socket.destroy(); }
  }
}

module.exports = { LIMITS, JsonWire, TokenBucket, isRecord, exactKeys, protocolError,
  validateName, validateChat, validatePresence, validateSignal, validatePeer, validateRoster };
