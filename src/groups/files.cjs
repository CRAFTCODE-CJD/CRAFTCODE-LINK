'use strict';
const fs=require('node:fs/promises');
const {ShelfStorage,BLOCK}=require('../files/storage.cjs');
const {GroupBlobs,entries,validMeta,uuid,MAX,GROUP_MAX,COUNT,invalid}=require('./file-blobs.cjs');
const {FileWire,lost}=require('../files/file-wire.cjs');
const {tr}=require('../native-language.cjs');
const {MAX_CLIP,mediaType,digest,readPreviewBytes}=require('../files/chat-media.cjs');
const {GroupFileHandoff}=require('./file-handoff.cjs');
const {GroupBlockReader}=require('./block-reader.cjs');
const match=(t,a)=>t && t.group===a.group && t.channel===a.channel && t.meta.id===a.file;
function unpack(value,length){
  if(typeof value!=='string'||value.length!==4*Math.ceil(length/3))throw invalid();
  const b=Buffer.from(value,'base64');if(b.length!==length||b.toString('base64')!==value)throw invalid();return b;
}
function metadata(m){return {id:m.id,name:m.name,size:m.size,sha:m.sha};}
const rate=t=>t?.started?Math.round(t.done*1000/Math.max(1,performance.now()-t.started)):0;

