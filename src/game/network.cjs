'use strict';
const {ipv4Number,interfaceRanges,overlaps,chooseFreePrefix}=require('./subnet.cjs');
const {launch}=require('./windows.cjs');
const {tr}=require('../native-language.cjs');
const {TokenBucket}=require('../core/protocol.cjs');
const {PathCheck,isProbePort,isProbe,peerProbePort}=require('./path-check.cjs');
const {GamePorts,allowedPort}=require('./ports.cjs');
const {GameDiscovery,discoveryMessage,localAnswer}=require('./discovery.cjs');
const newTraffic=()=>({tx:0,rx:0,broadcastTx:0,broadcastRx:0,blockedTx:0,blockedRx:0,lastBlockedTx:'',lastBlockedRx:'',relayed:0,queriesTx:0,queriesRx:0,answersTx:0,answersRx:0,matchedRx:0,adapterDrops:0,lastMatch:null});
function inspect(b,prefix){
  if(!Buffer.isBuffer(b)||b.length<28||b.length>1500||b[0]!==0x45||b.readUInt16BE(2)!==b.length||
     (b.readUInt16BE(6)&0xbfff)!==0||b.readUIntBE(12,3)!==ipv4Number(prefix+'.0')/256)return null;
  const tcp=b[9]===6;
  if(tcp){
    if(b.length<40 || (b[32]>>>4)<5 || (b[32]>>>4)*4+20>b.length)return null;
  }else if(b[9]!==17 || b.readUInt16BE(24)!==b.length-20)return null;
  const all=b.readUInt32BE(16)===0xffffffff, dst=all?255:b[19];
  if(!all&&b.readUIntBE(16,3)!==b.readUIntBE(12,3))return null;
  return {src:b[15],dst,sport:b.readUInt16BE(20),dport:b.readUInt16BE(22),proto:tcp?'TCP':'UDP',flags:tcp?b[33]:0};
}
class GameNetwork {
  constructor(room,changed,open=launch){
    this.room=room;this.changed=changed;this.open=open;this.ports=new GamePorts();this.queues=new Map();this.rates=new Map();
    this.pathCheck=new PathCheck({changed,onPort:port=>{if(this.phase==='ready')this.room.adapterReady(true,port);},peer:address=>{
      const r=this.room.active;
      return r?.roster.find(p=>p.device!==this.room.self()?.device && address===r.prefix+'.'+p.slot);
    }});
    this.discovery=new GameDiscovery();this.traffic=newTraffic();this.generation=0;this.phase='off';this.error='';
    this.seats=new Map();this.broadcastRates=new Map();
  }
  status(){return {phase:this.phase,error:this.error,reason:this.reason||'',traffic:{...this.traffic},ports:this.ports.description,
    path:{...this.pathCheck.result,port:this.pathCheck.port}};}
  setPorts(roomId,text){
    if(!roomId||this.room.active?.id!==roomId||this.room.active.waiting)throw Error(tr('Сначала войдите в игровую LAN.'));
    this.ports.set(text);this.discovery.clear();this.portsRoom=roomId;this.queues.clear();this.changed();
  }
  mine(){return this.room.active?.roster.find(p=>p.device===this.room.self()?.device);}
  reconcile(){
    if(this.errorRoom && this.errorRoom!==this.room.active?.id){this.errorRoom=null;this.error='';this.reason='';}
    const r=this.room.active;
    if(this.bound && (this.bound!==r?.id || this.address!==r.prefix+'.'+this.mine()?.slot))this.stop();
    const seats=new Map((r?.roster||[]).filter(p=>p.ready===true).map(p=>[p.slot,p.device]));
    if(this.seatRoom!==r?.id){
      this.ports.flows.clear();this.discovery.clear();this.queues.clear();this.rates.clear();this.broadcastRates.clear();this.traffic.lastMatch=null;
    }else{
      for(const [slot,device] of this.seats)if(seats.get(slot)!==device)this.revokeSeat(slot,device);
    }
    this.seatRoom=r?.id;this.seats=seats;
    if(this.portsRoom && this.portsRoom!==r?.id){this.ports.set('');this.portsRoom=null;}
  }
  revokeSeat(slot,device){
    this.ports.forgetSeat(slot);this.discovery.forgetSeat(slot);
    if(this.traffic.lastMatch?.seat===slot)this.traffic.lastMatch=null;
    this.queues.delete(device);
    // Other peers may already have a broadcast from the revoked slot queued.
    for(const q of this.queues.values())q.frames=q.frames.filter(b=>b[15]!==slot);
  }
  async start(repair=false){
    const r=this.room.active,me=this.mine();if(!r||!me||r.waiting)throw Error(tr('Сначала войдите в игровую LAN.'));
    if(this.phase==='ready'||this.phase==='starting')return;
    repair=repair===true&&this.reason==='stale'&&this.errorRoom===r.id;
    const address=r.prefix+'.'+me.slot;
    this.traffic=newTraffic();this.reason='';this.bound=r.id;this.address=address;const epoch=++this.generation;
    this.phase='starting';this.error='';this.changed();
    try{
      if(this.release)await this.release;
      if(epoch!==this.generation)return;
      let ranges;
      try{ranges=interfaceRanges(undefined,true);}catch{throw Error(tr('Не удалось проверить сетевые адаптеры. Повторите попытку.'));}
      if(overlaps(r.prefix,ranges)){
        const message=chooseFreePrefix(ranges)===null
          ? tr('Для игровой LAN нет свободной подсети на этом ПК. После смены сети повторите включение. Чат доступен.')
          : tr('Подсеть комнаты занята на этом ПК. Создайте новую игровую LAN с друзьями или повторите включение после смены сети.');
        throw Object.assign(Error(message),{code:'overlap'});
      }
      const adapter=await this.open({room:r.id,repair,ip:address,packet:b=>{if(epoch===this.generation)this.route(me.slot,b,true);},
        closed:()=>{if(epoch===this.generation){this.stop();this.error=tr('Игровой адаптер отключён.');this.changed();}},
        abort:fn=>{if(epoch===this.generation)this.abort=fn;else fn();}});
      if(epoch!==this.generation){adapter.close();return;}
      this.abort=null;this.adapter=adapter;this.phase='ready';this.room.adapterReady(true);this.pathCheck.open(address);this.changed();
    }catch(e){if(epoch!==this.generation)return;this.stop();this.error=e.message;this.errorRoom=r.id;this.reason=e.code;this.changed();throw e;}
  }
  stop(){
    this.pathCheck.close();clearTimeout(this.trafficTimer);this.trafficTimer=null;this.traffic=newTraffic();
    this.generation++;this.bound=null;this.address=null;this.reason='';this.errorRoom=null;const wasReady=this.phase==='ready';this.phase='off';this.error='';if(wasReady)this.room.adapterReady(false);
    const close=this.adapter?()=>this.adapter.close():this.abort;
    if(close){
      const release=close();
      if(release){
        const pending=Promise.resolve(release);
        this.release=pending;
        pending.then(()=>{if(this.release===pending)this.release=null;});
      }
    }
    this.abort=null;this.adapter=null;
    clearTimeout(this.timer);this.timer=null;this.queues.clear();this.ports.flows.clear();this.discovery.clear();this.rates.clear();this.broadcastRates.clear();this.changed();
    return this.release;
  }
  checkPeer(device){
    const r=this.room.active,p=r?.roster.find(x=>x.device===device);
    if(!p||p.device===this.room.self()?.device||this.phase!=='ready')throw Error(tr('Проверка сейчас недоступна.'));
    this.pathCheck.test(r.prefix+'.'+p.slot);
  }
  receive(card,m){
    const r=this.room.active;if(!r||r.waiting||r.id!==m.room||!Array.isArray(m.frames)||!m.frames.length||m.frames.length>12)return;
    const peer=r.roster.find(p=>p.id===card.id&&p.device===card.device);
    if(!peer||(r.host?peer.ready!==true:peer.slot!==1))return;
    const now=Date.now();let rate=this.rates.get(peer.slot);
    if(!rate||rate.until<=now){rate={until:now+1000,bytes:0};this.rates.set(peer.slot,rate);}
    for(const s of m.frames){
      if(typeof s!=='string'||s.length>2000||(rate.bytes+=s.length)>2*1024*1024)return;
      this.route(peer.slot,Buffer.from(s,'base64'),false);
    }
  }
  route(from,b,local){
    const r=this.room.active, me=this.mine();if(!r||!me)return;
    const h=inspect(b,r.prefix);if(!h||h.src===h.dst)return;
    const source=r.roster.find(p=>p.slot===h.src);if(source?.ready!==true)return;
    if((local||r.host)&&h.src!==from || !local&&!r.host&&h.src===me.slot)return;
    const broadcast=h.dst===255;
    const destination=broadcast?null:r.roster.find(p=>p.slot===h.dst);
    if(!broadcast&&destination?.ready!==true)return;
    if(!local&&!r.host&&!broadcast&&h.dst!==me.slot)return;
    const incomingHere=!local&&me.ready===true&&(broadcast||h.dst===me.slot);
    if(!local&&broadcast){
      let bucket=this.broadcastRates.get(h.src);
      if(!bucket){bucket=new TokenBucket(128,128);this.broadcastRates.set(h.src,bucket);}
      if(!bucket.take())return;
    }
    let replyTargets;
    const diagnostic=isProbePort(h.dport) || isProbePort(h.sport);
    const msg=!diagnostic&&h.proto==='UDP'?discoveryMessage(b.subarray(28),h):null;
    if(diagnostic){
      if(h.proto!=='UDP'||broadcast || !isProbePort(h.dport) || !isProbePort(h.sport) || !isProbe(b.subarray(28)))return;
      // A reserved port can belong to another application. Inject only into
      // our current socket, and relay only between declared peer bindings.
      const sport=source===me?this.pathCheck.port:peerProbePort(source);
      const dport=destination===me?this.pathCheck.port:peerProbePort(destination);
      if(h.sport!==sport||h.dport!==dport)return;
    }else{
      if(msg?.session?.blocked)return;
      const learned=h.proto==='UDP'&&!broadcast&&this.discovery.listener(h.src,h.dst,h.dport);
      let permitted;
      if(msg?.type==='answer'){
        // Validate before creating return flows, writing to the adapter or relaying.
        replyTargets=this.discovery.observe(msg,h);
        permitted=replyTargets.length>0;
      }else if(msg?.type==='query'){
        permitted=allowedPort(h.sport)&&allowedPort(h.dport)&&(msg.discoveryPort||this.ports.allows(h.proto,h.dport)||learned);
        if(permitted)this.discovery.observe(msg,h,r.roster);
      }else{
        permitted=this.ports.accepts(h,r.roster,learned);
      }
      if(!permitted){
        this.traffic[local?'blockedTx':'blockedRx']++;
        this.traffic[local?'lastBlockedTx':'lastBlockedRx']=h.proto+' '+h.dport;
        this.reportTraffic();return;
      }
      const query=replyTargets?.find(q=>q.seat===me.slot);
      const inject=incomingHere&&this.adapter&&(!replyTargets||query);
      const delivery=inject&&query?localAnswer(b,query,msg.session):b;
      const accepted=inject&&this.adapter.write(delivery)!==false;
      if(inject&&!accepted){this.traffic.adapterDrops++;this.reportTraffic();}
      if(local || accepted){
        this.traffic[local?'tx':'rx']++;
        if(broadcast)this.traffic[local?'broadcastTx':'broadcastRx']++;
        if(msg)this.traffic[(msg.type==='answer'?'answers':'queries')+(local?'Tx':'Rx')]++;
        if(accepted&&query){
          this.traffic.matchedRx++;
          if(msg.session){
            const offset=msg.session.addressOffset;
            this.traffic.lastMatch={seat:h.src,port:msg.session.port,build:msg.session.build,
              corrected:offset!==undefined&&!b.subarray(28+offset,32+offset).equals(b.subarray(12,16))};
          }
        }
        this.reportTraffic();
      }
    }
    if(diagnostic&&incomingHere)this.adapter?.write(b);
    if(!r.host&&!local)return;
    for(const p of r.roster){
      if(p.slot===me.slot||p.slot===from)continue;
      if(r.host&&p.ready!==true)continue;
      if(r.host?!broadcast&&p.slot!==h.dst:p.slot!==1)continue;
      const target=r.host&&replyTargets?.find(query=>query.seat===p.slot);
      if(r.host&&replyTargets&&!target)continue;
      let q=this.queues.get(p.device);
      if(!q){q={p,frames:[]};this.queues.set(p.device,q);}
      if(q.frames.length<48){
        const frame=target?localAnswer(b,target,msg.session):b;
        q.frames.push(frame);
      }
    }
    this.schedule();
  }
  reportTraffic(){
    if(this.trafficTimer)return;
    this.trafficTimer=setTimeout(()=>{this.trafficTimer=null;this.changed();},1000);
    this.trafficTimer.unref();
  }
  schedule(){if(this.queues.size&&!this.timer){this.timer=setTimeout(()=>this.flush(),12);this.timer.unref();}}
  flush(){
    this.timer=null;
    const r=this.room.active;
    for(const {p,frames} of this.queues.values()){
      const l=this.room.link(p);if(!r||!l||l.socket.writableLength>=65536){this.queues.delete(p.device);continue;}
      if(frames.length){
        const batch=frames.splice(0,12).map(b=>b.toString('base64'));
        if(l.send({kind:'game-packets',room:r.id,frames:batch})){this.traffic.relayed+=batch.length;this.reportTraffic();}
      }
      if(!frames.length)this.queues.delete(p.device);
    }
    this.schedule();
  }
}
module.exports={GameNetwork,inspect};
