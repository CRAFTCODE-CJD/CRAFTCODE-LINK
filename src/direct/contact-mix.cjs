'use strict';
const roles = ['voice', 'system'];
const validRole = role => roles.includes(role);
function validLevel(role, value) {
  return validRole(role) && Number.isInteger(value?.volume) && value.volume >= 0 &&
    value.volume <= (role === 'voice' ? 400 : 200) && typeof value.muted === 'boolean';
}
function readMix(friends, saved) {
  const result = {};
  for (const friend of friends) {
    if (friend.state !== 'friend') continue;
    for (const role of roles) {
      const value = saved?.[friend.id]?.[role];
      if (!validLevel(role, value)) continue;
      (result[friend.id] ??= {})[role] = {volume: value.volume, muted: value.muted};
    }
  }
  return result;
}
module.exports = {validLevel, readMix};
