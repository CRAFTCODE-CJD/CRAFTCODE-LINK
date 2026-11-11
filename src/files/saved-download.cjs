'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');

function fileIdentity(stat){
  return [stat.dev,stat.ino,stat.birthtimeNs].map(String).join('/');
}

// A shared Downloads directory may change while a handle is open. Never
// publish or remove a name that no longer identifies that handle's file.
function ownedFile(filename,physicalDir,identity){
  try{
    if(!identity||path.relative(physicalDir,fs.realpathSync.native(path.dirname(filename)))!=='')return;
    const stat=fs.lstatSync(filename,{bigint:true});
    if(stat.isFile()&&fileIdentity(stat)===identity)return stat;
  }catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;}
}

function unlinkOwned(filename,physicalDir,identity){
  if(ownedFile(filename,physicalDir,identity))fs.unlinkSync(filename);
}

// Only remove an exact copy that LINK committed. A user can add, edit, move
// or replace files here between downloading and clearing a conversation.
async function removeSavedDownload(downloads,receipt,allow){
  const {person,filename,size,sha,identity}=receipt;
  const lan=receipt.room;
  if(!path.isAbsolute(filename)||(lan!==undefined?!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(lan):!/^[a-f0-9]{64}$/.test(person)))return 'kept';
  if(path.basename(filename).startsWith('.'))return 'kept';
  let handle;
  try{
    // Downloads may use a Windows 8.3 alias (for example RUNNER~1).
    // Match the native canonical path used when ShelfStorage committed it.
    downloads=fs.realpathSync.native(downloads);
    const base=path.join(downloads,'CRAFTCODE LINK'),room=path.join(base,lan!==undefined?'LAN-'+lan:'DM-'+person.slice(0,12));
    if(path.relative(room,path.dirname(filename))!=='')throw Error('Download directory changed');
    function checkedFile(){
      const expected=path.relative(downloads,filename);
      if(fs.lstatSync(base).isSymbolicLink() || fs.lstatSync(room).isSymbolicLink() ||
         path.relative(downloads,fs.realpathSync.native(filename))!==expected)return;
      const st=fs.lstatSync(filename,{bigint:true});
      if(st.isFile() && st.size===BigInt(size) && (!identity||fileIdentity(st)===identity))return st;
    }
    const before=checkedFile();
    if(!before)return 'kept';
    handle=await fs.promises.open(filename,'r');
    const opened=await handle.stat({bigint:true});
    if(fileIdentity(opened)!==fileIdentity(before) || opened.size!==before.size)return 'kept';
    const hash=createHash('sha256');
    if(size){
      for await(const bytes of handle.createReadStream({autoClose:false,highWaterMark:256*1024,end:size-1})){
        if(!allow())return 'inUse';
        hash.update(bytes);
      }
    }
    if(hash.digest('hex')!==sha)return 'kept';
    if(!allow())return 'inUse';
    // No application event can interleave the final name/identity check and unlink.
    const end=checkedFile();
    if(!end || fileIdentity(end)!==fileIdentity(opened) || end.mtimeNs!==opened.mtimeNs)return 'kept';
    fs.unlinkSync(filename);
    return 'removed';
  }catch(e){
    if(e.code==='ENOENT')return 'missing';
    throw e;
  }finally{await handle?.close();}
}
module.exports={fileIdentity,ownedFile,unlinkOwned,removeSavedDownload};
