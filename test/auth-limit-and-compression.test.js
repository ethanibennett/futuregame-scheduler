'use strict';
/*
 * Auth brute-force limiter + response compression + SSE-under-compression.
 *
 *   node test/auth-limit-and-compression.test.js
 *
 * Part 1 is pure unit tests of lib/auth-limiter.js on a fake clock.
 * Part 2 boots server.js on a SCRATCH port against a SCRATCH database and
 * drives it over HTTP. It never touches port 3001 or poker-tournaments.db:
 *   - default: a fresh DB file in the OS temp dir, which server.js seeds with
 *     the sample WSOP schedule on first boot (no live data, no credentials);
 *   - FIXTURE_DB=<path>: that file is COPIED to the temp dir and the copy used.
 * The ./solver junction is not required (test/stub-solver-preload.js), and the
 * cross-system tokens (SYNC_TOKEN, DASHBOARD_TOKEN, watchdogs, SMTP) are stripped
 * from the child's environment so it cannot reach production.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const {
  createSlidingWindowLimiter, ipKey, accountKey, resolveTrustProxy, describeProxyChain,
} = require(path.join(ROOT, 'lib', 'auth-limiter'));

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n       ') : err}`);
  }
}

/* ── Part 1: unit ─────────────────────────────────────────────────────────── */

async function unit() {
  console.log('lib/auth-limiter.js');

  await test('10 attempts pass, the 11th is refused with Retry-After = time to oldest expiry', () => {
    let t = 1_000_000;
    const L = createSlidingWindowLimiter({ limit: 10, windowMs: 15 * 60_000, now: () => t });
    for (let i = 0; i < 10; i++) { assert.strictEqual(L.retryAfter('k'), 0); L.hit('k'); t += 1000; }
    // oldest hit at 1_000_000, now = 1_010_000 → 900 s - 10 s
    assert.strictEqual(L.retryAfter('k'), 890);
  });

  await test('the window slides: one slot frees as each attempt ages out', () => {
    let t = 0;
    const L = createSlidingWindowLimiter({ limit: 3, windowMs: 60_000, now: () => t });
    L.hit('k'); t = 10_000; L.hit('k'); t = 20_000; L.hit('k');
    t = 59_999; assert.ok(L.retryAfter('k') > 0, 'still full just before the first expires');
    t = 60_000; assert.strictEqual(L.retryAfter('k'), 0, 'first attempt has aged out');
    L.hit('k');
    assert.ok(L.retryAfter('k') > 0, 'full again');
    t = 70_000; assert.strictEqual(L.retryAfter('k'), 0, 'second attempt has aged out');
  });

  await test('refund removes exactly the stamped attempt; clear forgets the key', () => {
    let t = 0;
    const L = createSlidingWindowLimiter({ limit: 2, windowMs: 60_000, now: () => t });
    L.hit('k'); t = 1; const s = L.hit('k');
    assert.ok(L.retryAfter('k') > 0);
    L.refund('k', s);
    assert.strictEqual(L.retryAfter('k'), 0);
    L.hit('k'); L.clear('k');
    assert.strictEqual(L.size(), 0);
  });

  await test('keys are independent', () => {
    const L = createSlidingWindowLimiter({ limit: 1, windowMs: 60_000 });
    L.hit('a');
    assert.ok(L.retryAfter('a') > 0);
    assert.strictEqual(L.retryAfter('b'), 0);
  });

  await test('stale keys are swept so the map cannot grow without bound', () => {
    let t = 0;
    const L = createSlidingWindowLimiter({ limit: 5, windowMs: 1000, now: () => t, maxKeys: 100 });
    for (let i = 0; i < 500; i++) { L.hit('x' + i); }
    t = 5000;
    L.hit('fresh');
    assert.ok(L.size() <= 2, `size ${L.size()}`);
  });

  await test('ipKey: v4 whole, v4-mapped unwrapped, v6 cut to /64', () => {
    assert.strictEqual(ipKey({ ip: '203.0.113.9' }), 'ip:203.0.113.9');
    assert.strictEqual(ipKey({ ip: '::ffff:203.0.113.9' }), 'ip:203.0.113.9');
    assert.strictEqual(ipKey({ ip: '2001:db8:1:2:aaaa:bbbb:cccc:dddd' }), 'ip6:2001:db8:1:2::/64');
    assert.strictEqual(ipKey({ ip: '2001:db8:1:2::1' }), 'ip6:2001:db8:1:2::/64');
    assert.strictEqual(ipKey({ ip: '2001:db8::1' }), 'ip6:2001:db8:0:0::/64');
    assert.strictEqual(ipKey({ ip: '::1' }), 'ip6:0:0:0:0::/64');
  });

  await test('accountKey: case- and space-folded, non-strings ignored', () => {
    assert.strictEqual(accountKey('  Ham@Example.COM '), 'acct:ham@example.com');
    assert.strictEqual(accountKey(''), null);
    assert.strictEqual(accountKey({ $ne: 1 }), null);
  });

  await test('resolveTrustProxy: 1 hop on Render, off elsewhere, env overrides', () => {
    assert.strictEqual(resolveTrustProxy({}), false);
    assert.strictEqual(resolveTrustProxy({ RENDER: 'true' }), 1);
    assert.strictEqual(resolveTrustProxy({ RENDER: 'true', TRUST_PROXY: '2' }), 2);
    assert.strictEqual(resolveTrustProxy({ TRUST_PROXY: 'false', RENDER: 'true' }), false);
    assert.strictEqual(resolveTrustProxy({ TRUST_PROXY: 'loopback' }), 'loopback');
  });

  await test('describeProxyChain: suggests the hop count that lands req.ip on CF-Connecting-IP', () => {
    const req = {
      ip: '172.70.1.1',
      headers: { 'x-forwarded-for': '203.0.113.7, 172.70.1.1', 'cf-connecting-ip': '203.0.113.7' },
      app: { get: () => 1 },
    };
    const d = describeProxyChain(req);
    assert.strictEqual(d.xffEntries, 2);
    assert.strictEqual(d.reqIpIsXffEntry, 1);
    assert.strictEqual(d.cfConnectingIp, 'XFF[0]');
    assert.strictEqual(d.suggestedTrustProxy, 2);
  });
}

