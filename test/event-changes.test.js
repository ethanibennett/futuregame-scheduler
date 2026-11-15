// lib/event-changes.js (saved-event alerts) and lib/feed-duplicates.js (an event listed twice).
'use strict';
const assert = require('assert');
const initSqlJs = require('sql.js');
const ec = require('../lib/event-changes');
const dup = require('../lib/feed-duplicates');

let passed = 0;
const eq = (label, a, b) => { assert.deepStrictEqual(a, b, label); passed++; };

(async () => {
  const SQL = await initSqlJs();
  const fresh = () => {
    const db = new SQL.Database();
    db.run(`CREATE TABLE tournaments (id INTEGER PRIMARY KEY, venue TEXT, property TEXT, event_number TEXT, stable_id TEXT,
      source_pdf TEXT, date TEXT, time TEXT, buyin INTEGER, late_reg_end TEXT, event_name TEXT, timezone TEXT)`);
    db.run('CREATE TABLE user_schedules (user_id INTEGER, tournament_id INTEGER)');
    ec.migrate(db);
    return db;
  };
  const add = (db, id, o = {}) => {
    const r = { venue: 'Live! Cup VIII', property: 'Live! Philadelphia', event_number: `E${id}`, date: 'November 22, 2026', time: '11:15 AM', buyin: 600, event_name: 'NLH Restart - Day 2', ...o };
    db.run('INSERT INTO tournaments (id, venue, property, event_number, stable_id, source_pdf, date, time, buyin, event_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, r.venue, r.property, r.event_number, `MTT-${r.venue}-${r.event_number}`, 'mtt-feed', r.date, r.time, r.buyin, r.event_name]);
  };
  const save = (db, user, id) => db.run('INSERT INTO user_schedules VALUES (?, ?)', [user, id]);
  const set = (db, id, o) => { for (const [k, v] of Object.entries(o)) db.run(`UPDATE tournaments SET ${k} = ? WHERE id = ?`, [v, id]); };
  const run = (db, change) => { const snap = ec.before(db); change(); return ec.noticesFor(db, ec.after(db, snap, {})); };

  eq('feed times', ['4:00 PM', '12:05 AM', '12:30 PM', '16:00', '9:00 am', 'TBA'].map(ec.minutesOf), [960, 5, 750, 960, 540, null]);

  // A start moved a few minutes on its day: a bell line, no push (Triton re-times its flights so).
  {
    const db = fresh(); add(db, 1, { time: '2:00 PM' }); save(db, 7, 1);
    const n = run(db, () => set(db, 1, { time: '2:04 PM' }));
    eq('nudge: one player told', n.length, 1);
    eq('nudge: in the bell', n[0].bell.map((b) => b.title), ['NLH Restart - Day 2: Start moved from 2:00 PM to 2:04 PM']);
    eq('nudge: no push', n[0].push, null);
  }
  // 15 minutes or more pushes.
  {
    const db = fresh(); add(db, 1, { time: '2:00 PM' }); save(db, 7, 1);
    const n = run(db, () => set(db, 1, { time: '2:20 PM' }));
    eq('a 20-minute move pushes', n[0].push.title, 'NLH Restart - Day 2: Start moved from 2:00 PM to 2:20 PM');
  }
  // Date and time moved together: two bell lines, ONE push naming both.
  {
    const db = fresh(); add(db, 1); save(db, 7, 1);
    const n = run(db, () => set(db, 1, { date: 'November 21, 2026', time: '9:00 AM' }));
    eq('a move: two bell lines', n[0].bell.length, 2);
    eq('a move: one push', n[0].push.title, 'NLH Restart - Day 2: Moved from November 22, 2026, 11:15 AM to November 21, 2026, 9:00 AM');
  }
  // A date move whose clock nudged too still names both in its one push.
  {
    const db = fresh(); add(db, 1); save(db, 7, 1);
    const n = run(db, () => set(db, 1, { date: 'November 23, 2026', time: '11:20 AM' }));
    eq('date + nudge: one push names both', n[0].push.title, 'NLH Restart - Day 2: Moved from November 22, 2026, 11:15 AM to November 23, 2026, 11:20 AM');
  }
  // A re-price with a nudge: the push names the price only.
  {
    const db = fresh(); add(db, 1); save(db, 7, 1);
    const n = run(db, () => set(db, 1, { buyin: 800, time: '11:20 AM' }));
    eq('buy-in + nudge: push names the price', n[0].push.title, 'NLH Restart - Day 2: Buy-in changed from 600 to 800');
    eq('buy-in + nudge: both in the bell', n[0].bell.length, 2);
  }
  // Two players saved it: one notice each.
  {
    const db = fresh(); add(db, 1); save(db, 7, 1); save(db, 8, 1);
    const n = run(db, () => set(db, 1, { date: 'November 21, 2026' }));
    eq('two players, two notices', n.map((x) => x.userId).sort(), [7, 8]);
    eq('each with one push', n.every((x) => x.push && x.bell.length === 1), true);
  }
  // A rename alone is quiet.
  {
    const db = fresh(); add(db, 1); save(db, 7, 1);
    const n = run(db, () => set(db, 1, { event_name: 'NLH Live! Cup Day 2' }));
    eq('rename: bell, no push', [n[0].bell.length, n[0].push], [1, null]);
  }

  // ── Listed twice ──
  {
    const db = fresh();
    const today = Date.parse('2026-11-15T17:00:00Z');
    // The old saved row prune kept, beside the event's current row: same name, buy-in, day and start.
    add(db, 1, { event_number: '24-x-20261123', event_name: 'PLO Double Board Bomb Pot Turbo', date: 'November 23, 2026', time: '8:00 PM', buyin: 400, venue: '2026 Rock ‘n’ Roll Poker Open', property: 'Seminole Hard Rock Hollywood' });
    add(db, 2, { event_number: '24-309451-20261123', event_name: 'PLO Double Board Bomb Pot Turbo', date: 'November 23, 2026', time: '8:00 PM', buyin: 400, venue: '2026 Rock ‘n’ Roll Poker Open', property: 'Seminole Hard Rock Hollywood' });
    // Not duplicates: a satellite three times a day, flights, a past pair.
    add(db, 3, { event_name: 'NLH Milestone Satellite', time: '2:00 PM', date: 'December 12, 2026' });
    add(db, 4, { event_name: 'NLH Milestone Satellite', time: '7:00 PM', date: 'December 12, 2026' });
    add(db, 5, { event_name: 'NLH Flight A', date: 'December 3, 2026' });
    add(db, 6, { event_name: 'NLH Flight B', date: 'December 3, 2026' });
    add(db, 7, { event_name: 'NLH', date: 'November 1, 2026' });
    add(db, 8, { event_name: 'NLH', date: 'November 1, 2026' });
    const groups = dup.find(db, today);
    eq('one group: the saved twin', groups.map((g) => g.key), ['1,2']);
    eq('described', dup.describe(groups[0]), '2026 Rock ‘n’ Roll Poker Open: PLO Double Board Bomb Pot Turbo November 23, 2026 8:00 PM (#24-x-20261123, #24-309451-20261123)');
    eq('paged once', dup.fresh(db, groups, today).length, 1);
    eq('never again', dup.fresh(db, dup.find(db, today), today).length, 0);
  }

  console.log(`event-changes.test.js — ${passed} assertions passed`);
})().catch((e) => { console.error(e); process.exit(1); });
