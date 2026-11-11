import en from './l10n/en.json' with {type:'json'};

let preference='ru';
try{if(globalThis.localStorage?.getItem('craftcode.language')==='en')preference='en';}catch{}
export const language=preference;
export const tr=text=>language==='en'&&Object.hasOwn(en,text)?en[text]:text;

// Translate only authored HTML before application data is rendered.
export function localizeStatic(doc){
  doc.documentElement.lang=language;if(language!=='en')return;
  const tree=doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT);
  for(let item=tree.nextNode();item;item=tree.nextNode()){
    const raw=item.nodeValue,key=raw.trim();if(key&&Object.hasOwn(en,key))item.nodeValue=raw.replace(key,()=>en[key]);
  }
  for(const el of doc.querySelectorAll('[title],[placeholder],[label],[aria-label],[alt]')){
    for(const name of ['title','placeholder','label','aria-label','alt'])if(el.hasAttribute(name))el.setAttribute(name,tr(el.getAttribute(name)));
  }
}
