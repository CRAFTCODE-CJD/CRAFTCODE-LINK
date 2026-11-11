import {tr} from './locale.mjs';
import { cleanDisplayName } from './profile-name.mjs';
import { jid, loginProvider } from './account-address.mjs';
export { jid } from './account-address.mjs';
import { Strophe, $iq, $pres, $msg } from './vendor/strophe.mjs';

import { getProvider } from './providers.mjs';
const ROSTER = 'jabber:iq:roster';
const EXT = 'urn:xmpp:extdisco:2';
const APP = 'urn:craftlink:call:1';
const HINTS = 'urn:xmpp:hints';
const bare = full => jid(full.split('/')[0]);
const child = (el, name, ns) => [...el.children].find(n => n.localName === name && n.namespaceURI === ns);
function iq(conn, query, expectedFrom) {
  return new Promise((resolve, reject) => conn.sendIQ(query, result => {
    const from = result.getAttribute('from');
    if (from && from !== expectedFrom && from !== conn.domain && from !== bare(conn.jid))
      return reject(new Error(tr('Неожиданный ответ службы.')));
    resolve(result);
  }, () => reject(new Error(tr('Сервис не ответил на запрос.'))), 7000));
}

export function iceServices(services) {
  const entries = [];
  for (const service of services?.children || []) {
    if (service.localName !== 'service' || service.namespaceURI !== EXT) continue;
    const get = key => service.getAttribute(key) || '';
    const rawHost=get('host'), bracketed=rawHost.startsWith('[')?rawHost:'['+rawHost+']';
    let host=rawHost;
    if(rawHost.includes(':')){try{host=new URL('https://'+bracketed).hostname;}catch{continue;}}
    const type = get('type'), port = Number(get('port') || (type === 'turns' ? 5349 : 3478));
    if (!['stun','turn','turns'].includes(type) || !(/^[a-z0-9.-]{1,253}$/i.test(host) || /^\[[0-9a-f:]+\]$/i.test(host)) || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    const transport = get('transport') || (type === 'turns' ? 'tcp' : 'udp');
    if (!['udp','tcp'].includes(transport)) continue;
    const result = { urls: type + ':' + host + ':' + port + (type === 'stun' ? '' : '?transport=' + transport) };
    if (type !== 'stun') {
      if (!get('username') || !get('password')) continue;
      Object.assign(result, { username:get('username'), credential:get('password') });
    }
    entries.push(result);
    if (entries.length >= 12) break;
  }
  return entries;
}

export class InternetAccount {
  constructor({ changed, packet, resumed, ownName, blocked=()=>false, transport = url => new Strophe.Connection(url) }) {
    Object.assign(this, { changed, packet, resumed, ownName, blocked, transport });
    this.resource = 'craftlink-' + crypto.randomUUID();
    this.contacts = new Map(); this.resources = new Map(); this.requests = new Set(); this.names=new Map(); this.activities=new Map();this.activitySent=new Map();
    this.status = 'signed-out'; this.generation = 0; this.attempts = 0;
  }
  full(contact) { return this.resources.get(contact)?.values().next().value; }
  contactName(id) { return this.names.get(this.full(id)) || id.split('@')[0]; }
  announce(conn = this.online()) {
    conn.send($pres().c('craftlink',{xmlns:APP,nick:cleanDisplayName(this.ownName?.())}));
    if(this.status==='online')for(const [id] of this.contacts)if(this.mutual(id))this.directActivity(id);
  }
  activity(id) {
    return [...(this.resources.get(id) || [])].map(full=>this.activities.get(full)).find(Boolean);
  }
  syncActivity(activity) {
    this.ownActivity=activity;
    if(this.status!=='online'){this.activitySent.clear();return;}
    for(const [id] of this.contacts)if(this.mutual(id)){
      const signature=(activity.door || '')+':'+(activity.count || 0);
      if(this.activitySent.get(id)!==signature){this.activitySent.set(id,signature);this.directActivity(id);}
    }
  }
  directActivity(id) {
    if(!this.conn || !this.mutual(id))return;
    this.conn.send($pres({to:id}).c('craftlink',{xmlns:APP,nick:cleanDisplayName(this.ownName?.()),...this.ownActivity}));
  }
  clearResources(id) {
    this.activitySent.delete(id);
    for(const full of this.resources.get(id) || [])this.activities.delete(full);
    for (const full of this.resources.get(id) || []) this.names.delete(full);
    this.resources.delete(id);
  }
  mutual(contact) { return !this.blocked(contact) && this.contacts.get(contact)?.subscription === 'both'; }
  async login(address, password) {
    const id = jid(address);
    const provider = getProvider(loginProvider(id));
    if (!provider) throw new Error(tr('Введите полный адрес поддерживаемого XMPP-аккаунта.'));

    if (!password || password.length > 1024) throw new Error(tr('Введите пароль аккаунта.'));
    this.logout();
    this.routes = provider.bosh ? [provider.service, provider.bosh] : [provider.service];
    this.routeIndex = 0;
    this.id = id; this.secret = password; this.connect(false);
  }
  connect(retry) {
    const generation = ++this.generation, conn = this.transport(this.routes[this.routeIndex]);
    this.conn = conn; this.status = retry ? 'reconnecting' : 'connecting'; this.error = ''; this.changed();
    let ended = false;
    const end = authFail => {
      if (ended || generation !== this.generation) return;
      ended = true; clearTimeout(this.deadline); this.conn = null;
      this.removal?.lost();
      this.activities.clear(); this.activitySent.clear(); this.resources.clear(); this.names.clear(); this.requests.clear();
      this.status = authFail ? 'signed-out' : 'reconnecting';
      this.error = authFail ? tr('Проверьте адрес и пароль.') : tr('Нет связи с сервером. Повторяем подключение…');
      if (authFail) this.secret = '';
      else {
        this.routeIndex=(this.routeIndex+1)%this.routes.length;
        this.timer = setTimeout(() => {if(this.generation===generation)this.connect(true);}, Math.min(30000, 2000 * 2 ** Math.min(4, this.attempts++)));
      }
      this.changed();
    };
    this.deadline = setTimeout(() => { end(false); conn.disconnect(); }, 16000);
    conn.connect(this.id + '/' + this.resource, this.secret, status => {
      if (generation !== this.generation || ended) return;
      if (status === Strophe.Status.CONNECTED) {
        clearTimeout(this.deadline);
        this.installHandlers(conn);
        const self = this;
        iq(conn, $iq({type:'get'}).c('query',{xmlns:ROSTER}), this.id).then(result => {
          if (generation !== self.generation || ended) return;
          self.contacts.clear(); self.readRoster(child(result,'query',ROSTER));
          self.status = 'online';
          self.announce(conn);
           self.attempts = 0; self.changed(); self.resumed(retry);
        }).catch(() => { end(false); conn.disconnect(); });
      } else if ([Strophe.Status.AUTHFAIL, Strophe.Status.CONNFAIL, Strophe.Status.DISCONNECTED, Strophe.Status.ERROR].includes(status)) end(status === Strophe.Status.AUTHFAIL);
    });
  }
  readRoster(query) {
    for (const item of query?.children || []) {
      const id = jid(item.getAttribute('jid')); if (!id || item.localName !== 'item') continue;
      const subscription = item.getAttribute('subscription');
      if (subscription === 'remove' || this.blocked(id)) { this.contacts.delete(id); this.clearResources(id); this.requests.delete(id); }
      else this.contacts.set(id, {id, subscription, asked:item.getAttribute('ask') === 'subscribe'});
    }
  }
  installHandlers(conn) {
    const live = () => this.conn === conn;
    conn.addHandler(stanza => {
      if (!live()) return false;
      const from = stanza.getAttribute('from');
      if (from && from !== this.id) return true;
      this.readRoster(child(stanza,'query',ROSTER)); conn.send($iq({type:'result',id:stanza.getAttribute('id'), ...(from ? {to:from} : {})}));
      this.changed(); return true;
    }, ROSTER, 'iq','set');
    conn.addHandler(stanza => {
      if (!live()) return false;
      const from = stanza.getAttribute('from') || '', id = bare(from), type = stanza.getAttribute('type');
      if (!id || id === this.id || this.blocked(id)) return true;
      if (type === 'subscribe') {
        const c = this.contacts.get(id);
        if (c?.asked || ['to','both'].includes(c?.subscription)) conn.send($pres({type:'subscribed',to:id}));
        else if (this.requests.size < 32) this.requests.add(id);
      } else if (type === 'unavailable') {this.resources.get(id)?.delete(from);this.names.delete(from);this.activities.delete(from);}
      else if (!type && from.startsWith(id + '/craftlink-') && child(stanza,'craftlink',APP)) {
        const resources = this.resources.get(id) || new Set();
        if ((resources.size < 8 || resources.has(from)) && (this.contacts.has(id) || this.requests.has(id))) {
          const fresh=!resources.has(from);
          resources.add(from); this.resources.set(id,resources);
          const marker=child(stanza,'craftlink',APP), door=marker.getAttribute('door'),count=Number(marker.getAttribute('count'));
          if(this.mutual(id) && /^[a-f0-9-]{36}$/.test(door || '') && [1,2,3].includes(count))this.activities.set(from,{full:from,door,count,host:marker.getAttribute('host')==='1'});
          else this.activities.delete(from);
          if(fresh && this.mutual(id))this.directActivity(id);
          this.names.set(from,cleanDisplayName(child(stanza,'craftlink',APP).getAttribute('nick')));
        }
      } else if (type === 'unsubscribed') this.clearResources(id);
      this.changed(); return true;
    }, null, 'presence');
    conn.addHandler(stanza => {
      if (!live()) return false;
      const from = stanza.getAttribute('from') || '', payload = child(stanza,'call',APP);
      if (stanza.getAttribute('type') !== 'chat' || !this.mutual(bare(from)) || !from.startsWith(bare(from) + '/craftlink-') ||
          !payload || payload.textContent.length > 140000 || child(stanza,'delay','urn:xmpp:delay')) return true;
      try { this.packet(from, JSON.parse(payload.textContent)); } catch {}
      return true;
    }, null, 'message');
  }
  async add(id) {
    id = jid(id); if(this.blocked(id))throw Error(tr('Сначала разблокируйте контакт.')); if (!id || id === this.id) throw new Error(tr('Введите адрес друга, например alex@xmpp.jp.'));
    const conn = this.online();
    await iq(conn,$iq({type:'set'}).c('query',{xmlns:ROSTER}).c('item',{jid:id}), this.id);
    conn.send($pres({to:id,type:'subscribe'}));
  }
  async answer(id, accept) {
    if (!this.requests.has(id)) return;
    this.online().send($pres({to:id,type:accept?'subscribed':'unsubscribed'})); this.requests.delete(id);
    if (accept) await this.add(id); this.changed();
  }
  async remove(id) {
    if (!this.contacts.has(id)) return;
    await iq(this.online(),$iq({type:'set'}).c('query',{xmlns:ROSTER}).c('item',{jid:id,subscription:'remove'}),this.id);
  }
  unregister(expectedId) {
    const conn=this.online();
    if(this.removal || !expectedId || expectedId!==this.id) throw new Error(tr('Проверьте текущий аккаунт.'));
    const domain=expectedId.split('@')[1];
    return new Promise((resolve,reject)=>{
      const unknown=tr('Сервис не подтвердил удаление. Проверьте вход с прежними данными. Запрос автоматически не повторяется.');
      const finish=message=>{
        if(this.removal!==pending)return;
        clearTimeout(timer);
        this.removal=null;
        if(message)reject(new Error(message));else resolve();
      };
      const pending={lost:()=>finish(unknown)};
      const timer=setTimeout(pending.lost,8500);
      this.removal=pending;
      try {
        const query=$iq({type:'set',to:domain}).c('query',{xmlns:'jabber:iq:register'}).c('remove');
        conn.sendIQ(query,result=>{
          const from=result.getAttribute('from');
          if(result.getAttribute('type')!=='result' || (from && from!==domain && from!==expectedId))finish(unknown);
          else finish();
        },reply=>finish(reply ? tr('Сервис отклонил удаление. Аккаунт остаётся доступен. Откройте помощь сервиса.') : unknown),8000);
      } catch { finish(unknown); }
    });
  }
  online() { if (this.status !== 'online' || !this.conn) throw new Error(tr('Сначала подключитесь к сервису друзей.')); return this.conn; }
  send(full, data) {
    this.online().send($msg({to:full,type:'chat'}).c('call',{xmlns:APP}).t(JSON.stringify(data)).up()
      .c('no-store',{xmlns:HINTS}).up().c('no-copy',{xmlns:HINTS}));
  }
  async ice() {
    const conn = this.online(), domain = this.id.split('@')[1];
    try {
      const result = await iq(conn,$iq({type:'get',to:domain}).c('services',{xmlns:EXT}),domain);
      if (this.conn !== conn) throw new Error();
      const services=child(result,'services',EXT);
      const entries=iceServices(services);
      const restricted=[...(services?.children || [])].filter(s=>['turn','turns'].includes(s.getAttribute('type')) && !s.getAttribute('password')).slice(0,3);
      const credentials=await Promise.all(restricted.map(async s=>{
        const attrs={type:s.getAttribute('type'),host:s.getAttribute('host')};
        if(s.hasAttribute('port'))attrs.port=s.getAttribute('port');
        try {
          const reply=await iq(conn,$iq({type:'get',to:domain}).c('credentials',{xmlns:EXT}).c('service',attrs),domain);
          const result=child(reply,'credentials',EXT);
          for(const item of result?.children || []){
            if(item.getAttribute('host')!==attrs.host || item.getAttribute('type')!==attrs.type)continue;
            if(s.hasAttribute('transport') && !item.hasAttribute('transport'))item.setAttribute('transport',s.getAttribute('transport'));
            if(s.hasAttribute('port') && !item.hasAttribute('port'))item.setAttribute('port',s.getAttribute('port'));
          }
          return iceServices(result);
        } catch { return []; }
      }));
      return this.conn===conn ? entries.concat(credentials.flat()) : [];
    } catch { return []; }
  }
  probe() {
    const conn=this.conn;
    if(!conn || this.status!=='online' || this.probing===conn)return;
    this.probing=conn;
    const done=()=>{if(this.probing===conn)this.probing=null;};
    // Any IQ response, including feature-not-implemented, proves this socket is alive.
    conn.sendIQ($iq({type:'get',to:this.id.split('@')[1]}).c('ping',{xmlns:'urn:xmpp:ping'}),done,response=>{
      done();
      if(!response && this.conn===conn && this.status==='online'){
        this.connect(true);
        conn.disconnect();
      }
    },6500);
  }
  logout() {
    this.removal?.lost();
    this.generation++; clearTimeout(this.deadline); clearTimeout(this.timer);
    this.conn?.disconnect(); this.conn = null; this.secret = ''; this.id = ''; this.error = ''; this.attempts = 0;
    this.contacts.clear(); this.activities.clear(); this.activitySent.clear(); this.resources.clear(); this.names.clear(); this.requests.clear(); this.status = 'signed-out'; this.changed();
  }
}
