'use strict';
/*
 * New near you, and rooms you follow (Features 8, 2026-11-11).
 *
 *   room_follows (user_id, room, created_at): a room by its name as the feed gives it (tournaments.property,
 *     else the series title). Following is from the "New near you" card on the Schedule.
 *
 * When a feed run brings a series the database did not hold before, each player following its room gets one
 * line in the bell and, where they allow it, a push (kind 'follows', capped per day). The card itself is
 * worked out in the browser from the list it already has (tournaments.created_at survives the hourly
 * upsert, so a series' first row says when it first arrived).
 */

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS room_follows (
    user_id INTEGER NOT NULL,
    room TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, room)
  )`);
}

function all(db, sql, p) {
  const st = db.prepare(sql);
  try { st.bind(p || []); const out = []; while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); }
}

const key = (s) => String(s || '').trim().toLowerCase();

function venuesNow(db) {
  try { return new Set(all(db, "SELECT DISTINCT venue FROM tournaments WHERE source_pdf IN ('mtt-feed', 'online-feed')").map((r) => r.venue)); }
  catch (_) { return new Set(); }
}

/** The series this run brought, with their room and dates: [{ venue, room, first, last, count }]. */
function newSeries(db, before) {
  if (!before) return [];
  const out = [];
  for (const v of venuesNow(db)) {
    if (before.has(v)) continue;
    const r = all(db, "SELECT MIN(date) AS first, MAX(date) AS last, COUNT(*) AS n, MAX(property) AS room FROM tournaments WHERE venue = ? AND source_pdf IN ('mtt-feed', 'online-feed')", [v])[0];
    out.push({ venue: v, room: (r && r.room) || v, first: r && r.first, last: r && r.last, count: r ? Number(r.n) : 0 });
  }
  return out;
}

/** [{ userId, series }] for each follower of each new series' room. */
function followersOf(db, series) {
  const out = [];
  if (!series.length) return out;
  const follows = all(db, 'SELECT user_id, room FROM room_follows');
  for (const s of series) {
    const names = new Set([key(s.room), key(s.venue)]);
    for (const f of follows) if (names.has(key(f.room))) out.push({ userId: f.user_id, series: s });
  }
  return out;
}

function mountRoutes(app, { getDb, saveDatabase, authenticateToken, requireRegistered }) {
  app.get('/api/room-follows', authenticateToken, requireRegistered, (req, res) => {
    res.json({ rooms: all(getDb(), 'SELECT room FROM room_follows WHERE user_id = ? ORDER BY created_at', [req.user.id]).map((r) => r.room) });
  });
  app.post('/api/room-follows', authenticateToken, requireRegistered, async (req, res) => {
    const room = String((req.body && req.body.room) || '').trim().slice(0, 120);
    if (!room) return res.status(400).json({ error: 'Which room?' });
    getDb().run('INSERT OR IGNORE INTO room_follows (user_id, room, created_at) VALUES (?, ?, ?)', [req.user.id, room, Date.now()]);
    await saveDatabase();
    res.json({ ok: true });
  });
  app.delete('/api/room-follows', authenticateToken, requireRegistered, async (req, res) => {
    const room = String((req.body && req.body.room) || req.query.room || '').trim();
    getDb().run('DELETE FROM room_follows WHERE user_id = ? AND LOWER(room) = LOWER(?)', [req.user.id, room]);
    await saveDatabase();
    res.json({ ok: true });
  });
}

module.exports = { migrate, venuesNow, newSeries, followersOf, mountRoutes };
