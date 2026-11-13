'use strict';
const os = require('node:os');
const { isIPv4 } = require('node:net');
const { randomInt } = require('node:crypto');

// Keep the range understood by existing clients and the Windows helper.
const firstSecondOctet = 80, lastSecondOctet = 223, perBlock = 253;
const prefixCount = (lastSecondOctet - firstSecondOctet + 1) * perBlock;

function ipv4Number(address) {
  return address.split('.').reduce((value, octet) => value * 256 + Number(octet), 0);
}

function validPrefix(prefix) {
  if (typeof prefix !== 'string' || !isIPv4(prefix + '.0')) return false;
  const [first, second, third] = prefix.split('.').map(Number);
  return first === 10 && second >= firstSecondOctet && second <= lastSecondOctet && third >= 1 && third <= perBlock;
}

function interfaceRanges(interfaces = os.networkInterfaces(), skipLink = false) {
  const ranges = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    // At activation the authenticated helper independently checks the LINK device identity.
    if (skipLink && name.toLowerCase() === 'craftcode link lan') continue;
    for (const entry of entries || []) {
      if (entry?.family !== 'IPv4' && entry?.family !== 4) continue;
      if (!isIPv4(entry.address) || !isIPv4(entry.netmask)) throw Error('Invalid IPv4 interface');
      const ip = ipv4Number(entry.address), mask = ipv4Number(entry.netmask);
      const first = (ip & mask) >>> 0, last = (ip | ~mask) >>> 0;
      ranges.push({ first: first >>> 8, last: last >>> 8 });
    }
  }
  return ranges.sort((a, b) => a.first - b.first);
}

function overlaps(prefix, ranges) {
  const block = ipv4Number(prefix + '.0') >>> 8;
  return ranges.some(range => range.first <= block && block <= range.last);
}

function candidateBlock(index) {
  const second = firstSecondOctet + Math.floor(index / perBlock);
  return (10 * 256 + second) * 256 + 1 + index % perBlock;
}

function formatBlock(block) {
  return '10.' + ((block >>> 8) & 255) + '.' + (block & 255);
}

function chooseFreePrefix(ranges) {
  const available = [];
  let next = 0;
  for (let i = 0; i < prefixCount; i++) {
    const block = candidateBlock(i);
    while (next < ranges.length && ranges[next].last < block) next++;
    if (next === ranges.length || block < ranges[next].first) available.push(block);
  }
  return available.length ? formatBlock(available[randomInt(available.length)]) : null;
}

function newRoomPrefix() {
  // Match chat works even if the OS cannot provide an interface list or a VPN covers the entire pool.
  // Activation rechecks the chosen room prefix on each participant's own PC.
  let ranges = [];
  try { ranges = interfaceRanges(); } catch { /* Chat can be created before the network is available. */ }
  return chooseFreePrefix(ranges) ?? formatBlock(candidateBlock(randomInt(prefixCount)));
}

module.exports = { ipv4Number, validPrefix, interfaceRanges, overlaps, chooseFreePrefix, newRoomPrefix };
