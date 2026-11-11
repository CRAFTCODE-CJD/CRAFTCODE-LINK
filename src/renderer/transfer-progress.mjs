import {language,tr} from './locale.mjs';

const precision=new Intl.NumberFormat(language,{maximumFractionDigits:1});
export function fileSize(bytes){
  const units=[tr('Б'),tr('КиБ'),tr('МиБ'),tr('ГиБ')];
  const size=Math.max(0,Number(bytes)||0);
  const i=Math.min(3,Math.max(0,Math.floor(Math.log(size||1)/Math.log(1024))));
  return precision.format(size/1024**i)+' '+units[i];
}
export function transferText(done,total,rate){
  const pos=Math.min(total,Math.max(0,done||0));
  const amount=Math.floor(pos*100/Math.max(total,1))+'% · '+fileSize(pos)+' / '+fileSize(total);
  return rate>0?amount+' · '+fileSize(rate)+tr('/с'):amount;
}
export function transferMeter(container,done,total,rate,label){
  let meter=container.querySelector('progress');
  if(!meter){
    container.classList.add('chat-transfer');
    meter=document.createElement('progress');container.append(meter,document.createElement('small'));
  }
  meter.max=Math.max(total,1);meter.value=done||0;meter.setAttribute('aria-label',label);
  container.lastElementChild.textContent=transferText(done,total,rate);
}
