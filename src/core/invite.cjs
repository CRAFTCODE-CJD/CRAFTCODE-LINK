'use strict';
const {tr}=require('../native-language.cjs');

const { isIP } = require('node:net');

const INVITE_PREFIX = 'CL1:';
const DEFAULT_PORT = 45831;
const DEFAULT_UDP_MIN = 45832;
const DEFAULT_UDP_MAX = 45863;

class RoomError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RoomError';
    this.code = code;
  }
}

function invalid(message = tr('Неверный формат приглашения.')) {
  throw new RoomError('INVALID_INVITE', message);
}

function validateAddress(value) {
  if (typeof value !== 'string') invalid(tr('Укажите IPv4-адрес или DNS-имя создателя.'));
  let address = value.trim().toLowerCase();
  if (address.endsWith('.')) address = address.slice(0, -1);
  if (address.length < 1 || address.length > 253 || /[\s/:@?#\\\[\]\x00-\x1f\x7f]/.test(address)) {
    invalid(tr('Нужен IPv4-адрес или DNS-имя, без http://, порта и пути.'));
  }
  if (isIP(address) === 4) {
    const octets = address.split('.').map(Number);
    if (octets[0] === 0 || octets[0] >= 224 || address === '255.255.255.255') {
      invalid(tr('Этот IPv4-адрес нельзя использовать для подключения.'));
    }
    return address;
  }
  // Numeric dotted values are IP typos, not domain names to resolve externally.
  if (/^[\d.]+$/.test(address)) invalid(tr('Некорректный IPv4-адрес.'));
  const labels = address.split('.');
  if (!labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    invalid(tr('Некорректное DNS-имя. Для национальных доменов используйте punycode.'));
  }
  return address;
}

function validatePort(value, { allowZero = false } = {}) {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1) || value > 65535) {
    throw new RoomError('INVALID_PORT', tr('Порт должен быть целым числом от 1 до 65535.'));
  }
  return value;
}

function validateUdpRange(min = DEFAULT_UDP_MIN, max = DEFAULT_UDP_MAX) {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1024 || max > 65535 || max < min || max - min > 127) {
    throw new RoomError('INVALID_PORT', tr('Неверный диапазон UDP-портов.'));
  }
  return { udpMin: min, udpMax: max };
}

function validateToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || Buffer.from(token, 'base64url').length !== 32) {
    invalid();
  }
  // Buffer's permissive base64 decoder must not accept non-canonical secret bits.
  if (Buffer.from(token, 'base64url').toString('base64url') !== token) invalid();
  return token;
}

function validateFingerprint(fingerprint) {
  if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) invalid();
  return fingerprint;
}

function encodeInvite({ address, port, token, fingerprint, udpMin = DEFAULT_UDP_MIN, udpMax = DEFAULT_UDP_MAX }) {
  const value = {
    v: 1,
    a: validateAddress(address),
    p: validatePort(port),
    t: validateToken(token),
    f: validateFingerprint(fingerprint),
    u: [validateUdpRange(udpMin, udpMax).udpMin, udpMax],
  };
  return INVITE_PREFIX + Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeInvite(value) {
  if (typeof value !== 'string') invalid();
  const trimmed = value.trim();
  if (trimmed.length > 2048 || !trimmed.startsWith(INVITE_PREFIX)) invalid();
  const payload = trimmed.slice(INVITE_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) invalid();
  const bytes = Buffer.from(payload, 'base64url');
  if (bytes.toString('base64url') !== payload) invalid();
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    invalid();
  }
  if (!parsed || Array.isArray(parsed) || parsed.v !== 1 || Object.keys(parsed).sort().join(',') !== 'a,f,p,t,u,v') invalid();
  if (!Array.isArray(parsed.u) || parsed.u.length !== 2) invalid();
  return Object.freeze({
    version: 1,
    address: validateAddress(parsed.a),
    port: validatePort(parsed.p),
    token: validateToken(parsed.t),
    fingerprint: validateFingerprint(parsed.f),
    ...validateUdpRange(parsed.u[0], parsed.u[1]),
  });
}

module.exports = {
  RoomError, INVITE_PREFIX, DEFAULT_PORT, DEFAULT_UDP_MIN, DEFAULT_UDP_MAX,
  encodeInvite, decodeInvite, validateAddress, validatePort, validateUdpRange,
};
