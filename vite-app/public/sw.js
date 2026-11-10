// Service worker for futurega.me (registered when an app admin turns on web push, App.jsx).
// Handles offline caching + push notifications. The app's code and styles are Vite's hashed
// /assets/* files, cached as they are first fetched (the fetch handler below).

// v6 (2026-11-10): a new name, so activate drops v5's copies of the CDN scripts it no longer fetches.
const CACHE_NAME = 'wsop-scheduler-v6';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

// Install — cache app shell
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      // Cache local assets (fail silently for missing icons)
      return Promise.allSettled(
        APP_SHELL.map(function(url) { return cache.add(url); })
      );
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// Activate — clean up old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(name) { return name !== CACHE_NAME; })
          .map(function(name) { return caches.delete(name); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Fetch — network-first for API/HTML, cache-first for static assets
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Dev mode: never cache anything on localhost. Vite re-hashes optimized deps
  // across restarts (e.g. /node_modules/.vite/deps/react.js?v=<hash>), and a
  // stale cached copy becomes a second React instance → "Invalid hook call".
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return;

  // Belt-and-suspenders: bypass Vite-internal paths even on non-localhost
  // (e.g. LAN dev access). These are dev-only; production builds don't emit them.
  if (
    url.pathname.startsWith('/node_modules/.vite/') ||
    url.pathname.startsWith('/@vite/') ||
    url.pathname.startsWith('/@react-refresh') ||
    url.pathname.startsWith('/@id/') ||
    url.pathname.startsWith('/@fs/')
  ) return;

  // API requests — network only (don't cache dynamic data)
  if (url.pathname.startsWith('/api/')) return;

  // HTML navigation — network first, fall back to cache
  var accept = event.request.headers.get('accept') || '';
  if (event.request.mode === 'navigate' || accept.includes('text/html')) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, clone);
        });
        return response;
      }).catch(function() {
        return caches.match(event.request).then(function(cached) {
          return cached || caches.match('/');
        });
      })
    );
    return;
  }

  // Static assets — cache first, fall back to network
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        // Cache successful responses
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    }).catch(function() {
      // If both cache and network fail, return a basic offline response for non-critical assets
      return new Response('', { status: 503, statusText: 'Offline' });
    })
  );
});

// ── Push notifications ──
self.addEventListener('push', function(event) {
  var data = { title: 'futurega.me', body: 'New notification' };
  try {
    data = event.data.json();
  } catch (e) {
    data.body = event.data ? event.data.text() : 'New notification';
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'futurega.me', {
      body: data.body || '',
      icon: data.icon || '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'default',
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          // A deep link (anything beyond '/') must actually navigate — focusing alone would
          // drop the /?find= query a new-series tap carries.
          if (url !== '/' && 'navigate' in client) {
            return client.navigate(url).then(function (c) { return c && c.focus ? c.focus() : c; });
          }
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
