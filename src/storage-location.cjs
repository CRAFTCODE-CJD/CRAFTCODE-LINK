'use strict';
// The locator stays in the original AppData directory. Only the main process,
// holding that directory's single-instance lock, may use this module.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {tr}=require('./native-language.cjs');
const PRODUCT='CRAFTCODE LINK',BASENAME='CRAFTCODE LINK Data';
const LOCATOR='storage-location-v1.json',MARKER='.craftcode-link-data-v1.json';
const MANIFEST='.craftcode-link-migration-v1.json';
const COPYJOURNAL='.craftcode-link-copy-v1';
const {FILE:PATHS,readRelocations,validateEntries}=require('./profile-relocations.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GUARD='active-process-v1.json';
const MAINTENANCE='.craftcode-link-maintenance-v1.json';
const CONTROL=new Set([LOCATOR,MARKER,MANIFEST,GUARD,COPYJOURNAL,'SingletonLock','SingletonCookie','SingletonSocket','lockfile','DevToolsActivePort']);
const controlName=name=>process.platform==='win32'?[...CONTROL].some(v=>v.toLowerCase()===name.toLowerCase()):CONTROL.has(name);
const pathMapName=name=>process.platform==='win32'?name.toLowerCase()===PATHS:name===PATHS;
const equal=(a,b)=>path.relative(a,b)==='';
const beneath=(parent,child)=>{const r=path.relative(parent,child);return r!==''&&!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r);};
const identity=s=>[s.dev,s.ino,s.birthtimeNs].map(String).join('/');
function fail(text='Не удалось безопасно открыть расположение данных LINK.') { const error=Error(tr(text));error.storageMessage=true;throw error; }
function storageError(error){
  if(error?.storageMessage)return error;
  const message=['ENOENT','ENODEV','ENXIO','ENOTDIR'].includes(error?.code)?'Выбранный диск или папка недоступны. Подключите диск и повторите попытку.':
    ['EACCES','EPERM','EROFS','EBUSY'].includes(error?.code)?'Нет доступа к папке данных. Закройте использующие её программы или выберите другую папку.':
    error?.code==='ENOSPC'?'На выбранном диске недостаточно свободного места.':
    'Не удалось завершить операцию с хранилищем. Исходные данные сохранены. Повторите попытку.';
  const result=Error(tr(message));result.storageMessage=true;return result;
}
function plain(value){return value&&typeof value==='object'&&!Array.isArray(value);}
function keys(value,allowed){return plain(value)&&Object.keys(value).every(k=>allowed.includes(k));}
function absolute(value){
  return typeof value==='string'&&value.length<=2048&&path.isAbsolute(value)&&!/[\0\r\n]/.test(value)&&
    (process.platform!=='win32'||/^[a-z]:[\\/]/i.test(value)&&!value.slice(2).includes(':'));
}
// lstat each component before resolving aliases; a junction must never be
// normalized away into an apparently acceptable directory.
function directory(value){
  if(!absolute(value))fail();
  const resolved=path.resolve(value),parsed=path.parse(resolved);
  let current=parsed.root;
  for(const name of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)){
    current=path.join(current,name);const s=fs.lstatSync(current);
    if(!s.isDirectory()||s.isSymbolicLink())fail();
  }
  return fs.realpathSync.native(resolved);
}
function sameDirectory(filename,expected){return equal(directory(filename),expected);}
function regularJSON(filename,max){
  const s=fs.lstatSync(filename,{bigint:true});
  if(!s.isFile()||s.isSymbolicLink()||s.size>BigInt(max)||s.nlink!==1n)fail();
  const fd=fs.openSync(filename,'r');
  try{
    if(identity(fs.fstatSync(fd,{bigint:true}))!==identity(s))fail();
    const bytes=Buffer.alloc(Number(s.size)+1),length=fs.readSync(fd,bytes,0,bytes.length,0);
    if(length!==Number(s.size)||fs.fstatSync(fd,{bigint:true}).mtimeNs!==s.mtimeNs)fail();
    return JSON.parse(bytes.subarray(0,length).toString('utf8'));
  }finally{fs.closeSync(fd);}
}
function atomicJSON(filename,value,maximum){
  const parent=directory(path.dirname(filename)),temp=path.join(parent,'.link-write-'+crypto.randomUUID());
  const body=JSON.stringify(value),limit=maximum||([MANIFEST,PATHS].includes(path.basename(filename))?32*1024*1024:64*1024);
  if(Buffer.byteLength(body)>limit)fail('Данные переноса слишком велики. Обратитесь к разработчику.');
  let fd;
  try{
    fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,body);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    if(!sameDirectory(path.dirname(filename),parent))fail();
    try{const s=fs.lstatSync(filename);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)fail();}catch(e){if(e.code!=='ENOENT')throw e;}
    fs.renameSync(temp,filename);
  }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
