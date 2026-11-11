'use strict';
/*
 * Tell me when a saved event moves, changes or leaves the room's schedule (Features 4, 2026-11-11).
 *
 * The feed's hourly upsert overwrote date, time, buy-in and name with no record of the old values, and
 * prune keeps a saved event the feed dropped, so a cancelled event sat on My Schedule unmarked. Now,
 * around each upsert (the local ingest and production's feed-sync receiver):
 *
 *   before(db)                      snapshots every feed row someone has saved
 *   after(db, snap, { carried })    compares: a changed date, time, buy-in or late-reg close is an
 *                                   'alert' change; a new name is quiet. A saved row the feed no longer
 *                                   carries (carried(row) false) counts a miss; the second consecutive
 *                                   miss writes 'gone' (a watcher outage that empties one run must not
 *                                   read as cancelled). Returns the new changes for the caller to notify.
 *
 *   event_changes (id, tournament_id, field, old, new, at)
 *   event_change_seen (user_id, change_id): Got it / Keep
 *   event_feed_miss (tournament_id, misses)
 *
 * GET /api/event-changes lists what the player has not seen for events on their My Schedule.
 */

const FIELDS = ['date', 'time', 'buyin', 'late_reg_end', 'event_name'];
const ALERT = new Set(['date', 'time', 'buyin', 'gone']);
const FEED_TAGS = ['mtt-feed', 'online-feed'];

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS event_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    field TEXT NOT NULL,
    old TEXT,
    new TEXT,
    at INTEGER NOT NULL
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_event_changes_t ON event_changes(tournament_id)');
  db.run(`CREATE TABLE IF NOT EXISTS event_change_seen (
    user_id INTEGER NOT NULL,
    change_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, change_id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS event_feed_miss (
    tournament_id INTEGER PRIMARY KEY,
    misses INTEGER NOT NULL DEFAULT 0
  )`);
}

function all(db, sql, p) {
  const st = db.prepare(sql);
  try { st.bind(p || []); const out = []; while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); }
}

function before(db) {
  try {
    const rows = all(db, `SELECT id, venue, event_number, stable_id, ${FIELDS.join(', ')} FROM tournaments
      WHERE source_pdf IN ('mtt-feed', 'online-feed') AND id IN (SELECT DISTINCT tournament_id FROM user_schedules)`);
    return new Map(rows.map((r) => [r.id, r]));
  } catch (_) {
    return new Map();
  }
}

const norm = (f, v) => (v == null ? '' : f === 'buyin' ? String(Number(v) || 0) : String(v).trim());

/**
 * Compares the saved rows with the snapshot. `carried(row)` says whether this run's feed still holds the
 * row (by venue + event number or stable id); `venues` the series this run covered (a row in a series
 * the run did not cover is not a miss). Returns [{ tournamentId, field, old, new, alert }].
 */
function after(db, snap, { carried, venues = null, now = Date.now() } = {}) {
  const out = [];
  if (!snap || !snap.size) return out;
  const ids = [...snap.keys()];
  const cur = new Map(all(db, `SELECT id, venue, event_number, ${FIELDS.join(', ')} FROM tournaments WHERE id IN (${ids.map(Number).join(',')})`).map((r) => [r.id, r]));
  const today = new Date(now).toISOString().slice(0, 10);
  for (const [id, old] of snap) {
    const row = cur.get(id);
    if (row) {
      for (const f of FIELDS) {
        if (norm(f, old[f]) !== norm(f, row[f])) {
          db.run('INSERT INTO event_changes (tournament_id, field, old, new, at) VALUES (?, ?, ?, ?, ?)', [id, f, old[f] == null ? null : String(old[f]), row[f] == null ? null : String(row[f]), now]);
          const cid = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
          out.push({ id: cid, tournamentId: id, field: f, old: old[f], new: row[f], alert: ALERT.has(f), name: row.event_name, date: row.date });
        }
      }
    }
    if (!carried || (venues && !venues.has(old.venue))) continue;
    const date = String(old.date || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(date) || date.slice(0, 10) < today) continue;   // a past event leaving is not news
    if (carried(old)) { db.run('DELETE FROM event_feed_miss WHERE tournament_id = ?', [id]); continue; }
    const m = all(db, 'SELECT misses FROM event_feed_miss WHERE tournament_id = ?', [id]);
    const misses = (m.length ? Number(m[0].misses) : 0) + 1;
    db.run('INSERT OR REPLACE INTO event_feed_miss (tournament_id, misses) VALUES (?, ?)', [id, misses]);
    if (misses === 2) {
      db.run('INSERT INTO event_changes (tournament_id, field, old, new, at) VALUES (?, ?, ?, ?, ?)', [id, 'gone', null, null, now]);
      const cid = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
      out.push({ id: cid, tournamentId: id, field: 'gone', alert: true, name: old.event_name, date: old.date });
    }
  }
  return out;
}

