'use strict';
const fs=require('node:fs'),path=require('node:path');
const FILE='storage-paths-v1.json';
const PRODUCT='CRAFTCODE LINK';
function validateEntries(entries){
  if(!Array.isArray(entries)||entries.length>100000)throw Error('Invalid relocated paths');
  const seen=new Set();
  for(const item of entries){
    if(!item||typeof item.from!=='string'||!path.isAbsolute(item.from)||item.from.includes('\0')||typeof item.relative!=='string'||!item.relative||path.isAbsolute(item.relative)||
      item.relative.split(/[\\/]/).some(x=>!x||x==='.'||x==='..')||/[\0:]/.test(item.relative)||typeof item.identity!=='string'||!/^\d+\/\d+\/\d+$/.test(item.identity)||seen.has(item.from))throw Error('Invalid relocated paths');
    seen.add(item.from);
  }
  return entries;
}
function readRelocations(root){
  const file=path.join(root,FILE);
  let stat;try{stat=fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')return [];throw e;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>32*1024*1024)throw Error('Invalid relocated paths');
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  if(value?.version!==1||value.product!==PRODUCT)throw Error('Invalid relocated paths');
  return validateEntries(value.entries);
}
function createPathResolver(root){
  const normalize=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
  const entries=new Map(readRelocations(root).map(item=>[normalize(item.from),item]));
  return filename=>{
    if(typeof filename!=='string'||!path.isAbsolute(filename))return;
    const item=entries.get(normalize(filename));
    if(item){
      const rootStat=fs.lstatSync(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw Error('Relocated file directory changed');
      let folder=root;
      for(const part of item.relative.split(/[\\/]/).slice(0,-1)){
        folder=path.join(folder,part);
        try{const s=fs.lstatSync(folder);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Relocated file directory changed');}
        catch(e){if(e.code!=='ENOENT')throw e;break;}
      }
      return {filename:path.join(root,item.relative),identity:item.identity};
    }
  };
}
module.exports={FILE,readRelocations,createPathResolver,validateEntries};
