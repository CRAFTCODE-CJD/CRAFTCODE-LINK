import { providers } from './providers.mjs';

const framing = 'urn:ietf:params:xml:ns:xmpp-framing';
const sasl = 'urn:ietf:params:xml:ns:xmpp-sasl';
const supported = new Set(['PLAIN','SCRAM-SHA-1','SCRAM-SHA-256','SCRAM-SHA-384','SCRAM-SHA-512']);


// Check the same transport as sign-in, stopping before SASL authentication.
function acceptsLogin({ domain, service }, signal) {
  return new Promise(resolve => {
    if (signal.aborted) return resolve(false);
    let socket, opened = false;
    const timer = setTimeout(() => finish(false), 6000);
    const cancel = () => finish(false);
    function finish(ok) {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      if (socket) {
        socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
        socket.close();
      }
      resolve(ok);
    }
    signal.addEventListener('abort', cancel, { once:true });
    try {
      socket = new WebSocket(service, 'xmpp');
      socket.onerror = socket.onclose = cancel;
      socket.onopen = () => socket.send('<open xmlns="' + framing + '" version="1.0" to="' + domain + '"/>');
      socket.onmessage = ({data}) => {
        if (typeof data !== 'string' || data.length > 65536) return finish(false);
        const root = new DOMParser().parseFromString(data, 'application/xml').documentElement;
        if (!opened) {
          const from = root.getAttribute('from');
          if (root.localName !== 'open' || root.namespaceURI !== framing || (from && from !== domain)) return finish(false);
          opened = true;
          return;
        }
        if (root.localName !== 'features' || root.namespaceURI !== 'http://etherx.jabber.org/streams') return finish(false);
        finish([...root.getElementsByTagNameNS(sasl, 'mechanism')].some(el => supported.has(el.textContent.trim())));
      };
    } catch { finish(false); }
  });
}

async function acceptsHttpLogin({bosh, domain}, signal) {
  if (!bosh || signal.aborted) return false;
  const deadline = AbortSignal.any([signal,AbortSignal.timeout(5500)]);
  const rid = crypto.getRandomValues(new Uint32Array(1))[0]+1;
  const ns = 'http://jabber.org/protocol/httpbind';
  const post = body=>fetch(bosh,{method:'POST',body,headers:{'Content-Type':'text/xml; charset=utf-8'},
    signal:deadline,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',redirect:'error'});
  try {
    const response=await post('<body xmlns="'+ns+'" rid="'+rid+'" to="'+domain+'" wait="5" hold="1" ver="1.6" xmlns:xmpp="urn:xmpp:xbosh" xmpp:version="1.0"/>');
    if(!response.ok) {await response.body?.cancel();return false;}
    const reader=response.body.getReader(), decoder=new TextDecoder();
    let size=0, xml='';
    try {
      for (;;) {
        const {done,value}=await reader.read(); if(done) break;
        size+=value.byteLength; if(size>65536) return false;
        xml+=decoder.decode(value,{stream:true});
      }
    } finally {await reader.cancel().catch(()=>{});}
    const root=new DOMParser().parseFromString(xml+decoder.decode(),'application/xml').documentElement;
    const sid=root.getAttribute('sid'), from=root.getAttribute('from');
    if(root.namespaceURI!==ns || root.localName!=='body' || (from && from!==domain) || !/^[a-zA-Z0-9_-]{1,256}$/.test(sid || '')) return false;
    // Release the anonymous pre-auth session, even when the server advertises no supported mechanism.
    const closing='<body xmlns="'+ns+'" rid="'+(rid+1)+'" sid="'+sid+'" type="terminate"/>';
    const accepted=[...root.getElementsByTagNameNS(sasl,'mechanism')].some(el=>supported.has(el.textContent.trim()));
    await post(closing).then(r=>r.body?.cancel()).catch(()=>{});
    return accepted;
  } catch {return false;}
}
export async function checkProvider(key, signal, checkRegistration) {
  const [login, form] = await Promise.all([
    acceptsLogin(providers[key], signal).then(ok => ok || acceptsHttpLogin(providers[key], signal)),
    checkRegistration(key).catch(()=>false),
  ]);
  return {login, form};
}
