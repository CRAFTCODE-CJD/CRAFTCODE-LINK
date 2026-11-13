'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash,randomBytes}=require('node:crypto');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const {UpdateService}=require('../src/update-service.cjs');
const {home,latestURL}=require('../src/github-releases.cjs');

const checksum=bytes=>createHash('sha256').update(bytes).digest('hex');
const version='1.2.0';
const prefixLength=128*1024+37;
const cdn='https://release-assets.githubusercontent.com';

async function until(condition,description){
  for(let i=0;i<400;i++){
    if(condition())return;
    await delay(40);
  }
  assert.fail('Timed out waiting for '+description);
}

// The updater follows its ordinary GitHub release flow. Only the HTTP destination
// is routed to loopback. Destroying a socket mid-response exercises actual fetch
// and filesystem behavior. Each redirect provides a new expiring CDN location.
async function interruptedDownload(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'link-resume-'));
  const payload=Buffer.concat([Buffer.from('MZ'),randomBytes(768*1024)]);
  const sha=checksum(payload),ranges=[],ticketRequests=[],delivered=[];
  let publishedSha=sha;
  const prefix=home+'/releases/download/v'+version+'/CRAFTCODE-LINK-'+version;
  let interruption,requests=0,metadataChecks=0,permitted=true;
  const server=http.createServer((req,res)=>{
    const requested=new URL(req.url,'http://localhost');
    if(requested.pathname===new URL(latestURL).pathname){
      metadataChecks++;
      res.writeHead(302,{Location:home+'/releases/tag/v'+version}).end();
    }else if(requested.pathname===new URL(prefix+'-SHA256SUMS.txt').pathname){
      res.writeHead(200).end(publishedSha+'  CRAFTCODE-LINK-'+version+'-Setup-x64.exe\n');
    }else if(requested.pathname===new URL(prefix+'-Setup-x64.exe').pathname){
      const ticket=req.method==='GET'?String(++requests):'size';
      res.writeHead(302,{Location:cdn+'/asset?ticket='+ticket}).end();
    }else if(requested.pathname==='/asset' && req.method==='HEAD'){
      res.writeHead(200,{'Content-Length':payload.length}).end();
    }else if(requested.pathname==='/asset' && req.method==='GET'){
      const ticket=requested.searchParams.get('ticket');
      ticketRequests.push(ticket);
      ranges.push(req.headers.range??null);
      if(ticket==='1'){
        interruption=res;
        res.writeHead(200,{'Content-Length':payload.length});
        res.write(payload.subarray(0,prefixLength));
        delivered.push(prefixLength);
      }else if(ticket==='2'){
        // Network is back but the CDN is still temporarily unavailable.
        res.writeHead(503).end();
      }else if(req.headers.range==='bytes='+prefixLength+'-'){
        const length=payload.length-prefixLength;
        res.writeHead(206,{
          'Content-Length':length,
          'Content-Range':'bytes '+prefixLength+'-'+(payload.length-1)+'/'+payload.length
        }).end(payload.subarray(prefixLength));
        delivered.push(length);
      }else res.writeHead(416,{'Content-Range':'bytes */'+payload.length}).end();
    }else res.writeHead(404).end();
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  const hubs=[];
  t.after(async()=>{
    for(const hub of hubs)hub.close();
    const closed=once(server,'close');
    server.close();
    server.closeAllConnections();
    await closed;
    await fs.rm(directory,{force:true,recursive:true,maxRetries:8,retryDelay:50});
  });
  let installed;
  function client(){
    const hub=new UpdateService({
      directory,cache:path.join(directory,'cache'),current:'1.1.0',supported:true,
      scheduled:true,allowed:()=>permitted,changed:()=>{},
      install:async file=>{installed=await fs.readFile(file);},
      fetcher:(url,options)=>{
        const target=new URL(url);
        assert.ok([new URL(home).origin,cdn].includes(target.origin));
        return fetch(origin+target.pathname+target.search,options);
      }
    });
    hubs.push(hub);
    return hub;
  }
  const first=client();
  assert.equal((await first.command({op:'check'})).phase,'available');
  const started=first.command({op:'download'});
  await until(()=>first.state().received===prefixLength,'prefix written to staging');
  interruption.destroy();
  await started;
  assert.equal(first.state().phase,'waiting');
  assert.equal(first.state().received,prefixLength);
  async function verify(hub){
    await until(()=>hub.state().phase==='ready','automatic range retry');
    assert.equal(installed,undefined,'installation requires a separate user action');
    await hub.command({op:'install'});
    assert.equal(checksum(installed),sha);
    assert.deepEqual(ticketRequests,['1','2','3']);
    assert.deepEqual(ranges,[null,'bytes='+prefixLength+'-','bytes='+prefixLength+'-']);
    assert.equal(delivered.reduce((sum,n)=>sum+n,0),payload.length);
  }
  return {first,client,verify,ranges,metadataChecks:()=>metadataChecks,
    permit(enabled){permitted=enabled;},
    replaceRelease(){publishedSha=checksum(Buffer.alloc(payload.length,0x23));},
    cacheFiles:()=>fs.readdir(path.join(directory,'cache'),{recursive:true}).catch(err=>{
      if(err.code==='ENOENT')return [];
      throw err;
    })
  };
}

test('One download action recovers after a broken TCP body and a temporary CDN outage',async t=>{
  const run=await interruptedDownload(t);
  await run.verify(run.first);
});

test('Restart revalidates a pending update and fetches only the missing bytes',async t=>{
  const run=await interruptedDownload(t);
  const before=run.metadataChecks();
  run.first.close();
  const second=run.client();
  await second.restore();
  await run.verify(second);
  assert.ok(run.metadataChecks()>before,'the new process revalidates the publisher release');
});

test('A changed publisher digest on restart clears the old partial and requires a new download action',async t=>{
  const run=await interruptedDownload(t);
  run.first.close();
  run.replaceRelease();
  const second=run.client();
  // Hold the real unlink at the filesystem boundary; consumers may request
  // state through IPC while the old partial still occupies disk space.
  const [partial]=await run.cacheFiles();
  assert.match(partial,/^installer-[0-9a-f]{64}-\d+\.part$/);
  let deleting=false;
  const gate=Promise.withResolvers();
  const unlink=fs.unlink.bind(fs);
  t.mock.method(fs,'unlink',async file=>{
    if(path.basename(file)===partial){deleting=true;await gate.promise;}
    return unlink(file);
  });
  await second.restore();
  try{
    await until(()=>deleting,'removal of the obsolete partial');
    assert.deepEqual(await run.cacheFiles(),[partial]);
    assert.equal((await second.command({op:'state'})).phase,'downloading');
  }finally{gate.resolve();await second.downloadTask;}
  await until(()=>second.state().phase==='available','new offer requiring user approval');
  assert.equal(second.state().received,0);
  assert.deepEqual(await run.cacheFiles(),[]);
  assert.deepEqual(run.ranges,[null]);
  await assert.rejects(second.command({op:'install'}),/Сначала скачайте проверенный установщик/);
});

test('An explicit cancel while offline forgets the transfer even after restarting',async t=>{
  const run=await interruptedDownload(t);
  await run.first.command({op:'cancel'});
  assert.equal(run.first.state().received,0);
  assert.equal(run.first.state().phase,'available');
  assert.deepEqual(await run.cacheFiles(),[]);
  run.first.close();
  const restarted=run.client();
  await restarted.restore();
  await delay(1400);
  assert.deepEqual(run.ranges,[null]);
  assert.equal(restarted.state().phase,'available');
});

test('Relay-only policy holds the partial without requests; restoring permission resumes automatically',async t=>{
  const run=await interruptedDownload(t);
  run.permit(false);
  run.first.policy();
  await delay(1400);
  assert.deepEqual(run.ranges,[null]);
  assert.equal(run.first.state().received,prefixLength);
  run.permit(true);
  run.first.policy();
  await run.verify(run.first);
});
