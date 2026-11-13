import {FRAME,RANGE,RangeSender,unpack} from './file-ranges.mjs';
import {tr} from './locale.mjs';
import {ChatPlayer,attachmentKind} from './chat-player.mjs';
import {fileSize,transferText} from './transfer-progress.mjs';
import {appendChatText} from './chat-glyphs.mjs';
import {chatTimestamp} from './chat-view.mjs';
const BLOCK=24576,MAX=64*1024**3,WINDOW=8;
const RECOVERY_MS=60000,MAX_FILES_PER_AUTHOR=24;
const fileId=id=>typeof id==='string'&&/^[0-9a-f-]{36}$/.test(id);
const valid=m=>m&&fileId(m.id)&&typeof m.name==='string'&&m.name.length>0&&m.name.length<=112&&!/[<>:\x22/\\|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(m.name)&&Number.isSafeInteger(m.size)&&m.size>=0&&m.size<=MAX&&typeof m.sha==='string'&&/^[0-9a-f]{64}$/.test(m.sha);
const leaf=m=>({id:m.id,name:m.name,size:m.size,sha:m.sha,...(['circle','voice'].includes(m.clip)?{clip:m.clip}:{}),
  ...(typeof m.caption==='string'&&m.caption.length>0&&m.caption.length<=1024?{caption:m.caption}:{})});
const text=(tag,t)=>Object.assign(document.createElement(tag),{textContent:t});
export class RoomFiles{
  constructor(info,api,draw=()=>{},error=()=>{}){
    this.player=new ChatPlayer();
    this.self=info.selfId;this.host=info.hostId||'host';this.owner=info.role==='host';if(this.owner)this.host=this.self;
    this.api=api;this.draw=draw;this.error=error;this.channels=new Map();this.entries=new Map();this.local=new Set();this.downloads=new Map();this.requests=new Map();this.closed=false;this.reads=0;
    this.bulk=new Map();this.senders=new Map();this.rows=new Map();this.chatRows=new Map();this.names=new Map((info.peers||[]).map(p=>[p.id,p.name]));this.lastProgress=0;
    // The host can replay a guest's complete inventory only for the lifetime of that channel.
    this.inventories=new Map();
    this.timer=setInterval(()=>this.maintain(),2500);
  }
  maintain(now=Date.now()){
    for(const d of this.downloads.values()){
      if(d.final)continue;
      if(d.unavailableSince){
        if(now-d.unavailableSince>=RECOVERY_MS)this.cancel(d.v.id).catch(this.error);
      }else if(!d.paused && !d.starting && !d.writing && now-d.lastData>=RECOVERY_MS){
        this.cancel(d.v.id).then(()=>this.error(tr('Источник не ответил за минуту. Можно скачать файл ещё раз.')),this.error);
      }else if(!d.paused && now-d.last>6500){
        d.last=now;d.pending.clear();this.pull(d);
      }
    }
  }
  async unavailable(v,temporary){
    this.entries.delete(v.id);
    const d=this.downloads.get(v.id);
    if(!d||d.final)return;
    if(!temporary){await this.cancel(v.id);return;}
    d.unavailableSince ||= Date.now();d.pending.clear();d.blocks.clear();
  }
  detach(peer,ch=this.channels.get(peer)){
    if(!ch||this.channels.get(peer)!==ch)return;
    this.channels.delete(peer);this.bulk.delete(peer);this.inventories.delete(peer);
    this.senders.get(peer)?.close();this.senders.delete(peer);
    for(const v of [...this.entries.values()]){
      if(this.local.has(v.id)||(this.owner && v.author!==peer))continue;
      this.unavailable(v,true).catch(this.error);
      if(this.owner)this.announce({op:'gone',id:v.id,temporary:true},peer);
    }
    this.draw();
  }

  send(to,msg){
    const ch=this.channels.get(to);if(ch?.readyState!=='open'||ch.bufferedAmount>1024*1024)return false;
    try{ch.send(JSON.stringify(msg));return true;}catch{return false;}
  }
  attach(peer,ch){
    const previous=this.channels.get(peer);
    if(previous && ['closing','closed'].includes(previous.readyState))this.detach(peer,previous);
    if(this.closed||ch.label!=='link-files-v1'||this.channels.has(peer)){ch.close();return;}
    this.channels.set(peer,ch);ch.binaryType='arraybuffer';
    const sender=new RangeSender(ch,(id,pos,length)=>this.readShared({op:'read-range',id,pos,length}),this.error);
    this.senders.set(peer,sender);
    ch.onopen=()=>{
      if(this.channels.get(peer)!==ch)return;
      this.send(peer,{op:'capabilities',ranges:1});
      for(const v of this.entries.values())if(this.owner||this.local.has(v.id))this.send(peer,{op:'offer',...leaf(v),author:v.author});
      this.send(peer,{op:'inventory',author:this.self,ids:[...this.local]});
      for(const [author,ids] of this.inventories){
        if(author!==peer)this.send(peer,{op:'inventory',author,ids:[...ids]});
      }
      this.draw();
    };
    ch.onclose=()=>this.detach(peer,ch);
    let start=Date.now(),count=0;
    ch.onmessage=({data})=>{if(this.closed||this.channels.get(peer)!==ch)return;
      if(typeof data!=='string'&&!(data instanceof ArrayBuffer))return;
      if(typeof data==='string'&&data.length>33500)return;
      if(data instanceof ArrayBuffer){
        if(!this.bulk.has(peer))return;
        const packet=unpack(data),d=packet&&this.downloads.get(packet.id);
        if(d?.bulk&&d.v.author===peer&&packet.bytes.length===Math.min(FRAME,d.v.size-packet.pos))
          this.receive(d.v,packet.pos,packet.bytes).catch(this.error);
        return;
      }
      if(Date.now()-start>=1000){start=Date.now();count=0;}if(++count>1100)return;
      let m;try{m=JSON.parse(data);}catch{return;}if(!m||typeof m!=='object')return;this.message(peer,m).catch(this.error);};
  }
  announce(m,except){for(const id of this.channels.keys())if(id!==except)this.send(id,m);}
  async offer(){
    const m=await this.api({op:'offer'});this.publish(m);
  }
  publish(m){
    if(!m||this.closed)return;
    this.local.add(m.id);this.entries.set(m.id,{...m,author:this.self,seenAt:Date.now()});this.announce({op:'offer',...leaf(m),author:this.self});this.draw();
  }
  withdraw(id){
    const v=this.entries.get(id);if(!v)return;this.entries.delete(id);
    if(this.local.delete(id)){
      for(const sender of this.senders.values())sender.withdraw(id);
      this.api({op:'remove',id}).catch(this.error);
    }
    this.announce({op:'gone',id},this.owner?v.author:null);this.draw();
  }
  async message(peer,m){
    if(m.op==='capabilities'){if(m.ranges===1)this.bulk.set(peer,true);return;}
    if(m.op==='inventory'){
      const author=m.author;
      if(typeof author!=='string'||author===this.self||author.length>80||
        !Array.isArray(m.ids)||m.ids.length>MAX_FILES_PER_AUTHOR||!m.ids.every(fileId))return;
      if(this.owner){
        if(author!==peer||this.inventories.has(peer))return;
        this.inventories.set(peer,new Set(m.ids));
        this.announce({op:'inventory',author,ids:m.ids},peer);
      }else if(peer!==this.host)return;
      const missing=[...this.downloads.values()].filter(d=>
        !d.final&&d.unavailableSince&&d.v.author===author&&!m.ids.includes(d.v.id));
      await Promise.all(missing.map(d=>this.cancel(d.v.id)));
      return;
    }
    if(m.op==='offer'){
      if(!valid(m)||this.entries.has(m.id)||this.entries.size>=192)return;
      const author=this.owner?peer:m.author;if(typeof author!=='string'||author.length>80||author===this.self)return;
      if([...this.entries.values()].filter(v=>v.author===author).length>=MAX_FILES_PER_AUTHOR)return;
      const d=this.downloads.get(m.id),entry={...leaf(m),author,seenAt:d?.v.seenAt||Date.now()};
      if(d && (d.v.author!==author||d.v.sha!==entry.sha||d.v.size!==entry.size||d.v.name!==entry.name||d.v.clip!==entry.clip))return;
      this.entries.set(m.id,entry);
      const inventory=this.inventories.get(author);
      if(inventory && inventory.size<MAX_FILES_PER_AUTHOR)inventory.add(entry.id);
      if(d && !d.final){d.unavailableSince=0;d.last=d.lastData=Date.now();this.pull(d);}
      if(this.owner)this.announce({op:'offer',...leaf(entry),author},peer);this.draw();return;
    }
    const v=this.entries.get(m.id)||this.downloads.get(m.id)?.v;if(!v)return;
    if(m.op==='gone'){
      if(this.owner?peer===v.author:peer===this.host&&!this.local.has(m.id)){
        const temporary=m.temporary===true;
        if(!temporary)this.inventories.get(v.author)?.delete(m.id);
        if(this.owner)this.announce({op:'gone',id:m.id,temporary},peer);
        await this.unavailable(v,temporary);
        this.draw();
      }return;
    }
    if(!this.entries.has(m.id))return;
    if(!Number.isSafeInteger(m.pos)||m.pos<0||m.pos>=v.size||m.pos%BLOCK)return;
    if(m.op==='range'){
      if(this.bulk.has(peer)&&this.local.has(v.id)&&m.pos%FRAME===0&&Number.isInteger(m.length)&&m.length>0&&m.length<=RANGE&&m.length<=v.size-m.pos&&(m.pos+m.length===v.size||m.length%FRAME===0))
        this.senders.get(peer)?.request(v.id,m.pos,m.length);
      return;
    }
    if(m.op==='pull'){
      const who=this.owner?peer:(m.who??this.host);if(typeof who!=='string'||who.length>80||who===v.author)return;
      if(this.local.has(v.id))await this.respond(who,v,m.pos);
      else if(this.owner&&this.channels.has(v.author)){
        const k=who+'/'+v.id+'/'+m.pos;
        if(this.requests.size>=256){for(const [key,t] of this.requests)if(t<Date.now())this.requests.delete(key);}
        if(this.requests.size>=256)return;
        this.requests.set(k,Date.now()+12000);this.send(v.author,{op:'pull',id:v.id,pos:m.pos,who});
      }return;
    }
    if(m.op!=='block'||typeof m.data!=='string'||m.data.length!==4*Math.ceil(Math.min(BLOCK,v.size-m.pos)/3))return;
    if(this.owner){
      if(peer!==v.author)return;
      if(m.who!==this.self){const k=m.who+'/'+v.id+'/'+m.pos;if(!(this.requests.get(k)>Date.now()))return;this.requests.delete(k);this.send(m.who,{op:'block',id:v.id,pos:m.pos,data:m.data});return;}
    }
    if(!this.downloads.get(v.id)?.bulk)await this.receive(v,m.pos,m.data);
  }
  async readShared(request){
    try{return await this.api(request);}
    catch(error){
      if(this.closed || !this.local.has(request.id))return;
      this.withdraw(request.id);
      throw Error(tr('Файл изменился или стал недоступен. Прикрепите его заново.'));
    }
  }
  async respond(who,v,pos){
    if(this.reads>=32)return;this.reads++;
    try{const data=await this.readShared({op:'read',id:v.id,pos});if(!this.closed&&this.local.has(v.id))this.send(this.owner?who:this.host,{op:'block',id:v.id,pos,data,who});}
    finally{this.reads--;}
  }
  async start(v){
    if(this.closed||!this.entries.has(v.id)||this.downloads.has(v.id))return;
    const d={v,bulk:this.bulk.has(v.author)&&(this.owner||v.author===this.host),rate:0,sample:performance.now(),samplePos:0,pos:0,pending:new Set(),blocks:new Map(),last:Date.now(),lastData:Date.now(),starting:true};this.downloads.set(v.id,d);this.draw();
    try{
      d.token=await this.api({op:'begin',meta:leaf(v)});if(this.closed||this.downloads.get(v.id)!==d){await this.api({op:'cancel',id:d.token});return;}
      d.starting=false;d.lastData=Date.now();if(!v.size){const r=await this.api({op:'put',id:d.token,pos:0,data:''});this.saved(d,r);}else this.pull(d);this.draw();
    }catch(e){if(this.downloads.get(v.id)===d){await this.cancel(v.id);throw e;}}
  }
  pull(d){
    if(this.closed||this.downloads.get(d.v.id)!==d||d.paused||d.unavailableSince||d.final||d.starting||d.writing||!this.entries.has(d.v.id))return;
    if(!d.pending.size&&!d.blocks.size)d.bulk=!!(d.pos%FRAME===0 && this.bulk.has(d.v.author) && (this.owner||d.v.author===this.host));
    if(d.bulk){
      const ceiling=Math.min(d.v.size,(Math.floor(d.pos/RANGE)+2)*RANGE);
      for(let p=d.pos;p<ceiling;){
        if(d.pending.has(p)||d.blocks.has(p)){p+=FRAME;continue;}
        let end=p;
        while(end<ceiling&&end-p<RANGE&&!d.blocks.has(end)&&!d.pending.has(end))end+=FRAME;
        const length=Math.min(d.v.size,end)-p;
        if(!this.send(d.v.author,{op:'range',id:d.v.id,pos:p,length}))return;
        for(;p<end;p+=FRAME)d.pending.add(p);
      }
      return;
    }
    for(let p=d.pos;p<Math.min(d.v.size,d.pos+BLOCK*WINDOW);p+=BLOCK){
      if(d.pending.has(p)||d.blocks.has(p))continue;
      if(this.send(this.owner?d.v.author:this.host,{op:'pull',id:d.v.id,pos:p,who:this.self}))d.pending.add(p);
    }
  }
  async receive(v,p,data){
    const d=this.downloads.get(v.id);if(!d||d.paused||!d.pending.delete(p)||p<d.pos)return;
    d.blocks.set(p,data);d.last=d.lastData=Date.now();if(d.writing)return;d.writing=true;
    try{while(!d.paused&&d.blocks.has(d.pos)&&!this.closed){
      let r;
      if(d.bulk){
        const first=d.pos,parts=[];let end=first;
        while(d.blocks.has(end)&&end-first<RANGE){const b=d.blocks.get(end);parts.push(b);end+=b.length;}
        const bytes=new Uint8Array(end-first);let offset=0;
        for(const b of parts){bytes.set(b,offset);offset+=b.length;}
        r=await this.api({op:'put-range',id:d.token,pos:first,bytes});
        for(let pos=first;pos<end;pos+=FRAME)d.blocks.delete(pos);
      }else{
        r=await this.api({op:'put',id:d.token,pos:d.pos,data:d.blocks.get(d.pos)});d.blocks.delete(d.pos);
      }
      d.pos=r.pos;d.lastData=Date.now();
      if(r.done){this.saved(d,r);break;}
    }}catch(e){if(this.downloads.get(v.id)===d){await this.cancel(v.id);throw e;}}finally{d.writing=false;this.pull(d);const now=performance.now();if(d.final||now-this.lastProgress>180){this.lastProgress=now;this.draw();}}
  }
  saved(d,result){
    if(this.closed||this.downloads.get(d.v.id)!==d)return;
    d.final=result.path;d.blocks.clear();d.pending.clear();
    if(result.released)for(const [id,old] of this.downloads)if(old.token===result.released)this.downloads.delete(id);
  }
  async cancel(id){const d=this.downloads.get(id);if(!d)return;d.paused=true;d.blocks.clear();d.pending.clear();this.downloads.delete(id);if(d.token)await this.api({op:'cancel',id:d.token});this.draw();}
  render(container,chat=false){
    const cache=chat?this.chatRows:this.rows;
    const scroll=chat&&container.parentElement,wasAtEnd=scroll&&scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<90;
    const entries=new Map(this.entries);for(const [id,d] of this.downloads)if(!entries.has(id))entries.set(id,d.v);
    const rows=[];const btn=(label,fn,action=label)=>{const b=text('button',tr(label));b.type='button';b.dataset.action=action;b.className='button button-secondary';b.onclick=()=>Promise.resolve().then(fn).catch(this.error);return b;};
    for(const v of entries.values()){
      const d=this.downloads.get(v.id),available=this.entries.has(v.id),own=this.local.has(v.id);
      const author=own?tr('Вы'):this.names.get(v.author)||tr('Участник');
      const key=JSON.stringify([author,own,available,!!d,d?.starting,d?.paused,d?.final]);
      let saved=cache.get(v.id);
      if(!saved||saved.key!==key){
        const row=document.createElement('article');row.className='file-row'+(chat?' chat-attachment':'');
        if(chat){
          row.tabIndex=0;
          row.dataset.attachmentKind=attachmentKind(v);
          if((own||d?.final)&&['circle','photo','voice'].includes(attachmentKind(v)))row.classList.add('local-media');
        }
        row.classList.toggle('is-own',own);
        const name=text('strong',v.clip==='voice'?tr('Голосовое сообщение'):v.clip==='circle'?tr('Видеосообщение'):v.name);
        name.className='file-name';name.title=v.name;
        const byline=text('small',author);byline.className='file-author';
        const detail=document.createElement('div');detail.className='file-details';
        detail.append(text('small',fileSize(v.size)));
        const actions=document.createElement('div');actions.className='file-actions';
        row.append(byline,name,detail);
        if(chat && v.caption){const caption=document.createElement('p');caption.className='attachment-caption';appendChatText(caption,v.caption);row.append(caption);}
        let progress,meter;
        if(own)actions.append(btn('Убрать',()=>this.withdraw(v.id)));
        else if(d?.final)detail.append(text('small',tr('Сохранено')));
        else if(d){
          progress=text('small','');detail.append(progress);
          meter=document.createElement('progress');meter.max=v.size||1;meter.setAttribute('aria-label',v.name);row.append(meter);
          if(available&&!d.starting)actions.append(btn(d.paused?'Продолжить':'Пауза',()=>{
            d.paused=!d.paused;d.pending.clear();if(!d.paused){d.last=d.lastData=Date.now();d.blocks.clear();this.pull(d);}this.draw();
          },'pause'));
          if(!available)detail.append(text('small',tr('Ждём повторного подключения до минуты…')));
          actions.append(btn('Отмена',()=>this.cancel(v.id)));
        }else{
          const download=btn('Скачать',()=>this.start(v),'download');actions.append(download);
          if(chat&&v.clip)this.player.styleTrigger(download,v);
        }
        if(own||d?.final){
          const id=own?v.id:d.token;
          if(!own||(!v.clip&&!v.memoryOnly))actions.append(btn('Показать в папке',()=>this.api({op:'reveal',id})));
          if(attachmentKind(v))
            {
              const read=()=>this.api({op:'preview',id,meta:leaf(v)});
              const meta={...v,id,own};
              const preview=btn(chat&&v.clip==='voice'?'Прослушать':'Просмотреть',()=>chat?this.player.toggle(row,preview,id,meta,read,this.error):this.view?.(id,v));
              if(chat){preview.setAttribute('aria-expanded','false');this.player.styleTrigger(preview,meta,read);}actions.append(preview);
            }
        }
        if(actions.childElementCount)row.append(actions);
        if(chat){
          const stamp=chatTimestamp(v.seenAt);
          if(stamp){
            const meta=document.createElement('footer');meta.className='link-chat-meta';meta.append(stamp);row.append(meta);
          }
        }
        const focused=saved?.row.contains(document.activeElement)?document.activeElement.dataset.action:null;
        if(saved?.row.isConnected)saved.row.replaceWith(row);else if(chat)container.append(row);
        if(focused&&document.hasFocus()){
          const current=[...actions.children].find(button=>button.dataset.action===focused)||actions.firstElementChild;
          current?.focus({preventScroll:true});
        }
        saved={row,key,progress,meter};cache.set(v.id,saved);
      }
      if(saved.progress){
        const now=performance.now(),elapsed=now-d.sample;
        if(elapsed>=600){d.rate=(d.pos-d.samplePos)*1000/elapsed;d.sample=now;d.samplePos=d.pos;}
        saved.meter.value=d.pos;
        saved.progress.textContent=transferText(d.pos,v.size,d.paused?0:d.rate);
      }
      rows.push(saved.row);
    }
    for(const [id,old] of cache)if(!entries.has(id)){old.row.remove();cache.delete(id);}
    if(chat){this.player.reconcile();if(wasAtEnd)scroll.scrollTop=scroll.scrollHeight;return;}
    if(!rows.length){if(container.firstChild?.nodeName==='P')return;rows.push(text('p',tr('Здесь появятся файлы, которыми поделятся участники.')));}
    if(rows.length!==container.children.length||rows.some((r,i)=>container.children[i]!==r))container.replaceChildren(...rows);
  }
  close(){
    if(this.closed)return;
    this.closed=true;this.player.clear();clearInterval(this.timer);
    for(const s of this.senders.values())s.close();
    for(const ch of this.channels.values()){ch.onclose=ch.onmessage=ch.onopen=null;ch.close();}
    for(const cache of [this.rows,this.chatRows]){
      for(const {row} of cache.values())row.remove();
      cache.clear();
    }
    this.senders.clear();this.channels.clear();this.bulk.clear();this.inventories.clear();
    this.entries.clear();this.local.clear();this.requests.clear();this.names.clear();this.downloads.clear();
    this.api({op:'clear'}).catch(()=>{});
    this.draw();
  }
}
