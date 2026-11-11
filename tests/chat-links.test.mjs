import test from 'node:test';
import assert from 'node:assert/strict';
import {splitAddresses,describeAddress,webAddress} from '../src/renderer/chat-address.mjs';
import links from '../src/chat-links.cjs';

test('link recognition preserves the message, punctuation and balanced paths',()=>{
  const text='Обсудим (github.com/CRAFTCODE-CJD/CRAFTCODE-LINK), https://example.org/W_(A). Ещё https://пример.рф/путь?x=2!';
  const parts=splitAddresses(text);
  assert.equal(parts.map(p=>p.text).join(''),text);
  assert.deepEqual(parts.filter(p=>p.href).map(p=>p.href),['https://github.com/CRAFTCODE-CJD/CRAFTCODE-LINK','https://example.org/W_(A)','https://xn--e1afmkfd.xn--p1ai/%D0%BF%D1%83%D1%82%D1%8C?x=2']);
  assert.equal(describeAddress(webAddress(parts[1].href)).resource,'CRAFTCODE-CJD/CRAFTCODE-LINK');
  for(const s of ['file://example.com/a','javascript:example.org','alice@example.org','team.ru@example.org','foo.com.unknown','https://user@foo.org','mailto:a@b.com','setup.exe','https://a.org\\bar']){
    assert(!splitAddresses(s).some(p=>p.href),s);
  }
});

test('chat previews only use fixed public APIs on request, and links open only via supported web schemes',async()=>{
  let handler,allow=false;const network=[],opened=[],played=[];
  links.registerChatLinks({handle:(name,h)=>{assert.equal(name,'chat-link');handler=h;},allowed:()=>allow,
    player:{open:id=>played.push(id)},openExternal:url=>opened.push(url),fetcher:async(url,opts)=>{
      network.push(url);assert.equal(opts.redirect,'error');assert.equal(opts.credentials,'omit');
      if(url.startsWith('https://i.ytimg.com/'))return new Response(Buffer.from([255,216,255,217]));
      return new Response(JSON.stringify({title:'Видео',author_name:'Автор',html:'unused',thumbnail_url:'http://127.0.0.1/probe'}));
    }});
  const target='https://youtu.be/dQw4w9WgXcQ?tracking=discard';
  await assert.rejects(handler({action:'describe',url:target}));assert.deepEqual(network,[]);
  allow=true;const result=await handler({action:'describe',url:target});
  assert.deepEqual(result,{title:'Видео',description:'Автор',thumbnail:'data:image/jpeg;base64,/9j/2Q=='});assert.equal(network.length,2);
  assert.equal(new URL(network[0]).hostname,'www.youtube.com');assert(!network[0].includes('tracking'));
  assert.equal(network[1],'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
  await assert.rejects(handler({action:'describe',url:'https://example.org/item'}));assert.equal(network.length,2);
  await handler({action:'play',url:target});assert.deepEqual(played,['dQw4w9WgXcQ']);
  await assert.rejects(handler({action:'play',url:'https://youtu.be.invalid/dQw4w9WgXcQ'}));
  allow=false;await assert.rejects(handler({action:'play',url:target}));assert.equal(played.length,1);
  for(const bad of ['file:///C:/a','ms-settings:','https://trusted.org@other.com','https://a.org\u202e/x']){
    await assert.rejects(handler({action:'open',url:bad}));
  }
  await handler({action:'open',url:target});assert.deepEqual(opened,[target]);
});

test('enabling strict mode aborts an in-flight preview',async()=>{
  let handler,allow=true,started;const ready=new Promise(r=>{started=r;});
  const service=links.registerChatLinks({handle:(_,fn)=>{handler=fn;},allowed:()=>allow,fetcher:(_url,{signal})=>
    new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});started();})});
  const pending=handler({action:'describe',url:'https://github.com/test/repo'});
  await ready;allow=false;service.policy();await assert.rejects(pending);
});
