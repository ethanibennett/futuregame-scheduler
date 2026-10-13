// Edit home, server side: GET / PUT /api/user/home-layout (lib/home-layout.js checks the shape;
// the client, vite-app/src/utils/home-layout.js, owns the document) and the dataMigration that adds
// users.home_layout.
//
//   node test/home-layout.test.js        (or: npm run test:home-layout)
//
// Boots server.js twice on a scratch port against a scratch DB (never port 3001, never
// poker-tournaments.db): once to register the accounts, then again on the same DB, which must not
// run (or fail) the migration a second time. HOME_LAYOUT_TEST_PORT picks the port.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { validateHomeLayout } = require('../lib/home-layout');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.HOME_LAYOUT_TEST_PORT) || (48000 + Math.floor(Math.random() * 1500));
assert.notStrictEqual(PORT, 3001);

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}

function request(method, p, { body, headers = {}, raw } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : null);
    const h = { ...headers };
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch (_) { /* not json */ } resolve({ status: res.statusCode, body: b, json }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

function boot(env, log) {
  const child = spawn(process.execPath, ['-r', path.join(__dirname, 'stub-solver-preload.js'), 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (c) => log.push(String(c))); child.stderr.on('data', (c) => log.push(String(c)));
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

const doc = (...ids) => ({ v: 1, sections: ids.map((x) => (typeof x === 'string' ? { id: x, on: true } : x)) });

(async () => {
  // The shape check alone, before any server.
  await test('validateHomeLayout: null is the default; extra keys stripped; updatedAt stamped', async () => {
    assert.deepStrictEqual(validateHomeLayout(null), { ok: true, layout: null });
    const v = validateHomeLayout({ v: 1, sections: [{ id: 'tolog', on: false, extra: 1 }], updatedAt: 'client', junk: true }, { now: '2026-10-13T20:00:00.000Z' });
    assert.deepStrictEqual(v, { ok: true, layout: { v: 1, sections: [{ id: 'tolog', on: false }], updatedAt: '2026-10-13T20:00:00.000Z' } });
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-homelayout-'));
  const dbPath = path.join(tmp, 'scratch.db');
  assert.notStrictEqual(path.basename(dbPath), 'poker-tournaments.db');
  const env = { ...process.env };
  for (const k of ['SYNC_TOKEN', 'DASHBOARD_TOKEN', 'TESTFLIGHT_WATCHDOG', 'RENDER_DEPLOY_WATCHDOG', 'SMTP_HOST', 'SMTP_USER',
    'SMTP_PASS', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'RENDER', 'TRUST_PROXY']) delete env[k];
  Object.assign(env, { JWT_SECRET: 'homelayout-test-secret', PORT: String(PORT), DB_PATH: dbPath, DISABLE_FEED_INGEST: '1' });

  const pw = 'homelayout-test-password';
  const log1 = [];
  let child = boot(env, log1);
  try {
    await up(child);
    for (const u of ['layouta', 'layoutb']) {
      const r = await request('POST', '/api/register', { body: { username: u, email: `${u}@x.test`, password: pw, realName: u } });
      assert.strictEqual(r.status, 201, `register ${u}: ${r.body}`);
    }
  } finally { await down(child); }

  await test('the first boot applies the migration', async () => {
    const out = log1.join('');
    assert.ok(/Migration "users-home-layout-2026-10" applied/.test(out), 'no "applied" line');
    assert.ok(!/Migration "users-home-layout-2026-10" failed/.test(out), 'it failed');
  });

  const log2 = [];
  child = boot(env, log2);
  try {
    await up(child);
    await test('booting again on the same DB neither re-runs nor fails the migration', async () => {
      const out = log2.join('');
      assert.ok(!/Migration "users-home-layout-2026-10" failed/.test(out), 'failed on the second boot');
      assert.ok(!/Migration "users-home-layout-2026-10" applied/.test(out), 'ran twice');
    });

    const login = async (email) => (await request('POST', '/api/login', { body: { email, password: pw } })).json.token;
    const A = { Authorization: 'Bearer ' + await login('layouta@x.test') };
    const B = { Authorization: 'Bearer ' + await login('layoutb@x.test') };
    const G = { Authorization: 'Bearer ' + (await request('POST', '/api/guest-login')).json.token };
    const get = (h) => request('GET', '/api/user/home-layout', { headers: h });
    const put = (h, body) => request('PUT', '/api/user/home-layout', { headers: h, body });

    await test('auth: no token is a 401; a guest reads null and cannot write', async () => {
      assert.strictEqual((await get({})).status, 401);
      assert.strictEqual((await put({}, { layout: null })).status, 401);
      const g = await get(G);
      assert.strictEqual(g.status, 200, g.body);
      assert.deepStrictEqual(g.json, { layout: null });
      const w = await put(G, { layout: doc('upnext') });
      assert.strictEqual(w.status, 403, w.body);
      assert.strictEqual(w.json.error, 'Sign up to use this feature');
    });

    await test('round trip: null at first; a valid document is stored, stamped and read back; null clears it', async () => {
      assert.deepStrictEqual((await get(A)).json, { layout: null });
      const d = doc('bankroll', 'upnext', 'period', { id: 'tolog', on: false }, 'last', { id: 'noise', on: false }, 'goals');
      const w = await put(A, { layout: { ...d, updatedAt: 'from the client' } });
      assert.strictEqual(w.status, 200, w.body);
      assert.deepStrictEqual(w.json.layout.sections, d.sections);
      assert.ok(!Number.isNaN(Date.parse(w.json.layout.updatedAt)) && w.json.layout.updatedAt !== 'from the client', 'the server stamps updatedAt');
      assert.deepStrictEqual((await get(A)).json.layout, w.json.layout);
      const c = await put(A, { layout: null });
      assert.strictEqual(c.status, 200, c.body);
      assert.deepStrictEqual(c.json, { layout: null });
      assert.deepStrictEqual((await get(A)).json, { layout: null });
    });

    await test('validation: every malformed body is a 400 and changes nothing', async () => {
      const keep = await put(A, { layout: doc('last', 'upnext') });
      assert.strictEqual(keep.status, 200);
      const many = Array.from({ length: 33 }, (_, i) => ({ id: `s${i}`, on: true }));
      const bodies = [
        {}, { layout: 'x' }, { layout: 1 }, { layout: [] }, { layout: { v: 2, sections: [{ id: 'upnext', on: true }] } },
        { layout: { v: 1 } }, { layout: { v: 1, sections: [] } }, { layout: { v: 1, sections: many } },
        { layout: { v: 1, sections: [{ id: 'Upnext', on: true }] } }, { layout: { v: 1, sections: [{ id: 'a_b', on: true }] } },
        { layout: { v: 1, sections: [{ id: 'x'.repeat(25), on: true }] } }, { layout: { v: 1, sections: [{ id: 'tolog', on: 'yes' }] } },
        { layout: { v: 1, sections: [{ id: 'tolog' }] } }, { layout: { v: 1, sections: [{ id: 'tolog', on: true }, { id: 'tolog', on: false }] } },
        { layout: { v: 1, sections: ['tolog'] } }, { layout: { v: 1, sections: [null] } },
      ];
      for (const b of bodies) {
        const r = await put(A, b);
        assert.strictEqual(r.status, 400, `${JSON.stringify(b).slice(0, 80)} -> ${r.status} ${r.body}`);
        assert.strictEqual(r.json.error, 'Invalid home layout');
      }
      const raw = await request('PUT', '/api/user/home-layout', { headers: A, raw: '{"layout":' });
      assert.strictEqual(raw.status, 400, 'unparseable JSON');
      assert.deepStrictEqual((await get(A)).json.layout.sections, keep.json.layout.sections, 'nothing changed');
    });

    await test('unknown ids are accepted and stored as sent (a newer build\'s sections)', async () => {
      const d = doc('upnext', { id: 'trend', on: true }, { id: 'future-thing', on: false }, 'period');
      const w = await put(A, { layout: d });
      assert.strictEqual(w.status, 200, w.body);
      assert.deepStrictEqual((await get(A)).json.layout.sections, d.sections);
    });

    await test("one account's layout is not another's", async () => {
      assert.deepStrictEqual((await get(B)).json, { layout: null });
      const w = await put(B, { layout: doc('period', 'upnext') });
      assert.strictEqual(w.status, 200);
      assert.deepStrictEqual((await get(A)).json.layout.sections.map((e) => e.id), ['upnext', 'trend', 'future-thing', 'period']);
      assert.deepStrictEqual((await get(B)).json.layout.sections.map((e) => e.id), ['period', 'upnext']);
    });
  } finally { await down(child); }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
