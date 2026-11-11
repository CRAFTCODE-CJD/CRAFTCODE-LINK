const {clickPath}=require('./qa-navigation.cjs');
// Exercise the bundled Strophe HTTPS transport with real UI sign-in and a local HTTP fixture.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron } = require(require.resolve('playwright',{paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || __dirname]}));
const {providers}=require('../src/renderer/providers.mjs');
const site=providers.jabberclub;
const root=fs.mkdtempSync(path.join(os.tmpdir(),'link-bosh-'));
let app;
(async()=>{
  app=await _electron.launch({executablePath:require('electron'),args:['--headless','--ozone-platform=headless','--no-sandbox',
    path.join(__dirname,'..'),'--craftlink-profile=bosh'],env:{...process.env,XDG_CONFIG_HOME:root}});
  const page=await app.firstWindow(), context=page.context(); page.setDefaultTimeout(20000);
  await context.routeWebSocket(providers.jabberru.service,ws=>ws.close({code:1012,reason:'QA unavailable'}));
  await context.routeWebSocket(site.service,ws=>ws.close({code:1012,reason:'QA unavailable'}));
  let probes=0,terminations=0,auth=0,bindings=0,password,announcements=0;
  const ns="http://jabber.org/protocol/httpbind";
  const headers={'content-type':'text/xml; charset=utf-8','access-control-allow-origin':'*','access-control-allow-headers':'Content-Type','access-control-allow-methods':'OPTIONS, POST'};
  await context.route(site.bosh,async route=>{
    const req=route.request(),xml=req.postData() || '';
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
    assert.equal(req.method(),'POST');
    let content='', attributes='';
    if(!/\bsid=/.test(xml)){
      probes++;
      attributes=" sid='fixture-session' from='jabber.club' hold='1' wait='5' requests='2' ver='1.6'";
      content="<stream:features xmlns:stream='http://etherx.jabber.org/streams'><mechanisms xmlns='urn:ietf:params:xml:ns:xmpp-sasl'><mechanism>PLAIN</mechanism></mechanisms></stream:features>";
    } else if(/type=['"]terminate/.test(xml)){terminations++;attributes=" type='terminate'";}
    else if(xml.includes('<auth ')){
      auth++;password=Buffer.from(xml.match(/<auth\b[^>]*>([^<]+)/)[1],'base64').toString().split('\0')[2];
      content="<success xmlns='urn:ietf:params:xml:ns:xmpp-sasl'/>";
    } else if(xml.includes('xmpp:restart=')){
      content="<stream:features xmlns:stream='http://etherx.jabber.org/streams'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'/></stream:features>";
    } else if(xml.includes('<iq ')){
      const id=xml.match(/<iq\b[^>]*\bid=['"]([^'"]+)/)[1];
      let body="<query xmlns='jabber:iq:roster'><item jid='friend@jabber.club' subscription='both'/></query>";
      if(xml.includes('xmpp-bind')){bindings++;body="<bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'><jid>trial@jabber.club/craftlink-fixture</jid></bind>";}
      content="<iq xmlns='jabber:client' type='result' id='"+id+"'>"+body+'</iq>';
    } else {
      if(xml.includes('<presence'))announcements++;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    await route.fulfill({headers,body:"<body xmlns='"+ns+"' "+attributes+'>'+content+'</body>'}).catch(()=>{});
  });
  await app.evaluate(({session})=>{
    const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(40)]);
    session.fromPartition('link-registration-check',{cache:false}).fetch=async url=>url.includes('captcha.php')?
      new Response(png,{headers:{'content-type':'image/png'}}):new Response('name="nickname" name="password_confirm" name="captcha_answer"',{headers:{'content-type':'text/html'}});
  });
  await page.reload();await clickPath(page,'#startCreate');
  await page.click('#serviceSummary');await page.selectOption('#xmppProvider','jabberclub');
  await page.waitForFunction(()=>document.querySelector('#providerStatus').textContent.includes('отвечают'));
  assert.equal(terminations,1);assert.equal(auth,0);
  console.log('PASS unavailable WebSocket: anonymous HTTPS registration probe checks XMPP and releases the BOSH session');
  await page.click('#alreadyCreated');await page.fill('#accountJid','trial@jabber.club');
  await page.fill('#accountPass','fixture-only');await page.click('#loginAccount');
  await page.waitForSelector('#saveCardBox',{timeout:30000});
  await page.waitForSelector('#internetRoster .contact-card');
  assert.equal(await page.textContent('#signedAddress'),'trial@jabber.club');
  assert.ok((await page.textContent('#internetRoster')).includes('friend@jabber.club'));
  assert.equal(auth,1);assert.equal(bindings,1);assert.equal(password,'fixture-only');
  assert.equal(probes,2);console.log('PASS Strophe sign-in falls back to the same provider over HTTPS, authenticates, binds and reads the roster');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(app)await app.close();fs.rmSync(root,{recursive:true,force:true});});
