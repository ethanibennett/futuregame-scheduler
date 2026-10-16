'use strict';
// node test/backer-live.test.js — the backer page's live beacon (lib/backer-live.js liveSession).
const assert = require('assert');
const initSqlJs = require('sql.js');
const { liveSession, CASH_MAX_HOURS, TOURNAMENT_FRESH_HOURS } = require('../lib/backer-live');

let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } };

const H = 3600000;
const NOW = Date.parse('2026-10-16T20:00:00Z');
const sqlite = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);   // CURRENT_TIMESTAMP's form

(async () => {
  const SQL = await initSqlJs();
  const fresh = () => {
    const db = new SQL.Database();
    db.run(`CREATE TABLE tournaments (id INTEGER PRIMARY KEY, event_name TEXT, venue TEXT, property TEXT, clock_ended_at TEXT)`);
    db.run(`CREATE TABLE live_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, tournament_id INTEGER, update_text TEXT,
      created_at TEXT, is_busted INTEGER DEFAULT 0, is_bagged INTEGER DEFAULT 0, play_started_at TEXT)`);
    db.run(`CREATE TABLE tracking_entries (id INTEGER PRIMARY KEY, user_id INTEGER, tournament_id INTEGER)`);
    db.run(`CREATE TABLE cash_sessions (id INTEGER PRIMARY KEY, user_id INTEGER, started_at TEXT, ended_at TEXT, game TEXT, stakes TEXT, room TEXT)`);
    db.run(`INSERT INTO tournaments (id, event_name, venue, property) VALUES (1, 'NLH Monster Stack - Flight B', 'Fall Series', 'Borgata'), (2, 'PLO Bounty', 'Fall Series', 'Parx')`);
    return db;
  };
  const upd = (db, tid, ago, extra = {}) => db.run(
    'INSERT INTO live_updates (user_id, tournament_id, update_text, created_at, is_busted, is_bagged, play_started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [extra.user || 7, tid, 'x', sqlite(NOW - ago), extra.busted ? 1 : 0, extra.bagged ? 1 : 0, extra.started ? sqlite(NOW - extra.started) : null]);

  await test('nothing running: null; no player: null', async () => {
    const db = fresh();
    assert.strictEqual(liveSession(db, 7, NOW), null);
    assert.strictEqual(liveSession(db, null, NOW), null);
  });

  await test('a live cash session: stakes and game, the room, its start', async () => {
    const db = fresh();
    db.run('INSERT INTO cash_sessions (user_id, started_at, ended_at, game, stakes, room) VALUES (7, ?, NULL, ?, ?, ?)',
      [new Date(NOW - 2 * H).toISOString(), 'NLH', '2/5', 'Live! Philadelphia']);
    assert.deepStrictEqual(liveSession(db, 7, NOW),
      { kind: 'cash', title: '2/5 NLH', room: 'Live! Philadelphia', since: new Date(NOW - 2 * H).toISOString() });
    assert.strictEqual(liveSession(db, 8, NOW), null, "another account's session is not this player's");
  });

  await test(`an ended cash session, or one left running past ${CASH_MAX_HOURS}h, is not live`, async () => {
    const db = fresh();
    db.run('INSERT INTO cash_sessions (user_id, started_at, ended_at, game, stakes) VALUES (7, ?, ?, ?, ?)',
      [new Date(NOW - 3 * H).toISOString(), new Date(NOW - H).toISOString(), 'NLH', '1/3']);
    assert.strictEqual(liveSession(db, 7, NOW), null);
    db.run('INSERT INTO cash_sessions (user_id, started_at, ended_at, game, stakes) VALUES (7, ?, NULL, ?, ?)',
      [new Date(NOW - (CASH_MAX_HOURS + 1) * H).toISOString(), 'PLO', '5/5']);
    assert.strictEqual(liveSession(db, 7, NOW), null, 'a forgotten session is not live for ever');
  });

  await test("a tournament run: the event, the room (the property), when it started", async () => {
    const db = fresh();
    upd(db, 1, 0.5 * H, { started: 3 * H });
    assert.deepStrictEqual(liveSession(db, 7, NOW),
      { kind: 'tournament', title: 'NLH Monster Stack - Flight B', room: 'Borgata', since: new Date(NOW - 3 * H).toISOString() });
  });

  await test('a bust, a bag, a logged result, an ended clock or a stale run is not live', async () => {
    let db = fresh(); upd(db, 1, 2 * H); upd(db, 1, H, { busted: true });
    assert.strictEqual(liveSession(db, 7, NOW), null, 'its latest update is a bust');
    db = fresh(); upd(db, 1, H, { bagged: true });
    assert.strictEqual(liveSession(db, 7, NOW), null, 'bagged');
    db = fresh(); upd(db, 1, H); db.run('INSERT INTO tracking_entries (user_id, tournament_id) VALUES (7, 1)');
    assert.strictEqual(liveSession(db, 7, NOW), null, 'a result is logged');
    db = fresh(); upd(db, 1, H); db.run("UPDATE tournaments SET clock_ended_at = '2026-10-16T19:00:00Z' WHERE id = 1");
    assert.strictEqual(liveSession(db, 7, NOW), null, "the room's clock ended");
    db = fresh(); upd(db, 1, (TOURNAMENT_FRESH_HOURS + 1) * H);
    assert.strictEqual(liveSession(db, 7, NOW), null, 'nothing for too long');
  });

  await test('cash and a tournament at once: the newest-started wins', async () => {
    const db = fresh();
    upd(db, 2, 0.2 * H, { started: 4 * H });
    db.run('INSERT INTO cash_sessions (user_id, started_at, ended_at, game, stakes, room) VALUES (7, ?, NULL, ?, ?, ?)',
      [new Date(NOW - H).toISOString(), 'NLH', '1/3', 'Parx']);
    assert.strictEqual(liveSession(db, 7, NOW).kind, 'cash');
  });

  await test('a database without the tables answers null, not an error', async () => {
    assert.strictEqual(liveSession(new SQL.Database(), 7, NOW), null);
  });

  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
