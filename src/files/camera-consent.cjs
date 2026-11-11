'use strict';
const {tr}=require('../native-language.cjs');
const validId=id=>typeof id==='string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id);

async function promptCamera(getWindow,dialog){
  const win=getWindow();
  if(!win?.isVisible() || win.isMinimized())return false;
  const choice=await dialog.showMessageBox(win,{type:'question',title:tr('Видеосообщение'),message:tr('Включить камеру и микрофон для записи?'),buttons:[tr('Отмена'),tr('Записать')],defaultId:0,cancelId:0});
  return choice.response===1 && win===getWindow() && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
}

class CameraConsent {
  constructor(){this.request=null;this.promptOpen=false;}
  async ask(id,prompt,isCurrent=()=>true){
    if(this.promptOpen || !validId(id) || !isCurrent())return false;
    this.reset();
    const request={id,until:0,isCurrent};
    this.request=request;this.promptOpen=true;
    try{
      if(!await prompt() || this.request!==request || !isCurrent())return false;
      request.until=Date.now()+15000;
      request.timer=setTimeout(()=>this.cancel(id),15000);
      request.timer.unref();
      return true;
    }finally{
      this.promptOpen=false;
      if(this.request===request && !request.until)this.request=null;
    }
  }
  reset(){clearTimeout(this.request?.timer);this.request=null;}
  cancel(id){if(this.request?.id===id)this.reset();}
  allowed(){return !!this.request && this.request.until>Date.now() && this.request.isCurrent();}
  consume(){const allowed=this.allowed();this.reset();return allowed;}
}
module.exports={CameraConsent,promptCamera};
