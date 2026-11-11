'use strict';

// The actual player and main-process handlers run against a loopback HTTPS
// origin. Only its DNS mapping, TLS trust, window display and OS URL handoff
// are fixtures. An independent UDP listener observes attempted STUN packets.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const net = require('node:net');
const dgram = require('node:dgram');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

async function desktop() {
  const { app, BrowserWindow, session, shell, dialog, Notification } = require('electron');
  const profile = process.env.LINK_SECURITY_FIXTURE;
  assert(profile && path.dirname(profile) === os.tmpdir());
  app.setPath('appData', profile);
  app.commandLine.appendSwitch('host-resolver-rules',
    'MAP * 127.0.0.1:' + process.env.LINK_SECURITY_TLS + ', EXCLUDE localhost, EXCLUDE 127.0.0.1');
  app.commandLine.appendSwitch('no-proxy-server');
  app.commandLine.appendSwitch('allow-loopback-in-peer-connection');
  const opened=[];
  shell.openExternal=async url=>{opened.push(url);};
  Notification.isSupported=()=>false;
  dialog.showErrorBox=(title,message)=>console.error(title,message);
  globalThis.fetch=async()=>new Response('',{status:404});
  async function exercise(main) {
    const local=source=>main.webContents.executeJavaScript(source);
    for(let i=0;i<80 && !await local('!!document.querySelector("#startDirect").onclick');i++)await delay(75);
    await local('window.craftlink.direct({op:"policy",strict:false})');
    const capture=script=>main.webContents.executeJavaScript(script,true);
    assert.equal(await capture('navigator.mediaDevices.getUserMedia({video:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return true;},()=>false)'),false);
    assert.equal(await capture('navigator.mediaDevices.getDisplayMedia({video:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return true;},()=>false)'),false);
    // Even a sibling with an identical URL and a deliberately supplied local
    // preload must not act as the app's main window.
    const sibling=new BrowserWindow({show:false,webPreferences:{preload:path.resolve(__dirname,'../src/preload.cjs'),sandbox:true,contextIsolation:true}});
    await sibling.loadFile(path.resolve(__dirname,'../src/renderer/index.html'));
    await assert.rejects(sibling.webContents.executeJavaScript('window.craftlink.environment()'),/source|источник/i);
    sibling.destroy();
    await local('window.craftlink.chatLink({action:"open",url:"https://example.invalid/choice"})');
    for(const url of ['file:///C:/Windows/system.ini','javascript:alert(1)','ms-settings:','data:text/html,hi','https://known.example@other.example/']){
      await assert.rejects(local('window.craftlink.chatLink('+JSON.stringify({action:'open',url})+')'));
    }
    assert.deepEqual(opened,['https://example.invalid/choice']);
    const playerSession=session.fromPartition('link-youtube',{cache:false});
    playerSession.setCertificateVerifyProc((request,reply)=>{
      const pinned=new (require('node:crypto').X509Certificate)(request.certificate.data).fingerprint256.replaceAll(':','').toLowerCase()===process.env.LINK_SECURITY_PIN;
      reply(pinned && ['www.youtube-nocookie.com','r1---sn-test.googlevideo.com'].includes(request.hostname) ? 0 : -2);
    });
    const url='https://youtu.be/dQw4w9WgXcQ';
    await local('window.craftlink.chatLink('+JSON.stringify({action:'play',url})+')');
    const win=BrowserWindow.getAllWindows().find(w=>w.webContents.session===playerSession);
    assert(win);
    const remote=code=>win.webContents.executeJavaScript('(async()=>{try{return {value:await ('+code+')}}catch(e){return {error:e.name+": "+e.message}}})()',true).then(result=>{
      if(result.error)throw Error(code.slice(0,120)+' -> '+result.error);
      return result.value;
    });
    assert.equal(await remote('document.title'),'Perimeter fixture');
    await remote('document.title="Account settings"');
    await delay(100);
    assert.equal(win.getTitle(),'YouTube · CRAFTCODE LINK');
    assert.equal(await remote('typeof window.craftlink + ":" + typeof require'),'undefined:undefined');
    assert.equal(await remote('window.open("https://example.invalid/elsewhere") === null'),true);
    assert.equal(await remote('navigator.mediaDevices.getUserMedia({audio:true,video:true}).then(()=>true,()=>false)'),false);
    assert.equal(await remote('Notification.requestPermission()'),'denied');
    assert.equal(await remote('fetch("https://other.example.invalid/private").then(()=>true,()=>false)'),false);
    assert.equal(await remote('fetch("/video-segment").then(r=>r.text())'),'fixture-segment');
    assert.equal(await remote('fetch("https://r1---sn-test.googlevideo.com/video-segment").then(r=>r.text())'),'fixture-segment');
    const frames=await remote('('+async function() {
      const video=document.createElement('video');video.muted=true;
      const clip=await fetch('https://r1---sn-test.googlevideo.com/clip.webm');
      const src=URL.createObjectURL(await clip.blob());video.src=src;
      try {await video.play();await new Promise(r=>setTimeout(r,180));return [video.videoWidth,video.getVideoPlaybackQuality().totalVideoFrames];}
      finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(src);}
    }+')()');
    assert.equal(frames[0],48);assert(frames[1]>0);
    const stun = 'stun:127.0.0.1:' + process.env.LINK_SECURITY_UDP;
    const turn = 'turn:127.0.0.1:' + process.env.LINK_SECURITY_TCP+'?transport=tcp';
    const ice = await remote('('+async function(stun,turn) {
      const pc=new RTCPeerConnection({iceServers:[{urls:stun},{urls:turn,username:'fixture',credential:'temporary'}]});
      try{
        pc.createDataChannel('network-probe');
        await pc.setLocalDescription(await pc.createOffer());
        await new Promise(resolve=>setTimeout(resolve,1600));
        return {state:pc.iceGatheringState,hostCandidate:/ typ host /.test(pc.localDescription.sdp)};
      } finally { pc.close(); }
    }+')('+JSON.stringify(stun)+','+JSON.stringify(turn)+')');
    console.log('Actual Chromium',process.versions.chrome,'isolated player ICE:',ice);
    await local('window.craftlink.direct({op:"policy",strict:true})');
    assert(win.isDestroyed());
    console.log('PASS exact sender and URL handoff, unselected screen/unauthorized camera denied, no bridge in third-party player, denied camera/mic, popup, notifications, unauthorized HTTPS, allowed CDN + decoded local video frames:',frames[1],'; strict policy closes player.');
  }
  app.on('browser-window-created',(_,win)=>{
    win.show=()=>{};win.showInactive=()=>{};win.focus=()=>{};
  });
  app.once('browser-window-created',(_,win)=>{
    win.webContents.once('did-finish-load',()=>exercise(win).then(()=>app.quit()).catch(e=>{console.error(e);app.exit(1);}));
  });
  require('../src/entry.cjs');
}

