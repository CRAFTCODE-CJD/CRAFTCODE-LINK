// Keep first-run customization on Home so a call, invitation or game always
// remains accessible. Persist the decision independently for each local profile.
export function bindProfileWelcome({$,storage,openProfile,openGuide,flush}){
  const card=$('profileWelcome'),theme=$('profileTheme'),choices=$('welcomeThemes');
  const decided=new Set();
  let person=null,offered=false;
  const key=id=>'craftlink.profile-welcome.v1.'+id;
  const introKey=id=>'craftlink.first-steps.v1.'+id;
  const introDecided=new Set();
  function dismissIntro(){
    if(!person)return;
    introDecided.add(person);try{storage.setItem(introKey(person),'1');}catch{}
    $('firstSteps').hidden=true;flush?.();
  }
  $('firstStepsOpen').onclick=()=>{dismissIntro();openGuide();};
  $('firstStepsSkip').onclick=()=>{dismissIntro();$('bookQuery').focus({preventScroll:true});};
  for(const option of theme.options){
    const label=document.createElement('label'),swatch=document.createElement('span'),input=document.createElement('input');
    input.type='radio';input.name='welcome-theme';input.value=option.value;
    swatch.className='welcome-swatch theme-preview';swatch.dataset.theme=option.value;swatch.ariaHidden='true';
    input.onchange=()=>{if(input.checked)card.dataset.theme=input.value;};
    label.append(input,swatch,document.createTextNode(option.textContent));choices.append(label);
  }
  function finish(apply){
    if(!person||!offered)return;
    offered=false;
    const value=choices.querySelector('input:checked')?.value;
    if(apply && value){theme.value=value;theme.dispatchEvent(new Event('change',{bubbles:true}));}
    decided.add(person);
    try{storage.setItem(key(person),'1');}catch{}
    flush?.();card.hidden=true;
  }
  theme.addEventListener('change',()=>finish(false));
  $('welcomeProfile').onclick=()=>{finish(true);openProfile();};
  $('welcomeDone').onclick=()=>{finish(true);$('bookQuery').focus({preventScroll:true});};
  $('welcomeSkip').onclick=()=>{finish(false);$('bookQuery').focus({preventScroll:true});};
  return me=>{
    if(person===me?.id && offered && (me.avatar||me.cardStyle?.about||me.cardStyle?.cover && me.cardStyle.cover!=='default'))finish(false);
    const id=me?.id||null;if(person===id)return;
    person=id;offered=false;card.hidden=true;$('firstSteps').hidden=true;
    if(id&&!introDecided.has(id)){
      try{$('firstSteps').hidden=!!storage.getItem(introKey(id));}catch{}
    }
    if(!id || decided.has(id))return;
    try{
      if(storage.getItem(key(id))||storage.getItem('craftlink.appearance.theme.'+id)||
        me.avatar||me.cardStyle?.about||me.cardStyle?.cover && me.cardStyle.cover!=='default')return;
    }catch{return;}
    choices.querySelector('input[value="'+theme.value+'"]').checked=true;card.dataset.theme=theme.value;
    offered=true;card.hidden=false;
  };
}
