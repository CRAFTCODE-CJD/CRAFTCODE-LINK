'use strict';

const {BLOCK}=require('../files/storage.cjs');

// Older peers accept six concurrent file operations. Share four data requests
// between all files on one link, leaving room for list/cancel traffic.
const PER_LINK=4, TOTAL=16;

class GroupBlockReader {
  constructor(){
    this.active=0;
    this.perLink=new Map();
    this.queue=[];
  }
  schedule(){
    for(let i=0;i<this.queue.length&&this.active<TOTAL;){
      const job=this.queue[i];
      if((this.perLink.get(job.link)||0)>=PER_LINK){i++;continue;}
      this.queue.splice(i,1);
      job.start();
    }
  }
  request(link,signal,read){
    signal.throwIfAborted();
    return new Promise((resolve,reject)=>{
      const job={link,start:async()=>{
        signal.removeEventListener('abort',cancel);
        this.active++;
        this.perLink.set(link,(this.perLink.get(link)||0)+1);
        try{resolve(await read());}catch(error){reject(error);}
        finally{
          this.active--;
          const remaining=this.perLink.get(link)-1;
          if(remaining)this.perLink.set(link,remaining);else this.perLink.delete(link);
          this.schedule();
        }
      }};
      const cancel=()=>{
        this.queue.splice(this.queue.indexOf(job),1);
        reject(signal.reason);
      };
      signal.addEventListener('abort',cancel,{once:true});
      this.queue.push(job);
      this.schedule();
    });
  }
  async *blocks(size,includeEmpty,link,signal,read){
    const end=includeEmpty?Math.max(1,size):size;
    const window=link?PER_LINK:1;
    const pending=[];
    let pos=0;
    while(pos<end||pending.length){
      signal.throwIfAborted();
      while(pos<end&&pending.length<window){
        const offset=pos;
        const result=link?this.request(link,signal,()=>read(offset)):read(offset);
        // A later reply may fail before the earlier block reaches disk.
        pending.push(result.then(bytes=>({pos:offset,bytes}),error=>({error})));
        pos+=BLOCK;
      }
      const block=await pending.shift();
      if('error' in block)throw block.error;
      signal.throwIfAborted();
      yield block;
    }
  }
}

module.exports={GroupBlockReader};
