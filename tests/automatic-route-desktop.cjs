const {clickPath}=require('./qa-navigation.cjs');
// Real DTLS/SRTP across two local port mappings. Production public STUN is replaced
// at the browser boundary. XMPP sees normal SDP and only reachable mapped candidates.
'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'),path=require('node:path');
const {_electron}=require(require.resolve('playwright',{paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || __dirname]}));
const {providers}=require('../src/renderer/providers.mjs'),{Fixture}=require('./xmpp-fixture.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'link-nat-')),apps=[],errors=[],srv=new Fixture({});
const upgrade=process.argv.includes('--upgrade'),shaped=process.argv.includes('--shaped');
const product=process.env.CCLINK_QA_PRODUCT || path.join(__dirname,'..');
const wait=(p,id,value,ms=30000)=>p.waitForFunction(([id,value])=>document.getElementById(id).textContent.includes(value),[id,value],{timeout:ms});
const toggle=process.argv.includes('--vpn-toggle'),vpn=toggle || process.argv.includes('--vpn-tcp'),restricted=process.argv.includes('--vpn-host')?'anna':'boris';
let nat,stopRelay,candidates=[];
async function open(account){
  const app=await _electron.launch({executablePath:require('electron'),args:['--headless','--ozone-platform=headless','--no-sandbox','--allow-loopback-in-peer-connection','--use-fake-device-for-media-stream',product,'--craftlink-profile='+account],env:{...process.env,XDG_CONFIG_HOME:root}});
  apps.push(app);const p=await app.firstWindow();p.on('pageerror',e=>errors.push(e.message));
  await p.context().routeWebSocket(providers.jabberru.service,ws=>srv.route(ws,'jabber.ru'));
  await p.context().addInitScript(({port,upgrade,shaped,vpn,limited})=>{
    if(upgrade && localStorage.getItem('craftlink.settings.v1')===null)localStorage.setItem('craftlink.settings.v1',JSON.stringify({publicStun:false}));
    window.qaPeers=[];window.qaOffers=[];const Native=window.RTCPeerConnection;
    function local(cfg){
      window.qaOffers.push(cfg.iceServers.map(s=>s.urls));
      if(vpn)return {...cfg,iceTransportPolicy:limited?'relay':cfg.iceTransportPolicy,iceServers:cfg.iceServers.filter(s=>![].concat(s.urls).some(u=>u.startsWith('stun:')))};
      return {...cfg,iceServers:cfg.iceServers.map(s=>{
        if([].concat(s.urls).join()!=='stun:stun.cloudflare.com:3478')throw Error('Unexpected ICE service');
        return {urls:'stun:127.0.0.1:'+port};
      })};
    }
    window.RTCPeerConnection=class extends Native {
      constructor(cfg){super(local(cfg));window.qaPeers.push(this);}
      setConfiguration(cfg){super.setConfiguration(local(cfg));}
    };
    navigator.mediaDevices.getDisplayMedia=async()=>{
      const canvas=document.createElement('canvas');canvas.width=shaped?1280:320;canvas.height=shaped?720:180;
      const ctx=canvas.getContext('2d'),stream=canvas.captureStream(shaped?30:15);let n=0;
      const tile=document.createElement('canvas');tile.width=256;tile.height=160;
      const brush=tile.getContext('2d');let seed=167;
      const rand=()=>{seed=(seed*16807)%2147483647;return seed;};
      for(let i=0;i<700;i++){brush.fillStyle='hsl('+rand()%360+' 55% 45%)';brush.fillRect(rand()%256,rand()%160,3+rand()%30,3+rand()%26);}
      const pattern=ctx.createPattern(tile,'repeat');
      const timer=setInterval(()=>{if(stream.getVideoTracks()[0].readyState!=='live'){clearInterval(timer);return;}
        ctx.fillStyle=n++%2?'#a0c9ab':'#315748';ctx.fillRect(0,0,320,180);
        if(shaped){ctx.save();ctx.translate((n*13)%256,(n*3)%160);ctx.fillStyle=pattern;ctx.fillRect(-256,-160,1536,880);ctx.restore();}
      },shaped?33:70);
      return stream;
    };
  },{port:nat.port,upgrade,shaped,vpn,limited:account===restricted});
  await p.reload();await clickPath(p,'#startLogin');await p.fill('#accountJid',account+'@jabber.ru');await p.fill('#accountPass','fixture-password');await p.click('#loginAccount');await p.waitForSelector('#onlineActive');
  return p;
}
(async()=>{
  nat=await require('./nat-fixture.cjs').localNat();
  if(vpn)stopRelay=require('./vpn-relay-fixture.cjs').vpnFixture(srv,root,restricted,toggle);
  srv.filterPacket=(_from,_to,p)=>{
    if(p.data?.type!=='ice')return true;
    const line=p.data.candidate.candidate;candidates.push(line.match(/ typ (\w+)/)?.[1]);
    if(vpn)return / typ relay /.test(line);
    return / typ srflx /.test(line) || upgrade && / typ host /.test(line);
  };
  srv.transformPacket=(_from,p)=>{
    if(upgrade && p.data?.type==='ice' && / typ host /.test(p.data.candidate.candidate)){
      const fields=p.data.candidate.candidate.split(' ');fields[4]='192.0.2.1';p.data.candidate.candidate=fields.join(' ');
    }
    if(!vpn && p.data?.sdp)p.data.sdp=p.data.sdp.replace(/^a=candidate:[^\r\n]* typ (?!srflx)[^\r\n]*\r?\n/gm,'');
    return p;
  };
  const a=await open('anna'),b=await open('boris');
  await a.fill('#contactJid','boris@jabber.ru');await a.locator('#addContactForm button').click();
  await b.locator('#onlineRequests').getByRole('button',{name:'Добавить',exact:true}).click();
  for(const p of [a,b])await p.click('#closeInternet');
  const call=()=>a.locator('#workspaceContacts').getByRole('button',{name:'Позвонить'}).click();
  if(process.argv.includes('--missed')){
    await call();await b.waitForSelector('#hubAccept');
    await Promise.all([wait(a,'toast','Друг не ответил',36000),wait(b,'toast','Пропущенный вызов',36000)]);
    for(const p of [a,b])assert(await p.locator('#callDialog').isHidden());
    await wait(a,'participantsCount','0 / 8');assert(await b.locator('#shareBtn').isHidden());
    console.log('PASS Unanswered 30-second call closes on both desktops and releases the roster for a new call');
  }
  await call();await b.click('#hubAccept');
  await wait(b,'participantsCount','2 / 3');await a.click('#micBtn');
  await apps[0].evaluate(({desktopCapturer})=>{desktopCapturer.getSources=async()=>[{id:'screen:88:0',name:'Тестовый экран'}];});
  await a.click('#shareBtn');await a.click('#screenTabBtn');if(await a.isChecked('#withSystemAudio'))await a.uncheck('#withSystemAudio');
  await a.locator('#sourcesGrid .source-card').first().click();await a.click('#startShare');
  if(upgrade){
    await wait(b,'chatStatus','зашифровано');await wait(b,'stageTitle','Тестовый экран');
    // If Chromium exposes host addresses, the remote client sees an unreachable test address.
    // No production lookup is made until the owner of each old profile explicitly opts in.
    await Promise.all([a,b].map(p=>p.waitForSelector('#stageStun',{timeout:40000})));
    for(const p of [a,b])assert.deepEqual((await p.evaluate(()=>window.qaOffers))[0],[]);
    assert.equal(nat.stats().bindings,0);
    await Promise.all([a.click('#stageStun'),b.click('#stageStun')]);
  }
  await wait(b,'statusText','На связи',65000);
  for(const p of [a,b]){
    const configs=await p.evaluate(()=>window.qaOffers);
    if(!vpn)assert((upgrade?configs.flat():configs[0]).includes('stun:stun.cloudflare.com:3478'));
  }
  if(shaped)await require('./weak-link.cjs').run(a,b,nat);
  await clickPath(b,'#networkHelpBtn');
  const samples=await b.waitForFunction(()=>{
    const m=document.querySelector('#mediaDiagnostics').textContent.match(/Источник 0 · голос (\d+) Б · экран (\d+) Б · звук стрима \d+ Б · кадров декодировано (\d+)/);
    if(!m)return false;
    const next=m.slice(1).map(Number);const prev=window.qaLast;window.qaLast=next;
    return prev && prev.every((n,i)=>n>0 && next[i]>n)?[prev,next]:false;
  },null,{timeout:25000,polling:500});
  if(vpn){
    const limited=restricted==='anna'?a:b,other=limited===a?b:a;
    const transport=p=>p.evaluate(async()=>{
      const pc=window.qaPeers[0],r=await pc.getStats();
      const t=[...r.values()].find(x=>x.type==='transport' && x.selectedCandidatePairId);
      const c=r.get(r.get(t.selectedCandidatePairId).localCandidateId);
      return c.relayProtocol || c.protocol;
    });
    if(toggle){
      assert.equal(await transport(limited),'udp');
      const track=await b.locator('#remoteVideo').evaluate(v=>v.srcObject.getVideoTracks()[0].id);
      await stopRelay.flip();
      await apps[restricted==='anna'?0:1].evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('craftlink:event',{type:'network-route-changed'}));
      const until=async(read,timeout)=>{
        const end=Date.now()+timeout;
        while(Date.now()<end){const value=await read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,450));}
        throw Error('Timed out waiting for the live route to recover');
      };
      await until(async()=>await transport(limited).catch(()=>null)==='tcp',85000);
      const next=await until(()=>b.evaluate(async()=>{
        const r=await window.qaPeers[0].getStats(),v=[...r.values()].find(s=>s.type==='inbound-rtp' && s.mid==='1'),a=[...r.values()].find(s=>s.type==='inbound-rtp' && s.mid==='0');
        if(!a || !v)return false;
        const values=[a.bytesReceived,v.bytesReceived,v.framesDecoded],old=window.qaAfter;window.qaAfter=values;
        return old && values.every((x,i)=>x>old[i])?[old,values]:false;
      }),20000);
      assert.equal(await b.locator('#remoteVideo').evaluate(v=>v.srcObject.getVideoTracks()[0].id),track);
      console.log('PASS Live one-sided UDP-to-TCP route change; existing screen track and incoming RTP recovered',next);
    }
    assert.equal(await transport(limited),'tcp');assert.equal(await transport(other),'udp');
    if(limited!==b)await clickPath(limited,'#networkHelpBtn');
    if(!toggle)await wait(limited,'mediaDiagnostics','Резервный режим');
    assert.deepEqual(errors,[]);console.log('PASS One-sided UDP block, refreshed authorized TURN/TCP, other client UDP; active voice bytes, screen bytes, frames',restricted,await samples.jsonValue());return;
  }
  const stats=nat.stats();assert(stats.bindings>=2 && stats.forwarded>0 && candidates.includes('srflx'));
  assert.deepEqual(errors,[]);console.log('PASS',upgrade?'Existing opt-out, in-room consent and recovery of active tracks':'Automatic first-call STUN, no provider ICE services and no TURN',stats,await samples.jsonValue());
})().catch(async e=>{
  console.error(e.message,nat?.stats(),[...new Set(candidates)],errors);
  for(const app of apps){const p=app.windows()[0];if(!p)continue;console.error('ICE configs',await p.evaluate(()=>window.qaOffers),await p.textContent('#mediaDiagnostics'));}
  process.exitCode=1;
}).finally(async()=>{for(const app of apps)await app.close().catch(()=>{});stopRelay?.close();nat?.close();fs.rmSync(root,{recursive:true,force:true});});
