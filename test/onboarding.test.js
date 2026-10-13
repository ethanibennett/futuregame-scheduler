// First-run setup on the server (docs/onboarding.md): users.onboarding, its migration and backfill,
// GET / PUT /api/user/onboarding, /api/login's onboarding field, and /api/register signing in.
// Boots server.js twice on a scratch port against a scratch DB (the second boot re-runs a migration
// whose record the test deleted). Never port 3001, never poker-tournaments.db.
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

function request(method, p, { body, headers = {}, raw } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw != null ? raw : (body ? JSON.stringify(body) : null);
    const h = { ...headers };
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch (_) {} resolve({ status: res.statusCode, body: b, json, headers: res.headers }); });
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
    try { if ((await request('GET', '/health')).status === 200) return; } catch (_) {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('server did not come up');
}
async function down(child) {
  if (child.exitCode != null) return;
  await new Promise((r) => { child.once('exit', r); child.kill(); });
}
const bearer = (t) => ({ Authorization: 'Bearer ' + t });

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-onboarding-'));
  const dbPath = path.join(tmp, 'scratch.db');
  const env = { ...process.env };
  for (const k of ['SYNC_TOKEN', 'DASHBOARD_TOKEN', 'TESTFLIGHT_WATCHDOG', 'RENDER_DEPLOY_WATCHDOG', 'SMTP_HOST', 'SMTP_USER',
    'SMTP_PASS', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'RENDER', 'TRUST_PROXY']) delete env[k];
  Object.assign(env, { JWT_SECRET: 'onboarding-test-secret', PORT: String(PORT), DB_PATH: dbPath, DISABLE_FEED_INGEST: '1' });
  const pw = 'onboarding-test-password';
  const login = async (email) => (await request('POST', '/api/login', { body: { email, password: pw } })).json;

  // ── First boot: a fresh DB runs the migration before any account exists. ──
  let child = boot(env);
  try {
    await up(child);
    let reg;
    await test('register: 201 with a session (Create Account signs you in), onboarding null', async () => {
      reg = await request('POST', '/api/register', { body: { username: 'newbie', email: 'newbie@x.test', password: pw, realName: 'New Bie' } });
      assert.strictEqual(reg.status, 201, reg.body);
      const j = reg.json;
      assert.strictEqual(j.message, 'User created successfully');
      assert.ok(j.token && typeof j.token === 'string', 'a token');
      assert.strictEqual(j.username, 'newbie');
      assert.ok(Number.isInteger(j.userId), 'a user id');
      assert.strictEqual(j.realName, 'New Bie');
      assert.strictEqual(j.avatar, null);
      assert.strictEqual(j.handReplayerAccess, false);
      assert.strictEqual(j.onboarding, null);
      assert.ok(String(reg.headers['set-cookie'] || '').includes('fg_session='), 'the session cookie, as login sets it');
    });
    await test('register: the token works on GET /api/user/onboarding (null: never set up)', async () => {
      const r = await request('GET', '/api/user/onboarding', { headers: bearer(reg.json.token) });
      assert.strictEqual(r.status, 200, r.body);
      assert.deepStrictEqual(r.json, { onboarding: null });
    });
    await test('login: a later password sign-in still works, onboarding null', async () => {
      const j = await login('newbie@x.test');
      assert.ok(j && j.token, 'signed in');
      assert.strictEqual(j.onboarding, null);
    });
    await test('PUT then GET round-trips the record (v2, at, skipped, filters)', async () => {
      const t = (await login('newbie@x.test')).token;
      const before = Date.now();
      const put = await request('PUT', '/api/user/onboarding', { headers: bearer(t), body: { skipped: false, filters: { selectedGames: ['NLH', 'PLO'], mixedOnly: true, buyinRanges: ['0-500', '10000+'], showOnline: false, onlyAvailableOnline: true } } });
      assert.strictEqual(put.status, 200, put.body);
      const o = put.json.onboarding;
      assert.strictEqual(o.v, 2);
      assert.strictEqual(o.skipped, false);
      assert.ok(o.at >= before && o.at <= Date.now() + 1000, 'at is now');
      assert.deepStrictEqual(o.filters, { selectedGames: ['NLH', 'PLO'], mixedOnly: true, showOnline: false, onlyAvailableOnline: true, buyinRanges: ['0-500', '10000+'] });
      const get = await request('GET', '/api/user/onboarding', { headers: bearer(t) });
      assert.deepStrictEqual(get.json.onboarding, o);
      assert.deepStrictEqual((await login('newbie@x.test')).onboarding, o, 'login carries it');
    });
    await test('PUT: a skip with no filters is stored as skipped', async () => {
      const t = (await login('newbie@x.test')).token;
      const put = await request('PUT', '/api/user/onboarding', { headers: bearer(t), body: { skipped: true } });
      assert.strictEqual(put.status, 200, put.body);
      assert.strictEqual(put.json.onboarding.skipped, true);
      assert.deepStrictEqual(put.json.onboarding.filters, {});
    });
    await test('PUT: unknown keys and bad values dropped; bad types 400', async () => {
      const t = (await login('newbie@x.test')).token;
      const ok = await request('PUT', '/api/user/onboarding', { headers: bearer(t), body: { filters: { selectedGames: ['NLH', 7, '', 'x'.repeat(41), 'Razz'], buyinRanges: ['0-500', 'free', '0-500'], siteRules: { acr: {} }, evil: '<script>' } } });
      assert.strictEqual(ok.status, 200, ok.body);
      assert.deepStrictEqual(ok.json.onboarding.filters, { selectedGames: ['NLH', 'Razz'], buyinRanges: ['0-500'] });
      for (const filters of ['nope', [1, 2], { mixedOnly: 'yes' }, { showOnline: 1 }, { selectedGames: 'NLH' }, { buyinRanges: '0-500' }]) {
        const r = await request('PUT', '/api/user/onboarding', { headers: bearer(t), body: { filters } });
        assert.strictEqual(r.status, 400, `${JSON.stringify(filters)} -> ${r.status} ${r.body}`);
      }
    });
    await test('PUT: at most 30 games of 40 characters, so a record stays small; a huge body is refused', async () => {
      const t = (await login('newbie@x.test')).token;
      const many = Array.from({ length: 200 }, (_, i) => 'G'.repeat(30) + i);
      const r = await request('PUT', '/api/user/onboarding', { headers: bearer(t), body: { filters: { selectedGames: many } } });
      assert.strictEqual(r.status, 200, r.body);
      assert.strictEqual(r.json.onboarding.filters.selectedGames.length, 30);
      assert.ok(Buffer.byteLength(JSON.stringify(r.json.onboarding.filters)) <= 2048);
      const huge = await request('PUT', '/api/user/onboarding', { headers: bearer(t), raw: JSON.stringify({ filters: { selectedGames: ['x'.repeat(5 * 1024 * 1024)] } }) });
      assert.strictEqual(huge.status, 400, 'oversize refused');
    });
    await test('guest: GET says null, PUT is 403', async () => {
      const g = (await request('POST', '/api/guest-login')).json.token;
      assert.deepStrictEqual((await request('GET', '/api/user/onboarding', { headers: bearer(g) })).json, { onboarding: null });
      assert.strictEqual((await request('PUT', '/api/user/onboarding', { headers: bearer(g), body: { skipped: true } })).status, 403);
    });
    await test('no token: 401', async () => {
      assert.strictEqual((await request('GET', '/api/user/onboarding')).status, 401);
      assert.strictEqual((await request('PUT', '/api/user/onboarding', { body: {} })).status, 401);
    });
    // A second account for the backfill below.
    const r2 = await request('POST', '/api/register', { body: { username: 'oldtimer', email: 'old@x.test', password: pw, realName: 'Old Timer' } });
    assert.strictEqual(r2.status, 201, r2.body);
  } finally { await down(child); }

  // ── The legacy backfill: as if the migration had not run yet when 'oldtimer' already existed. ──
  const SQL = await require(path.join(ROOT, 'node_modules', 'sql.js'))();
  let db = new SQL.Database(fs.readFileSync(dbPath));
  const col = db.exec("SELECT onboarding FROM users WHERE username = 'oldtimer'");
  const stored = db.exec("SELECT onboarding FROM users WHERE username = 'newbie'")[0].values[0][0];
  db.run("DELETE FROM _applied_migrations WHERE name = 'users-onboarding-2026-10'");
  db.run("UPDATE users SET onboarding = NULL WHERE username = 'oldtimer'");
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();

  child = boot(env);
  try {
    await up(child);
    await test('migration: an account registered after it stays NULL until set up', async () => {
      assert.strictEqual(col[0].values[0][0], null);
    });
    await test('backfill: an account that predates the migration gets the legacy record on the next boot', async () => {
      const j = await login('old@x.test');
      assert.deepStrictEqual(j.onboarding, { v: 1, legacy: true });
      const g = await request('GET', '/api/user/onboarding', { headers: bearer(j.token) });
      assert.deepStrictEqual(g.json.onboarding, { v: 1, legacy: true });
    });
    await test('backfill: a record already set is left alone', async () => {
      const j = await login('newbie@x.test');
      assert.deepStrictEqual(j.onboarding, JSON.parse(stored));
    });
  } finally { await down(child); }

  db = new SQL.Database(fs.readFileSync(dbPath));
  await test('the migration is recorded once again', async () => {
    const n = db.exec("SELECT COUNT(*) FROM _applied_migrations WHERE name = 'users-onboarding-2026-10'")[0].values[0][0];
    assert.strictEqual(n, 1);
  });
  db.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
