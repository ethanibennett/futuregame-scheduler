// The combined bankroll ledger: the source loader (auto-loading from a configurable dir), the two
// built-in sources against a scratch sql.js DB, the running-balance math, the rules guide and the
// risk-of-ruin model — then the routes end to end on a scratch server (gate, isolation, import
// dedupe, prefs, risk).
//
//   node test/bankroll-ledger.test.js        (or: npm run test:bankroll-ledger)
//
// Scratch port (never 3001), scratch DB (never poker-tournaments.db), stubbed solver,
// DISABLE_FEED_INGEST=1.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ledger = require('../lib/bankroll-ledger');
const mgmt = require('../lib/bankroll-management');
const imp = require('../lib/bankroll-import');
const analytics = require('../lib/analytics');
const bankrolls = require('../lib/bankrolls');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n       ') : err}`); }
}
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${b}, got ${a}`);
const RATES = { USD: 1, EUR: 0.8, GBP: 0.5 };

// A minimal schema: the columns the sources read.
function scratchDb(SQL) {
  const db = new SQL.Database();
  db.run(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)`);
  db.run(`CREATE TABLE tournaments (id INTEGER PRIMARY KEY AUTOINCREMENT, event_number TEXT, event_name TEXT NOT NULL, date TEXT NOT NULL,
    time TEXT NOT NULL DEFAULT '', buyin INTEGER NOT NULL, game_variant TEXT NOT NULL DEFAULT 'NLH', venue TEXT NOT NULL,
    property TEXT, total_entries INTEGER, is_online INTEGER, site TEXT)`);
  db.run(`CREATE TABLE tracking_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, tournament_id INTEGER NOT NULL,
    num_entries INTEGER NOT NULL DEFAULT 1, cashed INTEGER NOT NULL DEFAULT 0, finish_place INTEGER, cash_amount INTEGER DEFAULT 0,
    notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, bankroll_id INTEGER)`);
  bankrolls.migrate(db);
  mgmt.migrate(db);
  imp.migrate(db);
  return db;
}
function addEvent(db, { user = 1, name, date, time = '12:00 PM', buyin, venue = 'Test Venue', bullets = 1, cashed = 0, cash = 0, bankroll = null }) {
  db.run('INSERT INTO tournaments (event_name, date, time, buyin, venue) VALUES (?, ?, ?, ?, ?)', [name, date, time, buyin, venue]);
  const tid = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  db.run('INSERT INTO tracking_entries (user_id, tournament_id, num_entries, cashed, cash_amount, bankroll_id) VALUES (?, ?, ?, ?, ?, ?)',
    [user, tid, bullets, cashed, cash, bankroll]);
  return db.exec('SELECT last_insert_rowid()')[0].values[0][0];
}

