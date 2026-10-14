'use strict';
/*
 * Shared plumbing for the backer-surface tests (test/backer-surface.test.js,
 * test/backer-rotation.test.js, test/backer-parity.test.js) and the staking settlement test
 * (test/staking-settlement.test.js): boot server.js on a SCRATCH port (4540-4549 by default; a
 * suite can ask for its own range, e.g. 4570-4579, so two suites can run at once; never 3001)
 * against a SCRATCH database in a temp dir (never poker-tournaments.db or any copy of it), with
 * every production secret scrubbed from the environment, and ./solver stubbed
 * (test/stub-solver-preload.js).
 *
 * Scrubbed on purpose: SYNC_TOKEN, DASHBOARD_TOKEN, ROSTER_TOKEN(_PREVIOUS), TESTFLIGHT_WATCHDOG,
 * RENDER, TRUST_PROXY, ANTHROPIC_API_KEY, the mail, push and Twilio settings, and the two backer
 * switches (BACKER_DELIVERY, BACKER_PAGE_SOURCE) unless a test passes them in `extra`.
 */
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const initSqlJs = require('sql.js');

const ROOT = path.join(__dirname, '..', '..');
const PORTS = [4540, 4549];

async function freePort(range = PORTS) {
  for (let p = range[0]; p <= range[1]; p++) {
    const ok = await new Promise((res) => {
      const s = net.createServer();
      s.once('error', () => res(false));
      s.listen(p, '127.0.0.1', () => s.close(() => res(true)));
    });
    if (ok) return p;
  }
  throw new Error(`no free port in ${range[0]}-${range[1]}`);
}

function scrubbedEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['SYNC_TOKEN', 'DASHBOARD_TOKEN', 'DASHBOARD_TOKEN_PREVIOUS', 'ROSTER_TOKEN', 'ROSTER_TOKEN_PREVIOUS', 'TESTFLIGHT_WATCHDOG',
    'TESTFLIGHT_NIGHTLY', 'RENDER_DEPLOY_WATCHDOG', 'RENDER', 'TRUST_PROXY', 'ANTHROPIC_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'BACKER_DELIVERY', 'BACKER_PAGE_SOURCE', 'DASHBOARD_BASE_URL', 'CONSOLE_OWNER_USER_ID',
    'IS_PRODUCTION', 'SOLVER_URL', 'CASHWATCHER_URL']) delete env[k];
  for (const k of Object.keys(env)) if (/^(TWILIO_|APNS_)/.test(k)) delete env[k];
  return { ...env, JWT_SECRET: 'backer-surface-test-secret-not-for-prod', DISABLE_FEED_INGEST: '1', ...extra };
}

/** Boots server.js on a free scratch port. opts.ports = [lo, hi]. -> { port, child, log(), stop() } */
async function boot(dbPath, extraEnv = {}, opts = {}) {
  if (/poker-tournaments\.db$/i.test(path.basename(dbPath))) throw new Error('refusing the live database');
  const port = await freePort(opts.ports || PORTS);
  if (port === 3001) throw new Error('refusing port 3001');
  const env = scrubbedEnv({ ...extraEnv, PORT: String(port), DB_PATH: dbPath });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-r', path.join(__dirname, '..', 'stub-solver-preload.js'), 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('server did not start in 90s\n' + log.slice(-3000))); }, 90000);
    const onData = (b) => {
      log += b.toString();
      if (log.includes(`Server running on port ${port}`)) {
        clearTimeout(timer);
        resolve({
          port, child, log: () => log,
          stop: () => new Promise((r) => {
            // A child killed by a signal keeps exitCode null, so test signalCode too; and stopping
            // twice must not wait for an 'exit' that has already happened.
            if (child.exitCode != null || child.signalCode != null) return r();
            child.removeAllListeners('exit');
            child.on('exit', () => r());
            child.kill();
          }),
        });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}) before listening\n` + log.slice(-3000))); });
  });
}

/** Waits until the server's log matches `re` (the line after "Server running" can arrive a tick later). */
async function waitLog(srv, re, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (re.test(srv.log())) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`the server log never matched ${re}
` + srv.log().slice(-1500));
}

let SQL;
async function sqlJs() { SQL = SQL || await initSqlJs(); return SQL; }

/**
 * A scratch directory with a database whose schema is the REAL one (server.js booted on it once,
 * so every dataMigration has run). Tests open it with open(), write with save(db), and boot again
 * with boot(dbPath, env). cleanup() removes the directory.
 */
async function createScratch(opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), opts.prefix || 'fg-backer-surface-'));
  const dbPath = path.join(tmp, 'scratch.db');
  const srv = await boot(dbPath, opts.env || {}, opts);
  const bootLog = srv.log();
  await srv.stop();
  const S = await sqlJs();
  return {
    tmp, dbPath, bootLog,
    open: () => new S.Database(fs.readFileSync(dbPath)),
    save: (db) => fs.writeFileSync(dbPath, Buffer.from(db.export())),
    cleanup: () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* best effort */ } },
  };
}

const rowsOf = (db, sql, args = []) => {
  const r = db.exec(sql, args);
  if (!r.length) return [];
  return r[0].values.map((v) => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]])));
};
const one = (db, sql, args = []) => { const r = db.exec(sql, args); return r.length && r[0].values.length ? r[0].values[0][0] : null; };

/** A tiny test runner: prints ok/FAIL, counts, and reports at the end. */
function runner(label) {
  let passed = 0, failed = 0;
  return {
    async test(name, fn) {
      try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (err) {
        failed++;
        console.log(`  FAIL ${name}\n       ${(err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n       ') : err)}`);
      }
    },
    done() {
      // Flush before exiting: a piped stdout can still hold the summary when process.exit lands.
      process.stdout.write(`\n${label} - ${passed} passed, ${failed} failed\n`, () => process.exit(failed ? 1 : 0));
    },
    get failed() { return failed; },
  };
}

module.exports = { ROOT, freePort, scrubbedEnv, boot, waitLog, sqlJs, createScratch, rowsOf, one, runner };
