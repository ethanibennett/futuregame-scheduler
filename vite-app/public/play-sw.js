// play.futurega.me's service worker (served on the play host only: server.js PLAY_FILES). It does one thing: show a
// "your turn" push (lib/play-push.js) and open that table when it is tapped. No fetch handler and no cache, so the
// play page loads exactly as it does without it. futurega.me's own worker is public/sw.js, on its own origin.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = { body: event.data ? event.data.text() : '' }; }
  // A browser must show something for every push it is sent, so even a payload it cannot read says "Your turn".
  event.waitUntil(self.registration.showNotification(d.title || 'futurega.me play', {
    body: d.body || 'Your turn',
    tag: d.tag || 'turn',
    renotify: true,
    icon: '/icon-192.png',
    data: { url: d.url || '/', tableId: d.tableId || null },
  }));
});

// A tap: a play page already open is brought forward and opens the table; otherwise the table opens in a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = new URL(data.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const page = open.find((c) => new URL(c.url).origin === self.location.origin);
    if (page) {
      if (data.tableId) page.postMessage({ type: 'open-table', tableId: data.tableId });
      return page.focus();
    }
    return self.clients.openWindow(url);
  })());
});
