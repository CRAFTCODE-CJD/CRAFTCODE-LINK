'use strict';
const {randomUUID}=require('node:crypto');
const {tr}=require('../native-language.cjs');
const lost=()=>Error(tr('Связь потеряна.'));
const uuid=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
const invalid=()=>Error(tr('Не удалось выполнить операцию с файлом.'));
class FileWire{
  constructor(kind,allowed,handler,scope=()=>undefined,responseAllowed=()=>true){Object.assign(this,{kind,allowed,handler,scope,responseAllowed});this.pending=new Map();this.nextSend=new WeakMap();this.inflight=new WeakMap();}
  async send(link,message,guard=()=>true){
    const now=Date.now(),at=Math.max(now,this.nextSend.get(link)||0);
    if(at-now>1000)throw lost();
    this.nextSend.set(link,at+14);
    if(at>now)await new Promise(resolve=>setTimeout(resolve,at-now));
    if(!this.allowed(link)||this.scope(link)!==message.scope||link.socket.destroyed||!guard()||!link.send(message))throw lost();
  }
  request(link,op,args){
    if(!link||!this.allowed(link)||this.pending.size>=32)return Promise.reject(lost());
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const finish=(error,value)=>{clearTimeout(timer);this.pending.delete(id);error?reject(error):resolve(value);};
      const timer=setTimeout(()=>finish(lost()),12000);timer.unref();
      this.pending.set(id,{link,finish});
      this.send(link,{kind:this.kind,id,op,args,scope:this.scope(link)}).catch(error=>finish(error));
    });
  }
  async receive(link,m){
    if(!this.allowed(link)||this.scope(link)!==m?.scope||!uuid(m?.id))return;
    if(m.op==='result'){
      const p=this.pending.get(m.id);if(p?.link!==link)return;
      p.finish(m.ok===true?null:invalid(),m.value);return;
    }
    if(typeof m.op!=='string'||!m.args||typeof m.args!=='object'||Array.isArray(m.args)||(this.inflight.get(link)||0)>=6)return;
    this.inflight.set(link,(this.inflight.get(link)||0)+1);
    let ok=false,value;
    try{value=await this.handler(link,m.op,m.args);ok=true;}catch{}
    finally{this.inflight.set(link,this.inflight.get(link)-1);}
    await this.send(link,{kind:this.kind,id:m.id,op:'result',ok,value,scope:m.scope},()=>!ok||this.responseAllowed(link,m.op,m.args)).catch(()=>{});
  }
  disconnected(link){for(const p of this.pending.values())if(p.link===link)p.finish(lost());}
  close(){for(const p of this.pending.values())p.finish(lost());}
}
module.exports={FileWire,lost,uuid};
