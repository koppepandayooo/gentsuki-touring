// アプリ本体はネット優先・オフライン時のみキャッシュ。地図タイルやAPIは触らない。
const CACHE = 'gt-v4';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'data/regulations.json', 'data/road-names.json', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request)));
});
