/* DEF — service worker: cache everything so the installed app runs offline.
   Bump VERSION whenever game files change (or players keep the old cache). */
const VERSION = 'def-v11';
const FILES = [
  './', './index.html', './style.css', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  './src/Config.js', './src/AssetLoader.js', './src/Camera.js', './src/PostFX.js', './src/Sprites3D.js', './src/ParticleSystem.js', './src/Projectile.js',
  './src/Weapon.js', './src/Tower.js', './src/Enemy.js', './src/UI.js', './src/main.js',
  './assets/sprites3d/manifest.js', './assets/sprites3d/page0.png',
  './assets/images/environment/Map.webp',
  './assets/images/tower/tower_tier0.png', './assets/images/tower/tower_tier1.png', './assets/images/tower/tower_tier2.png', './assets/images/tower/tower_tier3.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // network first (fresh updates), fall back to cache when offline
  e.respondWith(
    fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
