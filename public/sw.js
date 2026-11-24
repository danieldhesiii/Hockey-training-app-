// Build replaces both tokens. Same-origin GETs only; auth and API responses never cached.
const CACHE='shift-__BUILD_VERSION__';
const ASSETS=__PRECACHE_FILES__;
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('shift-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})());});
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  const url=new URL(event.request.url);
  if(url.pathname.includes('/auth/')||url.pathname.includes('/api/'))return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).then(r=>r.ok?r:caches.match('./index.html')).catch(()=>caches.match('./index.html')));return;
  }
  event.respondWith(caches.match(event.request,{ignoreSearch:true}).then(cached=>cached||fetch(event.request)));
});
