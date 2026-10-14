// Bankroll reports (lib/bankroll-reports.js): the facts behind the dashboard's Reports tab —
// collectFacts against a scratch sql.js DB (every source, the money rules, currency, scope, the
// date window), then GET /api/bankrolls/reports end to end on a scratch server (gate, isolation,
// validation).
//
//   node test/bankroll-reports.test.js        (or: npm run test:bankroll-reports)
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
const reports = require('../lib/bankroll-reports');
const bankrolls = require('../lib/bankrolls');
const cashSessions = require('../lib/cash-sessions');
const transactions = require('../lib/bankroll-transactions');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n       ') : err}`); }
}
const RATES = { USD: 1, EUR: 0.8 };

function scratchDb(SQL) {
  const db = new SQL.Database();
  db.run('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
  db.run(`CREATE TABLE tournaments (id INTEGER PRIMARY KEY AUTOINCREMENT, event_number TEXT, event_name TEXT NOT NULL, date TEXT NOT NULL,
    time TEXT NOT NULL DEFAULT '', buyin INTEGER NOT NULL, game_variant TEXT NOT NULL DEFAULT 'NLH', venue TEXT NOT NULL,
    property TEXT, total_entries INTEGER, is_online INTEGER, site TEXT)`);
  db.run(`CREATE TABLE tracking_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, tournament_id INTEGER NOT NULL,
    num_entries INTEGER NOT NULL DEFAULT 1, cashed INTEGER NOT NULL DEFAULT 0, finish_place INTEGER, cash_amount INTEGER DEFAULT 0,
    notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, bankroll_id INTEGER)`);
  bankrolls.migrate(db);
  cashSessions.migrate(db);
  transactions.migrate(db);
  return db;
}
function addEvent(db, o) {
  db.run('INSERT INTO tournaments (event_name, date, time, buyin, game_variant, venue, property, is_online, site) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [o.name, o.date, o.time || '12:00 PM', o.buyin, o.game || 'NLH', o.venue || 'Test Series', o.property || null, o.online ? 1 : 0, o.site || null]);
  const tid = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  db.run('INSERT INTO tracking_entries (user_id, tournament_id, num_entries, cashed, cash_amount, bankroll_id) VALUES (?, ?, ?, ?, ?, ?)',
    [o.user || 1, tid, o.bullets || 1, o.cash ? 1 : 0, o.cash || 0, o.bankroll == null ? null : o.bankroll]);
}
function addCash(db, o) {
  db.run(`INSERT INTO cash_sessions (user_id, bankroll_id, started_at, ended_at, session_date, room, game, stakes, buy_in, cash_out, tips, expenses, currency, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'x')`,
  [o.user || 1, o.bankroll == null ? null : o.bankroll, o.start, o.end || null, o.date, o.room || '', o.game || 'NLH', o.stakes || '2/5',
    o.buyIn, o.cashOut == null ? null : o.cashOut, o.tips || 0, o.expenses || 0, o.currency || 'USD']);
}
function addTx(db, o) {
  db.run(`INSERT INTO bankroll_transactions (user_id, bankroll_id, occurred_on, kind, category, amount, currency, note, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'x')`, [o.user || 1, o.bankroll == null ? null : o.bankroll, o.date, o.kind, o.category, o.amount, o.currency || 'USD', o.note || null]);
}

(async () => {
  const SQL = await require(path.join(ROOT, 'node_modules', 'sql.js'))();
  const db = scratchDb(SQL);
  db.run("INSERT INTO bankrolls (user_id, name, starting_balance, currency, archived, sort_order, created_at) VALUES (1, 'Staked', 0, 'USD', 0, 0, 'x')");
  const STAKED = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  addEvent(db, { name: 'Daily', date: '2026-10-03', time: '7:00 PM', buyin: 200, property: 'Borgata' });
  addEvent(db, { name: 'Main', date: '2026-10-04', time: '11:00 AM', buyin: 600, bullets: 2, cash: 3000, game: 'PLO', property: 'Parx', bankroll: STAKED });
  addEvent(db, { name: 'Online', date: '2026-09-01', time: 'TBA', buyin: 100, online: true, site: 'GGPoker' });
  addEvent(db, { name: 'Dublin', date: '2026-03-20', buyin: 500, venue: 'Irish Poker Open' }); // EUR
  addEvent(db, { user: 2, name: 'Not mine', date: '2026-10-04', buyin: 999 });
  addCash(db, { date: '2026-10-02', start: '2026-10-02T23:00:00.000Z', end: '2026-10-03T04:30:00.000Z', room: 'Parx', stakes: '2/5', buyIn: 1000, cashOut: 1600, tips: 20, expenses: 30 });
  addCash(db, { date: '2026-10-05', start: '2026-10-05T18:00:00.000Z', end: '2026-10-05T20:00:00.000Z', room: 'ACR', stakes: '1/2', buyIn: 200, cashOut: 50, bankroll: STAKED });
  addCash(db, { date: '2026-10-09', start: '2026-10-09T18:00:00.000Z', room: 'Parx', buyIn: 500 }); // live: not a fact
  addCash(db, { user: 2, date: '2026-10-02', start: '2026-10-02T18:00:00.000Z', end: '2026-10-02T19:00:00.000Z', buyIn: 1, cashOut: 2 });
  addTx(db, { date: '2026-10-02', kind: 'expense', category: 'lodging', amount: 240.5, note: 'Hotel' });
  addTx(db, { date: '2026-09-30', kind: 'income', category: 'rakeback', amount: 100, currency: 'EUR' });

  const facts = (o = {}) => reports.collectFacts(db, 1, { currency: 'USD', rates: RATES, ...o });

  await test('collectFacts: one fact per result, ended session and transaction, sorted by date', () => {
    const f = facts();
    assert.deepStrictEqual(f.map((x) => [x.date, x.type]), [
      ['2026-03-20', 'tournament'], ['2026-09-01', 'tournament'], ['2026-09-30', 'income'], ['2026-10-02', 'cash'], ['2026-10-02', 'expense'],
      ['2026-10-03', 'tournament'], ['2026-10-04', 'tournament'], ['2026-10-05', 'cash']]);
  });
  await test('tournaments: the ledger net, room from property / site, game, online, start hour, buy-in', () => {
    const f = facts();
    const main = f.find((x) => x.label === 'Main');
    assert.deepStrictEqual([main.profit, main.cost, main.cash, main.bullets, main.buyin, main.buyin_usd, main.room, main.game, main.hour, main.online, main.bankroll],
      [3000 - 1200, 1200, 3000, 2, 600, 600, 'Parx', 'PLO', 11, false, STAKED]);
    const daily = f.find((x) => x.label === 'Daily');
    assert.deepStrictEqual([daily.profit, daily.room, daily.hour, daily.bankroll], [-200, 'Borgata', 19, 'main']);
    const online = f.find((x) => x.label === 'Online');
    assert.deepStrictEqual([online.room, online.online, online.hour], ['GGPoker', true, null]);
  });
  await test('currency: a EUR event and EUR income convert through USD; display in EUR too', () => {
    const f = facts();
    const dub = f.find((x) => x.label === 'Dublin');
    assert.strictEqual(dub.profit, -625);              // -500 EUR / 0.8
    assert.strictEqual(dub.buyin_usd, 625);
    assert.strictEqual(f.find((x) => x.type === 'income').profit, 125);
    // The currency each was played or spent in, before conversion (the Locations tab's "Live • EUR").
    assert.deepStrictEqual(['Dublin', 'Daily'].map((l) => f.find((x) => x.label === l).native_currency), ['EUR', 'USD']);
    assert.deepStrictEqual([f.find((x) => x.type === 'income').native_currency, f.find((x) => x.type === 'cash').native_currency], ['EUR', 'USD']);
    const e = facts({ currency: 'EUR' });
    assert.strictEqual(e.find((x) => x.label === 'Dublin').profit, -500);
    assert.strictEqual(e.find((x) => x.label === 'Daily').profit, -160);
  });
  await test('cash: net after tips and expenses, length in hours, start instant, live is left out, online by room', () => {
    const c = facts().filter((x) => x.type === 'cash');
    assert.strictEqual(c.length, 2, 'the live session is not a fact');
    assert.deepStrictEqual([c[0].profit, c[0].hours, c[0].started_at, c[0].stakes, c[0].room, c[0].online, c[0].hour],
      [550, 5.5, '2026-10-02T23:00:00.000Z', '2/5', 'Parx', false, null]);
    assert.deepStrictEqual([c[1].profit, c[1].online, c[1].bankroll], [-150, true, STAKED]);
  });
  await test('cash, time_known = 0 (money merge): the fact carries no start instant, so no hour of day can be derived; length and net survive', () => {
    const d2 = scratchDb(SQL);
    // what the 'money-merge-2026-10' migration adds to cash_sessions
    d2.run('ALTER TABLE cash_sessions ADD COLUMN time_known INTEGER NOT NULL DEFAULT 1');
    addCash(d2, { date: '2026-10-02', start: '2026-10-02T16:00:00.000Z', end: '2026-10-02T19:30:00.000Z', room: 'Parx', buyIn: 200, cashOut: 260 }); // a placeholder noon
    addCash(d2, { date: '2026-10-03', start: '2026-10-03T23:00:00.000Z', end: '2026-10-04T01:00:00.000Z', room: 'Parx', buyIn: 100, cashOut: 90 });
    d2.run("UPDATE cash_sessions SET time_known = 0 WHERE session_date = '2026-10-02'");
    const c = reports.collectFacts(d2, 1, { currency: 'USD', rates: RATES }).filter((x) => x.type === 'cash');
    assert.deepStrictEqual(c.map((x) => [x.date, x.started_at, x.hour, x.hours, x.profit]), [
      ['2026-10-02', null, null, 3.5, 60], ['2026-10-03', '2026-10-03T23:00:00.000Z', null, 2, -10]]);
    d2.close();
  });
  await test('expenses: negative, with a category and no room', () => {
    const x = facts().find((r) => r.type === 'expense');
    assert.deepStrictEqual([x.profit, x.category, x.room, x.label], [-240.5, 'lodging', '', 'Hotel']);
  });
  await test('scope and window: main, a bankroll id, from / to', () => {
    assert.deepStrictEqual(facts({ bankroll: STAKED }).map((x) => x.label), ['Main', 'Cash NLH 1/2 · ACR']);
    assert.ok(facts({ bankroll: 'main' }).every((x) => x.bankroll === 'main'));
    assert.strictEqual(facts({ bankroll: 'main' }).length, 6);
    assert.deepStrictEqual(facts({ from: '2026-10-01', to: '2026-10-03' }).map((x) => x.type), ['cash', 'expense', 'tournament']);
  });
  await test('startHour', () => {
    assert.deepStrictEqual(['11:00 AM', '7:30 pm', '12:00 PM', '12 AM', '14:00', '0:15', 'TBA', '', '13 PM'].map(reports.startHour),
      [11, 19, 12, 0, 14, 0, null, null, null]);
  });
  await test('online rooms: named sites only', () => {
    for (const r of ['ACR', 'GGPoker', 'PokerStars', 'WSOP.com', 'ClubWPT Gold', 'Online home game', 'BetRivers', 'Borgata Online', 'Phenom']) assert.ok(reports.ONLINE_ROOM.test(r), r);
    for (const r of ['Parx', 'Borgata', 'Maryland Live', 'Rivers Philadelphia', 'Stars Casino']) assert.ok(!reports.ONLINE_ROOM.test(r), r);
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-reports-'));
  try { await routes(tmp); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

async function routes(tmp) {
  const PORT = 48000 + Math.floor(Math.random() * 1500);
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
  Object.assign(env, { JWT_SECRET: 'reports-test-secret', PORT: String(PORT), DB_PATH: dbPath, DISABLE_FEED_INGEST: '1' });
  const pw = 'reports-test-password';
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
  db.run(`INSERT INTO tournaments (event_number, event_name, date, time, buyin, game_variant, venue, property, notes)
          VALUES ('RP-1', 'Reports Test Event', '2026-05-02', '7:00 PM', 250, 'PLO', 'Reports Test Series', 'Reports Room', '')`);
  const T = db.exec("SELECT id FROM tournaments WHERE venue = 'Reports Test Series'")[0].values[0][0];
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

    await test('route: no token 401, a normal user 403', async () => {
      assert.strictEqual((await get('/api/bankrolls/reports')).status, 401);
      assert.strictEqual((await get('/api/bankrolls/reports', N)).status, 403);
    });

    const staked = (await post('/api/bankrolls', A, { name: 'Staked', startingBalance: 1000 })).json.bankroll;
    assert.strictEqual((await post('/api/tracking', A, { tournamentId: T, numEntries: 2, cashed: true, cashAmount: 1500 })).status < 300, true);
    const cs = await post('/api/cash-sessions', A, { startedAt: '2026-05-03T22:00:00.000Z', endedAt: '2026-05-04T02:00:00.000Z', date: '2026-05-03',
      buyIn: 500, cashOut: 800, tips: 10, room: 'Parx', game: 'NLH', stakes: '2/5', bankroll: staked.id });
    assert.ok(cs.status < 300, cs.body);
    const tx = await post('/api/bankrolls/transactions', A, { kind: 'expense', category: 'food', amount: 42.5, date: '2026-05-03' });
    assert.ok(tx.status < 300, tx.body);
    await post('/api/cash-sessions', B, { startedAt: '2026-05-03T22:00:00.000Z', endedAt: '2026-05-04T00:00:00.000Z', date: '2026-05-03', buyIn: 1, cashOut: 9 });

    await test('route: every fact of the caller, with dimensions', async () => {
      const r = await get('/api/bankrolls/reports?currency=USD', A);
      assert.strictEqual(r.status, 200, r.body);
      assert.deepStrictEqual(r.json.facts.map((f) => [f.type, f.profit]), [['tournament', 1000], ['cash', 290], ['expense', -42.5]]);
      const t = r.json.facts[0];
      assert.deepStrictEqual([t.room, t.game, t.hour, t.bankroll, t.cost], ['Reports Room', 'PLO', 19, 'main', 500]);
      const c = r.json.facts[1];
      assert.deepStrictEqual([c.hours, c.stakes, c.room, c.bankroll, c.started_at], [4, '2/5', 'Parx', staked.id, '2026-05-03T22:00:00.000Z']);
    });
    await test('route: ?bankroll=, from / to, and validation', async () => {
      assert.deepStrictEqual((await get(`/api/bankrolls/reports?bankroll=${staked.id}`, A)).json.facts.map((f) => f.type), ['cash']);
      assert.deepStrictEqual((await get('/api/bankrolls/reports?bankroll=main', A)).json.facts.map((f) => f.type), ['tournament', 'expense']);
      assert.deepStrictEqual((await get('/api/bankrolls/reports?from=2026-05-03&to=2026-05-03', A)).json.facts.map((f) => f.type), ['cash', 'expense']);
      assert.strictEqual((await get('/api/bankrolls/reports?from=2026-5-3', A)).status, 400);
      assert.strictEqual((await get('/api/bankrolls/reports?from=2026-05-04&to=2026-05-03', A)).status, 400);
      assert.strictEqual((await get('/api/bankrolls/reports?currency=XYZ', A)).status, 400);
      assert.strictEqual((await get('/api/bankrolls/reports?bankroll=abc', A)).status, 400);
    });
    await test('route isolation: bob sees only his own session, and alice\'s bankroll is a 404', async () => {
      const r = await get('/api/bankrolls/reports', B);
      assert.deepStrictEqual(r.json.facts.map((f) => [f.type, f.profit]), [['cash', 8]]);
      assert.strictEqual((await get(`/api/bankrolls/reports?bankroll=${staked.id}`, B)).status, 404);
    });
  } finally { await down(child); }
}
