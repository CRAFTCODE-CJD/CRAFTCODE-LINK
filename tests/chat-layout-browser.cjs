'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');

// Use the production renderer and a locally decoded 82-second audio attachment.
module.exports=async page=>{
  const output=process.env.LINK_VISUAL_DIR;
  if(output)await fs.mkdir(output,{recursive:true});
  for(const language of ['ru','en']){
    await page.evaluate(language=>localStorage.setItem('craftcode.language',language),language);await page.reload();
    await page.evaluate(async()=>{
      const theme=document.createElement('link');theme.rel='stylesheet';theme.href='styles.css';document.head.prepend(theme);
      document.body.style.cssText='display:block;margin:0;padding:20px;background:#111820;overflow:auto;color:#e8f1f5;font-family:Arial,sans-serif';
      document.body.innerHTML='<section id="fixture" style="width:560px;max-width:100%;margin:auto"><div id="dmLog"></div><form hidden><input><button></button></form></section>';
      const {createChatView}=await import('./chat-view.mjs'),{chatAttachments}=await import('./chat-attachments.mjs');
      const rate=8000,count=rate*82,bytes=new ArrayBuffer(44+count*2),view=new DataView(bytes);
      const word=(at,s)=>[...s].forEach((c,i)=>view.setUint8(at+i,c.charCodeAt(0)));
      word(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);word(8,'WAVEfmt ');view.setUint32(16,16,true);
      view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);
      view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,count*2,true);
      for(let i=0;i<count;i++)view.setInt16(44+i*2,Math.sin(i*Math.PI/20)*9000*(i%rate/rate),true);
      window.layoutPlayed=0;
      const attachments=chatAttachments({scope:()=>({current:()=>true,async doFile(action){
        if(action==='preview')return {bytes,type:'audio/wav'};
        if(action==='played'){window.layoutPlayed++;return true;}
      }}),refresh:async()=>{},onError:error=>{throw error;}});
      const messages=[
        {id:'short',text:'@npi1',own:true,status:'read'},
        {id:'reply',text:'Хорошо',author:'Анна'},
        {id:'lines',text:'Первая строка\nВторая строка',own:true,status:'delivered'},
        {id:'url',text:'https://example.org/'+('a-long-part-of-the-link/').repeat(5),own:true,status:'pending'},
        {id:'long',text:'Текст сообщения с длинной последней строкой и понятным временем отправки. '.repeat(3),author:'Анна'},
        {id:'voice',text:'Voice.wav',author:'Анна',own:false,attachment:{name:'Voice.wav',size:bytes.byteLength,clip:'voice',state:'saved'}},
        {id:'voiceOwn',text:'Voice.wav',own:true,status:'read',attachment:{name:'Voice.wav',size:bytes.byteLength,clip:'voice',state:'saved'}}
      ].map(m=>({...m,time:Date.UTC(2026,10,11,12,31)}));
      const log=document.querySelector('#dmLog');
      window.layoutChat=createChatView({log,scroll:document.documentElement,input:document.querySelector('input'),form:document.querySelector('form'),send:document.querySelector('button'),onSend:async()=>true,
        decorate:attachments.decorate,updateRow:attachments.updateRow,rowVersion:m=>m.attachment?.state||''});
      window.layoutChat.replace(messages);
    });
    await page.locator('[data-id=voice] .voice-wave').waitFor();
    await page.locator('[data-id=voiceOwn] .voice-wave').waitFor();
    assert.match(await page.locator('[data-id=voice] .clip-preview-label').innerText(),/^1:22 · /);
    assert.equal(await page.locator('[data-id=voice] .clip-unplayed').count(),1);
    for(const [name,width,font] of [['normal',560,14],['narrow',280,14],['large-text',280,24]]){
      await page.evaluate(({width,font})=>{
        document.querySelector('#fixture').style.width=width+'px';document.documentElement.style.setProperty('--chat-text-size',font+'px');
      },{width,font});
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      const result=await page.evaluate(()=>{
        const overlaps=[],overflow=[];
        for(const card of document.querySelectorAll('#dmLog article')){
          const meta=card.querySelector('.link-chat-meta').getBoundingClientRect(),bounds=card.getBoundingClientRect();
          if(card.scrollWidth>card.clientWidth+1)overflow.push(card.dataset.id);
          if(!card.classList.contains('text-message'))continue;
          const walker=document.createTreeWalker(card.querySelector('.link-chat-body'),NodeFilter.SHOW_TEXT);
          while(walker.nextNode()){
            const range=document.createRange();range.selectNodeContents(walker.currentNode);
            for(const text of range.getClientRects())if(text.width&&text.left<meta.right-1&&text.right>meta.left+1&&text.top<meta.bottom-1&&text.bottom>meta.top+1)overlaps.push({id:card.dataset.id,text:text.toJSON(),meta:meta.toJSON()});
          }
          if(meta.left<bounds.left||meta.right>bounds.right)overflow.push(card.dataset.id+' time');
        }
        return {overlaps,overflow,shortHeight:document.querySelector('[data-id=short]').getBoundingClientRect().height};
      });
      if(output)await page.locator('#fixture').screenshot({path:path.join(output,'chat-layout-'+language+'-'+name+'.png')});
      assert.deepEqual(result.overlaps,[],language+' '+name+' text/time overlap');
      assert.deepEqual(result.overflow,[],language+' '+name+' overflow');
      if(font===14)assert(result.shortHeight<36,'short message stays on one text/time line');
    }
    assert.equal(await page.locator('.message-actions-open').count(),0);
    const card=page.locator('[data-id=short]');
    await card.press('Shift+F10');await page.getByRole('menuitem').first().waitFor();await page.keyboard.press('Escape');
    await card.click({button:'right'});await page.getByRole('menuitem').first().waitFor();await page.keyboard.press('Escape');
    await page.evaluate(()=>{document.querySelector('#fixture').style.width='560px';document.documentElement.style.setProperty('--chat-text-size','14px');});
    await page.locator('[data-id=voice] [data-action=preview]').click();
    await page.waitForFunction(()=>window.layoutPlayed===1);
    await page.waitForFunction(()=>document.querySelector('[data-id=voice] audio')?.currentTime>0);
    assert.equal(await page.locator('[data-id=voice] .clip-unplayed').count(),0);
    await page.locator('[data-id=voice] .clip-seek').press('End');
    assert(await page.locator('[data-id=voice] audio').evaluate(p=>p.currentTime>81));
    const close=page.locator('[data-id=voice] [data-action=preview]');
    for(const width of [560,280]){
      await page.evaluate(width=>{document.querySelector('#fixture').style.width=width+'px';},width);
      await close.focus();
      const position=await close.evaluate(button=>{
        const card=button.closest('article'),box=button.getBoundingClientRect(),bounds=card.getBoundingClientRect();
        const time=card.querySelector('.link-chat-meta').getBoundingClientRect();
        return {opacity:getComputedStyle(button).opacity,top:box.top-bounds.top,separate:box.right<=bounds.right&&box.bottom<time.top};
      });
      assert.equal(position.opacity,'1');assert(position.top>=0&&position.top<4&&position.separate);
      const alignment=await page.locator('[data-attachment-kind=voice]').evaluateAll(cards=>cards.map(card=>{
        const left=card.querySelector('.chat-media-preview .clip-time')||card.querySelector('.clip-preview-label');
        const right=card.querySelector('.link-chat-time');
        const textBounds=el=>{const range=document.createRange();range.selectNode(el.firstChild);return range.getBoundingClientRect();};
        const a=textBounds(left),b=textBounds(right);
        return {id:card.dataset.id,left:a.toJSON(),right:b.toJSON(),aligned:Math.abs(a.bottom-b.bottom)<1&&a.right<b.left};
      }));
      assert(alignment.every(item=>item.aligned),JSON.stringify(alignment));
      if(output)await page.locator('#fixture').screenshot({path:path.join(output,'chat-voice-close-'+language+'-'+width+'.png')});
    }
    await close.press('Enter');
    assert.equal(await page.locator('[data-id=voice] .clip-unplayed').count(),0);
    await page.locator('[data-id=voiceOwn] [data-action=preview]').click();
    await page.waitForFunction(()=>document.querySelector('[data-id=voiceOwn] audio')?.currentTime>0);
    assert.equal(await page.evaluate(()=>window.layoutPlayed),1,'own playback does not mark an incoming clip');
    const own=page.locator('[data-id=voiceOwn]');
    const baseline=await own.evaluate(card=>{
      const text=element=>{const r=document.createRange();r.selectNode(element.firstChild);return r.getBoundingClientRect();};
      const left=text(card.querySelector('.clip-time')),right=text(card.querySelector('.link-chat-time'));
      const close=card.querySelector('[aria-expanded=true]').getBoundingClientRect(),speed=card.querySelector('.clip-speed').getBoundingClientRect();
      return Math.abs(left.bottom-right.bottom)<1&&left.right<right.left&&speed.right<=close.left;
    });
    assert(baseline,'own playback, speed, timestamp and receipt fit the narrow row');
    if(output)await page.locator('#fixture').screenshot({path:path.join(output,'chat-voice-own-'+language+'.png')});
    await own.locator('[data-action=preview]').press('Enter');
    if(output)await page.locator('#fixture').screenshot({path:path.join(output,'chat-layout-'+language+'-played.png')});
  }
  console.log('PASS compact chat RU/EN: text/time same-line, long/link/multiline, 280px, 24px font, keyboard menu, decoded 82-second waveform, duration/size and local played marker.');
};
