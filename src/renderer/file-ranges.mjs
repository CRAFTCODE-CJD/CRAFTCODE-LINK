// Messages fit the 64 KiB SCTP interoperability ceiling, including the header.
export const FRAME=48*1024, RANGE=12*FRAME;
const HEADER=44,encoder=new TextEncoder(),decoder=new TextDecoder();
export function frame(id,pos,bytes){
  const buffer=new Uint8Array(HEADER+bytes.length);
  buffer.set(encoder.encode(id));new DataView(buffer.buffer).setFloat64(36,pos);
  buffer.set(bytes,HEADER);return buffer;
}
export function unpack(buffer){
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<=HEADER||buffer.byteLength>HEADER+FRAME)return;
  const id=decoder.decode(new Uint8Array(buffer,0,36)),pos=new DataView(buffer).getFloat64(36);
  if(!Number.isSafeInteger(pos)||pos<0||pos%FRAME)return;
  return {id,pos,bytes:new Uint8Array(buffer,HEADER)};
}
export class RangeSender{
  constructor(channel,load,onError){
    this.channel=channel;this.load=load;this.onError=onError;this.queue=[];this.busy=false;
    channel.bufferedAmountLowThreshold=256*1024;
    channel.onbufferedamountlow=()=>this.drain();
  }
  request(id,pos,length){
    if(this.queue.length>=4||this.queue.some(r=>r.id===id&&r.pos===pos))return;
    this.queue.push({id,pos,length,sent:0});void this.drain();
  }
  async drain(){
    if(this.busy)return;
    this.busy=true;
    try{
      while(this.queue.length&&this.channel.readyState==='open'&&this.channel.bufferedAmount<768*1024){
        const r=this.queue[0];
        try {
          if(!r.bytes)r.bytes=new Uint8Array(await this.load(r.id,r.pos,r.length));
          // The owner may withdraw a file while its disk read is in progress.
          if(this.queue[0]!==r)continue;
          if(this.channel.readyState!=='open')return;
          const bytes=r.bytes.subarray(r.sent,r.sent+FRAME);
          if(!bytes.length)throw Error('Invalid file range');
          this.channel.send(frame(r.id,r.pos+r.sent,bytes));r.sent+=bytes.length;
          if(r.sent===r.bytes.length)this.queue.shift();
        } catch(error) {
          if(this.queue[0]===r)this.queue.shift();
          this.onError(error);
        }
      }
    }finally{this.busy=false;}
  }
  withdraw(id){this.queue=this.queue.filter(request=>request.id!==id);}
  close(){this.queue.length=0;this.channel.onbufferedamountlow=null;}
}
