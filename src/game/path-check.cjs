'use strict';
const dgram=require('node:dgram');
const {randomBytes}=require('node:crypto');
const {tr}=require('../native-language.cjs');

// The first port is understood by older LINK versions. Other ports are
// advertised in the authenticated game roster, never inferred from a packet.
const PORT=45879, PORTS=[PORT,39319,32647], MAGIC=Buffer.from('CCLG1');
function isProbePort(port){return PORTS.includes(port);}
function isProbe(b){return b.length===22 && b.subarray(0,5).equals(MAGIC) && (b[5]===1 || b[5]===2);}
// Older ready participants advertise no port and listen on the original one.
function peerProbePort(peer){return peer?.ready ? (peer.probePort ?? PORT) : 0;}

class PathCheck{
  constructor({changed,peer,onPort=()=>{},createSocket=()=>dgram.createSocket('udp4')}){
    Object.assign(this,{changed,peer,onPort,createSocket});
    this.result={state:'off'};
  }
  open(address,afterBind=null){
    this.close();
    this.local=address;
    this.result={state:'binding'};
    this.changed();
    this.bind(address,0,0,afterBind);
  }
  bind(address,index,attempt,afterBind){
    const socket=this.socket=this.createSocket(),port=PORTS[index],rates=new Map();
    socket.unref?.();
    socket.on('error',err=>{
      if(this.socket!==socket)return;
      this.clear();
      this.socket=null;
      try{socket.close();}catch{}
      this.port=undefined;
      if((err.code==='EADDRINUSE'||err.code==='EACCES') && index+1<PORTS.length){
        this.bind(address,index+1,0,afterBind);
        return;
      }
      // Windows can finish adding an address before it is available for bind.
      if(err.code==='EADDRNOTAVAIL' && attempt<8){
        this.result={state:'binding'};
        this.bindRetry=setTimeout(()=>this.bind(address,index,attempt+1,afterBind),Math.min(1500,250*(attempt+1)));
        this.bindRetry.unref?.();
      }else{
        this.result={state:'unavailable',code:['EADDRINUSE','EACCES','EADDRNOTAVAIL'].includes(err.code)?err.code:'SOCKET_ERROR'};
        this.onPort(0);
      }
      this.changed();
    });
    socket.on('message',(b,r)=>{
      if(this.socket!==socket || !isProbePort(r.port) || r.address===address || !isProbe(b))return;
      const participant=this.peer(r.address);
      if(peerProbePort(participant)!==r.port)return;
      if(b[5]===1){
        const now=Date.now();if(now-(rates.get(r.address)||0)<250)return;rates.set(r.address,now);
        const reply=Buffer.from(b);reply[5]=2;
        socket.send(reply,r.port,r.address,()=>{});return;
      }
      const p=this.pending;
      if(p?.address===r.address && p.port===r.port && participant.device===p.device && b.subarray(6).equals(p.nonce))
        this.finish('ok',{ms:Math.round(performance.now()-p.start)});
    });
    socket.bind({address,port,exclusive:true},()=>{
      if(this.socket!==socket)return;
      this.port=port;this.result={state:'idle'};this.onPort(port);this.changed();
      const peer=afterBind && this.peer(afterBind.address);
      if(peer?.ready && peer.device===afterBind.device)this.test(afterBind.address);
    });
  }
  test(address){
    const part=this.peer(address);
    if(!part?.ready)throw Error(tr('Проверка сейчас недоступна.'));
    if(this.result.state==='unavailable' && this.local){
      this.open(this.local,{address,device:part.device});return;
    }
    if(!this.socket || !['idle','ok','timeout','error','peer-unavailable','port-compatibility'].includes(this.result.state))throw Error(tr('Проверка сейчас недоступна.'));
    if(part.probePort===0){this.result={state:'peer-unavailable',device:part.device};this.changed();return;}
    const port=isProbePort(part.probePort)?part.probePort:PORT;
    const nonce=randomBytes(16);
    this.pending={address,device:part.device,port,nonce,start:performance.now()};
    this.result={state:'testing',device:part.device};this.changed();
    const b=Buffer.concat([MAGIC,Buffer.from([1]),nonce]);
    const send=()=>{
      const p=this.pending,peer=this.peer(address);
      if(!p || peer?.device!==p.device || peerProbePort(peer)!==port){this.finish('error');return;}
      this.socket.send(b,port,address,e=>{if(e && this.pending===p)this.finish('error');});
    };
    this.timer=setTimeout(()=>this.finish(this.port!==PORT && this.peer(address)?.probePort===undefined?'port-compatibility':'timeout'),3600);
    this.retry=setInterval(send,950);send();
  }
  finish(state,extra={}){
    if(!this.pending)return;
    const device=this.pending.device;this.clear();this.result={state,device,...extra};this.changed();
  }
  clear(){clearInterval(this.retry);clearTimeout(this.timer);this.pending=null;}
  close(){
    clearTimeout(this.bindRetry);this.clear();
    const socket=this.socket;this.local=this.socket=this.port=undefined;this.result={state:'off'};if(socket)try{socket.close();}catch{}
  }
}
module.exports={PathCheck,PORT,isProbePort,isProbe,peerProbePort};
