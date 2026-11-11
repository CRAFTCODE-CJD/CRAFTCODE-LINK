'use strict';
const {joinRecoveringGuest}=require('./reconnect.cjs');
const {tr}=require('../native-language.cjs');
const unavailable=()=>Error(tr('Эта комната уже недоступна.'));

// No media or file access belongs to this candidate. Keep early room events
// private until the renderer has torn down the previous call and adopts it.
class GuestSwitch {
  constructor(options,expires){
    this.options=options;this.controller=new AbortController();this.queue=[];this.bytes=0;
    this.timer=setTimeout(()=>this.close(),Math.max(0,expires-Date.now()));this.timer.unref();
  }
  receive(event){
    if(this.listener){this.listener(event);return;}
    if(this.controller.signal.aborted)return;
    this.bytes+=Buffer.byteLength(JSON.stringify(event));
    if(event.type==='closed'||event.type==='network-reconnecting'||this.queue.length>=64||this.bytes>1024*1024){this.close();return;}
    this.queue.push(event);
  }
  async connect(){
    this.room=await joinRecoveringGuest({...this.options,signal:this.controller.signal,onEvent:event=>this.receive(event)});
    if(this.controller.signal.aborted){await this.room.close();throw unavailable();}
  }
  usable(){return !!this.room&&!this.controller.signal.aborted&&!this.listener;}
  adopt(listener){
    if(!this.usable())throw unavailable();
    clearTimeout(this.timer);this.listener=listener;
    for(const event of this.queue)listener(event);
    this.queue.length=0;
    return this.room;
  }
  close(){
    clearTimeout(this.timer);
    if(this.listener)return;
    this.controller.abort();this.queue.length=0;
    return this.room?.close().catch(()=>{});
  }
}
module.exports={GuestSwitch};
