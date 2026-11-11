'use strict';
const fs=require('node:fs');
const path=require('node:path');
const en=require('./renderer/l10n/en.json');
let current='ru';
const file=dir=>path.join(dir,'interface-language.json');
function load(dir){try{current=JSON.parse(fs.readFileSync(file(dir),'utf8'))==='en'?'en':'ru';}catch{current='ru';}}
function save(dir,language){
  if(!['ru','en'].includes(language))throw Error('Invalid interface language.');
  const target=file(dir),tmp=target+'.tmp';
  try{fs.writeFileSync(tmp,JSON.stringify(language),{mode:0o600});fs.renameSync(tmp,target);current=language;}
  finally{fs.rmSync(tmp,{force:true});}
}
const tr=text=>current==='en'&&Object.hasOwn(en,text)?en[text]:text;
module.exports={load,save,tr};
