'use strict';
const {tr}=require('../native-language.cjs');
const crypto=require('node:crypto'),os=require('node:os'),tls=require('node:tls'),udp=require('node:dgram');
const {createRoomCertificate,fingerprintOf}=require('../core/certificate.cjs');
const {validCard,publicCard,sign,verify}=require('./identity.cjs');
const PORT=45864,GROUP='239.255.42.97';
const topic=id=>crypto.createHash('sha256').update('CRAFTCODE LINK friends v1:'+id).digest();
function interfaces(){
  let addresses;try{addresses=os.networkInterfaces();}catch{return [];}
  return Object.entries(addresses).flatMap(([name,entries])=>entries.filter(e=>e.family==='IPv4'&&!e.internal && !e.address.startsWith('169.254.')).map(e=>({name,address:e.address,netmask:e.netmask})));
}
const ipNum=s=>s.split('.').reduce((n,x)=>(n<<8)|Number(x),0)>>>0;
function localTo(ip,nic){return (ipNum(ip)&ipNum(nic.netmask))===(ipNum(nic.address)&ipNum(nic.netmask));}
class Networks {
  constructor({profile,canDiscover=()=>true,attach,seen,issue,changed,dhtFactory,nics=interfaces}){
    Object.assign(this,{profile,canDiscover,attach,seen,issue,changed,nics,dhtFactory});this.tokens=new Map();this.dialing=new Set();this.epoch=0;
  }
  // One publication attempt per generation. Disabling discovery invalidates old callbacks.
  startDht(force=false){
    if(!this.canDiscover()||!this.profile()?.dht||this.profile().privacy?.status==='invisible')return;
    if(this.retiringListener)return this.retiringListener;
    if(this.dhtAttempt || (!force&&Date.now()<(this.dhtDue||0)))return this.dhtAttempt;
    const epoch=this.dhtEpoch||0;
    const attempt=this.publishDht(epoch);
    this.dhtAttempt=attempt;
    attempt.finally(()=>{if(this.dhtAttempt===attempt)this.dhtAttempt=null;});
    return attempt;
  }
  async publishDht(epoch){
    let node=this.dht, listening=Boolean(node&&this.dhtListening), timer;
    const current=()=>(this.dhtEpoch||0)===epoch;
    if(!listening){this.discovery='connecting';this.changed?.();}
    try{
      const DHT=require('hyperdht');
      if(!listening){
        node=this.dht=this.dhtFactory?this.dhtFactory():new DHT({ephemeral:true});
        this.server=node.createServer({shareLocalAddress:false},s=>{
          if(this.dht!==node){s.destroy();return;}this.noise(s);
        });
      }
      const deadline=new Promise((_,reject)=>{this.cancelPublication=()=>reject(Error('discovery stopped'));timer=setTimeout(()=>reject(Error('discovery timeout')),35000);timer.unref();});
      if(!listening){
        const keys=DHT.keyPair(Buffer.from(this.profile().device,'hex'));
        await Promise.race([this.server.listen(keys),deadline]);
        if(!current())return;
        listening=this.dhtListening=true;
      }
      await Promise.race([this.announce(),deadline]);
      if(!current())return;
      this.discovery='ready';this.dhtFailures=0;this.dhtDue=Date.now()+180000;
    }catch{
      if(!current())return;
      this.query?.destroy();this.query=null;
      if(!listening){
        this.dht=null;this.server=null;this.dhtListening=false;
        if(node)await node.destroy({force:true}).catch(()=>{});
      }
      if(!current())return;
      this.discovery='retry';
      this.dhtFailures=Math.min(5,(this.dhtFailures||0)+1);
      this.dhtDue=Date.now()+Math.min(60000,5000*2**(this.dhtFailures-1));
    }finally{clearTimeout(timer);if(current()){this.cancelPublication=null;this.changed?.();}}
  }
  noise(s,expected,node=this.dht){
    s.on('error',()=>{});
    const accept=()=>node!==this.dht?s.destroy():this.attach(s,'dht',Buffer.from(s.handshakeHash).toString('hex'),expected,s.remotePublicKey.toString('hex'));
    if(s.handshakeHash)accept();else s.once('open',accept);
  }
  async announce(){
    const node=this.dht;if(!node||!this.server?.listening)return;
    const p=this.profile(),keys=require('hyperdht').keyPair(Buffer.from(p.device,'hex'));
    const q=node.announce(topic(publicCard(p).id),keys,this.server.relayAddresses);
    this.query=q;
    try{await q.finished();if(!q.closestNodes.length)throw Error('no discovery nodes replied');}
    finally{if(this.query===q)this.query=null;}
  }
  async lookup(id,found){
    const node=this.dht;if(!node)return;
    const q=node.lookup(topic(id));
    for await(const result of q){if(this.dht!==node)break;for(const item of (result.peers||[]).slice(0,12))found(item.publicKey.toString('hex'));}
  }
  dialDht(device,id){
    if(!this.dht||this.dialing.has(device)||this.dialing.size>=12)return;
    this.dialing.add(device);
    const keys=require('hyperdht').keyPair(Buffer.from(this.profile().device,'hex'));
    const dialing=this.dialing,node=this.dht;
    const s=node.connect(Buffer.from(device,'hex'),{keyPair:keys,shareLocalAddress:false});
    const timeout=setTimeout(()=>s.destroy(),10000);
    const done=()=>{clearTimeout(timeout);dialing.delete(device);};
    s.once('open',done);s.once('close',done);this.noise(s,id,node);
  }
  stopDht(retain=[]){
    const old=this.dht,server=this.server;
    this.dhtEpoch=(this.dhtEpoch||0)+1;this.dhtAttempt=null;this.dhtDue=0;this.dhtFailures=0;this.dhtListening=false;
    this.cancelPublication?.();this.cancelPublication=null;this.query?.destroy();this.query=null;this.dht=null;this.server=null;this.discovery='off';this.dialing=new Set();
    if(!old)return;
    if(!retain.length)return old.destroy({force:true}).catch(()=>{});
    // Closing the listening identity leaves established Noise streams alive.
    // The old node belongs only to these streams until their last socket closes.
    const profile=this.profile(),keys=require('hyperdht').keyPair(Buffer.from(profile.device,'hex'));
    const retired=Promise.allSettled([old.unannounce?.(topic(publicCard(profile).id),keys),server?.close?.()]);
    this.retiringListener=retired;
    // A new listener using the same keys must not race these unannouncements.
    retired.then(()=>{if(this.retiringListener===retired)this.retiringListener=null;});
    const sockets=new Set(retain);
    for(const socket of sockets)socket.once('close',()=>{
      sockets.delete(socket);
      if(!sockets.size)old.destroy({force:true}).catch(()=>{});
    });
  }
  async startLan(name){
    this.stopLan();const epoch=this.epoch;if(!name||!this.canDiscover())return;
    const current=()=>epoch===this.epoch&&this.canDiscover();
    const nic=this.nics().find(i=>i.name===name);if(!nic)throw Error(tr('Выбранная сеть сейчас недоступна.'));
    const cert=await createRoomCertificate();if(!current())return;
    const {signal}=this.lanController=new AbortController();
    const server=this.lanServer=tls.createServer({key:cert.key,cert:cert.cert,minVersion:'TLSv1.3',handshakeTimeout:5000},s=>{
      s.on('error',()=>{});
      if(!current()||!localTo(s.remoteAddress,nic))return s.destroy();
      this.attach(s,'lan',s.exportKeyingMaterial(32,'CRAFTCODE LINK LAN').toString('hex'));
    });
    server.maxConnections=48;
    const bind=(obj,fn)=>new Promise((resolve,reject)=>{
      const cleanup=()=>{obj.off('error',failed);signal.removeEventListener('abort',done);};
      const failed=error=>{cleanup();reject(error);};
      const done=()=>{cleanup();resolve();};
      obj.once('error',failed);signal.addEventListener('abort',done,{once:true});fn(done);
    });
    try{
      await bind(server,cb=>server.listen({port:0,host:nic.address,signal},cb));if(!current())return;
      const listen=this.listen=udp.createSocket({type:'udp4',reuseAddr:true,signal}),send=this.sender=udp.createSocket({type:'udp4',signal});
      await bind(listen,cb=>listen.bind(PORT,'0.0.0.0',cb));if(!current())return;
      await bind(send,cb=>send.bind(0,nic.address,cb));if(!current())return;
      listen.addMembership(GROUP,nic.address);send.setMulticastInterface(nic.address);send.setMulticastTTL(1);send.setBroadcast(true);
      this.nic=nic;
      let window=0,count=0;
      listen.on('message',(raw,r)=>{
        if(!current() || raw.length!==21 || !raw.subarray(0,5).equals(Buffer.from('CCLQ1')) || !localTo(r.address,nic))return;
        if(Date.now()-window>2000){window=Date.now();count=0;}if(++count>32)return;
        const nonce=raw.subarray(5).toString('hex'),p=this.profile(),card=publicCard(p),port=server.address()?.port;
        if(!port)return;
        const proof=sign(p.device,['lan-v1',nonce,port,cert.fingerprint,card.name]);
        send.send(Buffer.from(JSON.stringify({v:1,nonce,card,port,pin:cert.fingerprint,proof})),r.port,r.address,()=>{});
      });
      send.on('message',(raw,r)=>{
        if(!current() || raw.length>1250 || !localTo(r.address,nic) || Date.now()>this.scanUntil || ++this.responses>160)return;
        try{
          const d=JSON.parse(raw);if(d.v!==1||d.nonce!==this.nonce||!Number.isInteger(d.port)||d.port<1||d.port>65535||!/^[a-f0-9]{64}$/.test(d.pin)||!validCard(d.card)||
            !verify(d.card.device,['lan-v1',d.nonce,d.port,d.pin,d.card.name],d.proof))return;
          this.seen(d.card,{host:r.address,port:d.port,pin:d.pin});
        }catch{}
      });
      for(const sock of [server,listen,send])sock.on('error',()=>this.issue(tr('Локальная сеть стала недоступна.')));
      this.refresh();
    }catch(e){if(epoch!==this.epoch)return;this.stopLan();throw e;}
  }
  refresh(){
    if(!this.canDiscover()||!this.sender||!this.nic)return;
    this.nonce=crypto.randomBytes(16).toString('hex');this.scanUntil=Date.now()+5000;this.responses=0;
    const n=this.nic,b=(ipNum(n.address)|~ipNum(n.netmask))>>>0;
    const addr=[24,16,8,0].map(i=>(b>>>i)&255).join('.');
    const q=Buffer.concat([Buffer.from('CCLQ1'),Buffer.from(this.nonce,'hex')]);
    for(const to of new Set([GROUP,addr]))this.sender.send(q,PORT,to,()=>{});
  }
  dialLan(route,id){
    if(!this.canDiscover()||!this.nic||!localTo(route.host,this.nic))return;
    const epoch=this.epoch;
    const s=tls.connect({host:route.host,port:route.port,localAddress:this.nic.address,minVersion:'TLSv1.3',rejectUnauthorized:false});
    const t=setTimeout(()=>s.destroy(),5000);s.on('error',()=>{});s.once('close',()=>clearTimeout(t));
    s.once('secureConnect',()=>{
      clearTimeout(t);if(this.epoch!==epoch||fingerprintOf(s.getPeerCertificate(true).raw)!==route.pin)return s.destroy();
      this.attach(s,'lan',s.exportKeyingMaterial(32,'CRAFTCODE LINK LAN').toString('hex'),id);
    });
  }
  stopLan(){
    ++this.epoch;this.nic=null;
    this.lanController?.abort();this.lanController=null;
    for(const key of ['listen','sender','lanServer']){try{this[key]?.close();}catch{}this[key]=null;}
  }
  stop(){this.stopLan();return this.stopDht();}
}
module.exports={Networks,interfaces};
