'use strict';
const {tr}=require('../native-language.cjs');
const fs = require('node:fs');
const path = require('node:path');

class AccountProfile {
  constructor(dir, storage) {
    this.file = path.join(dir,'craftlink-account-v1.bin');
    this.storage = storage;
  }
  available() {
    return this.storage.isEncryptionAvailable() && (process.platform !== 'linux' || this.storage.getSelectedStorageBackend?.() !== 'basic_text');
  }
  load() {
    if (!fs.existsSync(this.file) || !this.available()) return null;
    try { return JSON.parse(this.storage.decryptString(fs.readFileSync(this.file))); }
    catch { throw new Error(tr('Не удалось открыть сохранённый вход. Войдите вручную.')); }
  }
  save(id, password) {
    if (!this.available()) throw new Error(tr('Хранилище ОС недоступно. Вход действует до закрытия приложения.'));
    const bytes = this.storage.encryptString(JSON.stringify({id,password}));
    fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});
    require('../profile-paths.cjs').writeProfileFile(this.file, bytes);
  }
  forget() { fs.rmSync(this.file,{force:true}); fs.rmSync(this.file+'.tmp',{force:true}); }
}
module.exports={AccountProfile};
