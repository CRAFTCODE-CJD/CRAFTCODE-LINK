export function cleanDisplayName(value) {
  return typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0,32).trim() : '';
}
export function profileName(id, names, localName) {
  if (!id) return cleanDisplayName(localName);
  return cleanDisplayName(names[id]) || id.split('@')[0].slice(0,32);
}
