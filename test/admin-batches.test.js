// Admin notification batches: POST /api/admin/notify/new-series stores each alert as a batch and
// points the push at /?batch=<id>; GET /api/admin/batches[/:id] (app admins only) lists them and
// resolves each series to its scheduler events at read time.
// Boots server.js three times on a scratch port against a scratch DB — register accounts; then, with
// one renamed to the admin 'ham' and schedule rows planted, the alert and reads; then once more with
// the missing series' rows added, to show a "not in the schedule yet" series filling in.
// Never port 3001, never poker-tournaments.db.
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
const SYNC = 'batches-test-sync-token';

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
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch (_) {} resolve({ status: res.statusCode, body: b, json }); });
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

function plant(db, rows) {
  for (const [name, date, venue, property] of rows) {
    db.run(`INSERT INTO tournaments (event_number, event_name, date, time, buyin, game_variant, venue, property, source_pdf)
            VALUES (?, ?, ?, '11:00 AM', 400, 'NLH', ?, ?, 'mtt-feed')`, [String(Math.random()).slice(2, 8), name, date, venue, property]);
  }
}

// What the watcher sends (formatNewSeriesPush): SeriesDirEntry, camelCase.
const SERIES = [
  { seriesId: '901', name: 'Big Stax XL', shortName: 'Big Stax', slug: 'big-stax-xl-parx-2026', startDate: '2026-11-05', endDate: '2026-11-15', venueId: '1', venueName: 'Parx Casino', cityState: 'Bensalem, PA' },
  { seriesId: '902', name: 'WPT Prime Lodge Championship', shortName: 'WPT Prime Lodge C...', slug: 'wpt-prime-lodge', startDate: '2026-11-01', endDate: '2026-11-12', venueId: '2', venueName: 'Lodge Card Club Austin', cityState: 'Round Rock, TX' },
  { seriesId: '903', name: 'Brand New Series ’26', shortName: 'Brand New', slug: 'brand-new-series-26', startDate: '2026-12-01', endDate: '2026-12-07', venueId: '3', venueName: 'Somewhere Casino', cityState: 'Reno, NV' },
];

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-batches-'));
  const dbPath = path.join(tmp, 'scratch.db');
  const env = { ...process.env };
  for (const k of ['SYNC_TOKEN', 'DASHBOARD_TOKEN', 'TESTFLIGHT_WATCHDOG', 'RENDER_DEPLOY_WATCHDOG', 'SMTP_HOST', 'SMTP_USER',
    'SMTP_PASS', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'RENDER', 'TRUST_PROXY']) delete env[k];
  Object.assign(env, { DISABLE_FEED_INGEST: '1', JWT_SECRET: 'batches-test-secret', PORT: String(PORT), DB_PATH: dbPath, SYNC_TOKEN: SYNC });

  const pw = 'batches-test-password';
  let child = boot(env);
  try {
    await up(child);
    for (const [u, e] of [['adminx', 'adminx@x.test'], ['normal', 'normal@x.test']]) {
      const r = await request('POST', '/api/register', { body: { username: u, email: e, password: pw, realName: u } });
      assert.strictEqual(r.status, 201, `register ${u}: ${r.body}`);
    }
  } finally { await down(child); }

  const SQL = await require(path.join(ROOT, 'node_modules', 'sql.js'))();
  let db = new SQL.Database(fs.readFileSync(dbPath));
  db.run("UPDATE users SET username = 'ham' WHERE username = 'adminx'");
  plant(db, [
    // exact: the feed's venue IS the directory name
    ['Big Stax 400 - Day 1A', 'November 5, 2026', 'Big Stax XL', 'Parx Casino'],
    ['Big Stax 400 - Day 2', 'November 7, 2026', 'Big Stax XL', 'Parx Casino'],
    // loose: another source's spelling, corroborated by room and dates
    ['WPT Prime Main Event - Day 1A', 'November 3, 2026', '2026 WPT PRIME LODGE CHAMPIONSHIP', 'Lodge Card Club Austin'],
    // same loose name at ANOTHER room — must not be pulled in
    ['WPT Prime Main Event - Day 1A', 'November 3, 2026', '2026 WPT PRIME LODGE CHAMPIONSHIP', 'Elsewhere Card Room'],
  ]);
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();

  const sync = { 'x-sync-token': SYNC };
  let batchId = null;
  child = boot(env);
  try {
    await up(child);
    const login = async (email) => JSON.parse((await request('POST', '/api/login', { body: { email, password: pw } })).body).token;
    const admin = { Authorization: 'Bearer ' + await login('adminx@x.test') };
    const normal = { Authorization: 'Bearer ' + await login('normal@x.test') };
    const guest = { Authorization: 'Bearer ' + JSON.parse((await request('POST', '/api/guest-login')).body).token };

    await test('notify: wrong or missing sync token is 403 and stores nothing', async () => {
      assert.strictEqual((await request('POST', '/api/admin/notify/new-series', { body: { title: 't', body: 'b' } })).status, 403);
      assert.strictEqual((await request('POST', '/api/admin/notify/new-series', { headers: { 'x-sync-token': 'nope' }, body: { title: 't', body: 'b' } })).status, 403);
      const list = await request('GET', '/api/admin/batches', { headers: admin });
      assert.deepStrictEqual(list.json.batches, []);
    });
    await test('notify: dryRun creates no batch', async () => {
      const r = await request('POST', '/api/admin/notify/new-series', { headers: sync, body: { dryRun: true } });
      assert.strictEqual(r.status, 200, r.body);
      assert.strictEqual(r.json.dryRun, true);
      assert.strictEqual(r.json.batchId, undefined);
      const list = await request('GET', '/api/admin/batches', { headers: admin });
      assert.strictEqual(list.json.batches.length, 0);
    });
    await test('notify: an alert stores a batch and links the push to /?batch=<id>', async () => {
      const r = await request('POST', '/api/admin/notify/new-series', {
        headers: sync, body: { title: '3 new series', body: 'Big Stax XL · WPT Prime Lodge Championship · Brand New Series', series: SERIES, url: '/' },
      });
      assert.strictEqual(r.status, 200, r.body);
      assert.ok(Number.isInteger(r.json.batchId) && r.json.batchId > 0, 'batchId ' + r.body);
      batchId = r.json.batchId;
      assert.strictEqual(r.json.link, `/?batch=${batchId}`);
      assert.strictEqual(r.json.seriesCount, 3);
      assert.strictEqual(r.json.vapidConfigured, false); // the push itself no-ops here
    });
    await test('notify: a single-series alert also links to its batch, not the caller\'s /?find=', async () => {
      const r = await request('POST', '/api/admin/notify/new-series', {
        headers: sync, body: { title: 'New series: Big Stax XL', body: 'Parx Casino', series: [SERIES[0]], url: '/?find=Big%20Stax%20XL' },
      });
      assert.strictEqual(r.status, 200, r.body);
      assert.strictEqual(r.json.link, `/?batch=${r.json.batchId}`);
      assert.ok(r.json.batchId > batchId);
    });
    await test('batches: admin lists them newest first, with counts', async () => {
      const r = await request('GET', '/api/admin/batches', { headers: admin });
      assert.strictEqual(r.status, 200, r.body);
      const [newest, first] = r.json.batches;
      assert.strictEqual(r.json.batches.length, 2);
      assert.ok(newest.id > first.id);
      assert.strictEqual(first.id, batchId);
      assert.strictEqual(first.title, '3 new series');
      assert.strictEqual(first.seriesCount, 3);
      assert.strictEqual(first.scheduledSeries, 2);
      assert.strictEqual(first.eventCount, 3);
      assert.match(first.created_at, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    });
    await test('batch: admin reads one with each series matched to its events', async () => {
      const r = await request('GET', `/api/admin/batches/${batchId}`, { headers: admin });
      assert.strictEqual(r.status, 200, r.body);
      const [stax, wpt, fresh] = r.json.series;
      assert.strictEqual(r.json.batch.eventCount, 3);
      assert.strictEqual(stax.match, 'exact');
      assert.strictEqual(stax.status, 'scheduled');
      // in date order (the boot-time name normaliser may prefix the game, so match the tail)
      assert.strictEqual(stax.events.length, 2);
      assert.match(stax.events[0].event_name, /Big Stax 400 - Day 1A$/);
      assert.match(stax.events[1].event_name, /Big Stax 400 - Day 2$/);
      assert.strictEqual(wpt.match, 'loose');
      assert.strictEqual(wpt.eventCount, 1);
      assert.strictEqual(wpt.events[0].property, 'Lodge Card Club Austin');
      assert.strictEqual(fresh.match, 'none');
      assert.strictEqual(fresh.status, 'pending');
      assert.deepStrictEqual(fresh.events, []);
      assert.strictEqual(fresh.venueName, 'Somewhere Casino');
    });
    await test('batch: unknown id is 404', async () => {
      assert.strictEqual((await request('GET', '/api/admin/batches/99999', { headers: admin })).status, 404);
      assert.strictEqual((await request('GET', '/api/admin/batches/abc', { headers: admin })).status, 404);
    });
    await test('batches: normal user and guest 403, no token 401', async () => {
      for (const h of [normal, guest]) {
        assert.strictEqual((await request('GET', '/api/admin/batches', { headers: h })).status, 403);
        assert.strictEqual((await request('GET', `/api/admin/batches/${batchId}`, { headers: h })).status, 403);
      }
      assert.strictEqual((await request('GET', '/api/admin/batches')).status, 401);
      assert.strictEqual((await request('GET', `/api/admin/batches/${batchId}`)).status, 401);
    });
  } finally { await down(child); }

  // The feed ingests after the alert: the series that was "not in the schedule yet" arrives.
  db = new SQL.Database(fs.readFileSync(dbPath));
  plant(db, [['Brand New Opener', 'December 1, 2026', 'Brand New Series ‘26', 'Somewhere Casino']]);
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();

  child = boot(env);
  try {
    await up(child);
    const login = async (email) => JSON.parse((await request('POST', '/api/login', { body: { email, password: pw } })).body).token;
    const admin = { Authorization: 'Bearer ' + await login('adminx@x.test') };
    await test('batch: persists across a restart, and a pending series fills in once its rows exist', async () => {
      const r = await request('GET', `/api/admin/batches/${batchId}`, { headers: admin });
      assert.strictEqual(r.status, 200, r.body);
      const fresh = r.json.series[2];
      assert.strictEqual(fresh.status, 'scheduled');
      assert.strictEqual(fresh.match, 'normalized'); // the feed wrote a different apostrophe
      assert.strictEqual(fresh.events.length, 1);
      assert.match(fresh.events[0].event_name, /Brand New Opener$/);
      assert.strictEqual(r.json.batch.eventCount, 4);
    });
  } finally {
    await down(child);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
