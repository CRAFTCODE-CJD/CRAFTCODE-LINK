// The private launcher supplies an isolated profile, a synthetic screen and a
// stereo PCM source. Startup errors must reach the test log without opening a dialog.
const path=require('node:path');
const {app,desktopCapturer,session,dialog,Notification,Tray} = require('electron');
if(!process.env.QA_PROFILE_ROOT || !process.env.QA_APP_ENTRY)throw Error('Launch via screen-sync-desktop.cjs');
dialog.showErrorBox=(title,message)=>process.stderr.write(title+' '+message+'\n');
Notification.isSupported=()=>false;
Tray.prototype.displayBalloon=()=>{};
app.setPath('appData',process.env.QA_PROFILE_ROOT);
const downloads=path.join(process.env.QA_PROFILE_ROOT,'downloads');
require('node:fs').mkdirSync(downloads,{recursive:true});
app.setPath('downloads',downloads);
app.on('browser-window-created',(_event,win)=>{win.show=()=>{};win.showInactive=()=>{};});
desktopCapturer.getSources=async()=>[{id:'screen:1:0',name:'QA timing chart'}];
app.whenReady().then(()=>{
  const original=session.defaultSession.setDisplayMediaRequestHandler.bind(session.defaultSession);
  session.defaultSession.setDisplayMediaRequestHandler=(handler,options)=>{globalThis.qaDisplayRequest=handler;return original(handler,options);};
});
const {ProtectedAudio}=require(path.join(path.dirname(process.env.QA_APP_ENTRY),'protected-audio.cjs'));
const {pilot}=require('./screen-sync-signals.cjs');
const {PassThrough}=require('node:stream');
const {EventEmitter}=require('node:events');
const delayMs=Number(process.env.LINK_AV_TEST_SOURCE_DELAY_MS || 0);
if(!Number.isInteger(delayMs) || Math.abs(delayMs)>800)throw Error('Invalid fixture delay');
function syntheticChild() {
  const started=Date.now();
  let frames=0, phase=0;
  const stdout=new PassThrough();
  const ages=new Map();
  let firstReadMs=null,readFrames=0,skippedFrames=0;
  globalThis.qaReadAges=()=>{
    const rows=[...ages].sort((a,b)=>a[0]-b[0]);
    const n=rows.reduce((sum,[,count])=>sum+count,0);
    const at=fraction=>{
      let sum=0;
      for(const [age,count] of rows){sum+=count;if(sum>=n*fraction)return age;}
      return null;
    };
    return {n,firstReadMs,medianMs:at(.5),p95Ms:at(.95),readFrames,skippedFrames};
  };
  const tick=()=>{
    // Supply complete 10 ms packets even if JS woke late. Windows produces
    // continuously and can have several packets ready after a scheduling stall.
    const end=Math.floor((Date.now()-started)/10)*480;
    if(end<=frames)return;
    const block=new Int16Array((end-frames)*2);
    for(let i=0;frames<end;frames++,i++){
      const ms=started+frames/48-delayMs,hz=400+64*(Math.floor(ms/100)%96);
      const tag=Math.floor(ms/pilot.period)%4, marker=ms%pilot.period<pilot.length ?
        4500*Math.sin(2*Math.PI*pilot.bins[tag]*(frames%pilot.fft)/pilot.fft) : 0;
      phase=(phase+2*Math.PI*hz/48000)%(2*Math.PI);
      block[i*2]=block[i*2+1]=Math.round(8000*Math.sin(phase)+marker);
    }
    stdout.write(Buffer.from(block.buffer));
  };
  let timer;
  const handshake=setImmediate(()=>{
    stdout.write(Buffer.from('CCPCM01\n'));
    tick();
    timer=setInterval(tick,8);
  });
  return Object.assign(new EventEmitter(),{stdout,stdin:new PassThrough(),
    recordRead(queuedAndReadBytes,bytesRead){
      // Compare the product's queue to the absolute position of the fixture.
      skippedFrames=frames-queuedAndReadBytes/4-readFrames;
      readFrames+=bytesRead/4;
      const age=Math.round(Date.now()-started-(frames-queuedAndReadBytes/4)/48);
      firstReadMs ??= age;
      ages.set(age,(ages.get(age)||0)+1);
    },
    kill(){clearImmediate(handshake);clearInterval(timer);stdout.end();}});
}
// Replace only the Windows capture child. The product owns all buffering,
// asynchronous reads and cleanup from the signature handshake onward.
const start=ProtectedAudio.prototype.start;
ProtectedAudio.prototype.start=function(...args){
  this.launch=syntheticChild;
  return start.apply(this,args);
};
const read=ProtectedAudio.prototype.read;
ProtectedAudio.prototype.read=async function(...args){
  const capture=this.current;
  const block=await read.apply(this,args);
  if(capture && capture===this.current && block.byteLength){
    capture.child.recordRead(capture.buffer.length+block.byteLength,block.byteLength);
  }
  return block;
};
require(process.env.QA_APP_ENTRY);
