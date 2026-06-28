const CACHE_NAME = 'nukemap-v3.6.0';
const TILE_CACHE = 'nukemap-tiles-v3';
const MAX_TILE_ENTRIES = 2000;
const PRECACHE = [
  './', './index.html', './css/styles.css', './manifest.json',
  './assets/pwa-wide.png', './assets/pwa-mobile.png',
  './js/zipcodes.js', './js/data.js', './js/i18n.js', './js/physics.js', './js/search.js', './js/effects.js',
  './js/animation.js', './js/sound.js', './js/mushroom3d.js', './js/mirv.js',
  './js/shelter.js', './js/compare.js', './js/heatmap.js', './js/extras.js', './js/advanced.js', './js/premium.js', './js/immersive.js', './js/ww3.js', './js/app.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME && k !== TILE_CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isTile = url.hostname.includes('basemaps') || url.hostname.includes('tile') || url.hostname.includes('carto');
  const isCDN = url.hostname.includes('unpkg') || url.hostname.includes('cdnjs') || url.hostname.includes('cloudflare');

  if (isTile) {
    e.respondWith(caches.open(TILE_CACHE).then(cache =>
      cache.match(e.request).then(r => r || fetch(e.request).then(resp => {
        if (resp.ok) {
          cache.put(e.request, resp.clone());
          cache.keys().then(keys => {
            if (keys.length > MAX_TILE_ENTRIES) {
              for (let i = 0; i < keys.length - MAX_TILE_ENTRIES; i++) cache.delete(keys[i]);
            }
          });
        }
        return resp;
      }).catch(() => new Response('', {status: 404})))
    ));
  } else if (isCDN) {
    e.respondWith(caches.open(CACHE_NAME).then(cache =>
      cache.match(e.request).then(r => r || fetch(e.request).then(resp => { if (resp.ok) cache.put(e.request, resp.clone()); return resp; }).catch(() => new Response('', {status: 404})))
    ));
  } else {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).catch(() => new Response('Offline', {status: 503}))));
  }
});
