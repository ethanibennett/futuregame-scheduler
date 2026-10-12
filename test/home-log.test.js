// The home's To log (components/HomeToLog.jsx), server side:
//   - PUT /api/schedule/:tournamentId/played { notPlayed } — "Didn't play" and its Undo, stored on
//     user_schedules.not_played and returned by GET /api/my-schedule, so it syncs across devices;
//   - POST /api/tracking { ifAbsent: true } — the home LOGS a result and never edits one: when a
//     result already exists (another device, the live-update Finish) it is a 409 that changes
//     nothing. Without ifAbsent the route still upserts, as the Results form relies on.
//
//   node test/home-log.test.js        (or: npm run test:home-log)
//
// Boots server.js twice on a scratch port against a scratch DB (never port 3001, never
// poker-tournaments.db): once to register the accounts, then, with events added, again to test.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 48000 + Math.floor(Math.random() * 1500);
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-homelog-'));
  const dbPath = path.join(tmp, 'scratch.db');
  assert.notStrictEqual(path.basename(dbPath), 'poker-tournaments.db');
  const env = { ...process.env };
  for (const k of ['SYNC_TOKEN', 'DASHBOARD_TOKEN', 'TESTFLIGHT_WATCHDOG', 'RENDER_DEPLOY_WATCHDOG', 'SMTP_HOST', 'SMTP_USER',
    'SMTP_PASS', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'RENDER', 'TRUST_PROXY']) delete env[k];
  Object.assign(env, { JWT_SECRET: 'homelog-test-secret', PORT: String(PORT), DB_PATH: dbPath, DISABLE_FEED_INGEST: '1' });

  const pw = 'homelog-test-password';
  let child = boot(env);
  try {
    await up(child);
    for (const u of ['loggerx', 'otherx']) {
      const r = await request('POST', '/api/register', { body: { username: u, email: `${u}@x.test`, password: pw, realName: u } });
      assert.strictEqual(r.status, 201, `register ${u}: ${r.body}`);
    }
  } finally { await down(child); }

  const SQL = await require('sql.js')();   // resolved up the tree, so a worktree finds it too
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const insT = `INSERT INTO tournaments (event_number, event_name, date, time, buyin, game_variant, venue, notes)
                VALUES (?, ?, '2026-10-08', '12:00 PM', ?, 'NLH', 'Home Log Venue', '')`;
  for (let i = 1; i <= 4; i++) db.run(insT, [String(10 + i), `Home Log Event ${i}`, 100 * i]);
  const T = db.exec("SELECT id FROM tournaments WHERE venue = 'Home Log Venue' ORDER BY id")[0].values.map((v) => v[0]);
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();

  child = boot(env);
  try {
    await up(child);
    const login = async (email) => (await request('POST', '/api/login', { body: { email, password: pw } })).json.token;
    const L = { Authorization: 'Bearer ' + await login('loggerx@x.test') };
    const O = { Authorization: 'Bearer ' + await login('otherx@x.test') };
    const G = { Authorization: 'Bearer ' + (await request('POST', '/api/guest-login')).json.token };
    const get = (p, h) => request('GET', p, { headers: h });
    const post = (p, h, body) => request('POST', p, { headers: h, body });
    const put = (p, h, body) => request('PUT', p, { headers: h, body });
    const mine = async (h) => (await get('/api/my-schedule', h)).json;
    const flagOf = async (h, id) => { const e = (await mine(h)).find((x) => x.id === id); return e ? e.not_played : undefined; };

    for (const t of T.slice(0, 3)) assert.strictEqual((await post('/api/schedule', L, { tournamentId: t })).status, 200);
    assert.strictEqual((await post('/api/schedule', O, { tournamentId: T[0] })).status, 200);

    await test('GET /api/my-schedule carries not_played, 0 by default', async () => {
      const rows = await mine(L);
      assert.strictEqual(rows.length, 3);
      assert.ok(rows.every((r) => r.not_played === 0), JSON.stringify(rows.map((r) => r.not_played)));
    });

    await test("Didn't play sets the flag; Undo clears it; only the caller's row moves", async () => {
      let r = await put(`/api/schedule/${T[0]}/played`, L, { notPlayed: true });
      assert.strictEqual(r.status, 200, r.body);
      assert.deepStrictEqual(r.json, { tournamentId: T[0], notPlayed: true });
      assert.strictEqual(await flagOf(L, T[0]), 1);
      assert.strictEqual(await flagOf(O, T[0]), 0, "the other account's save of the same event is untouched");
      r = await put(`/api/schedule/${T[0]}/played`, L, { notPlayed: false });
      assert.strictEqual(r.status, 200, r.body);
      assert.strictEqual(await flagOf(L, T[0]), 0);
    });

    await test('an event not on the schedule is a 404; a bad id is a 400; nothing changes', async () => {
      assert.strictEqual((await put(`/api/schedule/${T[3]}/played`, L, { notPlayed: true })).status, 404);
      assert.strictEqual((await put(`/api/schedule/${T[1]}/played`, O, { notPlayed: true })).status, 404, "another account's saved event");
      assert.strictEqual((await put('/api/schedule/abc/played', L, { notPlayed: true })).status, 400);
      assert.strictEqual(await flagOf(L, T[1]), 0);
    });

    await test('guests and the signed-out are refused', async () => {
      assert.strictEqual((await put(`/api/schedule/${T[0]}/played`, G, { notPlayed: true })).status, 403);
      assert.strictEqual((await put(`/api/schedule/${T[0]}/played`, {}, { notPlayed: true })).status, 401);
    });

    await test('removing an event from the schedule and saving it again starts it over (not_played 0)', async () => {
      assert.strictEqual((await put(`/api/schedule/${T[2]}/played`, L, { notPlayed: true })).status, 200);
      assert.strictEqual((await request('DELETE', `/api/schedule/${T[2]}`, { headers: L })).status, 200);
      assert.strictEqual((await post('/api/schedule', L, { tournamentId: T[2] })).status, 200);
      assert.strictEqual(await flagOf(L, T[2]), 0);
    });

    await test('POST /api/tracking ifAbsent: logs when nothing is there, and says which row it made', async () => {
      const r = await post('/api/tracking', L, { tournamentId: T[0], numEntries: 2, cashed: false, cashAmount: 0, ifAbsent: true });
      assert.strictEqual(r.status, 201, r.body);
      assert.ok(Number.isInteger(r.json.id) && r.json.id > 0, r.body);
      const rows = (await get('/api/tracking', L)).json;
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].id, r.json.id);
      assert.strictEqual(rows[0].num_entries, 2);
    });

    await test('POST /api/tracking ifAbsent: a result already there is a 409 and is left exactly as it was', async () => {
      // The live-update Finish (or another device) logged a cash for T[1] first.
      assert.strictEqual((await post('/api/tracking', L, { tournamentId: T[1], numEntries: 1, cashed: true, cashAmount: 1500, finishPlace: 7 })).status, 201);
      const before = (await get('/api/tracking', L)).json.find((x) => x.tournament_id === T[1]);
      const r = await post('/api/tracking', L, { tournamentId: T[1], numEntries: 3, cashed: false, cashAmount: 0, ifAbsent: true });
      assert.strictEqual(r.status, 409, r.body);
      assert.strictEqual(r.json.entryId, before.id);
      const after = (await get('/api/tracking', L)).json.find((x) => x.tournament_id === T[1]);
      assert.deepStrictEqual(after, before);
    });

    await test('POST /api/tracking without ifAbsent still upserts (the Results form and Finish rely on it)', async () => {
      const r = await post('/api/tracking', L, { tournamentId: T[1], numEntries: 2, cashed: true, cashAmount: 1800, finishPlace: 5 });
      assert.strictEqual(r.status, 200, r.body);
      const row = (await get('/api/tracking', L)).json.find((x) => x.tournament_id === T[1]);
      assert.strictEqual(row.cash_amount, 1800);
      assert.strictEqual(row.num_entries, 2);
      assert.strictEqual((await get('/api/tracking', L)).json.length, 2);
    });
  } finally { await down(child); }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
