import {tr} from './locale.mjs';
const collator=new Intl.Collator('ru',{sensitivity:'base',numeric:true});
export function contactStatusLabel(contact){
  if(!contact?.online)return tr('Не в сети');
  return tr(contact.status==='busy'?'Занят':contact.status==='away'?'Отошёл':'В сети');
}
const norm=v=>String(v??'').normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е');
export function selectContacts(items,{query='',filter='all',sort='available'}={}){
  const tokens=norm(query).trim().split(/\s+/).filter(Boolean);
  return items.filter(c=>{
    const s=[c.name,c.id,c.alias].map(norm).join(' ');
    return tokens.every(t=>s.includes(t)) && (filter==='all'||filter==='online'&&c.online||filter==='favorite'&&c.favorite||filter==='waiting'&&c.state!=='friend');
  }).sort((a,b)=>(sort==='available'?Number(b.online)-Number(a.online)||Number(b.favorite)-Number(a.favorite):
    sort==='recent'?(b.lastCall||0)-(a.lastCall||0):0)||collator.compare(a.name,b.name)||a.id.localeCompare(b.id));
}
