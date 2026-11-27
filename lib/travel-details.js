'use strict';
/*
 * A Travel Day's flights, stays and rental cars (owner, 2026-11-27: "Add the option to enter flight information,
 * stay information (hotel name, check in time etc), rental car info etc").
 *
 *   travel_details (tournament_id PRIMARY KEY, user_id, data JSON { items: [...] }, updated_at)
 *
 * A table of its own, never a column on the day's tournaments row: that row goes out with the schedule (a share
 * link, a friend, a group, the calendar feed), and these are confirmation numbers and hotels. Only the owner reads
 * them, here, and they go with the day (server.js's DELETE /api/personal-event/:id calls remove) and with the
 * account (feature-mounts USER_TABLES).
 *
 * GET/PUT /api/personal-event/:id/travel { items }. An item is { kind: 'flight' | 'stay' | 'car', ...its fields },
 * every field a short string (FIELDS). A PUT whose flights give a departure and an arrival also writes the day's
 * note as the Travel Day picker does ("Depart 8:00 AM → Arrive 11:00 AM"), which the closed band, the card's times
 * and every other reader of the note already read.
 */

const FIELDS = {
  flight: ['number', 'from', 'to', 'departs', 'arrives', 'conf'],
  stay: ['name', 'address', 'checkIn', 'checkOut', 'conf'],
  car: ['company', 'pickUp', 'pickUpAt', 'dropOff', 'dropOffAt', 'conf'],
};
const MAX_ITEMS = 12;
const MAX_LEN = 120;

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS travel_details (
    tournament_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
}

function one(db, sql, p) {
  const st = db.prepare(sql);
  try { st.bind(p || []); return st.step() ? st.getAsObject() : null; } finally { st.free(); }
}

/** The items as stored: known kinds and fields only, trimmed strings, an item with nothing in it dropped. */
function cleanItems(items) {
  if (!Array.isArray(items)) return null;
  if (items.length > MAX_ITEMS) return null;
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object' || !FIELDS[it.kind]) return null;
    const clean = { kind: it.kind };
    let any = false;
    for (const f of FIELDS[it.kind]) {
      const v = it[f];
      if (v == null || v === '') continue;
      if (typeof v !== 'string') return null;
      const s = v.trim().slice(0, MAX_LEN);
      if (s) { clean[f] = s; any = true; }
    }
    if (any) out.push(clean);
  }
  return out;
}

/** "08:05" (an <input type="time">) or "2026-12-08T08:05" as the picker writes a time: "8:05 AM". */
function clock(v) {
  const m = /(?:^|T)(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  const h = Number(m[1]), min = m[2];
  if (h > 23) return null;
  return `${h % 12 || 12}:${min} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The note the picker writes, from the first flight's departure and the last flight's arrival. */
function notesFor(items) {
  const flights = (items || []).filter((i) => i.kind === 'flight');
  const dep = flights.map((f) => clock(f.departs)).find(Boolean);
  const arr = flights.map((f) => clock(f.arrives)).filter(Boolean).pop();
  return dep && arr ? `Depart ${dep} → Arrive ${arr}` : null;
}

function read(db, id) {
  const r = one(db, 'SELECT data FROM travel_details WHERE tournament_id = ?', [Number(id)]);
  if (!r) return [];
  try { return (JSON.parse(r.data).items || []); } catch (_) { return []; }
}

function remove(db, id) {
  db.run('DELETE FROM travel_details WHERE tournament_id = ?', [Number(id)]);
}

function mountRoutes(app, { getDb, saveDatabase, authenticateToken, requireRegistered }) {
  // The owner's own Travel Day, as the personal-event routes check it.
  const own = (db, uid, id) => one(db,
    `SELECT t.id, t.notes FROM tournaments t JOIN user_schedules us ON t.id = us.tournament_id
     WHERE t.id = ? AND us.user_id = ? AND t.venue = 'Personal' AND t.event_name = 'Travel Day'`, [Number(id), uid]);

  app.get('/api/personal-event/:id/travel', authenticateToken, requireRegistered, (req, res) => {
    const db = getDb();
    if (!own(db, req.user.id, req.params.id)) return res.status(404).json({ error: 'No such travel day' });
    res.set('Cache-Control', 'no-store');
    res.json({ items: read(db, req.params.id) });
  });

  app.put('/api/personal-event/:id/travel', authenticateToken, requireRegistered, async (req, res) => {
    const db = getDb();
    const day = own(db, req.user.id, req.params.id);
    if (!day) return res.status(404).json({ error: 'No such travel day' });
    const items = cleanItems((req.body || {}).items);
    if (!items) return res.status(400).json({ error: `Up to ${MAX_ITEMS} flights, stays and cars, each field a short line of text` });
    if (items.length) {
      db.run('INSERT OR REPLACE INTO travel_details (tournament_id, user_id, data, updated_at) VALUES (?, ?, ?, ?)',
        [Number(req.params.id), req.user.id, JSON.stringify({ items }), Date.now()]);
    } else remove(db, req.params.id);
    const notes = notesFor(items);
    if (notes && notes !== day.notes) db.run('UPDATE tournaments SET notes = ? WHERE id = ?', [notes, Number(req.params.id)]);
    await saveDatabase();
    res.json({ items, notes: notes || day.notes || '' });
  });
}

module.exports = { migrate, mountRoutes, remove, cleanItems, notesFor, clock, FIELDS, MAX_ITEMS };
