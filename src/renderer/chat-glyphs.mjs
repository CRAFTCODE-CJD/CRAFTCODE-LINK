// Keep native text selection, copying and searching intact. The colour font is
// applied to entire sequences (flags, modifiers and ZWJ), never ordinary text.
const emoji = /\p{RGI_Emoji}/gv;
export const singleEmoji = text => /^\p{RGI_Emoji}$/v.test(text.trim());
export function appendChatText(el,text=''){
  let start=0;
  for(const match of text.matchAll(emoji)){
    if(match.index>start)el.append(text.slice(start,match.index));
    const glyph=document.createElement('span');
    glyph.className='chat-emoji-glyph';glyph.textContent=match[0];el.append(glyph);
    start=match.index+match[0].length;
  }
  if(start<text.length)el.append(text.slice(start));
}
