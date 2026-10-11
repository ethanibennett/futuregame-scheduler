// Expenses, non-game income and trips (beta): /api/bankrolls/transactions and /api/bankrolls/trips —
// the beta gate, validation, filters and totals, a trip's P&L inputs, the bankroll delete guard,
// and CROSS-USER ISOLATION: a user must never read, change, tag or file into another user's rows.
//
//   node test/bankroll-transactions.test.js     (part of npm run test:transactions)
//
// Boots server.js on a scratch port against a scratch DB (never 3001, never poker-tournaments.db),
// with the stub solver and DISABLE_FEED_INGEST: once to register three accounts, then — two of
// them renamed to the admin usernames 'ham' and 'ham5', which sign-up refuses — again to test.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 46000 + Math.floor(Math.random() * 2000);
assert.notStrictEqual(PORT, 3001);

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}

function request(method, p, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const h = { ...headers };
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch (_) { /* not json */ } resolve({ status: res.statusCode, body: b, json }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
function boot(env) {
  const child = spawn(process.execPath, ['-r', path.join(__dirname, 'stub-solver-preload.js'), 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
  return child;
}
async function up(child) {
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    if (child.exitCode != null) throw new Error('server exited ' + child.exitCode);
    try { if ((await request('GET', '/health')).status === 200) return; } catch (_) { /* not yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('server did not come up');
}
async function down(child) {
  if (child.exitCode != null) return;
  await new Promise((r) => { child.once('exit', r); child.kill(); });
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-txn-'));
  const dbPath = path.join(tmp, 'scratch.db');
  assert.notStrictEqual(path.basename(dbPath), 'poker-tournaments.db');
  const env = { ...process.env };
  for (const k of ['SYNC_TOKEN', 'DASHBOARD_TOKEN', 'TESTFLIGHT_WATCHDOG', 'RENDER_DEPLOY_WATCHDOG', 'SMTP_HOST', 'SMTP_USER',
    'SMTP_PASS', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'RENDER', 'TRUST_PROXY']) delete env[k];
  Object.assign(env, { JWT_SECRET: 'txn-test-secret', PORT: String(PORT), DB_PATH: dbPath, DISABLE_FEED_INGEST: '1' });

  const pw = 'txn-test-password';
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
  const aliceId = db.exec("SELECT id FROM users WHERE username = 'ham'")[0].values[0][0];
  const insT = `INSERT INTO tournaments (event_number, event_name, date, time, buyin, game_variant, venue, notes)
                VALUES (?, ?, ?, '12:00 PM', ?, 'NLH', 'Txn Test Venue', '')`;
  // Three events inside a June trip (one in the old 'Month D, YYYY' form), one after it.
  db.run(insT, ['TX-1', 'Txn Event 1', '2026-06-02', 500]);
  db.run(insT, ['TX-2', 'Txn Event 2', 'June 4, 2026', 1000]);
  db.run(insT, ['TX-3', 'Txn Event 3', '2026-06-10', 300]);
  db.run(insT, ['TX-4', 'Txn Event 4', '2026-07-01', 200]);
  const T = db.exec("SELECT id FROM tournaments WHERE venue = 'Txn Test Venue' ORDER BY id")[0].values.map((v) => v[0]);
  db.run(`INSERT INTO tournaments (stable_id, event_number, event_name, date, time, buyin, game_variant, venue, notes, uploaded_by)
          VALUES (?, '', 'Alice Private', '2026-06-03', '12:00 AM', 0, 'Personal', 'Personal', '', ?)`, [`PERSONAL-${aliceId}-1`, aliceId]);
  const alicePersonal = db.exec("SELECT id FROM tournaments WHERE event_name = 'Alice Private'")[0].values[0][0];
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();

  child = boot(env);
  try {
    await up(child);
    const login = async (email) => (await request('POST', '/api/login', { body: { email, password: pw } })).json.token;
    const A = { Authorization: 'Bearer ' + await login('alicex@x.test') };
    const B = { Authorization: 'Bearer ' + await login('bobx@x.test') };
    const N = { Authorization: 'Bearer ' + await login('normal@x.test') };
    const G = { Authorization: 'Bearer ' + (await request('POST', '/api/guest-login')).json.token };
    const get = (p, h) => request('GET', p, { headers: h });
    const post = (p, h, body) => request('POST', p, { headers: h, body });
    const put = (p, h, body) => request('PUT', p, { headers: h, body });
    const del = (p, h) => request('DELETE', p, { headers: h });
    const TX = '/api/bankrolls/transactions';
    const TRIPS = '/api/bankrolls/trips';

    // ── the beta gate ──
    await test('gate: no token 401; guest and normal user 403 on every route', async () => {
      assert.strictEqual((await get(TX)).status, 401);
      assert.strictEqual((await get(TRIPS)).status, 401);
      for (const h of [G, N]) {
        assert.strictEqual((await get(TX, h)).status, 403);
        assert.strictEqual((await get(TX + '/totals', h)).status, 403);
        assert.strictEqual((await post(TX, h, { kind: 'expense', category: 'food', amount: 5 })).status, 403);
        assert.strictEqual((await put(TX + '/1', h, { amount: 5 })).status, 403);
        assert.strictEqual((await del(TX + '/1', h)).status, 403);
        assert.strictEqual((await get(TRIPS, h)).status, 403);
        assert.strictEqual((await post(TRIPS, h, { name: 'x', startDate: '2026-01-01', endDate: '2026-01-02' })).status, 403);
        assert.strictEqual((await get(TRIPS + '/1', h)).status, 403);
      }
    });

    // ── setup through the API ──
    const eur = (await post('/api/bankrolls', A, { name: 'Europe', currency: 'EUR' })).json.bankroll;
    const online = (await post('/api/bankrolls', A, { name: 'Online' })).json.bankroll;
    const bobRoll = (await post('/api/bankrolls', B, { name: 'Bob Roll' })).json.bankroll;
    for (const [t, bankrollId, cash] of [[T[0], 'main', 1500], [T[1], 'main', 0], [T[2], online.id, 0], [T[3], 'main', 0]]) {
      const r = await post('/api/tracking', A, { tournamentId: t, numEntries: 1, cashed: cash > 0, cashAmount: cash, bankrollId });
      assert.strictEqual(r.status, 201, r.body);
    }

    let lodging, rakeback, dinner;
    await test('create: an expense in Main defaults to USD and today', async () => {
      const r = await post(TX, A, { kind: 'expense', category: 'lodging', amount: 412.37, note: '  Rio,   3 nights ' });
      assert.strictEqual(r.status, 201, r.body);
      lodging = r.json.transaction;
      assert.strictEqual(lodging.bankroll_id, 'main');
      assert.strictEqual(lodging.currency, 'USD');
      assert.strictEqual(lodging.amount, 412.37);
      assert.strictEqual(lodging.signed_amount, -412.37);
      assert.strictEqual(lodging.note, 'Rio, 3 nights');
      assert.match(lodging.occurred_on, /^\d{4}-\d{2}-\d{2}$/);
    });
    await test('create: income in a EUR bankroll defaults to EUR; amounts kept to the cent', async () => {
      const r = await post(TX, A, { kind: 'income', category: 'rakeback', amount: 55.555, bankroll: eur.id, date: '2026-06-03', series: 'WSOPE' });
      assert.strictEqual(r.status, 201, r.body);
      rakeback = r.json.transaction;
      assert.strictEqual(rakeback.currency, 'EUR');
      assert.strictEqual(rakeback.bankroll_id, eur.id);
      assert.strictEqual(rakeback.signed_amount, rakeback.amount);
      assert.ok(Math.abs(rakeback.amount - 55.56) < 1e-9 || Math.abs(rakeback.amount - 55.55) < 1e-9);
      assert.strictEqual(rakeback.series, 'WSOPE');
    });
    await test('create: an explicit currency overrides the bankroll\'s; a shared event can be tagged', async () => {
      const r = await post(TX, A, { kind: 'expense', category: 'food', amount: 23.5, currency: 'gbp', date: '2026-06-04', tournamentId: T[1] });
      assert.strictEqual(r.status, 201, r.body);
      dinner = r.json.transaction;
      assert.strictEqual(dinner.currency, 'GBP');
      assert.strictEqual(dinner.tournament_id, T[1]);
      assert.match(dinner.tournament_name, /Txn Event 2$/); // boot normalises names (variant prefix)
    });
    await test('create: validation', async () => {
      const bad = [
        [{ kind: 'loss', category: 'food', amount: 5 }, /kind/],
        [{ kind: 'expense', category: 'rakeback', amount: 5 }, /category/],
        [{ kind: 'income', category: 'lodging', amount: 5 }, /category/],
        [{ kind: 'expense', category: 'food', amount: 0 }, /greater than 0/],
        [{ kind: 'expense', category: 'food', amount: -5 }, /greater than 0/],
        [{ kind: 'expense', category: 'food', amount: 'abc' }, /number/],
        [{ kind: 'expense', category: 'food', amount: true }, /number/],
        [{ kind: 'expense', category: 'food', amount: 5e12 }, /too large/],
        [{ kind: 'expense', category: 'food', amount: 5, date: '2026-02-30' }, /real date/],
        [{ kind: 'expense', category: 'food', amount: 5, date: '06/03/2026' }, /YYYY-MM-DD/],
        [{ kind: 'expense', category: 'food', amount: 5, currency: 'XYZ' }, /currency/],
        [{ kind: 'expense', category: 'food', amount: 5, bankroll: 'all' }, /bankroll/],
        [{ kind: 'expense', category: 'food', amount: 5, tournamentId: 'x' }, /event/],
      ];
      for (const [body, re] of bad) {
        const r = await post(TX, A, body);
        assert.strictEqual(r.status, 400, JSON.stringify(body) + ' -> ' + r.status);
        assert.match(r.json.error, re, JSON.stringify(body));
      }
      assert.strictEqual((await post(TX, A, { kind: 'expense', category: 'food', amount: 5, tournamentId: 999999 })).status, 404);
    });
    await test('create: an archived bankroll is refused', async () => {
      const arch = (await post('/api/bankrolls', A, { name: 'Old' })).json.bankroll;
      await put('/api/bankrolls/' + arch.id, A, { archived: true });
      const r = await post(TX, A, { kind: 'expense', category: 'food', amount: 5, bankroll: arch.id });
      assert.strictEqual(r.status, 400);
      assert.match(r.json.error, /archived/);
    });

    // ── trips ──
    let trip, onlineTrip;
    await test('trips: create, validation, list', async () => {
      const r = await post(TRIPS, A, { name: 'Vegas June', startDate: '2026-06-01', endDate: '2026-06-10' });
      assert.strictEqual(r.status, 201, r.body);
      trip = r.json.trip;
      assert.strictEqual(trip.bankroll, 'all');
      for (const [body, re] of [
        [{ name: '', startDate: '2026-06-01', endDate: '2026-06-02' }, /Name/],
        [{ name: 'x', startDate: '2026-06-05', endDate: '2026-06-01' }, /ends before/],
        [{ name: 'x', startDate: '2026-01-01', endDate: '2027-01-02' }, /at most/],
        [{ name: 'x', endDate: '2026-06-02' }, /Start date/],
        [{ name: 'x', startDate: '2026-06-01', endDate: '2026-06-02', bankroll: bobRoll.id }, /not found/i],
      ]) {
        const res = await post(TRIPS, A, body);
        assert.ok(res.status === 400 || res.status === 404, JSON.stringify(body));
        assert.match(res.json.error, re);
      }
      onlineTrip = (await post(TRIPS, A, { name: 'Online June', startDate: '2026-06-01', endDate: '2026-06-30', bankroll: online.id })).json.trip;
      assert.strictEqual(onlineTrip.bankroll, online.id);
      assert.deepStrictEqual((await get(TRIPS, A)).json.trips.map((t) => t.name).sort(), ['Online June', 'Vegas June']);
    });
    await test('trips: tag transactions; a new row on a single-bankroll trip defaults to that bankroll', async () => {
      assert.strictEqual((await put(TX + '/' + lodging.id, A, { tripId: trip.id, date: '2026-06-02' })).status, 200);
      assert.strictEqual((await put(TX + '/' + dinner.id, A, { tripId: trip.id })).status, 200);
      const r = await post(TX, A, { kind: 'expense', category: 'software', amount: 30, date: '2026-06-05', tripId: onlineTrip.id });
      assert.strictEqual(r.status, 201, r.body);
      assert.strictEqual(r.json.transaction.bankroll_id, online.id);
      assert.strictEqual(r.json.transaction.trip_name, 'Online June');
      const list = (await get(TRIPS, A)).json.trips;
      assert.strictEqual(list.find((t) => t.id === trip.id).transaction_count, 2);
    });
    await test('trips: the P&L route returns tagged rows and the results dated inside the trip', async () => {
      const r = await get(TRIPS + '/' + trip.id, A);
      assert.strictEqual(r.status, 200, r.body);
      assert.deepStrictEqual(r.json.transactions.map((t) => t.id).sort(), [lodging.id, dinner.id].sort());
      // All bankrolls: TX-1, TX-2 ('June 4, 2026') and TX-3 (Online) — not TX-4 (July).
      assert.deepStrictEqual(r.json.results.map((e) => e.event_number), ['TX-1', 'TX-2', 'TX-3']);
      assert.deepStrictEqual(r.json.results.map((e) => e.date_iso), ['2026-06-02', '2026-06-04', '2026-06-10']);
      const o = await get(TRIPS + '/' + onlineTrip.id, A);
      assert.deepStrictEqual(o.json.results.map((e) => e.event_number), ['TX-3']);
    });
    await test('trips: editing the range changes what it covers', async () => {
      const r = await put(TRIPS + '/' + trip.id, A, { endDate: '2026-06-03' });
      assert.strictEqual(r.status, 200, r.body);
      assert.deepStrictEqual((await get(TRIPS + '/' + trip.id, A)).json.results.map((e) => e.event_number), ['TX-1']);
      assert.strictEqual((await put(TRIPS + '/' + trip.id, A, { endDate: '2026-05-01' })).status, 400);
      await put(TRIPS + '/' + trip.id, A, { endDate: '2026-06-10' });
    });

    // ── list, filters, totals ──
    await test('list: newest first, with filters', async () => {
      const all = (await get(TX, A)).json;
      assert.strictEqual(all.total, 4);
      assert.strictEqual(all.transactions.length, 4);
      const dates = all.transactions.map((t) => t.occurred_on);
      assert.deepStrictEqual(dates, [...dates].sort().reverse());
      const ids = (q) => get(TX + q, A).then((r) => { assert.strictEqual(r.status, 200, q + ' ' + r.body); return r.json.transactions.map((t) => t.id).sort((a, b) => a - b); });
      assert.deepStrictEqual(await ids('?kind=income'), [rakeback.id]);
      assert.deepStrictEqual(await ids('?category=food,lodging'), [lodging.id, dinner.id].sort((a, b) => a - b));
      assert.deepStrictEqual(await ids('?from=2026-06-03&to=2026-06-04'), [rakeback.id, dinner.id].sort((a, b) => a - b));
      assert.deepStrictEqual(await ids('?bankroll=main'), [lodging.id, dinner.id].sort((a, b) => a - b));
      assert.deepStrictEqual(await ids('?bankroll=' + eur.id), [rakeback.id]);
      assert.deepStrictEqual(await ids('?trip=' + trip.id), [lodging.id, dinner.id].sort((a, b) => a - b));
      assert.deepStrictEqual(await ids('?trip=none'), [rakeback.id]);
      assert.strictEqual((await get(TX + '?limit=1', A)).json.truncated, true);
      for (const q of ['?kind=x', '?category=nope', '?from=2026-13-01', '?bankroll=abc']) assert.strictEqual((await get(TX + q, A)).status, 400, q);
    });
    await test('totals: by kind, category and currency — never summed across currencies', async () => {
      const r = await get(TX + '/totals', A);
      assert.strictEqual(r.status, 200, r.body);
      const key = (t) => `${t.kind}/${t.category}/${t.currency}`;
      const m = Object.fromEntries(r.json.totals.map((t) => [key(t), [t.amount, t.count]]));
      assert.deepStrictEqual(m['expense/lodging/USD'], [412.37, 1]);
      assert.deepStrictEqual(m['expense/food/GBP'], [23.5, 1]);
      assert.deepStrictEqual(m['expense/software/USD'], [30, 1]);
      assert.strictEqual(m['income/rakeback/EUR'][1], 1);
      const f = (await get(TX + '/totals?kind=expense&bankroll=main', A)).json.totals;
      assert.deepStrictEqual(f.map(key).sort(), ['expense/food/GBP', 'expense/lodging/USD']);
    });
    await test('update: partial; kind and category validated together; clearing a tag', async () => {
      let r = await put(TX + '/' + dinner.id, A, { amount: 25, note: 'Dinner' });
      assert.strictEqual(r.status, 200, r.body);
      assert.strictEqual(r.json.transaction.amount, 25);
      assert.strictEqual(r.json.transaction.category, 'food');
      assert.strictEqual(r.json.transaction.currency, 'GBP');
      r = await put(TX + '/' + dinner.id, A, { kind: 'income' });
      assert.strictEqual(r.status, 400);
      r = await put(TX + '/' + dinner.id, A, { tournamentId: null, tripId: trip.id });
      assert.strictEqual(r.json.transaction.tournament_id, null);
    });

    // ── cross-user isolation ──
    await test('isolation: B sees none of A\'s rows, trips or totals', async () => {
      assert.deepStrictEqual((await get(TX, B)).json.transactions, []);
      assert.deepStrictEqual((await get(TX + '/totals', B)).json.totals, []);
      assert.deepStrictEqual((await get(TRIPS, B)).json.trips, []);
      assert.strictEqual((await get(TRIPS + '/' + trip.id, B)).status, 404);
      assert.strictEqual((await get(TX + '?trip=' + trip.id, B)).status, 404);
      assert.strictEqual((await get(TX + '?bankroll=' + eur.id, B)).status, 404);
    });
    await test('isolation: B cannot change or delete A\'s rows or trips', async () => {
      assert.strictEqual((await put(TX + '/' + lodging.id, B, { amount: 1 })).status, 404);
      assert.strictEqual((await del(TX + '/' + lodging.id, B)).status, 404);
      assert.strictEqual((await put(TRIPS + '/' + trip.id, B, { name: 'mine now' })).status, 404);
      assert.strictEqual((await del(TRIPS + '/' + trip.id, B)).status, 404);
      const still = (await get(TX + '?trip=' + trip.id, A)).json.transactions.find((t) => t.id === lodging.id);
      assert.strictEqual(still.amount, 412.37);
      assert.strictEqual((await get(TRIPS + '/' + trip.id, A)).json.trip.name, 'Vegas June');
    });
    await test('isolation: B cannot file into A\'s bankroll, tag A\'s trip or A\'s Personal event', async () => {
      assert.strictEqual((await post(TX, B, { kind: 'expense', category: 'food', amount: 5, bankroll: eur.id })).status, 404);
      assert.strictEqual((await post(TX, B, { kind: 'expense', category: 'food', amount: 5, tripId: trip.id })).status, 404);
      assert.strictEqual((await post(TX, B, { kind: 'expense', category: 'food', amount: 5, tournamentId: alicePersonal })).status, 404);
      assert.strictEqual((await post(TRIPS, B, { name: 'x', startDate: '2026-06-01', endDate: '2026-06-02', bankroll: eur.id })).status, 404);
      const mine = await post(TX, B, { kind: 'expense', category: 'food', amount: 5, bankroll: bobRoll.id, tournamentId: T[0] });
      assert.strictEqual(mine.status, 201, mine.body);
      assert.strictEqual((await put(TX + '/' + mine.json.transaction.id, B, { tripId: trip.id })).status, 404);
      assert.strictEqual((await put(TX + '/' + mine.json.transaction.id, B, { bankroll: online.id })).status, 404);
      // A's own Personal event is taggable by A.
      assert.strictEqual((await post(TX, A, { kind: 'expense', category: 'other', amount: 1, tournamentId: alicePersonal })).status, 201);
    });

    // ── bankroll guard, trip delete, transaction delete ──
    await test('a bankroll holding transactions or trips cannot be deleted; counts are listed', async () => {
      const r = await del('/api/bankrolls/' + eur.id, A);
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.json.transactions, 1);
      const r2 = await del('/api/bankrolls/' + online.id, A);
      assert.strictEqual(r2.status, 409);
      assert.ok(r2.json.trips >= 1);
      const listed = (await get('/api/bankrolls', A)).json.bankrolls;
      assert.strictEqual(listed.find((b) => b.id === eur.id).transaction_count, 1);
    });
    await test('deleting a trip untags its rows and keeps them', async () => {
      const r = await del(TRIPS + '/' + trip.id, A);
      assert.strictEqual(r.status, 200, r.body);
      assert.strictEqual(r.json.untagged, 2);
      const rows = (await get(TX, A)).json.transactions;
      assert.ok(rows.some((t) => t.id === lodging.id && t.trip_id === null));
      assert.strictEqual((await get(TRIPS + '/' + trip.id, A)).status, 404);
    });
    await test('delete a transaction; a second delete is a 404', async () => {
      assert.strictEqual((await del(TX + '/' + rakeback.id, A)).status, 200);
      assert.strictEqual((await del(TX + '/' + rakeback.id, A)).status, 404);
      assert.strictEqual((await del('/api/bankrolls/' + eur.id, A)).status, 200);
    });
  } finally { await down(child); }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
