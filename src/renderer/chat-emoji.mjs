import {language,tr} from './locale.mjs';

const categories={
  'Smileys & Emotion':'Смайлики и эмоции','People & Body':'Люди и жесты','Animals & Nature':'Животные и природа',
  'Food & Drink':'Еда и напитки','Travel & Places':'Путешествия и места','Activities':'Занятия',
  'Objects':'Предметы','Symbols':'Символы','Flags':'Флаги'
};
const shortcuts=['🙂','❤️','👍','🎉','😂','👋','🔥','🤔','👏','🎮','😮','✅'];
const normalize=text=>text.toLocaleLowerCase().replaceAll('ё','е');
let data;
export function bindChatEmoji({menu,choices,input,onInput}){
  const grid=document.createElement('div'),filter=document.createElement('input'),category=document.createElement('select');
  const more=document.createElement('button'),notice=document.createElement('p'),summary=menu.querySelector('summary');
  choices.setAttribute('popover','manual');choices.classList.add('emoji-picker');
  grid.className='emoji-grid';filter.type='search';filter.placeholder=tr('Найти эмодзи');filter.ariaLabel=filter.placeholder;
  category.ariaLabel=tr('Категория эмодзи');category.add(new Option(tr('Быстрый выбор'),''));
  for(const [key,label] of Object.entries(categories))category.add(new Option(tr(label),key));
  more.type='button';more.className='emoji-more';more.textContent=tr('Показать ещё');notice.setAttribute('role','status');
  choices.replaceChildren(filter,category,grid,more,notice);
  let groups,all,visible=80;
  function render(){
    const query=normalize(filter.value.trim());
    const rows=query?all.filter(([glyph,en,ru])=>normalize(glyph+' '+en+' '+ru).includes(query)):
      category.value?groups[category.value]:shortcuts.map(g=>all.find(row=>row[0]===g)).filter(Boolean);
    grid.replaceChildren(...rows.slice(0,visible).map(([glyph,en,ru])=>{
      const b=document.createElement('button');b.type='button';b.textContent=glyph;b.dataset.glyph=glyph;b.title=language==='ru'&&ru?ru:en;
      b.ariaDescription=b.title;return b;
    }));
    more.hidden=visible>=rows.length;notice.hidden=!!rows.length;notice.textContent=rows.length?'':tr('Эмодзи не найдены.');
  }
  function reset(){visible=80;grid.scrollTop=0;if(all)render();}
  filter.oninput=reset;category.onchange=()=>{filter.value='';reset();};
  filter.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();grid.firstElementChild?.click();}};
  more.onclick=()=>{visible+=80;const offset=grid.scrollTop;render();grid.scrollTop=offset;grid.children[visible-80]?.focus();};
  grid.onclick=event=>{
    const glyph=event.target.closest('button')?.dataset.glyph;if(!glyph||input.disabled)return;
    const a=input.selectionStart,b=input.selectionEnd;
    if(input.maxLength>=0 && input.value.length-b+a+glyph.length>input.maxLength)return;
    input.setRangeText(glyph,a,b,'end');input.dispatchEvent(new Event('input',{bubbles:true}));onInput?.();
    menu.open=false;input.focus({preventScroll:true});
  };
  function place(){
    const rect=summary.getBoundingClientRect(),box=choices.getBoundingClientRect();
    choices.style.left=Math.max(6,Math.min(rect.right-box.width,innerWidth-box.width-6))+'px';
    choices.style.top=Math.max(6,rect.top>=box.height+8?rect.top-box.height-6:Math.min(innerHeight-box.height-6,rect.bottom+6))+'px';
  }
  function outside(e){if(!menu.contains(e.target))menu.open=false;}
  function escape(e){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();menu.open=false;summary.focus();}}
  menu.addEventListener('toggle',async event=>{
    if(event.target!==menu)return;
    if(!menu.open){
      if(choices.matches(':popover-open'))choices.hidePopover();
      filter.value='';category.value='';reset();
      window.removeEventListener('resize',place);document.removeEventListener('pointerdown',outside,true);
      document.removeEventListener('keydown',escape,true);return;
    }
    choices.showPopover();grid.scrollTop=0;
    window.addEventListener('resize',place);document.addEventListener('pointerdown',outside,true);
    document.addEventListener('keydown',escape,true);place();filter.focus({preventScroll:true});
    try{
      data??=import('./l10n/emoji.json',{with:{type:'json'}}).then(m=>m.default).catch(e=>{data=null;throw e;});
      groups=await data;all??=Object.values(groups).flat();if(menu.open){reset();place();}
    }catch{notice.hidden=false;notice.textContent=tr('Не удалось загрузить эмодзи. Откройте список ещё раз.');}
  });
}
