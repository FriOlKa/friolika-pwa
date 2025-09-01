
const CACHE_NAME='friolika-v14';
const ASSETS=['index.html','styles.css','app.js','sw.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/apple-icon-180.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE_NAME&&caches.delete(k))))));
self.addEventListener('fetch',e=>{const r=e.request; if(r.mode==='navigate'){e.respondWith(fetch(r).catch(()=>caches.match('index.html')));return;} e.respondWith(fetch(r).then(resp=>{const cl=resp.clone(); caches.open(CACHE_NAME).then(c=>c.put(r,cl)); return resp;}).catch(()=>caches.match(r)));});
