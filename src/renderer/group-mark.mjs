import {paintAvatar} from './profile-appearance.mjs';

export function paintGroupMark(element,group){
  const words=group.name.trim().split(/\s+/u);
  const glyph=words.length===1?Array.from(words[0]).slice(0,2):words.slice(0,2).map(word=>Array.from(word)[0]);
  let hash=0;
  for(const letter of group.id)hash=(hash*31+letter.charCodeAt(0))>>>0;
  element.classList.add('group-mark');
  element.style.setProperty('--group-hue',String(hash%360));
  paintAvatar(element,glyph.join(''),group.avatar);
  element.classList.remove('portrait-initials');
}
