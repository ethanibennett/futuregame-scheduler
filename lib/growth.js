'use strict';
/*
 * First-party growth measurement (launch plan, action 5; 2026-10-15). No SDK, no ATT prompt: the
 * server counts what the plan's KPIs need from its own tables.
 *
 *   growth_events  one row per moment that matters, never deleted by the thing it records:
 *                  'signup'    data { ct, landing, ref, src, heard, platform }, the first touch the
 *                              browser kept (vite-app utils/live-page.js rememberSource) and the
 *                              sign-up form's "How did you hear about us?"
 *                  'activated' the first event saved to My Schedule, once per account, so a later
 *                              delete cannot erase it (the plan's activation KPI)
 *   user_days      (user_id, day): an account was active that UTC day (any signed-in request);
 *                  D7 = any day 7-13 after sign-up, D30 = any day 28-34.
 *
 * report(db) is the weekly cohort table: per sign-up week (Monday, UTC), sign-ups, activated within
 * 7 days, D7 and D30 retention (each only once the cohort is old enough to have it), by source.
 * GET /api/admin/growth serves it to app admins.
 */

const HEARD = ['instagram', 'facebook', 'reddit', 'tiktok', 'youtube', 'friend', 'room', 'appstore', 'search', 'press', 'podcast', 'other'];
const DAY = 864e5;

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS growth_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    at INTEGER NOT NULL,
    data TEXT
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_growth_events_user ON growth_events(user_id, kind)');
  db.run(`CREATE TABLE IF NOT EXISTS user_days (
    user_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    PRIMARY KEY (user_id, day)
  )`);
}

const tag = (v, max = 40) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[A-Za-z0-9._-]{1,40}$/.test(s) ? s.slice(0, max) : null;
};
const host = (v) => {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return /^[a-z0-9.-]{1,80}$/.test(s) ? s : null;
};

/** The sign-up's source, from the client's body.source; unknown or malformed fields are dropped. */
function cleanSource(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {
    ct: tag(r.ct), landing: tag(r.landing), ref: host(r.ref), src: tag(r.src),
    heard: HEARD.includes(r.heard) ? r.heard : null,
    platform: ['ios', 'android', 'web'].includes(r.platform) ? r.platform : null,
  };
  for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
  return out;
}

function recordSignup(db, userId, source, now = Date.now()) {
  if (!userId) return;
  db.run('INSERT INTO growth_events (user_id, kind, at, data) VALUES (?, ?, ?, ?)',
    [userId, 'signup', now, JSON.stringify(cleanSource(source))]);
  touchDay(db, userId, now);
}

/** Records `kind` for the account the first time only; true when it wrote. */
function recordOnce(db, userId, kind, data = null, now = Date.now()) {
  if (!userId) return false;
  const r = db.exec('SELECT 1 FROM growth_events WHERE user_id = ? AND kind = ? LIMIT 1', [userId, kind]);
  if (r[0] && r[0].values.length) return false;
  db.run('INSERT INTO growth_events (user_id, kind, at, data) VALUES (?, ?, ?, ?)', [userId, kind, now, data ? JSON.stringify(data) : null]);
  return true;
}

// Active days: one INSERT per account per day, remembered in memory so a busy session costs one write.
const seen = new Set();
let seenDay = '';
function touchDay(db, userId, now = Date.now()) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return;
  const day = new Date(now).toISOString().slice(0, 10);
  if (day !== seenDay) { seen.clear(); seenDay = day; }
  const key = `${id}:${day}`;
  if (seen.has(key)) return;
  seen.add(key);
  try { db.run('INSERT OR IGNORE INTO user_days (user_id, day) VALUES (?, ?)', [id, day]); } catch { /* table not there yet */ }
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
function mondayOf(ms) {
  const d = new Date(ms);
  const back = (d.getUTCDay() + 6) % 7;
  return isoDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back));
}
const rows = (db, sql, p = []) => { const r = db.exec(sql, p); return r[0] ? r[0].values : []; };

/**
 * The weekly cohort table. Accounts with a 'signup' event (every account made since this shipped);
 * older ones have no source and are left out rather than guessed. { weeks: [{ week, signups,
 * activated7, d7, d30, d7Ready, d30Ready, sources: { [source]: signups } }], totals }.
 */
function report(db, { now = Date.now(), weeks = 13 } = {}) {
  const since = now - weeks * 7 * DAY;
  const signups = rows(db, "SELECT user_id, at, data FROM growth_events WHERE kind = 'signup' AND at >= ? ORDER BY at", [since]);
  const activated = new Map(rows(db, "SELECT user_id, at FROM growth_events WHERE kind = 'activated'"));
  const days = new Map();
  for (const [uid, day] of rows(db, 'SELECT user_id, day FROM user_days WHERE day >= ?', [isoDay(since)])) {
    if (!days.has(uid)) days.set(uid, new Set());
    days.get(uid).add(day);
  }
  const activeBetween = (uid, start, from, to) => {
    const set = days.get(uid);
    if (!set) return false;
    for (let k = from; k <= to; k++) if (set.has(isoDay(start + k * DAY))) return true;
    return false;
  };
  const byWeek = new Map();
  for (const [uid, at, data] of signups) {
    let src = {};
    try { src = JSON.parse(data || '{}') || {}; } catch { src = {}; }
    const source = src.ct || src.heard || src.src || (src.ref ? `ref:${src.ref}` : 'unknown');
    const week = mondayOf(at);
    if (!byWeek.has(week)) byWeek.set(week, { week, signups: 0, activated7: 0, d7: 0, d30: 0, d7Ready: 0, d30Ready: 0, sources: {} });
    const w = byWeek.get(week);
    w.signups += 1;
    w.sources[source] = (w.sources[source] || 0) + 1;
    const act = activated.get(uid);
    if (act != null && act - at <= 7 * DAY) w.activated7 += 1;
    if (now - at >= 14 * DAY) { w.d7Ready += 1; if (activeBetween(uid, at, 7, 13)) w.d7 += 1; }
    if (now - at >= 35 * DAY) { w.d30Ready += 1; if (activeBetween(uid, at, 28, 34)) w.d30 += 1; }
  }
  const list = [...byWeek.values()].sort((a, b) => (a.week < b.week ? 1 : -1));
  const totals = list.reduce((t, w) => {
    for (const k of ['signups', 'activated7', 'd7', 'd30', 'd7Ready', 'd30Ready']) t[k] += w[k];
    for (const [s, n] of Object.entries(w.sources)) t.sources[s] = (t.sources[s] || 0) + n;
    return t;
  }, { signups: 0, activated7: 0, d7: 0, d30: 0, d7Ready: 0, d30Ready: 0, sources: {} });
  return { weeks: list, totals };
}

module.exports = { HEARD, migrate, cleanSource, recordSignup, recordOnce, touchDay, report, mondayOf };
