'use strict';
const {testRuntime}=require('./electron-runtime.cjs');
// Two actual clients on a private loopback DHT. The test launcher supplies the
// bootstrap nodes, a private clipboard and separate app data before loading LINK.
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {_electron}=require(require.resolve('playwright',{paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||__dirname]}));
const root=path.resolve(process.env.LINK_QA_APP_ROOT||path.join(__dirname,'..'));
const interfaces=[{name:'lo',family:4,address:'127.0.0.1',host:'127.0.0.1',internal:true}];
const udx=require('udx-native');
udx.prototype.networkInterfaces=()=>interfaces;
udx.prototype.watchNetworkInterfaces=()=>Object.assign(new EventEmitter(),{interfaces,destroy(){}});

async function run(){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'link-chat-ui-'));
  const net=await require('hyperdht/testnet')(6);
  const apps=new Set(),errors=[];
  try{
    const launcher=path.join(temp,'launch.cjs');
    await fs.writeFile(launcher,`
      const {app,clipboard,Notification,dialog,Tray,shell}=require('electron');
      const ownRequire=require('node:module').createRequire(${JSON.stringify(path.join(root,'package.json'))});
      if(process.env.LINK_QA_DM_ATTACHMENTS==='1'){
        const {PersonalAttachments}=ownRequire('./src/direct/personal-attachments.cjs');
        const block=PersonalAttachments.prototype.block;
        PersonalAttachments.prototype.block=async function(...args){
          if(globalThis.testFileBlockDelay)await new Promise(resolve=>setTimeout(resolve,globalThis.testFileBlockDelay));
          return block.apply(this,args);
        };
      }
      // The launcher lives outside the app package. Use the version shipped in the payload.
      app.getVersion=()=>ownRequire('./package.json').version;
      app.setPath('appData',process.env.LINK_CHAT_TEST_DATA);
      const privateDownloads=require('node:path').join(process.env.LINK_CHAT_TEST_DATA,'Downloads');
      require('node:fs').mkdirSync(privateDownloads,{recursive:true});app.setPath('downloads',privateDownloads);
      app.on('browser-window-created',(_,win)=>{win.show=()=>{};win.showInactive=()=>{};win.focus=()=>{};});
      clipboard.writeText=text=>globalThis.testClipboard=text;
      globalThis.testNotifications=[];
      Notification.isSupported=()=>true;
      Notification.prototype.show=function(){globalThis.testNotifications.push(this);};
      Notification.prototype.close=function(){this.emit('close');};
      Tray.prototype.displayBalloon=()=>{};
      shell.openExternal=async url=>{globalThis.testExternal=url;};
      globalThis.testWebRequests=[];
      globalThis.fetch=async (url,options={})=>{
        globalThis.testWebRequests.push(String(url));
        if(String(url).startsWith('https://www.youtube.com/oembed?'))return Response.json({title:'Тестовый ролик',author_name:'Автор',thumbnail_url:'ignored'});
        if(String(url)==='https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg')return new Response(Buffer.from(globalThis.testPoster,'base64'));
        if(process.env.LINK_QA_MESSENGER_FLOW==='1'){
          const home='https://github.com/CRAFTCODE-CJD/CRAFTCODE-LINK',prefix=home+'/releases/download/v0.8.0/CRAFTCODE-LINK-0.8.0';
          const bytes=Buffer.from('MZ test bytes only');
          if(String(url)===home+'/releases/latest')return Response.redirect(home+'/releases/tag/v0.8.0',302);
          if(String(url)===prefix+'-Update-Code.txt')return new Response('LINK-UPDATE 0.8.0 '+require('node:crypto').createHash('sha256').update(bytes).digest('hex'));
          if(String(url)===prefix+'-Setup-x64.exe'){
            if(options.method==='HEAD')return new Response(null,{headers:{'Content-Length':String(bytes.length)}});
            globalThis.testInstallerGets=(globalThis.testInstallerGets||0)+1;return new Response(bytes);
          }
        }
        return new Response('',{status:404});
      };
      dialog.showErrorBox=(title,message)=>console.error(title,message);
      if(process.env.LINK_QA_GROUPS==='1')dialog.showOpenDialog=async()=>({canceled:!globalThis.testChosenFile,filePaths:globalThis.testChosenFile?[globalThis.testChosenFile]:[]});
      if(process.env.LINK_QA_LIVE_CAMERA==='1'){
        globalThis.qaCameraAllow=false;globalThis.qaCameraPrompts=[];
        dialog.showMessageBox=async(_win,options)=>{globalThis.qaCameraPrompts.push(options);return {response:globalThis.qaCameraAllow?1:0};};
        app.on('browser-window-created',(_,win)=>{win.isVisible=()=>true;win.isMinimized=()=>false;});
      }
      if(process.env.LINK_QA_GROUP_VOICE==='1'||process.env.LINK_QA_LIVE_CAMERA==='1'){
        const {desktopCapturer,nativeImage}=require('electron');
        desktopCapturer.getSources=async()=>[{id:'screen:0:0',name:'Test screen',display_id:'0',thumbnail:nativeImage.createEmpty()}];
      }
      if(process.env.LINK_QA_MESSENGER_FLOW==='1')dialog.showMessageBox=async()=>{
        globalThis.testUnexpectedNativePrompt=true;return {response:0};
      };
      globalThis.seedChatHistory=count=>{
        const {ProfileStore,publicCard}=ownRequire('./src/direct/identity.cjs');
        const {randomUUID}=require('node:crypto');
        const store=new ProfileStore(app.getPath('userData'),require('electron').safeStorage);
        const profile=store.read(),contact=profile.friends[0],history=store.chatHistory;
        history.open(publicCard(profile));
        try{
          for(let i=1;i<=count;i++){
            const uid=randomUUID(),epoch=contact.chatKey||String(contact.added);
            history.enqueue(contact.id,epoch,uid,'История '+i+' · '+'текст '.repeat(70));
            const row=history.oldest(contact.id,epoch);
            if(!history.acknowledge(contact.id,epoch,uid,row.seq))throw Error('Could not seed history');
          }
          return history.stats().bytes;
        }finally{history.close();}
      };
      const udx=ownRequire('udx-native'), interfaces=${JSON.stringify(interfaces)};
      udx.prototype.networkInterfaces=()=>interfaces;
      udx.prototype.watchNetworkInterfaces=()=>Object.assign(new (require('node:events').EventEmitter)(),{interfaces,destroy(){}});
      const DHT=ownRequire('hyperdht'),{Networks}=ownRequire('./src/direct/networks.cjs');
      const publish=Networks.prototype.publishDht;
      Networks.prototype.publishDht=function(epoch){
        this.dhtFactory=()=>new DHT({bootstrap:${JSON.stringify(net.bootstrap)},host:process.env.LINK_CHAT_TEST_IP,firewalled:false,ephemeral:true});
        return publish.call(this,epoch);
      };
      ownRequire('./src/entry.cjs');
    `);
    async function open(id){
      const address={alice:'127.0.0.2',boris:'127.0.0.3',vera:'127.0.0.4'}[id];
      assert(address,'unknown isolated test profile');
      const base=path.join(temp,id); await fs.mkdir(base,{recursive:true});
      const app=await _electron.launch({executablePath:testRuntime(),
        args:[launcher,'--mute-audio','--no-error-dialogs','--allow-loopback-in-peer-connection','--use-fake-device-for-media-stream',...(process.env.LINK_QA_LIVE_CAMERA==='1'?[]:['--use-fake-ui-for-media-stream']),'--craftlink-profile='+id],
        env:{...process.env,LINK_CHAT_TEST_DATA:base,LINK_CHAT_TEST_IP:address,XDG_CONFIG_HOME:base}});
      apps.add(app);
      if(process.env.LINK_QA_LIVE_CAMERA==='1')app.process().stderr?.on('data',chunk=>process.stderr.write(chunk));
      const page=await app.firstWindow(); page.setDefaultTimeout(25000);
      page.on('pageerror',err=>errors.push(String(err)));
      const data=await app.evaluate(({app})=>app.getPath('userData'));
      assert(data.startsWith(base+path.sep),'profile must be private to this test');
      const cdp=await page.context().newCDPSession(page);
      await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});
      await page.setViewportSize({width:1440,height:900});
      if(process.env.LINK_QA_ROOM_CONTROLS==='1'||process.env.LINK_QA_GROUP_VOICE==='1'||process.env.LINK_QA_LIVE_CAMERA==='1'){
        await page.waitForFunction(()=>!!document.querySelector('#bookQuery')?.oninput);
        await page.waitForLoadState('load');
        await page.addInitScript(process.env.LINK_QA_LIVE_CAMERA==='1'?require('./live-camera-desktop.cjs').instrument:require('./room-controls-desktop.cjs').instrument);
        if(process.env.LINK_QA_GROUP_VOICE==='1')await page.addInitScript(require('./group-voice-desktop.cjs').screen);
        await page.reload();
      }
      try{
        await page.waitForFunction(()=>window.craftlink && (!!document.querySelector('#startDirect')?.onclick || !!document.querySelector('#bookQuery')?.oninput));
      }catch(error){throw Error('Profile UI did not start. '+errors.join('\n'),{cause:error});}
      return {app,page,base,cdp};
    }
    async function create(client,name){
      await client.page.click('#startDirect'); await client.page.fill('#directName',name);
      await client.page.click('#directCreateForm button');
      await client.page.waitForFunction(()=>document.querySelector('#profileLabel').textContent!== 'Войти' && !document.querySelector('#directDialog').open);
    }
    const a=await open('alice'); let b=await open('boris');
    await create(a,'Анна'); await create(b,'Борис');
    await b.page.click('#bookCopy');
    const card=await b.app.evaluate(()=>globalThis.testClipboard);
    assert.match(card,/^CCF1:/);
    await a.page.click('#linkFriends'); await a.page.fill('#directCode',card); await a.page.click('#sendCardRequest');
    await b.page.click('#navRequests');
    // A new profile must finish publishing to the private DHT before its first request arrives.
    await b.page.locator('#inRequests').getByRole('button',{name:'Принять',exact:true}).click({timeout:65000});
    await a.page.click('#navFriends');
    await a.page.locator('#workspaceContacts .open-person-chat').click();
    await a.page.waitForFunction(()=>document.querySelector('#dmTitle').textContent==='Борис' && !document.querySelector('#dmInput').disabled);
    if(process.env.LINK_QA_COMPOSER==='1'){
      await require('./composer-design-desktop.cjs')(a,b);assert.deepEqual(errors,[]);return;
    }
    if(process.env.LINK_QA_HELP==='1'){
      await require('./help-desktop.cjs')({a,b});assert.deepEqual(errors,[]);return;
    }
    if(process.env.LINK_QA_LIVE_CAMERA==='1'){
      await require('./live-camera-desktop.cjs').run({a,b,open,create});assert.deepEqual(errors,[]);return;
    }
    if(process.env.LINK_QA_GROUPS==='1'||process.env.LINK_QA_GROUP_VOICE==='1'){
      const suite=process.env.LINK_QA_GROUPS==='1'?'./group-desktop.cjs':'./group-voice-desktop.cjs';
      await require(suite).run({a,b,open,create,apps});
      assert.deepEqual(errors,[]);return;
    }
    if(process.env.LINK_QA_ROOM_CONTROLS==='1'){
      await require('./room-controls-desktop.cjs').run({a,b,open,create,apps});
      assert.deepEqual(errors,[]);return;
    }
    if(process.env.LINK_QA_MESSENGER_FLOW==='1'){
      await require('./messenger-flow.cjs')({a,b});
      assert.deepEqual(errors,[]);return;
    }
    if(process.env.LINK_QA_DROP==='1'){
      await require('./chat-drop-desktop.cjs')({a,b});assert.deepEqual(errors,[]);return;
    }
    if(process.env.LINK_QA_IDENTITY==='1'){
      await require('./identity-verification-desktop.cjs')({a,b});
      assert.deepEqual(errors,[]);return;
    }
    if(process.env.LINK_QA_LAN_CHAT==='1'){
      await require('./lan-chat-desktop.cjs')({a,b});assert.deepEqual(errors,[]);return;
    }
    if(process.env.LINK_QA_LAN_INVITES==='1'){
      await require('./lan-invites-desktop.cjs')({a,b,open,create});assert.deepEqual(errors,[]);return;
    }
    if(process.env.LINK_QA_STORAGE_DOWNLOADS==='1'){
      await require('./storage-download-desktop.cjs')({a,b});assert.deepEqual(errors,[]);return;
    }
    if(process.env.LINK_QA_DM_ATTACHMENTS==='1'){
      await require('./private-attachment-desktop.cjs')({a,b});
      assert.deepEqual(errors,[]);return;
    }
    function observeChimes(page){return page.evaluate(()=>{
      window.testChimes=0;
      const play=HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play=function(){
        if(this.src.endsWith('/message.wav'))window.testChimes++;
        return play.call(this);
      };
    });}
    for(const client of [a,b])await observeChimes(client.page);
    // The test windows are kept off the user's desktop. Model native focus only
    // for the foreground conversation, then exercise an actual hidden recipient.
    await a.app.evaluate(({BrowserWindow})=>{
      const win=BrowserWindow.getAllWindows()[0];win.isVisible=win.isFocused=()=>true;
    });
    await a.page.fill('#dmInput','Завтра в восемь?'); await a.page.press('#dmInput','Enter');
    await a.page.locator('#dmLog').getByText('Доставлено',{exact:true}).waitFor();
    await b.page.waitForFunction(()=>document.querySelector('#dmBadge').textContent==='1' && document.querySelector('#messagesPage').hidden);
    assert.equal(await b.page.evaluate(()=>window.testChimes),1);
    assert.equal(await a.page.locator('#dmLog [data-state=read]').count(),0);
    await b.app.evaluate(({BrowserWindow})=>{
      const win=BrowserWindow.getAllWindows()[0];win.isVisible=win.isFocused=()=>true;
    });
    await b.page.click('#quickPeople button');
    await b.page.locator('#dmLog').getByText('Завтра в восемь?',{exact:true}).waitFor();
    await b.page.waitForFunction(()=>document.querySelector('#dmBadge').hidden);
    await a.page.locator('#dmLog [data-state=read][aria-label="Прочитано"]').waitFor();
    await b.page.fill('#dmInput','Да, до встречи');await b.page.click('#dmEmoji summary');await b.page.locator('#dmEmoji').getByRole('button',{name:'👍',exact:true}).click();
    await b.page.click('#dmSend');
    await a.page.locator('#dmLog').getByText('Да, до встречи👍',{exact:true}).waitFor();
    assert.equal(await a.page.evaluate(()=>window.testChimes),0,'a focused conversation does not chime');
    assert.equal(await b.page.evaluate(()=>window.testChimes),1,'sending a reply does not chime');
    const shots=process.env.LINK_VISUAL_DIR;
    if(shots){await fs.mkdir(shots,{recursive:true});await a.page.screenshot({path:path.join(shots,'private-chat.png')});}
    await a.page.setViewportSize({width:740,height:560});
    assert(await a.page.locator('#dmBack').isVisible());
    assert(await a.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await a.page.click('#dmBack');await a.page.locator('#dmList button').click();
    await a.page.locator('#dmLog').getByText('Завтра в восемь?',{exact:true}).waitFor();
    await b.page.evaluate(()=>localStorage.setItem('craftcode.language','en'));
    await b.app.close(); apps.delete(b.app);
    await a.page.waitForFunction(()=>{
      const status=document.querySelector('#dmPresence').textContent;
      return status.startsWith('Последний раз в сети · ') && /\d/.test(status) &&
        document.querySelector('#dmProfileStatus').textContent===status;
    });
    await a.page.fill('#dmInput','До связи');await a.page.press('#dmInput','Enter');
    await a.page.locator('#dmLog').getByText('Ожидает доставки',{exact:true}).waitFor();
    b=await open('boris');await b.page.click('#navChats');await b.page.locator('#dmList button').click();
    assert.equal(await b.page.locator('html').getAttribute('lang'),'en');
    assert.equal(await b.page.locator('#dmEarlier').textContent(),'Earlier messages');
    for(const msg of ['Завтра в восемь?','Да, до встречи👍','До связи'])await b.page.locator('#dmLog').getByText(msg,{exact:true}).waitFor();
    assert.equal(await b.page.locator('#dmLog .link-chat-message').count(),3);
    await b.page.click('#dmActions summary');await b.page.click('#dmClear');await b.page.click('#confirmNoBtn');
    assert.equal(await b.page.locator('#dmLog .link-chat-message').count(),3);
    await b.page.click('#dmActions summary');await b.page.click('#dmClear');await b.page.click('#confirmYesBtn');
    await b.page.waitForFunction(()=>!document.querySelector('#dmLog').childElementCount);
    assert.equal(await a.page.locator('#dmLog .link-chat-message').count(),3);
    await a.page.setViewportSize({width:1440,height:900});
    await a.page.click('#dmStorage summary');await a.page.click('#dmClearAll');await a.page.click('#confirmYesBtn');
    await a.page.waitForFunction(()=>!document.querySelector('#dmLog').childElementCount);
    // Exercise paging and physical cleanup with a populated temporary local history.
    const populated=await b.app.evaluate(()=>globalThis.seedChatHistory(265));
    await b.app.close();apps.delete(b.app);b=await open('boris');
    await b.page.click('#navChats');await b.page.locator('#dmList button').click();
    const body=b.page.locator('#dmLog .link-chat-body');
    await body.filter({hasText:'История 265 ·'}).waitFor();
    assert.equal(await body.count(),128);
    await b.page.click('#dmEarlier');await body.filter({hasText:'История 10 ·'}).waitFor();
    await b.page.click('#dmEarlier');await body.filter({hasText:'История 1 ·'}).waitFor();
    assert.equal(await body.count(),9);
    await b.page.click('#dmLater');await body.filter({hasText:'История 137 ·'}).waitFor();
    await b.page.click('#dmEarlier');await body.filter({hasText:'История 1 ·'}).waitFor();
    await b.page.click('#dmLatest');await body.filter({hasText:'История 265 ·'}).waitFor();
    await b.page.click('#dmStorage summary');await b.page.click('#dmClearAll');await b.page.click('#confirmYesBtn');
    await b.page.waitForFunction(()=>!document.querySelector('#dmLog').childElementCount);
    const remaining=await b.page.evaluate(async()=>(await window.craftlink.direct({op:'state'})).chatStorage);
    assert.equal(remaining.messages,0);assert(remaining.bytes<populated);
    await observeChimes(b.page);
    await b.cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false});
    assert.equal(await b.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
    await a.page.fill('#dmInput','Сообщение в фоне');await a.page.press('#dmInput','Enter');
    await b.page.waitForFunction(()=>window.testChimes===1);
    await b.page.waitForFunction(()=>!document.querySelector('#dmBadge').hidden);
    console.log('PASS one message sound with the same DM open in a hidden Electron window.');
    console.log('PASS English interface, 265 saved messages / three pages, local disk bytes before and after clearing:',populated,remaining.bytes);
    assert.deepEqual(errors,[]);
    console.log('PASS two isolated Electron clients: card and friendship, contact and quick access open chat, unread without stealing focus, text and emoji, durable delivery, narrow navigation, offline queue and restart, local clear/cancel/clear-all.');
  }finally{
    await Promise.allSettled([...apps].map(app=>app.close()));
    await net.destroy();await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:180});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
