// Canvas preview and the published thumbnail use the same source rectangle.
export async function chooseCrop(bitmap,side,signal,round){
  const dialog=document.getElementById('avatarCrop');
  if(signal.aborted||dialog.open)return null;
  const canvas=document.getElementById('avatarCropPreview');
  const zoom=document.getElementById('avatarCropZoom');
  const value=document.getElementById('avatarCropScale');
  const events=new AbortController(),options={signal:events.signal};
  let x=.5,y=.5,pointer=null;
  const clamp=n=>Math.max(0,Math.min(1,n));
  function cropSize(){return Math.min(bitmap.width,bitmap.height)*100/zoom.valueAsNumber;}
  function draw(target){
    const size=cropSize(),ctx=target.getContext('2d',{alpha:false});
    ctx.fillStyle='#263444';ctx.fillRect(0,0,target.width,target.height);
    ctx.imageSmoothingQuality='high';
    ctx.drawImage(bitmap,(bitmap.width-size)*x,(bitmap.height-size)*y,size,size,0,0,target.width,target.height);
  }
  function shift(dx,dy){
    const size=cropSize();
    if(bitmap.width>size)x=clamp(x+dx*size/(bitmap.width-size));
    if(bitmap.height>size)y=clamp(y+dy*size/(bitmap.height-size));
    draw(canvas);
  }
  function refresh(){
    value.value=zoom.value+'%';
    zoom.setAttribute('aria-valuetext',value.value);
    draw(canvas);
  }
  try{
    zoom.value='100';dialog.returnValue='';
    canvas.classList.toggle('round-crop',round);refresh();
    const accepted=await new Promise(resolve=>{
      function cancel(){if(dialog.open)dialog.close();resolve(false);}
      dialog.addEventListener('close',()=>resolve(dialog.returnValue==='apply'&&!signal.aborted),options);
      signal.addEventListener('abort',cancel,options);
      zoom.addEventListener('input',refresh,options);
      canvas.addEventListener('pointerdown',e=>{
        if(e.button!==0||!e.isPrimary)return;
        pointer={id:e.pointerId,startX:e.clientX,startY:e.clientY,lastX:e.clientX,lastY:e.clientY,dragged:false};
        canvas.setPointerCapture(e.pointerId);
      },options);
      canvas.addEventListener('pointermove',e=>{
        if(pointer?.id!==e.pointerId)return;
        if(Math.hypot(e.clientX-pointer.startX,e.clientY-pointer.startY)>3)pointer.dragged=true;
        if(!pointer.dragged)return;
        shift((pointer.lastX-e.clientX)/canvas.clientWidth,(pointer.lastY-e.clientY)/canvas.clientHeight);
        pointer.lastX=e.clientX;pointer.lastY=e.clientY;
      },options);
      canvas.addEventListener('pointerup',e=>{
        if(pointer?.id!==e.pointerId)return;
        if(!pointer.dragged){
          const rect=canvas.getBoundingClientRect();
          shift((e.clientX-rect.left)/rect.width-.5,(e.clientY-rect.top)/rect.height-.5);
        }
        pointer=null;
      },options);
      canvas.addEventListener('lostpointercapture',()=>{pointer=null;},options);
      canvas.addEventListener('keydown',e=>{
        const step=e.shiftKey ? 0.12 : 0.035;
        const offsets={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};
        if(!Object.hasOwn(offsets,e.key))return;
        e.preventDefault();shift(...offsets[e.key]);
      },options);
      dialog.showModal();
    });
    if(!accepted)return null;
    const thumbnail=document.createElement('canvas');
    thumbnail.width=thumbnail.height=side;draw(thumbnail);
    const rgba=thumbnail.getContext('2d').getImageData(0,0,side,side).data;
    let rgb='';
    for(let i=0;i<rgba.length;i+=4)rgb+=String.fromCharCode(rgba[i],rgba[i+1],rgba[i+2]);
    return btoa(rgb);
  }finally{
    events.abort();
    // Release preview pixels when the editor closes, including cancellation.
    canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
  }
}
