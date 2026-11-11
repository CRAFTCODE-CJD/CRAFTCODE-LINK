import {tr} from './locale.mjs';

export function cameraError(error){
  if(error?.name==='NotAllowedError')return tr('Камера не разрешена. Разрешите доступ в настройках конфиденциальности системы и повторите попытку.');
  if(error?.name==='NotFoundError'||error?.name==='OverconstrainedError')return tr('Камера не найдена. Подключите её и нажмите «Обновить».');
  if(error?.name==='NotReadableError'||error?.name==='AbortError')return tr('Не удалось включить камеру. Возможно, она занята другой программой. Закройте её и повторите попытку.');
  return error?.message || tr('Не удалось включить камеру. Повторите попытку.');
}

// This owner releases late acquisitions too: leaving the room while Windows is
// opening a device must never leave an unowned camera track behind.
export function cameraCapture({api,devices=navigator.mediaDevices,current,changed}){
  let serial=0,request=null,stream=null,busy=false,cameras=[];
  const stopTracks=value=>value?.getTracks().forEach(track=>track.stop());
  function stop(){
    serial++;busy=false;
    const id=request;request=null;stopTracks(stream);stream=null;cameras=[];
    if(id)api.liveCamera({action:'cancel',requestId:id}).catch(()=>{});
    changed();
  }
  async function open(deviceId){
    if(busy || !current())return false;
    stop();const epoch=serial,id=crypto.randomUUID();request=id;busy=true;changed();
    let acquired;
    try{
      if(!await api.liveCamera({action:'ask',requestId:id}) || epoch!==serial || !current())return false;
      // Read device names while this explicit one-use grant is still valid.
      // Enumerating after getUserMedia consumes it hides other cameras again.
      const listed=await devices.enumerateDevices?.() || [];
      if(epoch!==serial || !current())return false;
      cameras=listed.filter(device=>device.kind==='videoinput');
      acquired=await devices.getUserMedia({audio:false,video:{deviceId:deviceId?{exact:deviceId}:undefined,
        width:{ideal:1280,max:1920},height:{ideal:720,max:1080},frameRate:{ideal:30,max:30}}});
      if(epoch!==serial || !current()){stopTracks(acquired);return false;}
      const track=acquired.getVideoTracks()[0];
      if(!track || track.readyState!=='live')throw Object.assign(Error(),{name:'NotReadableError'});
      stream=acquired;
      track.addEventListener('ended',()=>{if(stream===acquired)stop();},{once:true});
      return true;
    }catch(error){stopTracks(acquired);if(epoch===serial)throw Error(cameraError(error));return false;}
    finally{
      api.liveCamera({action:'cancel',requestId:id}).catch(()=>{});
      if(request===id)request=null;
      if(epoch===serial){busy=false;changed();}
    }
  }
  function take(){
    if(!current() || busy || stream?.getVideoTracks()[0]?.readyState!=='live')return null;
    const result=stream;stream=null;serial++;changed();return result;
  }
  return {open,stop,take,get stream(){return stream;},get busy(){return busy;},get devices(){return cameras;}};
}
