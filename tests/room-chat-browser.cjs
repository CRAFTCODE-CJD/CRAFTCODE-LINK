'use strict';
const {roomMix,roomChat,closeRoomMenu}=require('./participant-controls.cjs');
// The complete renderer runs in two headless pages. Only the native bridge,
// picker and room signaling are fixtures. The file and its SCTP channel are real.
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {chromium}=require(require.resolve('playwright',{paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||__dirname]}));
const {ShelfStorage}=require('../src/files/storage.cjs');
const {GameRoom}=require('../src/game/room.cjs');
const dictionary=require('../src/renderer/l10n/en.json');
const language=process.env.LINK_QA_LANG==='en'?'en':'ru';
function tr(key){
  assert.equal(typeof dictionary[key],'string','Missing English text: '+key);
  return language==='en'?dictionary[key]:key;
}
const source=path.resolve(__dirname,'../src/renderer');
const origin='http://127.0.0.1:49971';
const ids=['host','guest'];
const peers=ids.map((id,slot)=>({id,slot,name:slot?'Борис':'Анна',micMuted:true,sharing:false}));
const friendKeys=ids.map((_,i)=>(i+1).toString(16).padStart(64,'0'));
const filename='CRAFTCODE-LINK-developer-preview-Windows-x64-with-a-long-file-name-2026.11.zip';
async function checkWelcomePalettes(page,screenshot){
  const card=page.locator('#profileWelcome');
  const actions=card.locator('.welcome-actions button');
  async function contrast(button,focus=false){
    const scores=await button.evaluate((el,focus)=>{
      const style=getComputedStyle(el),palette=getComputedStyle(el.closest('#profileWelcome'));
      const canvas=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
      function luminance(color){
        canvas.fillStyle=color;canvas.fillRect(0,0,1,1);
        const rgb=Array.from(canvas.getImageData(0,0,1,1).data).slice(0,3)
          .map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);
        return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
      }
      const token=name=>palette.getPropertyValue(name).trim();
      const gradient=[token('--surface'),'color-mix(in srgb, '+token('--accent')+' 9%, '+token('--panel')+')'];
      function minContrast(ink,backgrounds){
        const a=luminance(ink);
        return Math.min(...backgrounds.map(color=>{
          const b=luminance(color);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        }));
      }
      const backgrounds=style.backgroundColor==='rgba(0, 0, 0, 0)'?gradient:[style.backgroundColor];
      const text=minContrast(style.color,backgrounds);
      if(!focus)return {text};
      return {text,visible:el.matches(':focus-visible')&&parseFloat(style.outlineWidth)>=2&&style.outlineStyle==='solid',
        ring:minContrast(style.outlineColor,gradient)};
    },focus);
    assert(scores.text>=4.5,'button text '+JSON.stringify(scores));
    if(focus)assert(scores.visible&&scores.ring>=3,'keyboard focus '+JSON.stringify(scores));
    return scores.text;
  }
  const measured={};
  for(const name of await card.locator('input').evaluateAll(radios=>radios.map(radio=>radio.value))){
    const choice=card.locator('label:has([value="'+name+'"])');
    await choice.click();
    const scores=[];
    for(const button of await actions.all())scores.push(await contrast(button));
    for(const button of await actions.all()){
      await button.hover();scores.push(await contrast(button));
    }
    await choice.hover();await choice.locator('input').focus();
    for(const button of await actions.all()){
      await page.keyboard.press('Tab');
      scores.push(await contrast(button,true));
      if(name==='paper'&&await button.getAttribute('id')==='welcomeDone')await screenshot('welcome-paper-focus');
    }
    measured[name]=Math.min(...scores).toFixed(2);
  }
  console.log('PASS welcome contrast, resting, hover and keyboard, minimum by palette',measured);
}
async function run(){
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'link-room-chat-'));
  const bytes=randomBytes(2*1024*1024+27),picked=path.join(temporary,filename);
  const stores=[],pages=[],errors=[],games=[];
  const people=peers.map((p,i)=>({name:p.name,id:friendKeys[i],device:friendKeys[i]}));
  let browser;
  try{
    await fs.writeFile(picked,bytes);
    browser=await chromium.launch({channel:process.env.LINK_QA_BROWSER||undefined,args:['--allow-loopback-in-peer-connection','--mute-audio','--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
    const context=await browser.newContext({viewport:{width:1280,height:720}});
    if(process.env.LINK_QA_JABBER_CALL_CARD==='1'){
      const {Fixture}=require('./xmpp-fixture.cjs');
      const {providers}=await import('../src/renderer/providers.mjs');
      const network=new Fixture({});
      await context.routeWebSocket('**/*',socket=>{
        if(socket.url()===providers.jabberru.service)network.route(socket,'jabber.ru');
        else socket.close();
      });
    }
    await context.addInitScript(language=>localStorage.setItem('craftcode.language',language),language);
    if(process.env.LINK_QA_THEME)await context.addInitScript(theme=>localStorage.setItem('craftlink.appearance.theme',theme),process.env.LINK_QA_THEME);
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin||!/^\/(?:[a-z\d-]+\.(?:html|mjs|css)|(?:assets|vendor|l10n)\/[a-z\d.-]+)$/i.test(url.pathname))return route.abort();
      const ext=path.extname(url.pathname),types={'.css':'text/css','.mjs':'text/javascript','.html':'text/html; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.wav':'audio/wav','.ttf':'font/ttf'};
      return route.fulfill({contentType:types[ext],body:await fs.readFile(path.join(source,url.pathname.slice(1)))});
    });
    for(const [slot,id] of ids.entries()){
      const dir=path.join(temporary,id);await fs.mkdir(dir);
      const storage=new ShelfStorage(dir);stores.push(storage);
      const page=await context.newPage();pages.push(page);
      page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
      const me=people[slot],other=people[1-slot];
      const game=new GameRoom({self:()=>me,links:key=>key===other.id&&games[1-slot]?[{card:other,
        send:packet=>{games[1-slot].receive(me,structuredClone(packet));return true;}}]:[],changed(){},event(){},quiet:()=>false});
      games[slot]=game;
      await page.exposeFunction('gameCommand',async r=>{
        if(r.op==='game-create')game.create(r.title,r.listed);
        if(r.op==='game-invite')game.invite(r.id);
        if(r.op==='game-answer')game.answer(r.id,r.yes);
        if(r.op==='game-review')game.review(r.device,r.yes,r.actionId);
        if(r.op==='game-leave')game.leave();
        if(r.op==='game-chat')game.chat(r.text);
        if(r.op==='game-clear-chat')game.clearChat(r.room,r.through);
        return {...game.state(),network:{phase:'off'},returns:[]};
      });
      await page.exposeFunction('fileCommand',async r=>{
        if(r.op==='open')return id;
        assert.equal(r.scope,id);
        switch(r.op){
          case 'offer':return storage.offer(picked);
          case 'selected-file':{
            const disk=slot===0&&r.name==='room-map.bin';
            const meta=disk?await storage.offer(path.join(temporary,r.name)):storage.memory(r.name,Buffer.from(r.bytes,'base64'));
            return {...meta,memoryOnly:!disk,caption:r.caption};
          }
          case 'begin':return storage.begin(r.meta,'QA');
          case 'read-range':return (await storage.readBytes(r.id,r.pos,r.length)).toString('base64');
          case 'put-range':return storage.putBytes(r.id,r.pos,Buffer.from(r.bytes,'base64'));
          case 'put':return storage.put(r.id,r.pos,r.data);
          case 'read':return storage.read(r.id,r.pos);
          case 'remove':return storage.remove(r.id);
          case 'reveal':assert.equal(storage.location(r.id),slot?path.join(dir,'CRAFTCODE LINK','QA',filename):picked);return true;
          case 'clip':return storage.clip(r.kind,Buffer.from(r.bytes,'base64'));
          case 'camera':return true;
          case 'camera-end':return;
          case 'preview':{const data=await storage.preview(r.id,r.meta);return {...data,bytes:data.bytes.toString('base64')};}
          case 'cancel':return storage.cancel(r.id);
          case 'clear':return storage.close();
          default:throw Error(r.op);
        }
      });
      await page.addInitScript(({slot,id,peers,me,other})=>{
        const signals=new BroadcastChannel('qa-renderer-room');
        const info={role:slot?'guest':'host',selfId:id,hostId:'host',peers:[peers[slot]],direct:true,usePeerIce:false};
        let event=()=>{};
        const enter=()=>event({type:'direct-host',info});
        const roster=()=>event({type:'roster',peers:structuredClone(peers)});
        const presence=(peerId,update)=>{Object.assign(peers.find(p=>p.id===peerId),update);roster();};
        window.roomFixture={enter,roster,emit:packet=>event(packet),refresh:()=>event({type:'direct-updated'}),
          changeOwner:id=>{me.id=id;event({type:'direct-updated'});}};
        signals.onmessage=({data})=>{if(data.presence)presence(data.from,data.presence);else if(!data.to||data.to===id)event(data.event);};
        window.craftlink={
          onEvent:fn=>{event=fn;},
          direct:async r=>{
            if(r.op==='host'){enter();return true;}
            const friends=window.qaLanFriends?[{...other,state:'friend',online:true,game:true}]:[];
            return {me,nics:[],friends,near:[],requests:[],audience:{mode:'friends',ids:[]},game:await gameCommand(r)};
          },
          async offerSelectedFile(target,file,caption){
            if(target.type!=='room'||target.scope!==id)throw Error('Unexpected file destination');
            return fileCommand({op:'selected-file',scope:target.scope,name:file.name,caption,bytes:new Uint8Array(await file.arrayBuffer()).toBase64()});
          },
          files:async r=>{
            if(r.op==='put-range'||r.op==='clip')r={...r,bytes:r.bytes.toBase64()};
            const result=await fileCommand(r);
            if(r.op==='preview')return {...result,bytes:Uint8Array.fromBase64(result.bytes)};
            return r.op==='read-range'?Uint8Array.fromBase64(result):result;
          },
          async sendSignal({data,peerId}){signals.postMessage({to:peerId,event:{type:'signal',from:id,data}});},
          async sendChat({text}){const message={type:'chat',from:id,name:me.name,text,time:Date.now()};event(message);signals.postMessage({event:message});},
          async environment(){return {platform:'win32',osRelease:'10.0.22631',version:'0.7.7'};},
          async graphicsStatus(){return {automatic:true,applied:true,encode:'enabled'};},
          async internet(){},async setTrayState(){},async leaveRoom(){},async setPresence(update){
            if(window.qaScreenCapture){Object.assign(peers[slot],update);signals.postMessage({from:id,presence:update});}
          }
        };
      },{slot,id,peers,me,other});
      await page.goto(origin+'/index.html');
      await page.waitForSelector('#profileLabel');
      await page.waitForFunction(name=>document.querySelector('#profileLabel').textContent===name,me.name).catch(async error=>{
        throw Error(error.message+' '+JSON.stringify({errors,toast:await page.textContent('#toast')}));
      });
    }
    const [host,guest]=pages;
    if(process.env.LINK_QA_JABBER_CALL_CARD==='1'){
      for(const [index,page] of pages.entries()){
        await page.evaluate(()=>{
          const direct=craftlink.direct;
          craftlink.direct=async request=>{
            const result=await direct(request);
            if(request.op==='state')result.paused=true;
            return result;
          };
          roomFixture.refresh();
        });
        await page.click('#settingsBtn');await page.click('[data-pane=profile]');
        await page.click('#settingsGuest summary');await page.click('#settingsLogin');
        await page.fill('#accountJid',(index?'boris':'anna')+'@jabber.ru');
        await page.fill('#accountPass','fixture-password');await page.uncheck('#rememberAccount');
        await page.click('#loginAccount');await page.locator('#onlineActive').waitFor().catch(async error=>{
          throw Error(error.message+' '+JSON.stringify(await page.locator('#onlineError,#onlineStatus,#toast').allTextContents())+' '+errors.join(', '));
        });
      }
      await host.fill('#contactJid','boris@jabber.ru');await host.click('#addContactForm button');
      await guest.locator('#onlineRequests button').first().click();
      for(const page of pages)await page.click('#closeInternet');
      await host.locator('#workspaceContacts').getByRole('button',{name:tr('Позвонить'),exact:true}).click();
      await guest.locator('#hubAccept').waitFor();
      for(const [index,page] of pages.entries()){
        assert.equal(await page.locator('#callState').textContent(),tr(index?'Входящий звонок':'Исходящий звонок'));
        assert.equal(await page.locator('#callDialog.is-ringing[open]').count(),1);
        if(process.env.LINK_UI_QA_IMAGES){
          await fs.mkdir(process.env.LINK_UI_QA_IMAGES,{recursive:true});
          await page.screenshot({animations:'disabled',path:path.join(process.env.LINK_UI_QA_IMAGES,'jabber-'+(index?'incoming':'outgoing')+'-'+language+'.png')});
        }
      }
      await guest.click('#hubDecline');await host.locator('#callDialog').waitFor({state:'hidden'});
      assert.deepEqual(errors,[]);console.log('PASS '+language+' Jabber outgoing, incoming and declined through two isolated XMPP clients.');return;
    }
    if(process.env.LINK_QA_FRIEND_DISCOVERY==='1'){
      await require('./friend-discovery-flow.cjs')(host,friendKeys,tr);
      assert.deepEqual(errors,[]);return;
    }
    if(process.env.LINK_QA_GAME_LAUNCHER==='1'){
      await require('./game-launcher-flow.cjs')(host,tr);
      assert.deepEqual(errors,[]);return;
    }
    if(process.env.LINK_QA_ROOM_CONTACTS==='1'){
      await require('./room-contact-flow.cjs')(host,guest,friendKeys,language);
      assert.deepEqual(errors,[]);return;
    }
    if(process.env.LINK_QA_WELCOME==='1'){
      await host.locator('#profileWelcome').waitFor();
      assert.equal(await host.locator('dialog:modal').count(),0);
      await host.click('#navGame');assert.equal(await host.locator('#profileWelcome').isVisible(),false);
      await host.click('#navFriends');
      await checkWelcomePalettes(host,screenshot);
      assert.equal(await host.getAttribute('#profileWelcome','data-theme'),'paper');
      assert.equal(await host.getAttribute('html','data-theme'),'default');
      await screenshot('welcome-paper');
      await host.click('#welcomeProfile');await host.locator('#settingsDialog:modal #avatarEditor').waitFor();
      assert.equal(await host.inputValue('#profileTheme'),'paper');
      await host.selectOption('#chatWallpaper','aurora');
      const preview=host.locator('#chatAppearancePreview');
      const animation=()=>preview.evaluate(el=>getComputedStyle(el).animationName);
      for(const name of ['paper','cobalt','terracotta']){
        await host.selectOption('#profileTheme',name);
        assert.equal(await preview.getAttribute('data-theme'),name);
        await preview.scrollIntoViewIfNeeded();await screenshot('preview-'+name);
      }
      await host.emulateMedia({reducedMotion:'no-preference'});assert.equal(await animation(),'aurora-drift');
      await host.emulateMedia({reducedMotion:'reduce'});assert.equal(await animation(),'none');
      assert.match(await preview.evaluate(el=>getComputedStyle(el).backgroundImage),/radial-gradient/);
      await host.emulateMedia({reducedMotion:'no-preference'});
      await host.click('[data-pane=reading]');await host.check('#reduceMotion');assert.equal(await animation(),'none');
      await host.uncheck('#reduceMotion');await host.click('#closeSettingsDialog');
      await host.reload();await host.waitForFunction(()=>document.querySelector('#profileLabel').textContent==='Анна');
      assert.equal(await host.locator('#profileWelcome').isVisible(),false);
      assert.equal(await host.inputValue('#profileTheme'),'terracotta');assert.equal(await host.inputValue('#chatWallpaper'),'aurora');
      await host.evaluate(()=>{
        const direct=window.craftlink.direct;
        window.craftlink.direct=async request=>{
          if(request.op==='chat-history'){
            return {messages:['Соберёмся вечером?','Да, до встречи!'].map((text,i)=>({
              id:String(i),text,direction:i?'out':'in',status:'delivered',time:Date.UTC(2026,10,13,15,10+i)
            })),hasMore:false};
          }
          const result=await direct(request);
          if(request.op==='state')for(const contact of result.friends)contact.chat={supported:true,files:true};
          return result;
        };
        window.qaLanFriends=true;roomFixture.refresh();
      });
      await host.locator('#quickPeople button').first().click();await host.locator('#dmLog article').nth(1).waitFor();
      assert.equal(await host.locator('#dmScroll').evaluate(el=>getComputedStyle(el).animationName),'aurora-drift');
      await screenshot('chat-terracotta');
      await guest.locator('#welcomeThemes label:has([value=cobalt])').click();
      await guest.locator('#welcomeSkip').click();await guest.reload();
      await guest.waitForFunction(()=>document.querySelector('#profileLabel').textContent==='Борис');
      assert.equal(await guest.locator('#profileWelcome').isVisible(),false);
      assert.notEqual(await guest.inputValue('#profileTheme'),'cobalt');
      assert.deepEqual(errors,[]);console.log('PASS '+language+' welcome on Home, skip, theme, profile editor, reload and a separate profile.');return;
    }
    if(process.env.LINK_QA_SOUNDS==='1'){
      await require('./notification-sound-flow.cjs')(host,friendKeys);
      assert.deepEqual(errors,[]);return;
    }
    if(process.env.LINK_QA_SHELL==='1'){
      await require('./workspace-shell-flow.cjs')(host,language);
      assert.deepEqual(errors,[]);return;
    }
    if(process.env.LINK_QA_DRAFTS==='1'){
      await require('./chat-drafts-flow.cjs')(host);
      assert.deepEqual(errors,[]);return;
    }
    if(process.env.LINK_QA_GROUP_UI==='1'){
      await require('./group-ui-flow.cjs')(host,guest,friendKeys,language);
      assert.deepEqual(errors,[]);return;
    }
    if(process.env.LINK_QA_ROOM_MIC==='1'){
      await require('./room-microphone-flow.cjs')(host,guest);
      assert.deepEqual(errors,[]);return;
    }
    if(process.env.LINK_QA_ROOM_STREAM==='1'){
      await require('./room-stream-view.cjs')(host,guest,language,tr);
      assert.deepEqual(errors,[]);return;
    }
    // Keep the reader's anchor while older private messages load, and discard only
    // the old conversation's pending submission when switching to another chat.
    const component=await host.evaluate(async()=>{
      const {createChatView}=await import('./chat-view.mjs');
      const panel=document.createElement('section'),scroll=document.createElement('div'),log=document.createElement('div');
      const form=document.createElement('form'),send=document.createElement('button'),input=document.createElement('textarea');
      scroll.style.cssText='height:100px;overflow:auto';scroll.append(log);form.append(input,send);panel.append(scroll,form);document.body.append(panel);
      let finish;
      const view=createChatView({log,input,form,send,scroll,dayDividers:true,maxMessages:12,
        onSend:()=>new Promise(resolve=>{finish=resolve;})});
      try{
        const entries=Array.from({length:12},(_,id)=>({id,text:'Message '+id,time:new Date(2026,0,id<4?1:2,12).getTime()}));
        view.replace(entries.slice(4));scroll.scrollTop=70;
        const first=[...log.querySelectorAll('article')].find(row=>row.getBoundingClientRect().bottom>scroll.getBoundingClientRect().top);
        const y=first.getBoundingClientRect().top;view.replace(entries);
        const stable=Math.abs(log.querySelector('[data-id="'+first.dataset.id+'"]').getBoundingClientRect().top-y)<2;
        const days=log.querySelectorAll('.link-chat-day').length;
        for(let i=12;i<17;i++)view.append({...entries.at(-1),id:i});
        const remainingDays=log.querySelectorAll('.link-chat-day').length;
        input.value='one';form.requestSubmit();view.reset();input.value='new draft';finish(true);await Promise.resolve();
        return {stable,days,remainingDays,draft:input.value};
      }finally{view.destroy();panel.remove();}
    });
    assert.deepEqual(component,{stable:true,days:2,remainingDays:1,draft:'new draft'});
    await host.click('#linkHost');await guest.evaluate(()=>roomFixture.enter());
    for(const page of pages)await roomChat(page);
    assert.equal(await host.locator('html').getAttribute('lang'),language);
    assert.equal(await host.textContent('#chatHeading'),tr('Чат комнаты'));
    assert.equal(await host.locator('#roomPeopleTab').count(),0);
    for(const page of [guest,host])await page.evaluate(()=>roomFixture.roster());
    await host.fill('#chatInput','Сборка готова.');await host.press('#chatInput','Enter');
    await guest.locator('#chatMessages .link-chat-message:not(.is-own)').getByText('Сборка готова.').waitFor();
    await guest.fill('#chatInput','Проверю сейчас ');
    await guest.click('#chatEmoji summary');await guest.getByRole('button',{name:'👍',exact:true}).click();
    await guest.press('#chatInput','Enter');
    await host.locator('#chatMessages .link-chat-message:not(.is-own)').getByText('Проверю сейчас 👍').waitFor();
    await host.click('#chatAttach summary');await host.click('#chatFile');
    const file=guest.locator('#chatMessages .chat-attachment').filter({hasText:filename});
    await file.getByRole('button',{name:tr('Скачать')}).click();
    await file.getByText(tr('Сохранено'),{exact:true}).waitFor({timeout:30000});
    assert.deepEqual(await fs.readFile(stores[1].completed.values().next().value),bytes);
    await file.getByRole('button',{name:tr('Показать в папке')}).click();
    const sizes=[];
    for(const [width,height] of [[1920,1040],[1426,933],[1280,720],[960,640],[800,560],[620,640]]){
      await host.setViewportSize({width,height});
      await host.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
      await roomChat(host);
      const m=await host.evaluate(()=>{
        const $=id=>document.getElementById(id),row=$('chatMessages').querySelector('.chat-attachment');
        const bounds=el=>el.getBoundingClientRect();
        return {panel:Math.round(bounds($('roomSidebar')).width),fileName:Math.round(bounds(row.querySelector('.file-name')).width),
          card:Math.round(bounds(row).width),chat:Math.round(bounds($('chatMessages').parentElement).height),
          overflow:[...row.querySelectorAll('*'),$('roomChat'),$('chatForm'),$('roomSidebar')].filter(el=>el.clientWidth&&el.scrollWidth>el.clientWidth+1).map(el=>el.className||el.id),
          formHeight:bounds($('chatForm')).height,formBottom:bounds($('chatForm')).bottom,sidebarBottom:bounds($('roomSidebar')).bottom};
      });
      assert.deepEqual(m.overflow,[],JSON.stringify({width,height,m}));
      assert(m.fileName>=m.card*.8&&m.chat>=85&&m.formHeight<=48&&m.formBottom<=m.sidebarBottom+1,JSON.stringify({width,height,m}));
      sizes.push({width,height,...m});
      if(width===1426)await screenshot('room-1426');
    }
    await host.setViewportSize({width:1440,height:900});
    async function screenshot(name){
      if(!process.env.LINK_UI_QA_IMAGES)return;
      await fs.mkdir(process.env.LINK_UI_QA_IMAGES,{recursive:true});
      await host.screenshot({path:path.join(process.env.LINK_UI_QA_IMAGES,name+(language==='en'?'-en':'')+'.png')});
    }
    await screenshot('room-chat');
    const dropped=randomBytes(48*1024+7),droppedName='room-map.bin',imageName='room-sketch.png';
    const droppedPath=path.join(temporary,droppedName);
    await fs.writeFile(droppedPath,dropped);
    await require('./chat-drop-desktop.cjs').dropFile(host,'#chatMessages',droppedPath);
    await sendAndSave(host,guest,stores[1],droppedName,'Карта матча',dropped);
    const pasted=await guest.evaluate(async name=>{
      const canvas=document.createElement('canvas');canvas.width=16;canvas.height=9;
      const g=canvas.getContext('2d');g.fillStyle='#21a196';g.fillRect(0,0,16,9);
      const image=await new Promise(resolve=>canvas.toBlob(resolve)),data=new DataTransfer();
      data.items.add(new File([image],name,{type:'image/png'}));data.setData('text/plain','Схема уровня');
      document.querySelector('#chatInput').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
      return [...new Uint8Array(await image.arrayBuffer())];
    },imageName);
    async function sendAndSave(sender,recipient,store,name,caption,content){
      await sender.locator('#attachmentDraft:modal').getByText(name,{exact:true}).waitFor();
      const card=recipient.locator('#chatMessages .chat-attachment').filter({hasText:name});
      assert.equal(await card.count(),0);
      if(sender===host)await sender.fill('#attachmentCaption',caption);
      else assert.equal(await sender.inputValue('#attachmentCaption'),caption);
      await sender.press('#attachmentCaption','Enter');
      await card.locator('.attachment-caption').getByText(caption,{exact:true}).waitFor();
      const own=sender.locator('#chatMessages .chat-attachment.is-own').filter({hasText:name});
      assert.equal(await own.getByRole('button',{name:tr('Показать в папке')}).count(),sender===host?1:0);
      assert.equal([...store.completed.values()].some(p=>path.basename(p)===name),false);
      await card.getByRole('button',{name:tr('Скачать')}).click();
      await card.getByText(tr('Сохранено'),{exact:true}).waitFor();
      const completed=[...store.completed.values()].find(p=>path.basename(p)===name);
      assert(completed);assert.deepEqual(await fs.readFile(completed),Buffer.from(content));
    }
    await sendAndSave(guest,host,stores[0],imageName,'Схема уровня',pasted);
    for(const [id,title,tag] of [['chatVoice','Голосовое сообщение','audio'],['chatCircle','Видеосообщение','video']]){
      if(id==='chatCircle')await guest.press('#chatRecordMode','Enter');
      await guest.press('#chatRecord','Enter');await guest.waitForSelector('#clipStop');
      await guest.waitForTimeout(1100);await guest.click('#clipStop');await guest.locator('#clipDisplay .clip-toggle').waitFor();
      assert.equal(await host.locator('.chat-attachment').filter({hasText:tr(title)}).count(),0);
      await guest.click('#clipSend');
      const card=host.locator('#chatMessages .chat-attachment').filter({hasText:tr(title)});
      await card.getByRole('button',{name:tr('Скачать')}).click();
      await card.getByRole('button',{name:tr(tag==='audio'?'Прослушать':'Просмотреть')}).click();
      await host.waitForFunction(tag=>document.querySelector('.chat-media-preview '+tag)?.readyState>=2,tag);
    }
    await host.click('#closeRoomChat');
    assert.equal(await host.getAttribute('#togglePanelBtn','aria-expanded'),'false');
    await host.focus('.voice-tile[data-slot="1"] .tile-sound-menu');await host.keyboard.press('Shift+F10');
    await host.locator('#participantSoundMenu:popover-open').waitFor();
    await host.locator('#participantSoundMenu').getByRole('button',{name:tr('Карточка участника')}).click();
    await host.locator('#contactActionsTitle').getByText(peers[1].name,{exact:true}).waitFor();
    assert.equal(await host.locator('#contactChoices').getByRole('button',{name:tr('Личный чат'),exact:true}).count(),0);
    assert.equal(await host.locator('#contactChoices .participant-id').count(),0,'Never infer a profile ID from a matching name or temporary seat');
    await host.locator('#contactChoices').getByRole('button',{name:tr('Вставить карточку друга')}).click();
    await host.locator('#directCode').waitFor();await host.click('#directClose');
    await host.locator('#roomPage').waitFor();await roomMix(host,1);
    await host.focus('#menu-mix-1-voice');await host.keyboard.press('Home');assert.equal(await host.inputValue('#menu-mix-1-voice'),'0');
    await host.locator('#menu-mix-1-system').focus();await host.keyboard.press('End');assert.equal(await host.inputValue('#menu-mix-1-system'),'200');
    await host.click('.mixer-row:has(#menu-mix-1-voice) .mixer-mute');
    assert.equal(await host.getAttribute('.mixer-row:has(#menu-mix-1-voice) .mixer-mute','aria-pressed'),'true');
    await screenshot('room-mixer');await closeRoomMenu(host);await roomMix(host,0);
    assert.equal(await host.getAttribute('#own-voice','aria-valuetext'),'100%');await closeRoomMenu(host);
    for(const page of pages){await page.evaluate(()=>{window.qaLanFriends=true;roomFixture.refresh();});await page.click('#navGame');}
    await host.fill('#gameTitle','Вечерний матч');await host.click('#gameCreate button');
    await host.locator('#gameChatEmpty').waitFor();
    await host.locator('#chatWallpaper').evaluate(control=>{
      control.value='dots';control.dispatchEvent(new Event('change'));
    });
    for(const id of ['gameChatEmpty','gameHistory']){
      assert.match(await host.locator('#'+id).evaluate(element=>getComputedStyle(element).backgroundImage),/radial-gradient/);
    }
    const request={action:'ask',room:games[0].active.id,ticket:require('node:crypto').randomUUID()};
    games[0].receive(people[1],request);await host.evaluate(()=>roomFixture.refresh());
    const requestCard=host.locator('#lanRequests .invite-card');
    await requestCard.getByText('Борис',{exact:true}).waitFor();
    await host.setViewportSize({width:1426,height:933});
    const layout=await requestCard.evaluate(card=>{
      const title=card.querySelector('strong').getBoundingClientRect(),actions=card.querySelector('.invite-actions').getBoundingClientRect();
      return {nameWidth:title.width,stacked:actions.top>=title.bottom,overflow:card.scrollWidth-card.clientWidth};
    });
    assert(layout.nameWidth>100&&layout.stacked&&layout.overflow<=1,JSON.stringify(layout));
    await screenshot('lan-request');
    await requestCard.getByRole('button',{name:tr('Отклонить'),exact:true}).click();
    await requestCard.waitFor({state:'hidden'});
    await host.setViewportSize({width:1440,height:900});
    await host.click('#gameSendInvite');await guest.evaluate(()=>roomFixture.refresh());
    await guest.locator('#gameInvites').getByRole('button',{name:tr('Принять'),exact:true}).click();
    await host.evaluate(()=>roomFixture.refresh());
    for(const page of pages){
      await page.waitForFunction(()=>document.querySelector('#gameCount').textContent==='2');
      assert.equal(await page.locator('#gameRoster .roster-avatar').count(),2);
      assert.match(await page.textContent('#gameRoster'),/Борис/);
      assert.match(await page.textContent('#gameRoster'),/Анна/);
    }
    assert.equal(await host.getAttribute('#gameChatTab','aria-selected'),'true');
    await host.focus('#gameChatTab');await host.keyboard.press('End');await host.locator('#gameNetworkPane').waitFor();
    assert.equal(await host.locator('#gameChatPane').isVisible(),false);
    await host.keyboard.press('Home');await host.locator('#gameChatPane').waitFor();
    await host.click('#gameMembersToggle');assert.equal(await host.locator('#gameMembers').isVisible(),false);
    await host.click('#gameMembersToggle');await host.locator('#gameRoster').waitFor();
    await host.fill('#gameMessage','Встреча https://example.org/meet');await host.press('#gameMessage','Enter');
    await host.locator('#gameHistory .chat-link-card').getByText('meet',{exact:true}).waitFor();
    await host.fill('#gameMessage','Начинаем');await host.click('#gameEmoji summary');
    await host.locator('#gameEmojiChoices').getByRole('button',{name:'🎮'}).click();await host.press('#gameMessage','Enter');
    await host.locator('#gameHistory .is-own').getByText('Начинаем🎮').waitFor();
    await guest.evaluate(()=>roomFixture.refresh());
    await guest.locator('#gameHistory article:not(.is-own)').getByText('Начинаем🎮').waitFor();
    await screenshot('lan-chat');
    await host.setViewportSize({width:800,height:600});
    await host.locator('#gameSession.lan-compact').waitFor();
    assert(await host.locator('#gameComposer').evaluate(form=>
      form.getBoundingClientRect().bottom<=document.querySelector('#directoryPage').getBoundingClientRect().bottom),
      'LAN composer fits above the live call controls without scrolling the directory');
    await host.click('#gameMembersToggle');await host.locator('#gameMembers').waitFor();
    assert.equal(await host.locator('#gameChatPane').evaluate(pane=>pane.inert),true);
    await screenshot('lan-members-compact');
    await host.keyboard.press('Escape');assert.equal(await host.getAttribute('#gameMembersToggle','aria-expanded'),'false');
    assert.equal(await host.locator('#gameChatPane').evaluate(pane=>pane.inert),false);
    await host.click('#navFriends');await host.click('#navGame');
    assert(await host.locator('#gameName').evaluate(title=>title===document.activeElement));
    await host.setViewportSize({width:1440,height:900});
    await host.click('#gameClearChat');
    const modal=host.locator('dialog:modal');
    await modal.getByText(tr('Очистить чат матча у вас?'),{exact:true}).waitFor();
    await modal.getByText(tr('Сообщения останутся у других участников.'),{exact:true}).waitFor();
    await modal.getByRole('button',{name:tr('Очистить у меня'),exact:true}).click();
    await host.waitForSelector('#gameChatEmpty');
    await guest.locator('#gameHistory article:not(.is-own)').getByText('Начинаем🎮').waitFor();
    await guest.click('#gameLeave');await host.evaluate(()=>roomFixture.refresh());
    await host.waitForFunction(()=>document.querySelector('#gameCount').textContent==='1');
    await host.click('#gameLeave');
    for(const page of pages){await page.click('#navRoom');await roomChat(page);}
    assert.equal(await host.locator('#chatMessages .chat-message').count(),2);
    await host.fill('#chatInput','Ссылка github.com/CRAFTCODE-CJD/CRAFTCODE-LINK');
    await host.press('#chatInput','Enter');
    const repo=guest.locator('#chatMessages .chat-link-card a');
    await repo.getByText('CRAFTCODE-CJD/CRAFTCODE-LINK',{exact:true}).waitFor();
    assert.equal(await repo.getAttribute('href'),'https://github.com/CRAFTCODE-CJD/CRAFTCODE-LINK');
    await require('./chat-drop-desktop.cjs').dropFile(guest,'#chatMessages',droppedPath);
    await guest.locator('#attachmentDraft:modal').waitFor();
    await guest.evaluate(()=>roomFixture.emit({type:'closed'}));
    await guest.locator('#attachmentDraft').waitFor({state:'hidden'});
    await host.click('#leaveBtn');
    const leave=host.locator('dialog:modal button').last();
    if(await leave.isVisible())await leave.click();
    await host.waitForFunction(()=>!document.querySelector('#chatMessages').childElementCount);
    // The other renderer stays offline; negotiation must not cover participants' controls.
    await host.click('#navFriends');
    await host.click('#linkHost');
    await host.setViewportSize({width:800,height:600});
    await roomChat(host);
    for(const count of [1,2,3,5]){
      const roster=[...peers,...Array.from({length:count},(_,index)=>({
        id:'qa-'+index,slot:index+2,name:'Player '+(index+3),micMuted:true,sharing:false
      }))].slice(0,count);
      await host.evaluate(peers=>roomFixture.emit({type:'roster',peers}),roster);
      await host.waitForFunction(n=>document.querySelectorAll('#voiceGrid .voice-tile').length===n,count);
      const bounds=await host.locator('#voiceGrid').evaluate(grid=>({
        grid:grid.clientWidth,stage:grid.parentElement.clientWidth,tile:grid.firstElementChild.clientWidth
      }));
      assert(bounds.grid>=bounds.stage-2 && bounds.tile>=150,JSON.stringify({count,bounds}));
      if(count===5)await screenshot('room-roster-800');
    }
    await host.evaluate(()=>roomFixture.roster());
    await host.locator('#mediaNotice').waitFor();
    await roomMix(host,1);
    await closeRoomMenu(host);
    assert(await host.locator('#mediaNotice').isVisible(),'Participant controls work during media negotiation');
    if(process.env.LINK_UI_QA_IMAGES)await host.locator('#toast').waitFor({state:'hidden'});
    await screenshot('room-connecting-800');
    assert.deepEqual(errors,[]);
    const evidence={browser:browser.version(),language,verifiedBytes:bytes.length,dropBytes:dropped.length,pasteBytes:pasted.length,
      lanMembers:2,lanChatDelivered:true,decodedClips:['voice','circle'],sizes};
    if(process.env.LINK_UI_QA_IMAGES)await fs.writeFile(path.join(process.env.LINK_UI_QA_IMAGES,'room-chat-'+language+'.json'),JSON.stringify(evidence,null,2)+'\n');
    console.log('PASS',JSON.stringify(evidence));
  }finally{
    await browser?.close();
    await Promise.all(stores.map(store=>store.close()));
    if(path.dirname(path.resolve(temporary))!==path.resolve(os.tmpdir())||!path.basename(temporary).startsWith('link-room-chat-'))
      throw Error('Unexpected temporary test directory');
    await fs.rm(temporary,{recursive:true,force:true});
  }
}
run().catch(e=>{console.error(e);process.exitCode=1;});
