// Cash sessions, no server: the bankroll-ledger source module (lib/ledger-sources/cash-sessions.js)
// called directly against a scratch in-memory sql.js DB, plus the pure helpers in
// lib/cash-sessions.js (computeStats, cleanStakes, toCsv).
//
//   node test/cash-sessions-ledger.test.js      (part of: npm run test:cash-sessions)
'use strict';
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const bankrolls = require(path.join(ROOT, 'lib', 'bankrolls'));
const cash = require(path.join(ROOT, 'lib', 'cash-sessions'));
const source = require(path.join(ROOT, 'lib', 'ledger-sources', 'cash-sessions'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}

(async () => {
  const SQL = await require(path.join(ROOT, 'node_modules', 'sql.js'))();
  const db = new SQL.Database();
  db.run('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
  db.run("INSERT INTO users (id, username) VALUES (1, 'a'), (2, 'b')");
  bankrolls.migrate(db);

  test('a DB without the table yields no entries (the ledger may load before the migration)', () => {
    assert.deepStrictEqual(source.entries(db, 1, {}), []);
  });

  cash.migrate(db);
  db.run('PRAGMA foreign_keys = ON');
  db.run("INSERT INTO bankrolls (id, user_id, name, currency, created_at) VALUES (10, 1, 'Online', 'EUR', 'x'), (20, 2, 'Bobs', 'USD', 'x')");
  const ins = (o) => db.run(`INSERT INTO cash_sessions (user_id, bankroll_id, started_at, ended_at, session_date, room, game, stakes,
      buy_in, rebuys, cash_out, tips, expenses, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'x')`,
  [o.user, o.bk ?? null, o.start, o.end ?? null, o.date, o.room || '', o.game || 'NLH', o.stakes || '2/5', o.buyIn, o.rebuys || 0,
    o.cashOut ?? null, o.tips || 0, o.expenses || 0, o.cur || 'USD']);
  ins({ user: 1, start: '2026-10-01T22:00:00Z', end: '2026-10-02T04:00:00Z', date: '2026-10-01', room: 'Borgata', buyIn: 1000, cashOut: 1800, tips: 40, expenses: 25 });
  ins({ user: 1, start: '2026-10-05T18:00:00Z', end: '2026-10-05T21:00:00Z', date: '2026-10-05', room: 'Live!', buyIn: 1500, rebuys: 1, cashOut: 300 });
  ins({ user: 1, bk: 10, start: '2026-10-06T18:00:00Z', end: '2026-10-06T20:00:00Z', date: '2026-10-06', game: 'PLO', stakes: '1/2', buyIn: 200, cashOut: 260, cur: 'EUR' });
  ins({ user: 1, start: '2026-10-11T18:00:00Z', date: '2026-10-11', buyIn: 500 }); // live
  ins({ user: 2, bk: 20, start: '2026-10-03T18:00:00Z', end: '2026-10-03T20:00:00Z', date: '2026-10-03', buyIn: 100, cashOut: 999 });

  test('module shape: { name, entries }', () => {
    assert.strictEqual(source.name, 'cash-sessions');
    assert.strictEqual(typeof source.entries, 'function');
  });
  test('every ended session of the user, oldest first; the live one contributes nothing', () => {
    const e = source.entries(db, 1, {});
    assert.deepStrictEqual(e.map((x) => x.date), ['2026-10-01', '2026-10-05', '2026-10-06']);
  });
  test('amount = cash_out - buy_in - tips - expenses, in the session currency, with the contract fields', () => {
    const [first, second, third] = source.entries(db, 1, {});
    assert.deepStrictEqual(first, {
      date: '2026-10-01', ts: '2026-10-02T04:00:00Z', amount: 1800 - 1000 - 40 - 25, currency: 'USD', bankroll_id: null,
      kind: 'cash_session', label: 'Cash NLH 2/5 · Borgata', ref: { table: 'cash_sessions', id: 1 },
      started_at: '2026-10-01T22:00:00Z', hours: 6,
    });
    assert.strictEqual(second.amount, -1200);
    assert.deepStrictEqual([third.amount, third.currency, third.bankroll_id], [60, 'EUR', 10]);
  });
  test("hours = ended - started, to the hundredth (the dashboard's hourly rate)", () => {
    assert.deepStrictEqual(source.entries(db, 1, {}).map((x) => x.hours), [6, 3, 2]);
  });
  test('bankroll filter: main, an id (number or string), all', () => {
    assert.deepStrictEqual(source.entries(db, 1, { bankroll: 'main' }).map((x) => x.ref.id), [1, 2]);
    assert.deepStrictEqual(source.entries(db, 1, { bankroll: 10 }).map((x) => x.ref.id), [3]);
    assert.deepStrictEqual(source.entries(db, 1, { bankroll: '10' }).map((x) => x.ref.id), [3]);
    assert.strictEqual(source.entries(db, 1, { bankroll: 'all' }).length, 3);
  });
  test('isolation: another user\'s bankroll id or a malformed value yields nothing', () => {
    assert.deepStrictEqual(source.entries(db, 1, { bankroll: 20 }), []);
    assert.deepStrictEqual(source.entries(db, 1, { bankroll: 'nope' }), []);
    assert.deepStrictEqual(source.entries(db, 2, {}).map((x) => x.amount), [899]);
    assert.ok(source.entries(db, 2, {}).every((x) => x.ref.id === 5));
  });
  test('from / to are inclusive on the session day', () => {
    assert.deepStrictEqual(source.entries(db, 1, { from: '2026-10-05', to: '2026-10-06' }).map((x) => x.ref.id), [2, 3]);
    assert.deepStrictEqual(source.entries(db, 1, { to: '2026-10-01' }).map((x) => x.ref.id), [1]);
  });
  test('ending the live session brings it into the ledger', () => {
    db.run("UPDATE cash_sessions SET ended_at = '2026-10-11T19:30:00Z', cash_out = 650 WHERE id = 4");
    const e = source.entries(db, 1, { from: '2026-10-11' });
    assert.deepStrictEqual(e.map((x) => [x.ref.id, x.amount]), [[4, 150]]);
  });

  // ── pure helpers ──
  test('cleanStakes normalises the ways a stake is typed', () => {
    for (const [i, o] of [['$2/$5', '2/5'], ['2-5', '2/5'], [' 2 / 5 ', '2/5'], ['1/2/5', '1/2/5'], ['0.5/1', '0.5/1'], ['2/5 cap', '2/5 cap'], ['', '']]) {
      assert.strictEqual(cash.cleanStakes(i), o, i);
    }
  });
  test('computeStats: net, hours, hourly, wins/losses, extremes and groups; live skipped', () => {
    const list = cash.listSessions(db, 1, {}).sessions;
    db.run("UPDATE cash_sessions SET ended_at = NULL, cash_out = NULL WHERE id = 4");
    const st = cash.computeStats(cash.listSessions(db, 1, { bankroll: 'main' }).sessions, { currency: 'USD' });
    assert.strictEqual(list.length, 4);
    assert.strictEqual(st.sessions, 2);
    assert.strictEqual(st.live, 1);
    assert.strictEqual(st.overall.net, 735 - 1200);
    assert.strictEqual(st.overall.hours, 9);
    assert.strictEqual(st.overall.hourly, Math.round((-465 / 9) * 100) / 100);
    assert.deepStrictEqual([st.overall.wins, st.overall.losses], [1, 1]);
    assert.deepStrictEqual(st.overall.biggest_win, { id: 1, amount: 735, date: '2026-10-01' });
    assert.deepStrictEqual(st.overall.biggest_loss, { id: 2, amount: -1200, date: '2026-10-05' });
    assert.strictEqual(st.overall.avg_hours, 4.5);
    assert.deepStrictEqual(st.byRoom.map((g) => [g.label, g.hours, g.net]), [['Borgata', 6, 735], ['Live!', 3, -1200]]);
    assert.deepStrictEqual(st.byStakes.map((g) => g.label), ['NLH 2/5']);
    assert.strictEqual(st.mixed, false);
  });
  test('computeStats converts every amount into the target currency', () => {
    const all = cash.listSessions(db, 1, {}).sessions;
    const rates = { USD: 1, EUR: 0.5 };
    const st = cash.computeStats(all, { currency: 'USD', convert: (v, f, t) => (v / rates[f]) * rates[t] });
    assert.strictEqual(st.mixed, true);
    assert.strictEqual(st.overall.net, 735 - 1200 + 120);
    assert.deepStrictEqual(st.byGame.map((g) => [g.label, g.net]), [['NLH', -465], ['PLO', 120]]);
  });
  test('toCsv: header, one line per session, formula-looking text defused', () => {
    db.run("UPDATE cash_sessions SET notes = '=HYPERLINK(1)', room = 'A, \"B\"' WHERE id = 1");
    const csv = cash.toCsv(cash.listSessions(db, 1, {}).sessions, new Map([['main', 'Main'], [10, 'Online']]));
    const lines = csv.trim().split('\r\n');
    assert.strictEqual(lines.length, 5);
    assert.ok(lines[0].startsWith('id,date,started_at,ended_at,hours,room'));
    const row1 = lines.find((l) => l.startsWith('1,'));
    assert.ok(row1.includes('"A, ""B"""'), row1);
    assert.ok(row1.includes("'=HYPERLINK(1)"), row1);
    assert.ok(row1.includes(',Main,'), row1);
    assert.ok(lines.find((l) => l.startsWith('3,')).includes(',Online,'));
  });

  db.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
