// Ledger source lib/ledger-sources/transactions.js, against a scratch in-memory sql.js DB (no
// server, no files). Checks the shared contract: shape, sign, bankroll filter (and that another
// user's bankroll throws), the date range, and user isolation.
//
//   node test/ledger-source-transactions.test.js      (part of npm run test:transactions)
'use strict';
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const bankrolls = require(path.join(ROOT, 'lib', 'bankrolls'));
const tx = require(path.join(ROOT, 'lib', 'bankroll-transactions'));
const source = require(path.join(ROOT, 'lib', 'ledger-sources', 'transactions'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.stack}`); }
}

(async () => {
  const SQL = await require(path.join(ROOT, 'node_modules', 'sql.js'))();
  const db = new SQL.Database();

  test('before the migration the source returns []', () => {
    db.run('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
    assert.deepStrictEqual(source.entries(db, 1, {}), []);
  });

  db.run("INSERT INTO users (id, username) VALUES (1, 'a'), (2, 'b')");
  db.run('CREATE TABLE tournaments (id INTEGER PRIMARY KEY, event_name TEXT, date TEXT, venue TEXT, uploaded_by INTEGER, stable_id TEXT)');
  bankrolls.migrate(db);
  tx.migrate(db);
  tx.migrate(db); // idempotent
  db.run("INSERT INTO bankrolls (id, user_id, name, currency, created_at) VALUES (10, 1, 'Online', 'USD', 'x'), (20, 2, 'Theirs', 'EUR', 'x')");
  db.run("INSERT INTO bankroll_trips (id, user_id, name, start_date, end_date, created_at) VALUES (5, 1, 'Vegas', '2026-06-01', '2026-06-10', 'x')");
  const ins = `INSERT INTO bankroll_transactions (user_id, bankroll_id, occurred_on, kind, category, amount, currency, note, series, trip_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'x')`;
  db.run(ins, [1, null, '2026-06-02', 'expense', 'lodging', 412.37, 'USD', 'Rio 3 nights', null, 5]);
  db.run(ins, [1, 10, '2026-06-03', 'income', 'rakeback', 55, 'USD', null, 'ACR', null]);
  db.run(ins, [1, null, '2026-07-15', 'expense', 'food', 23.5, 'EUR', null, null, null]);
  db.run(ins, [2, 20, '2026-06-02', 'expense', 'travel', 999, 'EUR', 'not yours', null, null]);

  test('shape and sign follow the contract', () => {
    const rows = source.entries(db, 1);
    assert.strictEqual(source.name, 'transactions');
    assert.strictEqual(rows.length, 3);
    for (const r of rows) {
      assert.deepStrictEqual(Object.keys(r).sort(), ['amount', 'bankroll_id', 'category', 'currency', 'date', 'kind', 'label', 'ref', 'ts'].sort());
      assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.strictEqual(r.ts, null);
      assert.strictEqual(r.ref.table, 'bankroll_transactions');
      assert.ok(Number.isInteger(r.ref.id));
    }
    assert.deepStrictEqual(rows.map((r) => r.amount), [-412.37, 55, -23.5]);
    assert.deepStrictEqual(rows.map((r) => r.bankroll_id), [null, 10, null]);
    assert.deepStrictEqual(rows.map((r) => r.currency), ['USD', 'USD', 'EUR']);
    assert.deepStrictEqual(rows.map((r) => r.kind), ['expense', 'income', 'expense']);
    assert.strictEqual(rows[0].label, 'Lodging · Rio 3 nights');
    assert.strictEqual(rows[1].label, 'Rakeback · ACR');
    assert.strictEqual(rows[2].label, 'Food');
  });

  test('ordered by date then id', () => {
    const dates = source.entries(db, 1).map((r) => r.date);
    assert.deepStrictEqual(dates, [...dates].sort());
  });

  test('bankroll filter: all, main, an id', () => {
    assert.strictEqual(source.entries(db, 1, { bankroll: 'all' }).length, 3);
    assert.deepStrictEqual(source.entries(db, 1, { bankroll: 'main' }).map((r) => r.amount), [-412.37, -23.5]);
    assert.deepStrictEqual(source.entries(db, 1, { bankroll: 10 }).map((r) => r.amount), [55]);
    assert.deepStrictEqual(source.entries(db, 1, { bankroll: '10' }).map((r) => r.amount), [55]);
  });

  test('another user\'s bankroll throws 404; a malformed one 400', () => {
    assert.throws(() => source.entries(db, 1, { bankroll: 20 }), (e) => e.status === 404);
    assert.throws(() => source.entries(db, 1, { bankroll: 'x; DROP' }), (e) => e.status === 400);
  });

  test('date range is inclusive on both ends', () => {
    assert.deepStrictEqual(source.entries(db, 1, { from: '2026-06-03' }).map((r) => r.date), ['2026-06-03', '2026-07-15']);
    assert.deepStrictEqual(source.entries(db, 1, { to: '2026-06-03' }).map((r) => r.date), ['2026-06-02', '2026-06-03']);
    assert.deepStrictEqual(source.entries(db, 1, { from: '2026-06-03', to: '2026-06-03' }).map((r) => r.date), ['2026-06-03']);
    assert.throws(() => source.entries(db, 1, { from: '06/03/2026' }), (e) => e.status === 400);
  });

  test('user isolation: user 2 sees only their own row', () => {
    const rows = source.entries(db, 2);
    assert.deepStrictEqual(rows.map((r) => [r.amount, r.currency, r.bankroll_id]), [[-999, 'EUR', 20]]);
    assert.deepStrictEqual(source.entries(db, 3), []);
  });

  test('eventDate reads ISO and "Month D, YYYY" without a zone shift', () => {
    assert.strictEqual(tx.eventDate('2026-01-01'), '2026-01-01');
    assert.strictEqual(tx.eventDate('2026-01-01T23:00:00Z'), '2026-01-01');
    assert.strictEqual(tx.eventDate('October 9, 2026'), '2026-10-09');
    assert.strictEqual(tx.eventDate('garbage'), '');
    assert.strictEqual(tx.eventDate(null), '');
  });

  db.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
