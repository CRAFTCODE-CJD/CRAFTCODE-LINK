import {tr} from './locale.mjs';
import {bindChatTools} from './chat-record.mjs';
import {mediaPresentation} from './chat-player.mjs';
const LIMIT=8*1024**2;
export function chatComposer({$,room,onError,inputChanged,micDevice}){
  let active=null;
  const dialog=$('clipDialog'),display=$('clipDisplay'),status=$('clipStatus'),send=$('clipSend'),stop=$('clipStop');
  function release(s){
    clearInterval(s.timer);
    if(s.recorder?.state==='recording')s.recorder.stop();
    s.stream?.getTracks().forEach(t=>t.stop());
    s.media?.dispose();if(s.url)URL.revokeObjectURL(s.url);
    if(s.requestId){s.shelf.api({op:'camera-end',requestId:s.requestId}).catch(()=>{});s.requestId=null;}
  }
  function clear(){
    const s=active;active=null;if(s)release(s);
    display.replaceChildren();if(dialog.open)dialog.close();
    $('chatAttach').open=false;$('chatEmoji').open=false;
  }
  function start(kind,shelf,title){
    clear();if(!shelf)return;
    active={kind,shelf};$('clipTitle').textContent=tr(title);status.textContent='';
    send.hidden=stop.hidden=true;send.disabled=false;dialog.showModal();return active;
  }
  function show(s,blob,type){
    display.replaceChildren();
    s.url=URL.createObjectURL(blob);
    s.media=mediaPresentation(type,s.kind,s.url,$('clipTitle').textContent,onError,blob);
    display.append(s.media.view);
  }
  async function view(shelf,id,v){
    const s=start(v.clip||'preview',shelf,v.clip==='voice'?'Голосовое сообщение':v.clip==='circle'?'Видеосообщение':v.name);if(!s)return;
    try{const r=await shelf.api({op:'preview',id,meta:{name:v.name,size:v.size,sha:v.sha}});
      if(active===s)show(s,new Blob([r.bytes],{type:r.type}),r.type);
    }catch(e){if(active===s){clear();onError(e);}}
  }
  async function record(kind,shelf=room(),defaultMic=false){
    const s=start(kind,shelf,kind==='voice'?'Голосовое сообщение':'Видеосообщение');if(!s)return;
    try{
      s.capturing=true;
      status.textContent=tr('Подключение устройства…');
      if(kind==='circle')s.requestId=crypto.randomUUID();
      if(kind==='circle'&&!await s.shelf.api({op:'camera',requestId:s.requestId})){if(active===s)clear();return;}
      if(active!==s)return;
      const device=defaultMic?'':micDevice(),audio={echoCancellation:true,noiseSuppression:true,...(device&&device!=='default'?{deviceId:{exact:device}}:{})};
      const stream=await navigator.mediaDevices.getUserMedia({audio,video:kind==='circle'?{width:{ideal:360},height:{ideal:360},frameRate:{ideal:15,max:20}}:false});
      if(active!==s){stream.getTracks().forEach(t=>t.stop());return;}
      s.stream=stream;
      const mime=(kind==='voice'?['audio/webm;codecs=opus','audio/webm']:['video/webm;codecs=vp8,opus','video/webm']).find(type=>MediaRecorder.isTypeSupported(type));
      if(!mime)throw Error(tr('Устройство записи недоступно.'));
      const recorder=s.recorder=new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:64000,...(kind==='circle'?{videoBitsPerSecond:450000}:{})});
      const chunks=[];let size=0;
      if(kind==='circle'){const live=document.createElement('video');live.className='chat-circle';live.muted=true;live.autoplay=true;live.srcObject=stream;display.append(live);}
      const started=performance.now(),limit=kind==='voice'?600:60;
      const clock=seconds=>Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
      function tick(){const sec=Math.floor((performance.now()-started)/1000);status.textContent=tr('Идёт запись')+' · '+clock(sec)+' / '+clock(limit);if(sec>=limit&&recorder.state==='recording')recorder.stop();}
      recorder.ondataavailable=e=>{if(active!==s||!e.data.size)return;size+=e.data.size;if(size>LIMIT){clear();onError(tr('Достигнут предел размера записи.'));return;}chunks.push(e.data);};
      recorder.onerror=()=>{if(active===s){clear();onError(tr('Устройство записи недоступно.'));}};
      recorder.onstop=()=>{
        stream.getTracks().forEach(t=>t.stop());clearInterval(s.timer);
        if(active!==s)return;
        s.capturing=false;stop.hidden=true;if(!size){clear();return;}
        s.blob=new Blob(chunks,{type:mime});show(s,s.blob,mime);status.textContent=tr('Проверьте запись перед отправкой.');send.hidden=false;
      };
      recorder.start(250);stop.hidden=false;s.timer=setInterval(tick,250);tick();
    }catch(e){
      if(active!==s)return;
      release(s);s.capturing=false;stop.hidden=send.hidden=true;display.replaceChildren();
      const action=(label,run)=>{
        const button=document.createElement('button');button.type='button';button.className='button button-secondary';button.textContent=tr(label);
        button.onclick=()=>Promise.resolve().then(run).catch(onError);display.append(button);
      };
      const denied=['NotAllowedError','SecurityError','PermissionDeniedError'].includes(e.name) || e.message==='Permission denied by system';
      const missing=['NotFoundError','OverconstrainedError','DevicesNotFoundError'].includes(e.name);
      if(denied){
        const access=await window.craftlink.recordingPrivacy('status').catch(()=>null);
        if(active!==s)return;
        status.textContent=tr(access?'Проверьте доступ к устройствам для классических приложений в параметрах конфиденциальности Windows. Затем повторите запись.':'Разрешите приложению доступ к устройству записи и повторите попытку.');
        if(access){
          const devices=kind==='circle'?['microphone','camera']:['microphone'];
          const blocked=devices.filter(d=>['denied','restricted'].includes(access[d]));
          for(const d of blocked.length?blocked:devices)action(d==='camera'?'Параметры камеры':'Параметры микрофона',()=>window.craftlink.recordingPrivacy(d));
        }
      }else if(missing){
        status.textContent=tr(kind==='circle'?'Для видеосообщения нужны доступные камера и микрофон. Подключите устройства и повторите попытку.':'Выбранный микрофон недоступен. Подключите его или выберите другой микрофон.');
        if(!defaultMic && micDevice() && micDevice()!=='default')action('Записать с микрофона по умолчанию',()=>record(kind,shelf,true));
      }else if(e.name==='NotReadableError'||e.name==='TrackStartError'){
        status.textContent=tr('Устройство занято или отключилось. Проверьте подключение и повторите запись.');
      }else{
        status.textContent=tr('Устройство записи недоступно.');
      }
      action('Повторить запись',()=>record(kind,shelf,defaultMic));
    }
  }
  send.onclick=async()=>{
    const s=active;if(!s?.blob||send.disabled||!(s.shelf.current?.()??(room()===s.shelf)))return;send.disabled=true;
    try{const bytes=new Uint8Array(await s.blob.arrayBuffer());if(active!==s)return;
      if(s.shelf.sendClip){await s.shelf.sendClip(s.kind,bytes);if(active===s)clear();return;}
      const m=await s.shelf.api({op:'clip',kind:s.kind,bytes});
      if(active===s&&room()===s.shelf){s.shelf.publish({...m,clip:s.kind});clear();}
      else s.shelf.api({op:'remove',id:m.id}).catch(()=>{});
    }catch(e){if(active===s){send.disabled=false;onError(e);}}
  };
  function stopCapture(){if(active?.capturing)clear();}
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCapture();});
  stop.onclick=()=>{if(active?.recorder?.state==='recording')active.recorder.stop();};
  $('clipClose').onclick=clear;dialog.addEventListener('cancel',e=>{e.preventDefault();clear();});
  const roomRecord=bindChatTools({$,prefix:'chat',form:$('chatForm'),input:$('chatInput'),record:kind=>record(kind),
    offer:()=>room()?.offer(),onError,onInput:inputChanged});
  return {clear,clearFor(context,recordOnly=false){if(active&&(active.shelf.context||'room')===context&&(!recordOnly||active.capturing!==undefined))clear();},roomRecord,view,record,stopCapture};
}
