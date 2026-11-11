import {tr} from './locale.mjs';
import { getProvider, providers } from './providers.mjs';

export function jid(value) {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-z0-9.,_+=-]{1,64}@[a-z0-9.-]{1,200}$/.test(id) && id.split('@')[1].includes('.') ? id : '';
}
export function loginProvider(value) {
  const domain = jid(value).split('@')[1];
  return Object.keys(providers).find(key => {
    const p = providers[key];
    return p.domain === domain || p.aliases?.includes(domain);
  }) || '';
}
export function loginAddress(input, provider) {
  const text = (typeof input === 'string' ? input.trim() : '').replace(/^xmpp:/i, '');
  if (!text || text.includes('://') || /^CL1:/i.test(text) || /[?#/]/.test(text))
    throw new Error(tr('Введите имя или полный адрес аккаунта, например alex@jabber.club.'));
  const selected = getProvider(provider);
  if (!text.includes('@') && !selected) throw new Error(tr('Введите полный адрес или выберите сервис, где вы зарегистрировались.'));
  const id = jid(text.includes('@') ? text : text + '@' + selected.domain);
  if (!loginProvider(id)) throw new Error(tr('Проверьте адрес. Домен после @ должен принадлежать сервису из списка.'));
  return id;
}
