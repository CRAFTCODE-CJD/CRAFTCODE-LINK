'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {LiveCameraConsent}=require('../src/files/live-camera-consent.cjs');

test('live camera permission belongs to a visible room generation and is single use without microphone',async()=>{
  const camera=new LiveCameraConsent();let generation=1,visible=true,prompts=0;
  const win={isDestroyed:()=>false,isVisible:()=>visible,isMinimized:()=>false};
  const context={window:()=>win,current:()=>generation===1,dialog:{showMessageBox:async()=>{prompts++;return{response:1};}}};
  visible=false;assert.equal(await camera.authorize(randomUUID(),context),false);assert.equal(prompts,0);
  visible=true;assert.equal(await camera.authorize(randomUUID(),context),true);assert.equal(camera.audioAllowed,false);
  generation++;assert.equal(camera.consume(),false);
  generation=1;assert.equal(await camera.authorize(randomUUID(),context),true);assert.equal(camera.consume(),true);assert.equal(camera.consume(),false);
  let finish;context.dialog.showMessageBox=()=>new Promise(resolve=>{finish=resolve;});
  const id=randomUUID(),pending=camera.authorize(id,context);camera.cancel(id);finish({response:1});
  assert.equal(await pending,false);assert.equal(camera.allowed(),false);
});

test('cancelled camera acquisition releases late tracks and never includes audio',async()=>{
  const {cameraCapture}=await import('../src/renderer/camera-capture.mjs');
  let finish,stopped=0,current=true,constraints,changes=0;
  const track={readyState:'live',stop(){this.readyState='ended';stopped++;},addEventListener(){}};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  const preview=cameraCapture({api:{liveCamera:async()=>true},current:()=>current,changed:()=>changes++,devices:{getUserMedia:options=>{constraints=options;return new Promise(resolve=>{finish=resolve;});}}});
  const pending=preview.open('fake-camera');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(constraints.audio,false);assert.deepEqual(constraints.video.deviceId,{exact:'fake-camera'});
  current=false;preview.stop();finish(stream);assert.equal(await pending,false);assert.equal(stopped,1);assert.equal(preview.stream,null);assert(changes>0);
});

test('camera publication transfers ownership while cancelled preview stops it',async()=>{
  const {cameraCapture}=await import('../src/renderer/camera-capture.mjs');
  let stops=0;const track={readyState:'live',stop:()=>stops++,addEventListener(){}};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  const preview=cameraCapture({api:{liveCamera:async()=>true},current:()=>true,changed:()=>{},devices:{getUserMedia:async()=>stream}});
  assert(await preview.open(''));assert.equal(preview.take(),stream);preview.stop();assert.equal(stops,0,'the call owns the committed track');
  assert(await preview.open(''));preview.stop();assert.equal(stops,1);
});

test('device enumeration stays inside the local grant and cancellation prevents acquisition',async()=>{
  const {cameraCapture}=await import('../src/renderer/camera-capture.mjs');
  let finish,granted=false,captures=0;
  const preview=cameraCapture({api:{liveCamera:async request=>{if(request.action==='ask')granted=true;return true;}},current:()=>true,changed:()=>{},
    devices:{enumerateDevices(){assert(granted);return new Promise(resolve=>{finish=resolve;});},getUserMedia(){captures++;throw Error('must not acquire after cancellation');}}});
  const pending=preview.open('');await new Promise(resolve=>setImmediate(resolve));preview.stop();
  finish([{kind:'videoinput',deviceId:'second',label:'Second camera'}]);assert.equal(await pending,false);assert.equal(captures,0);assert.deepEqual(preview.devices,[]);
});

test('picture in picture placement stays inside small and resized areas',async()=>{
  const {pipPosition}=await import('../src/renderer/camera-call-layout.mjs');
  for(const area of [{width:900,height:500},{width:270,height:140},{width:84,height:40}])for(const side of ['left','right'])for(const y of [-3,0,0.7,1,99]){
    const box={width:Math.min(200,area.width*.4),height:Math.min(125,area.height*.45)},p=pipPosition(area,box,{side,y});
    assert(p.x>=0&&p.y>=0);assert(p.x+box.width<=area.width);assert(p.y+box.height<=area.height);
  }
});
