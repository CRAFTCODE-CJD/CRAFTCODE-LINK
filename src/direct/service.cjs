'use strict';
const {tr}=require('../native-language.cjs');
const {GameRoom}=require('../game/room.cjs');
const {GameNetwork}=require('../game/network.cjs');
const net=require('node:net');
const {randomUUID}=require('node:crypto');
const {friend,publicCard,shareCard,parseCard,seed,nameOf,hex32,seal,unseal,sign,verify}=require('./identity.cjs');
const {Networks,interfaces}=require('./networks.cjs');
const {ContactLink}=require('./links.cjs');
const {privacyOf,validPrivacy,contactStatus}=require('./privacy.cjs');
const {routingSeeds,refreshAfter}=require('./discovery-seeds.cjs');
const {validAvatar,validPixels,validStyle,validStyleRecord,publicStyle,newer,roomTag,memberTag,validRoomMap,witnessFields}=require('./avatars.cjs');
const {PersonalChats}=require('./personal-chats.cjs');
const {GroupVoice}=require('../groups/voice.cjs');
const {decodeInvite}=require('../core/invite.cjs');
const {LIMITS}=require('../core/protocol.cjs');
const uuid=v=>typeof v==='string' && /^[a-f0-9-]{36}$/.test(v);
const appVersion=require('../../package.json').version;
const validVersion=v=>typeof v==='string' && /^(?:0|[1-9]\d{0,3})(?:\.(?:0|[1-9]\d{0,3})){2}$/.test(v);
const roomDoor=v=>typeof v==='string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
class DirectService {
  constructor({store,gameEvent=()=>{},chatEvent=()=>{},attachmentIO,changed=()=>{},incoming=()=>{},notice=()=>{},hostRoom,roomInfo=()=>null,busy=()=>false,dhtFactory,nics=interfaces}){
    Object.assign(this,{store,changed,incoming,notice,hostRoom,roomInfo,busy,nics});
    this.profile=store.read();this.links=new Set();this.allSockets=new Set();this.near=new Map();this.requests=new Map((this.profile?.requests||[]).map(c=>[c.id,c]));
    this.grants=new Map();this.returning=new Map();this.tunnels=new Map();this.nextLookup=new Map();this.lastDial=new Map();this.lastRing=new Map();
    this.audience={mode:'friends',ids:new Set()};
    this.pendingAvatars=new Map();this.pendingStyles=new Map();
    this.roomPeople=new (require('./room-people.cjs').RoomPeople)(this);
    this.voiceChannels=new GroupVoice(this);
    this.groupChanged=()=>this.voiceChannels.reconcile();
    this.groups=new (require('../groups/service.cjs').Groups)(this,store);
    this.chats=new PersonalChats(this,store.chatHistory,chatEvent,attachmentIO);
    this.game=new GameRoom({self:()=>this.me, links:id=>this.contact(id)?.state==='friend'&&!this.blocked(id)?this.linksTo(id):[],
      changed:()=>{this.gameNet?.reconcile();this.game.files?.reconcile();this.announceRooms();this.update();},event:gameEvent,quiet:()=>this.strict||this.paused,silent:()=>this.dnd});
    this.game.files=new (require('../game/files.cjs').GameFiles)(this,attachmentIO);
    this.gameNet=new GameNetwork(this.game,()=>this.update());
    this.network=new Networks({profile:()=>this.profile,canDiscover:()=>!!this.profile&&!this.strict&&!this.paused&&!this.hidden,
      rememberNodes:replies=>this.rememberDiscoveryNodes(replies),
      hasDhtLinks:()=>[...this.allSockets].some(s=>s.contactRoute==='dht'&&!s.destroyed),
      attach:(...args)=>this.attach(...args),seen:(c,r)=>this.found(c,r),issue:msg=>{this.issue=msg;this.update();},changed:()=>this.update(),nics,dhtFactory});
  }
  start(){
    if(!this.profile)return;
    this.me=publicCard(this.profile);if(this.paused)return;
    this.groups.start();this.chats.open(this.me);
    if(this.profile.lan&&this.network.canDiscover())this.network.startLan(this.profile.lan).catch(()=>{this.issue=tr('Выбранная сеть недоступна.');this.update();});
    this.lastScan=Date.now();this.timer=setInterval(()=>this.tick(),5000);this.timer.unref();this.tick();
  }
  update(){if(this.dirty)return;this.dirty=setTimeout(()=>{this.dirty=null;this.changed();},90);}
  save(next){
    if(!next.dht)delete next.discoverySeeds;
    this.store.write(next);this.profile=next;this.me=publicCard(next);this.update();
  }
  rememberDiscoveryNodes(replies){
    if(!this.profile?.dht)return;
    const time=Date.now(),previous=this.profile.discoverySeeds?.time;
    if(previous<=time&&time-previous<refreshAfter)return;
    const nodes=routingSeeds(replies);
    if(nodes.length){
      // A full or read-only disk must not turn a successful lookup into a network failure.
      try{this.save({...this.profile,discoverySeeds:{time,nodes}});}catch{}
    }
  }
  create(name){
    if(this.profile)throw Error(tr('На этом ПК уже есть профиль.'));
    name=nameOf(name);if(!name)throw Error(tr('Введите имя.'));
    this.save({root:seed(),device:seed(),name,friends:[],dht:false,lan:''});this.start();
  }
  blocked(id){return this.profile?.blocked?.some(c=>c.id===id);}
  contact(id){return this.profile?.friends.find(f=>f.id===id);}
  get hidden(){return this.profile?.privacy?.status==='invisible';}
  sharedLink(link){
    const same=p=>p?.device===link.card.device && (p.person||p.owner||p.id)===link.card.id;
    return !!link.wire || same(this.game.active?.owner) || this.game.active?.roster.some(same) ||
      same(this.voiceChannels.local)||same(this.voiceChannels.preparing)||
      [...this.voiceChannels.rooms.values()].some(room=>room.seats.some(same));
  }
  setPrivacy(owner,options){
    if(this.paused||owner!==this.me?.id||!validPrivacy(options))throw Error(tr('Не удалось сохранить настройки приватности.'));
    const old=privacyOf(this.profile.privacy),next=privacyOf(options);
    this.save({...this.profile,privacy:next});
    if(this.pending && !this.pending.taken && (this.hidden || (this.pending.roomInvitation||this.pending.admit?!next.invites:!next.calls)))this.reject();
    if(this.hidden && old.status!=='invisible'){
      this.cancel();this.near.clear();void this.chats.files.clear();
      const keep=new Set([...this.links].filter(l=>!l.socket.destroyed && this.sharedLink(l)).map(l=>l.socket));
      for(const socket of this.allSockets)if(!keep.has(socket))socket.destroy();
      this.network.stopLan();
      this.network.stopDht([...keep].filter(s=>s.contactRoute==='dht'));
    }else if(old.status==='invisible' && !this.hidden && !this.strict){
      this.lastScan=0;this.nextLookup.clear();this.lastDial.clear();this.tick();
    }
    this.announceRooms();this.update();
  }
  setFriend(f){const list=this.profile.friends.filter(old=>old.id!==f.id);if(list.length>=256)throw Error(tr('Достигнут предел списка друзей.'));this.save({...this.profile,friends:[...list,f]});}
  linksTo(id){return [...this.links].filter(l=>l.card.id===id && !l.socket.destroyed).sort((a,b)=>Number(b.route==='lan')-Number(a.route==='lan'));}
  allows(id){return this.contact(id)?.state==='friend'&&!this.blocked(id)&&(this.audience.mode==='friends'||this.audience.mode==='selected'&&this.audience.ids.has(id));}
  setAvatar(owner,pixels){
    if(this.paused||!this.me||owner!==this.me.id||pixels!==null&&!validPixels(pixels))throw Error(tr('Не удалось сохранить фото профиля.'));
    if((this.profile.avatar?.pixels??null)===pixels)return;
    const avatar={pixels,time:Math.max(Date.now(),(this.profile.avatar?.time||0)+1),device:this.me.device};
    this.save({...this.profile,avatar});
    for(const l of this.links)if(l.appearance && this.contact(l.card.id)?.state==='friend' && !this.blocked(l.card.id))l.send({kind:'avatar',avatar});
  }
  receiveAvatar(id,avatar){
    if(validAvatar(avatar))this.queueAppearance(id,avatar,this.pendingAvatars,this.profile.contactAvatars);
  }
  setProfileStyle(owner,cover,about){
    if(this.paused||!this.me||owner!==this.me.id||!validStyle(cover,about))throw Error(tr('Не удалось сохранить оформление профиля.'));
    const old=this.profile.cardStyle;
    if((old?.cover||'default')===cover && (old?.about||'')===about)return;
    const style={cover,about,time:Math.max(Date.now(),(old?.time||0)+1),device:this.me.device};
    this.save({...this.profile,cardStyle:style});
    for(const l of this.links)if(l.cardStyle && this.contact(l.card.id)?.state==='friend' && !this.blocked(l.card.id))l.send({kind:'profile-style',style});
  }
  queueAppearance(id,record,pending,stored){
    if(record.time>Date.now()+86400000||!newer(record,pending.get(id)||stored?.[id]))return;
    pending.set(id,record);
    if(!this.avatarTimer)this.avatarTimer=setTimeout(()=>this.flushAvatars(),700);
  }
  flushAvatars(){
    clearTimeout(this.avatarTimer);this.avatarTimer=null;
    if(!this.pendingAvatars.size && !this.pendingStyles.size)return;
    const next={...this.profile};
    for(const [key,pending] of [['contactAvatars',this.pendingAvatars],['contactStyles',this.pendingStyles]]){
      if(!pending.size)continue;
      next[key]={...next[key]};
      for(const [id,record] of pending)if(this.contact(id)?.state==='friend'&&!this.blocked(id))next[key][id]=record;
      pending.clear();
    }
    try{this.save(next);}catch{this.issue=tr('Не удалось сохранить оформление профиля.');this.update();}
  }
  joinedPeer(port,invite,peer,address){
    const tunnel=this.tunnels.get(port);
    if(!address || !tunnel || tunnel.raw.localAddress!==address || tunnel.invite!==invite || tunnel.peer)return;
    tunnel.peer=peer;
    // Remember an admitted device after its TLS hello. This permission lives
    // with the host's running room, so losing power on the guest loses no ticket.
    const grant=this.grants.get(tunnel.device);
    if(this.publishRoom && this.roomInfo()?.invite===invite && grant && grant.id===tunnel.id &&
      grant.person===tunnel.person && grant.invite===invite && this.contact(tunnel.person)?.state==='friend' && !this.blocked(tunnel.person)){
      grant.joined=true;
      this.returning.set(tunnel.device,{person:tunnel.person,invite});
    }
    this.update();
  }
  roomContacts(){
    const room=this.roomInfo();
    if(!room?.peers)return {};
    if(room.groupVoice)return this.voiceChannels.contacts();
    const peers=new Set(room.peers.map(p=>p.id));
    const confirmed=id=>this.contact(id)?.state==='friend'&&!this.blocked(id);
    if(room.role==='host'&&this.publishRoom)return Object.fromEntries([...this.tunnels.values()]
      .filter(t=>t.invite===room.invite&&peers.has(t.peer)&&confirmed(t.person)).map(t=>[t.peer,t.person]));
    const guest=this.guestAppearance;
    if(room.role!=='guest'||!guest||!confirmed(guest.person))return {};
    const result={[room.hostId]:guest.person};
    const roster=this.linksTo(guest.person).find(l=>l.card.device===guest.device && l.avatarRoster?.room===guest.room)?.avatarRoster;
    if(roster){
      const contacts=new Map(this.profile.friends.filter(f=>f.state==='friend'&&!this.blocked(f.id)).map(f=>[memberTag(guest.room,this.me.id,f.id),f.id]));
      for(const [peer,tag,signature] of roster.members){
        const id=contacts.get(tag);
        if(id && peers.has(peer) && verify(id,witnessFields(guest.room,peer),signature))result[peer]=id;
      }
    }
    return result;
  }
  mixRoom(){
    const room=this.roomInfo();
    if(room?.groupVoice)return room.mixRoom||'';
    if(room?.role==='host' && this.publishRoom && room.invite)return roomTag(room.invite);
    return room?.role==='guest' ? this.guestAppearance?.room || '' : '';
  }
  setRoomMix({owner,room,peer,person,role,volume,muted}){
    if(this.paused || !this.me || this.me.id!==owner || !hex32(room) || room!==this.mixRoom() ||
      !hex32(person) || typeof peer!=='string' || this.roomContacts()[peer]!==person ||
      !require('./contact-mix.cjs').validLevel(role,{volume,muted}))throw Error(tr('Участник комнаты недоступен.'));
    const contactMix={...this.profile.contactMix}, entry={...contactMix[person]};
    const current=entry[role];
    if((current?.volume??100)===volume && (current?.muted??false)===muted)return;
    if(volume===100 && !muted)delete entry[role];else entry[role]={volume,muted};
    if(Object.keys(entry).length)contactMix[person]=entry;else delete contactMix[person];
    this.save({...this.profile,contactMix});
  }
  leftByChoice(port,invite,address){
    const tunnel=this.tunnels.get(port);
    if(!address || !tunnel || tunnel.raw.localAddress!==address || tunnel.invite!==invite || this.roomInfo()?.invite!==invite)return;
    if(this.grants.get(tunnel.device)?.id===tunnel.id)this.grants.delete(tunnel.device);
    this.announceRooms();
  }
  canReturn(card,invite){
    const old=this.returning.get(card.device);
    return !!old && old.person===card.id && old.invite===invite && !this.strict && !this.paused &&
      this.contact(card.id)?.state==='friend' && !this.blocked(card.id);
  }
  dropGrant(device){
    const grant=this.grants.get(device);
    if(!grant)return;
    this.grants.delete(device);
    for(const t of this.tunnels.values())if(t.device===device && t.id===grant.id && !t.peer)t.raw.destroy();
  }
  revokeReturn(person,scope){
    const room=this.publishRoom && this.roomInfo();
    if(room?.role!=='host' || scope!==roomTag(room.invite) || !hex32(person))throw Error(tr('Доступно создателю комнаты.'));
    for(const [device,entry] of this.returning)if(entry.person===person && entry.invite===room.invite)this.returning.delete(device);
    for(const [device,entry] of this.grants)if(entry.person===person && entry.invite===room.invite)this.dropGrant(device);
    this.announceRooms();this.update();
  }
  gameReturns(){
    if(this.paused||this.strict)return [];
    const list=new Map();
    for(const l of this.links){
      const state=l.remoteRoom;
      if(!l.socket.destroyed && state?.back && state.until>Date.now() && this.contact(l.card.id)?.state==='friend' && !this.blocked(l.card.id)){
        const old=list.get(l.card.device);
        if(!old||old.seen<state.until)list.set(l.card.device,{...state.back,person:l.card.id,device:l.card.device,name:l.card.name,seen:state.until});
      }
    }
    return [...list.values()];
  }
  setAudience(mode,ids){
    if(!this.publishRoom||this.roomInfo()?.role!=='host'||!['invite','selected','friends'].includes(mode)||!Array.isArray(ids)||ids.length>256)throw Error(tr('Доступно создателю комнаты.'));
    this.audience={mode,ids:new Set(ids.filter(id=>this.contact(id)?.state==='friend'))};
    for(const [device,entry] of this.returning)if(!this.allows(entry.person))this.returning.delete(device);
    for(const [device,entry] of this.grants)if(!this.allows(entry.person))this.dropGrant(device);
    if(this.pending?.admit&&!this.allows(this.pending.peer))this.reject();
    this.announceRooms();this.update();
  }
  announceRooms(){
    this.roomPeople.announce();
    const guest=this.guestAppearance,info=guest&&this.roomInfo();
    if(guest && info?.role==='guest'){
      for(const link of this.linksTo(guest.person)){
        const key=guest.room+info.selfId;
        if(link.appearance && link.card.device===guest.device && link.sentWitness!==key && this.contact(guest.person)?.state==='friend' && !this.blocked(guest.person)){
          const proof=sign(this.profile.root,witnessFields(guest.room,info.selfId));
          if(link.send({kind:'avatar-witness',room:guest.room,peer:info.selfId,proof}))link.sentWitness=key;
        }
      }
    }
    const room=this.publishRoom && this.roomInfo();
    const visible=room?.role==='host' && room.invite && !this.strict && !this.dnd && !this.hidden;
    if(!visible)this.listedRoom=null;
    else if(this.listedRoom?.invite!==room.invite)this.listedRoom={invite:room.invite,door:randomUUID()};
    const door=this.listedRoom?.door || '', count=door?room.peers.length:0, now=Date.now();

    for(const link of this.links){
      if(this.contact(link.card.id)?.state!=='friend')continue;
      if(link.socket.destroyed)continue;
      if(this.hidden&&!this.sharedLink(link)){link.socket.destroy();continue;}
      if(link.appearance && room?.invite){
        const tunnels=[...this.tunnels.values()].filter(t=>t.invite===room.invite && t.peer && room.peers.some(p=>p.id===t.peer));
        if(tunnels.some(t=>t.device===link.card.device && t.person===link.card.id)){
          const tag=roomTag(room.invite);
          const members=tunnels.filter(t=>t.proof && t.person!==link.card.id).map(t=>[t.peer,memberTag(tag,link.card.id,t.person),t.proof]);
          const roster={kind:'avatar-roster',room:tag,members},key=JSON.stringify(roster);
          if(link.sentAvatarRoster!==key){link.sentAvatarRoster=key;link.send(roster);}
        }else link.sentAvatarRoster=null;
      }
      const again=!!door && this.canReturn(link.card,room.invite),permitted=again||this.allows(link.card.id);
      const back=this.strict||this.paused||this.hidden?null:this.game.listing(link.card);
      const availability=this.hidden?'offline':privacyOf(this.profile.privacy).status;
      const inCall=!!this.roomInfo()&&!this.hidden&&!this.paused&&!this.strict;
      const signature=JSON.stringify([permitted?door:'',permitted?count:0,again,back,availability,inCall]);
      if(link.sentRoom===signature && now-link.sentRoomAt<20000)continue;
      link.sentRoom=signature;link.sentRoomAt=now;link.send({kind:'room-state',door:permitted?door:'',count:permitted?count:0,game:1,again,back,version:appVersion,availability,inCall});
    }
  }
  roomsFor(id){
    const devices=new Map();
    for(const link of this.linksTo(id)){
      const card=link.remoteRoom;
      if(card && card.until>Date.now() && card.until>(devices.get(link.card.device)?.until || 0))
        devices.set(link.card.device,card);
    }
    return [...devices].filter(([,r])=>r.door).map(([device,r])=>({device,door:r.door,count:r.count,canReturn:r.again===true}));
  }
  snapshot(){
    if(!this.profile)return {me:null,nics:this.nics()};
    if(this.paused)return {me:{name:this.profile.name,id:this.me.id},paused:true,nics:[],friends:[],near:[],blocked:[],requests:[]};
    const map=({chatKey,...f})=>{
      const avatar=f.state==='friend'?this.profile.contactAvatars?.[f.id]:null;
      const links=f.state==='friend'?this.linksTo(f.id):[],visible=links.filter(l=>l.contactStatus!=='offline'),status=contactStatus(links);
      return {...f,lastSeen:f.state==='friend'&&status==='offline'?(this.profile.contactSeen?.[f.id]||null):null,cardStyle:f.state==='friend'?publicStyle(this.profile.contactStyles?.[f.id]):undefined,mix:f.state==='friend'?this.profile.contactMix?.[f.id]:undefined,avatar:avatar?.pixels||null,avatarRev:avatar?avatar.time+'.'+avatar.device:'',status,online:status!=='offline',routes:[...new Set(visible.map(l=>l.route))],
      chat:{...(f.state==='friend'?this.chats.summary(this.contact(f.id)):{unread:0,last:null}),supported:f.state==='friend'&&this.linksTo(f.id).some(l=>this.chats.eligible(l)),files:f.state==='friend'&&this.chats.files.peers(f.id).length>0,canQueueFiles:f.state==='friend'&&this.chats.files.available},
      inCall:f.state==='friend'&&visible.some(l=>l.remoteRoom?.inCall===true&&l.remoteRoom.until>Date.now()),
      game:this.linksTo(f.id).some(l=>l.remoteRoom?.game),rooms:f.state==='friend'?this.roomsFor(f.id):[],
      versions:f.state==='friend'?[...new Set(this.linksTo(f.id).map(l=>l.remoteRoom?.version).filter(Boolean))]:[],
      onlineDevices:new Set(visible.map(l=>l.card.device)).size};};
    const room=this.publishRoom && this.roomInfo(),scope=room?.role==='host'&&room.invite?roomTag(room.invite):null;
    const admitted=scope?[...new Set([...this.returning.values()].filter(r=>r.invite===room.invite).map(r=>r.person))]:[];
    return {groups:this.groups.snapshot(),mixRoom:this.mixRoom(),roomContacts:this.roomContacts(),roomPeople:this.roomPeople.snapshot(),game:{...this.game.state(),returns:this.gameReturns(),network:this.gameNet.status(),launcher:require('../game/launcher.cjs').launcherState(this.profile)},audience:{mode:this.audience.mode,ids:[...this.audience.ids],scope,admitted},me:{name:this.profile.name,id:this.me.id,device:this.me.device,avatar:this.profile.avatar?.pixels||null,cardStyle:publicStyle(this.profile.cardStyle)},dht:this.profile.dht,discovery:this.network.discovery||'off',lanReady:!!this.network.nic,lan:this.profile.lan,nics:this.nics(),
      lastContactRefresh:this.lastRefresh||0,privacy:privacyOf(this.profile.privacy),friends:this.profile.friends.map(map),chatStorage:this.chats.footprint(),near:[...this.near.values()].map(({card})=>({id:card.id,name:card.name})).filter((v,i,a)=>a.findIndex(x=>x.id===v.id)===i),
      blocked:this.profile.blocked||[],requests:[...this.requests.values()].map(c=>({id:c.id,name:c.name})),issue:this.issue||'',
      incoming:this.pending && {id:this.pending.id,peer:this.pending.peer,key:this.pending.localKey??=randomUUID(),mode:this.pending.admit?"admit":this.pending.switchCall?"switch":"call",resuming:!!this.pending.resume,roomInvitation:!!this.pending.roomInvitation,taken:!!this.pending.taken,unavailable:!this.pendingLive(this.pending)||!!this.pending.door && !this.roomsFor(this.pending.peer).some(r=>r.door===this.pending.door && r.device===this.pending.device && r.count<LIMITS.participants),name:this.contact(this.pending.peer)?.name},
      outgoing:this.out && {id:this.out.id,peer:this.out.peer,resuming:!!this.out.resume,mode:this.out.door?'admit':this.out.hostInvite?'invite':'call',name:this.contact(this.out.peer)?.name}};
  }
  async settings({dht,lan,name}){
    if(!this.profile)throw Error(tr('Сначала создайте профиль.'));
    if((this.strict||this.paused)&&(dht===true||lan))throw Error(tr('Строгий режим разрешает звонки через настроенный TURN в разделе Jabber.'));
    const previous=this.profile,next={...previous};
    if(name!==undefined){next.name=nameOf(name);if(!next.name)throw Error(tr('Введите имя.'));}
    if(typeof dht==='boolean')next.dht=dht;
    if(typeof lan==='string' && lan!==previous.lan){
      if(lan&&!this.nics().some(i=>i.name===lan))throw Error(tr('Выберите доступную сеть.'));
      next.lan=lan;
    }
    if(next.name===previous.name&&next.dht===previous.dht&&next.lan===previous.lan)return;
    // Commit intent before the first await so a later revocation always wins.
    this.save(next);this.issue='';
    let stopDht,startLan;
    if(next.dht!==previous.dht){
      if(next.dht)this.network.startDht(true);
      else{this.dropRoute('dht');stopDht=this.network.stopDht();}
    }
    if(next.lan!==previous.lan){
      this.dropRoute('lan');this.near.clear();
      if(!next.lan||this.network.canDiscover())startLan=this.network.startLan(next.lan);
    }
    await Promise.all([stopDht,startLan]);
  }
  dropRoute(route){for(const s of this.allSockets)if(s.contactRoute===route)s.destroy();}
  add(value,expectedPerson){
    const c=typeof value==='string' && value.startsWith('CCF1:')?parseCard(value):[...this.near.values()].find(e=>e.card.id===value)?.card;
    if(!c)throw Error(tr('Вставьте карточку друга CCF1.'));
    if(expectedPerson!==undefined && c.id!==expectedPerson)throw Error(tr('Карточка принадлежит другому участнику. Проверьте, чью карточку вы вставили.'));
    if(c.id===this.me.id)throw Error(tr('Это ваша карточка. Попросите друга прислать свою.'));
    if(this.blocked(c.id))throw Error(tr('Сначала разблокируйте контакт.'));
    const f=this.contact(c.id);
    if(f?.state==='friend')return 'existing';
    if(this.requests.has(c.id)){this.answer(c.id,true);return 'accepted';}
    if(f?.state==='invited'){
      if(!f.devices.includes(c.device) && f.devices.length<16){
        this.setFriend({...f,devices:[...f.devices,c.device]});this.reach(this.contact(c.id));
      }
      return 'pending';
    }
    this.setFriend(friend(c));this.nextLookup.delete(c.id);this.reach(this.contact(c.id));
    for(const l of this.linksTo(c.id))l.send({kind:'add'});
    return 'sent';
  }
  answer(id,yes){
    const c=this.requests.get(id);if(!c)throw Error(tr('Запрос уже закрыт.'));
    const requests=[...this.requests.values()].filter(item=>item.id!==id);
    const friends=this.profile.friends.filter(f=>f.id!==id);
    if(yes&&friends.length>=256)throw Error(tr('Достигнут предел списка друзей.'));
    this.save({...this.profile,requests,friends:yes?[...friends,friend(c,'friend')]:friends});this.requests.delete(id);
    for(const l of this.linksTo(id))l.send(yes?this.friendSignal('yes'):{kind:'no'});
    this.update();
  }
  found(c,route){
    if(this.hidden||c.id===this.me?.id||this.blocked(c.id))return;
    if(!this.near.has(c.device)&&this.near.size>=256)return;
    this.near.set(c.device,{card:c,route,time:Date.now()});
    const f=this.contact(c.id);if(f)this.reach(f);this.update();
  }
  attach(s,route,binding,expected,device){
    if(this.hidden||this.paused||this.strict||!this.me||this.allSockets.size>=64 || (route==='dht'&&!this.profile.dht))return s.destroy();
    s.contactRoute=route;this.allSockets.add(s);s.once('close',()=>this.allSockets.delete(s));
    new ContactLink(s,route,binding,this.profile,expected,device,l=>{
      if(this.blocked(l.card.id)){s.destroy();return;}
      if([...this.links].filter(other=>other.card.device===l.card.device && other.route===route).length>=2){s.destroy();return;}
      const f=this.contact(l.card.id),addDevice=!!f&&!f.devices.includes(l.card.device);
      if(addDevice&&f.devices.length>=16){s.destroy();return;}
      l.lastSeen=Date.now();this.links.add(l);
      if(f){
        if(addDevice||f.name!==l.card.name)this.setFriend({...f,name:l.card.name,devices:addDevice?[...f.devices,l.card.device]:f.devices});
      }
      if(f?.state==='invited')l.send({kind:'add'});
      if(f?.state==='friend'){
        l.send(this.friendSignal('known'));
        this.game.reconnected(l);
      }
      if(!f){const t=setTimeout(()=>{if(!this.contact(l.card.id))s.destroy();},45000);t.unref();s.once('close',()=>clearTimeout(t));}
      this.update();
    },(l,m)=>this.message(l,m),l=>{this.links.delete(l);this.groups.lost(l);this.groups.files?.disconnected(l);this.game.files.disconnected(l);this.chats.files.disconnected(l);this.update();});
  }
  reach(f){
    if(!this.network.canDiscover())return;
    for(const [device,e] of this.near)if(e.card.id===f.id && !this.linksTo(f.id).some(l=>l.card.device===device&&l.route==='lan') && this.dialOK('lan'+device))this.network.dialLan(e.route,f.id);
    if(!this.network.dht)return;
    const dial=device=>{if(this.network.dht&&!this.linksTo(f.id).some(l=>l.card.device===device)&&this.dialOK('dht'+device))this.network.dialDht(device,f.id);};
    for(const key of f.devices)dial(key);
    const searches=this.network.lookups;
    if(searches.size>=4||searches.has(f.id)||Date.now()<(this.nextLookup.get(f.id)||0))return;
    this.nextLookup.set(f.id,Date.now()+60000);
    this.network.lookup(f.id,dial).catch(()=>{});
  }
  refreshContacts(){
    if(this.hidden||this.strict||this.paused||!this.profile||Date.now()-(this.lastRefresh||0)<5000)return;
    this.lastRefresh=Date.now();this.network.cancelLookups();this.nextLookup.clear();this.lastDial.clear();this.lastScan=0;
    if(this.profile.dht)this.network.startDht(true);
    this.tick();
  }
  dialOK(key){if(Date.now()-(this.lastDial.get(key)||0)<12000)return false;this.lastDial.set(key,Date.now());return true;}
  tick(){
    if(!this.profile||this.paused)return;this.game.tick();const now=Date.now();
    if(this.profile.dht&&!this.strict&&!this.hidden)this.network.startDht();
    if(this.profile.lan && this.network.canDiscover() && now-(this.lastScan||0)>30000 && !this.rebinding){
      this.lastScan=now;
      const current=this.nics().find(n=>n.name===this.profile.lan),previous=this.network.nic;
      if(!previous || current?.address!==previous?.address || current?.netmask!==previous?.netmask){
        this.dropRoute('lan');this.near.clear();this.rebinding=true;
        this.network.startLan(current?.name||'').then(()=>{this.issue=current?'':tr('Выбранная сеть недоступна.');this.update();})
          .catch(()=>{this.issue=tr('Не удалось открыть выбранную сеть.');this.update();}).finally(()=>{this.rebinding=false;});
      }else this.network.refresh();
    }
    for(const [k,v] of this.near)if(now-v.time>80000){this.near.delete(k);this.update();}
    for(const [k,t] of this.lastDial)if(now-t>180000)this.lastDial.delete(k);
    for(const [k,t] of this.lastRing)if(now-t>60000)this.lastRing.delete(k);
    for(const l of this.links)if(this.contact(l.card.id)?.state==='friend'){if(now-l.lastSeen>55000)l.socket.destroy();else if(now-(l.lastPing||0)>18000){l.lastPing=now;l.send({kind:'ping'});}}
    this.announceRooms();this.groups.tick();this.chats.tick();this.voiceChannels.reconcile();
    for(const l of this.links)if(l.remoteRoom && l.remoteRoom.until<=now){delete l.remoteRoom;this.update();}
    for(const f of this.profile.friends)this.reach(f);
    if(this.pending?.expires<now)this.reject();
    if(this.out?.expires<now)this.cancel(tr('Друг не ответил.'));
    for(const [id,g] of this.grants)if(this.roomInfo()?.invite!==g.invite)this.grants.delete(id);else if(this.linksTo(g.person).some(l=>l.card.device===id && l.wire))g.until=now+150000;else if(g.until<now)this.grants.delete(id);
  }
  friendSignal(kind){return {kind,groups:1,groupAppearance:1,groupPalettes:1,lanFiles:this.game.files.io?1:0,chat:this.chats.usable()?1:0,files:this.chats.files.available?1:0,captions:1,readReceipts:1,fileChunks:1,appearance:1,cardStyle:1,roomPeople:1};}
  message(l,m){
    const c=l.card,f=this.contact(c.id);
    if(this.strict||this.paused||!this.links.has(l)||l.socket.destroyed||this.blocked(c.id))return;
    if(f&&!f.devices.includes(c.device)){l.socket.destroy();return;}
    if(m.kind==='add'){
      if(f?.state==='friend')return l.send(this.friendSignal('yes'));
      if(f?.state==='invited'){this.setFriend({...f,state:'friend'});return l.send(this.friendSignal('yes'));}
      if(this.hidden||this.profile.privacy?.friendRequests===false)return;
      if(this.requests.size<48&&!this.requests.has(c.id)){
        const card={id:c.id,device:c.device,name:c.name,cert:c.cert};
        this.save({...this.profile,requests:[...this.requests.values(),card]});this.requests.set(c.id,card);
      }
      return;
    }
    if((m.kind==='yes'||m.kind==='known') && (f?.state==='invited'||f?.state==='friend')){
      if(f.state==='invited')this.setFriend({...f,state:'friend'});
      l.roomPeople=m.roomPeople===1;
      l.groupAppearance=m.groupAppearance===1;
      l.groupPalettes=l.groupAppearance&&m.groupPalettes===1;
      if(l.lanFiles!==(m.lanFiles===1)){l.lanFiles=m.lanFiles===1;this.update();}
      if(m.groups===1&&!l.groups){l.groups=true;this.groups.announce(l);this.update();}
      if(m.kind==='yes' || f.state==='invited')l.send(this.friendSignal('known'));
      if(m.appearance===1&&!l.appearance){
        l.appearance=true;
        if(this.profile.avatar)l.send({kind:'avatar',avatar:this.profile.avatar});
        this.announceRooms();
      }
      if(m.cardStyle===1 && !l.cardStyle){
        l.cardStyle=true;
        if(this.profile.cardStyle)l.send({kind:'profile-style',style:this.profile.cardStyle});
      }
      this.announceRooms();
      const capable=m.chat===1;
      const files=capable && m.files===1;
      const filesChanged=l.filesCapable!==files;
      l.filesCapable=files;
      l.captions=files && m.captions===1;
      l.readReceipts=capable&&m.readReceipts===1;l.fileChunks=files&&m.fileChunks===1;
      if(l.chatCapable!==capable){l.chatCapable=capable;this.update();}
      if(filesChanged && files)this.chats.changed(c.id);
      l.lastSeen=Date.now();this.chats.flush(c.id);return;
    }
    if(m.kind==='no'&&f?.state==='invited'){this.forget(f.id);this.notice(tr('Заявка отклонена.'));return;}
    if(f?.state!=='friend')return;
    if(m.kind==='room-person'||m.kind==='room-people'){this.roomPeople.receive(l,m);return;}
    if(m.kind==='group-voice'){this.voiceChannels.receive(l,m);return;}
    if(m.kind==='group-file'){if(this.groups.fileAllowed(l))void this.groups.files?.receive(l,m).catch(()=>{});return;}
    if(m.kind==='group'){if(m.op==='invite'&&(this.hidden||this.profile.privacy?.invites===false))return;if(typeof m.op==='string'&&m.op.length<=50)void this.groups.receive(l,m).catch(()=>{});return;}
    if(m.kind==='avatar'){if(l.appearance)this.receiveAvatar(c.id,m.avatar);return;}
    if(m.kind==='profile-style'){
      if(l.cardStyle && validStyleRecord(m.style))this.queueAppearance(c.id,m.style,this.pendingStyles,this.profile.contactStyles);
      return;
    }
    if(m.kind==='avatar-witness'){
      const room=this.publishRoom&&this.roomInfo();
      if(!l.appearance || !room?.invite || typeof m.peer!=='string' || !/^[a-zA-Z0-9_-]{16}$/.test(m.peer) || m.room!==roomTag(room.invite))return;
      const tunnel=[...this.tunnels.values()].find(t=>t.invite===room.invite&&t.peer===m.peer&&t.person===c.id&&t.device===c.device);
      if(tunnel && !tunnel.proof && verify(c.id,witnessFields(m.room,m.peer),m.proof)){
        tunnel.proof=m.proof;this.announceRooms();
      }
      return;
    }
    if(m.kind==='avatar-roster'){
      if(l.appearance&&validRoomMap(m)){l.avatarRoster={room:m.room,members:m.members};this.update();}
      return;
    }
    l.lastSeen=Date.now();if(m.kind==='ping'){l.send({kind:'pong'});return;}if(m.kind==='pong')return;
    if(m.kind==='friend-file'){void this.chats.files.receive(l,m).catch(()=>{});return;}
    if(m.kind==='friend-text'||m.kind==='friend-text-ack'){
      try{this.chats.receive(l,m);}catch{this.issue=tr('Не удалось сохранить личную переписку на этом ПК.');this.update();}
      return;
    }
    if(m.kind==='friend-read'||m.kind==='friend-read-ack'){
      try{this.chats.readPacket(l,m);}catch{this.chats.storageIssue();}return;
    }
    if(m.kind==='game-room'){if(m.action==='invite'&&(this.hidden||this.profile.privacy?.invites===false))return;if(!this.strict)this.game.receive(c,m);return;}
    if(m.kind==='game-packets'){if(!this.strict)this.gameNet.receive(c,m);return;}
    if(m.kind==='game-file'){if(!this.strict&&!this.paused)void this.game.files.receive(l,m).catch(()=>{});return;}
    if(m.kind==='room-state'){
      if(m.door!=='' && !roomDoor(m.door) || !Number.isInteger(m.count) ||
        (m.door ? m.count<1 || m.count>LIMITS.participants : m.count!==0))return;
      const version=validVersion(m.version)?m.version:null,old=l.remoteRoom;
      if(m.availability!==undefined && !['online','busy','away','offline'].includes(m.availability))return;
      if(m.inCall!==undefined&&typeof m.inCall!=='boolean')return;
      const status=m.availability??'online';
      // Only an authenticated public presence is an observation. Heartbeats
      // on a retained invisible connection must never refresh this timestamp.
      if(status!=='offline'&&Date.now()-(this.profile.contactSeen?.[c.id]||0)>=10000){
        this.profile={...this.profile,contactSeen:{...this.profile.contactSeen,[c.id]:Date.now()}};
        if(!this.seenTimer){
          this.seenTimer=setTimeout(()=>this.flushSeen(),60000);this.seenTimer.unref();
        }
      }
      if(status!==l.contactStatus){l.contactStatus=status;this.update();}
      const b=m.back;
      const back=b && roomDoor(b.id) && typeof b.title==='string' && b.title.trim() && b.title.length<=48 && Number.isInteger(b.count)&&b.count>=1&&b.count<=17?{id:b.id,title:b.title,count:b.count,again:b.again===true}:null;
      l.remoteRoom={door:m.door,count:m.count,inCall:status!=='offline'&&m.inCall===true,again:m.again===true,back,game:m.game===1,version,until:Date.now()+50000};
      if(!old || old.door!==m.door || old.count!==m.count || old.inCall!==l.remoteRoom.inCall || old.version!==version || old.again!==l.remoteRoom.again || JSON.stringify(old.back)!==JSON.stringify(back))this.update();
      return;
    }
    if(m.kind==='ring'&&uuid(m.id)){
      const current=this.roomInfo();
      if(m.resume!==undefined && (m.resume!==true || !roomDoor(m.door))){l.send({kind:'busy',id:m.id});return;}
      if(m.door!==undefined && (!roomDoor(m.door) || !this.publishRoom || this.listedRoom?.door!==m.door ||
         !current?.invite || this.listedRoom.invite!==current.invite || m.canJoin!==true)){
        l.send({kind:'busy',id:m.id});return;
      }
      const returning=!!m.door && this.canReturn(c,current.invite);
      // Only an explicit request for this room can admit someone to it.
      // Older callers also set canJoin on ordinary calls from their contacts.
      const admission=!!m.door && current?.role==='host';
      if(this.hidden || !returning && (admission||m.roomInvitation===true?this.profile.privacy?.invites===false:this.profile.privacy?.calls===false)){l.send({kind:'busy',id:m.id});return;}
      if(m.resume && !returning || admission&&!returning&&!this.allows(c.id)){l.send({kind:'busy',id:m.id});return;}
      const full=admission && current.peers?.length>=LIMITS.participants;
      if(this.dnd||full||this.busy()&&!current||this.pending||this.out){if(this.pending?.id!==m.id)l.send({kind:'busy',id:m.id});return;}
      if(!Number.isSafeInteger(m.expires)||m.expires<Date.now()||m.expires>Date.now()+60000||this.lastRing.has(m.id))return;
      if(returning){
        if(this.linksTo(c.id).some(link=>link.card.device===c.device&&link.wire)){l.send({kind:'busy',id:m.id});return;}
        this.lastRing.set(m.id,Date.now());
        this.grants.set(c.device,{id:m.id,person:c.id,invite:current.invite,until:Date.now()+150000});
        l.send({kind:'join-here',id:m.id,invite:current.invite});this.announceRooms();this.update();return;
      }
      if(Date.now()-(this.lastRing.get(c.id)||0)<3000){l.send({kind:'busy',id:m.id});return;}
      this.lastRing.set(m.id,Date.now());
      this.lastRing.set(c.id,Date.now());this.pending={id:m.id,peer:c.id,device:c.device,admit:admission?current.invite:null,roomInvitation:!m.door&&m.roomInvitation===true,switchCall:!!current,expires:Math.min(m.expires,Date.now()+30000)};this.incoming();this.update();return;
    }
    if(m.kind==='cancel'||m.kind==='decline'){
      const grant=this.grants.get(c.device);
      if(grant && !grant.joined && grant.person===c.id && grant.id===m.id)this.dropGrant(c.device);
      if(m.kind==='cancel' && this.pending?.id===m.id && this.pending.peer===c.id && this.pending.device===c.device){
        this.pending=null;this.update();return;
      }
    }
    const out=this.out;
    if(out && out.id===m.id && out.peer===c.id && out.wait.has(c.device)){
      if(m.kind==='join-here'&&!out.taken&&out.canJoin&&(!this.busy() || !!out.door)&&out.expires>=Date.now()){
        decodeInvite(m.invite);
        for(const other of this.linksTo(out.peer))if(other.card.device!==c.device)other.send({kind:'cancel',id:out.id});
        this.out=null;this.pending={id:out.id,peer:c.id,device:c.device,expires:out.expires,taken:true,joining:true,resume:out.resume,door:out.door,invite:m.invite};
        this.incoming('join');this.update();return;
      }
      if(m.kind==='take'&&!out.door&&out.expires>=Date.now()&&!out.taken){
        out.taken=l;
        this.accepted(out,l).catch(()=>{if(this.out===out)this.cancel(tr('Не удалось открыть комнату.'));});return;
      }
      if(['decline','busy'].includes(m.kind)&&!out.taken){out.wait.delete(c.device);if(!out.wait.size)this.cancel(out.resume?tr('Эта комната уже недоступна.'):m.kind==='busy'?tr('Друг занят.'):tr('Вызов отклонён.'));return;}
    }
    if(m.kind==='invite'&&this.pending?.taken && this.pending.id===m.id&&this.pending.peer===c.id && this.pending.device===c.device && this.pending.expires>=Date.now() && !this.pending.joining){
      decodeInvite(m.invite);this.pending.joining=true;this.pending.invite=m.invite;this.pending.device=c.device;this.incoming('join');return;
    }
    if(m.kind==='open' && uuid(m.id) && !l.wire){
      const g=this.grants.get(c.device);if(!g || g.person!==c.id || g.until<Date.now() || m.ticket!==g.id || this.roomInfo()?.invite!==g.invite)return;
      if(this.linksTo(c.id).some(other=>other!==l && other.card.device===c.device && other.wire))return;
      const raw=net.connect({host:'127.0.0.1',port:decodeInvite(g.invite).port});
      let localPort;
      raw.once('connect',()=>{
        if(this.grants.get(c.device)!==g){raw.destroy();return;}
        localPort=raw.localPort;this.tunnels.set(localPort,{...g,device:c.device,raw});
      });
      raw.once('close',()=>{if(this.tunnels.get(localPort)?.raw===raw)this.tunnels.delete(localPort);});
      const wire=l.makeWire(m.id);raw.on('error',()=>wire.destroy());wire.once('close',()=>raw.destroy());raw.once('close',()=>wire.destroy());wire.pipe(raw).pipe(wire);return;
    }
    if(m.kind==='end'||m.kind==='data')l.receiveWire(m);
  }
  call(id, target){
    const f=this.contact(id),links=this.linksTo(id).filter(l=>l.contactStatus!=='offline');if(this.hidden||!links.length||f?.state!=='friend'||this.blocked(id))throw Error(tr('Друг сейчас недоступен.'));
    if(target && !this.roomsFor(id).some(r=>r.device===target.device && r.door===target.door && r.count<LIMITS.participants && (!target.resume||r.canReturn)))
      throw Error(tr('Эта комната уже недоступна.'));
    const current=this.roomInfo();
    if(this.out||this.pending||this.busy()&&!target&&(current?.role!=='host'||!current.invite))throw Error(tr('Сначала завершите текущий вызов.'));
    const out=this.out={id:randomUUID(),peer:id,canJoin:!!target,door:target?.door,resume:target?.resume===true,hostInvite:current?.role==='host'?current.invite:null,expires:Date.now()+30000,wait:new Set()};const sent=new Set();
    for(const l of links){if((target && target.device!==l.card.device)||sent.has(l.card.device))continue;sent.add(l.card.device);out.wait.add(l.card.device);l.send({kind:'ring',id:out.id,expires:out.expires,canJoin:out.canJoin,door:out.door,...(out.hostInvite&&!out.door?{roomInvitation:true}:{}),...(out.resume?{resume:true}:{})});}
    this.update();
  }
  async accepted(out,link){
    const room=this.roomInfo();
    if(out.hostInvite ? room?.role!=='host'||room.invite!==out.hostInvite : this.busy())throw Error(tr('Вызов завершён.'));
    for(const l of this.linksTo(out.peer))if(l.card.device!==link.card.device)l.send({kind:'cancel',id:out.id});
    const info=await this.hostRoom(link.route,()=>this.out===out&&!link.socket.destroyed,out.peer);if(this.out!==out || !info?.invite)return;
    this.grants.set(link.card.device,{id:out.id,person:out.peer,invite:info.invite,until:Date.now()+150000});
    link.send({kind:'invite',id:out.id,invite:info.invite});this.touch(out.peer);this.out=null;this.update();
  }
  touch(id){const f=this.contact(id);if(f)this.setFriend({...f,lastCall:Date.now()});}
  take(id,switchRoom=false){const p=this.pending;if(!p||p.id!==id||p.taken||p.expires<Date.now())throw Error(tr('Вызов завершён.'));
    const l=this.linksTo(p.peer).find(link=>link.card.device===p.device);if(!l)throw Error(tr('Связь потеряна.'));if(p.admit){
      const room=this.roomInfo();
      if(!this.allows(p.peer)||room?.invite!==p.admit||room.peers?.length>=LIMITS.participants){this.reject();throw Error(tr('Комната закрыта или заполнена.'));}
      this.grants.set(p.device,{id:p.id,person:p.peer,invite:p.admit,until:Date.now()+150000});
      l.send({kind:'join-here',id:p.id,invite:p.admit});this.pending=null;this.touch(p.peer);
    }else{
      if(this.busy()&&!(switchRoom&&p.switchCall&&this.roomInfo()))throw Error(tr('Сначала завершите текущий звонок.'));
      p.taken=true;l.send({kind:'take',id:p.id});
    }
    this.update();}
  pendingLive(p){
    return !!p && this.pending===p && p.expires>=Date.now() && !this.strict && !this.paused && this.contact(p.peer)?.state==='friend' &&
      !this.blocked(p.peer) && this.linksTo(p.peer).some(l=>l.card.device===p.device);
  }
  finishJoin(p){
    if(!this.pendingLive(p))throw Error(tr('Приглашение устарело.'));
    this.touch(p.peer);this.pending=null;this.update();
  }
  joinOptions(id,preparing=false){
    const p=this.pending;if(!p?.joining||p.id!==id||!this.pendingLive(p))throw Error(tr('Приглашение устарело.'));
    if(!preparing)this.finishJoin(p);
    let first=true;
    return {hostDevice:p.device,hostPerson:p.peer,name:this.profile.name,invite:p.invite,usePeerIce:this.linksTo(p.peer).find(l=>l.card.device===p.device)?.route==='dht',transportFactory:()=>{
      const l=this.linksTo(p.peer).find(link=>link.card.device===p.device);
      if(!l || (first && preparing && this.linksTo(p.peer).some(other=>other.card.device===p.device && other.wire)))
        throw Object.assign(Error(tr('Связь потеряна.')),{code:'ECONNRESET'});
      first=false;
      const wire=l.makeWire();l.send({kind:'open',ticket:p.id,id:wire.wireId});return wire;
    }};
  }
  reject(){if(this.pending)for(const l of this.linksTo(this.pending.peer))l.send({kind:'decline',id:this.pending.id});this.pending=null;this.update();}
  cancel(msg){if(this.out)for(const l of this.linksTo(this.out.peer))l.send({kind:'cancel',id:this.out.id});this.out=null;if(msg)this.notice(msg);this.update();}
  forget(id,block=false){
    let blocked=this.profile.blocked||[];
    if(block&&!this.blocked(id)){
      const name=this.contact(id)?.name||this.requests.get(id)?.name;
      if(!name||!hex32(id)||blocked.length>=256)throw Error(tr('Не удалось добавить контакт в список блокировки.'));
      blocked=[...blocked,{id,name}];
    }
    this.game.remove(id);this.audience.ids.delete(id);for(const [device,g] of this.returning)if(g.person===id)this.returning.delete(device);
    const contactAvatars={...this.profile.contactAvatars};delete contactAvatars[id];this.pendingAvatars.delete(id);
    const contactStyles={...this.profile.contactStyles};delete contactStyles[id];this.pendingStyles.delete(id);
    const contactMix={...this.profile.contactMix};delete contactMix[id];
    const contactSeen={...this.profile.contactSeen};delete contactSeen[id];
    const contactChecks={...this.profile.contactChecks};delete contactChecks[id];
    this.save({...this.profile,contactChecks,contactSeen,contactMix,contactAvatars,contactStyles,blocked,requests:[...this.requests.values()].filter(c=>c.id!==id),friends:this.profile.friends.filter(f=>f.id!==id)});
    this.groups.forget(id);
    if(block)for(const [key,v] of this.near)if(v.card.id===id)this.near.delete(key);
    this.nextLookup.delete(id);for(const [key,g] of this.grants)if(g.person===id)this.grants.delete(key);if(this.pending?.peer===id)this.reject();if(this.out?.peer===id)this.cancel();for(const l of this.linksTo(id))l.socket.destroy();this.requests.delete(id);
    try{this.chats.discard(id);}catch(error){this.issue=error.message;this.update();}}
  unblock(id){this.save({...this.profile,blocked:(this.profile.blocked||[]).filter(c=>c.id!==id)});}
  async import(bytes,pass){
    const p=await unseal(bytes,pass);
    if(this.profile && this.profile.root!==p.root)throw Error(tr('На этом ПК уже открыт другой профиль. Для импорта нужен новый локальный профиль Windows-приложения.'));
    if(this.profile)throw Error(tr('Этот профиль уже подключён на данном ПК.'));
    this.requests=new Map((p.requests||[]).map(c=>[c.id,c]));this.save({...p,device:seed(),lan:'',dht:false});this.start();
  }
  export(pass){return seal(this.profile,pass);}
  card(){return shareCard(this.profile);}
  flushSeen(){
    if(!this.seenTimer)return;
    clearTimeout(this.seenTimer);this.seenTimer=null;
    try{this.store.write(this.profile);}catch{this.issue=tr('Не удалось сохранить профиль.');this.update();}
  }
  async stop(){
    this.lastRefresh=0;
    this.flushSeen();
    this.voiceChannels.close();
    this.flushAvatars();const files=this.chats.close(),groups=this.groups.close();
    this.grants.clear();this.returning.clear();this.tunnels.clear();
    this.game.invitations.clear();this.game.leave();const released=this.gameNet.stop();
    clearInterval(this.timer);this.timer=null;clearTimeout(this.dirty);this.dirty=null;
    for(const s of this.allSockets)s.destroy();
    await Promise.all([this.network.stop(),released,files,groups,Promise.allSettled([...this.game.files.work])]);
  }
}
module.exports={DirectService};
