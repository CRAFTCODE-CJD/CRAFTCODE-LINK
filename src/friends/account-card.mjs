// A user-selected, human-readable address reminder. The card cannot authenticate anyone.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { jid, loginProvider } from '../renderer/account-address.mjs';

const header = 'CRAFTCODE LINK — карточка входа';
const limit = 4096;
const invalid = 'Не удалось прочитать карточку CRAFTCODE LINK. Выберите сохранённый TXT-файл или введите адрес вручную.';
function checkedAddress(value) {
  const id = jid(value);
  if (!loginProvider(id)) throw new Error(invalid);
  return id;
}
export function makeCard(value) {
  const id = checkedAddress(value);
  return [header, 'Адрес: ' + id, '', 'После переустановки выберите «У меня уже есть аккаунт» → «Открыть карточку входа».',
    'Введите пароль от аккаунта. Затем появится ваш список друзей.', 'Карточка содержит только ваш адрес.', ''].join('\r\n');
}
export function parseCard(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > limit) throw new Error(invalid);
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const addresses = lines.filter(line => line.startsWith('Адрес: '));
  if (lines[0] !== header || addresses.length !== 1 || lines[1] !== addresses[0]) throw new Error(invalid);
  return checkedAddress(addresses[0].slice('Адрес: '.length));
}
export async function readCard(filename) {
  if (path.extname(filename).toLowerCase() !== '.txt' || !(await fs.lstat(filename)).isFile()) throw new Error(invalid);
  const file = await fs.open(filename, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error(invalid);
    const buffer = Buffer.alloc(limit + 1);
    for (let n=0; n<=limit;) {
      const { bytesRead } = await file.read(buffer, n, limit + 1 - n, n);
      if (!bytesRead) return parseCard(buffer.toString('utf8', 0, n));
      n += bytesRead;
    }
    throw new Error(invalid);
  } finally { await file.close(); }
}
export async function writeCard(filename, id, protectedFolders) {
  const card = makeCard(id);
  if (path.extname(filename).toLowerCase() !== '.txt') throw new Error('Сохраните карточку как файл .txt.');
  const parent=await outsideProfile(filename,protectedFolders);
  const temp = path.join(parent, '.craftcode-card-' + randomUUID());
  try {
    await fs.writeFile(temp, '\uFEFF' + card, { flag:'wx', mode:0o600 });
    await fs.rename(temp, filename);
  } finally { await fs.rm(temp, { force:true }); }
}

export async function outsideProfile(filename,protectedFolders){
  const parent = await fs.realpath(path.dirname(filename));
  for (const folder of protectedFolders) {
    const root = await fs.realpath(folder);
    const rel = path.relative(root, parent);
    if (!rel || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)))
      throw new Error('Выберите папку вне CRAFTCODE LINK, например «Документы», чтобы файл сохранился после удаления программы.');
  }
  return parent;
}
