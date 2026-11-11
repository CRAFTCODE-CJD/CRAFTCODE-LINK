// Read the signal of a local voice note at speech bandwidth. Only the short
// envelope is kept with the row once the decoded PCM has been sampled.
export function sampleEnvelope(buffer,bins=52){
  const samples=buffer.length;
  const peaks=new Float32Array(bins);
  for(let channel=0;channel<buffer.numberOfChannels;channel++){
    const pcm=buffer.getChannelData(channel);
    for(let i=0;i<samples;i++){
      const bin=Math.floor(i*bins/samples);
      peaks[bin]=Math.max(peaks[bin],Math.abs(pcm[i]));
    }
  }
  const loudest=Math.max(.02,...peaks);
  return {duration:buffer.duration,levels:Array.from(peaks,peak=>Math.sqrt(peak/loudest))};
}

export async function voiceEnvelope(blob,duration){
  // Voice recording is capped at ten minutes. Older WebMs can omit duration from
  // their header. The caller measures the local seekable range first.
  if(!(duration>0&&duration<=605)||!blob||blob.size>8*1024**2||!blob.type.startsWith('audio/'))return null;
  const decoder=new OfflineAudioContext(1,1,8000);
  const audio=await decoder.decodeAudioData(await blob.arrayBuffer());
  if(!audio.length||audio.duration>605)return null;
  return sampleEnvelope(audio);
}

export function waveDrawing(levels){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),height=28;
  svg.classList.add('voice-wave');svg.setAttribute('aria-hidden','true');
  svg.setAttribute('viewBox','0 0 '+levels.length*4+' '+height);
  svg.setAttribute('preserveAspectRatio','none');
  const path=document.createElementNS(svg.namespaceURI,'path');
  path.setAttribute('d',levels.map((level,i)=>{
    const half=Math.max(.75,level*(height/2-1));
    return 'M'+(i*4+2)+' '+(height/2-half)+'v'+half*2;
  }).join(' '));
  svg.append(path,path.cloneNode());return svg;
}
