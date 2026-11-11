import {tr} from './locale.mjs';
import {bindPersonalTheme} from './theme.mjs';

const side=48;
const rendered=new WeakMap();
export function paintAvatar(element,name,pixels){
  name=name||'';
  const initials=Array.from(name).slice(0,2).join('').toLocaleUpperCase();
  const previous=rendered.get(element);
  if(previous?.pixels===pixels && previous?.name===name)return;
  rendered.set(element,{pixels,name});
  element.setAttribute('aria-hidden','true');
  if(typeof pixels!=='string'||pixels.length!==side*side*4||!/^[A-Za-z0-9+/]+$/.test(pixels)){
    let hash=2166136261;
    for(const ch of name)hash=Math.imul(hash^ch.codePointAt(0),16777619);
    element.classList.add('portrait-initials');
    element.style.setProperty('--portrait-hue',String((hash>>>0)%360));
    element.textContent=initials;return;
  }
  element.classList.remove('portrait-initials');element.style.removeProperty('--portrait-hue');
  const rgb=atob(pixels);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=side;canvas.className='profile-photo';
  const context=canvas.getContext('2d'),image=context.createImageData(side,side);
  for(let i=0,j=0;i<rgb.length;i+=3,j+=4){
    image.data[j]=rgb.charCodeAt(i);image.data[j+1]=rgb.charCodeAt(i+1);image.data[j+2]=rgb.charCodeAt(i+2);image.data[j+3]=255;
  }
  context.putImageData(image,0,0);element.replaceChildren(canvas);
}

// Read dimensions before asking Chromium to allocate decoded pixels.
export function imageBounds(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length>=33 && view.getUint32(0)===0x89504e47 && view.getUint32(4)===0x0d0a1a0a &&
     view.getUint32(8)===13 && view.getUint32(12)===0x49484452)
    return {width:view.getUint32(16),height:view.getUint32(20),type:'image/png'};
  if(bytes.length<4||view.getUint16(0)!==0xffd8)return null;
  for(let at=2;at+4<=bytes.length;){
    if(bytes[at++]!==255)return null;
    while(bytes[at]===255)at++;
    const marker=bytes[at++];
    if(at+2>bytes.length||marker===0xda||marker===0xd9)return null;
    const length=view.getUint16(at);
    if(length<2||at+length>bytes.length)return null;
    if([0xc0,0xc1,0xc2].includes(marker) && length>=8)
      return {width:view.getUint16(at+5),height:view.getUint16(at+3),type:'image/jpeg'};
    at+=length;
  }
  return null;
}
export async function thumbnail(file){
  const invalid=()=>new Error(tr('Выберите PNG или JPEG до 8 МБ и 16 мегапикселей.'));
  if(!file.size||file.size>8*1024*1024)throw invalid();
  const bytes=new Uint8Array(await file.arrayBuffer()),bounds=imageBounds(bytes);
  if(!bounds||!bounds.width||!bounds.height||bounds.width>8192||bounds.height>8192||bounds.width*bounds.height>16000000)throw invalid();
  let bitmap;
  try{
    bitmap=await createImageBitmap(new Blob([bytes],{type:bounds.type}));
    const crop=Math.min(bitmap.width,bitmap.height);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=side;
    const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#263444';ctx.fillRect(0,0,side,side);
    ctx.imageSmoothingQuality='high';
    ctx.drawImage(bitmap,(bitmap.width-crop)/2,(bitmap.height-crop)/2,crop,crop,0,0,side,side);
    const rgba=ctx.getImageData(0,0,side,side).data;let rgb='';
    for(let i=0;i<rgba.length;i+=4)rgb+=String.fromCharCode(rgba[i],rgba[i+1],rgba[i+2]);
    return btoa(rgb);
  }catch{throw invalid();}finally{bitmap?.close();}
}

export function bindProfileAppearance({$,api,direct,onError}){
  const input=$('avatarFile');let busy=false;
  const syncTheme=bindPersonalTheme($('profileTheme'));
  const about=$('profileAboutInput'),choices=$('profileCoverChoices'),saveStyle=$('saveProfileStyle');
  let editOwner,savedStyle,cover='default',saving=false;
  const coverNames={default:'Как в теме',lagoon:'Лагуна',twilight:'Сумерки',ember:'Янтарь',glacier:'Ледник',blossom:'Цветение'};
  for(const [id,label] of Object.entries(coverNames)){
    const radio=document.createElement('input');
    radio.type='radio';radio.name='profile-cover';radio.value=id;radio.className='cover-choice profile-cover';radio.dataset.cover=id;
    radio.title=tr(label);radio.setAttribute('aria-label',tr(label));
    radio.onchange=()=>{if(radio.checked){cover=id;refresh();}};
    choices.append(radio);
  }
  about.oninput=()=>refresh();
  function refresh(){
    const local=direct()?.active(),me=local?direct().raw().me:null;
    syncTheme(me?.id);
    $('avatarEditor').hidden=!me;
    paintAvatar($('avatarPreview'),me?.name,me?.avatar);
    $('chooseAvatar').disabled=busy||!me;$('removeAvatar').disabled=busy||!me?.avatar;
    const savedCover=me?.cardStyle?.cover||'default',savedAbout=me?.cardStyle?.about||'';
    const key=JSON.stringify([savedCover,savedAbout]);
    if(editOwner!==me?.id || savedStyle!==key){
      editOwner=me?.id;savedStyle=key;cover=savedCover;about.value=savedAbout;
    }
    for(const radio of choices.children){radio.checked=radio.value===cover;radio.disabled=saving||!me;}
    about.disabled=saving||!me;
    $('profileCardName').textContent=me?.name||'';
    $('profileCoverPreview').dataset.cover=cover;
    $('profileAboutPreview').textContent=about.value.trim();
    $('profileAboutPreview').hidden=!about.value.trim();
    saveStyle.disabled=saving||!me||(cover===savedCover && about.value.trim()===savedAbout);
  }
  saveStyle.onclick=async()=>{
    if(saveStyle.disabled)return;
    saving=true;refresh();
    try{
      await api.direct({op:'set-profile-style',owner:editOwner,cover,about:about.value.trim()});
      await direct().sync();
    }catch(e){onError(e);}finally{saving=false;refresh();}
  };
  async function change(file){
    const owner=direct()?.active()&&direct().raw().me?.id;
    if(!owner||busy)return;
    busy=true;refresh();
    try{
      const pixels=file?await thumbnail(file):null;
      await api.direct({op:'set-avatar',owner,pixels});
      await direct().sync();
    }catch(e){onError(e);}finally{busy=false;refresh();}
  }
  $('chooseAvatar').onclick=()=>input.click();
  input.onchange=()=>{const file=input.files[0];input.value='';if(file)change(file);};
  $('removeAvatar').onclick=()=>change(null);
  const wallpaper=$('chatWallpaper'),options=['plain','dots','mesh'],key='craftlink.appearance.wallpaper';
  let value=options[0];try{const stored=localStorage.getItem(key);if(options.includes(stored))value=stored;}catch{}
  document.documentElement.dataset.wallpaper=wallpaper.value=value;
  wallpaper.onchange=()=>{if(options.includes(wallpaper.value)){document.documentElement.dataset.wallpaper=wallpaper.value;try{localStorage.setItem(key,wallpaper.value);}catch{}}};
  return refresh;
}
