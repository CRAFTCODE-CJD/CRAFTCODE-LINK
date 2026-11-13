'use strict';
const {tr}=require('../native-language.cjs');
const {Duplex}=require('node:stream');
const {randomUUID}=require('node:crypto');
const {publicCard,sign,verify,validCard}=require('./identity.cjs');
const {BLOCK}=require('../files/storage.cjs');
const {TokenBucket}=require('../core/protocol.cjs');
const FILE_CHUNK=8*BLOCK,BASE_FRAME=48000,FILE_FRAME=4*Math.ceil(FILE_CHUNK/3)+1024;
class ContactLink {
  constructor(socket,route,binding,profile,expected,device,authenticated,packet,closed){
    this.socket=socket;this.route=route;this.binding=binding;
    const local=publicCard(profile),timeout=setTimeout(()=>socket.destroy(),7000);
    let buf=Buffer.alloc(0),used=0,count=0,window=Date.now();
    const fileBytes=new TokenBucket(24*1024**2,6*1024**2);
    this.writeBlocked=false;
    socket.on('drain',()=>{this.writeBlocked=false;});
    socket.on('error',()=>{});
    socket.once('close',()=>{clearTimeout(timeout);this.wire?.destroy();closed(this);});
    socket.on('data',part=>{
      try{
        for(let start=0;start<part.length&&!socket.destroyed;){
          const index=part.indexOf(10,start),end=index<0?part.length:index;
          const size=used+end-start,limit=this.fileChunks?FILE_FRAME:BASE_FRAME;
          if(size>limit)throw Error();
          let line;
          if(used||index<0){
            if(size>buf.length){const next=Buffer.allocUnsafe(Math.min(limit,Math.max(size,1024,buf.length*2)));buf.copy(next,0,0,used);buf=next;}
            part.copy(buf,used,start,end);used=size;
            if(index<0)return;
            line=buf.subarray(0,used);used=0;
          }else line=part.subarray(start,end);
          start=end+1;
          if(size>BASE_FRAME&&!fileBytes.take(size))throw Error();
          const msg=JSON.parse(line);
          if(!msg||typeof msg!=='object')throw Error();
          if(size>BASE_FRAME&&(msg.kind!=='friend-file'||msg.op!=='chunk'))throw Error();
          if(Date.now()-window>=1000){window=Date.now();count=0;}
          if(++count>180)throw Error();
          if(!this.card){
            const c=msg.card;
            if(msg.kind!=='hello'||!validCard(c)||(expected && c.id!==expected)||(device && c.device!==device)||c.id===local.id||
              !verify(c.device,['hello-v1',binding,c.id,c.device,c.name],msg.proof))throw Error();
            this.card=c;clearTimeout(timeout);authenticated(this);
          }else packet(this,msg);
        }
      }catch{socket.destroy();}
    });
    this.send({kind:'hello',card:local,proof:sign(profile.device,['hello-v1',binding,local.id,local.device,local.name])});
  }
  send(value){
    if(this.socket.destroyed||this.socket.writableLength>512*1024){this.socket.destroy();return false;}
    // Node TLS and streamx Noise both accept the write before signalling
    // backpressure. Never resend its bytes through another route.
    if(this.socket.write(JSON.stringify(value)+'\n')===false)this.writeBlocked=true;
    return true;
  }
  makeWire(id=randomUUID()){
    this.wire?.destroy();
    const link=this;
    const stream=new Duplex({
      read(){},
      write(chunk,enc,done){
        for(let i=0;i<chunk.length;i+=16384){
          if(!link.send({kind:'data',id,data:chunk.subarray(i,i+16384).toString('base64')}))return done(Error(tr('Связь потеряна.')));
        }
        done();
      },
      destroy(err,done){
        if(link.wire===stream){link.wire=null;link.send({kind:'end',id});}
        done(err);
      }
    });
    stream.on('error',()=>{});stream.wireId=id;this.wire=stream;return stream;
  }
  receiveWire(m){
    const wire=this.wire;
    if(!wire||m.id!==wire.wireId)return;
    if(m.kind==='end'){this.wire=null;wire.destroy();return;}
    if(typeof m.data!=='string'||m.data.length>22000||wire.readableLength>512*1024)return this.socket.destroy();
    wire.push(Buffer.from(m.data,'base64'));
  }
}
module.exports={ContactLink,FILE_CHUNK};
