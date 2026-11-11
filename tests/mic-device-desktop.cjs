'use strict';
// Optional QA dependency: FFmpeg with the flite speech source. No physical
// transducer is opened. Chromium's actual capture and APM remain in the path.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const {_electron} = require(require.resolve('playwright', {paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || __dirname]}));

function verifyStockCues() {
  for (const name of ['message','ring','joined','ended']) {
    const wav = path.join(__dirname,'../src/renderer/assets',name+'.wav');
    const pcm = execFileSync('ffmpeg',['-loglevel','error','-i',wav,'-ar','48000','-f','f32le','pipe:1']);
    const frames = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength/4);
    let peak = 0;
    for (const sample of frames) peak = Math.max(peak,Math.abs(sample));
    assert(peak > 0 && peak < .2, name + ' peak ' + peak);
    const edges = [...frames.slice(0,96),...frames.slice(-96)];
    assert(Math.max(...edges.map(Math.abs)) < .025, name + ' abrupt start or end');
    console.log('PASS stock cue '+name+' digital peak dBFS '+(20*Math.log10(peak)).toFixed(2));
  }
}

(async () => {
  verifyStockCues();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'craftcode-voice-'));
  let app;
  try {
    const speech = path.join(temp, 'quiet-speech.wav');
    execFileSync('ffmpeg', ['-loglevel','error','-f','lavfi','-i',
      'flite=text=This is a quiet microphone speaking to a friend. Can you hear my voice clearly today:voice=slt,volume=0.15,apad=pad_dur=0.4',
      '-ar','48000','-ac','1',speech]);
    app = await _electron.launch({executablePath:require('electron'), args:[
      '--headless','--ozone-platform=headless','--no-sandbox','--use-fake-device-for-media-stream',
      '--use-file-for-fake-audio-capture='+speech, path.join(__dirname,'..'),'--craftlink-profile=qa-mic-'+Date.now()]});
    const page = await app.firstWindow();
    await page.click('#entryLater');
    const result = await page.evaluate(async () => {
      const {Microphone, protectedOutput} = await import('./audio.mjs');
      const windows = [];
      const mic = new Microphone({onLevel(_level, measurement) { if(measurement) windows.push(measurement.rms); }});
      const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
      const prefs = {micGain:100, echoCancellation:false, noiseSuppression:false, autoGainControl:false};
      const modes = [];
      let before, latest;
      for (const [aec, ns, agc] of [[false,false,false],[false,false,true],[true,true,true],[true,false,false],[false,true,false]]) {
        Object.assign(prefs,{echoCancellation:aec, noiseSuppression:ns, autoGainControl:agc});
        const result = await mic.open(prefs);
        await result.releasePrevious();
        if (before && before.readyState!=='ended') throw Error('replaced input still live');
        mic.setMuted(false);
        before = mic.stream.getAudioTracks()[0];
        const actual = before.getSettings();
        prefs.micDevice = actual.deviceId;
        latest = result.track;
        await wait(1000);
        windows.length=0;
        await wait(agc || modes.length===0 ? 8500 : 3500);
        const sorted=windows.slice().sort((a,b)=>a-b);
        const activeDb=20*Math.log10(sorted[Math.floor(sorted.length*0.75)]);
        modes.push({requested:[aec,ns,agc],actual:[actual.echoCancellation,actual.noiseSuppression,actual.autoGainControl],activeDb});
      }
      let missing;
      try {await mic.open({...prefs, micDevice:'missing-qa-device'});} catch (e) {missing=e.name;}
      const closing=mic.close();
      const opening=mic.open(prefs);
      await closing;
      const replacement=await opening;
      await replacement.releasePrevious();
      const reopened=mic.outputTrack===replacement.track && mic.context.state==='running';
      await mic.close();
      const ctx = new OfflineAudioContext(2,48000,48000);
      const buffer = ctx.createBuffer(2,48000,48000);
      for(let ch=0;ch<2;ch++) {
        const data=buffer.getChannelData(ch);
        data[1000]=16; data[2000]=-16;
        for(let i=6000;i<14000;i++)data[i]=16*Math.sin(i*0.12);
        for(let i=20000;i<40000;i++)data[i]=((i%400)<200?1:-1)*16;
      }
      const src=ctx.createBufferSource();
      src.buffer=buffer;src.connect(protectedOutput(ctx,ctx.destination).input);src.start();
      const rendered=await ctx.startRendering();
      const peak=(start,end)=>Math.max(...Array.from(rendered.getChannelData(0).slice(start,end),Math.abs));
      const voiceCtx = new OfflineAudioContext(1,48000,48000);
      const scream = voiceCtx.createBufferSource();
      scream.buffer = buffer;
      scream.connect(protectedOutput(voiceCtx,voiceCtx.destination,'voice').input);
      scream.start();
      const voiceData = (await voiceCtx.startRendering()).getChannelData(0);
      const voicePeak = Math.max(...Array.from(voiceData, Math.abs));
      async function onset(afterPreview) {
        const ctx = new OfflineAudioContext(1, 18000, 48000);
        const voice = new Microphone();
        voice.context = ctx;
        voice.gate = ctx.createGain();
        voice.outputTrack = {enabled:false};
        const constant = ctx.createConstantSource();
        constant.connect(voice.gate).connect(ctx.destination);
        constant.start();
        if (afterPreview) {
          voice.muted = false;
          voice.previewPlaying = true;
          voice.setPreviewPlaying(false, 0.2);
        } else voice.setMuted(false);
        const samples = (await ctx.startRendering()).getChannelData(0);
        const offset = afterPreview ? 9600 : 0;
        return {before:afterPreview ? samples[offset-1] : samples[0], tenMs:samples[offset+480], ninetyMs:samples[offset+4320]};
      }
      return {unmute:await onset(false),afterPreview:await onset(true),voicePeak,modes,missing,reopened,stopped:latest.readyState==='ended'&&replacement.track.readyState==='ended',
        impulsePeak:peak(0,6000), sustainedPeak:peak(6000,48000)};
    });
    console.log('MEASURE '+JSON.stringify(result));
    for (const mode of result.modes) {
      assert.deepEqual(mode.actual,mode.requested);
      assert(Number.isFinite(mode.activeDb) && mode.activeDb>-85);
    }
    for (const transition of [result.unmute,result.afterPreview]) {
      assert(transition.before === 0 && transition.tenMs > .35 && transition.tenMs < .5 && transition.ninetyMs > .98);
    }
    assert(result.voicePeak>0.25 && result.voicePeak<=10**(-9/20)+0.00001);
    assert.equal(result.missing,'OverconstrainedError');
    assert(result.reopened && result.stopped);
    for (const peak of [result.impulsePeak,result.sustainedPeak]) assert(peak>0.5 && peak<=10**(-3/20)+0.00001);
    console.log('PASS actual Chromium device processing, replacement, cancellation and overloaded stereo output '+JSON.stringify(result));
  } finally {
    if(app) await app.close();
    await fs.rm(temp,{recursive:true,force:true});
  }
})().catch(e => {console.error(e);process.exitCode=1;});
