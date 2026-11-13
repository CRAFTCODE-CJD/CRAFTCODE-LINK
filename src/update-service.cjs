'use strict';
const fs=require('node:fs'),path=require('node:path');
const {lookup,download,partialSize,cleanupPartials,savedOffer,supportURL,removeStage,rateLimitMessage}=require('./github-releases.cjs');
const {tr}=require('./native-language.cjs');
const {writeProfileFile}=require('./profile-paths.cjs');
const DAY=24*60*60*1000;
const maxReconnectDelay=60000;
const strictMessage='Проверка GitHub недоступна в режиме «Только через ретранслятор».';
const busyMessage='Дождитесь завершения текущей операции обновления.';
const platformMessage='Этот установщик предназначен для Windows x64.';

class UpdateService {
  constructor({directory,cache,current,allowed,supported,scheduled,changed,announce,install,openExternal,fetcher=fetch,now=Date.now}){
    Object.assign(this,{cache,current,allowed,supported,scheduled,changed,announce,install,openExternal,fetcher,now});
    this.file=path.join(directory,'release-check-v1.json');
    this.preferences={automatic:true,checked:0,retryAt:0,offer:null,pending:null,announced:''};
    try{
      const p=JSON.parse(fs.readFileSync(this.file,'utf8'));
      const offer=savedOffer(p.offer,current);
      const pending=offer && p.pending?.version===offer.version && p.pending.size===offer.size &&
        (p.pending.sha===null || typeof p.pending.sha==='string' && /^[0-9a-f]{64}$/.test(p.pending.sha))
        ? {...offer,sha:p.pending.sha} : null;
      this.preferences={automatic:p.automatic===true,checked:Number.isSafeInteger(p.checked)&&p.checked>=0&&p.checked<=now()?p.checked:0,
        retryAt:Number.isSafeInteger(p.retryAt)&&p.retryAt>0&&p.retryAt<=now()+7*DAY?p.retryAt:0,
        offer,pending,announced:typeof p.announced==='string'?p.announced.slice(0,16):''};
    }catch(e){if(e.code!=='ENOENT')this.preferences.automatic=false;}
    this.nextAttemptAt=0;this.retryDelay=1000;this.resumeFrom=0;
    this.phase=this.preferences.pending?'waiting':this.preferences.offer?'available':'idle';this.error='';this.release=null;this.staged=null;this.received=0;this.bytesPerSecond=0;
  }
  state(){const offer=this.release||this.preferences.offer;return {phase:this.phase,installed:this.current,version:offer?.version||'',bytes:offer?.size||0,
    received:this.received,resumeFrom:this.resumeFrom,nextAttemptAt:this.nextAttemptAt,bytesPerSecond:this.bytesPerSecond,automatic:this.preferences.automatic,checked:this.preferences.checked,retryAt:this.preferences.retryAt,networkAllowed:this.allowed()===true,
    supported:this.supported,donation:!!supportURL(),error:tr(this.error)};}
  notify(){this.changed(this.state());}
  save(value){writeProfileFile(this.file,JSON.stringify(value));this.preferences=value;}
  announceAvailable(){
    const {offer,announced,automatic}=this.preferences;
    if(this.closed||this.clearing||this.phase!=='available'||!this.release||!automatic||!this.allowed()||!offer||offer.version===announced)return;
    if(this.announce?.(offer.version)===true)this.save({...this.preferences,announced:offer.version});
  }
  async restore(){
    const {pending}=this.preferences;
    await cleanupPartials(this.cache,pending?.sha ? pending : null);
    if(pending?.sha){
      try{this.received=await partialSize(this.cache,pending);}
      catch(e){
        if(e.code!=='UPDATE_INVALID_PAYLOAD')throw e;
        // Discard an unusable partial before retrying the verified release.
        await cleanupPartials(this.cache);
      }
    }
    this.schedule();
  }
  schedule(){
    clearTimeout(this.timer);
    if(this.closed || this.clearing || !this.supported || !this.allowed() || this.operation || this.staged)return;
    if(this.preferences.pending){
      const due=Math.max(this.nextAttemptAt,this.preferences.retryAt);
      this.timer=setTimeout(()=>this.fetchInstaller().catch(()=>{}),Math.max(0,due-this.now()));
    }else{
      if(!this.scheduled || !this.preferences.automatic)return;
      const due=this.preferences.retryAt||this.preferences.checked+DAY;
      const delay=Math.max(20000,due-this.now())+Math.floor(Math.random()*8000);
      this.timer=setTimeout(()=>this.check(true).catch(()=>{}),delay);
    }
    this.timer.unref();
  }
  policy(){
    if(!this.allowed())this.operation?.abort();
    this.schedule();this.notify();
  }
  automatic(value){
    if(typeof value!=='boolean')throw Error(tr('Некорректная команда.'));
    this.save({...this.preferences,automatic:value});
    if(!value && this.background)this.operation?.abort();
    this.schedule();this.notify();return this.state();
  }
  start(phase){
    if(!this.supported)throw Error(tr(platformMessage));
    if(!this.allowed())throw Error(tr(strictMessage));
    if(this.operation || this.installing || this.clearing)throw Error(tr(busyMessage));
    clearTimeout(this.timer);
    const controller=this.operation=new AbortController();this.phase=phase;this.error='';this.notify();
    return controller;
  }
  finish(){
    this.operation=null;this.downloadTask=null;this.background=false;this.schedule();if(!this.closed)this.notify();
  }
  async check(background=false){
    if(this.staged||this.preferences.pending)return this.state();
    if(this.preferences.retryAt>this.now()){this.error=rateLimitMessage;this.notify();return this.state();}
    if(background && (!this.preferences.automatic || !this.preferences.retryAt&&this.preferences.checked>this.now()-DAY))return this.state();
    const request=this.start('checking');this.background=background;this.release=null;
    try{
      this.save({...this.preferences,checked:this.now(),retryAt:0});
      const result=await lookup(this.current,this.fetcher,AbortSignal.any([request.signal,AbortSignal.timeout(15000)]));
      request.signal.throwIfAborted();if(!this.allowed())throw Error(tr(strictMessage));
      const offer=savedOffer(result.release,this.current);
      this.save({...this.preferences,offer,announced:!background&&offer?offer.version:this.preferences.announced});
      this.phase=result.phase;this.release=result.release||null;
      if(background)this.announceAvailable();
    }catch(e){
      if(e.retryAfterMs&&!request.signal.aborted)this.save({...this.preferences,retryAt:this.now()+e.retryAfterMs});
      this.phase=request.signal.aborted?'idle':'unavailable';
      this.error=request.signal.aborted?'':[rateLimitMessage,'Установщик выпуска не прошёл проверку.'].includes(e.message)?e.message:'Не удалось получить выпуск с GitHub. Повторите проверку позже.';
    }finally{this.finish();}
    return this.state();
  }
  async fetchInstaller(){
    if(this.preferences.retryAt>this.now()){this.error=rateLimitMessage;this.notify();return this.state();}
    if(!['available','waiting'].includes(this.phase)||!this.preferences.offer)throw Error(tr('Сначала проверьте наличие обновлений.'));
    const request=this.start('downloading');
    this.downloadTask=this.attempt(request);
    return this.downloadTask;
  }
  async attempt(request){
    this.nextAttemptAt=0;this.bytesPerSecond=0;this.resumeFrom=this.received;
    try{
      const {offer}=this.preferences;
      // Remember the click even when a cached offer needs fresh metadata before its first byte.
      if(!this.preferences.pending)this.save({...this.preferences,pending:{...offer,sha:this.release?.sha??null}});
      const {pending}=this.preferences;
      if(!this.release){
        // After a restart only the user's selection is persisted. Resolve the URL and hash from the publisher.
        const lookupSignal=AbortSignal.any([request.signal,AbortSignal.timeout(15000)]);
        const result=await lookup(this.current,this.fetcher,lookupSignal);
        request.signal.throwIfAborted();
        this.release=result.release||null;
        const found=savedOffer(this.release,this.current);
        if(!found||found.version!==offer.version||found.size!==offer.size||pending.sha&&this.release.sha!==pending.sha){
          this.save({...this.preferences,offer:found,pending:null,checked:this.now(),retryAt:0});
          this.phase=result.phase;this.received=0;this.resumeFrom=0;
          await cleanupPartials(this.cache);
          return this.state();
        }
      }
      if(!this.allowed())throw Error(tr(strictMessage));
      if(!pending.sha)this.save({...this.preferences,pending:{...pending,sha:this.release.sha}});
      const started=performance.now();let last=started;
      const progress=(received,transferred)=>{
        if(request.signal.aborted||this.closed)return;
        if(received>this.received)this.retryDelay=1000;
        this.received=received;this.resumeFrom=received-transferred;
        const now=performance.now();this.bytesPerSecond=Math.round(transferred*1000/Math.max(1,now-started));
        if(!transferred||now-last>=200||received===this.release.size){last=now;this.notify();}
      };
      const file=await download(this.release,this.cache,this.fetcher,request.signal,progress);
      if(this.closed||request.signal.aborted||!this.allowed()){
        await removeStage(path.dirname(file));
        throw Error(tr(strictMessage));
      }
      try{this.save({...this.preferences,pending:null,retryAt:0});}
      catch(e){await removeStage(path.dirname(file));throw e;}
      this.staged=file;
      this.phase='ready';this.retryDelay=1000;
    }catch(e){
      this.bytesPerSecond=0;
      if(this.closed)return this.state();
      const pending=this.preferences.pending;
      if(e.retryAfterMs&&!request.signal.aborted)this.save({...this.preferences,retryAt:this.now()+e.retryAfterMs});
      if(pending&&(request.signal.aborted||e.retryable||e.retryAfterMs||e.name==='TimeoutError')){
        this.phase='waiting';
        this.nextAttemptAt=Math.max(this.preferences.retryAt,this.now()+this.retryDelay);
        this.retryDelay=Math.min(maxReconnectDelay,this.retryDelay*2);
      }else{
        this.phase=this.preferences.offer?'available':'idle';
        this.error=request.signal.aborted?'':e.retryAfterMs?rateLimitMessage:
          e.code==='ENOSPC'?'На выбранном диске недостаточно свободного места.':
          e.message==='Установщик выпуска не прошёл проверку.'?e.message:'Не удалось скачать обновление. Повторите загрузку.';
        if(pending)this.save({...this.preferences,pending:null});
        this.received=0;this.resumeFrom=0;this.nextAttemptAt=0;
        await cleanupPartials(this.cache);
      }
    }finally{this.finish();}
    return this.state();
  }
  async cancel(){
    if(this.clearing)return this.state();
    if(!this.preferences.pending && !this.downloadTask){this.operation?.abort();return this.state();}
    this.clearing=true;
    try{
      clearTimeout(this.timer);
      this.save({...this.preferences,pending:null});
      this.operation?.abort();
      await this.downloadTask;
      await cleanupPartials(this.cache);
      this.received=0;this.resumeFrom=0;this.bytesPerSecond=0;this.nextAttemptAt=0;this.retryDelay=1000;
      if(!this.staged)this.phase=this.preferences.offer?'available':'idle';
      this.error='';
    }finally{this.clearing=false;this.schedule();this.notify();}
    return this.state();
  }
  async command(raw){
    if(this.closed)throw Error(tr('Приложение завершает работу.'));
    switch(raw?.op){
      case 'state':return this.state();
      case 'automatic':return this.automatic(raw.enabled);
      case 'check':return this.check();
      case 'cancel':return this.cancel();
      case 'download':return this.fetchInstaller();
      case 'install':{
        if(!this.staged || this.phase!=='ready')throw Error(tr('Сначала скачайте проверенный установщик.'));
        if(this.installing || this.clearing)throw Error(tr(busyMessage));
        this.installing=true;
        try{await this.install(this.staged,this.release);}
        catch(e){
          if(e.code!=='UPDATE_INVALID_PAYLOAD'&&e.code!=='ENOENT')throw e;
          const file=this.staged;this.staged=null;this.phase='available';this.error='Установщик выпуска не прошёл проверку.';
          await removeStage(path.dirname(file));this.notify();
        }
        finally{this.installing=false;}
        return this.state();
      }
      case 'donate':{
        if(Object.keys(raw).some(key=>key!=='op'))throw Error(tr('Некорректная команда.'));
        const url=supportURL();if(!url)throw Error(tr('Ссылка поддержки пока недоступна.'));
        await this.openExternal(url);return this.state();
      }
      default:throw Error(tr('Неизвестная команда.'));
    }
  }
  async clearCache(cleanup){
    if(this.closed || this.operation || this.installing || this.clearing)throw Error(tr(busyMessage));
    this.clearing=true;clearTimeout(this.timer);
    try{
      this.save({...this.preferences,pending:null});
      this.nextAttemptAt=0;this.received=0;this.resumeFrom=0;this.bytesPerSecond=0;this.retryDelay=1000;
      await cleanup(this.cache);
      this.staged=null;this.phase=this.release||this.preferences.offer?'available':'idle';this.error='';
      await cleanupPartials(this.cache);
    }finally{this.clearing=false;this.schedule();if(!this.closed)this.notify();}
  }
  close(){this.closed=true;clearTimeout(this.timer);this.operation?.abort();}
}
module.exports={UpdateService,DAY};
