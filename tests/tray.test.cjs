'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { attachTray, reveal } = require('../src/tray.cjs');

function shell(createNotification,canOpenChat) {
  const tray = Object.assign(new EventEmitter(), {
    balloons: [], destroyed: false, setToolTip() {}, isDestroyed() { return this.destroyed; },
    setContextMenu(items) { this.menu = items; }, destroy() { this.destroyed = true; },
    displayBalloon(options) { this.balloons.push(options); },
  });
  const window = Object.assign(new EventEmitter(), {
    visible:true, minimized:false, focused:false, isDestroyed:()=>false,
    isMinimized(){ return this.minimized; }, isVisible(){ return this.visible; }, isFocused(){ return this.focused; },
    hide(){ this.visible=false; this.focused=false; }, show(){ this.visible=true; }, focus(){ this.focused=true; },
    restore(){ this.minimized=false; }, flashFrame(state){ this.flashing=state; },
  });
  let quitting=false;
  const actions=[];
  const controller=attachTray({window,tray,createNotification,canOpenChat,openChat:(profile,id)=>actions.push([profile,id]),openGame:id=>actions.push(['game',id]),openRequests:source=>actions.push(source),stopSharing:()=>actions.push('stop'),leaveRoom:()=>actions.push('leave'),menu:{buildFromTemplate:items=>items},quit:()=>{quitting=true;},isQuitting:()=>quitting});
  const close=()=>{let prevented=false;window.emit('close',{preventDefault(){prevented=true;}});return prevented;};
  return {tray,window,controller,close,actions};
}
test('close hides the window, explains background capture once and tray click restores it',()=>{
 const {window,tray,close}=shell();
 assert.ok(close());assert.equal(window.visible,false);assert.equal(tray.balloons.length,1);
 tray.emit('click');assert.ok(window.visible && window.focused);
 close();assert.equal(tray.balloons.length,1);
 window.minimized=true;tray.menu[0].click();assert.ok(window.visible && !window.minimized);
});
test('hidden call can be opened from a quiet balloon and never auto-answers',()=>{
 const {window,tray,controller,close}=shell();close();controller.ring();
 assert.equal(tray.balloons.at(-1).title,'Входящий звонок');assert.equal(window.visible,false);
 tray.emit('balloon-click');assert.ok(window.visible);assert.equal(window.flashing,false);
});
test('explicit exit, system shutdown and a destroyed tray let Windows close normally',()=>{
 for(const reason of ['quit','shutdown','broken']){
  const {tray,window,controller,close}=shell();
  if(reason==='quit')tray.menu.at(-1).click();
  if(reason==='shutdown')window.emit('session-end');
  if(reason==='broken')controller.destroy();
  assert.equal(close(),false);
 }
 assert.doesNotThrow(()=>reveal(null));
});

test('maintenance releases a hidden window without a new balloon; an ordinary shutdown query can be cancelled by Windows',()=>{
 const {window,tray,close}=shell();
 window.emit('query-session-end',{reasons:['logoff']});assert.equal(close(),true);
 const count=tray.balloons.length;
 window.emit('query-session-end',{reasons:['close-app']});assert.equal(close(),false);
 window.emit('session-end');assert.equal(tray.balloons.length,count);
});

test('tray actions follow active call and broadcast, reveal on leave and disappear on disconnect',()=>{
  const {tray,window,controller,actions,close}=shell();
  controller.setCall(true,true); close();
  tray.menu.find(item=>item.label==='Остановить показ').click();
  assert.equal(window.visible,false);
  tray.menu.find(item=>item.label==='Завершить звонок…').click();
  assert.deepEqual(actions,['stop','leave']); assert.equal(window.visible,true);
  controller.setCall(true,false); assert(!tray.menu.some(item=>item.label==='Остановить показ'));
  controller.setCall(false,false); assert.equal(tray.menu.length,3);
});

test('background call and friend notifications leave the external window focused; click opens requests',()=>{
  const {window,tray,controller,actions}=shell();
  for(const kind of ['call','friend-direct']){
    controller.ring(kind);assert.equal(window.focused,false);assert.equal(tray.balloons.at(-1).respectQuietTime,true);
    assert.equal(tray.balloons.at(-1).noSound,true);
  }
  assert.match(tray.balloons.at(-1).title,/заявка/i);
  tray.emit('balloon-click');assert(window.focused);assert.deepEqual(actions,['friend-direct']);
});

