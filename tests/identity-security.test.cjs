'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const tls=require('node:tls'),{once}=require('node:events');
const {setTimeout:delay}=require('node:timers/promises');
const {Duplex}=require('node:stream');
const {seed,publicCard,friend}=require('../src/direct/identity.cjs');
const {fingerprint,security}=require('../src/direct/identity-verification.cjs');
const {ContactLink}=require('../src/direct/links.cjs');
const {createRoomCertificate}=require('../src/core/certificate.cjs');

const profile=name=>({name,root:seed(),device:seed()});
async function wait(check,timeout=5000){
  const end=Date.now()+timeout;
  while(!check()){assert(Date.now()<end,'fixture deadline');await delay(10);}
}

test('public comparison fingerprints change with either identity and never certify a plaintext transport',()=>{
  const a=publicCard(profile('A')),b=publicCard(profile('B')),c=publicCard(profile('A'));
  assert.equal(fingerprint(a.id,b.id),fingerprint(b.id,a.id));assert.notEqual(fingerprint(a.id,b.id),fingerprint(c.id,b.id));
  assert.throws(()=>fingerprint(a.id,a.id));assert.throws(()=>fingerprint(a.id.toUpperCase(),b.id));
  const peer=friend(b,'friend'),link={route:'lan',card:b,socket:{destroyed:false}};
  const s={me:a,profile:{},store:{},contact:()=>peer,blocked:()=>false,linksTo:()=>[link]};
  assert.equal(security(s,b.id).connection,'unverified');assert.deepEqual(security(s,b.id).transports,[]);
  link.contactStatus='offline';assert.equal(security(s,b.id).connection,'offline');assert(!security(s,b.id).devices[0].active);
  s.paused=true;assert.throws(()=>security(s,b.id));s.paused=false;peer.state='invited';assert.throws(()=>security(s,b.id));
});

test('a TLS-terminating relay cannot replay either valid signed hello on its other TLS connection',async t=>{
  const credentials=await createRoomCertificate(),a=profile('A'),b=profile('B'),sockets=[];
  let authenticated=0,applications=0,connections=0;
  const bind=s=>s.exportKeyingMaterial(32,'CRAFTCODE LINK LAN').toString('hex');
  const endpoints=[];
  const server=tls.createServer({key:credentials.key,cert:credentials.cert,minVersion:'TLSv1.3'},socket=>{
    sockets.push(socket);endpoints.push(bind(socket));
    new ContactLink(socket,'lan',bind(socket),a,publicCard(b).id,publicCard(b).device,
      ()=>authenticated++,()=>applications++,()=>{});
  });
  const proxy=tls.createServer({key:credentials.key,cert:credentials.cert,minVersion:'TLSv1.3'},socket=>{
    sockets.push(socket);connections++;
    const outbound=tls.connect({host:'127.0.0.1',port:server.address().port,minVersion:'TLSv1.3',rejectUnauthorized:false});
    sockets.push(outbound);outbound.on('error',()=>{});socket.on('error',()=>{});
    outbound.once('secureConnect',()=>socket.pipe(outbound).pipe(socket));
    outbound.once('close',()=>socket.destroy());socket.once('close',()=>outbound.destroy());
  });
  t.after(async()=>{
    for(const socket of sockets)socket.destroy();
    await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>proxy.close(resolve))]);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
  // Grant the attacker a trusted transport certificate in this fixture. The
  // independent application identity check must still detect the split channel.
  const client=tls.connect({host:'127.0.0.1',port:proxy.address().port,minVersion:'TLSv1.3',rejectUnauthorized:false});
  sockets.push(client);await once(client,'secureConnect');endpoints.push(bind(client));
  new ContactLink(client,'lan',bind(client),b,publicCard(a).id,publicCard(a).device,
    ()=>authenticated++,()=>applications++,()=>{});
  await wait(()=>client.destroyed);
  assert.equal(connections,1);assert.equal(endpoints.length,2);assert.notEqual(endpoints[0],endpoints[1]);
  assert.equal(authenticated,0);assert.equal(applications,0);
});

