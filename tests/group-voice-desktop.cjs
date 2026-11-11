'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const voice=require('./received-voice.cjs');
const {addFriend,optIn,count}=require('./room-controls-desktop.cjs');

function screen(){
  navigator.mediaDevices.getDisplayMedia=async()=>{
    const canvas=document.createElement('canvas');canvas.width=480;canvas.height=270;
    const ctx=canvas.getContext('2d');let n=0;
    function paint(){ctx.fillStyle=n%2?'#034455':'#1f3c35';ctx.fillRect(0,0,480,270);ctx.fillStyle='#fff';ctx.fillRect(n++*8%400,50,60,60);}
    paint();const stream=canvas.captureStream(15),timer=setInterval(paint,70);
    const track=stream.getVideoTracks()[0],stop=track.stop.bind(track);
    track.stop=()=>{clearInterval(timer);stop();};return stream;
  };
}
async function video(page){
  let previous,last;
  for(let i=0;i<110;i++){
    last=await page.evaluate(async()=>{
      for(const pc of window.qaConnections){
        if(pc.connectionState!=='connected')continue;
        const rows=await pc.getStats();
        const r=[...rows.values()].find(r=>r.type==='inbound-rtp'&&r.kind==='video'&&r.framesDecoded>2);
        if(r)return {bytes:r.bytesReceived,frames:r.framesDecoded,width:r.frameWidth,height:r.frameHeight};
      }return null;
    });
    if(last && previous && last.frames>previous.frames && last.bytes>previous.bytes)return [previous,last];
    if(last)previous=last;
    await new Promise(r=>setTimeout(r,220));
  }
  throw Error('No decoded group screen: '+JSON.stringify(last));
}
async function invite(host,other,name){
  await host.click('#groupMembersButton');
  await host.locator('#groupManage').getByRole('button',{name:'Пригласить друга'}).click();
  await host.selectOption('#groupField-person',{label:name});await host.click('#groupEditSubmit');
  await host.locator('#groupEdit').waitFor({state:'hidden'});
  await host.click('#groupManageClose');
  await other.click('#navGroups');
  await other.locator('#groupInvites').getByRole('button',{name:'Принять'}).click();
  await other.locator('#groupInput').waitFor();
}
async function join(page){
  await page.click('#navGroups');
  await page.locator('button[data-group-channel]').filter({has:page.locator('svg')}).first().click();
  await page.locator('#leaveBtn').waitFor();
}
async function switchRooms(a,b){
  const api=(page,op,args={})=>page.evaluate(([op,args])=>window.craftlink.direct({op,...args}),[op,args]);
  const choose=async(page,channel)=>{
    await page.click('#navGroups');
    await page.locator('button[data-group-channel="'+channel+'"]').click();
  };
  for(const page of [a,b])await optIn(page);
  const {id}=await api(a,'group-create',{name:'QA transitions'});
  const view=await api(a,'group-open',{id}),first=view.channels.find(c=>c.type==='voice').id;
  const {id:second}=await api(a,'group-channel-create',{id,name:'Second',type:'voice'});
  const {id:removed}=await api(a,'group-channel-create',{id,name:'Removed',type:'voice'});
  await api(a,'group-invite',{id,person:(await api(b,'state')).me.id});await b.click('#navGroups');
  await b.locator('#groupInvites').getByRole('button',{name:'Принять'}).click();
  await a.click('#navFriends');await a.locator('#workspaceContacts').getByRole('button',{name:'Позвонить',exact:true}).click();
  await b.click('#peerAccept');await count(a,2);await count(b,2);await voice(b,'0');
  await choose(b,removed);await b.locator('#confirmYesBtn').waitFor();
  await api(a,'group-channel-delete',{id,channel:removed});await b.click('#confirmYesBtn');
  await count(a,2);await count(b,2);
  console.log('Deleted channel refused; private call still carries voice',await voice(b,'0'));
  for(const channel of [first,second]){
    await choose(b,channel);await b.click('#confirmYesBtn');await count(a,1);await count(b,1);
    await choose(a,channel);await a.click('#confirmYesBtn');await count(a,2);await count(b,2);
    console.log('Both admitted to selected channel; decoded voice received',await voice(a,'0'));
  }
  assert.equal(await b.locator('#roomLabel').textContent(),'Second');
}
async function run({a,b,open,create}){
  if(process.env.LINK_QA_GROUP_SWITCH==='1')return switchRooms(a.page,b.page);
  const c=await open('vera');await create(c,'Вера');
  await addFriend(a,c,'Вера');
  for(const p of [a.page,b.page,c.page])await optIn(p);
  await a.page.click('#navGroups');await a.page.click('#groupCreate');
  await a.page.fill('#groupField-name','Свои');await a.page.click('#groupEditSubmit');
  await invite(a.page,b.page,'Борис');await invite(a.page,c.page,'Вера');
  console.log('PASS owner created group and both members explicitly joined');
  const ids=await Promise.all([a,b,c].map(client=>client.page.evaluate(async()=>(await window.craftlink.direct({op:'state'})).me.id)));
  assert(ids.every(id=>/^[a-f0-9]{64}$/.test(id)));assert.equal(new Set(ids).size,3);
  const member=(page,id)=>page.locator('#groupRoster .feed-member[data-person="'+id+'"]');
  const action=(page,name)=>page.locator('#contactActions').getByRole('button',{name,exact:true});
  await member(b.page,ids[2]).click();await action(b.page,'Скопировать мою карточку').click();
  const borisCard=await b.app.evaluate(()=>globalThis.testClipboard);
  const incorrect=await c.app.evaluate(()=>globalThis.testClipboard);
  assert.match(incorrect,/^CCF1:/);
  await member(c.page,ids[1]).focus();await c.page.keyboard.press('Shift+F10');
  await c.page.locator('#contactChoices').getByText('ID · '+ids[1],{exact:true}).waitFor();
  assert.equal(await action(c.page,'Личный чат').count(),0);
  await action(c.page,'Вставить карточку друга').click();
  await c.page.fill('#directCode',incorrect);await c.page.click('#sendCardRequest');
  await c.page.locator('#directCode[aria-invalid="true"]').waitFor();
  assert.match(await c.page.textContent('#directMessage'),/другому участнику/);
  await c.page.fill('#directCode',borisCard);await c.page.click('#sendCardRequest');
  await b.page.waitForFunction(async id=>(await window.craftlink.direct({op:'state'})).requests.some(p=>p.id===id),ids[2],{timeout:65000});
  await member(b.page,ids[2]).click();await action(b.page,'Открыть заявки').click();
  await b.page.locator('#inRequests').getByRole('button',{name:'Принять',exact:true}).click({timeout:65000});
  await c.page.waitForFunction(async id=>(await window.craftlink.direct({op:'state'})).friends.some(f=>f.id===id&&f.state==='friend'),ids[1]);
  await c.page.click('#navGroups');
  console.log('PASS two previously unconnected group members explicitly exchange signed cards, reject another profile and accept the request before messaging.');
  await join(b.page);
  await c.page.locator('#groupChannels .group-voice-member').filter({hasText:'Борис'}).waitFor();
  assert.equal(await c.page.locator('#leaveBtn').isVisible(),false);
  await c.page.locator('#groupRoster .feed-member').filter({hasText:'Борис'}).click();
  await c.page.locator('#dmTitle').getByText('Борис',{exact:true}).waitFor();
  await c.page.locator('#dmSharedList button').getByText('Свои',{exact:true}).waitFor();
  await c.page.fill('#dmInput','Мы в голосовом канале');await c.page.press('#dmInput','Enter');
  await c.page.locator('#dmLog').getByText('Доставлено',{exact:true}).waitFor();
  console.log('PASS visible voice roster outside the call and a private message from the member list.');
  await join(c.page);
  await count(b.page,2);await count(c.page,2);
  assert.equal(await a.page.locator('#leaveBtn').isVisible(),false);
  const fromHost=await voice(c.page,'0'),fromGuest=await voice(b.page,'3');
  const peerTile=c.page.locator('.voice-tile').filter({has:c.page.locator('.voice-name',{hasText:'Борис'})});
  await peerTile.locator('.tile-sound-menu').click();
  const volume=c.page.locator('#participantSoundMenu input[data-role="voice"]');
  await volume.evaluate(el=>{el.value='58';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
  await c.page.keyboard.press('Escape');
  await c.page.waitForFunction(async()=>(await window.craftlink.direct({op:'state'})).friends.find(f=>f.name==='Борис')?.mix?.voice?.volume===58);
  console.log('PASS group owner outside call, two members have decoded audio',fromHost,fromGuest);
  await b.page.click('#shareBtn');await b.page.locator('#sourcesGrid button').first().click();
  if(await b.page.locator('#withSystemAudio').isEnabled())await b.page.uncheck('#withSystemAudio');
  await b.page.click('#startShare');const received=await video(c.page);
  console.log('PASS group screen decoded on other member',received);
  await c.page.locator('#voiceGrid .voice-tile').filter({hasText:'Борис'}).waitFor();
  await join(a.page);await count(c.page,3);
  await b.page.click('#leaveBtn');await count(c.page,2);await count(a.page,2);
  const afterElection=await voice(a.page,'0');await voice(c.page,'6');
  console.log('PASS remaining members have fresh voice after former media host left',afterElection);
  const dir=process.env.LINK_VISUAL_DIR||path.join(__dirname,'../out/qa/group-media');
  await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'media.json'),JSON.stringify({fromHost,fromGuest,received,afterElection,verifiedFriendVolume:58},null,2));
  await c.page.click('#navFriends');
  const contact=c.page.locator('#workspaceContacts [data-person="'+ids[1]+'"]');
  await contact.getByRole('button',{name:/Действия с контактом/}).click();
  await action(c.page,'Заблокировать').click();await c.page.click('#confirmYesBtn');
  await c.page.click('#navChats');await c.page.locator('#dmIdle').waitFor();
  assert.equal(await c.page.locator('#dmList [data-person="'+ids[1]+'"]').count(),0);
  await c.page.click('#navGroups');
  await c.page.locator('#groupChannels [data-group-channel]').filter({hasText:'общий'}).click();
  await member(c.page,ids[1]).click();assert.equal(await action(c.page,'Личный чат').count(),0);
  await action(c.page,'Заблокированные контакты').click();
  await c.page.locator('#workspaceContacts').getByRole('button',{name:'Разблокировать'}).click();
  await c.page.click('#backToCall');await count(c.page,2);
  await c.page.locator('.voice-tile').filter({hasText:'Анна'}).locator('.tile-sound-menu').click();
  await c.page.locator('#participantSoundMenu').getByRole('button',{name:'Карточка участника'}).click();
  await action(c.page,'Личный чат').click();await c.page.locator('#dmTitle').getByText('Анна',{exact:true}).waitFor();
  await c.page.click('#backToCall');await count(c.page,2);
  console.log('PASS block removes DM access and clears the selected chat, blocked group member leads to unblock, verified room member opens the correct DM, return keeps the voice connection.');
}
module.exports={run,screen};
