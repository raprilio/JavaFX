/* Service worker: cache-first HANYA untuk aset statis (css/js/gambar/font).
   Halaman & API selalu diambil dari jaringan agar data ujian tidak pernah basi. */
const CACHE = 'sites-static-v2';
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    const isStatic = /\.(css|js|png|jpg|jpeg|webp|svg|woff2?)$/i.test(url.pathname) && !url.pathname.includes('/api/');
    if (!isStatic) return;
    e.respondWith(caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && (res.type === 'basic' || res.type === 'cors')) cache.put(req, res.clone());
        return res;
    }));
});
