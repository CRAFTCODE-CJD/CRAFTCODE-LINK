const themes=new Set(['default','light','dusk','forest']);
const deviceKey='craftlink.appearance.theme';
export const personalThemeKey=id=>id?deviceKey+'.'+id:deviceKey;
let personal='default',group=null;

function paint(){
  const effective=group||personal;
  if(document.documentElement.dataset.theme!==effective)document.documentElement.dataset.theme=effective;
}
export function viewGroupTheme(value){
  group=themes.has(value)?value:null;
  paint();
}
export function bindPersonalTheme(select){
  let profile;
  function sync(id=null){
    if(profile===id)return;
    profile=id;
    let value;
    try{
      value=localStorage.getItem(personalThemeKey(id));
      // The old release had a single device preference. Import it for the
      // first profile only, so a later profile can choose independently.
      if(id&&!value&&!localStorage.getItem(deviceKey+'.migrated')){
        const legacy=localStorage.getItem(deviceKey);
        if(themes.has(legacy)){
          value=legacy;localStorage.setItem(personalThemeKey(id),value);
          localStorage.setItem(deviceKey+'.migrated','1');
        }
      }
    }catch{}
    personal=select.value=themes.has(value)?value:'default';paint();
  }
  select.onchange=()=>{
    if(!themes.has(select.value))return;
    personal=select.value;paint();
    try{localStorage.setItem(personalThemeKey(profile),personal);}catch{}
  };
  sync();return sync;
}
