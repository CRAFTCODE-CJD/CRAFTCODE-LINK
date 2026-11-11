import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { loginAddress, loginProvider } from '../src/renderer/account-address.mjs';
import { makeCard, parseCard, readCard, writeCard } from '../src/friends/account-card.mjs';

test('login accepts a name, supported full address and a plain XMPP address URI',()=>{
 assert.equal(loginAddress(' Alex ','hotchilli'),'alex@jabber.hot-chilli.net');
 assert.equal(loginAddress('ALEX','jabberes'),'alex@jabberes.org');
 assert.equal(loginAddress('xmpp:Alex@openim.eu','jabberes'),'alex@openim.eu');
 assert.equal(loginProvider('Alex@jabberes.org'),'jabberes');
 for (const junk of ['https://jabber.hot-chilli.net/forms/create/','CL1:token','alex@example.org','xmpp:a@openim.eu?join','']) assert.throws(()=>loginAddress(junk,'hotchilli'));
});
test('new and old JIDs route only to their provider; a bare nickname needs an explicit service', () => {
 for (const [key, domain] of [['jabberclub','jabber.club'],['jabberru','jabber.ru'],['xmppjp','xmpp.jp'],['jix','jix.im'],['hotchilli','jabber.hot-chilli.net'],['jabberes','jabberes.org']]) {
   const id='alex@'+domain;
   assert.equal(loginAddress('alex',key),id);
   assert.equal(loginAddress(id,''),id);
   assert.equal(loginProvider(loginAddress(id,'jix')),key);
   assert.equal(parseCard(makeCard(id)),id);
 }
 for(const key of ['', 'constructor', '__proto__', 'unknown']) assert.throws(()=>loginAddress('alex',key));
 assert.equal(loginAddress('alex,one','jix'),'alex,one@jix.im');
 assert.throws(()=>loginAddress('alex@xmpp.jp.evil.example','xmppjp'));
});
test('card accepts only its version of the text header and a single supported public address',()=>{
 const id='ann@openim.eu',card=makeCard(id);
 assert.equal(parseCard('\uFEFF'+card),id);
 assert.equal(parseCard(card.replaceAll('\r\n','\n')),id);
 for (const invalid of [id,card+'Адрес: x@openim.eu',card.replace(id,id+'?token=bad'),card+'x'.repeat(4100)]) assert.throws(()=>parseCard(invalid));
 assert.throws(()=>makeCard('a@example.com'));
});
test('chosen card survives profile purge, while saves under the profile or into other file types are refused',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'link-card-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const profile=path.join(root,'profile'),dest=path.join(root,'моя карточка.txt');
 await fs.mkdir(profile);await fs.mkdir(path.join(profile,'cache'));
 for(const loc of [path.join(profile,'cache','x.txt'),path.join(root,'x.exe')]) await assert.rejects(writeCard(loc,'alex@jabberes.org',[profile]));
 await writeCard(dest,'alex@jabberes.org',[profile]);
 await fs.rm(profile,{recursive:true});assert.equal(await readCard(dest),'alex@jabberes.org');
 await fs.writeFile(dest,'x'.repeat(6000));await assert.rejects(readCard(dest));
});