function makePrivate(folder){
  directory(folder);
  if(process.platform==='win32'){
    const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    execFileSync(powershell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'storage-private-directory.ps1'),'-Directory',folder],{windowsHide:true,stdio:'pipe',timeout:15000});
  }else fs.chmodSync(folder,0o700);
}
function hashFile(filename,expected){
  const st=fs.lstatSync(filename,{bigint:true});
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1n||expected&&identity(st)!==expected)fail();
  const fd=fs.openSync(filename,'r'),hash=crypto.createHash('sha256'),buffer=Buffer.allocUnsafe(512*1024);
  try{
    if(identity(fs.fstatSync(fd,{bigint:true}))!==identity(st))fail();
    let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,n));
    const end=fs.fstatSync(fd,{bigint:true});
    if(end.size!==st.size||end.mtimeNs!==st.mtimeNs)fail('Данные изменились во время переноса. Повторите попытку.');
    return {hash:hash.digest('hex'),size:Number(st.size),identity:identity(st),mtime:st.mtimeNs.toString()};
  }finally{fs.closeSync(fd);}
}
function marker(root,owner){
  const m=regularJSON(path.join(root,MARKER),1024);
  if(!keys(m,['version','product','owner'])||m.version!==1||m.product!==PRODUCT||!UUID.test(m.owner)||owner&&m.owner!==owner)fail();
  return m;
}
function validPathList(list){return list===undefined||Array.isArray(list)&&list.length<=64&&list.every(absolute);}
function freeBytes(folder){const s=fs.statfsSync(folder,{bigint:true});return Number(s.bavail*s.bsize);}
function relativeFile(value){return typeof value==='string'&&value.length<=2048&&value!==''&&!path.isAbsolute(value)&&value.split(/[\\/]/).every(x=>x&&x!=='.'&&x!=='..')&&!/[\0:]/.test(value);}
function processStart(pid){
  const exe=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  try{
    return execFileSync(exe,['-NoLogo','-NoProfile','-NonInteractive','-Command',
      'try { $p=[Diagnostics.Process]::GetProcessById([int]$env:CRAFTCODE_OWNER_PID) } catch [ArgumentException] { exit 3 }; $p.StartTime.ToFileTimeUtc().ToString()'],
    {windowsHide:true,encoding:'utf8',timeout:10000,env:{...process.env,CRAFTCODE_OWNER_PID:String(pid)}}).trim();
  }catch(e){if(e.status===3)return null;throw e;}
}

