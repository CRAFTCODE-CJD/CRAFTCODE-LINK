// Integration fixture for SCTP interruption. The file bytes live in memory only in this fixture.
import {RoomFiles} from '../src/renderer/room-files.mjs';
import {RANGE} from '../src/renderer/file-ranges.mjs';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(ready){
  const limit=performance.now()+12000;
  while(!ready()){if(performance.now()>limit)throw Error('Timed out waiting for a file transfer');await delay(15);}
}
async function digest(bytes){
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
}
export async function recover(){
  const source=Uint8Array.from({length:4*1024*1024+37},(_,i)=>(i*31+(i>>>10))&255),sink=new Uint8Array(source.length);
  let first=true,unlock,releaseWithdrawn;
  const gate=new Promise(resolve=>{unlock=resolve;});
  const withdrawalGate=new Promise(resolve=>{releaseWithdrawn=resolve;});
  const errors=[],connections=[];
  const meta={id:crypto.randomUUID(),name:'build.zip',size:source.length,sha:await digest(source)};
  const withdrawn={...meta,id:crypto.randomUUID(),name:'withdrawn.zip'};
  const sender=new RoomFiles({selfId:'a',role:'host'},async r=>{
    if(r.op==='read-range'){
      if(first && r.pos>=RANGE)await gate;
      if(r.id===withdrawn.id && r.pos>=RANGE)await withdrawalGate;
      return source.slice(r.pos,r.pos+r.length);
    }
    if(r.op==='read')throw Error('Binary ranges expected in this fixture');
  },()=>{},error=>errors.push(String(error)));
  let started=0,position=0,partialBytes=0,cancelled=false;
  const viewer=new RoomFiles({selfId:'b',hostId:'a',role:'guest'},async r=>{
    if(r.op==='begin'){started++;return r.meta.id;}
    if(r.op==='cancel'&&r.id===withdrawn.id)cancelled=true;
    if(r.op==='put-range'){
      if(r.id===withdrawn.id){
        if(partialBytes!==r.pos)throw Error('Non-contiguous partial write');
        partialBytes+=r.bytes.length;return {pos:partialBytes};
      }
      if(position!==r.pos)throw Error('Non-contiguous disk write');
      sink.set(r.bytes,r.pos);position+=r.bytes.length;
      return {pos:position,done:position===sink.length,path:'build.zip'};
    }
  },()=>{},error=>errors.push(String(error)));
  async function connect(){
    const a=new RTCPeerConnection(),b=new RTCPeerConnection();connections.push(a,b);
    const ch=a.createDataChannel('link-files-v1');sender.attach('b',ch);
    b.ondatachannel=e=>viewer.attach('a',e.channel);
    // Full host candidates are sufficient on this machine. Wait for both descriptions before starting the data channel.
    async function describe(pc,sdp){
      await pc.setLocalDescription(sdp);await until(()=>pc.iceGatheringState==='complete');return pc.localDescription;
    }
    await b.setRemoteDescription(await describe(a,await a.createOffer()));
    await a.setRemoteDescription(await describe(b,await b.createAnswer()));
    await until(()=>viewer.entries.has(meta.id)&&viewer.bulk.has('a')&&sender.bulk.has('b'));
    return [a,b,ch];
  }
  try{
    sender.publish(meta);
    const [a,b,ch]=await connect();
    await viewer.start(viewer.entries.get(meta.id));
    await until(()=>position===RANGE);
    ch.close();await until(()=>!viewer.channels.has('a')&&!sender.channels.has('b'));a.close();b.close();
    const offset=position;first=false;unlock();
    const [nextA,nextB,nextChannel]=await connect();await until(()=>viewer.downloads.get(meta.id)?.final);
    const hash=await digest(sink);
    if(started!==1||hash!==meta.sha||errors.length)throw Error(JSON.stringify({started,hash,errors}));
    sender.publish(withdrawn);
    await until(()=>viewer.entries.has(withdrawn.id));
    await viewer.start(viewer.entries.get(withdrawn.id));
    await until(()=>partialBytes===RANGE);
    nextChannel.close();await until(()=>!viewer.channels.has('a')&&!sender.channels.has('b'));nextA.close();nextB.close();
    sender.withdraw(withdrawn.id);releaseWithdrawn();
    await connect();await until(()=>cancelled);
    if(started!==2||viewer.downloads.has(withdrawn.id)||!viewer.downloads.get(meta.id)?.final||errors.length)
      throw Error(JSON.stringify({started,cancelled,errors}));
    return {bytes:sink.length,resumedAt:offset,started,sha256:hash,withdrawnPartialBytes:partialBytes};
  }finally{unlock();releaseWithdrawn();sender.close();viewer.close();for(const pc of connections)pc.close();}
}
