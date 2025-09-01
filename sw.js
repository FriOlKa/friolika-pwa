const CACHE_NAME = 'friolika-v7';
const ASSETS = [
  'index.html', 'styles.css', 'app.js', 'sw.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-icon-180.png'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k))))
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(
    fetch(req).then(resp => { const clone = resp.clone(); caches.open(CACHE_NAME).then(c => c.put(req, clone)); return resp; })
              .catch(() => caches.match(req))
  );
});
