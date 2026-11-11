import {protectedOutput} from './audio.mjs';
import {tr} from './locale.mjs';
// The desktop video stream is never a source of outgoing sound.
export function removeDisplayAudio(stream) {
  for (const track of stream.getAudioTracks()) {track.stop();stream.removeTrack(track);}
}

// Only the process-excluding Windows capturer feeds this graph. It has no microphone,
// remote-playback input or connection to a physical audio output.
export async function openProtectedAudio(api, token, signal, onFailed, volume = 100) {
  const context=new AudioContext({sampleRate:48000,latencyHint:'interactive',sinkId:{type:'none'}});
  let processor, track, closed=false;
  const close=()=>{
    if(closed)return;closed=true;signal.removeEventListener('abort',close);
    processor?.port.close();processor?.disconnect();track?.stop();
    if(context.state!=='closed')context.close().catch(()=>{});
    api.streamAudio('stop',token).catch(()=>{});
  };
  signal.addEventListener('abort',close,{once:true});
  try {
    if(signal.aborted)throw new Error(tr('Отменено.'));
    await context.audioWorklet.addModule(new URL('./stream-pcm.mjs',import.meta.url));
    if(closed)throw new Error(tr('Отменено.'));
    if(context.sampleRate!==48000)throw new Error(tr('Неподдерживаемая частота звука.'));
    const out=context.createMediaStreamDestination();
    processor=new AudioWorkletNode(context,'link-stream-pcm',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
    const gain=context.createGain();
    const setGain=value=>gain.gain.setTargetAtTime(Math.max(0,Math.min(2,value/100)),context.currentTime,0.012);
    gain.gain.value=Math.max(0,Math.min(2,volume/100));
    processor.connect(gain).connect(protectedOutput(context, out,'system').input);
    track=out.stream.getAudioTracks()[0];track.contentHint='music';
    const fail=()=>{if(!closed){close();onFailed();}};
    processor.onprocessorerror=fail;
    // Start sampling only once this graph can consume the very first packet.
    // A queued worklet read is delivered when its port handler is installed.
    await context.resume();
    if(closed)throw new Error(tr('Захват завершён.'));
    await api.streamAudio('start',token);
    if(closed)throw new Error(tr('Захват завершён.'));
    const timing={};
    processor.port.onmessage=async({data})=>{
      if(closed)return;
      try {
        if(data!=='read'){
          timing.peakQueueMs=Math.round(data.peakFrames/48);
          timing.droppedMs=Math.round(data.discardedFrames/48);
          timing.underruns=data.underruns;
        }
        const block=await api.streamAudio('read',token);
        if(!closed){const bytes=new Uint8Array(block);processor.port.postMessage(bytes,[bytes.buffer]);}
      } catch {fail();}
    };
    return {track,close,token,setGain,timing};
  } catch(e){close();throw e;}
}