test('clearing friend requests cancels their balloon and leaves a newer call notification intact',()=>{
  const {window,tray,controller,actions}=shell();let removals=0;tray.removeBalloon=()=>removals++;
  controller.ring('friend-direct');controller.clearRequestNotice();
  assert.equal(removals,1);assert.equal(window.flashing,false);tray.emit('balloon-click');assert.deepEqual(actions,[]);
  window.focused=false;controller.ring('friend-jabber');controller.ring('call');controller.clearRequestNotice();
  assert.equal(removals,1);assert.equal(window.flashing,true);
});

test('native notifications keep separate destinations, suppress repeats and ignore expired clicks',()=>{
 const entries=[];
 const {controller,window,actions}=shell(options=>{
   const native=Object.assign(new EventEmitter(),{options,show(){},close(){this.emit('close');}});
   entries.push(native);return native;
 });
 controller.ring('game',{id:'match',name:'Аня'});
 controller.ring('game',{id:'match',name:'Аня'});
 controller.ring('friend-direct',{id:'person'});
 assert.equal(entries.length,2);assert.equal(entries[0].options.silent,true);assert.match(entries[0].options.body,/Аня/);
 assert(!window.focused);controller.syncGameNotices([]);entries[0].emit('click');assert(!window.focused);
 entries[1].emit('click');assert.deepEqual(actions,['friend-direct']);
 window.focused=false;controller.ring('call',{id:'call1'});
 controller.setNoticePolicy(true,true);entries[2].emit('click');assert(!window.focused);
 controller.ring('call',{id:'call2'});controller.setNoticePolicy(false,false);
 controller.ring('game');assert.equal(entries.length,3);
});
test('game join requests in the background open their exact card only after a click and expire separately',()=>{
 const entries=[];
 const {controller,window,actions}=shell(options=>{
   const native=Object.assign(new EventEmitter(),{options,show(){},close(){this.emit('close');}});
   entries.push(native);return native;
 });
 controller.ring('game-request',{id:'req-1',name:'Friend'});
 controller.ring('game',{id:'invite-2',name:'Other friend'});
 assert(!window.focused);assert(entries.every(e=>e.options.silent));
 controller.syncGameNotices(['req-1']);entries[1].emit('click');assert(!window.focused);
 entries[0].emit('click');assert(window.focused);
 assert.deepEqual(actions,[['game','req-1']]);
});
test('untrusted notification names stay on one line and cannot reorder the application hint',()=>{
 const {controller,tray}=shell();
 controller.ring('call',{id:'caller',name:'Аня\u2028Первая строка\u0085\u2029\u061cВторая\u200f'});
 assert.equal(tray.balloons[0].content,'Аня Первая строка Вторая · Откройте CRAFTCODE LINK, чтобы ответить.');
});
test('native failure falls back quietly and a cancelled call cannot reopen the window',()=>{
 const native=Object.assign(new EventEmitter(),{show(){},close(){}});
 const {controller,tray,window}=shell(()=>native);
 controller.ring('call');native.emit('failed');
 assert.equal(tray.balloons.length,1);assert.equal(tray.balloons[0].noSound,true);
 controller.endRing();tray.emit('balloon-click');assert(!window.focused);
});

test('background messages group per friend, omit text and reopen only an unread chat of the active profile',()=>{
  const entries=[],alice='a'.repeat(64),boris='b'.repeat(64),profile='c'.repeat(64);
  let owner=profile;
  const {controller,window,actions}=shell(options=>{
    const n=Object.assign(new EventEmitter(),{options,show(){},close(){this.emit('close');}});entries.push(n);return n;
  },(p,id)=>p===owner && id===boris);
  const message=id=>controller.ring('message',{profile,id,name:'Друг',text:'private draft'});
  message(alice);message(alice);message(boris);
  assert.equal(entries.length,2);assert(!window.focused);
  assert(!JSON.stringify(entries[1].options).includes('private draft'));
  controller.clearChatNotice(alice);entries[0].emit('click');assert(!window.focused);
  entries[1].emit('click');assert.deepEqual(actions,[[profile,boris]]);
  window.focused=false;message(boris);owner=null;entries[2].emit('click');assert(!window.focused);
  controller.setNoticePolicy(true,true);message(alice);assert.equal(entries.length,3);
});
