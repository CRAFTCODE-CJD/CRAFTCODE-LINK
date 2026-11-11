'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

async function pruneRtpReports(directory) {
  const entries = await fs.readdir(directory, {withFileTypes: true});
  const ownedName = /^RTP-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;
  const names = entries.filter(entry => entry.isFile() && ownedName.test(entry.name))
    .map(entry => entry.name).sort().reverse();
  for (const name of names.slice(5)) {
    await fs.rm(path.join(directory, name), {force: true});
  }
}
module.exports = {pruneRtpReports};
