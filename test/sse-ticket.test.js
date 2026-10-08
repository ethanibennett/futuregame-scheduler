// SSE tickets: the /api/events stream is opened with a short-lived, single-use
// ticket from POST /api/events/ticket instead of the user's JWT in the URL.
//
// Boots the real server.js in a child process on a SCRATCH port, against a scratch
// DB in a temp dir (a copy of FIXTURE_DB if you pass one, otherwise a fresh DB the
// server creates) — never port 3001, never poker-tournaments.db. The child gets a
// minimal env (no SYNC_TOKEN / DASHBOARD_TOKEN / watchdogs), so nothing it does at
// boot reaches production. ./solver is a gitignored junction that may be absent, so
// the child stubs every ./solver require via a Module._load override.
//
//   node test/sse-ticket.test.js
//   FIXTURE_DB=path/to/fixture.db node test/sse-ticket.test.js
'use strict';
const path = require('path');

// ── Child mode: stub ./solver, then run the server ───────────────────────────
if (process.env.SSE_TICKET_TEST_CHILD === '1') {
  const Module = require('module');
  const solverDir = path.join(__dirname, '..', 'solver') + path.sep;
  // A callable proxy that answers every property and call with itself, so top-level
  // code like `makeRng(seed)` or `GAMES['razz']` evaluates without the real solver.
  const stub = new Proxy(function solverStub() {}, {
    get: (t, k) => (k === Symbol.toPrimitive || k === 'then' ? undefined : stub),
    apply: () => stub,
    construct: () => stub,
  });
  const realLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename) {
      const resolved = path.resolve(path.dirname(parent.filename), request);
      if (request.startsWith('.') && (resolved + path.sep).startsWith(solverDir)) return stub;
    }
    return realLoad.apply(this, arguments);
  };
  require('../server.js');
  return;
}

// ── Parent mode: the test ────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'sse-ticket-test-secret';
const TTL_MS = 2000; // server clamps SSE_TICKET_TTL_MS to [1 s, 60 s]

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

function request(port, method, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

// Open the stream, resolve with the status + content-type + first bytes, then hang up.
function openStream(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
        return;
      }
      // flushHeaders() sends headers with no body; nudge a byte out by waiting
      // briefly, and accept headers alone if the heartbeat hasn't fired yet.
      const timer = setTimeout(() => { req.destroy(); resolve({ status: 200, type: res.headers['content-type'], first: '' }); }, 500);
      res.once('data', (c) => {
        clearTimeout(timer);
        req.destroy();
        resolve({ status: 200, type: res.headers['content-type'], first: c.toString() });
      });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
  });
}

