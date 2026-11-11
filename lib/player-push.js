'use strict';
/*
 * Push to any player (Features 39, 2026-11-11). Until this, the server's senders reached the app admins
 * (sendPushToAdmin, sendApnsToAdmin) and the backer page's own subscribers only: a player heard of a
 * connection request, a swap offer or a group message only by opening the bell.
 *
 *   notification_prefs  (user_id, kind, value): one row per switch the player has moved; a missing
 *                       row is the kind's default. 'group:<id>' = 'off' mutes one group.
 *   player_push_log     (user_id, kind, ref, at): what was sent, so a repeat (the same alert opening
 *                       twice, a re-saved hand) is not sent again, and a kind can be capped per day.
 *
 * Delivery is gated as the backer side is (BACKER_DELIVERY): on where RENDER is set, PLAYER_DELIVERY=1|0
 * overrides, anything else is off. A scratch server or this box never pushes to a player; every boot
 * logs the decision.
 *
 * The devices are the ones the app already registers: push_subscriptions (web push) and apns_tokens
 * (the native app), both keyed by user. A live native token supersedes the same player's Apple web
 * push, as it does for the admins, so the phone is not told twice.
 */

const KINDS = {
  requests: { label: 'Connection requests and group invites', values: ['on', 'off'], def: 'on' },
  swaps: { label: 'Swap offers', values: ['on', 'off'], def: 'on' },
  hands: { label: 'Hands sent to you, and replies on them', values: ['on', 'off'], def: 'on' },
  groups: { label: 'Group messages', values: ['all', 'mentions', 'off'], def: 'mentions' },
  friends: { label: 'Friends bust or bag', values: ['on', 'off'], def: 'off' },
  changes: { label: 'A saved event moves, changes or is cancelled', values: ['on', 'off'], def: 'on' },
  follows: { label: 'New series at rooms you follow', values: ['on', 'off'], def: 'on' },
  cash: { label: 'Your cash game alerts', values: ['on', 'off'], def: 'on' },
  support: { label: 'Replies to problems you report', values: ['on', 'off'], def: 'on' },
};
const DAY_CAP = { cash: 6, follows: 3, friends: 20 };

function deliveryDecision(env = process.env) {
  const v = env.PLAYER_DELIVERY;
  if (v === '1') return { on: true, why: 'PLAYER_DELIVERY=1' };
  if (v === '0') return { on: false, why: 'PLAYER_DELIVERY=0' };
  if (v != null && v !== '') return { on: false, why: `PLAYER_DELIVERY=${v} is not 1 or 0` };
  return env.RENDER ? { on: true, why: 'RENDER is set' } : { on: false, why: 'not production (RENDER unset)' };
}

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS notification_prefs (
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, kind)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS player_push_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT,
    at INTEGER NOT NULL
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_player_push_log ON player_push_log(user_id, kind, at)');
}

function rows(db, sql, params) {
  const st = db.prepare(sql);
  try {
    st.bind(params || []);
    const out = [];
    while (st.step()) out.push(st.getAsObject());
    return out;
  } finally { st.free(); }
}

/** { requests: 'on', groups: 'mentions', …, mutedGroups: [3, 9] } for a player. */
function prefsOf(db, userId) {
  const out = {};
  for (const [k, d] of Object.entries(KINDS)) out[k] = d.def;
  const muted = [];
  for (const r of rows(db, 'SELECT kind, value FROM notification_prefs WHERE user_id = ?', [Number(userId)])) {
    if (KINDS[r.kind] && KINDS[r.kind].values.includes(r.value)) out[r.kind] = r.value;
    const g = /^group:(\d+)$/.exec(r.kind);
    if (g && r.value === 'off') muted.push(Number(g[1]));
  }
  out.mutedGroups = muted;
  return out;
}

/** Sets one switch. Returns an error string for a kind or value it does not know. */
function setPref(db, userId, kind, value) {
  const k = String(kind || '');
  const v = String(value || '');
  if (/^group:\d+$/.test(k)) {
    if (v !== 'off' && v !== 'default') return 'A group is muted (off) or follows the Group messages switch (default)';
    if (v === 'default') db.run('DELETE FROM notification_prefs WHERE user_id = ? AND kind = ?', [Number(userId), k]);
    else db.run('INSERT OR REPLACE INTO notification_prefs (user_id, kind, value) VALUES (?, ?, ?)', [Number(userId), k, v]);
    return null;
  }
  if (!KINDS[k]) return 'Unknown kind of notification';
  if (!KINDS[k].values.includes(v)) return `${KINDS[k].label}: one of ${KINDS[k].values.join(', ')}`;
  db.run('INSERT OR REPLACE INTO notification_prefs (user_id, kind, value) VALUES (?, ?, ?)', [Number(userId), k, v]);
  return null;
}

/** Whether a player wants this push. `mention` says a group message names them. */
function wants(prefs, kind, { groupId = null, mention = false } = {}) {
  if (!KINDS[kind]) return false;
  const v = prefs[kind];
  if (kind === 'groups') {
    if (groupId != null && prefs.mutedGroups.includes(Number(groupId))) return false;
    if (v === 'off') return false;
    if (v === 'mentions') return !!mention;
    return true;
  }
  return v === 'on';
}