// An unfinished copy has its own receipts, separate from the completed-copy
// manifest. Record an exclusive file's identity before writing any payload.
// Cancellation never recursively deletes a staging directory.
function startCopyJournal(root,p,owner,dirs){
  const folder=path.join(root,COPYJOURNAL);fs.mkdirSync(folder,{mode:0o700});
  const header={version:1,product:PRODUCT,owner,...p,identity:identity(fs.lstatSync(root,{bigint:true})),
    dirs:dirs.map(d=>({path:d.path,identity:identity(fs.lstatSync(path.join(root,d.path),{bigint:true}))}))};
  atomicJSON(path.join(folder,'header.json'),header,32*1024*1024);return folder;
}
function copyWithReceipt(source,destination,relative,expected,journal,fault){
  const fd=fs.openSync(destination,'wx',0o600);let input;
  try{
    const record={path:relative,identity:identity(fs.fstatSync(fd,{bigint:true})),sourceIdentity:expected.identity,size:expected.size,hash:expected.hash};
    atomicJSON(path.join(journal,crypto.randomUUID()+'.json'),record);
    input=fs.openSync(source,'r');if(identity(fs.fstatSync(input,{bigint:true}))!==expected.identity)fail();
    const buffer=Buffer.allocUnsafe(512*1024);let position=0,n;
    while((n=fs.readSync(input,buffer,0,buffer.length,null))){
      let written=0;while(written<n){const count=fs.writeSync(fd,buffer,written,n-written,null);if(!count)fail();written+=count;position+=count;}
      fault('copy-progress',{path:relative,bytes:position});
    }
    fs.fsyncSync(fd);
  }finally{if(input!==undefined)fs.closeSync(input);fs.closeSync(fd);}
}
function prefixHash(filename,length,expected){
  const fd=fs.openSync(filename,'r'),hash=crypto.createHash('sha256'),buffer=Buffer.allocUnsafe(512*1024);
  try{
    const before=fs.fstatSync(fd,{bigint:true});
    if(identity(before)!==expected.identity||before.mtimeNs.toString()!==expected.mtime||Number(before.size)<length)fail();
    let read=0;while(read<length){const count=fs.readSync(fd,buffer,0,Math.min(buffer.length,length-read),null);if(!count)fail();hash.update(buffer.subarray(0,count));read+=count;}
    const after=fs.fstatSync(fd,{bigint:true});if(after.mtimeNs!==before.mtimeNs||after.size!==before.size)fail();
    return hash.digest('hex');
  }finally{fs.closeSync(fd);}
}
function cleanCopyJournal(root,p,owner,removePayload){
  const canonical=directory(root);marker(canonical,owner);const folder=path.join(canonical,COPYJOURNAL);
  if(!fs.existsSync(folder))return false; // Older stages have no deletion receipts.
  if(!equal(directory(folder),folder))fail();
  const folderIdentity=identity(fs.lstatSync(folder,{bigint:true})),headerFile=path.join(folder,'header.json'),headerStat=fs.lstatSync(headerFile,{bigint:true});
  const h=regularJSON(headerFile,32*1024*1024);
  if(!keys(h,['version','product','owner','directory','token','from','identity','dirs'])||h.version!==1||h.product!==PRODUCT||h.owner!==owner||h.token!==p.token||h.from!==p.from||h.directory!==p.directory||h.identity!==identity(fs.lstatSync(canonical,{bigint:true}))||
    !Array.isArray(h.dirs)||h.dirs.length>100000||!h.dirs.every(d=>keys(d,['path','identity'])&&relativeFile(d.path)&&typeof d.identity==='string'))fail();
  let retained=false;
  for(const name of fs.readdirSync(folder)){
    if(!sameDirectory(folder,folder)||identity(fs.lstatSync(folder,{bigint:true}))!==folderIdentity)return false;
    if(name==='header.json')continue;
    if(!name.endsWith('.json')||!UUID.test(name.slice(0,-5))){retained=true;continue;}
    const filename=path.join(folder,name);
    try{
      const before=fs.lstatSync(filename,{bigint:true}),r=regularJSON(filename,8192);
      if(!keys(r,['path','identity','sourceIdentity','size','hash'])||!relativeFile(r.path)||controlName(r.path.split(/[\\/]/)[0])||typeof r.identity!=='string'||typeof r.sourceIdentity!=='string'||!Number.isSafeInteger(r.size)||r.size<0||!/^[a-f0-9]{64}$/.test(r.hash))fail();
      if(removePayload){
        const target=path.join(canonical,r.path);
        let checkingTarget=true;
        try{
          if(!sameDirectory(path.dirname(target),path.join(canonical,path.dirname(r.path))))fail();
          const copied=hashFile(target,r.identity);checkingTarget=false;if(copied.size>r.size)fail();
          if(copied.size===r.size){if(copied.hash!==r.hash)fail();}
          else if(copied.size){
            marker(directory(p.from),owner);
            const source=path.join(p.from,r.path);if(!sameDirectory(path.dirname(source),path.join(p.from,path.dirname(r.path))))fail();
            const original=hashFile(source,r.sourceIdentity);
            if(original.size!==r.size||original.hash!==r.hash||prefixHash(source,copied.size,original)!==copied.hash)fail();
          }
          const end=fs.lstatSync(target,{bigint:true});if(identity(end)!==r.identity||end.mtimeNs.toString()!==copied.mtime)fail();fs.unlinkSync(target);
        }catch(error){
          // An absent source disk cannot prove that the existing partial is
          // obsolete. Retain its receipt so a later retry can verify it.
          if(error.code!=='ENOENT'||!checkingTarget)throw error;
        }
      }
      const end=fs.lstatSync(filename,{bigint:true});if(identity(end)!==identity(before)||end.mtimeNs!==before.mtimeNs)fail();fs.unlinkSync(filename);
    }catch{retained=true;}
  }
  if(removePayload)for(const d of [...h.dirs].reverse())try{
    const dir=path.join(canonical,d.path);if(!sameDirectory(dir,dir)||identity(fs.lstatSync(dir,{bigint:true}))!==d.identity)continue;fs.rmdirSync(dir);
  }catch{ /* Only empty directories with the recorded identity can go. */ }
  if(retained)return false;
  if(!sameDirectory(folder,folder)||identity(fs.lstatSync(folder,{bigint:true}))!==folderIdentity)return false;
  const headerEnd=fs.lstatSync(headerFile,{bigint:true});if(identity(headerEnd)!==identity(headerStat)||headerEnd.mtimeNs!==headerStat.mtimeNs)return false;
  fs.unlinkSync(headerFile);fs.rmdirSync(folder);
  if(!removePayload)return true;
  const remaining=fs.readdirSync(canonical);
  if(remaining.length!==1||remaining[0]!==MARKER)return false;
  marker(canonical,owner);if(identity(fs.lstatSync(canonical,{bigint:true}))!==h.identity)fail();
  fs.unlinkSync(path.join(canonical,MARKER));fs.rmdirSync(canonical);return true;
}

