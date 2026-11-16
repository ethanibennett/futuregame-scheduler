'use strict';
/*
 * An event listed twice on the Schedule, checked after every feed run (owner, 2026-11-15: "we need to
 * be extremely vigilant in making sure this doesn't happen").
 *
 * The watcher checks the feed it writes (mtt-series-watcher/src/emit/duplicates.ts), but a duplicate can
 * exist here that the feed never had: prune keeps a feed row someone saved or logged, so an event the
 * feed re-keyed (a retime before the watcher's 2026-11-06 move rule) leaves its old saved row beside
 * the new one; so does a hand-added "bridge" row someone saved. This looks at what the Schedule
 * actually holds — see find().
 *
 * find(db, now, hidden) → [{ key, rows }]: every such group today (hidden: ids the list does not show)
 * fresh(db, groups)    → the groups not paged before (feed_dup_alerts), recorded as paged
 * describe(group)      → one line for the push
 */

const { eventDayKey, todayKey } = require('./feed-prune');
const { clockMinutes, nameSig, sameSlot, flightOf } = require('./feed-dedupe');

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS feed_dup_alerts (
    group_key TEXT PRIMARY KEY,
    at INTEGER NOT NULL
  )`);
}

function all(db, sql, p) {
  const st = db.prepare(sql);
  try { st.bind(p || []); const out = []; while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); }
}

const nameKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Every row the Schedule shows (not Personal events, not feed rows hidden as copies of a hand
// import), from today on. Two rows are one event when they start at the same minute on the same
// day at the same room (lib/feed-dedupe sameSlot: property, else series title; same buy-in or the
// same restart day) under names that agree once labels are set aside (nameSig: "TORSE (2 Day)" is
// "TORSE"). Until 2026-11-15 this saw only feed rows under identical names, and so missed the
// owner's saved bridge row "TORSE (2 Day)" beside the feed's "TORSE" on Dec 13.
function find(db, now = Date.now(), hidden = new Set()) {
  const today = todayKey('America/New_York', now);
  const rows = all(db, `SELECT id, source_pdf, venue, property, event_number, event_name, date, time, buyin, timezone FROM tournaments
    WHERE venue != 'Personal'`);
  const by = new Map();
  for (const r of rows) {
    if (hidden.has(r.id)) continue;
    const day = eventDayKey(r.date);
    if (!day || day < today) continue;
    const minutes = clockMinutes(r.time);
    const sig = nameSig(r.event_name).join(' ') || nameKey(r.event_name);
    const k = [day, minutes == null ? String(r.time || '').trim().toLowerCase() : minutes, sig, flightOf(r.event_name) || ''].join('|');
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  const out = [];
  for (const g of by.values()) {
    if (g.length < 2) continue;
    // Rows of one key can still be different rooms or buy-ins: split into the sets sameSlot joins.
    const parent = g.map((_, i) => i);
    const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (sameSlot(g[i], g[j])) parent[root(i)] = root(j);
    const sets = new Map();
    g.forEach((r, i) => { const k = root(i); (sets.get(k) || sets.set(k, []).get(k)).push(r); });
    for (const s of sets.values()) if (s.length > 1) out.push({ key: s.map((r) => r.id).sort((a, b) => a - b).join(','), rows: s });
  }
  return out;
}

function fresh(db, groups, now = Date.now()) {
  if (!groups.length) return [];
  migrate(db);
  const seen = new Set(all(db, 'SELECT group_key FROM feed_dup_alerts').map((r) => r.group_key));
  const out = groups.filter((g) => !seen.has(g.key));
  for (const g of out) db.run('INSERT OR IGNORE INTO feed_dup_alerts (group_key, at) VALUES (?, ?)', [g.key, now]);
  return out;
}

function describe(g) {
  const r = g.rows[0];
  const where = [...new Set(g.rows.map((x) => x.venue))].join(' + ');
  return `${where}: ${r.event_name} ${r.date} ${r.time} (${g.rows.map((x) => `#${x.event_number || x.id}`).join(', ')})`;
}

module.exports = { migrate, find, fresh, describe };
