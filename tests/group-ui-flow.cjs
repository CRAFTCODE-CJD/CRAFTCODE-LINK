'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const en=require('../src/renderer/l10n/en.json');

module.exports=async function verifyGroups(host,guest,people,language){
  const label=s=>language==='en'?en[s]:s;
  let exists=false,invited=false,joined=false,offered=false,owner=0,online=true,file=null,fileListFails=false,theme='personal',groupName='Команда',renameVersion=1;
  let revision=0,previousView='',fileVersion=0,outsiderOnline=false,guestCanRead=true;
  const members=[{id:people[0],name:'Саша',role:'owner'},{id:people[1],name:'Саша',role:'member'}];
  const channels=[{id:'common',name:'Лобби',type:'text',access:'all',allow:[]}],messages=[],commands=[];
  for(const [i,page] of [host,guest].entries()){
    const info=()=>{
      const key=JSON.stringify([members,channels,messages,file,groupName,theme,joined,offered,renameVersion,guestCanRead]);
      if(key!==previousView){previousView=key;revision++;}
      return {id:'team',revision,viewVersion:revision,fileVersions:{common:fileVersion},name:groupName,owner:people[owner],role:members[i].role,online:i===owner||online,transferring:offered,theme,appearanceVersion:1,renameVersion,
        voiceRooms:{voice:[{id:people[0],name:'Саша',seat:'live-seat',micMuted:true,sharing:false}]},
        members:members.slice(0,joined?2:1),channels:channels.filter(c=>i===0||guestCanRead||c.id!=='common').map(c=>c.type!=='text'?c:
          {...c,messageCount:messages.length,lastMessage:messages.at(-1)?.id||null,fileCount:file?1:0,lastFile:file?.id||null}),bans:[]};
    };
    await page.exposeFunction('qaGroup',async r=>{
      if(r.op==='summary')return {items:exists&&(i===0||joined)?[info()]:[],
        invites:invited&&i===1?[{id:'team',name:groupName,fromName:'Саша'}]:[],
        transfers:offered&&i===1?[{id:'team',name:groupName,fromName:'Саша'}]:[]};
      if(r.op==='outsider-presence')return outsiderOnline;
      commands.push(r);
      switch(r.op){
        case 'group-create':exists=true;return {id:'team'};
        case 'group-rename':assert(['owner','admin'].includes(members[i].role));assert.equal(r.profileId,people[i]);groupName=r.name;return true;
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
        case 'group-file-offer':file={id:'file',name:'лист.txt',size:512,author:people[0],status:'available',canDownload:true};fileVersion++;return true;
        case 'group-file-download':file={...file,status:'saved',canDownload:false,canReveal:true};fileVersion++;return true;
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
          result.friends.push({id:'f'.repeat(64),name:'Сосед',state:'friend',devices:[],online:await qaGroup({op:'outsider-presence'})});
          window.qaGroupSnapshots=(window.qaGroupSnapshots||0)+1;
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
  await host.click('#groupOptions');await choose(host,'#groupManage','Переименовать группу');
  assert.equal(await host.locator('#groupField-name').getAttribute('maxlength'),'60');
  await host.fill('#groupField-name','   ');await host.click('#groupEditSubmit');
  assert(await host.locator('#groupEdit').isVisible());assert(!commands.some(r=>r.op==='group-rename'));
  assert.equal(await host.locator('#groupField-name').evaluate(n=>n.validationMessage),label('Введите название группы.'));
  await host.fill('#groupField-name','Вечерние игры');await host.press('#groupField-name','Enter');
  await host.locator('#groupEdit').waitFor({state:'hidden'});await host.locator('#groupsTitle').getByText('Вечерние игры',{exact:true}).waitFor();
  await host.click('#groupManageClose');
  await host.click('#groupOptions');await choose(host,'#groupManage','Оформление группы');
  await host.selectOption('#groupTheme','forest');await host.click('#groupAppearanceSave');
  await host.locator('#groupAppearance').waitFor({state:'hidden'});await host.click('#groupManageClose');
  await host.click('#groupMembersButton');await choose(host,'#groupManage','Пригласить друга');
  await host.selectOption('#groupField-person',people[1]);await host.click('#groupEditSubmit');await host.click('#groupManageClose');
  await refresh(guest);await choose(guest,'#groupInvites','Принять');
  await guest.locator('#groupChannelName').getByText('Лобби',{exact:false}).waitFor();
  const readCount=op=>commands.filter(r=>r.op===op).length;
  const reads=()=>['group-open','group-history','group-file-list'].map(readCount);
  await guest.locator('#groupInput:enabled').waitFor();
  const beforePresence=reads();
  for(let n=0;n<20;n++){
    outsiderOnline=!outsiderOnline;
    const seen=await guest.evaluate(()=>window.qaGroupSnapshots);
    await refresh(guest);
    await guest.waitForFunction(previous=>window.qaGroupSnapshots>previous,seen);
    await guest.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  }
  assert.deepEqual(reads(),beforePresence,'unrelated presence updates must not read the selected group');
  await guest.click('#groupOptions');assert.equal(await guest.locator('#groupManage').getByRole('button',{name:label('Переименовать группу'),exact:true}).count(),0);await guest.click('#groupManageClose');
  await guest.fill('#groupInput','Ссылка https://example.org/game ');await guest.click('#groupEmoji summary');
  await guest.locator('#groupEmoji').getByRole('button',{name:'👍',exact:true}).click();
  assert.equal(await guest.inputValue('#groupInput'),'Ссылка https://example.org/game 👍');await guest.press('#groupInput','Enter');
  await guest.locator('#groupLog .chat-link-card').waitFor();await refresh(host);
  await host.locator('#groupLog .chat-link-card').waitFor();
  guestCanRead=false;await refresh(guest);
  await guest.locator('#groupText').waitFor({state:'hidden'});
  assert.equal(await guest.locator('#groupLog article').count(),0,'revoked channel content is cleared');
  guestCanRead=true;await refresh(guest);
  await guest.locator('#groupLog .chat-link-card').waitFor();
  const originalMessage=messages[0];
  messages[0]={...originalMessage,id:'long-link',name:'Ш'.repeat(48),text:'https://example.org/'+'long-segment/'.repeat(24)};
  await refresh(host);
  await require('./compact-group-chat-flow.cjs')(host);
  messages[0]=originalMessage;
  await refresh(host);
  await host.click('#groupAttach');await host.locator('#groupFiles').getByText('лист.txt').waitFor();
  await refresh(guest);await guest.click('#groupShelf summary');await choose(guest,'#groupFiles','Скачать');
  await guest.locator('#groupFiles').getByRole('button',{name:label('Показать в папке')}).waitFor();
  const beforeFile=reads();
  fileListFails=true;fileVersion++;await refresh(guest);await guest.locator('#groupRetry').waitFor();
  assert.deepEqual(reads(),[beforeFile[0],beforeFile[1],beforeFile[2]+1],'local file progress only refreshes the shelf');
  assert(await guest.locator('#groupLog .chat-link-card').isVisible());
  fileListFails=false;await guest.click('#groupRetry');await guest.locator('#groupRetry').waitFor({state:'hidden'});
  await host.click('#groupAddChannel');await host.fill('#groupField-name','Голос');await host.selectOption('#groupField-type','voice');await host.click('#groupEditSubmit');
  await host.locator('#groupVoiceJoin').waitFor();await host.click('[data-channel-settings="voice"]');await choose(host,'#groupManage','Переименовать канал');
  await host.fill('#groupField-name','Вечер');await host.click('#groupEditSubmit');await host.click('#groupManageClose');
  await host.locator('#groupVoiceTitle').getByText('Вечер',{exact:true}).waitFor();
  await host.click('[data-group-channel="common"]');await host.click('#groupMembersButton');
  await host.fill('#groupMemberSearch',people[1].slice(-8));
  assert.equal(await host.locator('#groupManage .group-member:visible').count(),1);
  await host.fill('#groupMemberSearch','несуществующий участник');await host.locator('#groupManageBody').getByText(label('Участники не найдены.'),{exact:true}).waitFor();
  await host.fill('#groupMemberSearch','Саша');
  await host.locator('#groupMemberSearch').focus();await refresh(host);
  assert.equal(await host.inputValue('#groupMemberSearch'),'Саша');assert.equal(await host.locator('#groupManage .group-member:visible').count(),2);
  await host.fill('#groupMemberSearch','');
  for(const id of people)await host.locator('#groupManageBody').getByText('Саша · '+id.slice(-8),{exact:true}).waitFor();
  await host.click('[data-group-member="'+people[1]+'"]');
  await host.selectOption('#groupField-what','promote');await host.click('#groupEditSubmit');await host.click('#confirmYesBtn');
  await host.locator('#groupManageBody').getByText(label('Администратор'),{exact:true}).waitFor();
  await refresh(guest);await guest.click('#groupOptions');
  renameVersion=undefined;await refresh(guest);
  await guest.waitForFunction(()=>[...document.querySelectorAll('#groupManage button')].some(b=>b.disabled&&b.title));
  assert(await guest.locator('#groupManage').getByRole('button',{name:label('Переименовать группу'),exact:true}).isDisabled());
  renameVersion=1;await refresh(guest);await choose(guest,'#groupManage','Переименовать группу');
  await guest.fill('#groupField-name','Друзья в субботу');
  online=false;await refresh(guest);await guest.waitForFunction(()=>document.querySelector('#groupEditSubmit').disabled);
  assert.equal(await guest.inputValue('#groupField-name'),'Друзья в субботу');
  online=true;offered=true;await refresh(guest);
  await guest.locator('#groupEditError').getByText(label('Идёт передача группы.'),{exact:true}).waitFor();
  offered=false;members[1].role='member';await refresh(guest);
  await guest.locator('#groupEditError').getByText(label('Нет доступа к этому действию.'),{exact:true}).waitFor();
  members[1].role='admin';await refresh(guest);await guest.waitForFunction(()=>!document.querySelector('#groupEditSubmit').disabled);
  await guest.press('#groupField-name','Enter');await guest.locator('#groupEdit').waitFor({state:'hidden'});await guest.click('#groupManageClose');
  await refresh(host);await host.locator('#groupsTitle').getByText('Друзья в субботу',{exact:true}).waitFor();
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
  console.log('PASS '+language+' groups: group rename with validation, permissions, legacy host, offline and handoff guards; member search; invitations, text, emoji, links, file menu and retry, channel management, roles, ownership, offline history, live people under channels, single-click voice and text navigation, 740px drawer.');
};
