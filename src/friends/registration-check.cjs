'use strict';

// Fixed origins only. The probe never runs downloaded content or submits the form.
const assets = {
  jabberclub: [
    ['https://jabber.club/register', 'text/html', ['name="nickname"', 'name="password_confirm"', 'name="captcha_answer"'], 128 * 1024],
    ['https://jabber.club/captcha.php', 'image/png', null, 64 * 1024],
  ],
  jabberru: [
    ['https://www.jabber.ru/register', 'text/html', ['#register', '/js/bundle.js'], 128 * 1024],
    ['https://www.jabber.ru/js/bundle.js', 'javascript', ['/register', 'renderCaptcha'], 512 * 1024],
    ['https://www.google.com/recaptcha/api.js?render=explicit&onload=renderCaptcha', 'javascript', ['recaptcha'], 64 * 1024],
  ],
};
async function assetAvailable(fetch, [url, type, markers, maxBytes], signal) {
  const response = await fetch(url, {credentials:'omit', referrerPolicy:'no-referrer', cache:'no-store', redirect:'error', signal});
  const reader = response.body?.getReader();
  if (!reader) return false;
  try {
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes(type)) return false;
    let size = 0;
    const chunks = [];
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) return false;
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    if (!markers) return bytes.length > 32 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const body = bytes.toString('utf8');
    return markers.every(marker => body.includes(marker));
  } finally { await reader.cancel().catch(()=>{}); }
}
async function registrationAvailable(key, fetch) {
  if (!Object.hasOwn(assets, key)) return false;
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), 7500);
  try {
    const checks = assets[key].map(asset => assetAvailable(fetch, asset, controller.signal));
    return (await Promise.all(checks)).every(Boolean);
  } catch { return false; }
  finally { clearTimeout(timer); controller.abort(); }
}
module.exports = { registrationAvailable };
