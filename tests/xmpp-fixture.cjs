// A local XMPP server fixture at the browser WebSocket boundary. No account or public traffic.
const xml=require(require.resolve('xml-js',{paths:[__dirname,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || __dirname]}));
const domain='jabber.hot-chilli.net';
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
class Fixture {
  constructor(turn){this.turn=turn;this.clients=new Map(); this.rosters=new Map(); this.transcript=[];this.deleted=new Set();this.removals=[];}
  route(ws, host = domain) {
    const c={ws,auth:false,full:'',id:'',online:false};
    const send=x=>ws.send(x);
    const push=(user,other)=>{
      const cli=this.clients.get(user); if(!cli)return;
      const item=this.item(user,other);
      cli.ws.send('<iq xmlns="jabber:client" type="set" id="push-'+Date.now()+'"><query xmlns="jabber:iq:roster">'+item+'</query></iq>');
    };
    ws.onMessage(msg=>{
      const el=xml.xml2js(String(msg),{compact:false}).elements[0], a=el.attributes || {}, kid=el.elements?.[0], k=kid?.name;
      const id=esc(a.id||'');
      if(process.env.CCLINK_QA_TRACE)console.log('fixture',el.name,a.type||'',k||'');
      if(el.name==='open') {
        send('<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" from="'+host+'" version="1.0" id="fixture"/>');
        send('<stream:features xmlns:stream="http://etherx.jabber.org/streams">'+(c.auth?'<bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"/>':'<mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl"><mechanism>PLAIN</mechanism></mechanisms>')+'</stream:features>');
      }else if(el.name==='auth'){
        const [,user,pw]=Buffer.from(el.elements[0].text,'base64').toString().split('\0');
        if(pw!=='fixture-password' || this.deleted.has(user+'@'+host)){send('<failure xmlns="urn:ietf:params:xml:ns:xmpp-sasl"><not-authorized/></failure>');return;}
        c.id=user+'@'+host;c.auth=true;send('<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>');
      }else if(el.name==='iq' && a.type!=='result'){
        let content='';
        if(k==='bind'){
          c.full=c.id+'/'+kid.elements[0].elements[0].text;this.clients.set(c.id,c);
          if(!this.rosters.has(c.id))this.rosters.set(c.id,new Map());
          content='<bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><jid>'+c.full+'</jid></bind>';
        }else if(k==='query' && kid.attributes?.xmlns==='jabber:iq:register' && kid.elements?.[0]?.name==='remove' && a.type==='set'){
          if(!c.auth || a.to!==host)throw new Error('Unexpected unauthenticated or misaddressed removal');
          this.removals.push(c.id);
          if(this.removalMode==='silence')return;
          if(this.removalMode==='deny'){
            send('<iq xmlns="jabber:client" type="error" id="'+id+'" from="'+host+'"><error type="cancel"><service-unavailable xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></error></iq>');return;
          }
          this.deleted.add(c.id);this.rosters.delete(c.id);
        }else if(k==='query' && a.type==='get'){
          content='<query xmlns="jabber:iq:roster">'+[...this.rosters.get(c.id).keys()].map(o=>this.item(c.id,o)).join('')+'</query>';
        }else if(k==='query' && a.type==='set'){
          const item=kid.elements[0].attributes,o=item.jid;
          if(item.subscription==='remove'){this.rosters.get(c.id).delete(o);push(c.id,o);}
          else {if(!this.rosters.get(c.id).has(o))this.rosters.get(c.id).set(o,{to:false,from:false});push(c.id,o);}
        }else if(k==='services' && this.servicesFor)content=this.servicesFor(c.id);
        else if(k==='services' && !this.turn?.port)content='<services xmlns="urn:xmpp:extdisco:2"/>';
        else if(k==='services')content='<services xmlns="urn:xmpp:extdisco:2"><service type="stun" host="127.0.0.1" port="'+this.turn.port+'"/>'+
          ['udp','tcp'].map(t=>'<service type="turn" transport="'+t+'" host="127.0.0.1" port="'+this.turn.port+'" username="local-qa" password="'+this.turn.secret+'"/>').join('')+'</services>';
        send('<iq xmlns="jabber:client" type="result" id="'+id+'">'+content+'</iq>');
      }else if(el.name==='presence'){
        const to=a.to, target=this.clients.get(to);
        if(!a.type){
          if(to){
            if(target && this.rosters.get(c.id)?.get(to)?.from){
              c.directed??=new Map();el.attributes.from=c.full;const presence=xml.js2xml({elements:[el]});c.directed.set(to,presence);target.ws.send(presence);
            }
          } else {c.nick=kid?.attributes?.nick || '';c.online=true;this.broadcastOnline();}
        }
        else if(a.type==='subscribe'){
          const record=this.rosters.get(c.id).get(to);if(record)record.ask=true;push(c.id,to);
          if(target)target.ws.send('<presence xmlns="jabber:client" type="subscribe" from="'+esc(c.id)+'"/>');
        }else if(a.type==='subscribed' && target){
          const my=this.rosters.get(c.id).get(to)||{};my.from=true;this.rosters.get(c.id).set(to,my);
          const theirs=this.rosters.get(to).get(c.id)||{};theirs.to=true;theirs.ask=false;this.rosters.get(to).set(c.id,theirs);
          push(c.id,to);push(to,c.id);this.broadcastOnline();
        }
      }else if(el.name==='message'){
        const dest=this.clients.get((a.to||'').split('/')[0]);if(!dest || dest.full!==a.to)return;
        const packet=JSON.parse(kid.elements[0].text);if(this.filterPacket?.(c.full,a.to,packet)===false)return;
        if(this.transformPacket)kid.elements[0].text=JSON.stringify(this.transformPacket(c.full,packet));
        if(this.dropOneAnswer && packet.data?.type==='answer'){this.dropOneAnswer=false;return;}
        this.transcript.push(kid?.name);
        if(process.env.CCLINK_QA_TRACE){const packet=JSON.parse(kid.elements[0].text);console.log(c.id.split('@')[0],packet.kind,packet.data?.type||'');}
        el.attributes.from=c.full;dest.ws.send(xml.js2xml({elements:[el]}));
      }else if(el.name==='close'){send('<close xmlns="urn:ietf:params:xml:ns:xmpp-framing"/>');ws.close();}
    });
    ws.onClose(()=>{if(this.clients.get(c.id)===c){this.clients.delete(c.id);for(const other of this.clients.values())other.ws.send('<presence xmlns="jabber:client" type="unavailable" from="'+esc(c.full)+'"/>');}});
  }
  item(user,other){
    const r=this.rosters.get(user)?.get(other);
    return '<item jid="'+esc(other)+'" subscription="'+(!r?'remove':r.to&&r.from?'both':r.to?'to':r.from?'from':'none')+'"'+(r?.ask?' ask="subscribe"':'')+'/>';
  }
  broadcastOnline(){
    for(const c of this.clients.values())for(const [id,r] of this.rosters.get(c.id) || []){
      const other=this.clients.get(id);
      if(r.to && other?.online)c.ws.send(other.directed?.get(c.id) || '<presence xmlns="jabber:client" from="'+esc(other.full)+'"><craftlink nick="'+esc(other.nick||'')+'" xmlns="urn:craftlink:call:1"/></presence>');
    }
  }
}
module.exports={Fixture,domain};