async function run() {
  const { createRoomCertificate }=require('../src/core/certificate.cjs');
  const cert=await createRoomCertificate();
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'link-perimeter-'));
  const requests=[],probe=dgram.createSocket('udp4');
  let stun=0,tcpConnections=0;
  probe.on('message',data=>{if(data.length>=20&&data.readUInt32BE(4)===0x2112a442)stun++;});
  const turn=net.createServer(socket=>{tcpConnections++;socket.destroy();});
  const server=https.createServer({key:cert.key,cert:cert.cert},(req,res)=>{
    requests.push([req.headers.host,req.url]);
    if(req.url==='/video-segment'){res.setHeader('Access-Control-Allow-Origin','*');res.end('fixture-segment');return;}
    if(req.url==='/clip.webm'){
      // Three solid-colour 48x32 VP8 frames generated with FFmpeg.
      res.writeHead(200,{'Access-Control-Allow-Origin':'*','Content-Type':'video/webm'});
      res.end(Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAICEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHGTbuMU6uEElTDZ1OsggEiTbuMU6uEHFO7a1OsggHs7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmoCrXsYMPQkBNgIRMYXZmV0GETGF2ZkSJiEB/QAAAAAAAFlSua9euAQAAAAAAAE7XgQFzxYgAAAAAAAAAAZyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAnvIargkLCBMLqBIJqBAlWwhFW5gQFV7oEA7AEAAAAAAAACAAASVMNn0HNzzWPAi2PFiAAAAAAAAAABZ8iYRaOHRU5DT0RFUkSHi0xhdmMgbGlidnB4Z8ihRaOIRFVSQVRJT05Eh5MwMDowMDowMC41MDAwMDAwMDAAH0O2dfDngQCjvYEAAIDwAgCdASowACAAAEcIhYWIhYSIAgICdaoD+AIHkcI+qoD++2iX/z0zXmD/Jz/9uR/tyP9uR/+2wgCjlYEApwCxAQAFEKwAGAAYWC/0AAiAAKOVgQFNALEBAAUQrAAYABhYL/QACIAAHFO7a5G7j7OBALeK94EB8YIBd/CBAw==','base64'));return;
    }
    res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end('<title>Perimeter fixture</title>');
  });
  try {
    await Promise.all([new Promise(r=>server.listen(0,'127.0.0.1',r)),new Promise(r=>probe.bind(0,'127.0.0.1',r)),new Promise(r=>turn.listen(0,'127.0.0.1',r))]);
    const env={...process.env,LINK_SECURITY_FIXTURE:temp,LINK_SECURITY_TLS:String(server.address().port),LINK_SECURITY_PIN:cert.fingerprint,LINK_SECURITY_UDP:String(probe.address().port),LINK_SECURITY_TCP:String(turn.address().port)};
    delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(require('electron'),[__filename,'--craftlink-profile=perimeter','--use-fake-device-for-media-stream','--mute-audio'],{env,stdio:'inherit',windowsHide:true});
    const timeout=setTimeout(()=>child.kill(),40000);
    try {assert.equal(await new Promise((r,j)=>{child.once('exit',r);child.once('error',j);}),0);}
    finally{clearTimeout(timeout);}
    assert(requests.some(([host])=>host==='www.youtube-nocookie.com'));
    assert(requests.every(([host])=>['www.youtube-nocookie.com','r1---sn-test.googlevideo.com'].includes(host)));
    console.log('Unauthorized loopback STUN datagrams:',stun,'TURN/TCP connections:',tcpConnections);
    assert.deepEqual([stun,tcpConnections],[0,0]);
  } finally {
    probe.close();turn.close();server.closeAllConnections();server.close();
    await fs.rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:120});
  }
}
(process.versions.electron?desktop():run()).catch(error=>{console.error(error);process.exitCode=1;});
