import {tr} from './locale.mjs';
import { jid } from './account-address.mjs';

const uuid = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const pattern = new RegExp('^LINK1:([^/]+)/(' + uuid + ')/(' + uuid + ')$', 'i');

export function parseRoomCode(text) {
  const match = pattern.exec(String(text).trim());
  if (!match || !jid(match[1])) throw new Error(tr('Скопируйте приглашение целиком. Оно начинается с LINK1: или CL1:.'));
  return {owner:jid(match[1]), full:jid(match[1]) + '/craftlink-' + match[2], room:match[3]};
}
export function roomCode(account, id) {
  return 'LINK1:' + account.id + '/' + account.resource.slice('craftlink-'.length) + '/' + id;
}
