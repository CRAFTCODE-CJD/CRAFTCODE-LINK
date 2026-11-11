// A preference is local to the signed-in person on this device. Only beginning
// a room from the call/join flow arms a one-time microphone request.
export class RoomMicrophoneChoice {
  constructor(storage, owner, now = () => performance.now()) {
    this.storage = storage;
    this.owner = owner;
    this.now = now;
    this.pending = null;
  }
  key() {
    const person = this.owner();
    return person ? 'craftlink.room-microphone.v1.' + person : null;
  }
  read() {
    const key = this.key();
    if (!key) return null;
    try {
      const value = this.storage.getItem(key);
      if (value == null) return 'muted';
      return value === 'on' || value === 'muted' ? value : null;
    } catch { return null; }
  }
  write(value) {
    this.pending = null;
    const key = this.key();
    if (!key) return;
    const saved = value === 'on' || value === 'muted' ? value : 'off';
    try { this.storage.setItem(key, saved); }
    catch (error) {
      // If the quota is full, a previous "on" must not survive a local mute.
      if (saved !== 'on') this.storage.removeItem(key);
      throw error;
    }
  }
  begin() {
    this.pending = this.read() === 'on' ? {owner:this.owner(), until:this.now()+30000} : null;
  }
  reconnect(wasSpeaking) {
    // Same running call, including a microphone enabled by hand. After a
    // process restart, joining again uses the stored profile preference.
    this.pending = wasSpeaking ? {owner:this.owner(), reconnect:true, until:this.now()+30000} : null;
  }
  take(media) {
    // A delayed permissions packet from an old or disconnected host cannot
    // turn on the device later, after the original room join has settled.
    if (this.pending && this.now() >= this.pending.until) this.pending = null;
    if (!this.pending || !media.rightsKnown) return false;
    const entry = this.pending;
    this.pending = null;
    return this.owner() === entry.owner && (entry.reconnect || this.read() === 'on') &&
      !media.closed && (media.isHost || !media.moderated) && media.allowed(media.selfSlot, 'voice');
  }
}
