// DELETE /api/tracking — Results' "Delete results". It used to sit on the home and wipe every
// result in every bankroll, imported history included, on one inline confirm. Now it is scoped:
// ?bankroll=main|<id> deletes that bankroll's results, ?all=true every bankroll's, and neither is
// refused. ?expect=<n> (the count the typed confirmation showed) refuses a stale count. Also: GET
// /api/tracking says which results were imported, so the confirmation can say so.
//
//   node test/tracking-reset.test.js        (or: npm run test:tracking-reset)
//
// Boots server.js twice on a scratch port against a scratch DB (never port 3001, never
// poker-tournaments.db): once to register three accounts, then, with two renamed to the admin
// usernames 'ham' and 'ham5' (bankrolls are an admin beta), again to test.
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-reset-'));
  const dbPath = path.join(tmp, 'scratch.db');
  assert.notStrictEqual(path.basename(dbPath), 'poker-tournaments.db');
  const env = { ...process.env };
  for (const k of ['SYNC_TOKEN', 'DASHBOARD_TOKEN', 'TESTFLIGHT_WATCHDOG', 'RENDER_DEPLOY_WATCHDOG', 'SMTP_HOST', 'SMTP_USER',
    'SMTP_PASS', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'RENDER', 'TRUST_PROXY']) delete env[k];
  Object.assign(env, { JWT_SECRET: 'reset-test-secret', PORT: String(PORT), DB_PATH: dbPath, DISABLE_FEED_INGEST: '1' });

  const pw = 'reset-test-password';
  let child = boot(env);
  try {
    await up(child);
    for (const u of ['subjectx', 'otherx', 'normal']) {
      const r = await request('POST', '/api/register', { body: { username: u, email: `${u}@x.test`, password: pw, realName: u } });
      assert.strictEqual(r.status, 201, `register ${u}: ${r.body}`);
    }
  } finally { await down(child); }

  const SQL = await require('sql.js')();   // resolved up the tree, so a worktree finds it too
  let db = new SQL.Database(fs.readFileSync(dbPath));
  db.run("UPDATE users SET username = 'ham5' WHERE username = 'subjectx'");
  db.run("UPDATE users SET username = 'ham' WHERE username = 'otherx'");
  const insT = `INSERT INTO tournaments (event_number, event_name, date, time, buyin, game_variant, venue, notes, source_pdf)
                VALUES (?, ?, '2026-10-01', '12:00 PM', ?, 'NLH', ?, '', ?)`;
  for (let i = 1; i <= 8; i++) db.run(insT, [`RS-${i}`, `Reset Test Event ${i}`, 100 * i, 'Reset Test Venue', null]);
  // Two CSV imports: private 'Personal' events, as lib/bankroll-import.js files them.
  for (let i = 1; i <= 2; i++) db.run(insT, ['', `Imported Event ${i}`, 215, 'Personal', 'bankroll-import']);
  const T = db.exec("SELECT id FROM tournaments WHERE venue = 'Reset Test Venue' ORDER BY id")[0].values.map((v) => v[0]);
  const I = db.exec("SELECT id FROM tournaments WHERE source_pdf = 'bankroll-import' ORDER BY id")[0].values.map((v) => v[0]);
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();

  child = boot(env);
  try {
    await up(child);
    const login = async (email) => (await request('POST', '/api/login', { body: { email, password: pw } })).json.token;
    const S = { Authorization: 'Bearer ' + await login('subjectx@x.test') };   // ham5
    const O = { Authorization: 'Bearer ' + await login('otherx@x.test') };     // ham
    const N = { Authorization: 'Bearer ' + await login('normal@x.test') };
    const G = { Authorization: 'Bearer ' + (await request('POST', '/api/guest-login')).json.token };
    const get = (p, h) => request('GET', p, { headers: h });
    const post = (p, h, body) => request('POST', p, { headers: h, body });
    const del = (p, h) => request('DELETE', p, { headers: h });
    const count = async (h, q = '') => (await get('/api/tracking' + q, h)).json.length;

    // ── setup: ham5 has Main (3 + 1 imported) and Staked (2 + 1 imported); ham has Main 1 and
    // its own bankroll 2; normal has 2 in Main.
    const staked = (await post('/api/bankrolls', S, { name: 'Staked' })).json.bankroll;
    const hams = (await post('/api/bankrolls', O, { name: 'Hams Roll' })).json.bankroll;
    assert.ok(staked && hams, 'bankrolls created');
    const log = async (h, tournamentId, bankrollId, extra = {}) => {
      const r = await post('/api/tracking', h, { tournamentId, numEntries: 1, cashed: false, ...(bankrollId ? { bankrollId } : {}), ...extra });
      assert.strictEqual(r.status, 201, r.body);
    };
    for (const t of [T[0], T[1], T[2], I[0]]) await log(S, t);
    for (const t of [T[3], T[4], I[1]]) await log(S, t, staked.id);
    await log(O, T[0]);
    for (const t of [T[1], T[2]]) await log(O, t, hams.id);
    for (const t of [T[5], T[6]]) await log(N, t);

    await test('GET /api/tracking marks imported results and carries the room', async () => {
      const rows = (await get('/api/tracking', S)).json;
      assert.strictEqual(rows.length, 7);
      assert.deepStrictEqual(rows.filter((r) => r.imported === 1).map((r) => r.tournament_id).sort(), [...I].sort());
      assert.ok(rows.every((r) => r.imported === 0 || r.imported === 1));
      assert.ok(rows.every((r) => 'property' in r));
    });

    await test('unscoped: no params, bankroll=all, an empty bankroll and all=false are all refused, nothing deleted', async () => {
      for (const q of ['', '?bankroll=all', '?bankroll=', '?all=false', '?all=no', '?expect=7']) {
        const r = await del('/api/tracking' + q, S);
        assert.strictEqual(r.status, 400, `${q}: ${r.status} ${r.body}`);
      }
      assert.strictEqual(await count(S), 7);
    });

    await test('a bankroll AND all=true is refused; a malformed bankroll is 400', async () => {
      assert.strictEqual((await del(`/api/tracking?bankroll=${staked.id}&all=true`, S)).status, 400);
      assert.strictEqual((await del('/api/tracking?bankroll=main&all=true', S)).status, 400);
      assert.strictEqual((await del('/api/tracking?bankroll=nonsense', S)).status, 400);
      assert.strictEqual(await count(S), 7);
    });

    await test("another user's bankroll is a 404, and its results survive", async () => {
      const r = await del(`/api/tracking?bankroll=${hams.id}`, S);
      assert.strictEqual(r.status, 404);
      assert.strictEqual(await count(O), 3);
      assert.strictEqual(await count(S), 7);
    });

    await test('a stale count (expect) is a 409 with the real count, and nothing is deleted', async () => {
      const r = await del(`/api/tracking?bankroll=${staked.id}&expect=2`, S);
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.json.count, 3);
      assert.match(r.json.error, /Nothing was deleted/);
      assert.strictEqual(await count(S), 7);
      for (const bad of ['abc', '-1', '1.5', '']) {
        assert.strictEqual((await del(`/api/tracking?bankroll=${staked.id}&expect=${bad}`, S)).status, 400, `expect=${bad}`);
      }
      assert.strictEqual(await count(S), 7);
    });

    await test('scoped to one bankroll: only that bankroll goes (imports in it included); Main and other users stay', async () => {
      const r = await del(`/api/tracking?bankroll=${staked.id}&expect=3`, S);
      assert.strictEqual(r.status, 200, r.body);
      assert.strictEqual(r.json.count, 3);
      assert.strictEqual(r.json.scope, String(staked.id));
      assert.strictEqual(await count(S, `?bankroll=${staked.id}`), 0);
      assert.strictEqual(await count(S, '?bankroll=main'), 4);
      assert.strictEqual(await count(O), 3);
      assert.strictEqual(await count(N), 2);
      // Again: nothing left there, a no-op.
      const again = await del(`/api/tracking?bankroll=${staked.id}`, S);
      assert.strictEqual(again.status, 200);
      assert.strictEqual(again.json.count, 0);
    });

    await test('Main only: a bankroll keeps its results', async () => {
      const r = await del('/api/tracking?bankroll=main&expect=1', O);
      assert.strictEqual(r.status, 200, r.body);
      assert.strictEqual(r.json.count, 1);
      assert.strictEqual(r.json.scope, 'main');
      assert.strictEqual(await count(O), 2);
      assert.strictEqual(await count(O, `?bankroll=${hams.id}`), 2);
    });

    await test('a non-admin deletes their own results by naming Main', async () => {
      const r = await del('/api/tracking?bankroll=main&expect=2', N);
      assert.strictEqual(r.status, 200, r.body);
      assert.strictEqual(r.json.count, 2);
      assert.strictEqual(await count(N), 0);
      assert.strictEqual(await count(S), 4);
    });

    await test('all=true deletes every bankroll of the CALLER only', async () => {
      await log(S, T[7], staked.id);
      const r = await del('/api/tracking?all=true&expect=5', S);
      assert.strictEqual(r.status, 200, r.body);
      assert.strictEqual(r.json.count, 5);
      assert.strictEqual(r.json.scope, 'all');
      assert.strictEqual(await count(S), 0);
      assert.strictEqual(await count(O), 2);
    });

    await test('guests and the signed-out are refused', async () => {
      assert.strictEqual((await del('/api/tracking?all=true', G)).status, 403);
      assert.strictEqual((await del('/api/tracking?all=true')).status, 401);
      assert.strictEqual(await count(O), 2);
    });
  } finally { await down(child); }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
