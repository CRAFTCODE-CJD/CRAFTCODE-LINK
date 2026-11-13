'use strict';
const {tr}=require('../native-language.cjs');
const {isProbePort}=require('./path-check.cjs');

const defaults=new Set([7000,7777,7778,7779,8086,8087,14001,16000,...Array.from({length:51},(_,i)=>27000+i)]);
const systemPorts=new Set([1900,2049,2869,3389,3702,5350,5351,5353,5355,5357,5358,5985,5986,47001]);
const allowedPort=n=>Number.isInteger(n) && n>=1024 && n<=65535 && !systemPorts.has(n) && !isProbePort(n);
function parsePorts(text){
  const invalid=()=>Error(tr('Введите до восьми правил TCP или UDP, не более 128 портов в сумме.'));
  if(typeof text!=='string'||text.length>180)throw invalid();
  const tokens=text.trim()?text.split(','):[];
  if(tokens.length>8)throw invalid();
  const extra=new Set(),rules=new Set();
  for(const token of tokens){
    const match=/^\s*(TCP|UDP)\s+([1-9]\d{0,4})(?:\s*[-–]\s*([1-9]\d{0,4}))?\s*$/i.exec(token);
    if(!match)throw invalid();
    const proto=match[1].toUpperCase(),first=Number(match[2]),last=Number(match[3]||match[2]);
    if(last<first || last-first>=128)throw invalid();
    for(let port=first;port<=last;port++){
      if(!allowedPort(port))throw Error(tr('Выберите игровой порт от 1024 до 65535. Служебные и диагностические порты зарезервированы.'));
      extra.add(proto+' '+port);
    }
    if(extra.size>128)throw invalid();
    rules.add(proto+' '+first+(first===last?'':'-'+last));
  }
  return {extra,description:[...rules].join(', ')};
}

class GamePorts{
  constructor(){this.extra=new Set();this.description='';this.flows=new Map();}
  set(text){
    const {extra,description}=parsePorts(text);
    this.extra=extra;this.description=description;this.flows.clear();
  }
  allows(proto,port){return allowedPort(port) && (proto==='UDP' && defaults.has(port) || this.extra.has(proto+' '+port));}
  remember(key,until){
    if(!this.flows.has(key)&&this.flows.size>=2048)this.flows.delete(this.flows.keys().next().value);
    this.flows.set(key,until);
  }
  forgetSeat(slot){
    for(const key of this.flows.keys()){
      const [,src,,dst]=key.split('/');
      if(Number(src)===slot||Number(dst)===slot)this.flows.delete(key);
    }
  }
  accepts(h,roster,learnedListener=false){
    const {proto,sport,dport,src,dst}=h;
    if(!allowedPort(sport)||!allowedPort(dport))return false;
    const key=(src,sport,dst,dport)=>[proto,src,sport,dst,dport].join('/');
    const direct=key(src,sport,dst,dport),now=Date.now(),broadcast=dst===255;
    // Generals and Zero Hour switch from lobby UDP 8086 to peer-to-peer
    // gameplay with both sockets bound to UDP 8088.
    const matchPeer=proto==='UDP'&&!broadcast&&sport===8088&&dport===8088;
    const matches=matchPeer||this.allows(proto,dport);
    if(proto==='TCP'){
      if(broadcast)return false;
      const reverse=key(dst,dport,src,sport);
      // Only an initial SYN may open a flow to a user-authorized listener.
      if(!(matches && (h.flags&0x17)===2) && !(this.flows.get(direct)>now))return false;
      if(h.flags&4){this.flows.delete(direct);this.flows.delete(reverse);}
      else{this.remember(direct,now+15*60000);this.remember(reverse,now+15*60000);}
      return true;
    }
    if(!matches&&!learnedListener){
      if(broadcast||!(this.flows.get(direct)>now))return false;
      const reverse=key(dst,dport,src,sport);
      if(this.flows.get(reverse)>now)this.remember(reverse,now+90000);
      return true;
    }
    if(learnedListener)this.remember(direct,now+90000);
    const destinations=broadcast?roster.filter(p=>p.ready===true&&p.slot!==src).map(p=>p.slot):[dst];
    for(const seat of destinations)this.remember(key(seat,dport,src,sport),now+90000);
    return true;
  }
}
module.exports={GamePorts,allowedPort};