test('installed Noise IK and secretstream encrypt authenticated LINK payloads across a raw relay',async t=>{
  const SecretStream=require('@hyperswarm/secret-stream'),a=profile('A'),b=profile('B');
  const wire=[];
  let first,second;
  const raw=other=>new Duplex({read(){},write(data,_encoding,done){
    const bytes=Buffer.from(data);wire.push(Buffer.from(bytes));setImmediate(()=>{if(!other().destroyed)other().push(bytes);done();});
  }});
  first=raw(()=>second);second=raw(()=>first);
  const akeys=SecretStream.keyPair(Buffer.from(a.device,'hex')),bkeys=SecretStream.keyPair(Buffer.from(b.device,'hex'));
  const x=new SecretStream(true,first,{pattern:'IK',keyPair:akeys,remotePublicKey:bkeys.publicKey});
  const y=new SecretStream(false,second,{pattern:'IK',keyPair:bkeys});
  x.on('error',()=>{});y.on('error',()=>{});t.after(()=>{x.destroy();y.destroy();first.destroy();second.destroy();});
  await Promise.all([once(x,'open'),once(y,'open')]);
  assert.deepEqual(x.handshakeHash,y.handshakeHash);
  const accepted=[],received=[];
  const left=new ContactLink(x,'dht',x.handshakeHash.toString('hex'),a,publicCard(b).id,publicCard(b).device,
    l=>accepted.push(l),(_l,m)=>received.push(m),()=>{});
  new ContactLink(y,'dht',y.handshakeHash.toString('hex'),b,publicCard(a).id,publicCard(a).device,
    l=>accepted.push(l),(_l,m)=>received.push(m),()=>{});
  await wait(()=>accepted.length===2);
  const plaintext='fixture private text '+seed();left.send({kind:'test',text:plaintext});await wait(()=>received.length);
  assert.equal(received[0].text,plaintext);assert(!Buffer.concat(wire).includes(Buffer.from(plaintext)));
  const s={me:publicCard(a),profile:{},store:{},contact:()=>friend(publicCard(b),'friend'),blocked:()=>false,linksTo:()=>[left]};
  assert.equal(security(s,publicCard(b).id).connection,'encrypted');assert.deepEqual(security(s,publicCard(b).id).transports,['Noise']);
});

test('the actual private HyperDHT network reports authenticated Noise for both LINK devices',{timeout:60000},async t=>{
  const {EventEmitter}=require('node:events'),Udx=require('udx-native');
  const interfaces=[{name:'lo',family:4,address:'127.0.0.1',host:'127.0.0.1',internal:true}];
  t.mock.method(Udx.prototype,'networkInterfaces',()=>interfaces);
  t.mock.method(Udx.prototype,'watchNetworkInterfaces',()=>Object.assign(new EventEmitter(),{interfaces,destroy(){}}));
  const network=await require('hyperdht/testnet')(6),services=[];
  t.after(async()=>{await Promise.all(services.map(service=>service.stop()));await network.destroy();});
  const {DirectService}=require('../src/direct/service.cjs');
  const a={...profile('A'),friends:[],dht:true,lan:''},b={...profile('B'),friends:[],dht:true,lan:''};
  a.friends=[friend(publicCard(b),'friend')];b.friends=[friend(publicCard(a),'friend')];
  for(let current of [a,b]){
    const service=new DirectService({store:{read:()=>current,write:value=>{current=value;}},
      dhtFactory:()=>network.createNode({firewalled:false}),nics:()=>[]});
    services.push(service);service.start();service.network.startDht(true);
  }
  await wait(()=>services.every(service=>[...service.links].some(link=>link.contactStatus==='online')),45000);
  for(const service of services){
    const report=security(service,service.profile.friends[0].id);
    assert.equal(report.connection,'encrypted');assert.deepEqual(report.transports,['Noise']);
    assert.equal(report.devices.length,1);assert(report.devices[0].active);
    assert.equal(report.verifiedAt,null);
  }
});
