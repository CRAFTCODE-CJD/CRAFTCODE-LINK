'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createHash,randomBytes}=require('node:crypto');
const {download,partialSize,cleanupPartials,home}=require('../src/github-releases.cjs');

const data=Buffer.concat([Buffer.from('MZ'),randomBytes(256*1024)]),prefix=32*1024;
const version='1.2.3',name='CRAFTCODE-LINK-'+version+'-Setup-x64.exe';
const release={version,name,size:data.length,sha:createHash('sha256').update(data).digest('hex'),url:home+'/releases/download/v'+version+'/'+name};
const signal=()=>new AbortController().signal;
async function temp(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'link-download-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:100}));
  return dir;
}
const part=(start=prefix,end=data.length-1)=>new Response(data.subarray(start,end+1),{status:206,headers:{
  'Content-Range':`bytes ${start}-${end}/${data.length}`,'Content-Length':String(end-start+1)}});
async function cut(dir){
  await assert.rejects(download(release,dir,()=>new Response(data.subarray(0,prefix)),signal()),e=>e.retryable===true);
  assert.equal(await partialSize(dir,release),prefix);
}

test('A terminated HTTP socket resumes at the exact committed byte through a new connection and CDN redirect',async t=>{
  const dir=await temp(t),ranges=[],progress=[];
  let firstResponse;
  const server=http.createServer((req,res)=>{
    ranges.push(req.headers.range||null);
    if(ranges.length===1){
      res.writeHead(200,{'Content-Length':data.length});res.write(data.subarray(0,prefix));firstResponse=res;
    }else{
      assert.equal(req.headers.range,'bytes='+prefix+'-');
      res.writeHead(206,{'Content-Range':`bytes ${prefix}-${data.length-1}/${data.length}`,'Content-Length':data.length-prefix});
      res.end(data.subarray(prefix));
    }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const fetcher=(url,options)=>url===release.url?Response.redirect('https://release-assets.githubusercontent.com/file'):
    fetch('http://127.0.0.1:'+server.address().port,options);
  await assert.rejects(download(release,dir,fetcher,signal(),done=>{if(done===prefix)firstResponse.destroy();}),e=>e.retryable);
  assert.equal(await partialSize(dir,release),prefix);
  const ready=await download(release,dir,fetcher,signal(),(disk,network)=>progress.push([disk,network]));
  assert.deepEqual(ranges,[null,'bytes='+prefix+'-']);
  assert.deepEqual(progress[0],[prefix,0]);
  assert.deepEqual(progress.at(-1),[data.length,data.length-prefix]);
  assert.deepEqual(await fs.readFile(ready),data);
  assert.equal(await partialSize(dir,release),0);
});
test('A stalled but open socket keeps its prefix; steady byte arrivals outlast the inactivity budget',async t=>{
  const dir=await temp(t);
  const server=http.createServer((req,res)=>{
    res.writeHead(req.headers.range?206:200,req.headers.range?{'content-range':`bytes ${prefix}-${data.length-1}/${data.length}`,'content-length':data.length-prefix}:{'content-length':data.length});
    if(!req.headers.range){res.write(data.subarray(0,prefix));return;}
    let pos=prefix;
    const timer=setInterval(()=>{
      const end=Math.min(data.length,pos+prefix);
      res.write(data.subarray(pos,end));pos=end;
      if(end===data.length){clearInterval(timer);res.end();}
    },45);
    res.on('close',()=>clearInterval(timer));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const fetcher=(_url,opts)=>fetch('http://127.0.0.1:'+server.address().port,opts);
  const config={idleTimeoutMs:200};
  await assert.rejects(download(release,dir,fetcher,signal(),null,config),e=>e.retryable);
  assert.equal(await partialSize(dir,release),prefix);
  const ready=await download(release,dir,fetcher,signal(),null,config);
  assert.deepEqual(await fs.readFile(ready),data);
});
test('Ignored and unsatisfiable ranges restart with a full response, never appending a second prefix',async t=>{
  for(const status of [200,416]){
    const dir=await temp(t);await cut(dir);
    const requests=[],progress=[];
    const ready=await download(release,dir,(_url,opts)=>{
      requests.push(opts.headers.Range||null);
      return requests.length===1&&status===416?new Response(null,{status,headers:{'content-range':'bytes */'+data.length}}):new Response(data);
    },signal(),(disk,net)=>progress.push([disk,net]));
    assert.deepEqual(requests,status===416?['bytes='+prefix+'-',null]:['bytes='+prefix+'-']);
    assert.deepEqual(progress,[[prefix,0],[0,0],[data.length,data.length]]);
    assert.deepEqual(await fs.readFile(ready),data);
  }
});
test('An invalid range, total size, encoding or mixed content never becomes an installer',async t=>{
  const dir=await temp(t);
  const suffix=data.subarray(prefix);
  const start=prefix,end=data.length-1,total=data.length;
  const headers={'content-range':`bytes ${start}-${end}/${total}`};
  for(const response of [
    new Response(suffix,{status:206}),part(prefix-1),new Response(suffix,{status:206,headers:{'content-range':`bytes ${start}-${end-1}/${total+1}`}}),
    new Response(suffix,{status:206,headers:{...headers,'content-length':'1'}}),
    new Response(suffix,{status:206,headers:{...headers,'content-encoding':'gzip'}}),
    new Response(Buffer.alloc(suffix.length),{status:206,headers}),new Response(data,{status:200,headers}),
    new Response(null,{status:416,headers:{'content-range':'bytes */1'}})
  ]){
    await cut(dir);await assert.rejects(download(release,dir,()=>response,signal()),e=>e.code==='UPDATE_INVALID_PAYLOAD');
    assert.equal(await partialSize(dir,release),0);
    assert.equal((await fs.readdir(dir)).some(name=>name.startsWith('install-')),false);
  }
  await cut(dir);
  const file=(await fs.readdir(dir)).find(name=>name.endsWith('.part'));
  const h=await fs.open(path.join(dir,file),'r+');
  try{await h.write(Buffer.from([0]),0,1,12);}finally{await h.close();}
  await assert.rejects(download(release,dir,()=>part(),signal()),e=>e.code==='UPDATE_INVALID_PAYLOAD');
  assert.equal(await partialSize(dir,release),0);
});
test('Only matching private partials resume; cache cleanup preserves other files and refuses linked writes',async t=>{
  const dir=await temp(t);await cut(dir);
  const file=(await fs.readdir(dir)).find(name=>name.endsWith('.part'));
  const outside=path.join(await temp(t),'other'),other=path.join(dir,'user.part');
  await fs.writeFile(outside,'outside');await fs.writeFile(other,'user file');
  const partial=path.join(dir,file);
  await cleanupPartials(dir,release);assert.equal(await partialSize(dir,release),prefix);
  await fs.unlink(partial);await fs.link(outside,partial);
  await assert.rejects(download(release,dir,()=>assert.fail(),signal()),e=>e.code==='UPDATE_INVALID_PAYLOAD');
  assert.equal(await fs.readFile(outside,'utf8'),'outside');
  await cleanupPartials(dir);assert.equal(await fs.readFile(other,'utf8'),'user file');
  assert.equal(await fs.readFile(outside,'utf8'),'outside');
  const parent=await temp(t),junction=path.join(parent,'data');
  await fs.symlink(dir,junction,process.platform==='win32'?'junction':'dir');
  await assert.rejects(download(release,junction,()=>assert.fail(),signal()),e=>e.code==='UPDATE_INVALID_PAYLOAD');
});
test('A verified full partial finishes locally after restart; status errors and cancel preserve safe progress',async t=>{
  const dir=await temp(t);await cut(dir);
  for(const status of [408,429,500,503]){
    await assert.rejects(download(release,dir,()=>new Response(null,{status}),signal()),e=>e.retryable);
    assert.equal(await partialSize(dir,release),prefix);
  }
  const controller=new AbortController();
  await assert.rejects(download(release,dir,()=>{controller.abort();return part();},controller.signal),e=>e.name==='AbortError');
  assert.equal(await partialSize(dir,release),prefix);
  const file=(await fs.readdir(dir)).find(name=>name.endsWith('.part'));
  await fs.appendFile(path.join(dir,file),data.subarray(prefix));
  const ready=await download(release,dir,()=>assert.fail('Completed bytes already on disk'),signal());
  assert.deepEqual(await fs.readFile(ready),data);
});
