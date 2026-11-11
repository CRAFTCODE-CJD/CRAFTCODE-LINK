import {tr} from './locale.mjs';
// Contact presence advertises an opaque door, never an invitation or the other members.
import { parseRoomCode, roomCode } from './room-code.mjs';
const fresh = time => Number.isFinite(time) && time>Date.now() && time<=Date.now()+65000;
const uuid = value => typeof value==='string' && /^[a-f0-9-]{36}$/.test(value);
export class CallAccess {
  constructor(account,room,show,changed){
    Object.assign(this,{account,room,show,changed});this.used=new Set();
  }
  update(){
    const current=this.room.room;
    if(current!==this.current){
      if(this.pending!==this.keepPending){if(this.current && this.pending)this.cancel();else this.clear();}
      this.current=current; this.door=current?crypto.randomUUID():'';
    }
    if(current && current.peers.length>=3 && this.pending && this.pending.type!=='intro')this.cancel();
    if(this.pending?.type==='waiting-contact')this.joinWhenReady();
    return current && !this.room.quiet?.() ? {door:this.door,count:current.peers.length,host:current.role==='host'?'1':'0'} : {};
  }
  clear(){
    clearTimeout(this.timer); this.pending=null;
  }
  hold(p){
    this.clear();this.pending=p;
    this.timer=setTimeout(()=>{if(this.pending===p){this.clear();this.changed();this.show(tr('Время ожидания истекло. Можно попробовать снова.'));}},Math.max(1,p.expires-Date.now()));
    this.changed();
  }
  send(full,kind,room,token,fields={}){
    this.account.send(full,{version:1,kind,room,token,expires:Date.now()+60000,...fields});
  }
  knock(contact,activity){
    if((this.busy() && !this.room.inCall?.()) || this.room.pending || this.room.outgoing || this.room.joining || this.pending || !activity || activity.count>=3)throw Error(tr('Сейчас присоединиться нельзя.'));
    const p={type:'asking',full:activity.full,room:activity.door,token:crypto.randomUUID(),expires:Date.now()+60000};
    if(!this.account.mutual(contact) || !this.account.resources.get(contact)?.has(p.full))throw Error(tr('Друг уже вышел.'));
    this.send(p.full,'knock',p.room,p.token);this.hold(p);this.show();
  }
  busy(){return !!(this.room.room || this.room.pending || this.room.joining || this.room.busy());}
  inviteGuest(id){
    const full=this.account.full(id),current=this.room.room;
    if(current?.role!=='guest' || current.peers.length>=3 || !full || !this.account.mutual(id) || this.pending)throw Error(tr('Сейчас пригласить друга нельзя.'));
    const token=crypto.randomUUID();
    this.send(full,'room-intro',this.door,token,{code:this.code()});
    this.hold({type:'invited',full,room:this.door,token,expires:Date.now()+60000});this.show();
  }
  code(){
    const r=this.room.room;
    return r.role==='host'?roomCode(this.account,r.id):'LINK1:'+this.room.hostFull.replace('/craftlink-','/')+'/'+r.id;
  }
  receive(full,d){
    if(!['knock','room-intro','door-no','door-cancel','door-ack'].includes(d.kind))return false;
    if(!uuid(d.token) || !uuid(d.room) || !fresh(d.expires) || !this.account.mutual(full.split('/')[0]))return true;
    const p=this.pending,matched=p && full===p.full && p.token===d.token && p.room===d.room;
    if(d.kind==='door-ack'){
      if(matched && p.type==='invited'){this.clear();this.changed();}
      return true;
    }
    if(d.kind==='door-no' || d.kind==='door-cancel'){
      if(matched){this.clear();this.changed();this.show(d.kind==='door-cancel'?tr('Друг отменил запрос.'):d.outcome==='busy'?tr('Друг сейчас занят.'):p.type==='invited'?tr('Друг отклонил приглашение.'):tr('Друг отклонил запрос на вход.'));}
      return true;
    }
    if(d.kind==='knock'){
      if(matched || this.used.has(d.token))return true;
      this.remember(d.token);
      if(this.room.quiet?.() || this.door!==d.room || !this.room.room || this.room.room.peers.length>=3 || p || this.room.outgoing){
        this.send(full,'door-no',d.room,d.token,{outcome:'busy'});return true;
      }
      if(this.room.canReturn?.(full)){this.send(full,'room-intro',d.room,d.token,{code:this.code()});return true;}
      this.hold({type:'knock',full,token:d.token,room:d.room,expires:d.expires});this.show();return true;
    }
    if(this.used.has(d.token))return true;
    this.remember(d.token);
    if((this.room.quiet?.() && !(matched && p.type==='asking')) || this.room.pending || this.room.outgoing || this.room.joining || (this.busy() && !this.room.inCall?.()) || (p && !(matched && p.type==='asking'))){this.send(full,'door-no',d.room,d.token,{outcome:'busy'});return true;}
    let target;try{target=parseRoomCode(d.code);}catch{return true;}
    if(target.owner===this.account.id)return true;
    this.hold({type:'intro',switchCall:this.room.inCall?.(),full,token:d.token,room:d.room,expires:d.expires,target});
    if(matched && !this.pending.switchCall && this.account.mutual(target.owner))this.accept().catch(e=>this.show(e.message));
    else this.show();
    return true;
  }
  remember(token){this.used.add(token);if(this.used.size>128)this.used.delete(this.used.values().next().value);}
  async accept(){
    const p=this.pending;if(!p)return;
    if(!fresh(p.expires)){this.clear();this.changed();return;}
    if(p.type==='knock'){
      if(this.door!==p.room || this.room.room?.peers.length>=3)throw Error(tr('В комнате уже нет места.'));
      if(this.room.room?.role==='host')this.room.approvedDoor={full:p.full,room:this.room.room.id,until:p.expires};
      this.send(p.full,'room-intro',p.room,p.token,{code:this.code()});
      this.clear();this.changed();return;
    }
    if(p.type!=='intro' || this.busy())return;
    p.type='waiting-contact';this.changed();
    if(!this.account.mutual(p.target.owner)){
      try{if(!this.account.contacts.get(p.target.owner)?.asked)await this.account.add(p.target.owner);}
      catch(e){if(this.pending===p){p.type='intro';this.changed();}throw e;}
    }
    this.joinWhenReady();
  }
  joinWhenReady(){
    const p=this.pending;
    if(p?.type!=='waiting-contact' || !this.account.mutual(p.target.owner) || !this.account.resources.get(p.target.owner)?.has(p.target.full))return;
    this.clear();
    try{this.room.requestJoin(p.target,'contact');this.send(p.full,'door-ack',p.room,p.token);}catch(e){this.show(e.message);}
    this.changed();
  }
  cancel(outcome){
    const p=this.pending;if(!p)return;
    this.clear();
    try{this.send(p.full,['knock','intro'].includes(p.type)?'door-no':'door-cancel',p.room,p.token,{outcome});}catch{}
    this.changed();
  }
}
