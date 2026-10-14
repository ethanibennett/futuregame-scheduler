'use strict';
/*
 * The backer-roster pull (syncBackerRoster): ROSTER_TOKEN, the Bearer header,
 * self-disable, and the fetch timeout.
 *
 *   node test/roster-sync.test.js        (npm run test:roster)
 *
 * What this protects: the dashboard's roster is every backer's /b/ link token,
 * phone and email. It used to be pulled with DASHBOARD_TOKEN in the URL path, a
 * secret compiled into the iOS builds. The pull now carries a server-only
 * ROSTER_TOKEN as `Authorization: Bearer`, never in the URL, and does nothing —
 * loudly, once — without it.
 *
 * Boots server.js four times on SCRATCH ports against SCRATCH databases, each
 * pointed (DASHBOARD_BASE_URL) at a stub dashboard that lives in this process:
 *   1. ROSTER_TOKEN set       -> the stub receives GET /api/roster with the Bearer
 *                                header and nothing else secret; the roster lands
 *                                (LWW upsert unchanged) and the backer's feed shows it.
 *   2. ROSTER_TOKEN unset     -> the stub receives NOTHING, even though DASHBOARD_TOKEN
 *                                is set; one log line says the sync is off.
 *   3. dashboard never answers -> the pull is abandoned at ROSTER_FETCH_TIMEOUT_MS.
 *   4. dashboard stalls mid-body -> the timeout covers the body too.
 * Never port 3001, never poker-tournaments.db or any copy of it. The ./solver
 * junction is not needed (test/stub-solver-preload.js). Every token is made up.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

const ROSTER = 'test-roster-token-' + 'r'.repeat(40);
const DASH = 'dashboardtokenfortestsonly' + 'd'.repeat(30);
const BACKER = { id: 'bk-roster-test', name: 'Roster Test Backer', token: 'TESTTK01', stakes: [], opening: 0 };
const TIMEOUT_MS = 800;

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n       ') : err}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return; await sleep(100); }
  throw new Error(`timed out after ${ms} ms waiting for ${what}`);
}

/* ── a stub dashboard ─────────────────────────────────────────────────────── */

/** mode: 'ok' answers like the real dashboard; 'hang' accepts and never replies;
 *  'stall' sends the headers and half a body, then goes quiet. */
function stubDashboard(mode) {
  const seen = []; // every request, as the dashboard would see it
  const server = http.createServer((req, res) => {
    const entry = { method: req.method, url: req.url, headers: { ...req.headers }, closedEarly: false };
    seen.push(entry);
    res.on('close', () => { if (!res.writableFinished) entry.closedEarly = true; });
    if (mode === 'hang') return; // never answer
    // The real dashboard's rule: 404 unless the Bearer header is right. A wrong
    // header therefore shows up as a failed sync, not just a failed assertion.
    const authorised = req.method === 'GET' && req.url === '/api/roster' && req.headers.authorization === `Bearer ${ROSTER}`;
    if (!authorised) { res.statusCode = 404; return res.end('{"error":"Not found"}'); }
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'stall') { res.write('{"now":1,"records":['); return; } // never ends
    res.end(JSON.stringify({
      now: Date.now(),
      records: [{ store: 'backers', id: BACKER.id, data: JSON.stringify(BACKER), updatedAt: Date.now(), deleted: false }],
    }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    seen, port: server.address().port,
    close: () => { server.closeAllConnections && server.closeAllConnections(); return new Promise((r) => server.close(r)); },
  })));
}

/* ── booting server.js ────────────────────────────────────────────────────── */

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function request(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch (_) {} resolve({ status: res.statusCode, body: b, json }); });
    }).on('error', reject);
  });
}

const children = new Set();
process.on('exit', () => { for (const c of children) { try { c.kill(); } catch (_) { /* gone */ } } });

