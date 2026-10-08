// Server-side gates for features the app shows only to some users (owner decision 2026-10-08):
//   /api/solver/*  and  /api/staking/*   app admins only
//   POST /api/scan-table                 signed-in accounts only, 20 an hour
//   PUT  /api/tournaments/:id/total-entries   app admins only (it writes the shared event)
// Boots server.js twice on a scratch port against a scratch DB: once to register two accounts,
// then — with one renamed to the admin username 'ham', which sign-up refuses — again to test.
// Never port 3001, never poker-tournaments.db.
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
    const data = body ? JSON.stringify(body) : null;
    const h = { ...headers };
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
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

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-gates-'));
  const dbPath = path.join(tmp, 'scratch.db');
  const env = { ...process.env };
  for (const k of ['SYNC_TOKEN', 'DASHBOARD_TOKEN', 'TESTFLIGHT_WATCHDOG', 'RENDER_DEPLOY_WATCHDOG', 'SMTP_HOST', 'SMTP_USER',
    'SMTP_PASS', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'RENDER', 'TRUST_PROXY']) delete env[k];
  Object.assign(env, { JWT_SECRET: 'gates-test-secret', PORT: String(PORT), DB_PATH: dbPath });

  const pw = 'gates-test-password';
  let child = boot(env);
  try {
    await up(child);
    for (const [u, e] of [['adminx', 'adminx@x.test'], ['normal', 'normal@x.test']]) {
      const r = await request('POST', '/api/register', { body: { username: u, email: e, password: pw, realName: u } });
      assert.strictEqual(r.status, 201, `register ${u}: ${r.body}`);
    }
  } finally { await down(child); }

  // Promote adminx to the admin username directly in the scratch DB (sign-up reserves it).
  const SQL = await require(path.join(ROOT, 'node_modules', 'sql.js'))();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  db.run("UPDATE users SET username = 'ham' WHERE username = 'adminx'");
  fs.writeFileSync(dbPath, Buffer.from(db.export()));

  child = boot(env);
  try {
    await up(child);
    const login = async (email) => JSON.parse((await request('POST', '/api/login', { body: { email, password: pw } })).body).token;
    const admin = { Authorization: 'Bearer ' + await login('adminx@x.test') };
    const normal = { Authorization: 'Bearer ' + await login('normal@x.test') };
    const guest = { Authorization: 'Bearer ' + JSON.parse((await request('POST', '/api/guest-login')).body).token };

    await test('solver: guest and normal user 403, admin allowed', async () => {
      assert.strictEqual((await request('GET', '/api/solver/games', { headers: guest })).status, 403);
      assert.strictEqual((await request('GET', '/api/solver/games', { headers: normal })).status, 403);
      assert.notStrictEqual((await request('GET', '/api/solver/games', { headers: admin })).status, 403);
    });
    await test('solver: no token 401', async () => {
      assert.strictEqual((await request('GET', '/api/solver/games')).status, 401);
    });
    await test('staking: normal user 403 on read and write, admin allowed', async () => {
      assert.strictEqual((await request('GET', '/api/staking/series', { headers: normal })).status, 403);
      assert.strictEqual((await request('POST', '/api/staking/series', { headers: normal, body: { name: 'x' } })).status, 403);
      assert.notStrictEqual((await request('GET', '/api/staking/series', { headers: admin })).status, 403);
    });
    await test('scan-table: guest refused before any upload is read', async () => {
      assert.strictEqual((await request('POST', '/api/scan-table', { headers: guest })).status, 403);
    });
    await test('scan-table: a signed-in user gets through the gate (400: no image)', async () => {
      assert.strictEqual((await request('POST', '/api/scan-table', { headers: normal })).status, 400);
    });
    await test('scan-table: the 21st scan in an hour is refused (429)', async () => {
      let last = 0;
      for (let i = 0; i < 21; i++) last = (await request('POST', '/api/scan-table', { headers: admin })).status;
      assert.strictEqual(last, 429);
    });
    await test('total-entries: normal user 403, admin allowed', async () => {
      const tid = db.exec('SELECT id FROM tournaments LIMIT 1')[0];
      const id = tid ? tid.values[0][0] : 1;
      assert.strictEqual((await request('PUT', `/api/tournaments/${id}/total-entries`, { headers: normal, body: { totalEntries: 120 } })).status, 403);
      assert.notStrictEqual((await request('PUT', `/api/tournaments/${id}/total-entries`, { headers: admin, body: { totalEntries: 120 } })).status, 403);
    });
  } finally {
    await down(child);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