async function getTicket(port, token) {
  const r = await request(port, 'POST', '/api/events/ticket', { Authorization: `Bearer ${token}` });
  assert.strictEqual(r.status, 200, `ticket request: ${r.status} ${r.body}`);
  const { ticket } = JSON.parse(r.body);
  assert.match(ticket, /^[A-Za-z0-9_-]{43}$/, '32-byte base64url ticket');
  return ticket;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const port = await freePort();
  assert.notStrictEqual(port, 3001);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sse-ticket-'));
  const dbPath = path.join(tmp, 'scratch.db');
  if (process.env.FIXTURE_DB) {
    assert.ok(!/poker-tournaments\.db$/i.test(process.env.FIXTURE_DB), 'refusing the live DB');
    fs.copyFileSync(process.env.FIXTURE_DB, dbPath);
  }

  // Minimal env: only what the OS and node need, plus the test's own settings.
  const env = { SSE_TICKET_TEST_CHILD: '1', JWT_SECRET, PORT: String(port), DB_PATH: dbPath, SSE_TICKET_TTL_MS: String(TTL_MS), NODE_ENV: 'test' };
  for (const k of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
    if (process.env[k]) env[k] = process.env[k];
  }
  const child = spawn(process.execPath, [__filename], { cwd: tmp, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (c) => { log += c; });
  child.stderr.on('data', (c) => { log += c; });

  let passed = 0;
  const ok = (label) => { passed++; console.log(`  ok  ${label}`); };
  try {
    // Wait for the server to listen.
    const deadline = Date.now() + 30000;
    while (!/Server running on port/.test(log)) {
      if (child.exitCode !== null) throw new Error(`server exited early:\n${log}`);
      if (Date.now() > deadline) throw new Error(`server did not start:\n${log}`);
      await sleep(100);
    }
    console.log(`server up on scratch port ${port}, DB ${dbPath}`);

    // A real account: authenticateToken refuses a signed token whose user no longer
    // exists (account deletion), so the test registers and logs in through the API.
    const postJson = (p, body) => new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: p, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
        let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
      });
      r.on('error', reject); r.end(data);
    });
    const reg = await postJson('/api/register', { username: 'ssetester', email: 'sse-tester@x.test', password: 'sse-tester-pw-1', realName: 'Sse Tester' });
    assert.strictEqual(reg.status, 201, 'register: ' + reg.body);
    const login = await postJson('/api/login', { email: 'sse-tester@x.test', password: 'sse-tester-pw-1' });
    assert.strictEqual(login.status, 200, 'login: ' + login.body);
    const token = JSON.parse(login.body).token;
    assert.ok(token, 'login returned a token');

    // No auth → no ticket.
    assert.strictEqual((await request(port, 'POST', '/api/events/ticket')).status, 401);
    ok('ticket endpoint requires Authorization');

    // Ticket → stream.
    const t1 = await getTicket(port, token);
    ok('POST /api/events/ticket returns a 32-byte base64url ticket');
    const s1 = await openStream(port, `/api/events?ticket=${t1}`);
    assert.strictEqual(s1.status, 200);
    assert.match(s1.type || '', /text\/event-stream/);
    ok(`stream opens with the ticket (200, ${s1.type})`);

    // Same ticket again → rejected.
    const s2 = await openStream(port, `/api/events?ticket=${t1}`);
    assert.ok(s2.status === 401 || s2.status === 403, `reuse gave ${s2.status}`);
    ok(`a spent ticket is rejected (${s2.status})`);

    // Unknown ticket, and no credential at all → rejected.
    assert.strictEqual((await openStream(port, '/api/events?ticket=nope')).status, 401);
    assert.strictEqual((await openStream(port, '/api/events')).status, 401);
    ok('unknown ticket and missing credential are rejected (401)');

    // Expired ticket → rejected.
    const t3 = await getTicket(port, token);
    await sleep(TTL_MS + 500);
    const s3 = await openStream(port, `/api/events?ticket=${t3}`);
    assert.ok(s3.status === 401 || s3.status === 403, `expired gave ${s3.status}`);
    ok(`an expired ticket is rejected (${s3.status})`);

    // Identity carried by the ticket reaches the broadcast map: a guest JWT also works.
    const guest = jwt.sign({ id: 0, username: 'Guest', isGuest: true }, JWT_SECRET, { expiresIn: '5m' });
    const sg = await openStream(port, `/api/events?ticket=${await getTicket(port, guest)}`);
    assert.strictEqual(sg.status, 200);
    ok('guest sessions get tickets too (same as the JWT path allowed)');

    // Deprecated ?token= path still works for installed builds that predate tickets.
    const s4 = await openStream(port, `/api/events?token=${token}`);
    assert.strictEqual(s4.status, 200);
    assert.strictEqual((await openStream(port, '/api/events?token=garbage')).status, 401);
    ok('legacy ?token= still accepted (deprecated), bad token rejected');

    // Our own code must not have echoed a credential into the log.
    assert.ok(!log.includes(token), 'JWT appeared in server output');
    assert.ok(!log.includes(t1) && !log.includes(t3), 'ticket appeared in server output');
    ok('no JWT or ticket in server output');

    console.log(`\n${passed} checks passed`);
  } catch (err) {
    console.error(err);
    console.error('--- server output ---\n' + log);
    process.exitCode = 1;
  } finally {
    child.kill();
    await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
