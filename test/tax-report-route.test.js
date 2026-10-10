// GET /api/tax-report/entries — the BETA year-end tax report's data route.
//   app admins only (requireAppAdmin); returns only the caller's own rows, each with the room,
//   online flag/site, and the room's city/state from data/venue-directory.json.
// Boots server.js twice on a scratch port against a scratch DB (copy of test/server-gates.test.js):
// once to register two accounts, then — with one renamed to the admin username 'ham' and results
// planted — again to test. Never port 3001, never poker-tournaments.db.
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-taxr-'));
  const dbPath = path.join(tmp, 'scratch.db');
  const env = { ...process.env };
  for (const k of ['SYNC_TOKEN', 'DASHBOARD_TOKEN', 'TESTFLIGHT_WATCHDOG', 'RENDER_DEPLOY_WATCHDOG', 'SMTP_HOST', 'SMTP_USER',
    'SMTP_PASS', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'RENDER', 'TRUST_PROXY']) delete env[k];
  Object.assign(env, { DISABLE_FEED_INGEST: '1', JWT_SECRET: 'taxr-test-secret', PORT: String(PORT), DB_PATH: dbPath });

  const pw = 'taxr-test-password';
  let child = boot(env);
  try {
    await up(child);
    for (const [u, e] of [['adminx', 'adminx@x.test'], ['normal', 'normal@x.test']]) {
      const r = await request('POST', '/api/register', { body: { username: u, email: e, password: pw, realName: u } });
      assert.strictEqual(r.status, 201, `register ${u}: ${r.body}`);
    }
  } finally { await down(child); }

  // Promote adminx to 'ham' (sign-up reserves it) and plant three events + results.
  const SQL = await require(path.join(ROOT, 'node_modules', 'sql.js'))();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  db.run("UPDATE users SET username = 'ham' WHERE username = 'adminx'");
  const uid = (name) => db.exec(`SELECT id FROM users WHERE username = '${name}'`)[0].values[0][0];
  const ins = (o) => {
    db.run(`INSERT INTO tournaments (event_number, event_name, date, time, buyin, game_variant, venue, property, is_online, site)
            VALUES (?,?,?,?,?,?,?,?,?,?)`, [o.n, o.name, o.date, '12:00 PM', o.buyin, 'NLH', o.venue, o.property || null, o.online ? 1 : 0, o.site || null]);
    return db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  };
  const live = ins({ n: '7', name: 'NLH Main Event', date: '2025-10-12', buyin: 600, venue: 'Big Stax XL', property: 'Parx Casino' });
  const onl = ins({ n: '3', name: 'NLH Bounty', date: '2025-11-02', buyin: 215, venue: 'WSOP Online Test', online: true, site: 'WSOP.com' });
  const other = ins({ n: '9', name: 'PLO', date: '2025-12-01', buyin: 300, venue: 'Big Stax XL', property: 'Parx Casino' });
  db.run('INSERT INTO tracking_entries (user_id, tournament_id, num_entries, cashed, finish_place, cash_amount) VALUES (?,?,?,?,?,?)', [uid('ham'), live, 2, 1, 4, 9100]);
  db.run('INSERT INTO tracking_entries (user_id, tournament_id, num_entries, cashed, finish_place, cash_amount) VALUES (?,?,?,?,?,?)', [uid('ham'), onl, 1, 0, null, 0]);
  db.run('INSERT INTO tracking_entries (user_id, tournament_id, num_entries, cashed, finish_place, cash_amount) VALUES (?,?,?,?,?,?)', [uid('normal'), other, 1, 0, null, 0]);
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();

  child = boot(env);
  try {
    await up(child);
    const login = async (email) => JSON.parse((await request('POST', '/api/login', { body: { email, password: pw } })).body).token;
    const admin = { Authorization: 'Bearer ' + await login('adminx@x.test') };
    const normal = { Authorization: 'Bearer ' + await login('normal@x.test') };
    const guest = { Authorization: 'Bearer ' + JSON.parse((await request('POST', '/api/guest-login')).body).token };

    await test('no token 401', async () => {
      assert.strictEqual((await request('GET', '/api/tax-report/entries')).status, 401);
    });
    await test('guest and normal user 403 (beta: admins only)', async () => {
      assert.strictEqual((await request('GET', '/api/tax-report/entries', { headers: guest })).status, 403);
      assert.strictEqual((await request('GET', '/api/tax-report/entries', { headers: normal })).status, 403);
    });
    let entries = null;
    await test('admin 200, only their own rows, oldest first', async () => {
      const r = await request('GET', '/api/tax-report/entries', { headers: admin });
      assert.strictEqual(r.status, 200, r.body);
      entries = JSON.parse(r.body).entries;
      assert.deepStrictEqual(entries.map((e) => e.event_name), ['NLH Main Event', 'NLH Bounty']);
    });
    await test('live row carries room + city/state from the PokerAtlas directory', async () => {
      const e = entries[0];
      assert.strictEqual(e.property, 'Parx Casino');
      assert.strictEqual(e.city_state, 'Bensalem, PA');
      assert.strictEqual(e.num_entries, 2);
      assert.strictEqual(e.cash_amount, 9100);
      assert.strictEqual(e.buyin, 600);
      assert.strictEqual(e.date, '2025-10-12');
    });
    await test('online row carries the site and no city/state', async () => {
      const e = entries[1];
      assert.strictEqual(e.is_online, 1);
      assert.strictEqual(e.site, 'WSOP.com');
      assert.strictEqual(e.city_state, null);
    });
  } finally {
    await down(child);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
