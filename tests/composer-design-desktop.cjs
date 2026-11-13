'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

// Enter a DM from a real, connected room. Verify the keyboard and pointer focus cues
// on the same composer the user sees while a call is in progress.
module.exports = async function checkComposer(client, other) {
  const page = client.page, peer = other.page;
  const directory = process.env.LINK_QA_COMPOSER_IMAGES;
  if (directory) await fs.mkdir(directory, { recursive: true });
  async function capture(name) {
    if (!directory) return;
    const data = await client.app.evaluate(async ({BrowserWindow}) => {
      const win = BrowserWindow.getAllWindows()[0];
      // Refresh the compositor of this hidden test window before taking the evidence frame.
      await win.capturePage(undefined, {stayHidden:true});
      await new Promise(resolve => setTimeout(resolve, 200));
      const image = await win.capturePage(undefined, {stayHidden:true});
      return image.toPNG().toString('base64');
    });
    await fs.writeFile(path.join(directory, name + '.png'), Buffer.from(data, 'base64'));
  }
  async function readFocus(form) {
    return page.locator(form).evaluate(el => {
      const css = getComputedStyle(el), focus = document.activeElement;
      return {
        edges: [css.borderTopColor, css.borderRightColor, css.borderBottomColor, css.borderLeftColor],
        field: focus.id, mark: getComputedStyle(focus).boxShadow,
        focusRing: getComputedStyle(focus).outlineStyle,
        rounded: parseFloat(css.borderRadius)
      };
    });
  }
  async function checkEmoji(menu, input) {
    await page.click(menu + ' summary');
    const picker = page.locator(menu + ' .emoji-picker');
    await picker.locator('[data-glyph="🎮"]').waitFor();
    const layout = await picker.evaluate(el => {
      const box = child => child.getBoundingClientRect();
      const search = box(el.querySelector('input')), categories = box(el.querySelector('select'));
      const grid = box(el.querySelector('.emoji-grid')), glyph = box(el.querySelector('[data-glyph]'));
      return {
        stacked: search.bottom <= categories.top && categories.bottom <= grid.top,
        fullWidth: search.width >= el.clientWidth * .8 && categories.width >= search.width - 1,
        usableGrid: grid.width >= glyph.width * 6,
        visible: box(el).left >= 0 && box(el).right <= innerWidth && box(el).bottom <= innerHeight
      };
    });
    assert(Object.values(layout).every(Boolean), menu + ': ' + JSON.stringify(layout));
    if (menu === '#chatEmoji') await capture('room-emoji-picker');
    await picker.locator('select').selectOption('Animals & Nature');
    await picker.locator('.emoji-more').waitFor();
    assert(await picker.locator('.emoji-grid').evaluate(el => el.scrollHeight > el.clientHeight));
    await picker.locator('input').fill('ракета');
    await picker.locator('[data-glyph="🚀"]').waitFor();
    await picker.locator('input').press('Enter');
    assert.equal(await page.inputValue(input), '🚀');
    await page.fill(input, '');
  }
  await page.setViewportSize({width: 1280, height: 800});
  await page.click('#dmCall');
  await peer.click('#peerAccept');
  await page.waitForFunction(() => document.querySelector('#participantsCount').textContent === '2 / 8');
  await page.click('#roomConversation');
  await page.fill('#dmInput', 'Привет! Соберёмся вечером?');
  await page.press('#dmInput', 'Enter');
  await page.locator('#dmLog article').first().waitFor();
  await page.click('#dmInput');
  await capture('dm-call-editing');
  const editing = await readFocus('#dmForm');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#dmEmoji summary').evaluate(el => el === document.activeElement), true);
  const controls = await readFocus('#dmForm');
  await capture('dm-call-keyboard');
  await page.keyboard.press('Enter');
  await page.locator('#dmEmoji .emoji-picker').waitFor();
  await page.waitForFunction(() => document.querySelector('#dmEmoji input') === document.activeElement);
  assert.equal(await page.locator('#dmEmoji input').evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
  await page.keyboard.press('Escape');
  await page.click('#dmInput');
  await checkEmoji('#dmEmoji', '#dmInput');
  await page.fill('#dmInput','Я на связи');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#dmSend').evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Enter');
  await page.locator('#dmLog article').getByText('Я на связи',{exact:true}).waitFor();
  await page.click('#dmTitle');
  const idle = await readFocus('#dmForm');
  assert.deepEqual(editing.edges, idle.edges, 'moving the caret must not highlight the entire footer');
  assert.deepEqual(controls.edges, idle.edges, 'the toolbar must keep its quiet border when tabbing');
  assert(editing.rounded > 0 && editing.mark !== 'none', 'the writing surface and active field are distinct');
  assert.equal(controls.focusRing, 'solid');
  console.log('PASS direct chat during a call: local field focus, keyboard picker and send.');
  await page.click('#navRoom');
  if (!await page.isVisible('#chatInput')) await page.click('#togglePanelBtn');
  await checkEmoji('#chatEmoji', '#chatInput');
  await page.click('#chatInput');
  await capture('room-chat-editing');
  assert.notEqual((await readFocus('#chatForm')).mark, 'none');
  await page.fill('#chatInput','Сообщение в комнате');
  await page.press('#chatInput','Enter');
  await page.locator('#chatMessages').getByText('Сообщение в комнате',{exact:true}).waitFor();
  assert.equal(await page.locator('#participantsCount').textContent(), '2 / 8');
  await page.click('#profileBtn');
  await page.selectOption('#profileTheme','light');
  await page.click('#closeSettingsDialog');
  await page.click('#roomConversation');
  await page.click('#dmInput');
  await capture('dm-call-light');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  assert.notEqual((await readFocus('#dmForm')).mark, 'none');
  await page.click('#navGame');
  await page.fill('#gameTitle','Вечерний матч');
  await page.click('#gameCreate button');
  await checkEmoji('#gameEmoji', '#gameMessage');
  await page.click('#gameMessage');
  await capture('lan-chat-light');
  assert.notEqual((await readFocus('#gameComposer')).mark, 'none');
  await page.click('#navGroups');
  await page.click('#groupCreate');
  await page.fill('#groupField-name','Вечер друзей');
  await page.click('#groupEditSubmit');
  await checkEmoji('#groupEmoji', '#groupInput');
  await page.click('#groupInput');
  await capture('group-chat-light');
  assert.notEqual((await readFocus('#groupComposer')).mark, 'none');
  console.log('PASS room, LAN and group channel field focus, light and dark themes.');
  await peer.click('#leaveBtn');
  if (await peer.isVisible('#confirmYesBtn')) await peer.click('#confirmYesBtn');
  await peer.locator('#leaveBtn').waitFor({state:'hidden'});
  await peer.click('#profileBtn');
  await peer.selectOption('#displayLanguage','en');
  await peer.waitForFunction(() => document.documentElement.lang === 'en');
  await peer.click('#navFriends');
  await peer.locator('#workspaceContacts .open-person-chat').click();
  await peer.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await peer.locator('#dmRecordMode').getAttribute('aria-label'), 'Switch to video message');
  await peer.click('#dmRecordMode');
  assert.equal(await peer.locator('#dmRecord').getAttribute('aria-label'), 'Record a video message');
  assert.equal(await peer.locator('#dmRecord').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  console.log('PASS English recorder labels, mode switching and reduced motion.');
};
