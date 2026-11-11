'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const en=require('../src/renderer/l10n/en.json');

module.exports=async function verifyGroups(host,guest,people,language){
  const label=s=>language==='en'?en[s]:s;
  let exists=false,invited=false,joined=false,offered=false,owner=0,online=true,file=null,fileListFails=false,theme='personal';
  const members=[{id:people[0],name:'Саша',role:'owner'},{id:people[1],name:'Саша',role:'member'}];
  const channels=[{id:'common',name:'Лобби',type:'text',access:'all',allow:[]}],messages=[],commands=[];
  for(const [i,page] of [host,guest].entries()){
    const info=()=>({id:'team',name:'Команда',owner:people[owner],role:members[i].role,online:i===owner||online,transferring:offered,theme,appearanceVersion:1,
      voiceRooms:{voice:[{id:people[0],name:'Саша',seat:'live-seat',micMuted:true,sharing:false}]},
      members:members.slice(0,joined?2:1),channels,bans:[]});
    await page.exposeFunction('qaGroup',async r=>{
      if(r.op==='summary')return {items:exists&&(i===0||joined)?[info()]:[],
        invites:invited&&i===1?[{id:'team',name:'Команда',fromName:'Саша'}]:[],
        transfers:offered&&i===1?[{id:'team',name:'Команда',fromName:'Саша'}]:[]};
      commands.push(r);
      switch(r.op){
        case 'group-create':exists=true;return {id:'team'};
        case 'group-appearance':theme=r.theme;return true;
        case 'group-invite':assert.equal(r.person,people[1]);invited=true;return true;
        case 'group-answer':joined=r.accept;invited=false;return true;
        case 'group-open':return info();
        case 'group-history':return {messages,more:false};
        case 'group-file-list':if(fileListFails&&i===1)throw Error('File list unavailable');return file?[file]:[];
        case 'group-channel-create':channels.push({...r,id:'voice'});return {id:'voice'};
        case 'group-channel-rename':channels.find(c=>c.id===r.channel).name=r.name;return true;
        case 'group-channel-delete':channels.splice(channels.findIndex(c=>c.id===r.channel),1);return true;
        case 'group-voice-join':return {role:'host',selfId:'host',hostId:'host',peers:[{id:'host',name:'Саша',slot:0,micMuted:true,sharing:false}],
          groupVoice:{group:r.group,channel:r.channel},groupChannelName:channels.find(c=>c.id===r.channel).name,mixRoom:'group-test',usePeerIce:false};
        case 'group-send':messages.push({id:r.nonce,person:people[i],name:'Саша',at:Date.now(),text:r.text});return true;
        case 'group-file-offer':file={id:'file',name:'лист.txt',size:512,author:people[0],status:'available',canDownload:true};return true;
        case 'group-file-download':file={...file,status:'saved',canDownload:false,canReveal:true};return true;
        case 'group-role':members[1].role=r.role;return true;
        case 'group-transfer':offered=true;return true;
        case 'group-transfer-answer':offered=false;if(r.accept){owner=1;members[1].role='owner';members[0].role='admin';}return true;
        default:throw Error(r.op);
      }
    });
    await page.evaluate(({people,i})=>{
      const api=window.craftlink,original=api.direct;
      api.direct=async r=>{
        if(r.op.startsWith('group-'))return qaGroup(r);
        const result=await original(r);
        if(r.op==='state'){
          result.groups=await qaGroup({op:'summary'});
          result.friends=[{id:people[1-i],name:'Саша',state:'friend',devices:[],online:true}];
        }
        return result;
      };
      roomFixture.refresh();
    },{people,i});
    await page.click('#navGroups');
    assert.equal(await page.locator('#groupsTitle').textContent(),label('Группы'));
  }
  await host.click('#groupCreate');await host.fill('#groupField-name','Команда');await host.click('#groupEditSubmit');
  await host.locator('#groupChannelName').getByText('Лобби',{exact:false}).waitFor();
  const choose=(page,box,name)=>page.locator(box).getByRole('button',{name:label(name),exact:true}).click();
  const refresh=page=>page.evaluate(()=>roomFixture.refresh());
  await host.click('#groupOptions');await choose(host,'#groupManage','Оформление группы');
  await host.selectOption('#groupTheme','forest');await host.click('#groupAppearanceSave');
  await host.locator('#groupAppearance').waitFor({state:'hidden'});await host.click('#groupManageClose');
  await host.click('#groupMembersButton');await choose(host,'#groupManage','Пригласить друга');
  await host.selectOption('#groupField-person',people[1]);await host.click('#groupEditSubmit');await host.click('#groupManageClose');
  await refresh(guest);await choose(guest,'#groupInvites','Принять');
  await guest.locator('#groupChannelName').getByText('Лобби',{exact:false}).waitFor();
  await guest.fill('#groupInput','Ссылка https://example.org/game ');await guest.click('#groupEmoji summary');
  await guest.locator('#groupEmoji').getByRole('button',{name:'👍',exact:true}).click();
  assert.equal(await guest.inputValue('#groupInput'),'Ссылка https://example.org/game 👍');await guest.press('#groupInput','Enter');
  await guest.locator('#groupLog .chat-link-card').waitFor();await refresh(host);
  await host.locator('#groupLog .chat-link-card').waitFor();
  await host.click('#groupAttach');await host.locator('#groupFiles').getByText('лист.txt').waitFor();
  await refresh(guest);await guest.click('#groupShelf summary');await choose(guest,'#groupFiles','Скачать');
  await guest.locator('#groupFiles').getByRole('button',{name:label('Показать в папке')}).waitFor();
  fileListFails=true;await refresh(guest);await guest.locator('#groupRetry').waitFor();
  assert(await guest.locator('#groupLog .chat-link-card').isVisible());
  fileListFails=false;await guest.click('#groupRetry');await guest.locator('#groupRetry').waitFor({state:'hidden'});
  await host.click('#groupAddChannel');await host.fill('#groupField-name','Голос');await host.selectOption('#groupField-type','voice');await host.click('#groupEditSubmit');
  await host.locator('#groupVoiceJoin').waitFor();await host.click('[data-channel-settings="voice"]');await choose(host,'#groupManage','Переименовать канал');
  await host.fill('#groupField-name','Вечер');await host.click('#groupEditSubmit');await host.click('#groupManageClose');
  await host.locator('#groupVoiceTitle').getByText('Вечер',{exact:true}).waitFor();
  await host.click('[data-group-channel="common"]');await host.click('#groupMembersButton');
  for(const id of people)await host.locator('#groupManageBody').getByText('Саша · '+id.slice(-8),{exact:true}).waitFor();
  await host.click('[data-group-member="'+people[1]+'"]');
  await host.selectOption('#groupField-what','promote');await host.click('#groupEditSubmit');await host.click('#confirmYesBtn');
  await host.locator('#groupManageBody').getByText(label('Администратор'),{exact:true}).waitFor();
  await host.click('[data-group-member="'+people[1]+'"]');await host.selectOption('#groupField-what','transfer');await host.click('#groupEditSubmit');await host.click('#confirmYesBtn');
  await host.click('#groupManageClose');await refresh(guest);await choose(guest,'#groupInvites','Принять');await guest.click('#confirmYesBtn');
  await guest.click('#groupMembersButton');await guest.locator('#groupManageBody').getByText(label('Владелец')+' · '+label('Вы'),{exact:true}).waitFor();
  await guest.click('#groupManageClose');await refresh(host);
  online=false;await refresh(host);await host.waitForFunction(()=>document.querySelector('#groupInput').disabled);
  assert(await host.locator('#groupLog').getByText('Ссылка',{exact:false}).first().isVisible());
  const shots=process.env.LINK_UI_QA_IMAGES;
  if(shots){
    await guest.locator('#groupShelf').evaluate(s=>s.open=false);
    await fs.mkdir(process.env.LINK_UI_QA_IMAGES,{recursive:true});
    await guest.screenshot({path:path.join(process.env.LINK_UI_QA_IMAGES,'group-'+language+'.png')});
  }
  await guest.locator('#groupChannels [data-group-seat="live-seat"]').waitFor();
  await guest.click('[data-group-channel="voice"]');
  await guest.locator('#roomPage').waitFor();await guest.locator('#groupContext').waitFor();
  assert.equal(await guest.locator('html').getAttribute('data-theme'),'forest');
  await guest.click('#navFriends');assert.equal(await guest.locator('html').getAttribute('data-theme'),'default');
  await guest.click('#backToCall');assert.equal(await guest.locator('html').getAttribute('data-theme'),'forest');
  assert.equal(await guest.locator('#roomLabel').textContent(),'Вечер');
  await guest.click('[data-group-channel="common"]');await guest.locator('#groupComposer').waitFor();
  await guest.click('[data-group-channel="voice"]');await guest.locator('#roomPage').waitFor();
  assert.equal(commands.filter(r=>r.op==='group-voice-join').length,1);
  await guest.setViewportSize({width:740,height:650});
  await guest.click('#contextToggle');await guest.click('[data-group-channel="common"]');
  await guest.locator('#groupComposer').waitFor();
  assert(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await guest.click('#contextToggle');await guest.click('[data-group-channel="voice"]');await guest.locator('#roomPage').waitFor();
  assert.equal(commands.filter(r=>r.op==='group-voice-join').length,1);
  await guest.click('#leaveBtn');await guest.setViewportSize({width:1280,height:720});
  await guest.click('#navFriends');await guest.click('#linkHost');await guest.locator('#navGroups').click();
  await guest.locator('#backToCall').waitFor();await guest.click('#backToCall');await guest.locator('#roomPage').waitFor();
  assert.equal(await guest.locator('html').getAttribute('data-theme'),'default','standalone voice uses the personal theme');
  assert(commands.some(r=>r.op==='group-send'&&r.channel==='common'));
  console.log('PASS '+language+' groups: invitations, text, emoji, links, file menu and retry, channel management, roles, ownership, offline history, live people under channels, single-click voice and text navigation, 740px drawer.');
};
