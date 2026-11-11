'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {tr}=require('../native-language.cjs');

const PAGE_SIZE=128;
const RECEIVED=2;
const SNAPSHOT_PART=24*1024*16, SNAPSHOT_QUOTA=512*1024**2;
const schema=`
  CREATE TABLE metadata (wrapped BLOB NOT NULL);
  CREATE TABLE messages (
    n INTEGER PRIMARY KEY AUTOINCREMENT, person TEXT NOT NULL, epoch TEXT NOT NULL,
    uid TEXT NOT NULL, state INTEGER NOT NULL, unread INTEGER NOT NULL, bytes INTEGER NOT NULL,
    payload BLOB NOT NULL, UNIQUE(person, uid)
  );
  CREATE INDEX dialogue ON messages(person, epoch, n DESC);
  CREATE INDEX unread_messages ON messages(person, epoch, n) WHERE unread=1;
  CREATE INDEX outbox ON messages(n) WHERE state=0;
  CREATE UNIQUE INDEX outgoing_id ON messages(uid) WHERE state IN (0,1);
  CREATE TABLE receipts (device TEXT PRIMARY KEY, person TEXT NOT NULL, seq INTEGER NOT NULL, uid TEXT NOT NULL);
`;

class ChatStore {
  constructor(dir,storage){
    this.file=path.join(dir,'link-personal-chats-v1.sqlite');this.storage=storage;
    this.relocatedPath=require('../profile-relocations.cjs').createPathResolver(dir);
  }
  open(me){
    this.close();this.owner={id:me.id,device:me.device};
    if(!this.storage.isEncryptionAvailable() || (process.platform==='linux' && this.storage.getSelectedStorageBackend?.()==='basic_text'))throw Error(tr('Хранилище ключей ОС недоступно.'));
    if(fs.existsSync(this.file))this.database();
  }
  database(){
    if(this.db)return this.db;
    if(!this.owner)throw Error(tr('Сначала войдите в профиль LINK.'));
    fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync(this.file,{timeout:1500});
    try{
      db.exec('PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;');
      const fresh=!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' LIMIT 1").get();
      if(fresh){
        if(process.platform!=='win32')fs.chmodSync(this.file,0o600);
        const key=crypto.randomBytes(32);
        try{
          const wrapped=this.storage.encryptString(JSON.stringify({v:1,...this.owner,key:key.toString('hex')}));
          db.exec('PRAGMA auto_vacuum=FULL; BEGIN IMMEDIATE;');
          db.exec(schema);db.prepare('INSERT INTO metadata VALUES (?)').run(wrapped);db.exec('COMMIT');
        }finally{key.fill(0);}
      }
      const meta=JSON.parse(this.storage.decryptString(Buffer.from(db.prepare('SELECT wrapped FROM metadata').get().wrapped)));
      if(meta.v!==1 || meta.id!==this.owner.id || meta.device!==this.owner.device ||
        typeof meta.key!=='string' || !/^[0-9a-f]{64}$/.test(meta.key))throw Error(tr('Локальная история личных чатов недоступна.'));
      db.exec('CREATE TABLE IF NOT EXISTS attachment_data (n INTEGER PRIMARY KEY REFERENCES messages(n) ON DELETE CASCADE, kind TEXT NOT NULL, payload BLOB NOT NULL)');
      db.exec(`CREATE TABLE IF NOT EXISTS attachment_files (id TEXT PRIMARY KEY, n INTEGER UNIQUE REFERENCES messages(n) ON DELETE CASCADE, size INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS attachment_parts (id TEXT NOT NULL REFERENCES attachment_files(id) ON DELETE CASCADE, pos INTEGER NOT NULL, payload BLOB NOT NULL, PRIMARY KEY(id,pos)) WITHOUT ROWID;
        DELETE FROM attachment_files WHERE n IS NULL;
        CREATE TABLE IF NOT EXISTS message_reads (n INTEGER PRIMARY KEY REFERENCES messages(n) ON DELETE CASCADE, device TEXT NOT NULL, seq INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS reads_by_device ON message_reads(device,n);
        CREATE TABLE IF NOT EXISTS read_targets (n INTEGER NOT NULL REFERENCES messages(n) ON DELETE CASCADE, device TEXT NOT NULL, seen INTEGER NOT NULL, PRIMARY KEY(n,device)) WITHOUT ROWID;`);
      // Download receipts survive a text-only clear. They contain no message or
      // caption and can authorize deletion only on this profile and device.
      db.exec('CREATE TABLE IF NOT EXISTS downloads (n INTEGER PRIMARY KEY, person TEXT NOT NULL, payload BLOB NOT NULL); CREATE INDEX IF NOT EXISTS download_person ON downloads(person)');
      this.count=db.prepare('SELECT count(*) AS n FROM messages').get().n;
      this.key=Buffer.from(meta.key,'hex');this.db=db;return db;
    }catch(e){db.close();throw e;}
  }
  close(){
    this.db?.close();this.db=null;this.key?.fill(0);this.key=null;this.owner=null;this.count=0;this.referencedPaths=null;
  }
  erase(){
    this.close();
    for(const suffix of ['','-journal','-shm','-wal'])fs.rmSync(this.file+suffix,{force:true});
  }
  tag(label,value){return crypto.createHmac('sha256',this.key).update(label+'\0'+value).digest('hex');}
  scope(person,epoch){return [this.tag('person',person),this.tag('friendship',epoch)];}
  pack(person,epoch,id,text,time,outgoing,attachment,origin){
    const [p,e]=this.scope(person,epoch),uid=this.tag('message',id),nonce=crypto.randomBytes(12);
    const cipher=crypto.createCipheriv('aes-256-gcm',this.key,nonce);
    cipher.setAAD(Buffer.from([p,e,uid,outgoing?'out':'in'].join('|')));
    const body=cipher.update(JSON.stringify({person,id,text,time,attachment,origin}),'utf8');
    return [p,e,uid,Buffer.concat([nonce,body,cipher.final(),cipher.getAuthTag()])];
  }
  unpack(row){
    const payload=Buffer.from(row.payload),out=row.state!==RECEIVED;
    const dec=crypto.createDecipheriv('aes-256-gcm',this.key,payload.subarray(0,12));
    dec.setAuthTag(payload.subarray(-16));
    dec.setAAD(Buffer.from([row.person,row.epoch,row.uid,out?'out':'in'].join('|')));
    const item=JSON.parse(Buffer.concat([dec.update(payload.subarray(12,-16)),dec.final()]).toString('utf8'));
    const read=out&&row.state===1&&this.db.prepare('SELECT 1 FROM read_targets WHERE n=? AND seen=1 LIMIT 1').get(row.n);
    return {...item,direction:out?'out':'in',status:read?'read':['pending','delivered','received'][row.state],unread:!!row.unread,seq:row.n};
  }
  stats(){
    return this.db?{bytes:fs.statSync(this.file).size,messages:this.count,downloads:this.hasDownloads()}:{bytes:0,messages:0};
  }
  hasDownloads(person){
    if(!this.db)return false;
    return !!(person===undefined?this.db.prepare('SELECT 1 FROM downloads LIMIT 1').get():
      this.db.prepare('SELECT 1 FROM downloads WHERE person=? LIMIT 1').get(this.tag('person',person)));
  }
  summary(person,epoch){
    if(!this.db)return {unread:0,last:null};
    const scope=this.scope(person,epoch);
    const last=this.db.prepare('SELECT * FROM messages WHERE person=? AND epoch=? ORDER BY n DESC LIMIT 1').get(...scope);
    const unread=this.db.prepare('SELECT count(*) AS n FROM messages WHERE person=? AND epoch=? AND unread=1').get(...scope).n;
    return {unread,last:last?this.unpack(last):null};
  }
  page(person,epoch,before){
    if(!this.db)return {messages:[],hasMore:false};
    const scope=this.scope(person,epoch);
    let anchor=Number.MAX_SAFE_INTEGER;
    if(before!==undefined){
      const row=this.db.prepare('SELECT n FROM messages WHERE person=? AND epoch=? AND uid=?').get(...scope,this.tag('message',before));
      if(!row)return {messages:[],hasMore:false};
      anchor=row.n;
    }
    const rows=this.db.prepare('SELECT * FROM messages WHERE person=? AND epoch=? AND n<? ORDER BY n DESC LIMIT ?').all(...scope,anchor,PAGE_SIZE+1);
    return {messages:rows.slice(0,PAGE_SIZE).reverse().map(r=>this.unpack(r)),hasMore:rows.length>PAGE_SIZE};
  }
  markRead(person,epoch,through){
    if(!this.db)return false;
    const scope=this.scope(person,epoch);
    let cutoff=Number.MAX_SAFE_INTEGER;
    if(through!==undefined){
      const row=this.db.prepare('SELECT n FROM messages WHERE person=? AND epoch=? AND uid=? AND state=?')
        .get(...scope,this.tag('message',through),RECEIVED);
      if(!row)return false;
      cutoff=row.n;
    }
    return this.db.prepare('UPDATE messages SET unread=0 WHERE person=? AND epoch=? AND n<=? AND unread=1').run(...scope,cutoff).changes>0;
  }
  markVisible(person,epoch,ids){
    if(!this.db)return false;
    const matches=ids.map(()=>'?').join(',');
    return this.db.prepare('UPDATE messages SET unread=0 WHERE person=? AND epoch=? AND state=2 AND unread=1 AND uid IN ('+matches+')')
      .run(...this.scope(person,epoch),...ids.map(id=>this.tag('message',id))).changes>0;
  }
  clear(person){
    if(!this.db)return false;
    const db=this.db,params=person===undefined?[]:[this.tag('person',person)];
    db.exec('BEGIN IMMEDIATE');
    try{
      // Older versions only recorded the filename beside the message. Import
      // those exact saved copies before the foreign-key cascade removes it.
      const legacy=db.prepare("SELECT m.* FROM messages m JOIN attachment_data a ON a.n=m.n LEFT JOIN downloads d ON d.n=m.n WHERE a.kind='saved' AND d.n IS NULL"+(params.length?' AND m.person=?':''));
      for(const record of legacy.all(...params)){
        this.rememberDownload(this.unpack(record),this.attachmentData(record.n).bytes.toString('utf8'));
      }
      const removed=db.prepare('DELETE FROM messages'+(params.length?' WHERE person=?':'')).run(...params).changes;
      db.exec('COMMIT');
      this.count-=removed;this.referencedPaths=null;return removed>0;
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  rememberDownload(row,filename,identity){
    const person=this.tag('person',row.person);
    const receipt={person:row.person,filename,size:row.attachment.size,sha:row.attachment.sha,identity};
    const payload=this.encryptBlob('download/'+person+'/'+row.seq,Buffer.from(JSON.stringify(receipt)));
    this.db.prepare('INSERT INTO downloads(n,person,payload) VALUES (?,?,?)').run(row.seq,person,payload);
  }
  saveDownload(row,filename,identity){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.setAttachment(row.seq,'saved',Buffer.from(filename));
      this.rememberDownload(row,filename,identity);
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  downloadIds(person){
    if(!this.db)return [];
    const rows=person===undefined?this.db.prepare('SELECT n FROM downloads ORDER BY n').all():
      this.db.prepare('SELECT n FROM downloads WHERE person=? ORDER BY n').all(this.tag('person',person));
    return rows.map(row=>row.n);
  }
  downloadReceipt(n){
    const r=this.db?.prepare('SELECT person,payload FROM downloads WHERE n=?').get(n);
    if(r){const receipt=JSON.parse(this.decryptBlob('download/'+r.person+'/'+n,r.payload).toString('utf8'));
      return {...receipt,...this.relocatedPath(receipt.filename)};}
  }
  forgetDownload(n){this.db.prepare('DELETE FROM downloads WHERE n=?').run(n);}
  referencesPath(filename){
    const normalize=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
    if(!this.referencedPaths){
      const paths=new Set();
      for(const {n} of this.db.prepare("SELECT n FROM attachment_data WHERE kind IN ('path','saved')").iterate()){
        paths.add(normalize(this.attachmentData(n).bytes.toString('utf8')));
      }
      this.referencedPaths=paths;
    }
    return this.referencedPaths.has(normalize(filename));
  }
  pendingContacts(friends){
    if(!this.db)return [];
    const queued=new Set(this.db.prepare('SELECT DISTINCT person FROM messages WHERE state=0').all().map(r=>r.person));
    return friends.filter(f=>f.state==='friend' && queued.has(this.tag('person',f.id))).map(f=>f.id);
  }
  oldest(person,epoch){
    if(!this.db)return null;
    const row=this.db.prepare('SELECT * FROM messages WHERE person=? AND epoch=? AND state=0 ORDER BY n LIMIT 1').get(...this.scope(person,epoch));
    return row?this.unpack(row):null;
  }
  message(person,epoch,id){
    if(!this.db)return;
    const row=this.db.prepare('SELECT * FROM messages WHERE person=? AND epoch=? AND uid=?').get(...this.scope(person,epoch),this.tag('message',id));
    return row&&this.unpack(row);
  }
  attachmentKind(n){return this.db?.prepare('SELECT kind FROM attachment_data WHERE n=?').get(n)?.kind;}
  markAttachmentPlayed(n){
    const row=this.db?.prepare('SELECT * FROM messages WHERE n=? AND state=?').get(n,RECEIVED);
    if(!row)return false;
    const item=this.unpack(row);
    if(!['voice','circle'].includes(item.attachment?.clip))return false;
    if(item.played)return true;
    const {person,id,text,time,attachment,origin}=item;
    const payload=this.encryptBlob([row.person,row.epoch,row.uid,'in'].join('|'),
      Buffer.from(JSON.stringify({person,id,text,time,attachment,origin,played:true})));
    this.db.prepare('UPDATE messages SET payload=? WHERE n=? AND state=?').run(payload,n,RECEIVED);
    return true;
  }
  startSnapshot(id,size){
    const db=this.database(),key=this.tag('message',id);
    if(size+db.prepare('SELECT coalesce(sum(size),0) AS size FROM attachment_files').get().size>SNAPSHOT_QUOTA)
      throw Error(tr('Хранилище вложений заполнено. Очистите старые личные сообщения.'));
    db.prepare('INSERT INTO attachment_files(id,size) VALUES(?,?)').run(key,size);return key;
  }
  stagePart(key,pos,bytes){
    this.db.prepare('INSERT INTO attachment_parts VALUES(?,?,?)').run(key,pos,this.encryptBlob('file/'+key+'/'+pos,bytes));
  }
  dropStaged(key){this.db?.prepare('DELETE FROM attachment_files WHERE id=? AND n IS NULL').run(key);}
  snapshotPart(n,pos){
    const row=this.db.prepare('SELECT p.id,p.payload FROM attachment_parts p JOIN attachment_files f ON f.id=p.id JOIN messages m ON m.n=f.n AND m.uid=f.id WHERE f.n=? AND p.pos=?').get(n,pos);
    if(!row)throw Error(tr('Вложение недоступно. Попросите друга поделиться им снова.'));
    return this.decryptBlob('file/'+row.id+'/'+pos,row.payload);
  }
  encryptBlob(aad,bytes){
    const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.key,nonce);
    cipher.setAAD(Buffer.from(aad));
    return Buffer.concat([nonce,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]);
  }
  decryptBlob(aad,bytes){
    const p=Buffer.from(bytes),dec=crypto.createDecipheriv('aes-256-gcm',this.key,p.subarray(0,12));
    dec.setAAD(Buffer.from(aad));dec.setAuthTag(p.subarray(-16));
    return Buffer.concat([dec.update(p.subarray(12,-16)),dec.final()]);
  }
  setAttachment(n,kind,bytes=Buffer.alloc(0)){
    const db=this.db,payload=this.encryptBlob('attachment/'+n+'/'+kind,bytes);
    if(['clip','memory'].includes(kind) && db.prepare("SELECT coalesce(sum(length(payload)),0) AS size FROM attachment_data WHERE kind IN ('clip','memory')").get().size+payload.length>128*1024*1024)
      throw Error(tr('Хранилище записей заполнено. Очистите старые личные сообщения.'));
    if(kind==='withdrawn')db.exec('SAVEPOINT revoke_attachment');
    try{
      db.prepare('INSERT INTO attachment_data VALUES(?,?,?) ON CONFLICT(n) DO UPDATE SET kind=excluded.kind,payload=excluded.payload').run(n,kind,payload);
      if(kind==='withdrawn'){
        db.prepare('DELETE FROM attachment_files WHERE n=?').run(n);db.exec('RELEASE revoke_attachment');
      }
    }catch(error){
      if(kind==='withdrawn')try{db.exec('ROLLBACK TO revoke_attachment; RELEASE revoke_attachment');}catch{}
      throw error;
    }
    this.referencedPaths=null;
  }
  attachmentData(n){
    const row=this.db?.prepare('SELECT kind,payload FROM attachment_data WHERE n=?').get(n);
    if(!row)return;
    let bytes=this.decryptBlob('attachment/'+n+'/'+row.kind,row.payload);
    if(row.kind==='path'||row.kind==='saved'){
      const next=this.relocatedPath(bytes.toString('utf8'));if(next)bytes=Buffer.from(next.filename);
    }
    return {kind:row.kind,bytes};
  }
  enqueue(person,epoch,id,text,attachment,source){
    const db=this.database(),[p,e,uid,payload]=this.pack(person,epoch,id,text,Date.now(),true,attachment);
    const prev=db.prepare('SELECT * FROM messages WHERE uid=? AND state IN (0,1)').get(uid);
    if(prev){
      if(prev.person!==p || prev.epoch!==e || this.unpack(prev).text!==text)throw Error(tr('Некорректная команда.'));
      return false;
    }
    const size=Buffer.byteLength(text);
    const limits=db.prepare('SELECT count(*) AS total, sum(bytes) AS bytes, sum(person=?) AS dialogue FROM messages WHERE state=0').get(p);
    if(limits.total>=64 || limits.dialogue>=24 || limits.bytes+size>256*1024)throw Error(tr('Очередь личных сообщений заполнена. Дождитесь доставки или очистите диалог.'));
    db.exec('BEGIN IMMEDIATE');
    try{
      const saved=db.prepare('INSERT INTO messages(person,epoch,uid,state,unread,bytes,payload) VALUES(?,?,?,0,0,?,?)').run(p,e,uid,size,payload);
      if(source){
        const n=Number(saved.lastInsertRowid);this.setAttachment(n,source.kind,source.bytes);
        if(source.kind==='snapshot'&&!db.prepare('UPDATE attachment_files SET n=? WHERE id=? AND n IS NULL AND size=?').run(n,uid,attachment.size).changes)
          throw Error(tr('Вложение недоступно. Попросите друга поделиться им снова.'));
      }
      db.exec('COMMIT');
    }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
    this.count++;return true;
  }
  acknowledge(person,epoch,id,sequence){
    return this.db && this.db.prepare('UPDATE messages SET state=1 WHERE n=? AND uid=? AND person=? AND epoch=? AND state=0')
      .run(sequence,this.tag('message',id),...this.scope(person,epoch)).changes===1;
  }
  pendingReadContacts(friends){
    if(!this.db)return [];
    const pending=new Set(this.db.prepare('SELECT DISTINCT m.person FROM message_reads r JOIN messages m ON r.n=m.n WHERE m.unread=0').all().map(r=>r.person));
    return friends.filter(f=>f.state==='friend'&&pending.has(this.tag('person',f.id))).map(f=>f.id);
  }
  hasPendingReads(person,epoch){
    return !!this.db?.prepare('SELECT 1 FROM message_reads r JOIN messages m ON r.n=m.n WHERE m.person=? AND m.epoch=? AND m.unread=0 LIMIT 1').get(...this.scope(person,epoch));
  }
  expectRead(n,device){
    this.db.prepare('INSERT OR IGNORE INTO read_targets(n,device,seen) VALUES(?,?,0)').run(n,this.tag('device',device));
  }
  readBatch(person,epoch,device){
    if(!this.db)return [];
    return this.db.prepare('SELECT m.*,r.seq AS remoteSeq FROM message_reads r JOIN messages m ON r.n=m.n WHERE m.person=? AND m.epoch=? AND m.unread=0 AND r.device=? ORDER BY m.n LIMIT 32')
      .all(...this.scope(person,epoch),this.tag('device',device)).map(r=>[this.unpack(r).id,r.remoteSeq]);
  }
  confirmReads(person,epoch,device,items,ack){
    const db=this.db;if(!db)return {accepted:items,changed:false};
    const scope=this.scope(person,epoch),accepted=[];let changed=false;
    db.exec('BEGIN IMMEDIATE');
    try{
      for(const [id,seq] of items){
        const uid=this.tag('message',id);
        if(ack){
          db.prepare('DELETE FROM message_reads WHERE device=? AND seq=? AND n=(SELECT n FROM messages WHERE person=? AND epoch=? AND uid=? AND unread=0)')
            .run(this.tag('device',device),seq,...scope,uid);
        }else{
          const row=db.prepare('SELECT state FROM messages WHERE n=? AND person=? AND epoch=? AND uid=?').get(seq,...scope,uid);
          if(row?.state===0)continue; // Its delivery ACK might still be in flight.
          if(row?.state===1&&db.prepare('UPDATE read_targets SET seen=1 WHERE n=? AND device=? AND seen=0').run(seq,this.tag('device',device)).changes)changed=true;
          accepted.push([id,seq]);
        }
      }
      db.exec('COMMIT');return {accepted,changed};
    }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  }
  receive(person,epoch,device,m,allow,readReceipts=false){
    const db=this.database(),d=this.tag('device',device),p=this.tag('person',person),uid=this.tag('message',m.id);
    const previous=db.prepare('SELECT person,seq,uid FROM receipts WHERE device=?').get(d);
    if(previous){
      if(previous.person!==p || m.seq<previous.seq)return 'ignore';
      if(m.seq===previous.seq)return previous.uid===uid?'duplicate':'ignore';
    }
    if(!allow())return 'ignore';
    const [personTag,epochTag,messageTag,payload]=this.pack(person,epoch,m.id,m.text,Date.now(),false,m.attachment,m.attachment?device:undefined);
    db.exec('BEGIN IMMEDIATE');
    try{
      const insert=db.prepare('INSERT INTO messages(person,epoch,uid,state,unread,bytes,payload) VALUES(?,?,?,2,1,?,?) ON CONFLICT(person,uid) DO NOTHING')
        .run(personTag,epochTag,messageTag,Buffer.byteLength(m.text),payload);
      if(!insert.changes){db.exec('ROLLBACK');return 'ignore';}
      if(readReceipts)db.prepare('INSERT INTO message_reads(n,device,seq) VALUES(?,?,?)').run(insert.lastInsertRowid,d,m.seq);
      db.prepare('INSERT INTO receipts(device,person,seq,uid) VALUES (?,?,?,?) ON CONFLICT(device) DO UPDATE SET seq=excluded.seq,uid=excluded.uid')
        .run(d,p,m.seq,uid);
      db.exec('COMMIT');this.count++;return 'new';
    }catch(e){
      // A disk-full error can roll back the transaction inside SQLite.
      try{db.exec('ROLLBACK');}catch{}
      throw e;
    }
  }
}
module.exports={ChatStore,SNAPSHOT_PART};
