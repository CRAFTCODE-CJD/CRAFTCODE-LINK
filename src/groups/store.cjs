'use strict';
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {tr}=require('../native-language.cjs');

// Each commit includes the group and its handoff fence in the same SQLite row.
// The room listing and history are protected by this Windows account's keystore.
class GroupStore {
  constructor(profileStore){
    this.backend=profileStore.storage;
    this.file=profileStore.file && path.join(path.dirname(profileStore.file),'link-groups-v1.sqlite');
    this.records=new Map();
  }
  start(me){
    if(!me || this.owner===me.id+me.device)return;
    this.close();this.owner=me.id+me.device;
    if(this.file && fs.existsSync(this.file))this.open();
  }
  open(){
    if(this.db||!this.file)return;
    if(!this.owner || !this.backend?.isEncryptionAvailable() || process.platform==='linux'&&this.backend.getSelectedStorageBackend?.()==='basic_text')
      throw Error(tr('Хранилище ключей ОС недоступно.'));
    fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});
    const db=new DatabaseSync(this.file,{timeout:2000});
    try{
      db.exec('PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;');
      db.exec('CREATE TABLE IF NOT EXISTS groups(owner TEXT NOT NULL,id TEXT NOT NULL,payload BLOB NOT NULL,PRIMARY KEY(owner,id))');
      for(const row of db.prepare('SELECT id,payload FROM groups WHERE owner=?').all(this.owner)){
        const rec=JSON.parse(this.backend.decryptString(Buffer.from(row.payload)));
        if(rec.id!==row.id)throw Error(tr('Локальная группа повреждена.'));
        this.records.set(rec.id,rec);
      }
      this.db=db;
    }catch(error){db.close();this.records.clear();throw error;}
  }
  put(rec){
    if(!this.owner)throw Error(tr('Сначала войдите в профиль LINK.'));
    this.open();
    if(this.db)this.db.prepare('INSERT OR REPLACE INTO groups(owner,id,payload) VALUES(?,?,?)')
      .run(this.owner,rec.id,this.backend.encryptString(JSON.stringify(rec)));
    this.records.set(rec.id,rec);
  }
  remove(id){
    this.db?.prepare('DELETE FROM groups WHERE owner=? AND id=?').run(this.owner,id);
    this.records.delete(id);
  }
  close(){this.db?.close();this.db=null;this.owner=null;if(this.file)this.records.clear();}
}
function eraseGroups(dir){
  // Only private hosted payloads and incomplete handoffs live below this
  // fixed directory. User-selected downloads have a different storage root.
  fs.rmSync(path.join(dir,'group-files-v1'),{recursive:true,force:true,maxRetries:8,retryDelay:100});
  for(const ext of ['','-journal','-wal','-shm'])fs.rmSync(path.join(dir,'link-groups-v1.sqlite'+ext),{force:true});
}
module.exports={GroupStore,eraseGroups};