(async () => {
  const SQL = await require(path.join(ROOT, 'node_modules', 'sql.js'))();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-ledger-'));

  // ── the loader ──────────────────────────────────────────────────────────────────────────
  const srcDir = path.join(tmp, 'sources');
  fs.mkdirSync(srcDir);
  const builtin = (f) => `module.exports = require(${JSON.stringify(path.join(ROOT, 'lib', 'ledger-sources', f))});\n`;
  fs.writeFileSync(path.join(srcDir, 'adjustments.js'), builtin('adjustments.js'));
  fs.writeFileSync(path.join(srcDir, 'tournaments.js'), builtin('tournaments.js'));
  // A source nobody wired in: it only has to exist in the directory.
  fs.writeFileSync(path.join(srcDir, 'zz-fake.js'), `module.exports = { name: 'fake', entries(db, userId, opts) {
    return [
      { date: '2026-01-15', ts: null, amount: 42, currency: 'USD', bankroll_id: null, kind: 'fake_win', label: 'Fake ' + userId, ref: { table: 'fake', id: 1 } },
      { date: 'not a date', amount: 1, currency: 'USD', bankroll_id: null, kind: 'x', ref: { table: 'fake', id: 2 } },
    ];
  } };\n`);
  fs.writeFileSync(path.join(srcDir, 'broken-shape.js'), 'module.exports = { name: "nope" };\n');
  fs.writeFileSync(path.join(srcDir, 'throws-on-load.js'), 'throw new Error("boom at load");\n');
  fs.writeFileSync(path.join(srcDir, 'notes.txt'), 'not a source');

  await test('loader: picks up every *.js in the dir, reports the broken ones, ignores other files', () => {
    const L = ledger.loadSources(srcDir);
    assert.deepStrictEqual(L.sources.map((s) => s.name), ['adjustments', 'tournaments', 'fake']);
    assert.deepStrictEqual(L.errors.map((e) => e.file).sort(), ['broken-shape.js', 'throws-on-load.js']);
  });
  await test('loader: BANKROLL_LEDGER_SOURCES_DIR points it elsewhere; the default dir has the built-ins', () => {
    process.env.BANKROLL_LEDGER_SOURCES_DIR = srcDir;
    assert.ok(ledger.loadSources().sources.some((s) => s.name === 'fake'));
    delete process.env.BANKROLL_LEDGER_SOURCES_DIR;
    const names = ledger.loadSources().sources.map((s) => s.name);
    assert.ok(names.includes('tournaments') && names.includes('adjustments'), names.join());
    assert.ok(!names.includes('fake'));
  });
  await test('collect: a fake source flows in, its malformed entry is counted invalid; a throwing source is reported, not fatal', () => {
    const db = scratchDb(SQL);
    const L = ledger.loadSources(srcDir);
    L.sources.push({ name: 'explodes', entries() { throw new Error('table missing'); } });
    const { entries, report } = ledger.collect(db, 7, { bankroll: 'all' }, L);
    assert.deepStrictEqual(entries.map((e) => [e.source, e.amount, e.label]), [['fake', 42, 'Fake 7']]);
    const by = Object.fromEntries(report.map((r) => [r.name, r]));
    assert.deepStrictEqual([by.fake.count, by.fake.invalid], [1, 1]);
    assert.strictEqual(by.explodes.ok, false);
    assert.strictEqual(by['broken-shape.js'].ok, false);
  });

  // ── the two built-in sources ────────────────────────────────────────────────────────────
  const db = scratchDb(SQL);
  db.run("INSERT INTO bankrolls (user_id, name, starting_balance, currency, created_at) VALUES (1, 'Online EUR', 1000, 'EUR', '2026-01-01')");
  const EURB = 1;
  const e1 = addEvent(db, { name: 'Cashed Twice-Bullet', date: '2026-03-01', buyin: 100, bullets: 2, cashed: 1, cash: 500 });
  const e2 = addEvent(db, { name: 'Bust', date: '2026-03-02', time: '7:30 PM', buyin: 200 });
  const e3 = addEvent(db, { name: 'Cash amount but not cashed', date: '2026-03-03', buyin: 50, cashed: 0, cash: 999 });
  const e4 = addEvent(db, { name: 'Zero bullets reads as one', date: 'Mar 4, 2026', buyin: 80, bullets: 0 });
  const e5 = addEvent(db, { name: 'Irish Main', date: '2026-03-05', buyin: 1000, venue: 'Irish Poker Open', cashed: 1, cash: 3000, bankroll: EURB });
  addEvent(db, { user: 2, name: 'Someone else', date: '2026-03-01', buyin: 5000 });
  db.run("INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, occurred_on, note, created_at) VALUES (1, NULL, 'deposit', 2000, '2026-02-01', 'opening', 'x')");
  db.run("INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, transfer_id, occurred_on, created_at) VALUES (1, NULL, 'transfer_out', -500, 't1', '2026-03-03', 'x')");
  db.run("INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, transfer_id, occurred_on, created_at) VALUES (1, 1, 'transfer_in', 400, 't1', '2026-03-03', 'x')");
  db.run("INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, occurred_on, created_at) VALUES (2, NULL, 'deposit', 77, '2026-02-01', 'x')");
  const tSrc = require('../lib/ledger-sources/tournaments');
  const aSrc = require('../lib/ledger-sources/adjustments');

  await test('tournaments source: net = cash (only when cashed) - buy-in x bullets, in the venue currency', () => {
    const by = Object.fromEntries(tSrc.entries(db, 1, { bankroll: 'all' }).map((e) => [e.ref.id, e]));
    assert.strictEqual(Object.keys(by).length, 5, 'only user 1');
    assert.deepStrictEqual([by[e1].amount, by[e1].units, by[e1].currency], [300, 2, 'USD']);
    assert.strictEqual(by[e2].amount, -200);
    assert.strictEqual(by[e2].ts, '2026-03-02T19:30:00');
    assert.strictEqual(by[e3].amount, -50, 'a cash_amount without cashed counts 0, as the Results tab');
    assert.deepStrictEqual([by[e4].amount, by[e4].date], [-80, '2026-03-04']);
    assert.deepStrictEqual([by[e5].amount, by[e5].currency, by[e5].bankroll_id], [2000, 'EUR', EURB]);
    assert.deepStrictEqual(by[e1].ref, { table: 'tracking_entries', id: e1 });
  });
  await test('tournaments source: equals lib/analytics.js profit, entry for entry and in total', () => {
    const raw = [];
    const s = db.prepare('SELECT te.*, t.event_name, t.date, t.time, t.buyin, t.venue FROM tracking_entries te JOIN tournaments t ON t.id = te.tournament_id WHERE te.user_id = 1');
    while (s.step()) raw.push(s.getAsObject());
    s.free();
    const a = analytics.computeAnalytics(raw, { currency: 'USD', rates: RATES });
    const sum = tSrc.entries(db, 1, {}).reduce((t, e) => t + analytics.convert(e.amount, e.currency, 'USD', RATES), 0);
    near(sum, a.totals.profit, 1e-9);
    for (const r of raw) {
      const n = analytics.normaliseRow(r, 'USD', RATES);
      const e = tSrc.entries(db, 1, {}).find((x) => x.ref.id === r.id);
      near(analytics.convert(e.amount, e.currency, 'USD', RATES), n.profit, 1e-9, r.event_name);
    }
  });
  await test('tournaments source: bankroll and date filters', () => {
    assert.deepStrictEqual(tSrc.entries(db, 1, { bankroll: EURB }).map((e) => e.ref.id), [e5]);
    assert.strictEqual(tSrc.entries(db, 1, { bankroll: 'main' }).length, 4);
    assert.deepStrictEqual(tSrc.entries(db, 1, { from: '2026-03-02', to: '2026-03-03' }).map((e) => e.ref.id).sort(), [e2, e3].sort());
  });
  await test('adjustments source: signed amounts in the bankroll currency, Main in USD, scoped by user and bankroll', () => {
    const all = aSrc.entries(db, 1, {});
    assert.deepStrictEqual(all.map((e) => [e.kind, e.amount, e.currency, e.bankroll_id]).sort(), [
      ['deposit', 2000, 'USD', null], ['transfer_in', 400, 'EUR', 1], ['transfer_out', -500, 'USD', null]].sort());
    assert.strictEqual(all.find((e) => e.kind === 'deposit').label, 'Deposit · opening');
    assert.deepStrictEqual(aSrc.entries(db, 1, { bankroll: 1 }).map((e) => e.kind), ['transfer_in']);
    assert.strictEqual(aSrc.entries(db, 2, {}).length, 1);
  });

  // ── running balances ────────────────────────────────────────────────────────────────────
  const L2 = { sources: [{ name: 'adjustments', entries: aSrc.entries }, { name: 'tournaments', entries: tSrc.entries }], errors: [] };
  const list = bankrolls.listBankrolls(db, 1);
  await test('running balance: starting balances included, each bankroll in its own currency, total in the display currency', () => {
    const { entries } = ledger.collect(db, 1, { bankroll: 'all' }, L2);
    const led = ledger.runningBalances(entries, { bankrollList: list, scope: 'all', currency: 'USD', rates: RATES });
    // Main (USD, start 0): +2000 dep, +300, -200, -500 transfer, -50, -80 = 1470
    // EUR (start 1000): +400 transfer, +2000 result = 3400 EUR = 4250 USD
    assert.strictEqual(led.closing.per.main.balance, 1470);
    assert.strictEqual(led.closing.per[EURB].balance, 3400);
    near(led.closing.total_display, 1470 + 3400 / 0.8, 1e-6);
    assert.strictEqual(led.opening.total_display, 1250, 'opening = the EUR bankroll\'s 1000 starting balance in USD');
    // Order: date, then no-ts before ts. The 03-03 transfer legs (no ts) come before the 03-03 event.
    assert.deepStrictEqual(entries.filter((e) => e.date === '2026-03-03').map((e) => e.source), ['adjustments', 'adjustments', 'tournaments']);
    // Each running total is the previous one plus this entry, converted.
    let t = led.opening.total_display;
    for (const e of led.entries) { t += e.amount_display; near(e.total_display, t, 0.02, e.label); }
    const last = led.entries[led.entries.length - 1];
    near(last.total_display, led.closing.total_display, 0.01);
  });
  await test('running balance: from/to returns the window with the balance carried in', () => {
    const { entries } = ledger.collect(db, 1, { bankroll: 'main', to: '2026-03-03' }, L2);
    const led = ledger.runningBalances(entries, { bankrollList: list, scope: 'main', currency: 'USD', rates: RATES, from: '2026-03-02', to: '2026-03-03' });
    assert.strictEqual(led.opening.per.main.balance, 2300, '2000 deposit + 300 result before the window');
    assert.deepStrictEqual(led.entries.map((e) => e.balance), [2100, 1600, 1550]);
    assert.ok(!(EURB in led.opening.per), 'scope main leaves the EUR bankroll out');
  });
  await test('running balance: a EUR view of a USD bankroll converts amounts and balance', () => {
    const { entries } = ledger.collect(db, 1, { bankroll: 'main' }, L2);
    const led = ledger.runningBalances(entries, { bankrollList: list, scope: 'main', currency: 'EUR', rates: RATES });
    near(led.closing.total_display, 1470 * 0.8, 1e-6);
    assert.strictEqual(led.entries[0].amount_bankroll, 2000);
    assert.strictEqual(led.entries[0].amount_display, 1600);
    assert.strictEqual(led.entries[0].fx_display, 0.8, 'display units per 1 of the entry currency (USD -> EUR)');
  });
  await test("running balance: fx_display puts an entry's own-currency figures on the display scale", () => {
    const { entries } = ledger.collect(db, 1, { bankroll: 'all' }, L2);
    const led = ledger.runningBalances(entries, { bankrollList: list, scope: 'all', currency: 'USD', rates: RATES });
    for (const e of led.entries) {
      assert.strictEqual(e.fx_display, e.currency === 'EUR' ? 1.25 : 1, e.label);
      near(e.amount * e.fx_display, e.amount_display, 0.01, e.label);
    }
  });
  await test('summary: results vs moved, by source, and the total', () => {
    const { entries } = ledger.collect(db, 1, { bankroll: 'all' }, L2);
    const led = ledger.runningBalances(entries, { bankrollList: list, scope: 'all', currency: 'USD', rates: RATES });
    const s = ledger.summarise(led, { bankrollList: list, scope: 'all', currency: 'USD', rates: RATES });
    const main = s.bankrolls.find((b) => b.id === 'main');
    assert.deepStrictEqual([main.start, main.moved, main.results, main.balance], [0, 1500, -30, 1470]);
    assert.deepStrictEqual(main.by_source, { adjustments: 1500, tournaments: -30 });
    const eur = s.bankrolls.find((b) => b.id === EURB);
    assert.deepStrictEqual([eur.start, eur.moved, eur.results, eur.balance, eur.currency], [1000, 400, 2000, 3400, 'EUR']);
    near(s.all.balance, 1470 + 3400 / 0.8, 0.01);
    near(s.all.results, -30 + 2000 / 0.8, 0.01);
  });

  await test('money merge: correction and settlement are signed, labelled, move the balance and never count as results', () => {
    assert.ok(ledger.MOVE_KINDS.has('correction') && ledger.MOVE_KINDS.has('settlement'));
    for (const k of ['deposit', 'withdrawal', 'transfer_in', 'transfer_out']) assert.ok(ledger.MOVE_KINDS.has(k), k);
    const d2 = scratchDb(SQL);
    d2.run("INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, occurred_on, note, created_at) VALUES (1, NULL, 'deposit', 1000, '2026-04-01', NULL, 'x')");
    d2.run("INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, occurred_on, note, created_at) VALUES (1, NULL, 'correction', -3, '2026-04-02', 'rounding', 'x')");
    d2.run("INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, occurred_on, note, created_at) VALUES (1, NULL, 'settlement', -250, '2026-04-03', 'WSOP: backers', 'x')");
    d2.run("INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, occurred_on, note, created_at) VALUES (1, NULL, 'settlement', 40, '2026-04-04', NULL, 'x')"); // a backer paid in
    addEvent(d2, { name: 'MM Event', date: '2026-04-05', buyin: 100, cashed: 1, cash: 600 }); // +500
    const L = { sources: [{ name: 'adjustments', entries: aSrc.entries }, { name: 'tournaments', entries: tSrc.entries }], errors: [] };
    const got = aSrc.entries(d2, 1, {});
    assert.deepStrictEqual(got.map((e) => [e.kind, e.amount, e.label]).sort(), [
      ['correction', -3, 'Correction · rounding'], ['deposit', 1000, 'Deposit'],
      ['settlement', -250, 'Paid to backers · WSOP: backers'], ['settlement', 40, 'Paid to backers']].sort());
    const lst = bankrolls.listBankrolls(d2, 1);
    const { entries } = ledger.collect(d2, 1, { bankroll: 'all' }, L);
    const led = ledger.runningBalances(entries, { bankrollList: lst, scope: 'all', currency: 'USD', rates: RATES });
    const sum = ledger.summarise(led, { bankrollList: lst, scope: 'all', currency: 'USD', rates: RATES });
    const main = sum.bankrolls.find((b) => b.id === 'main');
    assert.deepStrictEqual([main.moved, main.results, main.balance], [1000 - 3 - 250 + 40, 500, 1000 - 3 - 250 + 40 + 500], 'moved, never profit');
    assert.deepStrictEqual([main.by_kind.correction, main.by_kind.settlement], [-3, -210]);
    assert.deepStrictEqual([sum.all.moved, sum.all.results], [787, 500]);
    assert.strictEqual(led.closing.per.main.balance, 1287);
    d2.close();
  });

  // ── the rules guide ─────────────────────────────────────────────────────────────────────
  await test('guide: cap = roll / N; over the cap is "down", covering the next tier is "up", too few entries is null', () => {
    const recent = (v, n = 10) => Array(n).fill(v);
    const g1 = mgmt.mttGuide({ balance: 10000, buyins: 100, recent: recent(150) });
    assert.deepStrictEqual([g1.cap, g1.signal, g1.reason], [100, 'down', 'over']);
    const g2 = mgmt.mttGuide({ balance: 50000, buyins: 100, recent: recent(150) });
    assert.deepStrictEqual([g2.cap, g2.signal, g2.nextTier.label], [500, 'up', '$300–799']);
    const g3 = mgmt.mttGuide({ balance: 25000, buyins: 100, recent: recent(150) });
    assert.strictEqual(g3.signal, 'hold');
    assert.strictEqual(mgmt.mttGuide({ balance: 25000, buyins: 100, recent: recent(150, 4) }).signal, null);
    assert.strictEqual(mgmt.mttGuide({ balance: -5, buyins: 100, recent: recent(150) }).signal, 'down');
    near(g1.percent, 1);
  });
  await test('prefs: defaults until set, validated, a reset goes back to the default', () => {
    const p = mgmt.prefsFor({}, 'all');
    assert.deepStrictEqual(p.rules, { mtt: { buyins: 100 }, cash: { buyins: 30 } });
    assert.deepStrictEqual(p.custom, { mtt: false, cash: false });
    assert.ok(mgmt.cleanRules({ mtt: { buyins: 0 } }, mgmt.DEFAULT_RULES).error);
    assert.ok(mgmt.cleanGoals([{ period: 'week', metric: 'profit', target: 5 }], []).error);
    assert.strictEqual(mgmt.cleanGoals([{ period: 'month', metric: 'profit', target: 5000 }], []).value[0].target, 5000);
  });

  // ── risk of ruin ────────────────────────────────────────────────────────────────────────
  await test('risk of ruin: not enough data below the threshold; exp(-2 mu B / sigma^2) above it', () => {
    const row = (cash) => analytics.normaliseRow({ id: Math.random(), buyin: 100, num_entries: 1, cashed: cash > 0 ? 1 : 0, cash_amount: cash, venue: 'X', date: '2026-01-01' }, 'USD', RATES);
    const few = Array.from({ length: 50 }, (_, i) => row(i % 5 === 0 ? 400 : 0));
    assert.strictEqual(mgmt.riskOfRuin(few, 10000).status, 'insufficient');
    // 200 entries: every 5th cashes 5.5x the buy-in (+4.5 buy-ins), the rest lose 1. mu = (4.5 - 4) / 5 = 0.1.
    const rows = Array.from({ length: 200 }, (_, i) => row(i % 5 === 0 ? 550 : 0));
    const r = mgmt.riskOfRuin(rows, 10000);
    assert.strictEqual(r.status, 'ok');
    near(r.mean, 0.1, 1e-9);
    const sd = analytics.meanSd(rows.map((x) => (x.cash - x.buyin) / x.buyin)).sd;
    near(r.sd, sd, 1e-12);
    near(r.bankrollBuyins, 100, 1e-9);
    near(r.ror, Math.exp(-2 * 0.1 * 100 / (sd * sd)), 1e-12);
    near(r.buyinsFor.p5, -Math.log(0.05) * sd * sd / 0.2, 1e-9);
    // A losing record: certain ruin under the model.
    const losing = Array.from({ length: 200 }, (_, i) => row(i % 10 === 0 ? 300 : 0));
    assert.strictEqual(mgmt.riskOfRuin(losing, 10000).ror, 1);
    assert.strictEqual(mgmt.riskOfRuin(rows, 0).status, 'empty');
  });

  // ── import (pure parts) ─────────────────────────────────────────────────────────────────
  await test('import: rows are validated; identical rows in one file get distinct fingerprints, a re-import the same ones', () => {
    const C = new Set(['USD', 'EUR']);
    assert.ok(imp.cleanRow({ type: 'tournament', date: '2026-13-01', buyin: 5 }, C).error);
    assert.ok(imp.cleanRow({ type: 'tournament', date: '2026-01-01' }, C).error, 'buy-in required');
    assert.ok(imp.cleanRow({ type: 'deposit', date: '2026-01-01', amount: -1 }, C).error);
    assert.ok(imp.cleanRow({ type: 'tournament', date: '2026-01-01', buyin: 5, currency: 'XYZ' }, C).error);
    const rows = [{ type: 'deposit', date: '2026-01-01', amount: 100 }, { type: 'deposit', date: '2026-01-01', amount: 100 }].map((r) => imp.cleanRow(r, C).value);
    const a = imp.fingerprints(rows), b = imp.fingerprints(rows);
    assert.notStrictEqual(a[0], a[1]);
    assert.deepStrictEqual(a, b);
  });

  // ── the routes, end to end ──────────────────────────────────────────────────────────────
  await routes(tmp, srcDir);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

async function routes(tmp, srcDir) {
  const PORT = 46000 + Math.floor(Math.random() * 2000);
  assert.notStrictEqual(PORT, 3001);
  const request = (method, p, { body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const h = { ...headers };
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch (_) { /* not json */ } resolve({ status: res.statusCode, body: b, json }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
  const boot = (env) => {
    const child = spawn(process.execPath, ['-r', path.join(__dirname, 'stub-solver-preload.js'), 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
    return child;
  };
  const up = async (child) => {
    const until = Date.now() + 60000;
    while (Date.now() < until) {
      if (child.exitCode != null) throw new Error('server exited ' + child.exitCode);
      try { if ((await request('GET', '/health')).status === 200) return; } catch (_) { /* not yet */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('server did not come up');
  };
  const down = async (child) => { if (child.exitCode == null) await new Promise((r) => { child.once('exit', r); child.kill(); }); };

  const dbPath = path.join(tmp, 'scratch.db');
  assert.notStrictEqual(path.basename(dbPath), 'poker-tournaments.db');
  const env = { ...process.env };
  for (const k of ['SYNC_TOKEN', 'DASHBOARD_TOKEN', 'TESTFLIGHT_WATCHDOG', 'RENDER_DEPLOY_WATCHDOG', 'SMTP_HOST', 'SMTP_USER',
    'SMTP_PASS', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'RENDER', 'TRUST_PROXY']) delete env[k];
  Object.assign(env, { JWT_SECRET: 'ledger-test-secret', PORT: String(PORT), DB_PATH: dbPath, DISABLE_FEED_INGEST: '1',
    BANKROLL_LEDGER_SOURCES_DIR: srcDir });
  const pw = 'ledger-test-password';
  let child = boot(env);
  try {
    await up(child);
    for (const u of ['alicex', 'bobx', 'normal']) {
      const r = await request('POST', '/api/register', { body: { username: u, email: `${u}@x.test`, password: pw, realName: u } });
      assert.strictEqual(r.status, 201, `register ${u}: ${r.body}`);
    }
  } finally { await down(child); }
  const SQL = await require(path.join(ROOT, 'node_modules', 'sql.js'))();
  let db = new SQL.Database(fs.readFileSync(dbPath));
  db.run("UPDATE users SET username = 'ham' WHERE username = 'alicex'");
  db.run("UPDATE users SET username = 'ham5' WHERE username = 'bobx'");
  db.run(`INSERT INTO tournaments (event_number, event_name, date, time, buyin, game_variant, venue, notes)
          VALUES ('LG-1', 'Ledger Test Event', '2026-05-01', '12:00 PM', 250, 'NLH', 'Ledger Test Venue', '')`);
  const T = db.exec("SELECT id FROM tournaments WHERE venue = 'Ledger Test Venue'")[0].values[0][0];
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();

  child = boot(env);
  try {
    await up(child);
    const login = async (email) => (await request('POST', '/api/login', { body: { email, password: pw } })).json.token;
    const A = { Authorization: 'Bearer ' + await login('alicex@x.test') };
    const B = { Authorization: 'Bearer ' + await login('bobx@x.test') };
    const N = { Authorization: 'Bearer ' + await login('normal@x.test') };
    const get = (p, h) => request('GET', p, { headers: h });
    const post = (p, h, body) => request('POST', p, { headers: h, body });
    const put = (p, h, body) => request('PUT', p, { headers: h, body });

    await test('routes: no token 401, a normal user 403 on every new route', async () => {
      assert.strictEqual((await get('/api/bankrolls/ledger')).status, 401);
      for (const [m, p] of [['GET', '/api/bankrolls/ledger'], ['GET', '/api/bankrolls/summary'], ['GET', '/api/bankrolls/prefs'],
        ['PUT', '/api/bankrolls/prefs/all'], ['GET', '/api/bankrolls/risk'], ['POST', '/api/bankrolls/import']]) {
        assert.strictEqual((await request(m, p, { headers: N, body: m === 'GET' ? undefined : {} })).status, 403, `${m} ${p}`);
      }
    });

    const staked = (await post('/api/bankrolls', A, { name: 'Staked', startingBalance: 1000 })).json.bankroll;
    await post('/api/bankrolls/adjustments', A, { bankroll: 'main', kind: 'deposit', amount: 5000, date: '2026-04-01' });
    await post('/api/tracking', A, { tournamentId: T, numEntries: 2, cashed: true, cashAmount: 1500 });
    const bobs = (await post('/api/bankrolls', B, { name: 'Bob roll', startingBalance: 7 })).json.bankroll;

    await test('ledger: every source (the fake one too), sorted, with running balances incl. starting balances', async () => {
      const r = await get('/api/bankrolls/ledger?currency=USD', A);
      assert.strictEqual(r.status, 200, r.body);
      assert.deepStrictEqual(r.json.entries.map((e) => [e.date, e.source, e.amount]), [
        ['2026-01-15', 'fake', 42], ['2026-04-01', 'adjustments', 5000], ['2026-05-01', 'tournaments', 1000]]);
      assert.deepStrictEqual(r.json.entries.map((e) => e.total_display), [1042, 6042, 7042]);
      assert.strictEqual(r.json.opening.total_display, 1000);
      assert.ok(r.json.sources.find((s) => s.name === 'broken-shape.js' && !s.ok));
    });
    await test('ledger: ?bankroll= and from/to', async () => {
      const r = await get(`/api/bankrolls/ledger?bankroll=${staked.id}`, A);
      assert.deepStrictEqual([r.json.entries.length, r.json.closing.total_display], [0, 1000]);
      const w = await get('/api/bankrolls/ledger?bankroll=main&from=2026-04-01&to=2026-04-30', A);
      assert.deepStrictEqual([w.json.opening.total_display, w.json.entries.length, w.json.closing.total_display], [42, 1, 5042]);
      assert.strictEqual((await get('/api/bankrolls/ledger?from=2026-4-1', A)).status, 400);
      assert.strictEqual((await get('/api/bankrolls/ledger?currency=XYZ', A)).status, 400);
    });
    await test('summary: balances by bankroll and source, plus the rules guide', async () => {
      const s = (await get('/api/bankrolls/summary?currency=USD', A)).json;
      const main = s.bankrolls.find((b) => b.id === 'main');
      assert.deepStrictEqual([main.balance, main.moved, main.results], [6042, 5000, 1042]);
      assert.deepStrictEqual(main.by_source, { fake: 42, adjustments: 5000, tournaments: 1000 });
      assert.strictEqual(s.all.balance, 7042);
      assert.strictEqual(s.guide.byKey.all.mtt.cap, 70.42);
      assert.strictEqual(s.guide.byKey.main.rules.mtt.buyins, 100);
    });

    await test('isolation: bob sees none of alice\'s ledger, summary, prefs or risk, and cannot write to her bankroll', async () => {
      const bl = (await get('/api/bankrolls/ledger', B)).json;
      assert.deepStrictEqual(bl.entries.map((e) => e.source), ['fake'], 'only the fake source\'s per-user entry');
      assert.strictEqual(bl.closing.total_display, 49, 'his own 7 starting balance + the fake 42');
      assert.strictEqual((await get(`/api/bankrolls/ledger?bankroll=${staked.id}`, B)).status, 404);
      assert.strictEqual((await get(`/api/bankrolls/risk?bankroll=${staked.id}`, B)).status, 404);
      assert.strictEqual((await put(`/api/bankrolls/prefs/${staked.id}`, B, { rules: { mtt: { buyins: 5 } } })).status, 404);
      assert.ok(!(String(staked.id) in (await get('/api/bankrolls/prefs', B)).json.prefs));
      assert.strictEqual((await post('/api/bankrolls/import', B, { bankroll: staked.id, rows: [{ type: 'deposit', date: '2026-01-01', amount: 1 }] })).status, 404);
      const bs = (await get('/api/bankrolls/summary', B)).json;
      assert.deepStrictEqual(bs.bankrolls.map((b) => b.id), ['main', bobs.id]);
    });

    await test('prefs: set a rule and a goal, read them back, reset to the default', async () => {
      const r = await put(`/api/bankrolls/prefs/${staked.id}`, A, { rules: { mtt: { buyins: 200 } }, goals: [{ period: 'month', metric: 'profit', target: 2000 }] });
      assert.strictEqual(r.status, 200, r.body);
      assert.deepStrictEqual([r.json.rules.mtt.buyins, r.json.rules.cash.buyins, r.json.custom.mtt, r.json.goals.length], [200, 30, true, 1]);
      assert.strictEqual((await put('/api/bankrolls/prefs/all', A, { rules: { cash: { buyins: 0 } } })).status, 400);
      const s = (await get('/api/bankrolls/summary', A)).json;
      assert.strictEqual(s.guide.byKey[staked.id].mtt.cap, 5);
      const reset = await put(`/api/bankrolls/prefs/${staked.id}`, A, { reset: ['mtt'] });
      assert.deepStrictEqual([reset.json.rules.mtt.buyins, reset.json.custom.mtt, reset.json.goals.length], [100, false, 1]);
    });

    await test('risk: "insufficient" below the sample threshold', async () => {
      const r = (await get('/api/bankrolls/risk', A)).json;
      assert.deepStrictEqual([r.status, r.n, r.minEntries], ['insufficient', 2, 100]);
    });

    await test('import: preview writes nothing; commit writes; a re-import is all duplicates', async () => {
      const rows = [
        { type: 'tournament', date: '2025-06-01', name: 'Imported Daily', buyin: 100, entries: 1, cash: 0 },
        { type: 'tournament', date: '2025-06-02', name: 'Imported Main', buyin: 300, entries: 2, cash: 1200, place: 4, field: 120 },
        { type: 'deposit', date: '2025-05-30', amount: 800, note: 'from PBT' },
        { type: 'withdrawal', date: '2025-06-03', amount: 50 },
        { type: 'deposit', date: '2025-06-03', amount: 50, currency: 'EUR' },
        { type: 'tournament', date: 'yesterday', buyin: 1 },
      ];
      const pre = await post('/api/bankrolls/import', A, { bankroll: staked.id, rows });
      assert.strictEqual(pre.status, 200, pre.body);
      assert.deepStrictEqual(pre.json.counts, { new: 4, duplicate: 0, error: 2 });
      assert.strictEqual((await get(`/api/bankrolls/ledger?bankroll=${staked.id}`, A)).json.entries.length, 0, 'preview wrote nothing');
      const c = await post('/api/bankrolls/import', A, { bankroll: staked.id, rows, commit: true });
      assert.deepStrictEqual([c.json.imported, c.json.counts.new], [4, 4]);
      const led = (await get(`/api/bankrolls/ledger?bankroll=${staked.id}`, A)).json;
      assert.deepStrictEqual(led.entries.map((e) => [e.date, e.kind, e.amount]), [
        ['2025-05-30', 'deposit', 800], ['2025-06-01', 'tournament', -100], ['2025-06-02', 'tournament', 600], ['2025-06-03', 'withdrawal', -50]]);
      assert.strictEqual(led.closing.total_display, 1000 + 800 - 100 + 600 - 50);
      const tr = (await get(`/api/tracking?bankroll=${staked.id}`, A)).json;
      assert.deepStrictEqual(tr.map((t) => [t.event_name, t.venue, t.num_entries, t.finish_place]).sort(),
        [['Imported Daily', 'Personal', 1, null], ['Imported Main', 'Personal', 2, 4]]);
      const again = await post('/api/bankrolls/import', A, { bankroll: staked.id, rows, commit: true });
      assert.deepStrictEqual([again.json.imported, again.json.counts.duplicate], [0, 4]);
      // Imported events are private: not in the public list.
      const pub = (await get('/api/tournaments?search=Imported', A)).json;
      const list = Array.isArray(pub) ? pub : (pub.tournaments || []);
      assert.ok(!list.some((t) => /^Imported /.test(t.event_name)));
    });
    await test('import: a deleted import imports again (its key is stale)', async () => {
      const adj = (await get(`/api/bankrolls/adjustments?bankroll=${staked.id}`, A)).json.adjustments.find((a) => a.amount === -50);
      await request('DELETE', `/api/bankrolls/adjustments/${adj.id}`, { headers: A });
      const r = await post('/api/bankrolls/import', A, { bankroll: staked.id, rows: [{ type: 'withdrawal', date: '2025-06-03', amount: 50 }], commit: true });
      assert.strictEqual(r.json.imported, 1);
    });
  } finally { await down(child); }
}
