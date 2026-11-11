'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {tr}=require('../native-language.cjs');
const {unlinkOwned}=require('./saved-download.cjs');
const tokenName=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.json$/;
const fingerprint=value=>createHash('sha256').update(value).digest('hex');

async function checkedDirectory(parent,name){
  const dir=path.join(parent,name),stat=await fs.lstat(dir);
  if(!stat.isDirectory()||stat.isSymbolicLink()||path.relative(await fs.realpath(parent),await fs.realpath(dir))!==name)
    throw Error(tr('Не удалось проверить каталог загрузки.'));
  return dir;
}

// One journal per Windows profile, protected by the main process single-instance lock.
// Never walk the Downloads tree. Each record refers to one generated partial name.
class PartialJournal{
  constructor(profile){this.profile=profile;this.dir=path.join(profile,'pending-downloads-v1');}
  async track(id,downloads,room,identity){
    const filename=id+'.json';if(!tokenName.test(filename))throw Error('Invalid transfer token');
    await fs.mkdir(this.dir,{recursive:true,mode:0o700});
    await checkedDirectory(this.profile,'pending-downloads-v1');
    const data={root:fingerprint(await fs.realpath(downloads)),room,identity};
    const f=await fs.open(path.join(this.dir,filename),'wx',0o600);
    try{await f.writeFile(JSON.stringify(data));await f.sync();}finally{await f.close();}
  }
  async forget(id){
    if(!tokenName.test(id+'.json'))return;
    await fs.rm(path.join(this.dir,id+'.json'),{force:true});
  }
  async recover(downloads){
    let dir;
    try{dir=await checkedDirectory(this.profile,'pending-downloads-v1');}
    catch(e){if(e.code==='ENOENT')return;throw e;}
    const root=fingerprint(await fs.realpath(downloads));
    const {safe}=require('./storage.cjs');
    for(const filename of await fs.readdir(dir)){
      if(!tokenName.test(filename))continue;
      const record=path.join(dir,filename);
      try{
        const stat=await fs.lstat(record);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024)continue;
        let data;try{data=JSON.parse(await fs.readFile(record,'utf8'));}
        catch(e){if(e instanceof SyntaxError)await fs.unlink(record);continue;}
        if(data?.root!==root||typeof data.room!=='string'||data.room!==safe(data.room))continue;
        const id=filename.slice(0,-5);
        try{
          const base=await checkedDirectory(downloads,'CRAFTCODE LINK');
          const room=await checkedDirectory(base,data.room),part=path.join(room,'.link-'+id+'.part');
          // Old records contain no file identity. The name alone cannot
          // distinguish a remaining partial from a user's replacement.
          unlinkOwned(part,path.join(await fs.realpath(downloads),'CRAFTCODE LINK',data.room),data.identity);
        }catch(e){if(e.code!=='ENOENT')continue;}
        // A disk can disappear after the first root check. Retain the receipt
        // until its approved root is available again, even when a lookup of
        // the partial file just returned ENOENT.
        if(fingerprint(await fs.realpath(downloads))!==root)continue;
        await this.forget(id);
      }catch{ /* Keep the record for a later launch if the volume is temporarily unavailable. */ }
    }
    try{await fs.rmdir(dir);}catch(e){if(!['ENOTEMPTY','EEXIST','ENOENT'].includes(e.code))throw e;}
  }
}
module.exports={PartialJournal};
