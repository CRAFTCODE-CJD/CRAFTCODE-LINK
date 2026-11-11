'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Runs only for an explicit visual audit with disposable QA profiles.
async function capture(page, label) {
  const directory = process.env.LINK_VISUAL_DIR;
  if (!directory) return;
  fs.mkdirSync(directory, {recursive:true});
  const slug = label.replaceAll(' ', '-');
  if (!/^[a-z0-9-]+$/.test(slug)) throw Error('Invalid screen name');
  const original = page.viewportSize() || await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
  const records = [];
  try {
    for (const [width,height] of [[1424,900],[800,560]]) {
      await page.setViewportSize({width,height});
      await page.evaluate(()=>document.fonts.ready);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const prefix = slug+'-'+width;
      const mask = page.locator('#inviteOutput:visible, #relaySecret:visible, #directCode:visible:not(:placeholder-shown)');
      const snap = suffix => page.screenshot({path:path.join(directory,prefix+suffix+'.png'),mask:[mask],maskColor:'#486169',animations:'disabled',timeout:8000});
      const data = await page.evaluate(()=>{
        const visible = el => el.checkVisibility() && el.getBoundingClientRect().width>0;
        const root=document.fullscreenElement || document.activeElement?.closest('dialog:modal') ||
          document.elementFromPoint(innerWidth/2,innerHeight/2)?.closest('dialog:modal') ||
          document.querySelector('.app-shell');
        const candidates=[root,...root.querySelectorAll('section,div,aside,dialog')];
        const overflowing=candidates.filter(el=>visible(el) && el.clientWidth>0 && el.scrollWidth>el.clientWidth+2 &&
          !['hidden','clip'].includes(getComputedStyle(el).overflowX)).map(el=>el.id||el.className).slice(0,12);
        const rect=id=>document.getElementById(id).getBoundingClientRect();
        const a=rect('startNearby'),b=rect('startCreate');
        const fallbackGap=root.id==='internetDialog' && a.width && b.width?Math.round(b.top>=a.bottom-1?b.top-a.bottom:b.left-a.right):null;
        const scroll = candidates.filter(el=>visible(el) && el.clientHeight>50 && el.scrollHeight>el.clientHeight+32 &&
          /auto|scroll/.test(getComputedStyle(el).overflowY)).sort((a,b)=>b.scrollHeight-b.clientHeight-(a.scrollHeight-a.clientHeight))[0];
        if(scroll) scroll.setAttribute('data-qa-scroll','');
        return {root:root.id||root.getAttribute('aria-labelledby')||'workspace',overflowing,fallbackGap,scrollTop:scroll?.scrollTop??null,scrollLength:scroll?scroll.scrollHeight-scroll.clientHeight:0};
      });
      const scroll=page.locator('[data-qa-scroll]');
      try {
        if(data.scrollTop!==null) await scroll.evaluate(el=>el.scrollTop=0);
        await snap('');
        if(data.scrollLength>80) {
          await scroll.evaluate(el=>el.scrollTop=el.scrollHeight);
          await snap('-bottom');
        }else fs.rmSync(path.join(directory,prefix+'-bottom.png'),{force:true});
      } finally {
        if(data.scrollTop!==null && await scroll.count())await scroll.evaluate((el,top)=>{el.scrollTop=top;el.removeAttribute('data-qa-scroll');},data.scrollTop);
      }
      records.push({width,height,...data});
    }
  } finally {await page.setViewportSize(original);}
  fs.writeFileSync(path.join(directory,slug+'.json'), JSON.stringify(records));
}
module.exports={capture};
