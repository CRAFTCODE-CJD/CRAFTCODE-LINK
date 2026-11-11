const roles = ['voice', 'system'];
const defaults = {volume: 100, muted: false};

// Room peer IDs last for one connection. Only a verified LINK identity may
// carry playback preferences into another room or onto another device of the friend.
export function participantMix({state, mixer, snapshot, save, changed, onError}) {
  const bindings = new Map(), local = new Map(), touched = new Map();
  let epoch,scope;
  function sync() {
    if (epoch !== state.roomEpoch || !state.session) {
      bindings.clear(); local.clear(); touched.clear(); epoch = state.roomEpoch;
    }
    const session = state.session;
    if (!session) return;
    if(scope!==session.mixRoom){bindings.clear();touched.clear();scope=session.mixRoom;}
    const data = (session.direct || session.groupVoice) && snapshot();
    const members = data?.mixRoom && data.mixRoom === session.mixRoom ? data.roomContacts : null;
    const live = new Set(state.peers.map(p => p.id));
    for (const id of bindings.keys()) if (!live.has(id)) bindings.delete(id);
    for (const id of touched.keys()) if (!live.has(id)) touched.delete(id);
    for (const peer of state.peers) {
      if (peer.id === session.selfId) continue;
      const person = session.direct && session.role === 'guest' && peer.id === session.hostId
        ? session.hostPerson : members?.[peer.id];
      const friend = person && data?.friends?.find(f => f.id === person && f.state === 'friend');
      const key = friend ? data.me.id + '/' + person : '';
      const previous = bindings.get(peer.id);
      if ((previous?.key || '') === key) {
        if (friend) {
          let restored=false;
          for (const role of roles) {
            if (local.get(key)?.[role]) continue;
            const saved=friend.mix?.[role] || defaults, current=mixer.getSetting(peer.id,role);
            if (current.volume!==saved.volume || current.muted!==saved.muted) {
              mixer.setSetting(peer.id,role,saved);restored=true;
            }
          }
          if(restored)changed(peer.id);
        }
        continue;
      }
      if (friend) {
        const binding = {key, owner: data.me.id, person, peer: peer.id, room: session.mixRoom};
        bindings.set(peer.id, binding);
        for (const role of roles) {
          const current = local.get(key)?.[role] || friend.mix?.[role] || defaults;
          const patch = !previous && touched.get(peer.id)?.[role];
          mixer.setSetting(peer.id, role, current);
          if (patch) set(peer.id, role, patch, true);
        }
      } else {
        bindings.delete(peer.id);
        // A block or loss of the verified binding must not unmute a live seat.
        // Its existing local playback setting now lasts only for this connection.
        if(!data?.friends?.some(f=>f.id===previous.person && f.state==='friend'))local.delete(previous.key);
      }
      touched.delete(peer.id);
      changed(peer.id);
    }
  }
  function set(id, role, patch, commit) {
    if (!state.session || id === state.session.selfId || !state.peers.some(p => p.id === id)) return;
    const {volume, muted} = mixer.setSetting(id, role, patch);
    const binding = bindings.get(id);
    if (binding) {
      const levels = local.get(binding.key) || {};
      levels[role] = {volume, muted};
      local.set(binding.key, levels);
      for (const other of bindings.values()) {
        if (other.peer !== id && other.key === binding.key) {
          mixer.setSetting(other.peer, role, {volume, muted}); changed(other.peer);
        }
      }
      if (commit) save({op:'room-mix', owner:binding.owner, room:binding.room, peer:id, person:binding.person, role, volume, muted}).catch(onError);
    } else if ((state.session.direct || state.session.groupVoice) && commit) {
      const levels = touched.get(id) || {};
      levels[role] = {...levels[role], ...patch};
      touched.set(id, levels);
    }
    changed(id);
  }
  return {sync, set, remembered:id => bindings.has(id)};
}
