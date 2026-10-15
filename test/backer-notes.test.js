// The backer page's session notes (owner, 2026-10-15: the cards "should expand like in the schedule to
// reveal the notes I've added"): buildFeed carries `notes` on a session whose share points at a result
// with notes, and only then; an importer's own line is never shown; a page with no notes is unchanged.
//
//   node test/backer-notes.test.js        (in npm run test:backer-page)
//
// In process, on a scratch sql.js database with the few tables the feed reads. Every name and figure is
// invented.
'use strict';
const assert = require('assert');
const initSqlJs = require('sql.js');
const surface = require('../lib/backer-surface');

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE backer_events (id TEXT PRIMARY KEY, token TEXT, session_id TEXT, ts INTEGER, date TEXT, game TEXT, venue TEXT, hours REAL,
    session_result_cents INTEGER, pct REAL, share_cents INTEGER, source TEXT, ref_table TEXT, ref_id INTEGER)`);
  db.run('CREATE TABLE backer_public (token TEXT PRIMARY KEY, name TEXT, updated_at INTEGER)');
  db.run('CREATE TABLE console_records (store TEXT, id TEXT, data TEXT, updated_at INTEGER, deleted INTEGER)');
  db.run('CREATE TABLE tracking_entries (id INTEGER PRIMARY KEY, notes TEXT, subtitle TEXT)');
  db.run('CREATE TABLE cash_sessions (id INTEGER PRIMARY KEY, notes TEXT, subtitle TEXT)');
  db.run("INSERT INTO tracking_entries (id, notes, subtitle) VALUES (4, NULL, 'Main Event Day 1')");
  db.run("INSERT INTO tracking_entries (id, notes) VALUES (1, 'Bagged 180k, table draw is soft'), (2, 'Imported from the dashboard'), (3, '   ')");
  db.run("INSERT INTO cash_sessions (id, notes) VALUES (7, 'Game broke at 3am.\nGood lineup.')");
  const ev = (id, date, ref, refId) => db.run(`INSERT INTO backer_events (id, token, session_id, ts, date, game, venue, hours, session_result_cents, pct, share_cents, source, ref_table, ref_id)
    VALUES (?, 'NotesTok01', ?, ?, ?, 'NLH MTT', 'Borgata', 5, 100000, 20, 20000, 'ledger', ?, ?)`, [id, id, Date.parse(date), date, ref, refId]);
  ev('a', '2026-10-10', 'tracking_entries', 1);
  ev('b', '2026-10-09', 'tracking_entries', 2);
  ev('c', '2026-10-08', 'tracking_entries', 3);
  ev('d', '2026-10-07', 'cash_sessions', 7);
  ev('e', '2026-10-06', null, null);
  ev('f', '2026-10-05', 'tracking_entries', 4);

  const f = surface.buildFeed(db, 'NotesTok01', { source: 'console' });
  const byDate = Object.fromEntries(f.events.map((e) => [e.date, e]));
  assert.strictEqual(byDate['2026-10-10'].notes, 'Bagged 180k, table draw is soft', 'a tournament result\'s notes');
  assert.strictEqual(byDate['2026-10-07'].notes, 'Game broke at 3am.\nGood lineup.', 'a cash session\'s notes, line breaks kept');
  assert.ok(!('notes' in byDate['2026-10-09']), 'an importer\'s own line is not the owner\'s note');
  assert.ok(!('notes' in byDate['2026-10-08']), 'blank notes are no notes');
  assert.ok(!('notes' in byDate['2026-10-06']), 'a share with no result linked has none');
  assert.ok(f.events.every((e) => !('_ref' in e)), 'nothing internal leaks into the feed');
  // The subheading (owner, 2026-10-15): carried when typed, with or without notes, and only then.
  assert.strictEqual(byDate['2026-10-05'].subtitle, 'Main Event Day 1', 'a subheading with no notes');
  assert.ok(!('notes' in byDate['2026-10-05']), 'no notes invented beside it');
  assert.ok(!('subtitle' in byDate['2026-10-10']), 'notes alone bring no subheading');

  const bare = new SQL.Database();
  bare.run(`CREATE TABLE backer_events (id TEXT PRIMARY KEY, token TEXT, session_id TEXT, ts INTEGER, date TEXT, game TEXT, venue TEXT, hours REAL,
    session_result_cents INTEGER, pct REAL, share_cents INTEGER)`);
  bare.run('CREATE TABLE backer_public (token TEXT PRIMARY KEY, name TEXT, updated_at INTEGER)');
  bare.run('CREATE TABLE console_records (store TEXT, id TEXT, data TEXT, updated_at INTEGER, deleted INTEGER)');
  bare.run("INSERT INTO backer_events VALUES ('x', 'BareTok001', 's', 1, '2026-10-01', 'NLH', 'Parx', 3, 5000, 10, 500)");
  const g = surface.buildFeed(bare, 'BareTok001', { source: 'console' });
  assert.deepStrictEqual(Object.keys(g.events[0]).sort(), ['date', 'game', 'hours', 'pct', 'sessionResultCents', 'shareCents', 'ts', 'venue'], 'a database without the ref columns gives the old event shape');
  console.log('backer-notes.test.js — 10 passed');
})().catch((e) => { console.error(e); process.exit(1); });
