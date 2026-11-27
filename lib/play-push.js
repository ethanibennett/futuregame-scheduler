'use strict';
/*
 * "Your turn" pushes for play.futurega.me (2026-11-26; docs/play-money-platform.md §15). With eight at a table, waiting
 * for your turn is the norm, and after two timeouts a seat is sat out: a player whose table is not in front of them
 * (another tab, a locked phone) is told by a web push from the play origin, whose own service worker
 * (vite-app/public/play-sw.js, served on the play host only) shows it and opens the table when tapped.
 *
 * Nothing of the app's: these subscriptions are the play origin's, kept in their own table, never in
 * push_subscriptions (futurega.me's), and the app's senders never read them. The VAPID keys are the same.
 *
 *   play_push_subs (endpoint PRIMARY KEY, user_id, keys_p256dh, keys_auth, created_at): one row per browser that opted
 *                  in on the play page; re-keyed to whoever opts in on it last; removed on Turn off, on sign-out, when
 *                  the browser refuses notifications, and when the push service says the subscription is gone (404/410).
 *   play_push_log  (user_id, table_id, hand_no, at): a push sent, so a player hears at most once a hand.
 *
 * Who is away is the tables service's call (lib/tables/service.mjs onTurn): it reports a turn only when none of the
 * player's streams at that table is on a visible page. This side sends one push per hand per player, to the browsers
 * that player opted in, and nothing for a table they are not a member of.
 *
 * Delivery is gated as the backer and player pushes are: on where RENDER is set, PLAY_DELIVERY=1|0 overrides, anything
 * else is off, and every boot logs the decision. A scratch server or this box never pushes.
 */

const MAX_DEVICES = 10;          // browsers one account keeps subscribed (the oldest goes)
const LOG_KEEP_MS = 2 * 864e5;   // a hand's push is remembered for two days: plenty for the outbox's retries

