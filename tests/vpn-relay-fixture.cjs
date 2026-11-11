// Two authorized coturn listeners: on the restricted side only TCP is listening.
// No OS route, proxy, firewall or real VPN configuration is modified.
const {spawn}=require('node:child_process'),{randomBytes}=require('node:crypto'),path=require('node:path');
exports.vpnFixture=(srv,tmp,restricted,toggle=false)=>{
  const secret=randomBytes(18).toString('hex'),children=[];
  const base=toggle?35906:restricted==='anna'?35904:35902;
  let flipped=false;
  for(const [index,protocol] of (toggle?['tcp','udp','udp']:['tcp','udp']).entries()){
    const port=base+index,low=50500+(base-35902)*100+index*80;
    const child=spawn(process.env.CCLINK_QA_TURN || 'turnserver',['-n','--listening-ip=127.0.0.1','--relay-ip=127.0.0.1',
      '--allow-loopback-peers',protocol==='tcp'?'--no-udp':'--no-tcp','--no-cli','--no-tls','--no-dtls','--no-multicast-peers','--relay-threads=1',
      '--lt-cred-mech','--realm=link.invalid','--user=local-qa:'+secret,'--listening-port='+port,'--min-port='+low,'--max-port='+(low+76),
      '--pidfile='+path.join(tmp,'pid'+port),'--userdb='+path.join(tmp,'db'+port),'--log-file='+path.join(tmp,'log'+port)],
      {stdio:'ignore',env:{...process.env,...(process.env.CCLINK_QA_TURN_LIB?{LD_LIBRARY_PATH:process.env.CCLINK_QA_TURN_LIB}:{})}});
    child.on('error',e=>console.error('Local coturn:',e.message));children.push(child);
  }
  let count=0;
  srv.servicesFor=jid=>{
    const limited=jid.startsWith(restricted+'@'),port=base+(limited?(toggle && !flipped?2:0):1);
    const transports=toggle && !flipped?['udp']:limited && ++count===1 && !toggle?[]:limited?['udp','tcp']:['udp'];
    return '<services xmlns="urn:xmpp:extdisco:2">'+transports.map(t=>
      '<service type="turn" host="127.0.0.1" port="'+port+'" transport="'+t+'" username="local-qa" password="'+secret+'"/>').join('')+'</services>';
  };
  return {async flip(){flipped=true;const child=children[2];const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await done;},close(){children.forEach(child=>child.kill());}};
};
