'use strict';
// Poll in the controlling process. A resolved Playwright handle alone does
// not demonstrate reception, decoding or audible samples.
module.exports = async function receivedVoice(page, mid) {
  let previous, last;
  for (let attempt=0;attempt<90;attempt++) {
    last=await page.evaluate(async mid => {
      const pc=window.qaConnections.at(-1);
      if(!pc || pc.connectionState!=='connected')return null;
      const report=await pc.getStats();
      const stat=[...report.values()].find(s=>s.type==='inbound-rtp' && s.mid===mid && s.kind==='audio');
      const track=pc.getTransceivers().find(tx=>tx.mid===mid)?.receiver.track;
      if(!stat || !track)return null;
      if(!window.qaMicMeter || window.qaMicMeter.track!==track) {
        await window.qaMicMeter?.context.close();
        const context=new AudioContext();await context.resume();
        const source=context.createMediaStreamSource(new MediaStream([track]));
        const analyser=context.createAnalyser(),silent=context.createGain();
        silent.gain.value=0;source.connect(analyser).connect(silent).connect(context.destination);
        window.qaMicMeter={context,track,analyser,buffer:new Float32Array(analyser.fftSize)};
      }
      const {analyser,buffer}=window.qaMicMeter;analyser.getFloatTimeDomainData(buffer);
      const rms=Math.sqrt(buffer.reduce((sum,n)=>sum+n*n,0)/buffer.length);
      return {mid,bytes:stat.bytesReceived,seconds:stat.totalSamplesDuration,rms};
    },mid);
    if(previous && last && last.bytes>previous.bytes && last.seconds>previous.seconds && last.rms>.005)
      return [previous,last];
    if(last?.seconds>0 && last.rms>.005)previous=last;
    await new Promise(resolve=>setTimeout(resolve,220));
  }
  const details=await page.evaluate(()=>({
    mic:document.querySelector('#micBtn')?.getAttribute('aria-pressed'),
    peers:window.qaConnections.map(pc=>({ice:pc.iceConnectionState,state:pc.connectionState,
      slots:pc.getTransceivers().map(t=>[t.mid,t.currentDirection])}))
  }));
  throw Error('No increasing decoded voice for '+mid+': '+JSON.stringify({last,details}));
};

// Use on isolated test pages only. The local audio graph produces a known
// non-silent stream even on a machine with no default recording device.
module.exports.installTestVoice = () => {
  navigator.mediaDevices.getUserMedia = async () => {
    const context=new AudioContext();await context.resume();
    const tone=context.createOscillator(),gain=context.createGain(),out=context.createMediaStreamDestination();
    tone.frequency.value=440;gain.gain.value=.2;tone.connect(gain).connect(out);tone.start();
    const track=out.stream.getAudioTracks()[0],stop=track.stop.bind(track);
    track.stop=()=>{stop();if(context.state!=='closed')context.close().catch(()=>{});};
    return out.stream;
  };
};
