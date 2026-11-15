'use strict';
/*
 * An event listed twice on the Schedule, checked after every feed run (owner, 2026-11-15: "we need to
 * be extremely vigilant in making sure this doesn't happen").
 *
 * The watcher checks the feed it writes (mtt-series-watcher/src/emit/duplicates.ts), but a duplicate can
 * exist here that the feed never had: prune keeps a feed row someone saved or logged, so an event the
 * feed re-keyed (a retime before the watcher's 2026-11-06 move rule) leaves its old saved row beside
 * the new one. This looks at what the Schedule actually holds: feed rows (mtt-feed / online-feed), from
 * today on, with one name, buy-in, date and start at one room (property, else the series title).
 *
 * find(db, now)        → [{ key, rows }]: every such group today
 * fresh(db, groups)    → the groups not paged before (feed_dup_alerts), recorded as paged
 * describe(group)      → one line for the push
 */

const { eventDayKey, todayKey } = require('./feed-prune');

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

function find(db, now = Date.now()) {
  const today = todayKey('America/New_York', now);
  const rows = all(db, `SELECT id, venue, property, event_number, event_name, date, time, buyin, timezone FROM tournaments
    WHERE source_pdf IN ('mtt-feed', 'online-feed')`);
  const by = new Map();
  for (const r of rows) {
    const day = eventDayKey(r.date);
    if (!day || day < today) continue;
    const room = String(r.property || r.venue || '').toLowerCase().trim();
    const k = [room, day, String(r.time || '').trim().toLowerCase(), Number(r.buyin) || 0, nameKey(r.event_name)].join('|');
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  const out = [];
  for (const g of by.values()) if (g.length > 1) out.push({ key: g.map((r) => r.id).sort((a, b) => a - b).join(','), rows: g });
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
