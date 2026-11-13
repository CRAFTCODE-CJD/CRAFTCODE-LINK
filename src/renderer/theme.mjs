const themes=new Set(['default','light','dusk','forest','cobalt','terracotta','paper']);
const wallpapers=new Set(['plain','dots','mesh','contours','aurora']);
const deviceKey='craftlink.appearance.theme';
const wallpaperKey='craftlink.appearance.wallpaper';
const profileKey=(key,id)=>id?key+'.'+id:key;
export const personalThemeKey=id=>profileKey(deviceKey,id);
let personal='default',group=null;

function paint(){
  const effective=group||personal;
  if(document.documentElement.dataset.theme!==effective)document.documentElement.dataset.theme=effective;
}
export function viewGroupTheme(value){
  group=themes.has(value)?value:null;
  paint();
}
function preference(key,id,allowed,fallback){
  try{
    let value=localStorage.getItem(profileKey(key,id));
    if(id&&!value&&!localStorage.getItem(key+'.migrated')){
      const legacy=localStorage.getItem(key);
      if(allowed.has(legacy)){
        value=legacy;localStorage.setItem(profileKey(key,id),value);
        localStorage.setItem(key+'.migrated','1');
      }
    }
    if(allowed.has(value))return value;
  }catch{}
  return fallback;
}
export function bindPersonalTheme(select,wallpaper,preview){
  let profile;
  function show(){
    preview.dataset.theme=personal;
    document.documentElement.dataset.wallpaper=wallpaper.value;
    paint();
  }
  function sync(id=null){
    if(profile===id)return;
    profile=id;
    personal=select.value=preference(deviceKey,id,themes,'default');
    wallpaper.value=preference(wallpaperKey,id,wallpapers,'plain');show();
  }
  select.onchange=()=>{
    if(!themes.has(select.value))return;
    personal=select.value;show();
    try{localStorage.setItem(personalThemeKey(profile),personal);}catch{}
  };
  wallpaper.onchange=()=>{
    if(!wallpapers.has(wallpaper.value))return;
    show();try{localStorage.setItem(profileKey(wallpaperKey,profile),wallpaper.value);}catch{}
  };
  sync();return sync;
}
