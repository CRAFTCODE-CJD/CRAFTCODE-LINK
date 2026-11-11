'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises');

module.exports=async function checkShell(page,language){
  await page.setViewportSize({width:1426,height:933});
  const images=process.env.LINK_UI_QA_IMAGES;
  async function shot(name){if(images){await fs.mkdir(images,{recursive:true});await page.screenshot({path:path.join(images,name+'-'+language+'.png')});}}
  await page.evaluate(()=>{
    const peers=['Анна','Борис','Вера','Глеб','Дима','Лена','Маша','Ника','Рома']
      .map((name,i)=>({id:'friend-'+i,name,online:i%3!==0,state:'friend',devices:[],added:Date.UTC(2026,8,14),chat:{supported:true}}));
    peers[1].rooms=[{door:'voice',device:'other-pc',count:2}];
    const channels=[{id:'lobby',name:'общий',type:'text',access:'all',allow:[]}];
    let spaces=['Соседи','Ночной эфир'].map((name,i)=>({id:'space-'+i,name,role:'owner',online:true,epoch:1,revision:0}));
    const original=window.craftlink.direct;
    window.craftlink.direct=async request=>{
      if(request.op==='group-open'){
        const summary=spaces.find(g=>g.id===request.id);
        return {...summary,owner:'me',members:[{id:'me',role:'owner',name:'Анна'}],channels,bans:[]};
      }
      if(request.op==='group-shared-with')return request.person==='friend-7'?spaces.slice(0,1):[];
      if(request.op==='chat-history'){
        const messages=request.id==='friend-7'?['Ты сегодня зайдёшь в голосовой?','Да, буду после восьми.','Хорошо, до вечера!'].map((text,i)=>({
          text,id:String(i),time:Date.UTC(2026,10,10,15,20+i),direction:i===1?'out':'in',status:'delivered'
        })):[];
        return {messages,hasMore:false};
      }
      if(request.op==='group-history')return {messages:[],more:false};
      if(request.op==='group-file-list')return [];
      const state=await original(request);
      if(request.op==='state'){state.friends=peers;state.groups={items:spaces,transfers:[],invites:[]};}
      return state;
    };
    window.dropSpace=()=>{spaces=spaces.slice(0,1);roomFixture.refresh();};
    roomFixture.refresh();
  });
  const spaces=page.locator('#spaceList button');
  await spaces.nth(1).waitFor();
  assert.equal(await page.locator('#quickPeople button').count(),9);
  const [spacesBox,sectionsBox,friendsBox,mainBox]=await page.evaluate(()=>['groupRail','navRail','friendsContext','directoryPage'].map(id=>{
    const {left,right,top,bottom}=document.getElementById(id).getBoundingClientRect();return {left,right,top,bottom};
  }));
  assert.equal(sectionsBox.left,spacesBox.right);assert.equal(friendsBox.left,sectionsBox.left);
  assert.equal(sectionsBox.bottom,friendsBox.top);assert.equal(friendsBox.right,mainBox.left);
  assert(await page.locator('#sidebarSearch #friendContextSearch').isVisible());
  assert(await page.locator('#homeActivities button').filter({hasText:'Борис'}).isVisible());
  await page.locator('#homeActivities button').click();await page.locator('#friendRooms button').waitFor();
  await page.click('#homeDirectory');
  await page.fill('#friendContextSearch','Ника');
  await page.locator('#quickPeople button').click();
  await page.locator('#dmTitle').filter({hasText:'Ника'}).waitFor();
  assert(await page.locator('#dmContext').isVisible());
  assert(await page.locator('#sidebarSearch #dmSearch').isVisible());
  assert(await page.locator('#friendsContext').isHidden());
  await page.locator('#dmProfileName').filter({hasText:'Ника'}).waitFor();
  assert(await page.locator('#dmIntro').isVisible());
  await page.locator('#dmSharedList button').filter({hasText:'Соседи'}).waitFor();
  assert.equal(await page.locator('#dmLog article').count(),3);
  await shot('direct');
  await page.click('#dmProfileToggle');assert(await page.locator('#dmProfile').isHidden());
  await page.click('#dmProfileToggle');await page.click('#dmSharedList button');
  await page.locator('#groupName,#groupsTitle').filter({hasText:'Соседи'}).first().waitFor();
  await spaces.nth(1).click();
  await page.locator('#groupName,#groupsTitle').filter({hasText:'Ночной эфир'}).first().waitFor();
  assert.equal(await spaces.nth(1).getAttribute('aria-current'),'page');
  assert(await page.locator('#navRail').isHidden());
  assert(await page.locator('#groupContext').isVisible());
  assert(await page.locator('#dmContext').isHidden());
  const rect=await page.locator('#groupsPage').boundingBox(),context=await page.locator('#groupContext').boundingBox();
  assert(Math.abs(context.x+context.width-rect.x)<1);
  await shot('group');
  await page.click('#navFriends');
  await page.fill('#friendContextSearch','');await page.locator('#bookSort').focus();await shot('home');
  await page.keyboard.press('Space');
  await page.waitForFunction(()=>document.querySelector('#bookSort').matches(':open'));
  await shot('sort');
  await page.keyboard.press('End');await page.keyboard.press('Enter');
  assert.equal(await page.locator('#bookSort').inputValue(),'recent');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('#linkFriends').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.click('#settingsBtn');
  await page.fill('#settingsSearch',language==='en'?'chat text':'размер текста');
  await page.press('#settingsSearch','Enter');await page.locator('#pref-reading').waitFor();
  await page.focus('#chatFontSize');await page.keyboard.press('End');await page.check('#compactMessages');await page.check('#reduceMotion');
  assert.equal(await page.locator('.reading-preview .link-chat-body').evaluate(el=>getComputedStyle(el).fontSize),'24px');
  assert.equal(await page.locator('#settingsDialog .close-button').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  await shot('reading');await page.click('#closeSettingsDialog');
  await page.click('#settingsBtn');await page.click('[data-pane="voice"]');
  const input=page.locator('#micDevice'),output=page.locator('#outputDevice');
  assert(Math.abs((await input.boundingBox()).y-(await output.boundingBox()).y)<1);
  await page.focus('#roomOutputVolume');await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
  assert.equal(await page.textContent('#roomOutputVolumeValue'),'1%');
  await page.keyboard.press('End');await shot('voice-settings');
  await page.setViewportSize({width:540,height:620});
  assert((await output.boundingBox()).y>(await input.boundingBox()).y);
  await shot('voice-settings-narrow');
  await page.setViewportSize({width:1426,height:933});await page.click('#closeSettingsDialog');
  await page.click('#linkHost');
  await page.locator('#leaveBtn').waitFor();
  assert(await page.locator('#friendsContext').isVisible());
  assert.equal(await page.locator('#voiceQuickControls > #micBtn').count(),1);
  await page.click('#cinemaBtn');
  assert.equal(await page.locator('#callControls > #micBtn').count(),1);
  await page.click('#cinemaBtn');await shot('voice');
  await page.setViewportSize({width:740,height:560});
  assert(await page.locator('#contextToggle').isVisible());assert(await page.locator('#friendsContext').isHidden());
  await page.focus('#contextToggle');await page.keyboard.press('Enter');await page.locator('#friendContextSearch').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'contextToggle');
  await page.click('#contextToggle');await page.locator('#quickPeople button').filter({hasText:'Рома'}).click();
  await page.locator('#dmTitle').filter({hasText:'Рома'}).waitFor();assert(await page.locator('#dmContext').isHidden());
  assert(await page.locator('#dmProfile').isHidden());await page.click('#dmProfileToggle');
  await page.locator('#dmProfile').waitFor();await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'dmProfileToggle');
  await page.click('#dmBack');await page.locator('#dmSearch').waitFor();await page.fill('#dmSearch','Вера');
  await page.locator('#dmList button').click();await page.locator('#dmTitle').filter({hasText:'Вера'}).waitFor();
  await page.click('#backToCall');await page.locator('#roomPage').waitFor();
  await shot('voice-740');
  await spaces.nth(1).click();await page.locator('#groupContext').waitFor();await page.keyboard.press('Escape');
  await spaces.nth(1).focus();await page.evaluate(()=>dropSpace());await page.waitForFunction(()=>document.querySelectorAll('#spaceList button').length===1);
  assert(await page.locator('#navFriends').isVisible());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log('PASS',language,'wide and 740px: home/space rail, every confirmed friend, filtering and private chat, one contextual sidebar, saved group selection, call controls, cinema, narrow drawer, keyboard focus and group removal.');
};
