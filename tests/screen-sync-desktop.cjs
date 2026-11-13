const fs=require('node:fs'),os=require('node:os'),net=require('node:net'),path=require('node:path');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {testRuntime}=require('./electron-runtime.cjs');
const {_electron}=require(require.resolve('playwright',{paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||__dirname]}));
const {clickPath}=require('./qa-navigation.cjs');
const {pilot,installProbe,compareEvents}=require('./screen-sync-signals.cjs');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'link-sync-ui-')),apps=[];
const senderEntry=process.argv[2]?path.resolve(process.argv[2]):path.resolve(__dirname,'../src/entry.cjs');
const viewerEntry=process.env.LINK_AV_VIEWER_ENTRY?path.resolve(process.env.LINK_AV_VIEWER_ENTRY):senderEntry;
function appVersion(entry){return require(path.resolve(path.dirname(entry),'../package.json')).version;}
function optionalLimit(name){
 const raw=process.env[name];
 if(raw===undefined)return null;
 const value=Number(raw);
 assert(Number.isFinite(value) && value>0,name+' must be a positive number in milliseconds');
 return value;
}
async function open(label){
 const executable=testRuntime();
 const launchArgs=[path.join(__dirname,'screen-sync-bootstrap.cjs'),'--no-error-dialogs','--allow-loopback-in-peer-connection','--mute-audio','--use-fake-device-for-media-stream','--craftlink-profile='+path.basename(tmp)+'-'+label];
 const entry=label==='guest'?viewerEntry:senderEntry;
 const profile=path.join(tmp,label);fs.mkdirSync(profile);
 const app=await _electron.launch({executablePath:executable,args:launchArgs,env:{...process.env,QA_PROFILE_ROOT:profile,QA_APP_ENTRY:entry}});
 apps.push(app);
 const userData=await app.evaluate(({app})=>app.getPath('userData'));
 assert(userData.startsWith(profile+path.sep));
 const page=await app.firstWindow();page.setDefaultTimeout(20000);await page.click('#entryLater');return {app,page};
}
async function prepareDownload(hostApp,host,viewer,mib){
 const size=mib*1024**2,filename='timing-fixture.bin',source=path.join(tmp,filename);
 const hash=crypto.createHash('sha256'),block=Buffer.allocUnsafe(1024**2);
 const file=await fs.promises.open(source,'wx');
 try{
   for(let i=0;i<mib;i++){
     crypto.randomFillSync(block);
     await file.writeFile(block);
     hash.update(block);
   }
 }finally{await file.close();}
 const expected=hash.digest('hex');
 await hostApp.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},source);
 for(const page of [host,viewer]){
   if(await page.locator('#roomSidebar').isHidden())await page.click('#togglePanelBtn');
   const shelf=page.locator('#roomShelf');
   if(!await shelf.evaluate(el=>el.open))await shelf.locator('summary').click();
 }
 await host.click('#shelfOffer');
 const row=viewer.locator('#shelfItems .file-row').filter({hasText:filename});
 const download=row.getByRole('button',{name:/^(Скачать|Download)$/});
 await download.waitFor();
 return async()=>{
   const sample=()=>viewer.evaluate(async()=>{
     const stats=await qaPC.getStats(),rows=[...stats.values()].filter(s=>s.type==='inbound-rtp');
     const by=mid=>rows.find(s=>s.mid===mid);
     return {frames:by('1').framesDecoded,videoBytes:by('1').bytesReceived,soundBytes:by('2').bytesReceived,voiceBytes:by('0').bytesReceived};
   });
   const before=await sample(),start=Date.now();
   await download.click();
   await row.getByText(/Сохранено|Saved/).waitFor({timeout:180000});
   const end=Date.now(),after=await sample(),media={};
   for(const key of Object.keys(before)){media[key]=after[key]-before[key];assert(media[key]>0,'No concurrent '+key);}
   const downloads=path.join(tmp,'guest','downloads');
   const matches=fs.readdirSync(downloads,{recursive:true}).filter(name=>path.basename(name)===filename);
   assert.equal(matches.length,1);
   const target=path.join(downloads,matches[0]);
   assert.equal(fs.statSync(target).size,size);
   const received=crypto.createHash('sha256');
   for await(const chunk of fs.createReadStream(target))received.update(chunk);
   assert.equal(received.digest('hex'),expected);
   return {start,end,mib,seconds:(end-start)/1000,mibPerSecond:mib*1000/(end-start),sha256:expected,...media};
 };
}
(async()=>{try{
 const srv=net.createServer();await new Promise(r=>srv.listen(0,'127.0.0.1',r));const port=srv.address().port;await new Promise(r=>srv.close(r));
 const {app,page:host}=await open('host'),{page:g}=await open('guest');
 const safety=await host.evaluate(async()=>{
   const {protectedOutput}=await import('./audio.mjs');
   const context=new OfflineAudioContext(2,2048,48000);
   const pulse=context.createBuffer(2,1024,48000);
   pulse.getChannelData(0).fill(2);
   pulse.getChannelData(1).fill(-2);
   const source=context.createBufferSource();
   source.buffer=pulse;
   source.connect(protectedOutput(context,context.destination,'system').input);
   source.start();
   const output=await context.startRendering();
   const left=output.getChannelData(0),right=output.getChannelData(1);
   return {leftPeak:Math.max(...left),rightPeak:Math.min(...right),onsetFrames:left.findIndex(sample=>sample>.02)};
 });
 assert(safety.leftPeak>.1 && safety.leftPeak<=10**(-3/20)+.001);
 assert(safety.rightPeak<-.1 && safety.rightPeak>=-(10**(-3/20)+.001));
 assert(safety.onsetFrames>=0 && safety.onsetFrames<480);
 console.log('SCREEN LIMITER',JSON.stringify(safety));
 await Promise.all([host.evaluate(installProbe,{sender:true,pilot}),g.evaluate(installProbe,{sender:false,pilot})]);
 await g.evaluate(async()=>{
   const NativePC=RTCPeerConnection;window.RTCPeerConnection=class extends NativePC{constructor(...args){super(...args);window.qaPC=this;}};
   const {AudioMixer}=await import('./audio.mjs'),attach=AudioMixer.prototype.attach;
   AudioMixer.prototype.attach=async function(...args){await attach.apply(this,args);
     // Isolate the screen soundtrack in the final speaker mix. The synthetic
     // microphone still transmits and must advance on its own RTP receiver.
     if(args[1]==='voice')this.setSetting(args[0],'voice',{muted:true});
     if(args[1]==='system' && args[2] && !window.qaAnalyser){const gain=this.sources.get(args[0]+':system')?.gain;
     if(gain){const a=this.context.createAnalyser();a.fftSize=2048;a.smoothingTimeConstant=0;gain.connect(a);window.qaAnalyser=a;window.qaSystemTap(gain);}}};
 });
 await clickPath(host,'#createBtn');await host.click('#hubManual');await host.fill('#nameInput','Timing sender');await host.fill('#addressInput','127.0.0.1');await host.fill('#portInput',String(port));await host.click('#roomSubmitBtn');
 await host.waitForFunction(()=>document.querySelector('#inviteDialog').open);const invite=await host.inputValue('#inviteOutput');await host.click('#inviteDoneBtn');
 await clickPath(g,'#joinBtn');await g.fill('#hubCode',invite);await g.click('#hubEnter');await g.fill('#nameInput','Timing viewer');await g.click('#roomSubmitBtn');
 await host.waitForFunction(()=>document.querySelector('#participantsCount').textContent==='2 / 8');
 await host.exposeBinding('qaConsumeSelection',async()=>app.evaluate(({BrowserWindow})=>new Promise((res,rej)=>globalThis.qaDisplayRequest({frame:BrowserWindow.getAllWindows()[0].webContents.mainFrame,videoRequested:true},selection=>selection?.video?.name==='QA timing chart'?res(true):rej(Error('Test source was not selected'))))));
 await host.evaluate(()=>{navigator.mediaDevices.getDisplayMedia=async()=>{await window.qaConsumeSelection();const c=document.createElement('canvas');c.width=640;c.height=360;const g=c.getContext('2d');const draw=()=>{const code=Math.floor(Date.now()/10)%2048;
 g.fillStyle='#40484a';g.fillRect(0,0,c.width,c.height);for(let i=0;i<11;i++){g.fillStyle=(code&(1<<i))?'white':'black';g.fillRect(i*44,0,44,80);}window.qaDrawPulse(g,Date.now());};
 draw();const s=c.captureStream(30);const timer=setInterval(()=>{if(s.getVideoTracks()[0].readyState!=='live')return clearInterval(timer);draw();},32);return s;};});
 await host.click('#micBtn');await host.click('#shareBtn');await host.check('#withSystemAudio');await host.locator('#sourcesGrid .source-card').first().click();await host.click('#startShare');
 await host.waitForFunction(()=>document.querySelector('#broadcastStatus').dataset.audio==='on');
 await g.waitForFunction(()=>document.querySelector('#remoteVideo').videoWidth && !!window.qaAnalyser);
 await g.evaluate(()=>{const video=document.querySelector('#remoteVideo'),canvas=document.createElement('canvas');canvas.width=640;canvas.height=1;const scan=canvas.getContext('2d',{willReadFrequently:true});
 window.qaWindow=async()=>{
 const values=[];const until=performance.now()+900;while(performance.now()<until){await new Promise(r=>setTimeout(r,45));const n=Date.now();
 scan.drawImage(video,0,0,video.videoWidth,video.videoHeight/8,0,0,640,1);const pixels=scan.getImageData(0,0,640,1).data;
 let code=0;for(let i=0;i<11;i++)if(pixels[(i*44+22)*4]>128)code+=1<<i;
 const bins=new Float32Array(1024);window.qaAnalyser.getFloatFrequencyData(bins);let peak=1;for(let i=2;i<300;i++)if(bins[i]>bins[peak])peak=i;
 if(bins[peak]<-55)continue;const tone=Math.round((peak*48000/2048-400)/64);if(tone<0||tone>=96)continue;
 values.push((n-code*10+20480)%20480-((n-tone*100+9600)%9600)+50);}
 const report=await qaPC.getStats(),rows=[...report.values()].filter(s=>s.type==='inbound-rtp');
 const by=mid=>rows.find(s=>s.mid===mid);
 return {skew:values.sort((a,b)=>a-b)[Math.floor(values.length/2)],n:values.length,frames:by('1')?.framesDecoded,videoBytes:by('1')?.bytesReceived,voiceBytes:by('0')?.bytesReceived,soundBytes:by('2')?.bytesReceived};};});
 async function stagesBetween(start,end,{checkCoverage=true}={}){
   const [source,viewer,outputClock]=await Promise.all([
     host.evaluate(()=>qaPulseEvents()),g.evaluate(()=>qaPulseEvents()),g.evaluate(()=>qaOutputTiming())]);
   const stages=compareEvents({...source,...viewer},start,end);
   console.log('PULSES',JSON.stringify({stages,outputClock}));
   if(!checkCoverage)return stages;
   const expected=Math.floor((end-start)/pilot.period);
   for(const key of ['outputPictureMinusAudio','sourcePictureMinusAudio','receivedPictureMinusAudio']){
     assert(stages[key].n>=Math.max(3,Math.floor(expected*.8)),'Missing independent control signals: '+key);
   }
   return stages;
 }
 const stageSeconds=Number(process.env.LINK_AV_STAGE_SECONDS);
 if(process.env.LINK_AV_DOWNLOAD_MIB!==undefined)assert(Number.isInteger(stageSeconds),'LINK_AV_DOWNLOAD_MIB requires LINK_AV_STAGE_SECONDS');
 if(process.env.LINK_AV_STAGE_SECONDS!==undefined){
   assert(Number.isInteger(stageSeconds) && stageSeconds>=8 && stageSeconds<=600);
   const limits={p95Ms:optionalLimit('LINK_AV_P95_LIMIT_MS'),medianMs:optionalLimit('LINK_AV_MEDIAN_LIMIT_MS')};
   const mib=Number(process.env.LINK_AV_DOWNLOAD_MIB||0);
   assert(Number.isInteger(mib)&&mib>=0&&mib<=512,'Invalid download size');
   const transfer=mib?await prepareDownload(app,host,g,mib):null;
   if(transfer){
     // Measure on the same established call before the recipient starts saving the file.
     const warmupEnd=Date.now()+5000;
     while(Date.now()<warmupEnd)await g.evaluate(()=>qaWindow());
     const controlStart=Date.now();
     while(Date.now()-controlStart<stageSeconds*1000)await g.evaluate(()=>qaWindow());
     const control=await stagesBetween(controlStart,Date.now()-500);
     console.log('BEFORE DOWNLOAD',JSON.stringify(control.outputPictureMinusAudio));
   }
   const baseline=await g.evaluate(()=>qaWindow()),start=Date.now(),markerSkews=[];
   let fileResult,downloadError;
   const finished=transfer?.().then(result=>{fileResult=result;},e=>{downloadError=e;});
   let last=baseline;
   while(Date.now()-start<stageSeconds*1000 || (transfer && !fileResult)){
     if(downloadError)throw downloadError;
     const m=await g.evaluate(()=>qaWindow());
     assert(m.n>=4 && m.frames>last.frames && m.videoBytes>last.videoBytes && m.soundBytes>last.soundBytes && m.voiceBytes>last.voiceBytes,
       'Media stopped advancing: '+JSON.stringify({previous:last,current:m}));
     markerSkews.push(m.skew);last=m;
   }
   await finished;
   if(fileResult){
     const overlap=await stagesBetween(fileResult.start,fileResult.end-300,{checkCoverage:fileResult.end-fileResult.start>=5000});
     console.log('CONCURRENT DOWNLOAD',JSON.stringify({...fileResult,outputPictureMinusAudio:overlap.outputPictureMinusAudio}));
   }
   const stages=await stagesBetween(start,Date.now()-500);
   const nativeRead=await app.evaluate(()=>globalThis.qaReadAges());
   console.log('STAGES',JSON.stringify({version:appVersion(senderEntry),viewerVersion:appVersion(viewerEntry),utc:new Date(start).toISOString(),elapsedMs:Date.now()-start,limits,nativeRead,stages,markerSkews,frames:last.frames-baseline.frames,
     videoBytes:last.videoBytes-baseline.videoBytes,soundBytes:last.soundBytes-baseline.soundBytes,voiceBytes:last.voiceBytes-baseline.voiceBytes}));
   const output=stages.outputPictureMinusAudio;
   if(limits.p95Ms!==null)assert(output.p95Abs<=limits.p95Ms,'Final mix p95 |skew| '+output.p95Abs+' ms exceeds '+limits.p95Ms+' ms');
   if(limits.medianMs!==null)assert(Math.abs(output.median)<=limits.medianMs,'Final mix median skew '+output.median+' ms exceeds ±'+limits.medianMs+' ms');
   if(process.env.LINK_QA_CAPTURE_DIAGNOSTICS==='1'){
     await clickPath(host,'#networkHelpBtn');
     const report=host.locator('#mediaDiagnostics');
     await report.filter({hasText:'Опустошения очереди за трансляцию'}).waitFor();
     console.log('SENDER QUEUE',(await report.textContent()).split('\n').filter(line=>/очеред[ьи]/i.test(line)).join(' / '));
   }
   return;
 }
 const switchStart=Date.now();
 let worst=0;
 for(const [ms,count] of [[0,4],[2000,24],[0,24]]){
 await g.selectOption('#watchBuffer',String(ms));
 for(let i=0;i<count;i++){const m=await g.evaluate(()=>qaWindow());console.log('UI',JSON.stringify({ms,i,...m}));assert(m.n>=4 && m.frames>0 && m.voiceBytes>0 && m.soundBytes>0);worst=Math.max(worst,Math.abs(m.skew));}}
 console.log('MAXIMUM',worst);assert(worst<400);console.log('PASS UI switching with audio/video markers');
 const switchPulses=await stagesBetween(switchStart,Date.now()-500);
 assert(switchPulses.outputPictureMinusAudio.p95Abs<400,'Independent control detected a persistent switch drift');
 if(process.env.LINK_AV_HOLD_MINUTES){
   const minutes=Number(process.env.LINK_AV_HOLD_MINUTES);
   assert(Number.isInteger(minutes) && minutes>=1 && minutes<=540);
   const start=performance.now(),wallStart=Date.now(),baseline=await g.evaluate(()=>qaWindow()),windows=[];
   let previous=baseline;
   while(performance.now()-start<minutes*60000){
     const m=await g.evaluate(()=>qaWindow());
     assert(m.n>=4 && m.frames>previous.frames && m.videoBytes>previous.videoBytes &&
       m.soundBytes>previous.soundBytes && m.voiceBytes>previous.voiceBytes,'Receiver stopped advancing: '+JSON.stringify(m));
     assert(Number.isFinite(m.skew)&&Math.abs(m.skew)<400,'Excessive marker drift: '+JSON.stringify(m));
     windows.push(m.skew);previous=m;
     if(windows.length%30===0)console.log('HOLD',JSON.stringify({window:windows.length,...m}));
   }
   const ordered=windows.map(Math.abs).sort((a,b)=>a-b);
   const median=rows=>rows.slice().sort((a,b)=>a-b)[Math.floor(rows.length/2)];
   const stages=await stagesBetween(wallStart,Date.now()-500);
   console.log('PASS sustained playback',JSON.stringify({elapsedMs:Math.round(performance.now()-start),windows:windows.length,stages,
     first10Median:median(windows.slice(0,10)),last10Median:median(windows.slice(-10)),p95AbsoluteWindowMedian:ordered[Math.ceil(ordered.length*.95)-1],
     worstAbsoluteWindowMedian:ordered.at(-1),frames:previous.frames-baseline.frames,videoBytes:previous.videoBytes-baseline.videoBytes,
     voiceBytes:previous.voiceBytes-baseline.voiceBytes,soundBytes:previous.soundBytes-baseline.soundBytes}));
 }
}finally{await Promise.all(apps.map(a=>a.close().catch(()=>{})));fs.rmSync(tmp,{recursive:true,force:true,maxRetries:8,retryDelay:150});}})().catch(e=>{console.error(e);process.exitCode=1;});
