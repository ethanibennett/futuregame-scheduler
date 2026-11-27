// play.futurega.me's "your turn" switch: what the lobby's Turn alerts panel shows for each browser and server
// answer (utils/play-push.js), and the /table/<id> address a notification opens (utils/play-tables.js).
import test from 'node:test';
import assert from 'node:assert/strict';

// Both modules reach the API helper, which reads window at load.
globalThis.window = globalThis.window || { location: { origin: 'https://play.futurega.me' } };
const { pushSupport, turnPushState, keyBytes } = await import('../play-push.js');
const { tableFromPath } = await import('../play-tables.js');

const browser = ({ ua = 'Mozilla/5.0 (Windows NT 10.0)', push = true, standalone = false, platform = 'Win32', touch = 0 } = {}) => {
  const nav = { userAgent: ua, platform, maxTouchPoints: touch, ...(push ? { serviceWorker: {} } : {}), ...(standalone ? { standalone: true } : {}) };
  return { navigator: nav, ...(push ? { PushManager: function PushManager() {}, Notification: function Notification() {} } : {}), matchMedia: () => ({ matches: standalone }) };
};
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

test('a desktop browser with web push can turn alerts on and off', () => {
  const support = pushSupport(browser());
  assert.deepEqual(support, { supported: true, ios: false, standalone: false });
  assert.equal(turnPushState({ support, permission: 'default', key: 'BKey', subscribed: false }), 'off');
  assert.equal(turnPushState({ support, permission: 'granted', key: 'BKey', subscribed: true }), 'on');
  // Granted, but the server does not hold this browser for this account (another account's, or pruned): off.
  assert.equal(turnPushState({ support, permission: 'granted', key: 'BKey', subscribed: false }), 'off');
});

test('nothing is shown until the server answers, nor when it cannot push', () => {
  const support = pushSupport(browser());
  assert.equal(turnPushState({ support, permission: 'default', key: undefined, subscribed: false }), 'hidden');
  assert.equal(turnPushState({ support, permission: 'default', key: null, subscribed: false }), 'hidden');
});

test('notifications refused for the site: blocked, even if the server still lists the browser', () => {
  const support = pushSupport(browser());
  assert.equal(turnPushState({ support, permission: 'denied', key: 'BKey', subscribed: true }), 'blocked');
});

test('an iPhone in a Safari tab is told to add the page to the Home Screen; from the Home Screen it can subscribe', () => {
  const tab = pushSupport(browser({ ua: IPHONE, push: false, platform: 'iPhone', touch: 5 }));
  assert.deepEqual(tab, { supported: false, ios: true, standalone: false });
  assert.equal(turnPushState({ support: tab, permission: 'default', key: 'BKey', subscribed: false }), 'install');
  const home = pushSupport(browser({ ua: IPHONE, push: true, standalone: true, platform: 'iPhone', touch: 5 }));
  assert.equal(turnPushState({ support: home, permission: 'default', key: 'BKey', subscribed: false }), 'off');
  // An iPad asking for the desktop site says MacIntel with touch points.
  assert.equal(pushSupport(browser({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', push: false, platform: 'MacIntel', touch: 5 })).ios, true);
});

test('a browser with no web push (an in-app browser) says so', () => {
  const support = pushSupport(browser({ push: false }));
  assert.equal(turnPushState({ support, permission: 'default', key: 'BKey', subscribed: false }), 'unsupported');
});

test('the VAPID key becomes the bytes pushManager.subscribe takes', () => {
  // 65 bytes, an uncompressed P-256 point, as web-push generates them.
  const bytes = Uint8Array.from({ length: 65 }, (_, i) => (i * 37 + 4) % 256);
  const b64url = Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.deepEqual([...keyBytes(b64url)], [...bytes]);
});

test('a notification opens play.futurega.me/table/<id>; nothing else reads as a table', () => {
  assert.equal(tableFromPath('/table/3f9a0c1d2e4b5a69'), '3f9a0c1d2e4b5a69');
  assert.equal(tableFromPath('/table/3f9a0c1d2e4b5a69/'), '3f9a0c1d2e4b5a69');
  for (const p of ['/', '/join/abcdefghijklmnopqrst', '/table/', '/table/a/b', '/tables/x', '/table/<script>']) assert.equal(tableFromPath(p), null, p);
});
