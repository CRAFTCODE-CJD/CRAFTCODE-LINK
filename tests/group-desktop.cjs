'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {addFriend} = require('./room-controls-desktop.cjs');

const button = (page, scope, name) => page.locator(scope).getByRole('button', {name, exact:true});
const file = (page, name) => page.locator('#groupFiles .group-file').filter({has:page.getByText(name, {exact:true})});
async function submit(page) {
  await page.click('#groupEditSubmit');
  await page.waitForFunction(() => !document.querySelector('#groupEdit').open);
}
async function closeManager(page) {
  if (await page.locator('#groupManage').evaluate(el => el.open)) await page.click('#groupManageClose');
}
async function invite(page, name, recipient) {
  await page.click('#groupMembersButton');
  await button(page, '#groupManage', 'Пригласить друга').click();
  await page.selectOption('#groupField-person', {label:name});
  await submit(page); await closeManager(page);
  await recipient.click('#navGroups');
  await button(recipient, '#groupInvites', 'Принять').click();
  await recipient.locator('#groupInput:enabled').waitFor();
}
async function memberAction(page, name, action) {
  await page.click('#groupMembersButton');
  const row = page.locator('#groupManage .group-member').filter({has:page.getByText(name, {exact:true})});
  await row.locator('button[data-group-member]').click();
  await page.selectOption('#groupField-what', action);
  await page.click('#groupEditSubmit');
  await page.click('#confirmYesBtn');
  await page.waitForFunction(() => !document.querySelector('#groupEdit').open);
  await closeManager(page);
}
async function send(page, text) {
  await page.fill('#groupInput', text); await page.press('#groupInput', 'Enter');
  await page.waitForFunction(() => document.querySelector('#groupInput').value === '');
}
async function received(page, text) {
  await page.locator('#groupLog').getByText(text, {exact:true}).waitFor();
}
async function createChannel(page, name, access='all') {
  await page.click('#groupAddChannel');
  await page.fill('#groupField-name', name);
  await page.selectOption('#groupField-access', access);
  await submit(page);
  await page.waitForFunction(name => document.querySelector('#groupChannelName').textContent === '# '+name, name);
}
async function openShelf(page) {
  if (!await page.locator('#groupShelf').evaluate(el => el.open)) await page.click('#groupShelf summary');
}
async function downloaded(directory, name) {
  for (const entry of await fs.readdir(directory, {withFileTypes:true})) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) { const found = await downloaded(candidate, name); if(found)return found; }
    else if (entry.name === name) return candidate;
  }
  return null;
}
async function diagnostics(client) {
  if (client.page.isClosed())return {closed:true};
  return client.page.evaluate(() => Object.fromEntries(['groupName','groupChannelName','groupConnection','groupFeedback',
    'groupEditError','groupWelcomeText','groupManageBody','groupInvites','toast','groupFiles'].map(id=>[id,document.getElementById(id)?.textContent])));
}
async function run({a,b,open,create,apps}) {
  const c = await open('vera'); await create(c,'Вера');
  try {
    await addFriend(a,c,'Вера'); await addFriend(b,c,'Вера');
    console.log('PASS three isolated LINK profiles and confirmed friendship.');
    await a.page.click('#navGroups'); await a.page.click('#groupCreate');
    await a.page.fill('#groupField-name','Вечер друзей'); await submit(a.page);
    await a.page.locator('#groupInput:enabled').waitFor();
    const first = await a.page.locator('#groupChannels [aria-current="true"]').getAttribute('data-group-channel');
    await invite(a.page,'Борис',b.page); await invite(a.page,'Вера',c.page);
    await c.page.click('#groupOptions');
    assert.equal(await button(c.page,'#groupManage','Оформление группы').count(),0);
    await closeManager(c.page);
    await a.page.click('#groupOptions');await button(a.page,'#groupManage','Оформление группы').click();
    await a.page.selectOption('#groupTheme','dusk');
    await a.page.setInputFiles('#groupPhotoFile',path.resolve(__dirname,'../src/renderer/assets/craftlink.png'));
    await a.page.locator('#groupPhotoPreview canvas').waitFor();
    await a.page.click('#groupAppearanceSave');await a.page.locator('#groupAppearance').waitFor({state:'hidden'});
    await closeManager(a.page);
    for(const client of [a,b,c]){
      await client.page.locator('html[data-theme="dusk"] #groupContextMark canvas').waitFor();
      await client.page.locator('#spaceList .group-mark canvas').waitFor();
    }
    await c.page.click('#profileBtn');await c.page.selectOption('#profileTheme','forest');await c.page.click('#closeSettingsDialog');
    assert.equal(await c.page.locator('html').getAttribute('data-theme'),'dusk','a personal edit during group browsing preserves the group theme');
    await c.page.click('#navFriends');
    assert.equal(await c.page.locator('html').getAttribute('data-theme'),'forest');
    await c.page.click('#navGroups');await c.page.locator('html[data-theme="dusk"] #groupContextMark canvas').waitFor();
    console.log('PASS owner photo picker and theme, all three group badges, member permissions and personal theme on Home.');
    await send(a.page,'Группа готова'); await received(b.page,'Группа готова'); await received(c.page,'Группа готова');
    await send(c.page,'Вера уже здесь'); await received(a.page,'Вера уже здесь'); await received(b.page,'Вера уже здесь');
    console.log('PASS group invitation, acceptance and authenticated messages in all three windows.');

    await createChannel(a.page,'Только администрация','staff');
    const staff = await a.page.locator('#groupChannels [aria-current="true"]').getAttribute('data-group-channel');
    await send(a.page,'Внутреннее обсуждение');
    assert.equal(await c.page.locator('[data-group-channel="'+staff+'"]').count(),0);
    assert.equal(await b.page.locator('[data-group-channel="'+staff+'"]').count(),0);
    await memberAction(a.page,'Борис','promote');
    await b.page.locator('[data-group-channel="'+staff+'"]').waitFor();
    await b.page.locator('[data-group-channel="'+staff+'"]').click();
    await received(b.page,'Внутреннее обсуждение');
    assert.equal(await c.page.locator('[data-group-channel="'+staff+'"]').count(),0);
    await b.page.click('#groupOptions'); await button(b.page,'#groupManage','Переименовать канал').click();
    await b.page.fill('#groupField-name','Обсуждение администрации'); await submit(b.page); await closeManager(b.page);
    await a.page.waitForFunction(() => document.querySelector('#groupChannelName').textContent === '# Обсуждение администрации');
    for (const client of [a,b])await client.page.locator('[data-group-channel="'+first+'"]').click();
    console.log('PASS private channel access, promotion and administrator channel rename.');

    const bytes = crypto.randomBytes(160*1024+31),name='group-handoff.bin';
    const source=path.join(b.base,name);await fs.writeFile(source,bytes);
    await require('./chat-drop-desktop.cjs').dropFile(b.page,'#groupText',source);
    const caption='Карта для следующего матча';
    await b.page.fill('#attachmentCaption',caption);await b.page.click('#attachmentDraftSend');
    await openShelf(a.page);await file(a.page,name).getByRole('button',{name:'Принять файл',exact:true}).waitFor();
    assert.equal(await file(c.page,name).count(),0,'pending upload must not publish to other participants');
    await file(a.page,name).getByRole('button',{name:'Принять файл',exact:true}).click();
    await file(a.page,name).getByRole('button',{name:'Скачать',exact:true}).waitFor();
    await openShelf(c.page);await file(c.page,name).getByRole('button',{name:'Скачать',exact:true}).waitFor();
    await received(c.page,caption);
    console.log('PASS dropped attachment and caption, explicit owner acceptance and published file list.');

    await memberAction(a.page,'Борис','transfer');
    await button(b.page,'#groupInvites','Принять').click();await b.page.click('#confirmYesBtn');
    await b.page.waitForFunction(() => document.querySelector('#groupInvites').children.length===0 && !document.querySelector('#groupInput').disabled);
    await b.page.click('#groupOptions');
    await button(b.page,'#groupManage','Удалить группу').waitFor();await closeManager(b.page);
    await a.app.close();apps.delete(a.app);
    await send(c.page,'После передачи владельца');await received(b.page,'После передачи владельца');
    await received(c.page,'Группа готова');
    await file(c.page,name).getByRole('button',{name:'Скачать',exact:true}).click();
    await file(c.page,name).getByRole('button',{name:'Показать в папке',exact:true}).waitFor();
    const actual=await downloaded(path.join(c.base,'Downloads'),name);
    assert(actual,'download should be saved inside the receiving temporary profile');
    assert.deepEqual(await fs.readFile(actual),bytes);
    console.log('PASS old owner offline, continued group chat and file from new owner',{
      bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});

    await c.page.setViewportSize({width:740,height:560});
    assert(await c.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await b.app.close();apps.delete(b.app);
    await c.page.waitForFunction(() => document.querySelector('#groupConnection').textContent.includes('вне сети') && document.querySelector('#groupInput').disabled);
    assert(await c.page.locator('#groupContent').isVisible());
    b=await open('boris');await b.page.click('#navGroups');
    await b.page.locator('#groupInput:enabled').waitFor();
    await c.page.locator('#groupInput:enabled').waitFor();
    await received(b.page,'После передачи владельца');
    await b.page.locator('html[data-theme="dusk"] #groupContextMark canvas').waitFor();
    await send(c.page,'После перезапуска');await received(b.page,'После перезапуска');
    await openShelf(c.page);await file(c.page,name).getByRole('button',{name:'Скачать',exact:true}).waitFor();
    console.log('PASS restarted new owner, persistent history and files, offline UI and restored delivery.');

    await b.page.locator('[data-group-channel="'+staff+'"]').click();
    async function allowVera(value){
      await b.page.click('#groupOptions');await button(b.page,'#groupManage','Доступ к каналу').click();
      await b.page.locator('#groupField-allow').getByLabel('Вера',{exact:true}).setChecked(value);
      await submit(b.page);await closeManager(b.page);
    }
    await allowVera(true);await c.page.click('#contextToggle');await c.page.locator('[data-group-channel="'+staff+'"]').click();
    await received(c.page,'Внутреннее обсуждение');
    await allowVera(false);await c.page.locator('[data-group-channel="'+staff+'"]').waitFor({state:'detached'});
    assert.equal(await c.page.locator('#groupLog').getByText('Внутреннее обсуждение',{exact:true}).count(),0);
    await b.page.click('#groupOptions');await button(b.page,'#groupManage','Удалить канал').click();await b.page.click('#confirmYesBtn');
    await b.page.locator('[data-group-channel="'+staff+'"]').waitFor({state:'detached'});await closeManager(b.page);
    await b.page.click('#groupOptions');await button(b.page,'#groupManage','Очистить историю канала').click();await b.page.click('#confirmYesBtn');await closeManager(b.page);
    await c.page.locator('#groupEmptyChat').waitFor();
    assert.deepEqual(await fs.readFile(actual),bytes,'clearing the group channel preserves the file saved by the recipient');
    console.log('PASS individual channel permission granted/revoked while viewing; delete channel, clear shared history and keep explicitly saved copy.');
  } catch(error) {
    console.log('Group UI failure',await Promise.all([a,b,c].map(diagnostics)));throw error;
  }
}
module.exports={run};
