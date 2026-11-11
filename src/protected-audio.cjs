'use strict';
const {tr}=require('./native-language.cjs');
const {spawn} = require('node:child_process');
const path = require('node:path');

const signature=Buffer.from('CCPCM01\n');
// Keep the latest 30 ms of whole stereo frames if the consumer stalls.
const frameBytes=4, maxBytes=1440*frameBytes;
const stopped=()=>new Error(tr('Защищённый захват звука остановлен.'));

class ProtectedAudio {
  constructor(launch = () => spawn(path.join(__dirname,'..','bin','link-audio.exe'),[],{
    shell:false, windowsHide:true, stdio:['pipe','pipe','ignore'],
  })) {
    this.launch=launch;
    this.current=null;
  }
  start(token) {
    this.stop();
    return new Promise((resolve,reject)=>{
      const child=this.launch();
      const s={token,child,ready:false,buffer:Buffer.alloc(0),partial:Buffer.alloc(0),waiter:null,reject};
      this.current=s;
      const end=()=>{if(this.current===s)this.stop(token);};
      s.timer=setTimeout(end,5500);
      child.on('error',end);child.once('exit',end);child.stdout.on('error',end);child.stdin.on('error',end);
      child.stdout.on('data',data=>{
        if(this.current!==s)return;
        if(!s.ready) {
          data=Buffer.concat([s.partial,data]);s.partial=Buffer.alloc(0);
          if(data.length<signature.length){s.partial=data;return;}
          if(!data.subarray(0,signature.length).equals(signature)){end();return;}
          s.ready=true;clearTimeout(s.timer);s.reject=null;resolve(true);
          data=data.subarray(signature.length);
        }
        if(!data.length)return;
        const queue=Buffer.concat([s.buffer,data]);
        const drop=Math.max(0,Math.ceil((queue.length-maxBytes)/frameBytes)*frameBytes);
        s.buffer=queue.subarray(drop);
        if(s.waiter && s.buffer.length>=frameBytes)s.waiter();
      });
    });
  }
  read(token) {
    const s=this.current;
    if(!s?.ready || s.token!==token || s.waiter)throw stopped();
    const take=()=>{const length=s.buffer.length-s.buffer.length%frameBytes;
      const result=Uint8Array.from(s.buffer.subarray(0,length));s.buffer=s.buffer.subarray(length);return result;};
    if(s.buffer.length>=frameBytes)return take();
    return new Promise(resolve=>{
      const finish=()=>{clearTimeout(timer);s.waiter=null;resolve(take());};
      const timer=setTimeout(finish,80);
      s.waiter=finish;
    });
  }
  stop(token) {
    const s=this.current;
    if(!s || (token!==undefined && token!==s.token))return;
    this.current=null;clearTimeout(s.timer);
    s.buffer=Buffer.alloc(0);s.waiter?.();s.reject?.(stopped());
    s.child.stdin.destroy();s.child.kill();
  }
}
module.exports={ProtectedAudio};
