'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {BLOCK}=require('../files/storage.cjs');
const {entries,validMeta,uuid,COUNT,GROUP_MAX,invalid}=require('./file-blobs.cjs');

class GroupFileHandoff{
  constructor(files){this.files=files;this.allowed=new Map();}
  allow({id,person,device,token}){
    if(!uuid(id)||!uuid(token))throw invalid();
    const previous=this.allowed.get(id);
    if(previous?.token===token && previous.person===person && previous.device===device)return;
    if(previous)throw invalid();
    this.allowed.set(id,{person,device,token});
  }
  async prepare({group,person,device,token,link}){
    if(!uuid(token)||link?.card.id!==person||link.card.device!==device)throw invalid();
    const check=()=>{
      const groups=this.files.groups,x=groups.records.get(group.id)?.move;
      if(!groups.active||!groups.fileAllowed(link)||x?.side!=='source'||x.phase!=='sending'||
        x.token!==token||x.person!==person||x.device!==device)throw invalid();
    };
    const rows=entries(group),base={group:group.id,token};
    for(const {file} of rows){
      check();
      if(await this.files.wire.request(link,'move-start',{...base,meta:file})==='present')continue;
      for(let pos=0;pos<file.size;pos+=BLOCK){
        check();
        const chunk=await this.files.blobs.read(group.id,file,pos);
        check();
        await this.files.wire.request(link,'move-data',{...base,file:file.id,pos,data:chunk.toString('base64')});
      }
      check();
      await this.files.wire.request(link,'move-end',{...base,file:file.id});
    }
  }
  async receive(link,op,a){
    const id=a.group,h=this.allowed.get(id);
    const move=this.files.groups.records.get(id)?.move;
    if(!h||move?.side!=='candidate'||move.phase!=='accepted'||move.token!==h.token||h.token!==a.token||
      h.person!==link.card.id||h.device!==link.card.device||h.busy)throw invalid();
    h.busy=true;
    try{
      if(op==='move-start'){
        if(!validMeta(a.meta))throw invalid();
        if(h.writer){await this.files.blobs.abort(h.writer);h.writer=null;}
        try{await this.files.blobs.verify(id,a.meta,h.token);return 'present';}
        catch(e){if(e.code!=='ENOENT')throw e;}
        const dir=await this.files.blobs.directoryFor(id,h.token);
        const names=(await fs.readdir(dir)).filter(n=>n.endsWith('.blob'));
        if(names.length>=COUNT)throw invalid();
        let size=a.meta.size;
        for(const n of names){size+=(await fs.stat(path.join(dir,n))).size;if(size>GROUP_MAX+28*(COUNT+GROUP_MAX/BLOCK))throw invalid();}
        const w=await this.files.blobs.begin(id,a.meta,h.token);
        if(this.allowed.get(id)!==h){await this.files.blobs.abort(w);throw invalid();}
        h.writer=w;return 'send';
      }
      const w=h.writer;
      if(!w||w.meta.id!==a.file)throw invalid();
      if(op==='move-data'){
        if(typeof a.data!=='string'||a.data.length>32768)throw invalid();
        const bytes=Buffer.from(a.data,'base64');if(bytes.toString('base64')!==a.data)throw invalid();
        await this.files.blobs.write(w,a.pos,bytes);return true;
      }
      if(op==='move-end'){await this.files.blobs.finish(w);h.writer=null;return true;}
      throw invalid();
    }finally{h.busy=false;}
  }
  async verify({group,person,device,token}){
    const h=this.allowed.get(group.id);
    if(!h||h.token!==token||h.person!==person||h.device!==device||h.busy||h.writer)throw invalid();
    const required=entries(group),dir=await this.files.blobs.directoryFor(group.id,token);
    const actual=(await fs.readdir(dir)).filter(n=>n.endsWith('.blob'));
    if(actual.length!==required.length)throw invalid();
    for(const {file} of required)await this.files.blobs.verify(group.id,file,token);
  }
  async activate({group,token}){
    if(!uuid(group.id)||!uuid(token))throw invalid();
    // Hard links install without replacing any committed file. Verification on
    // EEXIST makes a restart between activation and the owner's ACK idempotent.
    for(const {file} of entries(group)){
      const dir=await this.files.blobs.directoryFor(group.id);
      try{await fs.lstat(path.join(dir,file.id+'.blob'));await this.files.blobs.verify(group.id,file);}
      catch(e){if(e.code!=='ENOENT')throw e;await this.files.blobs.verify(group.id,file,token);await this.files.blobs.activate(group.id,file,token);}
    }
    await this.cancel({id:group.id,token});
  }
  async cancel({id,token}){
    if(!uuid(id)||!uuid(token))throw invalid();
    const h=this.allowed.get(id);
    if(h?.token===token){this.allowed.delete(id);if(h.writer)await this.files.blobs.abort(h.writer);}
    await this.files.blobs.prune(id,new Set(),token);
  }
  async close(){
    const all=[...this.allowed.values()];this.allowed.clear();
    await Promise.allSettled(all.filter(h=>h.writer).map(h=>this.files.blobs.abort(h.writer)));
  }
}
module.exports={GroupFileHandoff};
