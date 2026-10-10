// Multiple bankrolls (beta): the /api/bankrolls routes, bankrollId on /api/tracking, the shared
// ?bankroll= filter, the beta gate, and CROSS-USER ISOLATION — a user must never read or move
// another user's bankroll.
//
//   node test/bankrolls.test.js        (or: npm run test:bankrolls)
//
// Boots server.js twice on a scratch port against a scratch DB (never port 3001, never
// poker-tournaments.db): once to register three accounts, then — with two renamed to the admin
// usernames 'ham' and 'ham5', which sign-up refuses — again to test. Both admins pass the beta
// gate, so every isolation check below is about OWNERSHIP, not the gate.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 48000 + Math.floor(Math.random() * 2000);
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-bankrolls-'));
  const dbPath = path.join(tmp, 'scratch.db');
  assert.notStrictEqual(path.basename(dbPath), 'poker-tournaments.db');
  const env = { ...process.env };
  for (const k of ['SYNC_TOKEN', 'DASHBOARD_TOKEN', 'TESTFLIGHT_WATCHDOG', 'RENDER_DEPLOY_WATCHDOG', 'SMTP_HOST', 'SMTP_USER',
    'SMTP_PASS', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'RENDER', 'TRUST_PROXY']) delete env[k];
  Object.assign(env, { JWT_SECRET: 'bankrolls-test-secret', PORT: String(PORT), DB_PATH: dbPath, DISABLE_FEED_INGEST: '1' });

  const pw = 'bankrolls-test-password';
  let child = boot(env);
  try {
    await up(child);
    for (const u of ['alicex', 'bobx', 'normal']) {
      const r = await request('POST', '/api/register', { body: { username: u, email: `${u}@x.test`, password: pw, realName: u } });
      assert.strictEqual(r.status, 201, `register ${u}: ${r.body}`);
    }
  } finally { await down(child); }

  // Promote two accounts to admin usernames, and make sure there are events to log results on.
  const SQL = await require(path.join(ROOT, 'node_modules', 'sql.js'))();
  let db = new SQL.Database(fs.readFileSync(dbPath));
  db.run("UPDATE users SET username = 'ham' WHERE username = 'alicex'");
  db.run("UPDATE users SET username = 'ham5' WHERE username = 'bobx'");
  const insT = `INSERT INTO tournaments (event_number, event_name, date, time, buyin, game_variant, venue, notes)
                VALUES (?, ?, '2026-10-01', '12:00 PM', ?, 'NLH', 'Bankroll Test Venue', '')`;
  for (let i = 1; i <= 4; i++) db.run(insT, [`BK-${i}`, `Bankroll Test Event ${i}`, 100 * i]);
  const T = db.exec("SELECT id FROM tournaments WHERE venue = 'Bankroll Test Venue' ORDER BY id")[0].values.map((v) => v[0]);
  // Rows that predate the feature: logged before bankrolls existed (no bankroll_id at all).
  const preIds = {};
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

    // ── the beta gate ──
    await test('gate: no token 401; guest and normal user 403 on read and write', async () => {
      assert.strictEqual((await get('/api/bankrolls')).status, 401);
      for (const h of [G, N]) {
        assert.strictEqual((await get('/api/bankrolls', h)).status, 403);
        assert.strictEqual((await post('/api/bankrolls', h, { name: 'x' })).status, 403);
        assert.strictEqual((await post('/api/bankrolls/adjustments', h, { bankroll: 'main', kind: 'deposit', amount: 5 })).status, 403);
        assert.strictEqual((await post('/api/bankrolls/transfers', h, { from: 'main', to: 'main', amount: 5 })).status, 403);
      }
    });
    await test('gate: a normal user logs results exactly as before (bankroll_id NULL)', async () => {
      assert.strictEqual((await post('/api/tracking', N, { tournamentId: T[0], numEntries: 1, cashed: false })).status, 201);
      const rows = (await get('/api/tracking', N)).json;
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].bankroll_id, null);
      preIds.normal = rows[0].id;
    });
    await test('gate: a normal user cannot file a result under a bankroll id (403), "main" is a no-op', async () => {
      assert.strictEqual((await post('/api/tracking', N, { tournamentId: T[1], bankrollId: 1 })).status, 403);
      assert.strictEqual((await put(`/api/tracking/${preIds.normal}`, N, { numEntries: 2, bankrollId: 'main' })).status, 200);
      assert.strictEqual((await get('/api/tracking', N)).json[0].num_entries, 2);
    });

    // ── CRUD ──
    let aStaked, aOnline, bOwn;
    await test('list: Main is virtual, first, USD, empty', async () => {
      const r = await get('/api/bankrolls', A);
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.json.bankrolls.map((b) => [b.id, b.name, b.currency, b.is_main]), [['main', 'Main', 'USD', true]]);
    });
    await test('create: validates name, currency and duplicates', async () => {
      assert.strictEqual((await post('/api/bankrolls', A, { name: '' })).status, 400);
      assert.strictEqual((await post('/api/bankrolls', A, { name: 'Main' })).status, 400);
      assert.strictEqual((await post('/api/bankrolls', A, { name: 'x', currency: 'XYZ' })).status, 400);
      const r = await post('/api/bankrolls', A, { name: 'Staked', startingBalance: 10000 });
      assert.strictEqual(r.status, 201, r.body);
      aStaked = r.json.bankroll;
      assert.strictEqual(aStaked.starting_balance, 10000);
      assert.strictEqual(aStaked.currency, 'USD');
      assert.strictEqual((await post('/api/bankrolls', A, { name: ' staked ' })).status, 409);
      const o = await post('/api/bankrolls', A, { name: 'Online EUR', startingBalance: 500, currency: 'eur' });
      assert.strictEqual(o.status, 201);
      aOnline = o.json.bankroll;
      assert.strictEqual(aOnline.currency, 'EUR');
      const b = await post('/api/bankrolls', B, { name: 'Staked', startingBalance: 1 });
      assert.strictEqual(b.status, 201, 'the same name is fine for a different user');
      bOwn = b.json.bankroll;
    });
    await test('rename, reorder, archive and restore', async () => {
      assert.strictEqual((await put(`/api/bankrolls/${aOnline.id}`, A, { name: 'Online' })).json.bankroll.name, 'Online');
      const ord = await put('/api/bankrolls/order', A, { order: [aOnline.id, aStaked.id] });
      assert.deepStrictEqual(ord.json.bankrolls.map((b) => b.id), ['main', aOnline.id, aStaked.id]);
      assert.strictEqual((await put(`/api/bankrolls/${aOnline.id}`, A, { archived: true })).json.bankroll.archived, true);
      assert.strictEqual((await put(`/api/bankrolls/${aOnline.id}`, A, { archived: false })).json.bankroll.archived, false);
    });

    // ── ledger ──
    await test('deposit, withdrawal and transfer move the ledger totals', async () => {
      assert.strictEqual((await post('/api/bankrolls/adjustments', A, { bankroll: aStaked.id, kind: 'deposit', amount: 2500, date: '2026-10-02', note: 'from backer' })).status, 201);
      assert.strictEqual((await post('/api/bankrolls/adjustments', A, { bankroll: 'main', kind: 'withdrawal', amount: 300 })).status, 201);
      assert.strictEqual((await post('/api/bankrolls/adjustments', A, { bankroll: 'main', kind: 'withdrawal', amount: -5 })).status, 400);
      assert.strictEqual((await post('/api/bankrolls/adjustments', A, { bankroll: 'main', kind: 'gift', amount: 5 })).status, 400);
      const t = await post('/api/bankrolls/transfers', A, { from: aStaked.id, to: 'main', amount: 1000 });
      assert.strictEqual(t.status, 201, t.body);
      assert.deepStrictEqual(t.json.adjustments.map((a) => [a.bankroll_id, a.kind, a.amount]), [[aStaked.id, 'transfer_out', -1000], ['main', 'transfer_in', 1000]]);
      const list = (await get('/api/bankrolls', A)).json.bankrolls;
      const by = Object.fromEntries(list.map((b) => [b.id, b]));
      assert.strictEqual(by.main.adjustments_net, -300 + 1000);
      assert.strictEqual(by[aStaked.id].adjustments_net, 2500 - 1000);
    });
    await test('transfer: same bankroll refused; different currencies need toAmount', async () => {
      assert.strictEqual((await post('/api/bankrolls/transfers', A, { from: 'main', to: 'main', amount: 5 })).status, 400);
      assert.strictEqual((await post('/api/bankrolls/transfers', A, { from: 'main', to: aOnline.id, amount: 100 })).status, 400);
      const r = await post('/api/bankrolls/transfers', A, { from: 'main', to: aOnline.id, amount: 100, toAmount: 91 });
      assert.strictEqual(r.status, 201);
      assert.deepStrictEqual(r.json.adjustments.map((a) => a.amount), [-100, 91]);
    });
    await test('currency cannot change once the ledger is denominated in it', async () => {
      assert.strictEqual((await put(`/api/bankrolls/${aOnline.id}`, A, { currency: 'USD' })).status, 409);
    });
    await test('deleting one leg of a transfer deletes both', async () => {
      const t = await post('/api/bankrolls/transfers', A, { from: 'main', to: aStaked.id, amount: 7 });
      const legId = t.json.adjustments[1].id;
      const r = await del(`/api/bankrolls/adjustments/${legId}`, A);
      assert.deepStrictEqual([r.status, r.json.removed], [200, 2]);
      const left = (await get('/api/bankrolls/adjustments', A)).json.adjustments.filter((a) => a.transfer_id === t.json.transfer_id);
      assert.strictEqual(left.length, 0);
    });
    await test('adjustments list honours ?bankroll=', async () => {
      const main = (await get('/api/bankrolls/adjustments?bankroll=main', A)).json.adjustments;
      assert.ok(main.length > 0 && main.every((a) => a.bankroll_id === 'main'));
      const st = (await get(`/api/bankrolls/adjustments?bankroll=${aStaked.id}`, A)).json.adjustments;
      assert.ok(st.length > 0 && st.every((a) => a.bankroll_id === aStaked.id));
      assert.strictEqual((await get('/api/bankrolls/adjustments?bankroll=bogus', A)).status, 400);
    });

    // ── tracking ──
    let aEntryMain, aEntryStaked;
    await test('tracking: bankrollId is stored, defaults to Main, and survives an edit that omits it', async () => {
      assert.strictEqual((await post('/api/tracking', A, { tournamentId: T[0], numEntries: 1, cashed: true, cashAmount: 500 })).status, 201);
      assert.strictEqual((await post('/api/tracking', A, { tournamentId: T[1], numEntries: 2, bankrollId: aStaked.id })).status, 201);
      const rows = (await get('/api/tracking', A)).json;
      aEntryMain = rows.find((r) => r.tournament_id === T[0]);
      aEntryStaked = rows.find((r) => r.tournament_id === T[1]);
      assert.strictEqual(aEntryMain.bankroll_id, null);
      assert.strictEqual(aEntryStaked.bankroll_id, aStaked.id);
      assert.strictEqual((await put(`/api/tracking/${aEntryStaked.id}`, A, { numEntries: 3 })).status, 200);
      const again = (await get('/api/tracking', A)).json.find((r) => r.id === aEntryStaked.id);
      assert.deepStrictEqual([again.num_entries, again.bankroll_id], [3, aStaked.id]);
    });
    await test('tracking: ?bankroll= filters (all / main / id), malformed is 400', async () => {
      assert.strictEqual((await get('/api/tracking', A)).json.length, 2);
      assert.strictEqual((await get('/api/tracking?bankroll=all', A)).json.length, 2);
      assert.deepStrictEqual((await get('/api/tracking?bankroll=main', A)).json.map((r) => r.id), [aEntryMain.id]);
      assert.deepStrictEqual((await get(`/api/tracking?bankroll=${aStaked.id}`, A)).json.map((r) => r.id), [aEntryStaked.id]);
      assert.strictEqual((await get('/api/tracking?bankroll=1;DROP', A)).status, 400);
    });
    await test('tracking: move an entry between bankrolls and back to Main', async () => {
      assert.strictEqual((await put(`/api/tracking/${aEntryMain.id}`, A, { numEntries: 1, cashed: true, cashAmount: 500, bankrollId: aOnline.id })).status, 200);
      assert.deepStrictEqual((await get(`/api/tracking?bankroll=${aOnline.id}`, A)).json.map((r) => r.id), [aEntryMain.id]);
      assert.strictEqual((await put(`/api/tracking/${aEntryMain.id}`, A, { numEntries: 1, cashed: true, cashAmount: 500, bankrollId: 'main' })).status, 200);
      assert.deepStrictEqual((await get('/api/tracking?bankroll=main', A)).json.map((r) => r.id), [aEntryMain.id]);
    });
    await test('tracking: an archived bankroll takes no new results but keeps its own', async () => {
      await put(`/api/bankrolls/${aStaked.id}`, A, { archived: true });
      assert.strictEqual((await post('/api/tracking', A, { tournamentId: T[2], bankrollId: aStaked.id })).status, 400);
      assert.strictEqual((await put(`/api/tracking/${aEntryStaked.id}`, A, { numEntries: 3, bankrollId: aStaked.id })).status, 200);
      await put(`/api/bankrolls/${aStaked.id}`, A, { archived: false });
    });
    await test('delete: refused while results or transactions are filed under it; an empty one goes', async () => {
      const r = await del(`/api/bankrolls/${aStaked.id}`, A);
      assert.strictEqual(r.status, 409);
      const e = await post('/api/bankrolls', A, { name: 'Scratch' });
      assert.deepStrictEqual((await del(`/api/bankrolls/${e.json.bankroll.id}`, A)).json, { deleted: true });
      assert.strictEqual((await put(`/api/bankrolls/${e.json.bankroll.id}`, A, { name: 'gone' })).status, 404);
    });

    // ── CROSS-USER ISOLATION ── bob is an admin too; he simply does not own alice's bankrolls.
    await test('isolation: bob never sees alice\'s bankrolls, ledger or results', async () => {
      const list = (await get('/api/bankrolls', B)).json.bankrolls;
      assert.deepStrictEqual(list.map((b) => b.id), ['main', bOwn.id]);
      assert.strictEqual(list[0].adjustments_net, 0, 'Main totals are per user');
      assert.strictEqual(list[0].entry_count, 0);
      assert.strictEqual((await get('/api/bankrolls/adjustments', B)).json.adjustments.length, 0);
      assert.strictEqual((await get(`/api/bankrolls/adjustments?bankroll=${aStaked.id}`, B)).status, 404);
      assert.strictEqual((await get(`/api/tracking?bankroll=${aStaked.id}`, B)).status, 404);
    });
    await test('isolation: bob cannot rename, archive, recurrency, reorder or delete alice\'s bankroll', async () => {
      assert.strictEqual((await put(`/api/bankrolls/${aStaked.id}`, B, { name: 'pwned' })).status, 404);
      assert.strictEqual((await put(`/api/bankrolls/${aStaked.id}`, B, { archived: true })).status, 404);
      assert.strictEqual((await put(`/api/bankrolls/${aOnline.id}`, B, { currency: 'GBP' })).status, 404);
      assert.strictEqual((await put('/api/bankrolls/order', B, { order: [aStaked.id, bOwn.id] })).status, 404);
      assert.strictEqual((await del(`/api/bankrolls/${aOnline.id}`, B)).status, 404);
    });
    await test('isolation: bob cannot deposit into, withdraw from or transfer to/from alice\'s bankroll', async () => {
      assert.strictEqual((await post('/api/bankrolls/adjustments', B, { bankroll: aStaked.id, kind: 'deposit', amount: 1 })).status, 404);
      assert.strictEqual((await post('/api/bankrolls/adjustments', B, { bankroll: aStaked.id, kind: 'withdrawal', amount: 1 })).status, 404);
      assert.strictEqual((await post('/api/bankrolls/transfers', B, { from: aStaked.id, to: bOwn.id, amount: 1 })).status, 404);
      assert.strictEqual((await post('/api/bankrolls/transfers', B, { from: bOwn.id, to: aStaked.id, amount: 1 })).status, 404);
      assert.strictEqual((await post('/api/bankrolls/transfers', B, { from: 'main', to: aOnline.id, amount: 1, toAmount: 1 })).status, 404);
    });
    await test('isolation: bob cannot delete alice\'s ledger rows', async () => {
      const aAdj = (await get('/api/bankrolls/adjustments', A)).json.adjustments;
      for (const a of aAdj) assert.strictEqual((await del(`/api/bankrolls/adjustments/${a.id}`, B)).status, 404);
      assert.strictEqual((await get('/api/bankrolls/adjustments', A)).json.adjustments.length, aAdj.length);
    });
    await test('isolation: bob cannot file his result under alice\'s bankroll', async () => {
      assert.strictEqual((await post('/api/tracking', B, { tournamentId: T[0], bankrollId: aStaked.id })).status, 400);
      assert.strictEqual((await post('/api/tracking', B, { tournamentId: T[0], bankrollId: bOwn.id })).status, 201);
      const bEntry = (await get('/api/tracking', B)).json[0];
      assert.strictEqual((await put(`/api/tracking/${bEntry.id}`, B, { numEntries: 1, bankrollId: aOnline.id })).status, 400);
      assert.strictEqual((await get('/api/tracking', B)).json[0].bankroll_id, bOwn.id);
    });
    await test('isolation: alice\'s bankrolls and totals are unchanged by all of it', async () => {
      const list = (await get('/api/bankrolls', A)).json.bankrolls;
      const by = Object.fromEntries(list.map((b) => [b.id, b]));
      assert.strictEqual(by[aStaked.id].name, 'Staked');
      assert.strictEqual(by[aStaked.id].archived, false);
      assert.strictEqual(by[aOnline.id].currency, 'EUR');
      assert.strictEqual(by[aStaked.id].entry_count, 1);
      assert.strictEqual(by.main.entry_count, 1);
    });
  } finally {
    await down(child);
  }

  // ── migration on a DB that predates the feature ── drop the column the way an old DB lacks it,
  // forget the migration, boot, and check the existing rows read as Main.
  await test('migration: an old DB gains bankroll_id with every existing row in Main', async () => {
    db = new SQL.Database(fs.readFileSync(dbPath));
    db.run('DROP TABLE bankroll_adjustments'); db.run('DROP TABLE bankrolls');
    db.run(`CREATE TABLE te_old AS SELECT id, user_id, tournament_id, num_entries, cashed, finish_place, cash_amount, notes, created_at FROM tracking_entries`);
    db.run('DROP TABLE tracking_entries'); db.run('ALTER TABLE te_old RENAME TO tracking_entries');
    db.run("DELETE FROM _applied_migrations WHERE name = 'bankrolls-beta-2026-10'");
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    db.close();
    child = boot(env);
    try {
      await up(child);
      const N2 = { Authorization: 'Bearer ' + (await request('POST', '/api/login', { body: { email: 'normal@x.test', password: pw } })).json.token };
      const rows = (await request('GET', '/api/tracking?bankroll=main', { headers: N2 })).json;
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].bankroll_id, null);
    } finally { await down(child); }
    db = new SQL.Database(fs.readFileSync(dbPath));
    const cols = db.exec('PRAGMA table_info(tracking_entries)')[0].values.map((v) => v[1]);
    assert.ok(cols.includes('bankroll_id'));
    assert.ok(db.exec("SELECT name FROM sqlite_master WHERE name IN ('bankrolls', 'bankroll_adjustments')")[0].values.length === 2);
    db.close();
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
