'use strict';
// Three real renderers, SRTP and reproducible local UDP impairment. No public services.
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs');
const {_electron}=require(require.resolve('playwright',{paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||__dirname]}));
const {localNat}=require('./nat-fixture.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const nat=await localNat(),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'link-buffer-'));let app;
 try{
  const args=[path.join(__dirname,'qa-main.cjs'), '--link-qa-hidden', '--mute-audio', '--no-error-dialogs',
    '--user-data-dir='+path.join(tmp,'profile')];
  if(process.platform==='linux')args.unshift('--headless','--ozone-platform=headless','--no-sandbox');
  app=await _electron.launch({executablePath:process.env.LINK_QA_ELECTRON || require('electron'),args,timeout:30000,
    env:{...process.env,XDG_CONFIG_HOME:tmp}});
  for(let i=0;i<90&&app.windows().length<3;i++)await sleep(200);
  const pages={};for(const page of app.windows()){
   await page.waitForFunction(()=>document.readyState==='complete' && !!window.qaBridge);
   const id=await page.evaluate(()=>new URL(location.href).searchParams.get('id'));pages[id]=page;
   await page.evaluate(async()=>{window.lab=await import('./watch-buffer-lab.mjs');});
  }
  if(process.argv.includes('--file-recovery')){
    const result=await pages.host.evaluate(async()=>(await import('./file-recovery-lab.mjs')).recover());
    console.log('PASS SCTP file transfer resumed on a new peer connection',JSON.stringify(result));return;
  }
  const call=(id,method,...args)=>pages[id].evaluate(([method,args])=>window.lab[method](...args),[method,args]);
  const view=process.argv.includes('--reverse')?'g2':'g1';
  const other=view==='g2'?'g1':'g2';
  const all=Object.keys(pages);assert.equal(all.length,3);
  const switchTiming=process.argv.includes('--switch-timing');
  await Promise.all(all.map(id=>call(id,'init',nat.port,3,id!=='g2',switchTiming)));
  const roster=count=>Promise.all(all.slice().sort((a,b)=>(a==='host')-(b==='host')).map(id=>call(id,'roster',count)));
  await roster(2);
  await pages.host.waitForFunction(async()=>{try{return (await window.lab.stats(1)).screen.frames>10;}catch{return false;}},null,{timeout:45000});
  assert.equal((await call('host','watch','g1',1000)).forwarding,false);
  await pages.host.waitForFunction(()=>window.lab.targets()[0][4]===1000,null,{timeout:30000});
  await sleep(3500);
  const asHost=await call('host','observe',1,4200);
  console.log('HOST',JSON.stringify(asHost));
  assert(asHost.roles.screen.bufferMs>700 && asHost.roles.voice.bufferMs<300);
  await roster(3);
  assert.equal((await call('host','watch','g1')).forwarding,true);
  assert((await call('host','targets')).every(ts=>ts.every(v=>v===null)));
  for(const id of ['g1','g2'])await pages[id].waitForFunction(async()=>{try{return (await window.lab.stats(0)).screen.frames>10;}catch{return false;}},null,{timeout:45000});
  await pages.g2.waitForFunction(async()=>{try{return (await window.lab.stats(1)).screen.frames>30;}catch{return false;}});
  await sleep(5000);
  const relayed=await call('g2','observe',1,4000);
  console.log('FORWARDED',JSON.stringify(relayed));
  assert(relayed.roles.screen.frames>0 && relayed.roles.system.bytes>0 && relayed.videoMs<800);
  if(switchTiming){
    await require('./switch-timing.cjs').run({call,all});
    return;
  }
  if(process.argv.includes('--evening')){
    await require('./evening-session.cjs').run({app,call,all,tmp});
    return;
  }
  if(process.argv.includes('--soak')){
    const profile=await app.evaluate(({app})=>app.getPath('userData'));
    assert(profile.startsWith(tmp+path.sep));
    function footprint(){
      let bytes=0,files=0;
      function walk(dir){
        for(const item of fs.readdirSync(dir,{withFileTypes:true})){
          const file=path.join(dir,item.name);
          if(item.isDirectory())walk(file);
          else if(item.isFile()){
            assert(!/\.(webm|mp4|wav|mkv|y4m)$/i.test(item.name));
            try {bytes+=fs.statSync(file).size;files++;} catch(err){if(err.code!=='ENOENT')throw err;}
          }
        }
      }
      walk(profile);return {files,bytes};
    }
    const before=footprint(),initial=await call(view,'stats',0),start=Date.now();
    let maxBytes=before.bytes;
    for(const ms of [500,2000,0,1000,500,2000,0,1000,500,2000,1000,0]){
      await call(view,'watch','host',ms);
      await sleep(15000);
      const snap=footprint();maxBytes=Math.max(maxBytes,snap.bytes);
      assert(maxBytes-before.bytes<8*1024*1024,'on-disk profile grew unexpectedly');
    }
    const final=await call(view,'stats',0);
    assert(final.screen.frames-initial.screen.frames>2000);
    console.log('SOAK',JSON.stringify({seconds:Math.round((Date.now()-start)/1000),before,after:footprint(),maxBytes,receivedVideoBytes:final.screen.bytes-initial.screen.bytes,decodedFrames:final.screen.frames-initial.screen.frames}));
    console.log('PASS sustained RTP playback across 12 changes with bounded profile size.');return;
  }
  if(process.argv.includes('--outage-only')){
    const autoSlot=other==='g2'?1:0;
    await Promise.all([call(view,'selectShow',0,1000),call(other,'selectShow',autoSlot,0)]);
    await sleep(6500);
    const before=await call(view,'stats',0),autoBefore=await call(other,'stats',autoSlot);
    const oldDrops=nat.stats().dropped;
    nat.shape({offline:true});
    const interrupted=await call(view,'observe',0,3300);
    nat.shape(null);
    assert(nat.stats().dropped>oldDrops);
    assert(interrupted.longestPictureMs>900,'the outage should exhaust the buffer');
    await Promise.all([[view,0,before],[other,autoSlot,autoBefore]].map(([id,slot,baseline])=>
      pages[id].waitForFunction(async ([slot,baseline])=>{
        const s=await window.lab.stats(slot);
        return s.screen.frames>baseline.screen.frames+6 && s.voice.bytes>baseline.voice.bytes && s.system.bytes>baseline.system.bytes;
      },[slot,baseline],{timeout:30000})));
    await sleep(7500);
    const [recovered,automatic]=await Promise.all([call(view,'observe',0,4000),call(other,'observe',autoSlot,4000)]);
    for(const row of [recovered,automatic]){
      assert(row.issues.length===0 && row.samples>20);
      assert(row.roles.screen.frames>15 && row.roles.screen.bytes>0 && row.roles.voice.bytes>0 && row.roles.system.bytes>0);
    }
    assert(recovered.videoMs<1800 && recovered.voiceMs<800 && Math.abs(recovered.skewMs)<400);
    assert(Math.abs(automatic.skewMs)<400 && automatic.videoMs<800);
    const hostTargets=await call('host','targets');
    assert(hostTargets.every(ts=>ts.every((value,mid)=>mid%3!==1 || value===null)),'Host delayed a forwarded picture');
    console.log('OUTAGE',JSON.stringify({interrupted,recovered,automatic,hostTargets,dropped:nat.stats().dropped-oldDrops}));
    console.log('PASS playback, conversation and stream audio resumed after a complete 3.3-second interruption.');
    return;
  }
  async function run(label,buffer,shape,settle,duration){
    nat.shape(null);await call(view,'watch','host',buffer);await call(other,'watch','host',0);
    await sleep(settle);
    await pages[view].waitForFunction(value=>{
      const actual=window.lab.targets()[0][1];
      return value ? actual===value : actual===null || (Number.isFinite(actual) && actual>=0 && actual<=350);
    },buffer,{timeout:30000});
    const automatic=value=>value===null || (Number.isFinite(value)&&value>=0&&value<=350);
    const checkTargets=(targets,selectedBuffer)=>{
      for(const [mid,value] of targets.entries()){
        if(mid===1){assert(selectedBuffer?value===selectedBuffer:automatic(value));continue;}
        if(mid===2 && selectedBuffer){assert.equal(value,selectedBuffer);continue;}
        if(mid%3===1)assert.equal(value,null,'An unselected picture was delayed');
        else assert(value===null || value===(mid%3===0?60:80),'Unexpected audio target');
      }
    };
    checkTargets((await call(view,'targets'))[0],buffer);
    checkTargets((await call(other,'targets'))[0],0);
    nat.shape(shape);
    const [viewer,control]=await Promise.all([view,other].map(id=>call(id,'observe',0,duration)));
    for(const v of [viewer,control]){assert(v.samples>30);assert(v.roles.screen.frames>0 && v.roles.voice.bytes>0 && v.roles.system.bytes>0);}
    if(label==='burst' && buffer){
      assert(Math.abs(viewer.voiceMs-control.voiceMs)<230,'manual setting added conversation delay');
      assert(Math.abs(viewer.skewMs)<240,'film audio and picture drifted apart');
      assert(viewer.roles.screen.bufferMs>buffer*0.65,'requested video buffer did not build');
    }
    console.log('MEASURE',JSON.stringify({label,buffer,view,viewer,control}));nat.shape(null);
  }
  const quick=process.argv.includes('--quick'),modes=process.env.LINK_BUFFER_LEVELS?.split(',').map(Number)||[0,500,1000,2000];
  if(!quick)await run('clear',0,null,1000,6500);
  for(const value of modes){await run('burst',value,{holdMs:420,periodMs:1900},quick?4000:12000,quick?5000:12500);}
  if(!quick){await run('congested',1000,{mbps:1},5000,14000);await run('return-auto',0,null,10000,8000);}
  await call('g1','watch','g2',500);assert.equal((await call('g1','targets'))[0][1],null);
  await call('g1','watch',null);assert((await call('g1','targets'))[0].every(v=>[null,60,80].includes(v)));
  await roster(2);assert.equal((await call('host','watch','g1')).forwarding,false);
  await pages.host.waitForFunction(()=>window.lab.targets()[0][4]===1000,null,{timeout:30000});
  console.log('PASS real RTP; viewer controls, untouched voice/second viewer, forwarding guard, switching source and release.',nat.stats());
 }finally{await app?.close().catch(()=>{});nat.close();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
