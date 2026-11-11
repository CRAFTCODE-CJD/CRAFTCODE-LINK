'use strict';

const { createHash, X509Certificate } = require('node:crypto');
const selfsigned = require('selfsigned');

function fingerprintOf(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

async function createRoomCertificate() {
  const pems = await new Promise((resolve, reject) => {
    selfsigned.generate([{ name: 'commonName', value: 'CRAFTCODE LINK ephemeral room' }], {
      keySize: 2048,
      algorithm: 'sha256',
      days: 7,
      notBeforeDate: new Date(Date.now() - 5 * 60 * 1000),
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true, clientAuth: false },
      ],
    }, (error, result) => error ? reject(error) : resolve(result));
  });
  return { key: pems.private, cert: pems.cert, fingerprint: fingerprintOf(new X509Certificate(pems.cert).raw) };
}

module.exports = { createRoomCertificate, fingerprintOf };
