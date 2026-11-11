export function bindSettingsNavigation($){
  const search=$('settingsSearch'),nav=search.closest('nav');
  const buttons=[...nav.querySelectorAll('button[data-pane]')];
  const terms=buttons.map(button=>{
    const section=$('pref-'+button.dataset.pane);
    return [button,...section.querySelectorAll('h3,h4,label,summary,button')].map(el=>({
      el,text:el.textContent.trim().toLocaleLowerCase()
    }));
  });
  function results(){
    const query=search.value.trim().toLocaleLowerCase();
    buttons.forEach((button,i)=>{button.hidden=!!query&&!terms[i].some(t=>t.text.includes(query));});
    $('settingsNoMatch').hidden=buttons.some(button=>!button.hidden);
  }
  function reset(){search.value='';results();}
  search.oninput=results;
  search.onkeydown=event=>{
    if(event.key==='Escape'&&search.value){event.preventDefault();event.stopPropagation();reset();return;}
    if(event.key!=='Enter')return;
    const button=buttons.find(b=>!b.hidden);if(!button)return;
    event.preventDefault();button.click();
  };
  nav.addEventListener('click',event=>{
    const button=event.target.closest('button[data-pane]'),query=search.value.trim().toLocaleLowerCase();
    if(!button||!query)return;
    const match=terms[buttons.indexOf(button)].slice(1).find(t=>t.text.includes(query)&&t.el.checkVisibility());
    reset();
    const control=match?.el.control||match?.el.querySelector('input,select,textarea')||button;
    control.focus({preventScroll:true});match?.el.scrollIntoView({block:'nearest'});
  });
  $('settingsDialog').addEventListener('close',reset);
  const root=document.documentElement;
  function bind(id,apply){
    const el=$(id),toggle=el.type==='checkbox',key='craftlink.appearance.'+id;
    try{
      const value=localStorage.getItem(key);
      if(value!==null){if(toggle)el.checked=value==='true';else if(/^(1[2-9]|2[0-4])$/.test(value))el.value=value;}
    }catch{}
    const read=()=>toggle?el.checked:el.value;
    apply(read());el.oninput=()=>apply(read());
    el.onchange=()=>{try{localStorage.setItem(key,String(read()));}catch{}};
  }
  bind('chatFontSize',size=>{
    root.style.setProperty('--chat-text-size',size+'px');$('chatFontValue').value=size+' px';
  });
  bind('compactMessages',enabled=>root.classList.toggle('compact-messages',enabled));
  bind('reduceMotion',enabled=>root.classList.toggle('reduce-motion',enabled));
}