class GroupFiles{
  constructor(groups,io){
    this.groups=groups;this.io=io;this.tasks=new Map();this.saved=new Map();this.generation=0;this.changedGroups=new Map();this.work=new Set();this.previews=0;
    this.reader=new GroupBlockReader();
    this.blobs=new GroupBlobs(io.directory,()=>groups.s.profile.device,(id,bucket,file)=>{
      const r=groups.records.get(id);
      if(bucket!=='data')return r?.move?.side==='candidate'&&r.move.token===bucket;
      // After the old server's durable fence, its private backup is still
      // required until the new owner acknowledges actual activation.
      if(r?.move?.side==='retired')return true;
      const g=r?.group||r?.move?.staged;
      return !!g&&entries(g).some(row=>row.file.id===file);
    });
    this.wire=new FileWire('group-file',link=>groups.fileAllowed(link),(l,op,args)=>this.remote(l,op,args),undefined,
      (link,op,a)=>{
        if(op==='read')this.readable(a.group,a.channel,link.card.id,a.file);
        if(op==='source')this.sourceTask(link,a);
        return true;
      });
    this.handoff=new GroupFileHandoff(this);
  }
  auth(group,channel,person){
    const g=this.groups.authority(group);
    if(!g||!this.groups.access(group,channel,person,'text'))throw invalid();
    return g;
  }
  ownerLink(id){
    const host=this.groups.host(id);
    const l=host&&this.groups.link(host.owner,host.device);
    if(!l||!this.groups.fileAllowed(l))throw lost();return l;
  }
  readable(group,channel,person,file){
    const row=entries(this.auth(group,channel,person)).find(row=>row.channel===channel&&row.file.id===file);
    if(!row)throw invalid();return row.file;
  }
  validTask(t){
    if(this.tasks.get(t.meta.id)!==t || t.cancelled || t.generation!==this.generation || this.groups.s.paused||this.groups.s.strict)throw lost();
    if(t.link&&!this.groups.fileAllowed(t.link))throw lost();
    if(t.link&&!t.ownerUpload){
      const record=this.groups.records.get(t.group);
      if(!record?.view||record.move||record.view.transferring||record.owner!==t.link.card.id||record.device!==t.link.card.device||
        !record.view.channels.some(c=>c.id===t.channel&&c.type==='text'))throw lost();
    }
  }
  sourceTask(link,args){
    const task=this.tasks.get(args.file);
    if(!match(task,args)||!task.shelf||task.ownerUpload||link!==task.link||task.status==='downloading')throw invalid();
    this.validTask(task);return task;
  }
  remoteBlock(task,op,pos){
    this.validTask(task);
    if(task.ownerUpload)this.auth(task.group,task.channel,task.author);
    return this.wire.request(task.link,op,{group:task.group,channel:task.channel,file:task.meta.id,pos},task.controller.signal)
      .then(value=>unpack(value,Math.min(BLOCK,task.meta.size-pos)));
  }
  track(job){
    this.work.add(job);const finished=()=>this.work.delete(job);job.then(finished,finished);return job;
  }
  add(t){
    if(this.tasks.size>=16||this.tasks.has(t.meta.id))throw invalid();
    t.done=0;t.generation=this.generation;t.controller=new AbortController();this.tasks.set(t.meta.id,t);
    t.timer=setTimeout(()=>{this.cancelTask(t).catch(()=>{});},10*60000);t.timer.unref();
    this.changed(t.group,t.channel);return t;
  }
  changed(group,channel){
    let channels=this.changedGroups.get(group);
    if(!channels){channels=new Set();this.changedGroups.set(group,channels);}
    channels.add(channel);
    if(!this.notifyTimer){this.notifyTimer=setTimeout(()=>{
      this.notifyTimer=null;const updates=this.changedGroups;this.changedGroups=new Map();
      for(const [id,channels] of updates)for(const channel of channels)this.groups.filesChanged(id,channel);
    },180);this.notifyTimer.unref();}
  }
  async cancelTask(t){
    if(!t)return;
    t.cancelled=true;t.controller.abort(lost());clearTimeout(t.timer);if(!t.running&&this.tasks.get(t.meta.id)===t)this.tasks.delete(t.meta.id);
    await t.shelf?.close();this.changed(t.group,t.channel);
  }
  permissionsChanged(group){
    for(const task of this.tasks.values()){
      if(task.group!==group||task.cancelled)continue;
      try{
        this.validTask(task);
        if(task.ownerUpload)this.auth(group,task.channel,task.author);
        else if(!task.link)this.readable(group,task.channel,task.author,task.meta.id);
      }catch{this.cancelTask(task).catch(()=>{});}
    }
  }
  reserve(g,m){
    const files=entries(g).map(r=>r.file);
    for(const t of this.tasks.values())if(t.ownerUpload&&t.group===g.id)files.push(t.meta);
    if(Object.values(g.messages).some(rows=>rows.some(r=>r.nonce===m.id))||files.some(f=>f.id===m.id)||files.length>=COUNT||files.reduce((n,f)=>n+f.size,m.size)>GROUP_MAX)
      throw Error(tr('Достигнут предел хранилища файлов группы.'));
  }
  listed(g,channel,person){
    return entries(g).filter(r=>r.channel===channel).map(r=>({...r.file,author:r.author,canWithdraw:person===r.author||
      g.owner===person||g.members.some(m=>m.id===person&&m.role==='admin')}));
  }
  async list(group,channel){
    const me=this.groups.s.me.id,local=this.groups.authority(group);
    const rows=local?this.listed(this.auth(group,channel,me),channel,me):await this.wire.request(this.ownerLink(group),'list',{group,channel});
    if(!Array.isArray(rows)||rows.length>COUNT)throw invalid();
    const result=new Map();
    for(const m of rows){
      if(!validMeta(m)||typeof m.author!=='string')throw invalid();
      const saved=this.saved.get([group,channel,m.id].join('/')),t=this.tasks.get(m.id),down=match(t,{group,channel,file:m.id})&&t.status==='downloading';
      result.set(m.id,{...metadata(m),author:m.author,status:down?'downloading':saved?'saved':'available',done:down?t.done:saved?m.size:0,
        canDownload:!down,canReveal:!!saved,canWithdraw:m.canWithdraw===true,canCancel:!!down,bytesPerSecond:down?rate(t):0});
    }
    for(const t of this.tasks.values())if(t.group===group&&t.channel===channel&&!result.has(t.meta.id))
      result.set(t.meta.id,{...t.meta,author:t.author,status:t.status,done:t.done,bytesPerSecond:rate(t),canCancel:true,canAccept:t.ownerUpload&&t.status==='offered'&&t.author!==me});
    return [...result.values()];
  }
  async offer(group,channel,selection,caption=''){
    const generation=this.generation,me=this.groups.s.me.id;
    const own=this.groups.authority(group);let link;
    if(own)this.auth(group,channel,me);else link=this.ownerLink(group);
    const file=selection||{filename:await this.io.choose()};if(!file.filename&&!file.bytes)return;
    if(generation!==this.generation||this.groups.s.me.id!==me)throw lost();
    const shelf=new ShelfStorage(this.io.downloads());let t;
    try{
      if(file.filename&&(await fs.stat(file.filename)).size>MAX)
        throw Error(tr('В группе можно хранить файлы до 32 МиБ. Больший файл можно отправить в личный чат.'));
      const m=file.filename?await shelf.offer(file.filename,MAX):shelf.memory(file.name,file.bytes);
      if(generation!==this.generation||this.groups.s.me.id!==me)throw invalid();
      if(own)this.reserve(this.auth(group,channel,me),m);else if(link!==this.ownerLink(group))throw lost();
      t=this.add({group,channel,author:me,meta:m,caption,ownerUpload:!!own,shelf,link,status:own?'uploading':'offered'});
      if(own)await this.track(this.storeUpload(t));
      else await this.wire.request(link,'offer',{group,channel,meta:m,...(caption?{caption}:{})});
    }catch(error){await this.cancelTask(t);await shelf.close();throw error;}
  }
  async storeUpload(t){
    const {group,channel,author,meta:m}=t;let w,committed=false;
    t.status='uploading';t.started=performance.now();t.running=true;this.changed(group,channel);
    try{
      this.validTask(t);this.auth(group,channel,author);
      w=await this.blobs.begin(group,m);
      const read=pos=>t.shelf?t.shelf.readBytes(m.id,pos,BLOCK):this.remoteBlock(t,'source',pos);
      for await(const {pos,bytes} of this.reader.blocks(m.size,false,t.link,t.controller.signal,read)){
        this.validTask(t);this.auth(group,channel,author);
        await this.blobs.write(w,pos,bytes);t.done=w.pos;this.changed(group,channel);
      }
      this.validTask(t);this.auth(group,channel,author);await this.blobs.finish(w);
      this.validTask(t);this.auth(group,channel,author);
      await this.groups.appendFile(group,channel,author,m.id,metadata(m),t.caption);committed=true;
    }finally{
      t.controller.abort(lost());
      if(w && !committed)await this.blobs.abort(w);
      if(t.link)this.wire.request(t.link,'released',{group,channel,file:m.id}).catch(()=>{});
      t.running=false;
      await this.cancelTask(t);
    }
  }
  async download(group,channel,file){
    const me=this.groups.s.me.id,local=this.groups.authority(group);
    const r=(await this.list(group,channel)).find(m=>m.id===file&&m.canDownload);
    if(!r)throw invalid();
    const link=local?null:this.ownerLink(group),shelf=new ShelfStorage(this.io.downloads(),this.io.journal?.());
    const t=this.add({group,channel,author:me,meta:metadata(r),link,shelf,status:'downloading',running:true,started:performance.now()});
    try{
      const id=await shelf.begin(r,'Group-'+group);
      const check=()=>{
        this.validTask(t);
        if(local)this.readable(group,channel,me,file);
      };
      const read=async pos=>{
        if(link)return this.remoteBlock(t,'read',pos);
        check();return r.size?this.blobs.read(group,r,pos):Buffer.alloc(0);
      };
      for await(const {pos,bytes} of this.reader.blocks(r.size,true,link,t.controller.signal,read)){
        check();const wrote=await shelf.putBytes(id,pos,bytes,check);t.done=wrote.pos;this.changed(group,channel);
        if(wrote.done){
          if(this.saved.size>=256)this.saved.delete(this.saved.keys().next().value);
          this.saved.set([group,channel,file].join('/'),wrote.path);break;
        }
      }
    }finally{t.running=false;await this.cancelTask(t);}
  }
  async remote(l,op,a){
    if(op.startsWith('move-'))return this.handoff.receive(l,op,a);
    const {group,channel,file,pos}=a,person=l.card.id;
    if(!uuid(group)||!uuid(channel)||!['list','offer'].includes(op)&&!uuid(file))throw invalid();
    if(op==='source'||op==='released'){
      const t=this.sourceTask(l,a);
      if(op==='released'){await this.cancelTask(t);return true;}
      t.status='uploading';t.started??=performance.now();const data=await t.shelf.readBytes(file,pos,BLOCK);
      this.validTask(t);t.done=Math.max(t.done,pos+data.length);this.changed(group,channel);return data.toString('base64');
    }
    const g=this.auth(group,channel,person);
    if(op==='list')return this.listed(g,channel,person);
    if(op==='offer'){
      if(!validMeta(a.meta))throw invalid();
      // Pending offers reserve no more than half of the 16 transfer slots.
      // Count the authenticated person across all groups and devices.
      const offers=[...this.tasks.values()].filter(t=>t.ownerUpload&&t.status==='offered');
      if(offers.length>=8||offers.filter(t=>t.author===person).length>=4)throw invalid();
      this.reserve(g,a.meta);
      if(a.caption!==undefined && (typeof a.caption!=='string'||a.caption.length>1024||Buffer.byteLength(a.caption)>3600))throw invalid();
      this.add({group,channel,meta:metadata(a.meta),caption:a.caption||'',author:person,link:l,ownerUpload:true,status:'offered'});return true;
    }
    if(op==='cancel-offer'){
      const t=this.tasks.get(file);if(!match(t,a)||t.author!==person||t.link!==l)throw invalid();await this.cancelTask(t);return true;
    }
    if(op==='withdraw'){await this.groups.removeFile(group,channel,person,file);return true;}
    if(op==='read'){
      const row=entries(g).find(r=>r.channel===channel&&r.file.id===file);if(!row)throw invalid();
      let data;
      if(!row.file.size&&pos===0){await this.blobs.verify(group,row.file);data=Buffer.alloc(0);}
      else data=await this.blobs.read(group,row.file,pos);
      const latest=this.auth(group,channel,person);
      if(!entries(latest).some(r=>r.channel===channel&&r.file.id===file))throw invalid();
      return data.toString('base64');
    }
    throw invalid();
  }
  async preview(group,channel,file){
    if(this.previews>=2)throw invalid();
    const generation=this.generation,own=this.groups.authority(group);
    const key=[group,channel,file].join('/'),dest=this.saved.get(key);
    if(!own&&!dest)throw invalid();
    const lookup=async()=>(await this.list(group,channel)).find(m=>m.id===file&&m.canDownload);
    this.previews++;
    try{
      const meta=await lookup();if(!meta||!meta.size||meta.size>MAX_CLIP)throw invalid();
      let bytes;
      if(dest)bytes=await readPreviewBytes(dest,meta.size);
      else{
        bytes=Buffer.alloc(meta.size);
        for(let pos=0;pos<meta.size;pos+=BLOCK){
          if(generation!==this.generation)throw invalid();
          (await this.blobs.read(group,meta,pos)).copy(bytes,pos);
        }
      }
      if(generation!==this.generation||this.groups.s.strict||digest(bytes)!==meta.sha)throw invalid();
      const type=mediaType(meta.name,bytes);
      if(!type||(await lookup())?.sha!==meta.sha||generation!==this.generation)throw invalid();
      return {type,bytes};
    }catch{throw invalid();}finally{this.previews--;}
  }
  async command(op,a){
    const group=a.group,channel=a.channel,file=a.file,me=this.groups.s.me.id;
    if(!uuid(group)||!uuid(channel)||!['list','offer'].includes(op)&&!uuid(file))throw invalid();
    if(op==='list')return this.list(group,channel);
    if(op==='preview')return this.track(this.preview(group,channel,file));
    if(op==='offer'){await this.offer(group,channel);return true;}
    if(op==='download'){await this.track(this.download(group,channel,file));return true;}
    const own=this.groups.authority(group),t=this.tasks.get(file);
    if(op==='accept'||op==='decline'){
      const g=this.auth(group,channel,me);
      if(g.owner!==me||!match(t,a)||!t.ownerUpload||t.status!=='offered')throw invalid();
      if(op==='accept')await this.track(this.storeUpload(t));
      else {await this.cancelTask(t);this.wire.request(t.link,'released',{group,channel,file}).catch(()=>{});}
    }else if(op==='cancel'){
      if(!match(t,a))throw invalid();
      await this.cancelTask(t);
      if(t.link&&t.status!=='downloading')this.wire.request(t.link,t.ownerUpload?'released':'cancel-offer',{group,channel,file}).catch(()=>{});
    }else if(op==='withdraw'){
      if(own){this.auth(group,channel,me);await this.groups.removeFile(group,channel,me,file);}
      else await this.wire.request(this.ownerLink(group),'withdraw',{group,channel,file});
    }else if(op==='reveal'){
      const dest=this.saved.get([group,channel,file].join('/'));
      if(!dest||!(await this.list(group,channel)).some(r=>r.id===file)||!(await fs.stat(dest)).isFile())throw invalid();this.io.reveal(dest);
    }else throw invalid();
    return true;
  }
  receive(link,m){return this.track(this.wire.receive(link,m));}
  disconnected(link){
    for(const t of this.tasks.values())if(t.link===link)this.cancelTask(t).catch(()=>{});
    this.wire.disconnected(link);
  }
  reconcile(id,g){
    return this.track(this.blobs.prune(id,file=>{
      const current=this.groups.records?this.groups.records.get(id)?.group:g;
      const t=this.tasks.get(file);
      return t?.group===id&&t.ownerUpload || current&&entries(current).some(r=>r.file.id===file);
    }));
  }
  allowHandoff(a){return this.handoff.allow(a);}
  prepareHandoff(a){return this.track(this.handoff.prepare(a));}
  verifyHandoff(a){return this.track(this.handoff.verify(a));}
  activateHandoff(a){return this.track(this.handoff.activate(a));}
  cancelHandoff(a){return this.track(this.handoff.cancel(a));}
  retireHandoff({id}){return this.track(this.blobs.prune(id,new Set()));}
  async close(){
    this.generation++;this.wire.close();await this.handoff.close();
    await Promise.allSettled([...this.tasks.values()].map(t=>this.cancelTask(t)));
    await Promise.allSettled([...this.work]);
    clearTimeout(this.notifyTimer);this.notifyTimer=null;this.changedGroups.clear();this.saved.clear();
  }
}
module.exports={GroupFiles,unpack};
