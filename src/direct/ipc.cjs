'use strict';
const {tr}=require('../native-language.cjs');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {dialog,clipboard,app,safeStorage,shell}=require('electron');
const {DirectService}=require('./service.cjs');
const {ProfileStore}=require('./identity.cjs');
const {chatCommand}=require('./personal-chats.cjs');
const {CameraConsent,promptCamera}=require('../files/camera-consent.cjs');
function directIPC({handle,window,emit,room,roomToken,openRoom,closeRoom,busy,ring,clearChatNotice,journal,downloads=()=>app.getPath('downloads'),downloadRoots=()=>[downloads()]}){
  const lanCamera=new CameraConsent();
  let service,locked=false,directRoom=false,strict=true,dnd=false,paused=false,switching=false;
  let staged,voiceSwitch;
  function discardVoice(){
    const item=voiceSwitch;voiceSwitch=null;
    if(!item)return;
    clearTimeout(item.timer);
    if(item.voice)item.voice.close();
    else if(item.seat && service?.voiceChannels.preparing===item.seat)service.voiceChannels.finish(item.seat,true);
  }
  function discardSwitch(){
    const old=staged;staged=null;
    return old?.guest.close();
  }
  function stillSwitching(item){
    return staged===item && roomToken()===item.previous && service?.pendingLive(item.call);
  }
  let policyReady=false;
  const get=()=>{
    if(service)return service;
    service=new DirectService({store:new ProfileStore(app.getPath('userData'),safeStorage),
      attachmentIO:{downloads,downloadRoots,journal,
        async choose(){
          const picked=await dialog.showOpenDialog(window(),{title:tr('Поделиться файлом'),properties:['openFile']});
          return !picked.canceled && picked.filePaths[0];
        },
        reveal:filename=>shell.showItemInFolder(filename),
        askCamera:()=>promptCamera(window,dialog)},
      gameEvent:emit,chatEvent:event=>{
        const friend=service?.contact(event.id);
        const incoming=event.incoming===true && friend?.state==='friend' && !service.blocked(event.id) && !service.dnd && !service.paused;
        const win=window();
        emit(incoming?{...event,profile:service.me.id,background:!win?.isVisible()||!win.isFocused()||win.isMinimized()}:{type:event.type,id:event.id});
        if(incoming){
          ring('message',{id:friend.id,profile:service.me.id,name:friend.name});
        }else if(!event.id || !friend || !service.chats.summary(friend).unread)clearChatNotice?.(event.id);
      },changed:()=>{
        if(staged && (staged.guest.controller.signal.aborted || !staged.committed&&!stillSwitching(staged)))discardSwitch();
        if(voiceSwitch && (strict || paused || !voiceSwitch.committed && (service.pending||service.out||roomToken()!==voiceSwitch.previous)))discardVoice();
        emit({type:'direct-updated'});
      },notice:text=>emit({type:'direct-notice',text}),
      incoming:kind=>{if(kind==='join')emit({type:'direct-join'});else {ring('call',{id:service?.pending?.id,name:service?.contact(service?.pending?.peer)?.name});emit({type:'direct-ring'});}},
      busy,roomInfo:room,hostRoom:async (route,stillWanted,conversation)=>{
        const old=room();if(old?.role==='host'&&old.invite)return old;
        if(busy())throw Error(tr('Уже открыта другая комната.'));
        const options={name:service.profile.name,address:'127.0.0.1',bindAddress:'127.0.0.1',port:0};
        let info;
        try{info=await openRoom('host',options);}
        catch(error){
          if(error.code!=='EADDRINUSE' || !stillWanted())throw error;
          info=await openRoom('host',{...options,port:0});
        }
        if(!stillWanted()){if(room()?.invite===info.invite)await closeRoom();return null;}
        directRoom=true;service.publishRoom=true;service.announceRooms();emit({type:'direct-host',info:{...info,direct:true,mixRoom:service.mixRoom(),conversation,usePeerIce:route==='dht'}});return info;
      }});
    service.groups.files=new (require('../groups/files.cjs').GroupFiles)(service.groups,{
      ...service.chats.files.io,directory:app.getPath('userData')
    });
    service.strict=strict;service.dnd=dnd;
    if(strict && service.profile && (service.profile.dht||service.profile.lan))service.save({...service.profile,dht:false,lan:''});
    service.paused=paused;service.start();return service;
  };
  handle('lan-camera',async raw=>{
    if(raw?.action==='cancel'){lanCamera.cancel(raw.requestId);return;}
    if(raw?.action!=='request')throw Error(tr('Некорректная команда.'));
    const current=service?.game.active;
    const me=service?.me;
    const isCurrent=()=>!!current && !!me && policyReady && !strict && !paused && !switching &&
      service?.game.active===current && service.me?.id===me.id && service.me.device===me.device &&
      !current.waiting && current.id===raw.room && current.roster.some(p=>p.device===me.device && p.id===me.id);
    return lanCamera.ask(raw.requestId,()=>promptCamera(window,dialog),isCurrent);
  });
  handle('direct',async raw=>{
    if(!raw || typeof raw!=='object')throw Error(tr('Некорректная команда.'));
    const op=raw.op;
    if(op==='policy'){
      policyReady=true;
      if(!service&&typeof raw.paused==='boolean')paused=raw.paused;
      strict=raw.strict!==false;
      if(typeof raw.dnd==='boolean')dnd=raw.dnd;
      if(service){
        if(strict)service.voiceChannels.close();
        service.strict=strict;service.dnd=dnd;
        if(strict){
          service.game.invitations.clear();if(service.game.active)service.game.leave();
          service.cancel();service.reject();
          await Promise.all([service.profile && service.settings({dht:false,lan:''}),service.chats.files.clear()]);
        }
        if(dnd&&service.pending&&!service.pending.taken)service.reject();
        service.announceRooms();
      }
      return true;
    }
    if(!policyReady){
      if(op==='state')return {me:null,nics:[]};
      throw Error(tr('Загружаем профиль LINK. Повторите попытку.'));
    }
    const s=get();
    if(op==='switch-join'){
      const p=s.pending,previous=roomToken();
      if(staged||voiceSwitch||!previous||!p?.joining||raw.id!==p.id||raw.key!==p.localKey||!s.pendingLive(p))throw Error(tr('Приглашение устарело.'));
      const options=s.joinOptions(p.id,true);
      const {GuestSwitch}=require('../core/guest-switch.cjs');
      const item=staged={call:p,previous,guest:new GuestSwitch(options,p.expires),options,committed:false};
      try{
        await item.guest.connect();
        if(!stillSwitching(item) || !item.guest.usable())throw Error(tr('Приглашение устарело.'));
        s.finishJoin(p);
        item.committed=true;
        await closeRoom(item);
        return item.call.localKey;
      }catch(error){
        if(staged===item)discardSwitch();
        if(s.pending===p)s.reject();
        throw error;
      }
    }
    if(op==='session'){
      const next=raw.active===false;
      if(switching||busy()||locked||s.pending||s.out)throw Error(tr('Сначала завершите звонок или текущую операцию.'));
      if(next!==paused){switching=true;try{
        if(next){clearChatNotice?.();s.paused=true;await s.stop();s.near.clear();s.grants.clear();s.nextLookup.clear();s.lastDial.clear();}
        else {s.paused=false;s.start();}
        paused=next;
      }finally{switching=false;}}
      return s.snapshot();
    }
    if(switching||paused&&!['state'].includes(op))throw Error(tr('Сначала войдите в профиль LINK.'));
    if(strict && (['take','join','call','request-room','host'].includes(op)||op==='settings'&&(raw.dht===true||raw.lan)))throw Error(tr('Строгий режим разрешает звонки через настроенный TURN в разделе Jabber.'));
    if(op==='state')return s.snapshot();
    if(op==='create'){s.create(raw.name);return s.snapshot();}
    if(!s.profile && op!=='import')throw Error(tr('Создайте профиль или перенесите его с другого ПК.'));
    if(typeof op==='string' && op.startsWith('chat-')){
      const win=window();return chatCommand(s,raw,op!=='chat-read'||!!(win?.isVisible()&&win.isFocused()&&!win.isMinimized()));
    }
    if(op==='group-voice-switch'){
      const previous=roomToken();
      if(!previous||voiceSwitch||staged||strict||s.out||s.pending||!s.me)throw Error(tr('Голосовой канал недоступен.'));
      const item=voiceSwitch={previous,key:randomUUID(),group:raw.group,channel:raw.channel};
      try{
        const ready=s.voiceChannels.join(item.group,item.channel,true);item.seat=s.voiceChannels.preparing;
        item.voice=await ready;
        if(voiceSwitch!==item||previous!==roomToken()||strict||s.out||s.pending||!item.voice.usable())throw Error(tr('Голосовой канал недоступен.'));
        item.committed=true;
        item.timer=setTimeout(()=>{if(voiceSwitch===item)discardVoice();},12000);item.timer.unref();
        await closeRoom(item);return item.key;
      }catch(error){if(voiceSwitch===item)discardVoice();else item.voice?.close();throw error;}
    }
    if(op==='group-voice-join'){
      if(raw.key!==undefined){
        const item=voiceSwitch;
        if(!item?.committed||item.key!==raw.key||item.group!==raw.group||item.channel!==raw.channel)throw Error(tr('Голосовой канал недоступен.'));
        if(strict||busy()||!item.voice.usable()){discardVoice();throw Error(tr('Голосовой канал недоступен.'));}
        voiceSwitch=null;clearTimeout(item.timer);
        try{return await openRoom('group',{},onEvent=>item.voice.bind(onEvent));}catch(error){item.voice.close();throw error;}
      }
      if(strict||busy()||s.out||s.pending||!s.me)throw Error(tr('Голосовой канал недоступен.'));
      const voice=await s.voiceChannels.join(raw.group,raw.channel);
      try{
        if(strict||busy()||s.out||s.pending)throw Error(tr('Голосовой канал недоступен.'));
        return await openRoom('group',{},onEvent=>voice.bind(onEvent));
      }catch(error){voice.close();throw error;}
    }
    if(typeof op==='string' && op.startsWith('group-file-')){
      if(strict||paused||!s.groups.active)throw Error(tr('Нет доступа к этому действию.'));
      return s.groups.files.command(op.slice('group-file-'.length),raw);
    }
    if(typeof op==='string'&&op.startsWith('group-')&&!op.startsWith('group-file-'))return s.groups.command(raw);
    if(op==='export'||op==='import'){
      if(locked||busy()||s.pending||s.out)throw Error(tr('Завершите звонок или текущий перенос.'));
      locked=true;
      try{
        const opts={filters:[{name:tr('Защищённый профиль CRAFTCODE LINK'),extensions:['cclprofile']}]};
        if(op==='export'){
          const {canceled,filePath}=await dialog.showSaveDialog(window(),{...opts,defaultPath:path.join(app.getPath('documents'),'CRAFTCODE-LINK.cclprofile')});
          if(canceled||!filePath)return false;
          if(path.extname(filePath).toLowerCase()!=='.cclprofile')throw Error(tr('Выберите файл .cclprofile.'));
          const roots=[app.getPath('userData')];if(app.isPackaged)roots.push(path.dirname(process.execPath));
          const {outsideProfile}=await import('../friends/account-card.mjs');await outsideProfile(filePath,roots);
          const data=await s.export(raw.password),tmp=filePath+'.'+require('node:crypto').randomUUID()+'.tmp';
          try{await fs.writeFile(tmp,data,{mode:0o600,flag:'wx'});await fs.rename(tmp,filePath);}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
        }else{
          const {canceled,filePaths}=await dialog.showOpenDialog(window(),{...opts,properties:['openFile']});
          if(canceled||!filePaths[0])return false;
          const filename=filePaths[0];
          if(path.extname(filename).toLowerCase()!=='.cclprofile'||!(await fs.lstat(filename)).isFile())throw Error(tr('Выберите обычный файл .cclprofile.'));
          const f=await fs.open(filename);try{
            const stat=await f.stat();if(!stat.isFile()||stat.size>524288)throw Error(tr('Файл переноса слишком велик.'));
            const buf=Buffer.alloc(stat.size);let offset=0;
            while(offset<buf.length){const r=await f.read(buf,offset,buf.length-offset,offset);if(!r.bytesRead)throw Error(tr('Не удалось прочитать файл целиком.'));offset+=r.bytesRead;}
            await s.import(buf,raw.password);
          }finally{await f.close();}
        }
        return true;
      }finally{locked=false;}
    }
    if(op==='reset'){
      if(locked||busy()||s.pending||s.out)throw Error(tr('Сначала завершите вызов или перенос.'));
      locked=true;
      try {
        const result=await dialog.showMessageBox(window(),{type:'warning',buttons:[tr('Отмена'),tr('Удалить с этого ПК')],defaultId:0,cancelId:0,
          message:tr('Удалить локальный профиль с этого компьютера?'),detail:tr('Будут удалены ключи, контакты, личная история и данные групп на этом ПК. Для сохранения своих групп сначала передайте сервер другому администратору. Скачанные в «Загрузки» файлы останутся у вас.')});
        if(result.response===1){
          if(busy()||s.pending||s.out)throw Error(tr('Во время подтверждения начался вызов. Завершите его и повторите удаление.'));
          await s.stop();s.store.erase();service=null;emit({type:'direct-updated'});
        }
        return get().snapshot();
      } finally { locked=false; }
    }
    if(op==='audience'){s.setAudience(raw.mode,raw.ids);return s.snapshot();}
    if(op==='revoke-room-return'){s.revokeReturn(raw.person,raw.scope);return s.snapshot();}
    if(typeof op==='string'&&op.startsWith('game-')){
      if(strict)throw Error(tr('Игровая LAN недоступна в строгом режиме.'));
      const g=s.game;
      if(op==='game-create')g.create(raw.title,raw.listed!==false);
      else if(op==='game-visibility')g.setListed(raw.listed===true);
      else if(op==='game-cancel-request')g.cancelAsk();
      else if(op==='game-review')g.review(raw.device,raw.yes===true,raw.actionId);
      else if(op==='game-return'||op==='game-ask'){
        const item=s.gameReturns().find(x=>x.id===raw.id && x.person===raw.person && x.device===raw.device);
        if(!item)throw Error(tr('Эта комната уже недоступна.'));
        const peer={id:item.person,device:item.device,name:item.name};
        if(op==='game-ask')g.ask(peer,item);else if(item.again)g.rejoin(peer,item);else throw Error(tr('Эта комната уже недоступна.'));
      }
      else if(op==='game-invite')g.invite(raw.id);
      else if(op==='game-answer')g.answer(raw.id,raw.yes===true);
      else if(op==='game-file')return g.files.command(raw);
      else if(op==='game-chat'){
        if(raw.room!==undefined&&raw.room!==g.active?.id)throw Error(tr('Игровая LAN ещё не подключена.'));
        g.chat(raw.text);
      }
      else if(op==='game-clear-chat'){
        if(raw.deleteDownloads!==undefined&&typeof raw.deleteDownloads!=='boolean')throw Error(tr('Некорректная команда.'));
        if(raw.profileId!==undefined&&raw.profileId!==s.me.id||raw.deleteDownloads===true&&raw.profileId!==s.me.id)throw Error(tr('Профиль LINK изменился. Откройте диалог снова.'));
        const cleared=raw.deleteDownloads===true&&g.files.track(g.files.clearDownloads(raw.room,raw.through));
        g.clearChat(raw.room,raw.through);if(cleared)return await cleared;
      }
      else if(op==='game-leave')g.leave();
      else if(op==='game-enable'||op==='game-repair')await s.gameNet.start(op==='game-repair');
      else if(op==='game-check-path')s.gameNet.checkPeer(raw.device);
      else if(op==='game-ports')s.gameNet.setPorts(raw.room,raw.ports);
      else if(['game-launcher-select','game-launcher-mode','game-launcher-forget','game-launch-saved'].includes(op)){
        if(locked)throw Error(tr('Дождитесь завершения операции.'));
        locked=true;
        try{
          const launcher=require('../game/launcher.cjs');
          launcher.current(s,raw.profileId,raw.room);
          if(op==='game-launcher-select')await launcher.selectGame(s,dialog,window(),raw.profileId,raw.room);
          else if(op==='game-launcher-mode')launcher.configureGame(s,raw.profileId,raw.room,raw.mode);
          else if(op==='game-launcher-forget')launcher.forgetGame(s,raw.profileId,raw.room);
          else{
            const choice=launcher.launchSelection(s.profile?.gameLaunch);
            if(!choice)throw Error(tr('Сначала выберите игру на этом ПК.'));
            await require('../game/unreal-launch.cjs').launchUnreal(s,dialog,window(),undefined,raw.device??null,raw.port??7777,choice);
          }
        }finally{locked=false;}
      }
      else if(op==='game-launch-unreal'){if(locked)throw Error(tr('Дождитесь завершения операции.'));locked=true;try{await require('../game/unreal-launch.cjs').launchUnreal(s,dialog,window(),undefined,raw.device??null,raw.port??7777);}finally{locked=false;}}
      else if(op==='game-disable')await s.gameNet.stop();
      else throw Error(tr('Неизвестная команда.'));
      return s.snapshot();
    }
    if(op==='room-mix'){s.setRoomMix(raw);return true;}
    if(op==='set-contact-privacy'){s.setPrivacy(raw.owner,raw.privacy);return s.snapshot();}
    if(op==='set-avatar')s.setAvatar(raw.owner,raw.pixels);
    else if(op==='set-profile-style')s.setProfileStyle(raw.owner,raw.cover,raw.about);
    else if(op==='settings')await s.settings(raw);
    else if(op==='copy')clipboard.writeText(s.card());
    else if(op==='refresh'){s.refreshContacts();}
    else if(op==='add'){const addResult=s.add(raw.value,raw.expectedPerson);return {...s.snapshot(),addResult};}
    else if(op==='room-add')return s.roomPeople.add(raw);
    else if(op==='answer')s.answer(raw.id,raw.yes===true);
    else if(op==='favorite'){const f=s.contact(raw.id);if(f)s.setFriend({...f,favorite:!f.favorite});}
    else if(op==='forget'||op==='block')s.forget(raw.id,op==='block');
    else if(op==='unblock')s.unblock(raw.id);
    else if(op==='host'){
      if(busy()||s.pending||s.out)throw Error(tr('Завершите текущий вызов.'));
      await s.hostRoom(s.profile.dht?'dht':'lan',()=>true);
    }
    else if(op==='call')s.call(raw.id);
    else if(op==='request-room')s.call(raw.id,{device:raw.device,door:raw.door,resume:raw.resume===true});
    else if(op==='take'){
      if(raw.key!==undefined && raw.key!==s.pending?.localKey)throw Error(tr('Вызов завершён.'));
      s.take(raw.id,raw.switchRoom===true);
    }
    else if(op==='reject'){if((raw.id===undefined || s.pending?.id===raw.id) && (raw.key===undefined || raw.key===s.pending?.localKey))s.reject();}
    else if(op==='cancel'){if(raw.id===undefined || raw.id===s.out?.id)s.cancel();}
    else if(op==='join'||op==='join-switched'){
      if(busy())throw Error(tr('Завершите другой звонок.'));
      let opts,adopt,guest;
      if(op==='join-switched'){
        if(!staged?.committed || raw.key!==staged.call.localKey)throw Error(tr('Приглашение устарело.'));
        ({guest,options:opts}=staged);staged=null;adopt=listener=>guest.adopt(listener);
      }else opts=s.joinOptions(raw.id);
      let info;
      try{info=await openRoom('guest',opts,adopt);}
      catch(error){await guest?.close();throw error;}
      directRoom=true;
      s.guestAppearance={room:require('./avatars.cjs').roomTag(opts.invite),device:opts.hostDevice,person:opts.hostPerson};s.announceRooms();s.update();
      return {...info,direct:true,mixRoom:s.mixRoom(),hostDevice:opts.hostDevice,hostPerson:opts.hostPerson,usePeerIce:opts.usePeerIce};
    }else throw Error(tr('Неизвестная команда.'));
    return s.snapshot();
  });
  function updateBlocker(){
    if(staged || voiceSwitch || switching || service?.pending || service?.out || service?.voiceChannels.rooms.size ||
      service?.voiceChannels.local || service?.voiceChannels.preparing)return 'Завершите звонок или закройте приглашение, затем нажмите «Установить» снова.';
    if(service?.chats.files.transfers.size || service?.groups.files?.tasks.size || service?.game.files.transferring)
      return 'Дождитесь завершения передачи файлов, затем нажмите «Установить» снова.';
    if([...(service?.groups.records.values()||[])].some(r=>r.move))
      return 'Дождитесь завершения передачи группы, затем нажмите «Установить» снова.';
    if(!service?.game.active && service?.gameNet.release)return 'Отключаем игровую сеть. Через несколько секунд нажмите «Установить» снова.';
    return '';
  }
  return {
    offerSelected(target,selection,caption){
      const s=service;
      if(!policyReady||strict||paused||!s?.me||s.strict||s.paused||target.profile!==s.me.id)throw Error(tr('Профиль LINK изменился. Откройте диалог снова.'));
      if(target.type==='dm')return s.chats.files.offer(target.id,undefined,undefined,selection,caption);
      if(target.type==='lan')return s.game.files.track(s.game.files.offer(target.profile,target.id,selection,caption));
      if(target.type==='group')return s.groups.files.offer(target.group,target.channel,selection,caption);
      throw Error(tr('Некорректная команда.'));
    },
    allowsPublicLookup:()=>policyReady && !strict,
    get camera(){return service?.chats.files.camera;},
    lanCamera,
    updateBlocker,
    get gameRoom(){return service?.game.active;},
    async leaveGameForUpdate(){
      service.game.leave();
      await service.gameNet.stop();
      await Promise.allSettled([...service.game.files.work]);
    },
    canOpenChat:(profile,id)=>!!(service?.me?.id===profile && !service.paused && service.chats.friend(id) && service.chats.summary(service.contact(id)).unread),
    joinedPeer:(port,invite,id,address)=>service?.joinedPeer(port,invite,id,address),leftByChoice:(port,invite,address)=>service?.leftByChoice(port,invite,address),endGame:()=>{if(service){service.game.invitations.clear();service.game.leave();}},stop:()=>{discardVoice();discardSwitch();return service?.stop();},presence:()=>service?.announceRooms(),clear:preserve=>{if(voiceSwitch&&voiceSwitch!==preserve)discardVoice();if(staged && staged!==preserve)discardSwitch();directRoom=false;if(service){service.publishRoom=false;service.guestAppearance=null;service.audience={mode:'friends',ids:new Set()};service.announceRooms();service.grants.clear();service.returning.clear();service.tunnels.clear();}},get active(){return directRoom;}};
}
module.exports={directIPC};
