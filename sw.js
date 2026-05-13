// Service worker — minimal cache shell + offline fallback.
//
// Strategi:
//   - HTML-sider: network-first med cache-fallback (innhold endrer seg, vi vil
//     ha fersk versjon når nettet er der, men noe å vise når det ikke er det).
//   - Statiske assets (/assets/*): cache-first med revalidering i bakgrunnen.
//   - API-kall (/api/*): aldri cached — vi vil ikke vise stale booking-data.
//
// Cache-versjon bumpes når vi vil tvinge ny precache (bumpes ved deploy).

var CACHE_VERSION = 'nailed-v29';
var SHELL = [
  '/',
  '/utforsk',
  '/styles.css',
  '/assets/logo-wordmark.svg?v=6',
  '/assets/logo-mark.svg',
  '/assets/footer.js',
  '/assets/bottom-nav.js',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(SHELL).catch(function () {
        // Hvis én asset mangler under install, ikke feil hele SW-en.
        return null;
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_VERSION) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // API: aldri cache — booking/auth/chat må alltid være ferskt.
  if (url.pathname.startsWith('/api/')) return;

  // Cross-origin (Cloudflare R2, Lucide CDN osv.): la nettleseren håndtere.
  if (url.origin !== self.location.origin) return;

  // HTML-navigasjon: network-first med cache-fallback for offline.
  var isHtml = req.mode === 'navigate' ||
               (req.headers.get('accept') || '').indexOf('text/html') !== -1;
  if (isHtml) {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); }).catch(function () {});
        return res;
      }).catch(function () {
        return caches.match(req).then(function (cached) {
          return cached || caches.match('/');
        });
      })
    );
    return;
  }

  // CSS og JS-assets endrer ofte ved deploy — network-first så bruker
  // alltid får fersk versjon når nettet er tilgjengelig. Cache er kun
  // fallback ved offline. Bilder og ikoner bruker fortsatt cache-first.
  var isLiveAsset = url.pathname === '/styles.css' ||
                    (url.pathname.startsWith('/assets/') && /\.(?:js|css)$/i.test(url.pathname));
  if (isLiveAsset) {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  // Andre statiske assets (bilder, ikoner, fonts): cache-first, oppdater i bakgrunnen.
  event.respondWith(
    caches.match(req).then(function (cached) {
      var fetchPromise = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return res;
      }).catch(function () { return cached; });
      return cached || fetchPromise;
    })
  );
});
