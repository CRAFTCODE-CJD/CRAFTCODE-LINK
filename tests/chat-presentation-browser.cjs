'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(require.resolve('playwright',{paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||__dirname]}));
const source=path.resolve(__dirname,'../src/renderer');
const groups=require('../src/renderer/l10n/emoji.json');
const files={'.mjs':'text/javascript','.css':'text/css','.json':'application/json','.ttf':'font/ttf'};

async function run(){
  const browser=await chromium.launch({channel:process.env.LINK_QA_BROWSER||undefined});
  try{
    const page=await browser.newPage();
    await page.route('http://127.0.0.1:31901/**',async route=>{
      const name=new URL(route.request().url()).pathname.slice(1);
      if(!name)return route.fulfill({contentType:'text/html',body:'<meta charset=utf-8><link rel=stylesheet href="chat-view.css"><link rel=stylesheet href="chat-input.css"><div id=glyphs class=emoji-grid></div>'});
      if(!/^(?:[a-z-]+\.(?:mjs|css)|l10n\/en\.json|assets\/Noto-COLRv1\.ttf)$/.test(name))return route.abort();
      await route.fulfill({contentType:files[path.extname(name)],body:await fs.readFile(path.join(source,name))});
    });
    await page.goto('http://127.0.0.1:31901/');
    await page.evaluate(async glyphs=>{
      const {appendChatText}=await import('./chat-glyphs.mjs');
      const el=document.querySelector('#glyphs');
      for(const glyph of glyphs){
        const b=document.createElement('button');b.textContent=glyph;el.append(b);
      }
      const sample=document.createElement('p');appendChatText(sample,'Сообщение 🇰🇿');document.body.append(sample);
      await document.fonts.load('20px "LINK Emoji"');await document.fonts.ready;
    },Object.values(groups).flat().map(row=>row[0]));
    const session=await page.context().newCDPSession(page);
    await session.send('DOM.enable');await session.send('CSS.enable');
    const {root}=await session.send('DOM.getDocument');
    async function usedFonts(selector){
      const {nodeId}=await session.send('DOM.querySelector',{nodeId:root.nodeId,selector});
      const result=await session.send('CSS.getPlatformFontsForNode',{nodeId});return result.fonts;
    }
    const sample=await usedFonts('.chat-emoji-glyph');
    assert.equal(sample.length,1);assert.equal(sample[0].isCustomFont,true);assert.equal(sample[0].glyphCount,1);
    const count=await page.locator('#glyphs button').count();
    // Request each leaf: grouping at the grid can mask fallback in descendants.
    const {nodeIds}=await session.send('DOM.querySelectorAll',{nodeId:root.nodeId,selector:'#glyphs button'});
    for(let i=0;i<nodeIds.length;i+=80){
      const batch=await Promise.all(nodeIds.slice(i,i+80).map(nodeId=>session.send('CSS.getPlatformFontsForNode',{nodeId})));
      for(const [index,{fonts}] of batch.entries()){
        assert.deepEqual(fonts,sample,'Platform font mismatch at picker index '+(i+index));
      }
    }
    const wave=await page.evaluate(async()=>{
      const {voiceEnvelope}=await import('./chat-waveform.mjs');
      const rate=8000,samples=rate*2,bytes=new ArrayBuffer(44+samples*2),view=new DataView(bytes);
      const write=(at,s)=>[...s].forEach((c,i)=>view.setUint8(at+i,c.charCodeAt(0)));
      write(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);write(8,'WAVEfmt ');view.setUint32(16,16,true);
      view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);
      view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,samples*2,true);
      for(let i=rate/2;i<rate;i++)view.setInt16(44+i*2,Math.sin(i*Math.PI/10)*16000,true);
      return voiceEnvelope(new Blob([bytes],{type:'audio/wav'}),2);
    });
    assert.equal(wave.duration,2);
    assert(wave.levels.slice(0,12).every(n=>n<.02)&&wave.levels.slice(14,25).every(n=>n>.98)&&wave.levels.slice(27).every(n=>n<.02));
    console.log('PASS browser rendered '+count+' picker sequences with one local glyph each, inline flag uses '+sample[0].familyName+'; 2 s decoded speech fixture matches silence, tone and silence.');
    await require('./chat-layout-browser.cjs')(page);
  }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
