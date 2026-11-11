'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');

async function dropFile(page,area,source){
  await page.evaluate(()=>{const pick=document.createElement('input');pick.id='qaExplorerFile';pick.type='file';document.body.append(pick);});
  await page.locator('#qaExplorerFile').setInputFiles(source);
  await page.evaluate(selector=>{
    const input=document.querySelector('#qaExplorerFile'),dt=new DataTransfer();dt.items.add(input.files[0]);
    document.querySelector(selector).dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));
    input.remove();
  },area);
}

module.exports=async({a,b})=>{
  const sender=a.page,viewer=b.page;
  await viewer.click('#navChats');await viewer.locator('#dmList button').click();
  await sender.waitForFunction(()=>!document.querySelector('#dmFile').disabled);
  const png=await sender.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=16;canvas.height=8;
    const g=canvas.getContext('2d');g.fillStyle='#21936b';g.fillRect(0,0,16,8);
    return [...new Uint8Array(await (await new Promise(ok=>canvas.toBlob(ok))).arrayBuffer())];
  });
  async function paste(){
    await sender.evaluate(bytes=>{
      const data=new DataTransfer();data.items.add(new File([new Uint8Array(bytes)],'pasted.png',{type:'image/png'}));
      document.querySelector('#dmInput').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    },png);
  }
  const draft=sender.locator('#attachmentDraft');
  await sender.fill('#dmInput','Черновик');
  await paste();await draft.locator('img').waitFor();await draft.locator('#attachmentDraftCancel').click();
  assert.equal(await sender.inputValue('#dmInput'),'Черновик');
  assert.equal(await viewer.locator('#dmLog article').count(),0);
  await paste();assert.equal(await sender.inputValue('#attachmentCaption'),'Черновик');await sender.fill('#attachmentCaption','Одно фото с подписью');await sender.click('#attachmentDraftSend');
  async function verify(name,caption,bytes){
    await sender.waitForFunction(()=>!document.querySelector('#attachmentDraft').open || !document.querySelector('#attachmentDraftSend').disabled);
    assert.equal(await draft.evaluate(el=>el.open?el.querySelector('[role=status]').textContent:''),'');
    const row=viewer.locator('#dmLog article').filter({hasText:caption});
    try{await row.locator('[data-action=download]').click();}catch(error){
      const read=page=>page.locator('#dmLog').innerText();
      throw Error(JSON.stringify({sender:await read(sender),recipient:await read(viewer),dialog:await draft.innerText()}),{cause:error});
    }
    await row.locator('[data-action=reveal]').waitFor({state:'attached'});
    const root=path.join(b.base,'Downloads');
    const file=(await fs.readdir(root,{recursive:true})).find(p=>path.basename(p)===name);
    assert(file);assert.deepEqual(await fs.readFile(path.join(root,file)),Buffer.from(bytes));
  }
  await verify('pasted.png','Одно фото с подписью',png);
  const bytes=crypto.randomBytes(128*1024+7),source=path.join(a.base,'level-map.bin');
  await fs.writeFile(source,bytes);
  await dropFile(sender,'#dmLog',source);
  await sender.fill('#attachmentCaption','Карта на вечер');await sender.press('#attachmentCaption','Enter');
  await verify('level-map.bin','Карта на вечер',bytes);
  await sender.click('#dmEmoji summary');const picker=sender.locator('#dmEmoji .emoji-picker');
  await picker.locator('input').fill('ракета');
  try{await picker.locator('[data-glyph="🚀"]').click({timeout:8000});}
  catch(error){throw Error(JSON.stringify(await picker.evaluate(el=>({query:el.querySelector('input').value,items:el.innerText,open:el.matches(':popover-open')}))),{cause:error});}
  await sender.press('#dmInput','Enter');
  await viewer.locator('#dmLog .link-chat-body').getByText('🚀',{exact:true}).waitFor();
  assert.equal(await viewer.locator('#dmLog article').count(),3);
  console.log('PASS two Electron clients: cancelled paste, pasted PNG and dropped on-disk file with atomic captions and matching saved bytes, searchable emoji delivered.');
};
module.exports.dropFile=dropFile;
