import {tr} from './locale.mjs';
// One ephemeral key per room participant. Trust the same XMPP identity as call signaling.
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const base64=buf=>btoa(String.fromCharCode(...new Uint8Array(buf)));
const bytes=s=>Uint8Array.from(atob(s),ch=>ch.charCodeAt(0));
const alg={name:'ECDH',namedCurve:'P-256'};
export class RoomText {
  constructor(room,id,send,received,changed){
    Object.assign(this,{room,id,send,received,changed});
    this.links=new Map();
    this.keys=crypto.subtle.generateKey(alg,false,['deriveKey']);
  }
  async hello(peer){
    const raw=await crypto.subtle.exportKey('raw',(await this.keys).publicKey);
    if(!this.closed)this.send(peer,'text-key',{key:base64(raw)});
  }
  async receive(peer,p){
    if(this.closed)return;
    if(p.kind==='text-key'){
      if(typeof p.key!=='string' || p.key.length!==88 || this.links.has(peer))return;
      const link={seen:new Set(),last:0,count:0};this.links.set(peer,link);
      try{
        const pub=await crypto.subtle.importKey('raw',bytes(p.key),alg,false,[]);
        const key=await crypto.subtle.deriveKey({name:'ECDH',public:pub},(await this.keys).privateKey,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
        if(this.links.get(peer)!==link)return;
        link.key=key;await this.hello(peer);this.changed();
      }catch{if(this.links.get(peer)===link)this.links.delete(peer);}
      return;
    }
    const link=this.links.get(peer);
    if(!link?.key || typeof p.iv!=='string' || p.iv.length!==16 || typeof p.body!=='string' || p.body.length>36000 || link.seen.has(p.iv))return;
    if(Date.now()-link.last>2000){link.last=Date.now();link.count=0;}
    if(++link.count>20)return;
    link.seen.add(p.iv);
    if(link.seen.size>4096)link.seen.delete(link.seen.values().next().value);
    try{
      const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(p.iv),additionalData:enc.encode(this.room+'|'+peer+'|'+this.id)},link.key,bytes(p.body));
      const data=JSON.parse(dec.decode(clear));
      if(this.links.get(peer)===link && Number.isFinite(data.at) && Math.abs(Date.now()-data.at)<120000 && typeof data.text==='string' && data.text.trim() && data.text.length<=4000)
        this.received(peer,{from:data.from,text:data.text});
    }catch{}
  }
  ready(peer){return Boolean(this.links.get(peer)?.key);}
  async write(peer,msg){
    const link=this.links.get(peer);if(!link?.key)throw Error(tr('Чат ещё подключается.'));
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const buf=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(this.room+'|'+this.id+'|'+peer)},link.key,enc.encode(JSON.stringify({...msg,at:Date.now()})));
    if(this.closed || this.links.get(peer)!==link)throw Error(tr('Участник вышел.'));
    this.send(peer,'text-box',{iv:base64(iv),body:base64(buf)});
  }
  close(){this.closed=true;this.links.clear();}
}
