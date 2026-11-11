'use strict';
const {tr}=require('../native-language.cjs');
const { joinHost }=require('./session.cjs');

// The invite and certificate pin remain in memory for this guest's current room.
async function joinRecoveringGuest(options,connect=joinHost) {
  const retryable=new Set(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','DNS_TIMEOUT',
    'EAI_AGAIN','ENOTFOUND','CONNECTION_CLOSED','ROOM_FULL','EADDRNOTAVAIL','ENETDOWN','IDLE_TIMEOUT','EPIPE']);
  let active,info,timer,deadline=0,stopped=false,tries=0,generation=0,attempt;
  function finish(reason) {
    if(stopped)return;
    stopped=true;clearTimeout(timer);options.onEvent({type:'closed',reason});
  }
  function retry(){
    if(stopped)return;
    const delay=Math.min(8000,1000*2**Math.min(tries++,3));
    if(Date.now()+delay>deadline)return finish(tr('Не удалось вернуться в комнату. Проверьте, доступен ли адрес создателя через текущую сеть.'));
    timer=setTimeout(()=>open(true).catch(e=>{
      if(stopped)return;
      if(retryable.has(e.code))retry();else finish(e.message);
    }),delay);
  }
  async function open(resuming){
    const epoch=++generation;
    const queued=[];
    let ready=false,ended=false;
    attempt=new AbortController();
    const received=event=>{
      if(stopped || epoch!==generation || ended)return;
      if(!ready){queued.push(event);return;}
      if(event.type!=='closed'){options.onEvent(event);return;}
      ended=true;active=null;
      if(!event.retryable){finish(event.reason);return;}
      deadline=Date.now()+120000;tries=0;
      options.onEvent({type:'network-reconnecting'});
      retry();
    };
    const signal=options.signal?AbortSignal.any([options.signal,attempt.signal]):attempt.signal;
    const guest=await connect({...options,signal,onEvent:received});
    if(stopped||epoch!==generation){await guest.close();return;}
    active=guest;info=guest.getInfo();ready=true;
    if(resuming)options.onEvent({type:'network-rejoined',info});
    queued.forEach(received);
  }
  await open(false);
  function connected(){
    if(!active)throw Error(tr('Восстанавливаем соединение с создателем.'));
    return active;
  }
  return {getInfo:()=>active?.getInfo()??info,sendChat:text=>connected().sendChat(text),
    sendSignal:(peer,data)=>active?.sendSignal(peer,data),setPresence:value=>active?.setPresence(value),
    close:async()=>{stopped=true;generation++;clearTimeout(timer);
      if(active)await active.close();else attempt?.abort();}};
}
module.exports={joinRecoveringGuest};
