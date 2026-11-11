'use strict';
const {tr}=require('./native-language.cjs');

const mediaDomains=['youtube-nocookie.com','youtube.com','googlevideo.com','ytimg.com','ggpht.com','gstatic.com'];
const apiHost='youtubei.googleapis.com';
const mediaPatterns=mediaDomains.flatMap(host=>['"https://'+host+'/*"','"https://*.'+host+'/*"']);
// Chromium enforces this header for WebRTC and speculative connections, which
// can bypass webRequest entirely. Media CDN redirects still use the URL filter.
const connectionPolicy='('+[...mediaPatterns,'"https://'+apiHost+'/*"'].join(' ')+'); redirects=allow; webrtc=block';

// The public player lives in a separate, memory-only Chromium session. It has
// no preload bridge, local files, device permissions, new windows or downloads.
function createYouTubePlayer({BrowserWindow,session,parent,allowed,appId}){
  let window,partition,cleanup=Promise.resolve(),generation=0;
  function close(){
    generation++;
    window?.destroy();
  }
  async function open(id){
    if(!/^[A-Za-z0-9_-]{11}$/.test(id)||!allowed())throw Error(tr('Не удалось открыть видео.'));
    close();
    const current=generation;
    await cleanup;
    if(current!==generation||!allowed()||!parent())return false;
    if(!partition){
      partition=session.fromPartition('link-youtube',{cache:false});
      partition.setPermissionRequestHandler((_web,_permission,reply)=>reply(false));
      partition.setPermissionCheckHandler(()=>false);
      partition.setDisplayMediaRequestHandler((_req,reply)=>reply({}));
      partition.on('will-download',e=>e.preventDefault());
      partition.webRequest.onBeforeRequest((details,reply)=>{
        let permit=false;
        try{
          const u=new URL(details.url);
          const publicHost=u.hostname===apiHost || mediaDomains.some(host=>u.hostname===host || u.hostname.endsWith('.'+host));
          permit=allowed()&&details.webContentsId===window?.webContents.id && (u.protocol==='https:'&&publicHost&&!u.port&&!u.username&&!u.password ||
            u.protocol==='blob:'&&u.origin==='https://www.youtube-nocookie.com');
        }catch{}
        reply({cancel:!permit});
      });
      partition.webRequest.onHeadersReceived((details,reply)=>{
        const headers={...details.responseHeaders};
        for(const name of Object.keys(headers))if(name.toLowerCase()==='connection-allowlist')delete headers[name];
        headers['Connection-Allowlist']=[connectionPolicy];
        reply({responseHeaders:headers});
      });
    }
    const win=window=new BrowserWindow({parent:parent(),title:'YouTube · CRAFTCODE LINK',width:800,height:500,minWidth:320,minHeight:280,
      autoHideMenuBar:true,backgroundColor:'#101312',show:false,webPreferences:{session:partition,sandbox:true,contextIsolation:true,
        nodeIntegration:false,nodeIntegrationInSubFrames:false,nodeIntegrationInWorker:false,webviewTag:false,disableDialogs:true,devTools:false}});
    win.removeMenu();
    win.on('page-title-updated',event=>event.preventDefault());
    const contents=win.webContents;
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    contents.setWindowOpenHandler(()=>({action:'deny'}));
    contents.on('will-navigate',e=>e.preventDefault());
    contents.on('will-redirect',e=>{if(e.isMainFrame)e.preventDefault();});
    contents.on('will-attach-webview',e=>e.preventDefault());
    contents.on('render-process-gone',()=>win.destroy());
    win.on('closed',()=>{
      if(window===win)window=null;
      cleanup=Promise.allSettled([partition.clearStorageData(),partition.closeAllConnections()]);
    });
    try{
      await contents.loadURL('https://www.youtube-nocookie.com/embed/'+id+'?playsinline=1',{
        httpReferrer:{url:'https://'+appId.toLowerCase()+'/',policy:'strict-origin'},
      });
      if(window!==win||!allowed())return false;
      win.show();return true;
    }catch{if(window!==win)return false;win.destroy();throw Error(tr('Не удалось открыть видео.'));}
  }
  return {open,close};
}
module.exports={createYouTubePlayer};
