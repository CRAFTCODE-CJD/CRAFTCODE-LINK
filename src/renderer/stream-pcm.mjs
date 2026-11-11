// Protected stereo PCM arrives from the WASAPI helper in IPC blocks. A short
// reservoir absorbs scheduling jitter. Restore silence smoothly after starvation.
// At 48 kHz, 12 ms covers a native 10 ms packet and most of a render quantum.
const refillSamples=576*2;
class StreamPCM extends AudioWorkletProcessor {
  constructor() {
    super();
    // Allow 40 ms for a late native burst. Routine reads begin at 12 ms.
    this.samples=new Int16Array(1920*2);
    this.head=0;this.size=0;this.waiting=false;this.playing=false;
    this.peakFrames=0;this.discardedFrames=0;this.underruns=0;this.untilReport=48000;
    this.fade=0;this.tail=0;this.lastLeft=0;this.lastRight=0;
    this.fromLeft=0;this.fromRight=0;
    this.port.onmessage=({data})=>{
      this.waiting=false;
      if(!data?.byteLength || data.byteLength%4)return;
      const all=new Int16Array(data.buffer,data.byteOffset,data.byteLength/2);
      const input=all.subarray(Math.max(0,all.length-this.samples.length));
      if(this.size+input.length>this.samples.length){
        const drop=this.size+input.length-this.samples.length;
        this.discardedFrames+=drop/2;
        this.head=(this.head+drop)%this.samples.length;this.size-=drop;this.fade=128;
        this.fromLeft=this.lastLeft;this.fromRight=this.lastRight;
      }
      const end=(this.head+this.size)%this.samples.length;
      const first=Math.min(input.length,this.samples.length-end);
      this.samples.set(input.subarray(0,first),end);
      this.samples.set(input.subarray(first),0);
      this.size+=input.length;
      this.peakFrames=Math.max(this.peakFrames,this.size/2);
      this.discardedFrames+=(all.length-input.length)/2;
    };
  }
  process(_inputs,outputs) {
    const [left,right]=outputs[0];
    if(!this.playing && !this.tail && this.size>=refillSamples){
      this.playing=true;this.fade=128;this.fromLeft=0;this.fromRight=0;
    }
    const frames=this.playing?Math.min(left.length,this.size>>1):0;
    for(let i=0;i<frames;i++){
      const blend=this.fade?this.fade--/128:0;
      left[i]=this.fromLeft*blend+this.samples[this.head]*(1-blend)/32768;
      right[i]=this.fromRight*blend+this.samples[this.head+1]*(1-blend)/32768;
      this.head=(this.head+2)%this.samples.length;
    }
    this.size-=frames*2;
    if(frames){this.lastLeft=left[frames-1];this.lastRight=right[frames-1];}
    if(this.playing && frames<left.length){this.playing=false;this.tail=128;this.underruns++;}
    for(let i=frames;i<left.length && this.tail;i++){
      const gain=--this.tail/128;left[i]=this.lastLeft*gain;right[i]=this.lastRight*gain;
    }
    this.untilReport-=left.length;
    if(this.size<refillSamples && !this.waiting){
      this.waiting=true;
      if(this.untilReport<=0){
        this.port.postMessage({peakFrames:this.peakFrames,discardedFrames:this.discardedFrames,underruns:this.underruns});
        this.untilReport=48000;this.peakFrames=0;
      }else this.port.postMessage('read');
    }
    return true;
  }
}
registerProcessor('link-stream-pcm',StreamPCM);
