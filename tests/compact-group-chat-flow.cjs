'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');

module.exports=async function compactChat(page){
  const previous=page.viewportSize();
  await page.setViewportSize({width:800,height:600});
  const card=page.locator('#groupLog article').filter({hasText:'Ш'.repeat(48)});
  await card.waitFor();
  const layout=await card.evaluate(row=>{
    const author=row.querySelector('.link-chat-author').getBoundingClientRect();
    const time=row.querySelector('time').getBoundingClientRect();
    return {authorEnd:author.right,timeStart:time.left,timeEnd:time.right,edge:row.getBoundingClientRect().right,
      width:row.clientWidth,contentWidth:row.scrollWidth};
  });
  assert(layout.authorEnd<=layout.timeStart&&layout.timeEnd<=layout.edge&&layout.contentWidth<=layout.width+1,JSON.stringify(layout));
  const images=process.env.LINK_UI_QA_IMAGES,language=await page.locator('html').getAttribute('lang');
  if(images){
    await fs.mkdir(images,{recursive:true});
    await page.screenshot({path:path.join(images,'group-author-'+language+'.png')});
  }

  const error='ENOENT · '+'W'.repeat(230)+'.png';
  await page.evaluate(async error=>{
    const api=window.craftlink,original=api.offerSelectedFile;
    api.offerSelectedFile=async()=>{throw Error(error);};
    document.querySelector('#attachmentDraft').addEventListener('close',()=>{api.offerSelectedFile=original;},{once:true});
    const image=document.createElement('canvas');
    image.width=320;image.height=192;
    const blob=await new Promise(resolve=>image.toBlob(resolve));
    const files=new DataTransfer();
    for(let i=0;i<12;i++)files.items.add(new File([blob],i+'-'+'W'.repeat(230)+'.png',{type:'image/png'}));
    document.querySelector('#groupText').dispatchEvent(new DragEvent('drop',{dataTransfer:files,bubbles:true,cancelable:true}));
  },error);
  const dialog=page.locator('#attachmentDraft:modal'),caption=dialog.locator('textarea');
  await dialog.locator('img').last().waitFor({state:'attached'});
  await caption.fill('Карта матча');
  await caption.evaluate(input=>{input.style.height='600px';});
  await caption.press('Shift+Enter');
  await caption.press('Enter');
  await dialog.getByRole('status').getByText(error,{exact:true}).waitFor();
  assert.equal(await caption.inputValue(),'Карта матча\n');
  for(const height of [600,560]){
    await page.setViewportSize({width:800,height});
    const draft=await dialog.evaluate(dialog=>{
      const list=dialog.querySelector('#attachmentDraftItems'),status=dialog.querySelector('[role=status]');
      const box=dialog.getBoundingClientRect(),buttons=dialog.querySelector('.dialog-actions').getBoundingClientRect();
      list.scrollTop=list.scrollHeight;
      return {width:dialog.clientWidth,contentWidth:dialog.scrollWidth,height:dialog.clientHeight,contentHeight:dialog.scrollHeight,
        actionsBottom:buttons.bottom,dialogBottom:box.bottom,wrappedError:status.scrollWidth<=status.clientWidth+1,
        reachedLast:list.clientHeight>0&&list.scrollTop>0&&list.lastElementChild.getBoundingClientRect().bottom<=list.getBoundingClientRect().bottom+1};
    });
    assert(draft.contentWidth<=draft.width+1&&draft.contentHeight<=draft.height+1&&draft.wrappedError&&draft.reachedLast&&
      draft.actionsBottom<=draft.dialogBottom&&draft.dialogBottom<=height,JSON.stringify(draft));
  }
  if(images)await page.screenshot({path:path.join(images,'group-attachment-'+language+'.png')});
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'hidden'});
  await page.setViewportSize(previous);
  console.log('PASS '+language+' group author and timestamp, 12 dropped images, error and multiline caption at compact Windows sizes.');
};