function deliveryDecision(env = process.env) {
  const v = env.PLAY_DELIVERY;
  if (v === '1') return { on: true, why: 'PLAY_DELIVERY=1' };
  if (v === '0') return { on: false, why: 'PLAY_DELIVERY=0' };
  if (v != null && v !== '') return { on: false, why: `PLAY_DELIVERY=${v} is not 1 or 0` };
  return env.RENDER ? { on: true, why: 'RENDER is set' } : { on: false, why: 'not production (RENDER unset)' };
}

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS play_push_subs (
    endpoint TEXT PRIMARY KEY, user_id INTEGER NOT NULL, keys_p256dh TEXT NOT NULL, keys_auth TEXT NOT NULL, created_at INTEGER NOT NULL)`);
  db.run('CREATE INDEX IF NOT EXISTS idx_play_push_subs_user ON play_push_subs(user_id)');
  db.run(`CREATE TABLE IF NOT EXISTS play_push_log (
    user_id INTEGER NOT NULL, table_id TEXT NOT NULL, hand_no INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, table_id, hand_no))`);
}

const rows = (db, sql, params) => {
  const st = db.prepare(sql);
  const out = [];
  try { st.bind(params || []); while (st.step()) out.push(st.getAsObject()); } finally { st.free(); }
  return out;
};

/** A browser's PushSubscription (its toJSON()), checked: an https endpoint and both keys. Null if it is not one. */
function readSubscription(s) {
  if (!s || typeof s !== 'object') return null;
  const endpoint = String(s.endpoint || '');
  const keys = s.keys || {};
  let url;
  try { url = new URL(endpoint); } catch (_) { return null; }
  if (url.protocol !== 'https:' || endpoint.length > 1000) return null;
  const p256dh = String(keys.p256dh || ''), auth = String(keys.auth || '');
  if (!/^[A-Za-z0-9_=-]{16,200}$/.test(p256dh) || !/^[A-Za-z0-9_=-]{8,100}$/.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

function subscribe(db, userId, sub, now = Date.now()) {
  db.run('DELETE FROM play_push_subs WHERE endpoint = ?', [sub.endpoint]);
  db.run('INSERT INTO play_push_subs (endpoint, user_id, keys_p256dh, keys_auth, created_at) VALUES (?, ?, ?, ?, ?)',
    [sub.endpoint, userId, sub.p256dh, sub.auth, now]);
  const mine = rows(db, 'SELECT endpoint FROM play_push_subs WHERE user_id = ? ORDER BY created_at DESC', [userId]);
  for (const r of mine.slice(MAX_DEVICES)) db.run('DELETE FROM play_push_subs WHERE endpoint = ?', [r.endpoint]);
}

const isSubscribed = (db, userId, endpoint) =>
  !!endpoint && rows(db, 'SELECT 1 AS x FROM play_push_subs WHERE user_id = ? AND endpoint = ?', [userId, String(endpoint)]).length > 0;

/**
 * deps: { getDb, saveDatabase, webpush, vapidPublicKey() }. sendTurn never throws; it resolves to { sent, why, results? }.
 */
function createPlayPush(deps) {
  const vapidKey = () => (deps.vapidPublicKey ? deps.vapidPublicKey() : process.env.VAPID_PUBLIC_KEY) || null;

  async function sendTurn({ userId, tableId, tableName, handNo, ttl = 120 }) {
    try {
      const g = deliveryDecision();
      if (!g.on) return { sent: false, why: 'delivery off: ' + g.why };
      if (!vapidKey()) return { sent: false, why: 'web push is not configured' };
      const db = deps.getDb();
      const uid = Number(userId);
      const subs = rows(db, 'SELECT endpoint, keys_p256dh, keys_auth FROM play_push_subs WHERE user_id = ?', [uid]);
      if (!subs.length) return { sent: false, why: 'not subscribed' };
      // Once a hand: the row is written before the first await, so a report sent twice (the outbox retries) finds it.
      const now = Date.now();
      if (rows(db, 'SELECT 1 AS x FROM play_push_log WHERE user_id = ? AND table_id = ? AND hand_no = ?', [uid, String(tableId), Number(handNo)]).length) {
        return { sent: false, why: 'already told this hand' };
      }
      db.run('INSERT INTO play_push_log (user_id, table_id, hand_no, at) VALUES (?, ?, ?, ?)', [uid, String(tableId), Number(handNo), now]);
      db.run('DELETE FROM play_push_log WHERE at < ?', [now - LOG_KEEP_MS]);
      const payload = JSON.stringify({ title: tableName || 'Your table', body: 'Your turn', url: `/table/${tableId}`, tableId, tag: `turn-${tableId}` });
      // A turn is worth telling only while its clock runs (TTL); a newer turn at the same table replaces one the
      // phone has not fetched yet (Topic: at most 32 URL-safe characters; a table id is 16 hex).
      const opts = { TTL: Math.max(30, Math.min(600, Math.round(ttl))), urgency: 'high', topic: `turn${String(tableId).replace(/[^A-Za-z0-9_-]/g, '')}`.slice(0, 32), timeout: 8000 };
      const results = [];
      for (const s of subs) {
        try {
          await deps.webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.keys_p256dh, auth: s.keys_auth } }, payload, opts);
          results.push({ ok: true });
        } catch (err) {
          const status = err && err.statusCode;
          results.push({ ok: false, status: status || null });
          if (status === 404 || status === 410) db.run('DELETE FROM play_push_subs WHERE endpoint = ?', [s.endpoint]);
        }
      }
      if (deps.saveDatabase) await deps.saveDatabase();
      return { sent: results.some((r) => r.ok), why: results.some((r) => r.ok) ? 'delivered' : 'every device refused', results };
    } catch (err) {
      console.error('[tables] your-turn push failed:', err && err.message);
      return { sent: false, why: 'error' };
    }
  }

  return { sendTurn, vapidKey };
}

/**
 * The play page's switch (signed in, registered; mounted under the tables' own gate by lib/play-tables.js):
 *   GET  /api/tables/push?endpoint=   -> { key, subscribed, delivery }: subscribed = this browser is stored for YOU
 *   POST /api/tables/push        { subscription }  -> stores it (re-keyed to you if another account had it)
 *   POST /api/tables/push/off    { endpoint }      -> removes yours (Turn off, sign-out, notifications refused)
 */
function mountRoutes(app, { getDb, saveDatabase, guard, playPush }) {
  app.get('/api/tables/push', ...guard, (req, res) => {
    res.json({ key: playPush.vapidKey(), subscribed: isSubscribed(getDb(), req.user.id, req.query.endpoint), delivery: deliveryDecision().on });
  });
  app.post('/api/tables/push', ...guard, async (req, res) => {
    const sub = readSubscription((req.body || {}).subscription);
    if (!sub) return res.status(400).json({ error: 'Not a push subscription' });
    subscribe(getDb(), req.user.id, sub);
    await saveDatabase();
    res.json({ ok: true, subscribed: true });
  });
  app.post('/api/tables/push/off', ...guard, async (req, res) => {
    const endpoint = String((req.body || {}).endpoint || '');
    if (!endpoint) return res.status(400).json({ error: 'Which browser?' });
    getDb().run('DELETE FROM play_push_subs WHERE user_id = ? AND endpoint = ?', [req.user.id, endpoint]);
    await saveDatabase();
    res.json({ ok: true, subscribed: false });
  });
}

module.exports = { migrate, mountRoutes, createPlayPush, deliveryDecision, readSubscription, subscribe, isSubscribed };
