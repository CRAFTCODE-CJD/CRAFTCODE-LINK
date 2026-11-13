// Returning devices are advertised individually by the host of the live room.
const collator=new Intl.Collator(undefined,{sensitivity:'base',numeric:true});
export function quickContacts(contacts){
  return contacts.filter(c=>c.state==='friend').sort((a,b)=>
    Number(!!b.favorite)-Number(!!a.favorite) || Number(!!b.online)-Number(!!a.online) ||
    (b.lastCall||0)-(a.lastCall||0) || collator.compare(a.name,b.name) || a.id.localeCompare(b.id)).slice(0,6);
}
export function friendRooms(contacts,local,account,session,currentHost){
  const rooms=[];
  for(const person of contacts){
    if(person.state!=='friend' || !person.online)continue;
    const activities=local ? person.rooms || [] : [...(account.resources.get(person.id)||[])]
      .map(full=>account.activities.get(full)).filter(a=>a?.host);
    for(const a of activities){
      if(local && session?.hostDevice===a.device && session?.hostPerson===person.id ||
         !local && a.full===currentHost)continue;
      rooms.push({...a,id:person.id,name:person.name,local,limit:local?8:3,favorite:!!person.favorite});
    }
  }
  return rooms.sort((a,b)=>Number(a.count>=a.limit)-Number(b.count>=b.limit) || Number(!!b.canReturn)-Number(!!a.canReturn) ||
    Number(b.favorite)-Number(a.favorite) || collator.compare(a.name,b.name) || a.door.localeCompare(b.door));
}
