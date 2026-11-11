import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createGraphics} from '../src/graphics.cjs';
import {outgoingScreens,videoFormat} from '../src/renderer/stream-inspector.mjs';

test('only CPU mode changes the encoder launch switch, pending changes are reversible and invalid values rejected',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cc-graphics-'));
 const flags=[];
 const app=Object.assign(new EventEmitter(),{getPath:()=>dir,commandLine:{appendSwitch:s=>flags.push(s)},getGPUFeatureStatus:()=>({video_encode:'disabled_software'}),isHardwareAccelerationEnabled:()=>true});
 try {
  const original=createGraphics(app);assert(original.snapshot().automatic);assert.equal(flags.length,0);assert.throws(()=>original.set('yes'));
  original.set(false);assert(original.snapshot().applied);assert.equal(flags.length,0);
  const next=createGraphics(app);assert(!next.snapshot().applied);assert.deepEqual(flags,['disable-accelerated-video-encode']);
  app.emit('gpu-info-update');assert.equal(next.snapshot().encode,'disabled_software');
  next.set(true);assert(createGraphics(app).snapshot().applied);assert.equal(flags.length,1);
  fs.writeFileSync(path.join(dir,'graphics.json'),'{bad');assert(createGraphics(app).snapshot().automatic);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('inspector selects only own fresh outbound tracks for each endpoint and separates zero from missing samples',()=>{
 const session={role:'guest',selfId:'guest',hostId:'host'};
 const peers=[{id:'host',slot:0,name:'Анна'},{id:'guest',slot:1,name:'Иван'},{id:'third',slot:2,name:'Борис'}];
 const now=Date.now(),sample={sampledAt:new Date(now).toISOString(),state:'connected',video:[
  {direction:'in',mid:'4',mbps:33},{direction:'out',mid:'1',mbps:28},{direction:'out',mid:'4',fps:24,width:1280,height:720,mbps:2.5,encoder:'test'}]};
 const stats=new Map([['host',sample]]);const view=()=>outgoingScreens(peers,session,stats,now-2000,now);
 assert.deepEqual(view(),[{name:'Анна',value:'1280 × 720 · 24 FPS · 2,5 Мбит/с',encoder:'test'}]);
 sample.video[2].mbps=0;assert.match(view()[0].value,/Новых видеоданных/);assert.equal(view()[0].encoder,null);
 sample.sampledAt=new Date(now-10000).toISOString();assert(!view()[0].value.includes('Мбит'));
 assert.equal(outgoingScreens([peers[1]],session,stats,now,now).length,0);
 assert.equal(videoFormat(1280,720,null),'1280 × 720');
});
