'use strict';
/*
 * Players' cash locations (owner, 2026-11-24: "Bring the cash tab online for non-admin users", each player with a
 * location of their own). The cash watcher polls the rooms around ONE location, the owner's, which the app's admins
 * steer from the Cash tab, exactly as before. A player's pick is kept here instead and the watcher is sent only the
 * set of points, each rounded to 0.1° (about 7 miles) with no user id and no label (PUT /api/player-locations). It
 * polls the union of their rooms, and every read a player makes goes up with `near=` their own (rounded) point, so
 * they see the rooms around them and nobody else's.
 *
 *   cash_locations (user_id, lat, lon, radius_miles, label, updated_at, seen_at)
 *
 * A point is sent while its player opened the Cash tab in the last 14 days or has a cash alert on, so the watcher
 * stops polling the rooms of someone who stopped looking; the set is sent again hourly to drop them, and at once
 * when a player comes back. Only one instance sends (where RENDER is set; CASH_PLAYER_SYNC=1|0 overrides): this box
 * and every scratch server have their own databases and must never overwrite production's set.
 */

const RADIUS_MAX = 150;          // the watcher holds a player's search to this too (src/config/player-locations.ts)
const ACTIVE_DAYS = 14;
const DAY = 24 * 3600 * 1000;
const TOUCH_EVERY = 3600 * 1000; // seen_at is written at most hourly per player

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS cash_locations (
    user_id INTEGER PRIMARY KEY,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    radius_miles INTEGER NOT NULL,
    label TEXT,
    updated_at INTEGER NOT NULL,
    seen_at INTEGER NOT NULL
  )`);
}

function one(db, sql, p) {
  const st = db.prepare(sql);
  try { st.bind(p || []); return st.step() ? st.getAsObject() : null; } finally { st.free(); }
}
function all(db, sql, p) {
  const st = db.prepare(sql);
  try { st.bind(p || []); const out = []; while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); }
}

/** A picked location as stored: a place, a whole 5..150 mile radius, a label of 80 characters at most; else null. */
function normalize(raw) {
  const r = raw || {};
  const lat = Number(r.lat), lon = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  let radius = Math.round(Number(r.radiusMiles));
  if (!Number.isFinite(radius) || radius <= 0) radius = 100;
  radius = Math.min(RADIUS_MAX, Math.max(5, radius));
  const label = String(r.label == null ? '' : r.label).trim().slice(0, 80) || 'Location';
  return { lat, lon, radiusMiles: radius, label };
}

const round1 = (x) => Math.round(Number(x) * 10) / 10;
/** What the watcher is told of a player's location: the point to 0.1°, and the radius. */
const pointOf = (row) => ({ lat: round1(row.lat), lon: round1(row.lon), radiusMiles: Number(row.radius_miles) });
const pointKey = (p) => `${p.lat}|${p.lon}|${p.radiusMiles}`;
const nearParam = (row) => { const p = pointOf(row); return `${p.lat},${p.lon},${p.radiusMiles}`; };

const get = (db, userId) => one(db, 'SELECT * FROM cash_locations WHERE user_id = ?', [userId]);

function save(db, userId, loc, now = Date.now()) {
  db.run(`INSERT INTO cash_locations (user_id, lat, lon, radius_miles, label, updated_at, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET lat = excluded.lat, lon = excluded.lon, radius_miles = excluded.radius_miles,
            label = excluded.label, updated_at = excluded.updated_at, seen_at = excluded.seen_at`,
  [userId, loc.lat, loc.lon, loc.radiusMiles, loc.label, now, now]);
  return get(db, userId);
}

/**
 * The player opened the Cash tab: seen_at moves on (at most hourly). Returns 'revived' when their point had
 * dropped out of the set sent to the watcher (so it must be sent again), true when written, false when not.
 */
function touch(db, userId, now = Date.now()) {
  const row = get(db, userId);
  if (!row || now - Number(row.seen_at) < TOUCH_EVERY) return false;
  const revived = now - Number(row.seen_at) > ACTIVE_DAYS * DAY && !hasAlert(db, userId);
  db.run('UPDATE cash_locations SET seen_at = ? WHERE user_id = ?', [now, userId]);
  return revived ? 'revived' : true;
}

function hasAlert(db, userId) {
  try { return !!one(db, 'SELECT 1 AS x FROM cash_alerts WHERE user_id = ? AND on_ = 1 LIMIT 1', [userId]); } catch (_) { return false; }
}

/** The points to poll for: players seen in the last 14 days or with an alert on, rounded and once each. */
function activePoints(db, now = Date.now()) {
  let rows;
  try {
    rows = all(db, `SELECT lat, lon, radius_miles FROM cash_locations
                    WHERE seen_at >= ? OR user_id IN (SELECT user_id FROM cash_alerts WHERE on_ = 1)`, [now - ACTIVE_DAYS * DAY]);
  } catch (_) {
    rows = all(db, 'SELECT lat, lon, radius_miles FROM cash_locations WHERE seen_at >= ?', [now - ACTIVE_DAYS * DAY]);
  }
  const byKey = new Map();
  for (const r of rows) { const p = pointOf(r); byKey.set(pointKey(p), p); }
  return [...byKey.values()].sort((a, b) => a.lat - b.lat || a.lon - b.lon || a.radiusMiles - b.radiusMiles);
}

/** Whether this instance sends the set to the watcher: where RENDER is set, unless CASH_PLAYER_SYNC says. */
function syncDecision(env = process.env) {
  const v = env.CASH_PLAYER_SYNC;
  if (v === '1') return { on: true, why: 'CASH_PLAYER_SYNC=1' };
  if (v === '0') return { on: false, why: 'CASH_PLAYER_SYNC=0' };
  if (v != null && v !== '') return { on: false, why: `CASH_PLAYER_SYNC=${v} is not 1 or 0` };
  return env.RENDER ? { on: true, why: 'RENDER is set' } : { on: false, why: 'not on Render' };
}

/**
 * The set's trip to the watcher. `put(points)` resolves to the replica's answer (or null), `fetchState()` to
 * GET /api/player-locations (or null). A change is sent 1.5 s after the last one (a radius typed digit by digit is
 * one send), never twice the same set, and again every hour so expired points drop and a replica that lost its
 * file is filled again. `state()` is cached for a second: a switching player's page asks every second.
 */
function createSync({ getDb, put, fetchState, on, log = () => {} }) {
  let timer = null, lastKey = null, cached = null, hourly = null;
  const send = async () => {
    timer = null;
    if (!on) return;
    const points = activePoints(getDb());
    const key = JSON.stringify(points);
    if (key === lastKey) return;
    try {
      const body = await put(points);
      if (body) { lastKey = key; cached = { at: Date.now(), body }; log(`sent ${points.length} player location${points.length === 1 ? '' : 's'}`); }
    } catch (err) { log(`send failed: ${err && err.message}`); }
  };
  return {
    on,
    schedule(ms = 1500) {
      if (!on) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { send().catch(() => {}); }, ms);
      if (timer.unref) timer.unref();
    },
    async state() {
      if (cached && Date.now() - cached.at < 1000) return cached.body;
      try { const s = await fetchState(); if (s) cached = { at: Date.now(), body: s }; return s; } catch (_) { return null; }
    },
    start() {
      if (!on || hourly) return;
      this.schedule(5000);
      hourly = setInterval(() => { lastKey = null; send().catch(() => {}); }, 3600 * 1000);
      if (hourly.unref) hourly.unref();
    },
    flush: send, // for tests
  };
}

/** What GET /api/cash/location answers a player: their own pick (exact), and whether the watcher has its rooms yet. */
function view(row, state) {
  const applied = state && Array.isArray(state.applied) ? state.applied : null;
  const pending = !!state && !(applied && applied.includes(pointKey(pointOf(row))));
  return {
    lat: Number(row.lat), lon: Number(row.lon), radiusMiles: Number(row.radius_miles), label: row.label || 'Location',
    pending, requested: { label: row.label || 'Location' }, own: true,
  };
}

const PLAYER_READS = new Set(['/current', '/history', '/venues', '/unusual', '/day']);
const EMPTY = { '/current': () => ({ ts: new Date().toISOString(), venues: [], needsLocation: true }),
  '/history': () => ({ rows: [] }), '/venues': () => ({ venues: [] }), '/unusual': () => ({ venues: [] }), '/day': () => ({}) };

/**
 * A player's request under /api/cash (server.js answers admins as before, and /games for everyone from its cache).
 *   GET  /location      their pick, with `pending` until the watcher polls its rooms ({} before any pick)
 *   POST /location      a new pick: stored, the set sent to the watcher
 *   GET  /current /history /venues /unusual /day   upstream with near= their point; empty with no pick
 *   GET  /heatmap       upstream as is (one room's game)
 * deps: { getDb, saveDatabase, sync, upstream(pathAndQuery) -> Promise<Response>, allowWrite(userId) -> bool }
 */
function createPlayerHandler({ getDb, saveDatabase, sync, upstream, allowWrite = () => true }) {
  const pipe = async (res, pathAndQuery) => {
    let r;
    try { r = await upstream(pathAndQuery); } catch (err) { return res.status(503).json({ error: 'cash watcher offline' }); }
    if (r.status === 401) return res.status(502).json({ error: 'cash watcher rejected the session' });
    const body = Buffer.from(await r.arrayBuffer());
    const type = r.headers.get('content-type');
    if (type) res.type(type);
    return res.status(r.status).send(body);
  };
  return async function handle(req, res, sub) {
    const uid = req.user.id;
    const [path, qs = ''] = String(sub || '/').split('?');
    const db = getDb();
    if (path === '/location') {
      if (req.method === 'GET') {
        const row = get(db, uid);
        if (!row) return res.json({});
        const t = touch(db, uid);
        if (t) { await saveDatabase(); if (t === 'revived') sync.schedule(0); }
        return res.json(view(row, await sync.state()));
      }
      if (req.method === 'POST') {
        if (!allowWrite(uid)) return res.status(429).json({ error: 'Too many location changes. Try again in a few minutes.' });
        const loc = normalize(req.body);
        if (!loc) return res.status(400).json({ error: 'A location needs a latitude and longitude.' });
        const row = save(db, uid, loc);
        await saveDatabase();
        sync.schedule();
        const v = view(row, null);
        return res.json({ ...v, pending: sync.on });
      }
      return res.status(405).json({ error: 'method not allowed' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'method not allowed' });
    if (path === '/heatmap') return pipe(res, `/api/heatmap${qs ? '?' + qs : ''}`);
    if (!PLAYER_READS.has(path)) return res.status(404).json({ error: 'not found' });
    const row = get(db, uid);
    if (!row) return res.json(EMPTY[path]());
    const t = touch(db, uid);
    if (t) { await saveDatabase(); if (t === 'revived') sync.schedule(0); }
    const q = new URLSearchParams(qs);
    q.set('near', nearParam(row));
    return pipe(res, `/api${path}?${q.toString()}`);
  };
}

/** A small per-player limiter for location writes: `max` in `windowMs`. */
function createWriteLimiter({ max = 30, windowMs = 10 * 60 * 1000 } = {}) {
  const hits = new Map();
  return (userId) => {
    const now = Date.now();
    const list = (hits.get(userId) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) { hits.set(userId, list); return false; }
    list.push(now);
    hits.set(userId, list);
    return true;
  };
}

module.exports = {
  migrate, normalize, pointOf, pointKey, nearParam, get, save, touch, activePoints, syncDecision, createSync, view,
  createPlayerHandler, createWriteLimiter, RADIUS_MAX, ACTIVE_DAYS,
};
