'use strict';
const {CameraConsent}=require('./camera-consent.cjs');
const {tr}=require('../native-language.cjs');

// Separate from video-note grants: a call preview never grants microphone access.
class LiveCameraConsent extends CameraConsent {
  constructor(){super();this.audioAllowed=false;}
  async authorize(id,{window,dialog,current}){
    const visible=()=>{
      const win=window();
      return !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && current();
    };
    return this.ask(id,async()=>{
      if(!visible())return false;
      const win=window();
      const answer=await dialog.showMessageBox(win,{type:'question',title:tr('Камера в звонке'),
        message:tr('Включить камеру для предпросмотра?'),
        detail:tr('Сначала вы увидите себя. Собеседники увидят видео только после нажатия «Включить видео». Микрофон управляется отдельно.'),
        buttons:[tr('Отмена'),tr('Включить камеру')],defaultId:0,cancelId:0});
      return answer.response===1 && win===window() && visible();
    },visible);
  }
}
module.exports={LiveCameraConsent};
