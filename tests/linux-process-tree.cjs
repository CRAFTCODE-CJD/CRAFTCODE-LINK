'use strict';
const fs=require('node:fs');

// /proc can be mounted from an outer PID namespace. Use its own Pid and
// PPid values throughout, including the test driver's /proc/self/status.
function descendants() {
  const status=fs.readFileSync('/proc/self/status','utf8');
  const driver=Number(status.match(/^Pid:\s+(\d+)/m)[1]);
  const children=new Map();
  for(const id of fs.readdirSync('/proc').filter(name=>/^\d+$/.test(name))){
    try{
      const s=fs.readFileSync('/proc/'+id+'/status','utf8');
      const parent=Number(s.match(/^PPid:\s+(\d+)/m)?.[1]);
      const rss=Number(s.match(/^VmRSS:\s+(\d+) kB/m)?.[1] ?? 0);
      if(!children.has(parent))children.set(parent,[]);
      children.get(parent).push({id:Number(id),rss});
    }catch(err){if(!['ENOENT','EACCES','ESRCH'].includes(err.code))throw err;}
  }
  const pending=[driver], rows=[];
  while(pending.length){
    for(const child of children.get(pending.pop()) || []){rows.push(child);pending.push(child.id);}
  }
  return rows;
}

module.exports={descendants};