/** True when `text` names @username (any case, not inside a longer name). */
function mentions(text, username) {
  if (!text || !username) return false;
  const esc = String(username).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_.-])@${esc}(?![A-Za-z0-9_-])`, 'i').test(String(text));
}

/**
 * The sender. deps: { getDb, saveDatabase, webpush, vapidConfigured(), sendApnsOne(token, env, payload),
 * apnsConfigured() }. send(userId, kind, { title, body, url, groupId, mention, ref }) resolves to
 * { sent, why, results }; it never throws.
 */
function createPlayerPush(deps) {
  const gate = () => deliveryDecision();

  async function deliver(db, userId, { title, body, url, tag }) {
    const results = [];
    let pruned = 0;
    const uid = Number(userId);
    const native = rows(db, 'SELECT token, env FROM apns_tokens WHERE user_id = ?', [uid]);
    if (deps.vapidConfigured && deps.vapidConfigured()) {
      let subs = rows(db, 'SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE user_id = ?', [uid]);
      if (native.length) {
        subs = subs.filter((s) => { try { return new URL(s.endpoint).host !== 'web.push.apple.com'; } catch (_) { return true; } });
      }
      const payload = JSON.stringify({ title, body, url: url || '/', tag: tag || 'player' });
      for (const s of subs) {
        try {
          await deps.webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.keys_p256dh, auth: s.keys_auth } }, payload);
          results.push({ channel: 'web', ok: true });
        } catch (err) {
          results.push({ channel: 'web', ok: false, status: err.statusCode || null });
          if (err.statusCode === 410 || err.statusCode === 404) { db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [s.endpoint]); pruned++; }
        }
      }
    }
    if (native.length && deps.apnsConfigured && deps.apnsConfigured()) {
      const payload = { aps: { alert: { title, body }, sound: 'default' }, url: url || '/', tag: tag || 'player' };
      for (const t of native) {
        const r = await deps.sendApnsOne(t.token, t.env, payload);
        results.push({ channel: 'apns', ok: !!r.ok, status: r.status || null });
        if (r.status === 410 || (r.status === 400 && /BadDeviceToken/i.test(r.data || ''))) {
          db.run('DELETE FROM apns_tokens WHERE token = ?', [t.token]);
          pruned++;
        }
      }
    }
    return { results, pruned };
  }

  async function send(userId, kind, msg = {}) {
    try {
      const g = gate();
      if (!g.on) return { sent: false, why: 'delivery off: ' + g.why };
      const db = deps.getDb();
      if (!userId) return { sent: false, why: 'no player' };
      const prefs = prefsOf(db, userId);
      if (!wants(prefs, kind, msg)) return { sent: false, why: 'switched off' };
      const now = Date.now();
      if (msg.ref) {
        const seen = rows(db, 'SELECT 1 FROM player_push_log WHERE user_id = ? AND kind = ? AND ref = ? LIMIT 1', [Number(userId), kind, String(msg.ref)]);
        if (seen.length) return { sent: false, why: 'already sent' };
      }
      if (DAY_CAP[kind]) {
        const n = rows(db, 'SELECT COUNT(*) AS n FROM player_push_log WHERE user_id = ? AND kind = ? AND at > ?', [Number(userId), kind, now - 864e5]);
        if (n.length && Number(n[0].n) >= DAY_CAP[kind]) return { sent: false, why: 'daily cap' };
      }
      const { results, pruned } = await deliver(db, userId, { title: msg.title || 'futurega.me', body: msg.body || '', url: msg.url, tag: kind });
      db.run('INSERT INTO player_push_log (user_id, kind, ref, at) VALUES (?, ?, ?, ?)', [Number(userId), kind, msg.ref ? String(msg.ref) : null, now]);
      // A month of log is plenty for de-duplication and the daily caps.
      db.run('DELETE FROM player_push_log WHERE at < ?', [now - 31 * 864e5]);
      if (deps.saveDatabase) await deps.saveDatabase();
      return { sent: results.some((r) => r.ok), why: results.length ? 'delivered' : 'no device registered', results, pruned };
    } catch (err) {
      console.error('[push] player send failed:', err && err.message);
      return { sent: false, why: 'error' };
    }
  }

  return { send, gate };
}

/** GET/PUT /api/notification-prefs. */
function mountRoutes(app, { getDb, saveDatabase, authenticateToken, requireRegistered }) {
  app.get('/api/notification-prefs', authenticateToken, requireRegistered, (req, res) => {
    try {
      const prefs = prefsOf(getDb(), req.user.id);
      res.json({
        prefs,
        kinds: Object.entries(KINDS).map(([kind, d]) => ({ kind, label: d.label, values: d.values, def: d.def })),
        delivery: deliveryDecision().on,
      });
    } catch (err) {
      console.error('[push] prefs read failed:', err.message);
      res.status(500).json({ error: 'Could not read your notification settings' });
    }
  });
  app.put('/api/notification-prefs', authenticateToken, requireRegistered, async (req, res) => {
    try {
      const { kind, value } = req.body || {};
      const err = setPref(getDb(), req.user.id, kind, value);
      if (err) return res.status(400).json({ error: err });
      await saveDatabase();
      res.json({ prefs: prefsOf(getDb(), req.user.id) });
    } catch (err) {
      console.error('[push] prefs write failed:', err.message);
      res.status(500).json({ error: 'Could not save that switch' });
    }
  });
}

module.exports = { KINDS, DAY_CAP, deliveryDecision, migrate, prefsOf, setPref, wants, mentions, createPlayerPush, mountRoutes };