async function bootServer(extraEnv) {
  const port = await freePort();
  if (port === 3001) throw new Error('refusing to test on 3001 — the pm2 server owns it');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-roster-test-'));
  const env = { ...process.env };
  // Nothing from the developer's shell may reach production or decide the outcome.
  for (const k of ['SYNC_TOKEN', 'DASHBOARD_TOKEN', 'DASHBOARD_TOKEN_PREVIOUS', 'ROSTER_TOKEN', 'ROSTER_TOKEN_PREVIOUS',
    'ROSTER_FETCH_TIMEOUT_MS', 'DASHBOARD_BASE_URL', 'TESTFLIGHT_WATCHDOG', 'RENDER_DEPLOY_WATCHDOG', 'SMTP_HOST', 'SMTP_USER',
    'SMTP_PASS', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'RENDER', 'TRUST_PROXY']) delete env[k];
  Object.assign(env, {
    JWT_SECRET: 'roster-sync-test-secret-not-for-prod',
    PORT: String(port),
    DB_PATH: path.join(tmp, 'scratch.db'),
    DISABLE_FEED_INGEST: '1',
  }, extraEnv);
  const child = spawn(process.execPath, ['-r', path.join(__dirname, 'stub-solver-preload.js'), 'server.js'], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const end = Date.now() + 60000;
  for (;;) {
    if (child.exitCode != null) throw new Error(`server exited with ${child.exitCode}:\n${log}`);
    try { if ((await request(port, '/health')).status === 200) break; } catch (_) { /* not up yet */ }
    if (Date.now() > end) throw new Error('server did not come up:\n' + log);
    await sleep(300);
  }
  return {
    port, log: () => log,
    stop: async () => {
      if (child.exitCode == null) await new Promise((r) => { child.once('exit', r); child.kill(); });
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    },
  };
}

const count = (haystack, needle) => haystack.split(needle).length - 1;

(async () => {
  /* ── 1. ROSTER_TOKEN set ─────────────────────────────────────────────────── */
  console.log('ROSTER_TOKEN set');
  {
    const stub = await stubDashboard('ok');
    // DASHBOARD_TOKEN is set too, on purpose: it must not be what is sent.
    const srv = await bootServer({ DASHBOARD_BASE_URL: `http://127.0.0.1:${stub.port}`, ROSTER_TOKEN: ROSTER, DASHBOARD_TOKEN: DASH });
    try {
      await until(() => stub.seen.length > 0, 20000, 'the boot-time pull to reach the stub');
      await until(() => /backer roster synced from dashboard/.test(srv.log()), 20000, 'the roster to be merged');

      await test('the pull is GET /api/roster with nothing in the URL', () => {
        const r = stub.seen[0];
        assert.strictEqual(r.method, 'GET');
        assert.strictEqual(r.url, '/api/roster', 'no token, no query string');
      });
      await test('and it carries ROSTER_TOKEN as an Authorization: Bearer header', () => {
        assert.strictEqual(stub.seen[0].headers.authorization, `Bearer ${ROSTER}`);
      });
      await test('DASHBOARD_TOKEN is sent nowhere (URL or any header)', () => {
        const wire = JSON.stringify({ url: stub.seen[0].url, headers: stub.seen[0].headers });
        assert.ok(!wire.includes(DASH), 'DASHBOARD_TOKEN leaked onto the wire');
      });
      await test('ROSTER_TOKEN is sent nowhere else (URL or any other header)', () => {
        const { authorization, ...rest } = stub.seen[0].headers;
        assert.ok(!stub.seen[0].url.includes(ROSTER));
        assert.ok(!JSON.stringify(rest).includes(ROSTER));
      });
      await test('the roster still lands (LWW upsert unchanged) and shows on the backer\'s feed', async () => {
        assert.match(srv.log(), /\[roster\] backer roster synced from dashboard: 1 row\(s\) updated/);
        const feed = await request(srv.port, `/api/backer/${BACKER.token}/feed`);
        assert.strictEqual(feed.status, 200);
        assert.strictEqual(feed.json.name, BACKER.name);
      });
      await test('the first good pull is logged once (the positive signal for a rollout)', () => {
        assert.strictEqual(count(srv.log(), '[roster] pull from the dashboard ok — 1 record(s) offered'), 1);
      });
      await test('no secret appears in the server log', () => {
        assert.ok(!srv.log().includes(ROSTER));
        assert.ok(!srv.log().includes(DASH));
      });
      await test('and no "not set" warning when it is set', () => {
        assert.ok(!/ROSTER_TOKEN is not set/.test(srv.log()));
      });
    } finally { await srv.stop(); await stub.close(); }
  }

  /* ── 2. ROSTER_TOKEN unset ───────────────────────────────────────────────── */
  console.log('ROSTER_TOKEN unset (DASHBOARD_TOKEN set)');
  {
    const stub = await stubDashboard('ok');
    // The old trigger is present and must not matter any more.
    const srv = await bootServer({ DASHBOARD_BASE_URL: `http://127.0.0.1:${stub.port}`, DASHBOARD_TOKEN: DASH });
    try {
      await until(() => /ROSTER_TOKEN is not set/.test(srv.log()), 20000, 'the "not set" line');
      await sleep(2000); // long enough for a request, were one going to be made
      await test('nothing at all is sent to the dashboard', () => {
        assert.strictEqual(stub.seen.length, 0, `the stub saw ${JSON.stringify(stub.seen.map((s) => s.url))}`);
      });
      await test('DASHBOARD_TOKEN alone does not enable the sync', () => {
        assert.ok(!/backer roster synced|pull from the dashboard ok|backer roster sync failed/.test(srv.log()));
      });
      await test('the log says so exactly once, and says what to do', () => {
        assert.strictEqual(count(srv.log(), '[roster] ROSTER_TOKEN is not set'), 1);
        assert.match(srv.log(), /backer roster sync is OFF/);
        assert.match(srv.log(), /production Render service/);
      });
      await test('and no roster arrived', async () => {
        const feed = await request(srv.port, `/api/backer/${BACKER.token}/feed`);
        assert.strictEqual(feed.status, 200);
        assert.strictEqual(feed.json.name, null);
      });
      await test('the log carries no token', () => {
        assert.ok(!srv.log().includes(ROSTER));
        assert.ok(!srv.log().includes(DASH));
      });
    } finally { await srv.stop(); await stub.close(); }
  }

  /* ── 3. the dashboard never answers ──────────────────────────────────────── */
  console.log('the dashboard accepts the connection and never answers');
  {
    const stub = await stubDashboard('hang');
    const srv = await bootServer({ DASHBOARD_BASE_URL: `http://127.0.0.1:${stub.port}`, ROSTER_TOKEN: ROSTER, ROSTER_FETCH_TIMEOUT_MS: String(TIMEOUT_MS) });
    try {
      await until(() => stub.seen.length > 0, 20000, 'the pull to reach the stub');
      const sentAt = Date.now();
      await until(() => /backer roster sync failed/.test(srv.log()), 20000, 'the pull to be abandoned');
      const waited = Date.now() - sentAt;

      await test(`the pull is abandoned at ROSTER_FETCH_TIMEOUT_MS (${TIMEOUT_MS} ms), not left hanging`, () => {
        assert.match(srv.log(), new RegExp(`\\[roster\\] backer roster sync failed: timed out after ${TIMEOUT_MS} ms`));
        assert.ok(waited < 10000, `took ${waited} ms after the request arrived`);
      });
      await test('it really was sent with the Bearer header before it hung', () => {
        assert.strictEqual(stub.seen[0].headers.authorization, `Bearer ${ROSTER}`);
        assert.strictEqual(stub.seen[0].url, '/api/roster');
      });
      await test('the client hung up on the stub (the connection is not leaked)', async () => {
        await until(() => stub.seen[0].closedEarly, 5000, 'the stub to see the client disconnect');
      });
      await test('the server stays healthy through it, and logs the failure once', async () => {
        assert.strictEqual((await request(srv.port, '/health')).status, 200);
        assert.strictEqual(count(srv.log(), 'backer roster sync failed'), 1);
        assert.ok(!srv.log().includes(ROSTER));
      });
    } finally { await srv.stop(); await stub.close(); }
  }

  /* ── 4. the dashboard stalls mid-body ────────────────────────────────────── */
  console.log('the dashboard sends the headers and half a body, then goes quiet');
  {
    const stub = await stubDashboard('stall');
    const srv = await bootServer({ DASHBOARD_BASE_URL: `http://127.0.0.1:${stub.port}`, ROSTER_TOKEN: ROSTER, ROSTER_FETCH_TIMEOUT_MS: String(TIMEOUT_MS) });
    try {
      await until(() => stub.seen.length > 0, 20000, 'the pull to reach the stub');
      await until(() => /backer roster sync failed/.test(srv.log()), 20000, 'the pull to be abandoned');
      await test('the timeout covers reading the body, not just the headers', () => {
        assert.match(srv.log(), new RegExp(`backer roster sync failed: timed out after ${TIMEOUT_MS} ms`));
      });
      await test('and a half-read roster merges nothing', () => {
        assert.ok(!/backer roster synced from dashboard/.test(srv.log()));
      });
    } finally { await srv.stop(); await stub.close(); }
  }

  console.log(`\nroster-sync.test.js — ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