class StorageLocation {
  constructor({anchor,downloads,installDirectory,dialog,window,privateDirectory=makePrivate,fault=()=>{},guardOwner=false,maintenanceDirectory,spaceAvailable=freeBytes,freshDirectory}){
    this.anchor=path.resolve(anchor);this.initialDownloads=downloads;this.installDirectory=installDirectory;
    this.dialog=dialog;this.window=window;this.privateDirectory=privateDirectory;this.fault=fault;this.selection=null;this.working=false;this.guardOwner=guardOwner;
    this.maintenanceDirectory=maintenanceDirectory;
    this.spaceAvailable=spaceAvailable;
    this.freshDirectory=freshDirectory;
  }
  bootstrap(){
    this.checkMaintenance();
    fs.mkdirSync(this.anchor,{recursive:true,mode:0o700});this.anchor=directory(this.anchor);this.locator=path.join(this.anchor,LOCATOR);
    let state;
    try{state=regularJSON(this.locator,64*1024);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(!state){
      let m;try{m=marker(this.anchor);}catch(e){if(e.code!=='ENOENT')throw e;}
      const owner=m?.owner||crypto.randomUUID();
      if(!m)atomicJSON(path.join(this.anchor,MARKER),{version:1,product:PRODUCT,owner});
      // Publish ownership before creating an adjacent data directory, too:
      // native maintenance must see a live bootstrap even on the first run.
      this.state={version:1,product:PRODUCT,owner,directory:this.anchor};this.current=this.anchor;
      if(this.guardOwner)this.guard();this.checkMaintenance();
      // Existing data always wins. A failed first creation leaves only control
      // records, so retry still targets the adjacent directory rather than
      // silently creating a different empty profile in AppData.
      const legacy=fs.readdirSync(this.anchor).some(name=>!controlName(name)&&!name.toLowerCase().startsWith('.link-write-')&&name.toLowerCase()!=='profiles');
      let active=this.anchor;
      if(this.freshDirectory&&!legacy){
        try{
          active=this.checkTarget(this.freshDirectory,this.anchor,true,owner);
          if(!fs.existsSync(active))fs.mkdirSync(active,{mode:0o700});
          directory(active);
          if(!fs.existsSync(path.join(active,MARKER)))atomicJSON(path.join(active,MARKER),{version:1,product:PRODUCT,owner});
          this.privateDirectory(active);directory(active);
        }catch(error){
          if(error?.storageMessage)throw error;
          fail('Не удалось создать хранилище рядом с программой. Распакуйте LINK в папку, доступную для записи, и запустите снова.');
        }
      }
      state={version:1,product:PRODUCT,owner,directory:active};atomicJSON(this.locator,state);
    }
    this.validate(state);this.state=state;this.current=this.checkedRoot(state.directory);
    if(this.guardOwner)this.guard();
    this.checkMaintenance();
    require('./native-language.cjs').load(this.current);
    if(state.pending){
      try{this.migrate();}
      catch(e){
        // A failed copy never silently creates a new profile. Keep the verified
        // original active and expose the failure for retry/cancel in Settings.
        if(!equal(this.state.directory,state.directory))throw e;
        this.state.error=storageError(e).message;this.save();
      }
    }
    this.current=this.checkedRoot(this.state.directory);
    if(this.state.migration)this.finish();
    if(this.guardOwner)this.guard();
    return this.current;
  }
  validate(s){
    if(!keys(s,['version','product','owner','directory','pending','migration','error','downloadDirectory','previousDownloadDirectories','previousDirectories','retainedStages'])||
      s.version!==1||s.product!==PRODUCT||!UUID.test(s.owner)||!absolute(s.directory)||
      s.error!==undefined&&(typeof s.error!=='string'||s.error.length>500)||
      s.downloadDirectory!==undefined&&!absolute(s.downloadDirectory)||!validPathList(s.previousDownloadDirectories)||!validPathList(s.previousDirectories)||!validPathList(s.retainedStages))fail();
    marker(this.anchor,s.owner);
    this.checkedRoot(s.directory,s.owner);
    for(const name of ['pending','migration'])if(s[name]){
      const p=s[name];
      if(!keys(p,['directory','token','from'])||!absolute(p.directory)||!absolute(p.from)||!UUID.test(p.token))fail();
      if(path.basename(p.directory)!==BASENAME||equal(p.from,p.directory)||beneath(p.from,p.directory)||beneath(p.directory,p.from))fail();
      if(name==='pending'&&!equal(p.from,s.directory)||name==='migration'&&!equal(p.directory,s.directory)||s.pending&&s.migration)fail();
      this.checkedRoot(p.from,s.owner);
      // A selected removable destination can disappear before restart. Its
      // shape remains untrusted, but availability is handled by migrate(),
      // which can leave the verified original profile open with a retry UI.
      if(name==='pending')this.targetShape(p.directory,p.from);
      else this.checkTarget(p.directory,p.from,false,s.owner);
    }
  }
  checkedRoot(root,owner=this.state?.owner){
    const canonical=directory(root);
    if(!equal(canonical,this.anchor)&&path.basename(canonical)!==BASENAME)fail();
    marker(canonical,owner);return canonical;
  }
  targetShape(target,source){
    if(!absolute(target)||path.basename(target)!==BASENAME)fail();
    for(const forbidden of [source,this.anchor,this.installDirectory].filter(Boolean)){
      const resolved=path.resolve(forbidden);
      if(forbidden===this.installDirectory&&equal(path.resolve(target),path.join(resolved,BASENAME)))continue;
      if(equal(target,resolved)||beneath(target,resolved)||beneath(resolved,target))fail('Выберите отдельную папку вне текущего хранилища и папки программы.');
    }
  }
  checkTarget(target,source=this.state.directory,empty=true,owner=this.state?.owner){
    this.targetShape(target,source);
    const parent=directory(path.dirname(target)),canonical=path.join(parent,BASENAME);
    this.targetShape(canonical,source);
    try{
      if(!equal(directory(canonical),canonical))fail();
      const names=fs.readdirSync(canonical);
      if(names.length){
        try{marker(canonical,owner);}catch{fail('Выбранная папка уже содержит данные. Выберите другую папку.');}
        if(empty&&(names.length!==1||names[0]!==MARKER))fail('Выбранная папка уже содержит данные. Выберите другую папку.');
      }
    }catch(e){if(e.code!=='ENOENT')throw e;}
    return canonical;
  }
  save(){this.validate(this.state);atomicJSON(this.locator,this.state);}
  excluded(name){const key=process.platform==='win32'?name.toLowerCase():name;return controlName(name)||key.startsWith('.link-write-')||equal(this.state.directory,this.anchor)&&key==='profiles';}
  inventory(root=this.state.directory){
    const canonical=this.checkedRoot(root),files=[],dirs=[];let bytes=0;
    const walk=(folder,relative='')=>{
      if(files.length+dirs.length>100000)fail('В хранилище слишком много файлов для одного переноса.');
      if(!sameDirectory(folder,path.join(canonical,relative)))fail();
      for(const name of fs.readdirSync(folder)){
        if(!relative&&this.excluded(name))continue;
        const rel=path.join(relative,name),filename=path.join(canonical,rel),s=fs.lstatSync(filename,{bigint:true});
        if(s.isSymbolicLink()||s.nlink>1n&&s.isFile())fail('В хранилище есть ссылки на другие файлы. Перенос остановлен.');
        if(s.isDirectory()){dirs.push({path:rel,identity:identity(s)});walk(filename,rel);}
        else if(s.isFile()){files.push({path:rel,identity:identity(s),size:Number(s.size)});bytes+=Number(s.size);}
        else fail();
      }
    };walk(canonical);return {files,dirs,bytes};
  }
  plan(target){
    const directory=this.checkTarget(target),data=this.inventory(),free=this.spaceAvailable(path.dirname(directory));
    if(free<data.bytes+64*1024*1024)fail('На выбранном диске недостаточно свободного места.');
    const probe=path.join(path.dirname(directory),'.link-write-'+crypto.randomUUID());
    const fd=fs.openSync(probe,'wx',0o600);fs.closeSync(fd);fs.unlinkSync(probe);
    return {directory,bytes:data.bytes,free,files:data.files.length};
  }
  stage(p){return path.join(path.dirname(p.directory),'.craftcode-link-move-'+p.token);}
  readManifest(folder,p){
    if(!equal(directory(folder),folder))fail();marker(folder,this.state.owner);
    const m=regularJSON(path.join(folder,MANIFEST),32*1024*1024);
    if(!keys(m,['version','product','owner','token','from','directory','files','dirs','paths'])||m.version!==1||m.product!==PRODUCT||m.owner!==this.state.owner||m.token!==p.token||m.from!==p.from||m.directory!==p.directory||
      !Array.isArray(m.files)||!Array.isArray(m.dirs)||m.files.length+m.dirs.length>100000||
      !m.files.every(f=>keys(f,['path','identity','size','hash','copiedIdentity'])&&relativeFile(f.path)&&typeof f.identity==='string'&&Number.isSafeInteger(f.size)&&f.size>=0&&/^[a-f0-9]{64}$/.test(f.hash)&&typeof f.copiedIdentity==='string')||
      !m.dirs.every(d=>keys(d,['path','identity'])&&relativeFile(d.path)&&typeof d.identity==='string'))fail();
    validateEntries(m.paths);return m;
  }
  verifyCopy(folder,m){
    for(const f of m.files){
      const filename=path.join(folder,f.path);
      if(!sameDirectory(path.dirname(filename),path.join(folder,path.dirname(f.path))))fail();
      const result=hashFile(filename,f.copiedIdentity);if(result.hash!==f.hash||result.size!==f.size)fail();
    }
  }
  relocatedEntries(m){
    const sourceEntries=readRelocations(m.from),byRelative=new Map(m.files.map(f=>[f.path,f]));
    const normalized=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
    const entries=new Map();
    for(const old of sourceEntries){
      const file=byRelative.get(old.relative);
      if(file)entries.set(normalized(old.from),{from:old.from,relative:old.relative,identity:file.copiedIdentity});
    }
    for(const file of m.files)if(!pathMapName(file.path)){
      const from=path.join(m.from,file.path);entries.set(normalized(from),{from,relative:file.path,identity:file.copiedIdentity});
    }
    return validateEntries([...entries.values()]);
  }
  migrate(){
    const p=this.state.pending,stage=this.stage(p);this.checkedRoot(p.from);
    let manifest;
    // Promotion can finish just before a crash and before locator commit.
    if(fs.existsSync(path.join(p.directory,MANIFEST))){
      manifest=this.readManifest(p.directory,p);this.verifyCopy(p.directory,manifest);
    }else{
      this.plan(p.directory);
      if(fs.existsSync(stage)&&!fs.existsSync(path.join(stage,MANIFEST))){
        let cleaned=false;try{cleaned=cleanCopyJournal(stage,p,this.state.owner,true);}catch{}
        if(!cleaned)fail('Предыдущий перенос не завершён. Отмените его и выберите папку снова; исходные данные сохранены.');
      }
      if(fs.existsSync(stage)){
        manifest=this.readManifest(stage,p);this.verifyCopy(stage,manifest);
      }else{
      const data=this.inventory(p.from),sourceIdentity=identity(fs.statSync(p.from,{bigint:true}));
      fs.mkdirSync(stage,{mode:0o700});directory(stage);
      atomicJSON(path.join(stage,MARKER),{version:1,product:PRODUCT,owner:this.state.owner});
      this.privateDirectory(stage);directory(stage);
      manifest={version:1,product:PRODUCT,owner:this.state.owner,...p,files:[],dirs:data.dirs};
      for(const d of data.dirs)fs.mkdirSync(path.join(stage,d.path),{mode:0o700});
      const journal=startCopyJournal(stage,p,this.state.owner,data.dirs);
      for(const f of data.files){
        if(identity(fs.statSync(p.from,{bigint:true}))!==sourceIdentity||!sameDirectory(path.dirname(path.join(p.from,f.path)),path.join(p.from,path.dirname(f.path))))fail();
        const source=path.join(p.from,f.path),destination=path.join(stage,f.path),before=hashFile(source,f.identity);
        copyWithReceipt(source,destination,f.path,before,journal,this.fault);
        const after=hashFile(destination),sourceEnd=hashFile(source,f.identity);
        if(before.hash!==after.hash||before.hash!==sourceEnd.hash||before.size!==after.size)fail();
        manifest.files.push({...f,hash:after.hash,copiedIdentity:after.identity});this.fault('copied',manifest.files.length);
      }
      manifest.paths=this.relocatedEntries(manifest);
      atomicJSON(path.join(stage,MANIFEST),manifest);this.fault('copied-all');
      }
      this.checkTarget(p.directory);
      if(fs.existsSync(p.directory)){
        const names=fs.readdirSync(p.directory);if(names.length===1&&names[0]===MARKER)fs.unlinkSync(path.join(p.directory,MARKER));
        fs.rmdirSync(p.directory);
      }
      fs.renameSync(stage,p.directory);this.fault('promoted');
    }
    this.state={...this.state,directory:p.directory,migration:p};delete this.state.pending;delete this.state.error;
    this.save();this.fault('committed');this.current=p.directory;
  }
  // Called before app.ready, any SQLite connection or Chromium session. A
  // read-time path map preserves encrypted SQLite byte-for-byte across moves.
  finish(){
    const p=this.state.migration;if(!p)return;
    const m=this.readManifest(p.directory,p);
    // PATHS is generated from the still intact source, so it can differ after
    // an interrupted finalize. Every other copied byte must match first.
    this.verifyCopy(p.directory,{...m,files:m.files.filter(f=>!pathMapName(f.path))});
    atomicJSON(path.join(p.directory,PATHS),{version:1,product:PRODUCT,entries:m.paths});this.fault('mapped');
    let retained=0;
    for(const f of m.files){
      const filename=path.join(p.from,f.path);
      try{
        this.checkedRoot(p.from);
        if(!sameDirectory(path.dirname(filename),path.join(p.from,path.dirname(f.path)))){retained++;continue;}
        const value=hashFile(filename,f.identity);
        if(value.hash!==f.hash||value.size!==f.size){retained++;continue;}
        if(!pathMapName(f.path)){
          const copy=path.join(p.directory,f.path);
          if(!sameDirectory(path.dirname(copy),path.join(p.directory,path.dirname(f.path)))){retained++;continue;}
          const checked=hashFile(copy,f.copiedIdentity);if(checked.hash!==f.hash||checked.size!==f.size){retained++;continue;}
        }
        fs.unlinkSync(filename);this.fault('source-removed',f.path);
      }catch(e){if(e.code!=='ENOENT')retained++;}
    }
    for(const d of [...m.dirs].reverse())try{
      const target=path.join(p.from,d.path);if(identity(fs.lstatSync(target,{bigint:true}))===d.identity&&sameDirectory(target,target))fs.rmdirSync(target);
    }catch{ /* Unknown/replaced content is retained. */ }
    this.state.previousDirectories=[...new Set([...(this.state.previousDirectories||[]),p.from])].slice(-64);
    try{if(!cleanCopyJournal(p.directory,p,this.state.owner,false))retained++;}catch{retained++;}
    delete this.state.migration;
    if(retained)this.state.error=tr('Перенос завершён. Неизвестные или изменённые файлы сохранены.');
    this.save();fs.unlinkSync(path.join(p.directory,MANIFEST));this.fault('finished');
  }
  downloads(){return this.state.downloadDirectory||this.initialDownloads;}
  downloadRoots(){return [...new Set([this.downloads(),this.initialDownloads,...(this.state.previousDownloadDirectories||[])])];}
  snapshot(){
    let free=null;try{free=freeBytes(this.current);}catch{}
    return {directory:this.current,defaultDirectory:this.freshDirectory||this.anchor,free,available:free,downloads:this.downloads(),selection:this.selection,
      retainedStages:this.state.retainedStages?.length||0,pending:this.state.pending?{directory:this.state.pending.directory}:null,error:this.state.error||'',restartRequired:!!this.state.pending};
  }
  async command(raw){
    if(!keys(raw,['op','token'])||typeof raw.op!=='string'||raw.token!==undefined&&!UUID.test(raw.token))fail();
    if(raw.op==='location')return this.snapshot();
    if(this.working)fail('Дождитесь завершения операции.');this.working=true;
    const previousState=structuredClone(this.state);
    try{
      if(raw.op==='choose-location'){
        const pick=await this.dialog.showOpenDialog(this.window?.(),{title:tr('Выберите диск или папку для данных LINK'),properties:['openDirectory','createDirectory']});
        if(pick.canceled||!pick.filePaths[0])return {cancelled:true};
        const planned=this.plan(path.join(directory(pick.filePaths[0]),BASENAME));
        this.selection={...planned,available:planned.free,token:crypto.randomUUID()};return this.snapshot();
      }
      if(raw.op==='schedule-move'){
        if(!this.selection||raw.token!==this.selection.token)fail('Выберите папку для переноса ещё раз.');
        if(this.state.pending)fail('Сначала отмените предыдущий перенос.');
        this.plan(this.selection.directory);
        this.state.pending={directory:this.selection.directory,from:this.current,token:crypto.randomUUID()};delete this.state.error;
        this.save();this.selection=null;return this.snapshot();
      }
      if(raw.op==='cancel-move'){
        if(this.state.pending){
          const stage=this.stage(this.state.pending);
          try{
            directory(stage);marker(stage,this.state.owner);
            try{this.readManifest(stage,this.state.pending);fs.unlinkSync(path.join(stage,MANIFEST));}catch{ /* Keep unknown or incomplete metadata. */ }
            let cleaned=false;try{cleaned=cleanCopyJournal(stage,this.state.pending,this.state.owner,true);}catch{ /* Older/incomplete journals authorize no deletion. */ }
            if(!cleaned)this.state.retainedStages=[...new Set([...(this.state.retainedStages||[]),stage])].slice(-64);
          }catch(e){if(e.code!=='ENOENT')throw e;}
        }
        delete this.state.pending;delete this.state.error;this.selection=null;this.save();return this.snapshot();
      }
      if(raw.op==='choose-downloads'){
        const pick=await this.dialog.showOpenDialog(this.window?.(),{title:tr('Выберите папку для скачанных файлов'),defaultPath:this.downloads(),properties:['openDirectory','createDirectory']});
        if(pick.canceled||!pick.filePaths[0])return {cancelled:true};
        const chosen=directory(pick.filePaths[0]),previous=this.downloads();
        const managed=path.join(chosen,PRODUCT);
        for(const root of [this.current,this.anchor,this.installDirectory].filter(Boolean)){
          if(equal(managed,root)||beneath(root,managed)||beneath(managed,root))fail('Выберите папку загрузок вне личных данных LINK и папки программы.');
        }
        const probe=path.join(chosen,'.link-write-'+crypto.randomUUID()),fd=fs.openSync(probe,'wx',0o600);fs.closeSync(fd);fs.unlinkSync(probe);
        this.state.previousDownloadDirectories=[...new Set([...(this.state.previousDownloadDirectories||[]),previous])].filter(x=>!equal(x,chosen)).slice(-64);
        this.state.downloadDirectory=chosen;this.save();return this.snapshot();
      }
      fail('Неизвестная команда хранилища.');
    }catch(error){this.state=previousState;throw storageError(error);}finally{this.working=false;}
  }
  guard(){
    if(process.platform!=='win32')return;
    const startTime=this.guardRecord?.startTime||processStart(process.pid);
    if(!/^\d{15,20}$/.test(startTime))fail();
    this.guardRecord={version:1,product:PRODUCT,owner:this.state.owner,pid:process.pid,startTime,executable:process.execPath,directory:this.current};
    atomicJSON(path.join(this.anchor,GUARD),this.guardRecord);
  }
  checkMaintenance(){
    if(!this.maintenanceDirectory||process.platform!=='win32')return;
    directory(this.maintenanceDirectory);
    let m;try{m=regularJSON(path.join(this.maintenanceDirectory,MAINTENANCE),4096);}catch(e){if(e.code==='ENOENT')return;throw e;}
    if(!keys(m,['version','product','pid','startTime','token'])||m.version!==1||m.product!==PRODUCT||!Number.isInteger(m.pid)||m.pid<1||m.pid>0xffffffff||!/^\d{15,20}$/.test(m.startTime)||!UUID.test(m.token))fail('Обслуживание LINK ещё не завершено. Повторите запуск позже.');
    const start=processStart(m.pid);
    if(start!==null&&!/^\d{15,20}$/.test(start))fail('Не удалось проверить, завершено ли обслуживание LINK.');
    if(start!==null&&start===m.startTime)fail('Обслуживание LINK ещё не завершено. Повторите запуск позже.');
  }
}
module.exports={StorageLocation,LOCATOR,MARKER,MANIFEST,BASENAME,directory,makePrivate,storageError};
