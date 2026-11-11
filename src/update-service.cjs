'use strict';
const fs=require('node:fs'),path=require('node:path');
const {lookup,download,savedOffer,supportURL,removeStage,rateLimitMessage}=require('./github-releases.cjs');
const {tr}=require('./native-language.cjs');
const {writeProfileFile}=require('./profile-paths.cjs');
const DAY=24*60*60*1000;
const strictMessage='Проверка GitHub недоступна в режиме «Только через ретранслятор».';
const busyMessage='Дождитесь завершения текущей операции обновления.';
const platformMessage='Этот установщик предназначен для Windows x64.';

class UpdateService {
  constructor({directory,cache,current,allowed,supported,scheduled,changed,install,openExternal,fetcher=fetch,now=Date.now}){
    Object.assign(this,{cache,current,allowed,supported,scheduled,changed,install,openExternal,fetcher,now});
    this.file=path.join(directory,'release-check-v1.json');
    this.preferences={automatic:true,checked:0,offer:null};
    try{
      const p=JSON.parse(fs.readFileSync(this.file,'utf8'));
      this.preferences={automatic:p.automatic===true,checked:Number.isSafeInteger(p.checked)&&p.checked>=0&&p.checked<=now()?p.checked:0,offer:savedOffer(p.offer,current)};
    }catch(e){if(e.code!=='ENOENT')this.preferences.automatic=false;}
    this.phase=this.preferences.offer?'available':'idle';this.error='';this.release=null;this.staged=null;
  }
  state(){const offer=this.release||this.preferences.offer;return {phase:this.phase,installed:this.current,version:offer?.version||'',bytes:offer?.size||0,
    automatic:this.preferences.automatic,checked:this.preferences.checked,networkAllowed:this.allowed()===true,
    supported:this.supported,donation:!!supportURL(),error:tr(this.error)};}
  notify(){this.changed(this.state());}
  save(value){writeProfileFile(this.file,JSON.stringify(value));this.preferences=value;}
  schedule(){
    clearTimeout(this.timer);
    if(this.closed || this.clearing || !this.scheduled || !this.supported || !this.allowed() || !this.preferences.automatic || this.operation || this.staged)return;
    const delay=Math.max(20000,this.preferences.checked+DAY-this.now());
    this.timer=setTimeout(()=>this.check(true).catch(()=>{}),delay);this.timer.unref();
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
    this.operation=null;this.background=false;this.schedule();if(!this.closed)this.notify();
  }
  async check(background=false){
    if(this.staged)return this.state();
    if(background && (!this.preferences.automatic || this.preferences.checked>this.now()-DAY))return this.state();
    const request=this.start('checking');this.background=background;this.release=null;
    try{
      this.save({...this.preferences,checked:this.now()});
      const result=await lookup(this.current,this.fetcher,AbortSignal.any([request.signal,AbortSignal.timeout(15000)]));
      request.signal.throwIfAborted();if(!this.allowed())throw Error(tr(strictMessage));
      this.save({...this.preferences,offer:savedOffer(result.release,this.current)});
      this.phase=result.phase;this.release=result.release||null;
    }catch(e){
      this.phase=request.signal.aborted?'idle':'unavailable';
      this.error=request.signal.aborted?'':[rateLimitMessage,'Установщик выпуска не прошёл проверку.'].includes(e.message)?e.message:'Не удалось получить выпуск с GitHub. Повторите проверку позже.';
    }finally{this.finish();}
    return this.state();
  }
  async fetchInstaller(){
    if(!this.release && this.phase==='available' && this.preferences.offer){
      // Persist only a display hint. Resolve the publisher's current asset and
      // digest again before acting on a hint from a previous app process.
      const expected=this.preferences.offer.version;await this.check();
      if(this.release?.version!==expected)return this.state();
    }
    if(!this.release || this.phase!=='available')throw Error(tr('Сначала проверьте наличие обновлений.'));
    const request=this.start('downloading');
    try{
      const file=await download(this.release,this.cache,this.fetcher,AbortSignal.any([request.signal,AbortSignal.timeout(10*60*1000)]));
      if(request.signal.aborted || !this.allowed() || this.closed){await removeStage(path.dirname(file));throw Error(tr(strictMessage));}
      this.staged=file;this.phase='ready';
    }catch(e){
      this.phase='available';this.error=request.signal.aborted?'':e.message==='Установщик выпуска не прошёл проверку.'?e.message:'Не удалось скачать обновление. Повторите загрузку.';
    }finally{this.finish();}
    return this.state();
  }
  async command(raw){
    if(this.closed)throw Error(tr('Приложение завершает работу.'));
    switch(raw?.op){
      case 'state':return this.state();
      case 'automatic':return this.automatic(raw.enabled);
      case 'check':return this.check();
      case 'cancel':this.operation?.abort();return this.state();
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
      await cleanup(this.cache);
      this.staged=null;this.phase=this.release||this.preferences.offer?'available':'idle';this.error='';
    }finally{this.clearing=false;this.schedule();if(!this.closed)this.notify();}
  }
  close(){this.closed=true;clearTimeout(this.timer);this.operation?.abort();}
}
module.exports={UpdateService,DAY};
