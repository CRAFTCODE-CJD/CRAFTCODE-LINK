'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises');

module.exports=async function checkShell(page,language){
  await page.setViewportSize({width:1426,height:933});
  const images=process.env.LINK_UI_QA_IMAGES;
  async function shot(name){if(images){await fs.mkdir(images,{recursive:true});await page.screenshot({path:path.join(images,name+'-'+language+'.png'),animations:'disabled'});}}
  const sharedGroup='Соседи · ЛабораторияМногопользовательскихИгр';
  await page.evaluate(sharedGroup=>{
    const peers=['Анна','Борис','Вера','Глеб','Дима','Лена','Маша','Ника','Рома']
      .map((name,i)=>({id:'friend-'+i,name,online:i%3!==0,state:'friend',devices:[],added:Date.UTC(2026,8,14),chat:{supported:true}}));
    peers[0].status='busy';peers[2].status='busy';peers[4].status='away';
    peers[1].rooms=[{door:'voice',device:'other-pc',count:2}];
    const channels=[{id:'lobby',name:'общий',type:'text'},{id:'plans',name:'планы',type:'text'},{id:'voice',name:'Вечерний звонок',type:'voice'}]
      .map(c=>({...c,access:'all',allow:[]}));
    let spaces=[sharedGroup,'Ночной эфир'].map((name,i)=>({id:'space-'+i,name,role:'owner',online:true,epoch:1,revision:0}));
    const original=window.craftlink.direct;
    window.craftlink.direct=async request=>{
      if(request.op==='group-open'){
        const summary=spaces.find(g=>g.id===request.id);
        return {...summary,owner:'me',members:[{id:'me',role:'owner',name:'Анна'},{id:'friend-7',role:'member',name:'Ника'}],channels,bans:[]};
      }
      if(request.op==='group-shared-with')return request.person==='friend-7'?spaces.slice(0,1):[];
      if(request.op==='chat-history'){
        const messages=request.id==='friend-7'?['Ты сегодня зайдёшь в голосовой?','Да, буду после восьми.','Хорошо, до вечера! Вчера мы нашли новую карту для совместной игры. Заходи, покажу, где она начинается и как нам встретиться в первой комнате.'].map((text,i)=>({
          text,id:String(i),time:Date.UTC(2026,10,10,15,20+i),direction:i===1?'out':'in',status:'delivered'
        })):[];
        return {messages,hasMore:false};
      }
      if(request.op==='group-history')return {messages:[
        {id:'plan-1',person:'friend-7',name:'Ника',at:Date.UTC(2026,10,10,15,22),text:'Кто будет сегодня вечером?'},
        {id:'plan-2',person:'me',name:'Анна',at:Date.UTC(2026,10,10,15,24),text:'Я буду после восьми. Заходите в голосовой.'}
      ],more:false};
      if(request.op==='group-file-list')return [];
      const state=await original(request);
      if(request.op==='state'){state.friends=peers;state.groups={items:spaces,transfers:[],invites:[]};}
      return state;
    };
    window.dropSpace=()=>{spaces=spaces.slice(0,1);roomFixture.refresh();};
    roomFixture.refresh();
  },sharedGroup);
  const spaces=page.locator('#spaceList button');
  await spaces.nth(1).waitFor();
  assert.equal(await page.locator('#quickPeople button').count(),9);
  const indicator=person=>page.locator('#workspaceContacts [data-person="'+person+'"] .contact-avatar')
    .evaluate(el=>getComputedStyle(el,'::after').backgroundColor);
  assert.equal(await indicator('friend-0'),await indicator('friend-3'),'An offline friend with a saved busy status should appear offline');
  assert.notEqual(await indicator('friend-2'),await indicator('friend-0'));
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
  const sharedButton=page.locator('#dmSharedList').getByRole('button',{name:sharedGroup,exact:true});
  await sharedButton.waitFor();
  assert.equal(await page.locator('#dmLog article').count(),3);
  assert.equal(await page.locator('#navRail [aria-current="page"]').getAttribute('id'),'navChats');
  assert.equal(await page.locator('#navChats').evaluate(el=>getComputedStyle(el,'::before').content),'""');
  const widths=[1426,1920,740];
  for(const width of widths){
    await page.setViewportSize({width,height:width===740?560:933});
    const compact=width===740;
    await page.waitForFunction(expected=>document.querySelector('#dmConversation').classList.contains('compact-profile')===expected,compact);
    for(const show of [true,false]){
      if(await sharedButton.isVisible()!==show)await page.click('#dmProfileToggle');
      if(show)await sharedButton.waitFor();else await sharedButton.waitFor({state:'hidden'});
      const layout=await page.evaluate(()=>{
        const box=selector=>document.querySelector(selector).getBoundingClientRect();
        const thread=box('.dm-thread-body'),composer=box('#dmForm'),incoming=box('#dmLog article:not(.is-own)'),outgoing=box('#dmLog article.is-own');
        const profile=document.querySelector('#dmProfile'),label=document.querySelector('#dmSharedList button span:last-child');
        const rightmost=box('#dmSharedList button'),card=box('#dmSharedGroups');
        return {left:incoming.left-thread.left,right:thread.right-outgoing.right,
          composerLeft:composer.left-thread.left,composerRight:thread.right-composer.right,
          longest:box('#dmLog article:last-child').width,
          fits:profile.scrollWidth<=profile.clientWidth&&rightmost.right<=card.right&&label.scrollWidth<=label.clientWidth,
          lines:label.getBoundingClientRect().height/parseFloat(getComputedStyle(label).lineHeight)};
      });
      assert(layout.left>=8&&layout.left<=20&&layout.right>=8&&layout.right<=26,JSON.stringify({width,show,layout}));
      assert(Math.abs(layout.left-layout.composerLeft)<=1&&Math.abs(layout.right-layout.composerRight)<=8);
      assert(layout.longest<600,'Long messages should still wrap at a readable line length');
      if(show)assert(layout.fits&&layout.lines>1,'The full group name should wrap inside its card: '+JSON.stringify(layout));
      await shot('direct-'+width+(show?'-profile':''));
    }
  }
  await page.setViewportSize({width:1426,height:933});
  await page.waitForFunction(()=>!document.querySelector('#dmConversation').classList.contains('compact-profile'));
  await page.click('#dmProfileToggle');await sharedButton.focus();await page.keyboard.press('Enter');
  await page.locator('#groupName,#groupsTitle').filter({hasText:sharedGroup}).first().waitFor();
  await spaces.nth(1).click();
  await page.locator('#groupName,#groupsTitle').filter({hasText:'Ночной эфир'}).first().waitFor();
  assert.equal(await spaces.nth(1).getAttribute('aria-current'),'page');
  assert(await page.locator('#navRail').isVisible());
  assert(await page.locator('#sidebarSearch #friendContextSearch').isVisible());
  assert(await page.locator('#groupContext').isVisible());
  assert(await page.locator('#dmContext').isHidden());
  const rect=await page.locator('#groupsPage').boundingBox(),context=await page.locator('#groupContext').boundingBox();
  const personal=await page.locator('#friendsContext').boundingBox(),profile=await page.locator('#profileDock').boundingBox();
  assert.equal(personal.x,sectionsBox.left);assert.equal(personal.x,profile.x);
  assert(Math.abs(personal.x+personal.width-context.x)<1);
  assert(Math.abs(context.x+context.width-rect.x)<1);
  await page.fill('#friendContextSearch','');await page.click('[data-group-channel="plans"]');
  await shot('group');
  await page.click('#quickPeople [data-person="friend-7"]');
  await page.locator('#dmTitle').filter({hasText:'Ника'}).waitFor();
  await spaces.nth(1).click();await page.locator('#groupChannelName').filter({hasText:'планы'}).waitFor();
  await page.setViewportSize({width:940,height:650});
  await page.locator('#groupContent.compact-members').waitFor();
  const chatBounds=await page.locator('#groupScroll').boundingBox();
  await shot('group-940');
  assert(chatBounds.width>=410 && await page.locator('#groupScroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Group conversation needs readable width at 940px: '+JSON.stringify(chatBounds));
  await page.setViewportSize({width:1426,height:933});
  await page.click('#navFriends');
  await page.fill('#friendContextSearch','');await page.locator('#bookSort').focus();await shot('home');
  await page.keyboard.press('Space');
  await page.waitForFunction(()=>document.querySelector('#bookSort').matches(':open'));
  await shot('sort');
  await page.keyboard.press('End');await page.keyboard.press('Enter');
  assert.equal(await page.locator('#bookSort').inputValue(),'recent');
  await page.click('#welcomeSkip');await page.click('#firstStepsSkip');
  await page.selectOption('#bookSort','available');
  await page.locator('#bookFilters button[data-filter="online"]').click();
  assert.equal(await page.locator('#workspaceContacts .open-person-chat').count(),6);
  await page.locator('#bookFilters button[data-filter="all"]').click();
  const aligned=await page.evaluate(()=>{
    const title=document.getElementById('directoryTitle').getBoundingClientRect();
    const count=document.getElementById('directoryCount').getBoundingClientRect();
    return Math.abs((title.top+title.bottom-count.top-count.bottom)/2)<2;
  });
  assert(aligned,'Online count and heading should have a shared vertical centre');
  const bodyBounds=await page.locator('#peopleDirectory').boundingBox();
  const directoryBounds=await page.locator('#directoryPage').boundingBox();
  assert.equal(bodyBounds.x,directoryBounds.x);
  assert(Math.abs(bodyBounds.width-directoryBounds.width)<2,'The directory should use the width of the page');
  await shot('friends');
  for(const theme of ['light','dusk','forest','default']){
    await page.click('#settingsBtn');await page.click('[data-pane="profile"]');
    await page.selectOption('#profileTheme',theme);await page.click('#closeSettingsDialog');
    assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
    if(theme!=='default')await shot('friends-'+theme);
  }
  await page.setViewportSize({width:740,height:560});
  assert(await page.locator('#linkFriends').isVisible());
  assert(await page.locator('#directoryPage').evaluate(el=>el.scrollWidth<=el.clientWidth));
  await shot('friends-740');
  await page.setViewportSize({width:1426,height:933});
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
  await page.locator('#dmProfile').waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'dmCloseProfile');
  await shot('contact-profile-740');
  await page.keyboard.press('Enter');
  assert(await page.locator('#dmProfile').isHidden());
  assert.equal(await page.evaluate(()=>document.activeElement.id),'dmProfileToggle');
  await page.keyboard.press('Enter');await page.keyboard.press('Escape');
  assert(await page.locator('#dmProfile').isHidden());
  assert.equal(await page.evaluate(()=>document.activeElement.id),'dmProfileToggle');
  await page.click('#dmBack');await page.locator('#dmSearch').waitFor();await page.fill('#dmSearch','Вера');
  await page.locator('#dmList button').click();await page.locator('#dmTitle').filter({hasText:'Вера'}).waitFor();
  await page.click('#backToCall');await page.locator('#roomPage').waitFor();
  await shot('voice-740');
  await spaces.nth(1).click();await page.locator('#groupContext').waitFor();await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'contextToggle');
  assert(await page.locator('#navRail').isVisible());
  assert.equal(await page.locator('#crumb').innerText(),'Ночной эфир');
  const channelButton=await page.locator('#contextToggle span').boundingBox();
  const contactsButton=await page.locator('#contactDrawerToggle').boundingBox();
  assert(channelButton.x+channelButton.width<=contactsButton.x,'Labels for both drawers must fit side by side');
  await page.focus('#contactDrawerToggle');await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'friendContextSearch');
  assert(await page.locator('#groupContext').isHidden());await shot('group-contacts-740');
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'contactDrawerToggle');
  await page.click('#contextToggle');await page.locator('#groupContext').waitFor();await shot('group-channels-740');
  await page.click('[data-group-channel="lobby"]');assert(await page.locator('#groupContext').isHidden());
  await page.click('#contactDrawerToggle');await page.click('#quickPeople [data-person="friend-8"]');
  await page.locator('#dmTitle').filter({hasText:'Рома'}).waitFor();assert(await page.locator('#backToCall').isVisible());
  await spaces.nth(1).click();await page.locator('#groupContext').waitFor();await page.keyboard.press('Escape');
  await spaces.nth(1).focus();await page.evaluate(()=>dropSpace());await page.waitForFunction(()=>document.querySelectorAll('#spaceList button').length===1);
  assert(await page.locator('#navFriends').isVisible());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log('PASS',language,'persistent home, contacts and group columns; responsive 940px channel, narrow channel and contact drawers, return to selected channel, private chats during calls, themes, keyboard focus and group removal.');
};
