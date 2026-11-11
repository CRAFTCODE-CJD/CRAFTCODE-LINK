'use strict';

async function closeRoomMenu(page) {
  if(await page.locator('.room-popover:popover-open').count())await page.keyboard.press('Escape');
}
async function roomMix(page,slot) {
  const button=page.locator('.voice-tile[data-slot="'+slot+'"] .tile-sound-menu');
  if(await page.locator('#roomPage.compact-room #roomSidebar').isVisible())await page.click('#closeRoomChat');
  if(await button.getAttribute('aria-expanded')!=='true'){
    await closeRoomMenu(page);
    await button.click();
  }
  await page.locator('#participantSoundMenu:popover-open').waitFor();
}
async function roomOptions(page) {
  if(!await page.locator('#hostAccess:popover-open').count()){
    await closeRoomMenu(page);
    await page.click('#roomOptionsBtn');
  }
}
async function roomChat(page) {
  if(!await page.locator('#roomSidebar').isVisible())await page.click('#togglePanelBtn');
  await page.locator('#chatHeading').waitFor();
}
module.exports={roomMix,roomOptions,roomChat,closeRoomMenu};
