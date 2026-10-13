// The backer page (/b/<token>) and its feed. The page is the app shell now (components/BackerPage.jsx
// renders it); the server's job is to serve that shell to valid tokens only, never cached, never
// indexed, sending no Referer, and to answer the feed.
//   node test/backer-page.test.js        (npm run test:backer-page; needs a vite build: public-vite/)
// Boots server.js on a scratch port against a scratch DB seeded with made-up backers
// (scripts/seed-backer-demo.js). Never port 3001, never poker-tournaments.db.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { seedBackerDemo } = require('../scripts/seed-backer-demo');

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
    const data = body ? JSON.stringify(body) : null;
    const h = { ...headers };
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const json = (r) => JSON.parse(r.body);

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
  if (!fs.existsSync(path.join(ROOT, 'public-vite', 'index.html'))) {
    console.log('FAIL: no app shell (public-vite/index.html). Build first: cd vite-app && npx vite build');
    process.exit(1);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-backer-'));
  const dbPath = path.join(tmp, 'scratch.db');
  const env = { ...process.env };
  for (const k of ['SYNC_TOKEN', 'DASHBOARD_TOKEN', 'TESTFLIGHT_WATCHDOG', 'RENDER_DEPLOY_WATCHDOG', 'SMTP_HOST', 'SMTP_USER',
    'SMTP_PASS', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'RENDER', 'TRUST_PROXY']) delete env[k];
  Object.assign(env, { JWT_SECRET: 'backer-page-test-secret', PORT: String(PORT), DB_PATH: dbPath, DISABLE_FEED_INGEST: '1' });

  // Boot once for the schema, seed the made-up backers into the file, boot again.
  let child = boot(env);
  try { await up(child); } finally { await down(child); }
  const SQL = await require(path.join(ROOT, 'node_modules', 'sql.js'))();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const tk = seedBackerDemo(db);
  fs.writeFileSync(dbPath, Buffer.from(db.export()));

  child = boot(env);
  try {
    await up(child);

    await test('/b/<valid token>: the app shell, no-store, noindex, no-referrer', async () => {
      const r = await request('GET', '/b/' + tk.full);
      assert.strictEqual(r.status, 200);
      assert.match(r.headers['content-type'], /^text\/html/);
      assert.match(r.body, /<div id="root"><\/div>/, 'the app shell');
      assert.match(r.body, /<script type="module"[^>]*src="\/assets\//, 'the built app');
      assert.match(r.headers['cache-control'], /no-store/);
      assert.match(r.headers['x-robots-tag'] || '', /noindex/);
      assert.match(r.headers['x-robots-tag'] || '', /nofollow/);
      assert.strictEqual(r.headers['referrer-policy'], 'no-referrer');
      assert.match(r.body, /<meta name="robots" content="noindex,nofollow">/);
      assert.match(r.body, /<meta name="referrer" content="no-referrer">/);
      assert.doesNotMatch(r.body, /rel="manifest"/, 'no manifest: a Home Screen launch must come back here, not to "/"');
      assert.match(r.body, /<title>Your action · futurega\.me<\/title>/);
      assert.doesNotMatch(r.body, new RegExp(tk.full), 'the shell does not carry the token');
    });

    await test('/b/<valid>/ (trailing slash) and an unknown valid token get the shell too', async () => {
      assert.strictEqual((await request('GET', '/b/' + tk.full + '/')).status, 200);
      const r = await request('GET', '/b/Unknown0Token1');
      assert.strictEqual(r.status, 200);
      assert.match(r.headers['cache-control'], /no-store/);
    });

    await test('/b/<invalid token>: 404', async () => {
      for (const bad of ['abc12', 'a'.repeat(65), 'abc-def-ghi', 'abc%20defgh', 'abc.defghi']) {
        const r = await request('GET', '/b/' + bad);
        assert.strictEqual(r.status, 404, bad);
        assert.doesNotMatch(r.body, /<div id="root">/, bad);
      }
    });

    await test('/b/sw.js: still the push worker, not a token', async () => {
      const r = await request('GET', '/b/sw.js');
      assert.strictEqual(r.status, 200);
      assert.match(r.headers['content-type'], /javascript/);
      assert.match(r.body, /addEventListener\('push'/);
      assert.match(r.body, /notificationclick/);
    });

    await test('feed: name, stakes, opening, running total, totals over every session, newest first', async () => {
      const r = await request('GET', `/api/backer/${tk.full}/feed`);
      assert.strictEqual(r.status, 200);
      assert.match(r.headers['cache-control'] || '', /no-store/);
      const f = json(r);
      assert.strictEqual(f.name, 'Sam Okafor');
      assert.strictEqual(f.stakes, '20% PLO · 10% NLH (online)');
      assert.strictEqual(f.openingCents, 50000);
      assert.strictEqual(f.events.length, 40);
      assert.strictEqual(f.sessions, 40);
      const shares = f.events.reduce((a, e) => a + e.shareCents, 0);
      assert.strictEqual(f.netSessionCents, shares);
      assert.strictEqual(f.cumulativeCents, shares + 50000);
      assert.ok(Math.abs(f.hours - f.events.reduce((a, e) => a + e.hours, 0)) < 1e-9);
      for (let i = 1; i < f.events.length; i++) assert.ok(f.events[i - 1].date >= f.events[i].date, 'newest first by session date');
      for (const k of ['ts', 'date', 'game', 'venue', 'hours', 'sessionResultCents', 'pct', 'shareCents']) assert.ok(k in f.events[0], k);
      assert.ok(!('session_id' in f.events[0]) && !('sessionId' in f.events[0]), 'the public feed carries no session ids');
    });

    await test('feed: a backer with no sessions yet (name and stakes from the roster), one, and an unknown token', async () => {
      const e = json(await request('GET', `/api/backer/${tk.empty}/feed`));
      assert.strictEqual(e.name, 'Priya Raman');
      assert.strictEqual(e.stakes, '15% all games');
      assert.deepStrictEqual([e.events.length, e.sessions, e.hours, e.cumulativeCents], [0, 0, 0, 0]);
      const one = json(await request('GET', `/api/backer/${tk.one}/feed`));
      assert.strictEqual(one.events.length, 1);
      assert.strictEqual(one.sessions, 1);
      const u = await request('GET', '/api/backer/Unknown0Token1/feed');
      assert.strictEqual(u.status, 200);
      assert.deepStrictEqual([json(u).name, json(u).events.length, json(u).cumulativeCents], [null, 0, 0]);
    });

    await test('feed and push routes: 404 for an invalid token; vapid answers; subscribe validates', async () => {
      assert.strictEqual((await request('GET', '/api/backer/abc/feed')).status, 404);
      assert.strictEqual((await request('POST', '/api/backer/abc/subscribe', { body: {} })).status, 404);
      assert.strictEqual((await request('POST', '/api/backer/abc/unsubscribe', { body: {} })).status, 404);
      const v = await request('GET', '/api/backer/vapid');
      assert.strictEqual(v.status, 200);
      assert.ok('key' in json(v));
      assert.strictEqual((await request('POST', `/api/backer/${tk.full}/subscribe`, { body: { subscription: { endpoint: 'x' } } })).status, 400);
      const sub = { endpoint: 'https://push.example.test/abc', keys: { p256dh: 'p', auth: 'a' } };
      assert.strictEqual((await request('POST', `/api/backer/${tk.full}/subscribe`, { body: { subscription: sub } })).status, 200);
      assert.strictEqual((await request('POST', `/api/backer/${tk.full}/unsubscribe`, { body: { endpoint: sub.endpoint } })).status, 200);
    });
  } finally {
    await down(child);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