/* ── Part 2: integration ──────────────────────────────────────────────────── */

const PORT = Number(process.env.TEST_PORT || 3000 + 200 + Math.floor(Math.random() * 600));
if (PORT === 3001) throw new Error('refusing to test on 3001 — the pm2 server owns it');

function request(method, urlPath, { body, headers = {}, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port: PORT, method, path: urlPath,
      headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        if (!raw) { try { json = JSON.parse(buf.toString('utf8')); } catch (_) {} }
        resolve({ status: res.statusCode, headers: res.headers, buf, json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const fromIp = (ip) => ({ 'X-Forwarded-For': ip });

async function waitForHealth(child, ms = 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (child.exitCode != null) throw new Error(`server exited with ${child.exitCode}`);
    try { const r = await request('GET', '/health'); if (r.status === 200) return; } catch (_) {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('server did not come up');
}

async function integration() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-limit-test-'));
  const dbPath = path.join(tmp, 'fixture-copy.db');
  if (process.env.FIXTURE_DB) {
    const src = path.resolve(process.env.FIXTURE_DB);
    if (path.basename(src) === 'poker-tournaments.db' && path.dirname(src) === ROOT) {
      console.log('  (copying the live DB — the copy, never the original, is opened)');
    }
    fs.copyFileSync(src, dbPath);
  }

  const env = { ...process.env };
  for (const k of ['SYNC_TOKEN', 'DASHBOARD_TOKEN', 'TESTFLIGHT_WATCHDOG', 'RENDER_DEPLOY_WATCHDOG',
    'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'ANTHROPIC_API_KEY',
    'RENDER', 'TRUST_PROXY']) delete env[k];
  Object.assign(env, {
    JWT_SECRET: 'test-secret-not-for-prod',
    PORT: String(PORT),
    DB_PATH: dbPath,
    // One trusted hop: the test client plays both the proxy (socket peer) and,
    // through X-Forwarded-For, the many distinct clients behind it — exactly
    // Render's shape.
    TRUST_PROXY: '1',
    // The first account registered below plays the console owner (Basic Auth).
    CONSOLE_OWNER_USER_ID: '1',
  });

  const log = [];
  const child = spawn(process.execPath, ['-r', path.join(__dirname, 'stub-solver-preload.js'), 'server.js'], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => log.push(d.toString()));
  child.stderr.on('data', (d) => log.push(d.toString()));

  try {
    await waitForHealth(child);
    console.log(`\nserver.js on :${PORT}, DB ${dbPath}`);

    // Two accounts, registered from distinct IPs so register's own limit is not in play.
    const pw = 'correct horse battery';
    for (const [i, u] of [['consoleowner', 'consoleowner@example.test'], ['victim', 'victim@example.test'], ['owner', 'owner@example.test']].entries()) {
      const r = await request('POST', '/api/register', {
        body: { username: u[0], email: u[1], password: pw, realName: u[0] }, headers: fromIp(`192.0.2.${100 + i}`),
      });
      assert.strictEqual(r.status, 201, `register ${u[0]}: ${r.status} ${r.buf}`);
    }

    console.log('login limiter');

    await test('per account: 10 wrong passwords from 10 IPs, then even the 11th IP is refused (429)', async () => {
      for (let i = 1; i <= 10; i++) {
        const r = await request('POST', '/api/login', { body: { email: 'victim@example.test', password: 'nope' }, headers: fromIp(`10.0.0.${i}`) });
        assert.strictEqual(r.status, 401, `attempt ${i}: ${r.status}`);
      }
      const r = await request('POST', '/api/login', { body: { email: 'VICTIM@example.test', password: 'nope' }, headers: fromIp('10.0.0.11') });
      assert.strictEqual(r.status, 429);
      const ra = Number(r.headers['retry-after']);
      assert.ok(ra >= 1 && ra <= 900, `Retry-After ${r.headers['retry-after']}`);
      assert.strictEqual(r.json.retryAfter, ra);
    });

    await test('per account: the lockout also refuses the right password (no oracle while locked)', async () => {
      const r = await request('POST', '/api/login', { body: { email: 'victim@example.test', password: pw }, headers: fromIp('10.0.0.12') });
      assert.strictEqual(r.status, 429);
    });

    await test('per IP: 10 wrong passwords across 10 accounts from one IP, the 11th is refused', async () => {
      for (let i = 1; i <= 10; i++) {
        const r = await request('POST', '/api/login', { body: { email: `nobody${i}@example.test`, password: 'x' }, headers: fromIp('10.1.1.1') });
        assert.strictEqual(r.status, 401, `attempt ${i}: ${r.status}`);
      }
      const r = await request('POST', '/api/login', { body: { email: 'nobody11@example.test', password: 'x' }, headers: fromIp('10.1.1.1') });
      assert.strictEqual(r.status, 429);
      const other = await request('POST', '/api/login', { body: { email: 'nobody11@example.test', password: 'x' }, headers: fromIp('10.1.1.2') });
      assert.strictEqual(other.status, 401, 'a different IP is unaffected');
    });

    await test('a forged leftmost X-Forwarded-For does not mint a fresh IP (rightmost hop is used)', async () => {
      for (let i = 1; i <= 10; i++) {
        const r = await request('POST', '/api/login', { body: { email: `spoof${i}@example.test`, password: 'x' }, headers: fromIp(`198.51.100.${i}, 10.4.4.4`) });
        assert.strictEqual(r.status, 401);
      }
      const r = await request('POST', '/api/login', { body: { email: 'spoof11@example.test', password: 'x' }, headers: fromIp('198.51.100.99, 10.4.4.4') });
      assert.strictEqual(r.status, 429);
    });

    await test('successful logins do not accumulate (15 in a row from one IP)', async () => {
      for (let i = 1; i <= 15; i++) {
        const r = await request('POST', '/api/login', { body: { email: 'owner@example.test', password: pw }, headers: fromIp('10.3.3.3') });
        assert.strictEqual(r.status, 200, `login ${i}: ${r.status}`);
      }
    });

    await test('a correct password clears the account window; the IP keeps its failures', async () => {
      for (let i = 1; i <= 9; i++) {
        const r = await request('POST', '/api/login', { body: { email: 'owner@example.test', password: 'bad' }, headers: fromIp('10.2.2.2') });
        assert.strictEqual(r.status, 401);
      }
      const ok = await request('POST', '/api/login', { body: { email: 'owner@example.test', password: pw }, headers: fromIp('10.2.2.2') });
      assert.strictEqual(ok.status, 200);
      // IP 10.2.2.2 has 9 failures: one more, then refused.
      assert.strictEqual((await request('POST', '/api/login', { body: { email: 'z@example.test', password: 'bad' }, headers: fromIp('10.2.2.2') })).status, 401);
      assert.strictEqual((await request('POST', '/api/login', { body: { email: 'z@example.test', password: 'bad' }, headers: fromIp('10.2.2.2') })).status, 429);
      // The account was cleared, so a fresh IP gets the full 10 against it.
      for (let i = 1; i <= 10; i++) {
        const r = await request('POST', '/api/login', { body: { email: 'owner@example.test', password: 'bad' }, headers: fromIp(`10.5.5.${i}`) });
        assert.strictEqual(r.status, 401, `post-clear attempt ${i}: ${r.status}`);
      }
      assert.strictEqual((await request('POST', '/api/login', { body: { email: 'owner@example.test', password: 'bad' }, headers: fromIp('10.5.5.11') })).status, 429);
    });

    await test('a parallel burst cannot outrun the limiter (attempts are taken before bcrypt)', async () => {
      const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => request('POST', '/api/login', {
        body: { email: `burst${i}@example.test`, password: 'x' }, headers: fromIp('10.6.6.6'),
      })));
      const codes = rs.map((r) => r.status);
      assert.strictEqual(codes.filter((c) => c === 401).length, 10, codes.join(','));
      assert.strictEqual(codes.filter((c) => c === 429).length, 20, codes.join(','));
    });

    console.log('console owner Basic Auth');

    const basic = (user, pass) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    const CONSOLE = '/console/api/backers/testtoken123/events';
    const ownerLogin = await request('POST', '/api/login', { body: { email: 'consoleowner@example.test', password: pw }, headers: fromIp('10.20.0.1') });
    const ownerIsId1 = ownerLogin.status === 200 && ownerLogin.json.userId === 1;
    const cookie = String((ownerLogin.headers['set-cookie'] || [])[0] || '').split(';')[0];

    await test('Basic: correct password repeatedly is never limited; no credentials is not counted', async () => {
      assert.ok(ownerIsId1, 'fixture: consoleowner must be user 1');
      for (let i = 1; i <= 15; i++) {
        const r = await request('GET', CONSOLE, { headers: { ...fromIp('10.20.0.2'), Authorization: basic('consoleowner', pw) } });
        assert.strictEqual(r.status, 200, `request ${i}: ${r.status}`);
      }
      for (let i = 1; i <= 12; i++) {
        const r = await request('GET', CONSOLE, { headers: fromIp('10.20.0.3') });
        assert.strictEqual(r.status, 401);
      }
    });

    await test('Basic: 10 wrong owner passwords across IPs, then 429 with Retry-After — even for the right one', async () => {
      for (let i = 1; i <= 10; i++) {
        const r = await request('GET', CONSOLE, { headers: { ...fromIp(`10.21.0.${i}`), Authorization: basic('consoleowner', 'guess' + i) } });
        assert.strictEqual(r.status, 401, `guess ${i}: ${r.status}`);
      }
      const r = await request('GET', CONSOLE, { headers: { ...fromIp('10.21.0.11'), Authorization: basic('consoleowner', pw) } });
      assert.strictEqual(r.status, 429);
      assert.ok(Number(r.headers['retry-after']) >= 1);
    });

    await test('Basic lockout does not touch a signed-in owner (session cookie path)', async () => {
      assert.ok(cookie.includes('='), `cookie: ${cookie}`);
      const r = await request('GET', CONSOLE, { headers: { ...fromIp('10.21.0.12'), Cookie: cookie } });
      assert.strictEqual(r.status, 200);
    });

    console.log('register / forgot-password limiters');

    await test('register: 10 per IP per window, then 429', async () => {
      const codes = [];
      for (let i = 1; i <= 11; i++) {
        const r = await request('POST', '/api/register', { body: { username: `bulk${i}`, email: `bulk${i}@example.test`, password: pw, realName: 'B' }, headers: fromIp('10.7.7.7') });
        codes.push(r.status);
      }
      assert.deepStrictEqual(codes, [...Array(10).fill(201), 429]);
    });

    await test('forgot-password: 10 per target email across IPs, then 429', async () => {
      const codes = [];
      for (let i = 1; i <= 11; i++) {
        const r = await request('POST', '/api/forgot-password', { body: { email: 'victim@example.test' }, headers: fromIp(`10.8.8.${i}`) });
        codes.push(r.status);
      }
      assert.deepStrictEqual(codes, [...Array(10).fill(200), 429]);
    });

    console.log('compression');

    const login = await request('POST', '/api/login', { body: { email: 'bulk1@example.test', password: pw }, headers: fromIp('10.9.9.9') });
    assert.strictEqual(login.status, 200, `login for token: ${login.status}`);
    const token = login.json.token;
    const auth = { Authorization: `Bearer ${token}` };

    // An explicit window, because the default is "upcoming only" and the seeded
    // sample schedule (WSOP 2026) is in the past.
    const TOURN = '/api/tournaments?startDate=2000-01-01';
    await test('/api/tournaments: gzip when asked, identical JSON, smaller on the wire', async () => {
      const plain = await request('GET', TOURN, { headers: { ...auth, 'Accept-Encoding': 'identity' }, raw: true });
      const gz = await request('GET', TOURN, { headers: { ...auth, 'Accept-Encoding': 'gzip' }, raw: true });
      assert.strictEqual(plain.status, 200, `identity status ${plain.status}`);
      assert.strictEqual(plain.headers['content-encoding'], undefined, `identity encoding ${plain.headers['content-encoding']}`);
      assert.strictEqual(gz.headers['content-encoding'], 'gzip', `gzip request got ${gz.status} ${JSON.stringify(gz.headers)}`);
      assert.ok(String(gz.headers.vary || '').toLowerCase().includes('accept-encoding'), 'Vary: Accept-Encoding');
      const inflated = zlib.gunzipSync(gz.buf);
      assert.ok(inflated.equals(plain.buf), 'decompressed body equals the identity body');
      const rows = JSON.parse(plain.buf.toString('utf8'));
      const pct = (100 * (1 - gz.buf.length / plain.buf.length)).toFixed(1);
      console.log(`       ${Array.isArray(rows) ? rows.length : '?'} rows: ${plain.buf.length} B identity -> ${gz.buf.length} B gzip (-${pct}%)`);
      const br = await request('GET', TOURN, { headers: { ...auth, 'Accept-Encoding': 'br' }, raw: true });
      if (br.headers['content-encoding'] === 'br') {
        console.log(`       brotli: ${br.buf.length} B (-${(100 * (1 - br.buf.length / plain.buf.length)).toFixed(1)}%)`);
      }
    });

    console.log('server-sent events under compression');

    await test('/api/events is NOT compressed and an event arrives promptly', async () => {
      const result = await new Promise((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1', port: PORT, method: 'GET',
          path: `/api/events?token=${encodeURIComponent(token)}`,
          headers: { 'Accept-Encoding': 'gzip, deflate, br', Accept: 'text/event-stream' },
        }, (res) => {
          let text = '';
          const t0 = Date.now();
          const timer = setTimeout(() => { req.destroy(); resolve({ res, text, timedOut: true }); }, 5000);
          res.on('data', (c) => {
            text += c.toString('utf8');
            if (text.includes('event: tournament-changed')) {
              clearTimeout(timer);
              req.destroy();
              resolve({ res, text, ms: Date.now() - t0 });
            }
          });
          // Headers are flushed immediately; fire a broadcast once we're subscribed.
          setTimeout(() => {
            request('PUT', '/api/tournaments/1/total-entries', { body: { totalEntries: 1234 }, headers: auth })
              .then((r) => { if (r.status !== 200) reject(new Error(`trigger ${r.status} ${r.buf}`)); }, reject);
          }, 200);
        });
        req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
        req.end();
      });
      assert.ok(String(result.res.headers['content-type']).startsWith('text/event-stream'));
      assert.strictEqual(result.res.headers['content-encoding'], undefined, 'SSE must not be compressed');
      assert.ok(!result.timedOut, `no event within 5 s; got ${JSON.stringify(result.text)}`);
      assert.ok(result.text.includes('"total_entries":1234'), result.text);
      console.log(`       event delivered ${result.ms} ms after subscribing (includes the 200 ms trigger delay)`);
    });
  } finally {
    child.kill();
    await new Promise((r) => child.once('exit', r));
    const chain = log.join('').split('\n').find((l) => l.includes('proxy chain'));
    if (chain) console.log('\n' + chain.trim());
    if (failed) console.log('\n--- server log (tail) ---\n' + log.join('').split('\n').slice(-40).join('\n'));
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
}

/* ── Control: what the SSE exclusion prevents ─────────────────────────────── */

async function control() {
  console.log('control: SSE behind compression() WITHOUT the exclusion');
  const express = require(path.join(ROOT, 'node_modules', 'express'));
  const compression = require(path.join(ROOT, 'node_modules', 'compression'));
  const app = express();
  app.use(compression());
  app.get('/sse', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.flushHeaders();
    setTimeout(() => res.write('event: ping\ndata: {}\n\n'), 50);
  });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  await test('default compression gzips the stream and the event never arrives (would be a bug)', async () => {
    const got = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: srv.address().port, path: '/sse', headers: { 'Accept-Encoding': 'gzip' } }, (res) => {
        // Only the 10-byte gzip header gets out; decode whatever arrives.
        let text = '';
        const gunzip = zlib.createGunzip();
        gunzip.on('data', (c) => { text += c.toString('utf8'); });
        gunzip.on('error', () => {});
        res.pipe(gunzip);
        setTimeout(() => { req.destroy(); resolve({ enc: res.headers['content-encoding'], text }); }, 1500);
      });
      req.on('error', () => {});
    });
    assert.strictEqual(got.enc, 'gzip');
    assert.ok(!got.text.includes('event: ping'), 'the event is stuck in the gzip buffer');
  });
  srv.close();
}

(async () => {
  await unit();
  await control();
  await integration();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