/** Who saved each changed event: [{ userId, change }]. */
function audience(db, changes) {
  const out = [];
  const ids = [...new Set(changes.map((c) => c.tournamentId))];
  if (!ids.length) return out;
  const by = new Map();
  for (const r of all(db, `SELECT user_id, tournament_id FROM user_schedules WHERE tournament_id IN (${ids.map(Number).join(',')})`)) {
    if (!by.has(r.tournament_id)) by.set(r.tournament_id, []);
    by.get(r.tournament_id).push(r.user_id);
  }
  for (const c of changes) for (const u of by.get(c.tournamentId) || []) out.push({ userId: u, change: c });
  return out;
}

/** The words of one change, for the bell and a push. */
function describe(c) {
  const v = (x) => (x == null || x === '' ? 'none' : String(x));
  switch (c.field) {
    case 'date': return `Moved from ${v(c.old)} to ${v(c.new)}`;
    case 'time': return `Start moved from ${v(c.old)} to ${v(c.new)}`;
    case 'buyin': return `Buy-in changed from ${v(c.old)} to ${v(c.new)}`;
    case 'late_reg_end': return `Late reg now closes ${v(c.new)} (was ${v(c.old)})`;
    case 'event_name': return `Renamed from "${v(c.old)}"`;
    case 'gone': return 'No longer on the room’s schedule';
    default: return 'Changed';
  }
}

function listFor(db, userId) {
  return all(db, `SELECT c.id, c.tournament_id, c.field, c.old, c.new, c.at, t.event_name, t.date, t.time, t.venue, t.property
    FROM event_changes c JOIN user_schedules us ON us.tournament_id = c.tournament_id AND us.user_id = ?
    JOIN tournaments t ON t.id = c.tournament_id
    WHERE c.at > ? AND NOT EXISTS (SELECT 1 FROM event_change_seen s WHERE s.user_id = ? AND s.change_id = c.id)
    ORDER BY c.at DESC LIMIT 60`, [Number(userId), Date.now() - 45 * 864e5, Number(userId)])
    .map((r) => ({ ...r, words: describe(r) }));
}

function mountRoutes(app, { getDb, saveDatabase, authenticateToken, requireRegistered, dismissNotice }) {
  app.get('/api/event-changes', authenticateToken, requireRegistered, (req, res) => {
    try { res.json({ changes: listFor(getDb(), req.user.id) }); }
    catch (err) { res.status(500).json({ error: 'Could not read the changes' }); }
  });
  app.put('/api/event-changes/seen', authenticateToken, requireRegistered, async (req, res) => {
    const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(Number).filter((n) => n > 0).slice(0, 200);
    const db = getDb();
    for (const id of ids) {
      db.run('INSERT OR IGNORE INTO event_change_seen (user_id, change_id) VALUES (?, ?)', [req.user.id, id]);
      if (dismissNotice) dismissNotice(db, req.user.id, 'changes', String(id));
    }
    await saveDatabase();
    res.json({ ok: true });
  });
}

module.exports = { migrate, before, after, audience, describe, listFor, mountRoutes, FIELDS, FEED_TAGS };
