'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter, once} = require('node:events');
const net = require('node:net');
const {createHmac, randomBytes} = require('node:crypto');
const {setImmediate: tick} = require('node:timers/promises');
const {supervise} = require('../src/game/windows.cjs');
const {GameNetwork} = require('../src/game/network.cjs');

function deferred() {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
}
function setup() {
  const started = deferred();
  const proc = new EventEmitter();
  proc.kill = () => {};
  let cancel;
  const adapter = supervise({packet() {}, closed() {}, abort(fn) {cancel = fn;}}, (port, token) => {
    started.resolve({port, token});
    return proc;
  });
  return {adapter, cancel, started: started.promise, proc};
}
async function connectHelper(started) {
  const {port, token} = await started;
  const socket = net.connect({host:'127.0.0.1', port, allowHalfOpen:true});
  const nonce = randomBytes(32);
  const proof = label => createHmac('sha256', Buffer.from(token, 'hex')).update(label).update(nonce).digest();
  socket.write(Buffer.concat([nonce, proof('helper')]));
  let received = Buffer.alloc(0);
  for (;;) {
    const [part] = await once(socket, 'data');
    received = Buffer.concat([received, part]);
    if (received.length >= 32) break;
  }
  assert.deepEqual(received, proof('app'));
  return socket;
}
test('a late approval after cancellation cannot attach to a retired listener', async () => {
  const s = setup(), {port} = await s.started;
  const failure = assert.rejects(s.adapter);
  await s.cancel();
  await failure;
  const socket = net.connect(port, '127.0.0.1');
  const [err] = await once(socket, 'error');
  assert.equal(err.code, 'ECONNREFUSED');
});
test('an authenticated helper reports a busy adapter or overlapping subnet before readiness', async () => {
  for (const [code, error] of [['busy',/уже используется/],['overlap',/Подсеть занята/],['driver-create:5',/не создала/],['driver-file:2',/wintun/]]) {
    const s = setup(), socket = await connectHelper(s.started);
    const rejected = assert.rejects(s.adapter,{message:error,code});
    socket.write(Buffer.concat([Buffer.from([0,code.length]),Buffer.from(code)]));
    await rejected;
    socket.end();
    await s.cancel();
  }
});
test('declining elevation is distinct from a helper startup error', async () => {
  for(const [status,code] of [[23,'cancelled'],[24,'access-denied'],[1,'launcher']]){
    const s=setup();
    await s.started;
    const failure=assert.rejects(s.adapter,{code});
    s.proc.emit('exit',status);
    await failure;
  }
});
test('disabling waits for the authenticated helper to release its resource', async () => {
  const s = setup(), socket = await connectHelper(s.started);
  socket.write(Buffer.alloc(2));
  const adapter = await s.adapter;
  const eof = once(socket, 'end');
  let released = false;
  const closing = adapter.close().then(() => {released = true;});
  await eof;
  assert.equal(released,false);
  socket.end();
  await closing;
  assert.equal(released,true);
});
test('reading the Windows prompt leaves a fresh startup timeout for the driver', async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const s=setup();
  await s.started;
  t.mock.timers.tick(110000);
  const socket=await connectHelper(s.started);
  t.mock.timers.tick(80000);
  socket.write(Buffer.alloc(2));
  const adapter=await s.adapter;
  socket.end();
  await adapter.close();
});
function room() {
  const me = {device:'here', slot:1};
  return {active:{id:'A', prefix:'10.213.251', roster:[me]}, self:()=>me, states:[], adapterReady(ready){this.states.push(ready);}};
}
test('a double click starts once and a late result cannot revive a departed room', async t => {
  t.mock.method(require('node:os'),'networkInterfaces',()=>({}));
  const r = room(), finish = deferred();
  let starts = 0, cancels = 0, closes = 0;
  const n = new GameNetwork(r,()=>{},({abort})=>{starts++;abort(()=>{cancels++;});return finish.promise;});
  const first = n.start();
  await n.start();
  assert.equal(starts,1);
  r.active = null;
  n.reconcile();
  finish.resolve({close(){closes++;}});
  await first;
  assert.deepEqual([n.phase,cancels,closes,r.states.length],['off',1,1,0]);
});
test('quick reactivation waits for cleanup; leaving during the wait cancels the queued start', async t => {
  t.mock.method(require('node:os'),'networkInterfaces',()=>({}));
  const r = room(), releasing = deferred();
  let opens = 0, closes = 0;
  const n = new GameNetwork(r,()=>{},async()=>{opens++;return {close(){closes++;return releasing.promise;}};});
  await n.start();
  n.stop();
  const cancelled = n.start();
  n.stop();
  const next = n.start();
  await tick();
  assert.deepEqual([opens,closes],[1,1]);
  releasing.resolve();
  await Promise.all([cancelled,next]);
  assert.deepEqual([opens,closes,r.states],[2,1,[true,false,true]]);
  n.stop();
});

test('only an authenticated stale result for this room enables repair',async t=>{
  t.mock.method(require('node:os'),'networkInterfaces',()=>({}));
  const r=room(), attempts=[];
  const n=new GameNetwork(r,()=>{},async({repair})=>{
    attempts.push(repair);
    if(attempts.length<3)throw Object.assign(Error('Stale'),{code:'stale'});
    return {close(){}};
  });
  await assert.rejects(n.start(true),{code:'stale'});
  r.active.id='B';n.reconcile();assert.equal(n.status().reason,'');
  await assert.rejects(n.start(true),{code:'stale'});
  await n.start(true);
  assert.deepEqual(attempts,[false,false,true]);
  assert.equal(n.status().phase,'ready');n.stop();
});

test('an in-room address change releases the old binding and requires a fresh local start',async t=>{
  t.mock.method(require('node:os'),'networkInterfaces',()=>({}));
  for(const change of [r=>{r.active.prefix='10.213.252';},r=>{r.active.roster[0].slot=2;}]){
    const r=room(), addresses=[];
    let closes=0;
    const n=new GameNetwork(r,()=>{},async({ip})=>{
      addresses.push(ip);
      return {close(){closes++;}};
    });
    t.after(()=>n.stop());
    await n.start();
    change(r);
    n.reconcile();
    assert.equal(n.phase,'off');
    assert.equal(closes,1);
    assert.equal(n.pathCheck.result.state,'off');
    await n.start();
    assert.deepEqual(addresses,['10.213.251.1',r.active.prefix+'.'+r.active.roster[0].slot]);
  }
});

test('Windows lifecycle inspection requires a successful inventory and the LINK PnP device in the expected state',
  {skip:process.platform!=='win32'},()=>{
    const path=require('node:path');
    const shell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const result=require('node:child_process').spawnSync(shell,
      ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'windows-game-lan-state.ps1')],
      {encoding:'utf8',windowsHide:true,timeout:15000});
    assert.ifError(result.error);
    assert.equal(result.status,0,result.stderr);
  });
