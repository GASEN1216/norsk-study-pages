// Makes the site a cross-origin isolated page, which the speech recogniser of 警察抓小偷's 朗读 needs to use more than
// one thread (SharedArrayBuffer): a word then lights up a quarter of a second after it is read instead of a second
// (measured 2026-11-11). The hosts cannot send the two headers themselves (GitHub Pages has no header settings), so
// this service worker adds them to the page — and to worker scripts, which must carry the same policy — on their way
// in. It does nothing else: no cache, and every other request (data, pictures, audio with its ranges, the community
// service) never passes through here.
// The site loads nothing from other origins except the community service, which is fetched with CORS and so is
// unaffected. Anything added later from another origin without CORS or a Cross-Origin-Resource-Policy header (a
// picture, a script, an embedded page) would be blocked on an isolated page: check it against a page opened with
// this worker in control.
// Registered by app.js (isolatePage); ?isolate=off on the site's address removes it from that device.
const POLICY = {'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'};
const CARRIERS = ['document','iframe','worker','sharedworker'];
const NO_BODY = [101,204,205,304];

// Which requests are answered here: this site's own pages and worker scripts.
function carries(request,origin) {
  if (request.method !== 'GET' || !CARRIERS.includes(request.destination)) return false;
  try { return new URL(request.url).origin === origin; } catch { return false; }
}
// The response as it came, with the two headers. A response that cannot be read (a redirect to follow, an opaque
// one) goes back untouched.
async function isolated(request,fetcher) {
  const response = await fetcher(request);
  if (!response || response.status === 0 || response.type === 'opaque' || response.type === 'opaqueredirect') return response;
  const headers = new Headers(response.headers);
  for (const [name,value] of Object.entries(POLICY)) headers.set(name,value);
  return new Response(NO_BODY.includes(response.status) ? null : response.body,{status:response.status,statusText:response.statusText,headers});
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function' && typeof self.skipWaiting === 'function') {
  self.addEventListener('install',() => self.skipWaiting());
  self.addEventListener('activate',event => event.waitUntil(self.clients.claim()));
  self.addEventListener('fetch',event => {
    if (!carries(event.request,self.location.origin)) return;
    // Whatever goes wrong here, the page must still arrive: the plain request is the fallback.
    event.respondWith(isolated(event.request,request => fetch(request)).catch(() => fetch(event.request)));
  });
}
// (scripts/check_isolation.mjs reads the two functions from here)
if (typeof globalThis !== 'undefined') globalThis.NorskIsolation = {carries,isolated,POLICY};
