export function parseUpdateCode(code,current){
  const match=typeof code==='string'&&code.trim().match(/^LINK-UPDATE (\d{1,4}\.\d{1,4}\.\d{1,4}) ([a-f\d]{64})$/i);
  if(!match)return {error:'Вставьте код обновления из публикации CRAFTCODE.'};
  if(typeof current!=='string')return {error:'Вставьте код обновления из публикации CRAFTCODE.'};
  const version=match[1],a=version.split('.').map(Number),b=current.split('.').map(Number);
  const diff=a.map((n,i)=>n-b[i]).find(n=>n!==0);
  if(!(diff>0)||a.join('.')!==version)return {error:'Эта версия уже установлена или устарела.'};
  return {version,sha:match[2].toLowerCase(),name:'CRAFTCODE-LINK-'+version+'-Setup-x64.exe'};
}
