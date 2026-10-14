// Phase 1 of the bankroll merge (docs/bankroll-merge.md §4, §4.3, §5.3, §5.4): the
// 'money-merge-2026-10' migration and the constants that ride with it, against the real server
// and a real SQLite file.
//
//   node test/money-merge.test.js        (or: npm run test:money-merge)
//
// Boots server.js on a scratch port (4480-4489, never 3001) with a scratch DB in a temp dir, never
// poker-tournaments.db, with JWT_SECRET set and SYNC_TOKEN, DASHBOARD_TOKEN, TESTFLIGHT_WATCHDOG,
// RENDER, TRUST_PROXY and ANTHROPIC_API_KEY unset, and ./solver stubbed.
//
// The migration is the risky part, so it is tested the way it will be run:
//   P0  boot a fresh DB (the migration runs on a fresh schema) and register one account;
//   P1  turn that DB into a LIVE-LIKE one: seed rows the way today's code writes them, then remove
//       the migration (drop its tables, columns and indexes, forget it ran) and snapshot every
//       table that holds user data;
//   P2  boot (the migration runs on a populated database): every pre-existing column of every
//       row is byte-identical, the new columns hold their defaults, the dashboard's backer events
//       are marked delivered, the new tables are empty, and the ledger's numbers did not move;
//   P3  add rows that use the new columns and kinds, boot again (idempotent: nothing rewritten)
//       and check what the ledger, the Expenses list and the reports do with them;
//   plus in-process: the migration is all-or-nothing, and a second run changes nothing.
'use strict';
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const initSqlJs = require('sql.js');
const moneyMerge = require('../lib/money-merge');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-money-merge-'));
const DB_PATH = path.join(TMP, 'scratch.db');
assert.notStrictEqual(path.basename(DB_PATH), 'poker-tournaments.db');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (err) {
    console.log(`  FAIL ${name}\n       ${err && err.stack || err}`);
    console.log(`(scratch dir kept for inspection: ${TMP})`);
    process.exit(1);
  }
}

// ── the spec, written out again here (§4.1, §4.2) so the module is checked against the document ──
const EXPECT_TABLES = {
  standing_agreements: ['id', 'user_id', 'backer_id', 'effective_from', 'effective_to', 'status', 'opening_cents', 'opening_note', 'created_at', 'updated_at'],
  standing_stakes: ['id', 'agreement_id', 'format', 'channel', 'pct', 'valid_from', 'valid_to', 'created_at'],
  standing_exclusions: ['agreement_id', 'ref_table', 'ref_id', 'created_at'],
  session_extras: ['user_id', 'ref_table', 'ref_id', 'format', 'channel', 'hours', 'hands', 'mood_rating', 'tilt_note', 'journal', 'tags', 'origin', 'origin_id', 'updated_at'],
  backer_event_revisions: ['id', 'event_id', 'token', 'at', 'action', 'share_before', 'share_after', 'result_before', 'result_after', 'pct_before', 'pct_after', 'cause', 'note'],
  money_locations: ['id', 'user_id', 'name', 'amount', 'currency', 'sort_order', 'updated_at'],
  money_settings: ['user_id', 'data', 'updated_at'],
  money_import_runs: ['id', 'user_id', 'source', 'fetched_at', 'payload', 'plan', 'decisions', 'status', 'committed_at', 'summary'],
};
// table -> [column, declared type, notnull, default]
const EXPECT_COLUMNS = {
  backers: [['public_token', 'TEXT', 0, null], ['notify_sms', 'INTEGER', 1, '0'], ['notify_email', 'INTEGER', 1, '0']],
  backer_events: [['agreement_id', 'INTEGER', 0, null], ['stake_id', 'INTEGER', 0, null], ['ref_table', 'TEXT', 0, null], ['ref_id', 'INTEGER', 0, null],
    ['source', 'TEXT', 1, "'dashboard'"], ['revised_at', 'INTEGER', 0, null], ['notified_share_cents', 'INTEGER', 0, null], ['notified_at', 'INTEGER', 0, null]],
  bankroll_import_keys: [['run_id', 'INTEGER', 0, null], ['decision', 'TEXT', 0, null], ['source_updated_at', 'INTEGER', 0, null], ['source_hash', 'TEXT', 0, null]],
  bankrolls: [['role', 'TEXT', 0, null], ['in_roll', 'INTEGER', 1, '1'], ['target_amount', 'INTEGER', 0, null], ['target_date', 'TEXT', 0, null]],
  bankroll_adjustments: [['settlement_ref', 'TEXT', 0, null]],
  bankroll_transactions: [['affects_balance', 'INTEGER', 1, '1']],
  cash_sessions: [['time_known', 'INTEGER', 1, '1']],
  staking_series: [['bankroll_id', 'INTEGER', 0, null]],
  backer_settlements: [['agreement_id', 'INTEGER', 0, null], ['computed_owed', 'REAL', 0, null], ['adjustment', 'REAL', 1, '0'], ['adjustment_note', 'TEXT', 0, null],
    ['prepaid', 'REAL', 1, '0'], ['makeup_opening', 'REAL', 0, null], ['makeup_closing', 'REAL', 0, null], ['settled_at', 'TEXT', 0, null]],
  backer_agreements: [['makeup_opening', 'REAL', 0, null]],
};
const EXPECT_INDEXES = ['idx_standing_active', 'idx_session_extras_user', 'idx_ber_token', 'idx_backers_public_token', 'idx_backer_events_ref'];
// Tables that hold user data: snapshotted before and after.
const DATA_TABLES = ['users', 'backers', 'backer_events', 'backer_public', 'backer_push_subs', 'backer_agreements', 'backer_settlements',
  'backer_event_status', 'backer_event_overrides', 'backer_tokens', 'staking_series', 'bankrolls', 'bankroll_adjustments', 'bankroll_transactions',
  'bankroll_trips', 'bankroll_import_keys', 'bankroll_prefs', 'cash_sessions', 'cash_session_stacks', 'tracking_entries', 'console_records'];

// ── plumbing ──
async function freePort() {
  for (let p = 4480; p <= 4489; p++) {
    const ok = await new Promise((res) => {
      const s = net.createServer();
      s.once('error', () => res(false));
      s.listen(p, '127.0.0.1', () => s.close(() => res(true)));
    });
    if (ok) return p;
  }
  throw new Error('no free port in 4480-4489');
}
let PORT = 0;
const env = { ...process.env };
for (const k of ['SYNC_TOKEN', 'DASHBOARD_TOKEN', 'TESTFLIGHT_WATCHDOG', 'RENDER_DEPLOY_WATCHDOG', 'RENDER', 'TRUST_PROXY', 'ANTHROPIC_API_KEY',
  'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']) delete env[k];
for (const k of Object.keys(env)) if (/^(DASHBOARD_|TWILIO_|APNS_|CONSOLE_OWNER_USER_ID|IS_PRODUCTION|SOLVER_URL|CASHWATCHER_URL)/.test(k)) delete env[k];

function boot() {
  return new Promise((resolve, reject) => {
    const e = { ...env, PORT: String(PORT), DB_PATH, JWT_SECRET: 'money-merge-test-secret', DISABLE_FEED_INGEST: '1' };
    const child = spawn(process.execPath, ['-r', path.join(__dirname, 'stub-solver-preload.js'), 'server.js'], { cwd: ROOT, env: e, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('server did not start in 90s\n' + log.slice(-3000))); }, 90000);
    const onData = (b) => {
      log += b.toString();
      if (log.includes(`Server running on port ${PORT}`)) { clearTimeout(timer); resolve({ child, log: () => log }); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}) before listening\n` + log.slice(-3000))); });
  });
}
function stop(srv) {
  return new Promise((resolve) => {
    srv.child.removeAllListeners('exit');
    srv.child.on('exit', () => resolve());
    srv.child.kill();
  });
}
async function api(method, p, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`http://127.0.0.1:${PORT}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch (_) { /* empty */ }
  return { status: res.status, data };
}

let SQL;
async function openDb() { SQL = SQL || await initSqlJs(); return new SQL.Database(fs.readFileSync(DB_PATH)); }
function saveDb(db) { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); }
const rowsOf = (db, sql, args = []) => {
  const r = db.exec(sql, args);
  if (!r.length) return [];
  return r[0].values.map((v) => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]])));
};
const one = (db, sql, args = []) => { const r = db.exec(sql, args); return r.length && r[0].values.length ? r[0].values[0][0] : null; };
const colInfo = (db, t) => rowsOf(db, `PRAGMA table_info(${t})`);
const tableNames = (db) => rowsOf(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
const indexNames = (db) => rowsOf(db, "SELECT name FROM sqlite_master WHERE type = 'index'").map((r) => r.name);
const applied = (db) => rowsOf(db, 'SELECT name FROM _applied_migrations ORDER BY rowid').map((r) => r.name);

// Every row of a table, restricted to `cols`, in rowid order.
function snapshot(db, tables, colsOf) {
  const out = {};
  for (const t of tables) {
    if (!tableNames(db).includes(t)) continue;
    const cols = colsOf ? colsOf[t] : colInfo(db, t).map((c) => c.name);
    out[t] = rowsOf(db, `SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM ${t} ORDER BY rowid`);
  }
  return out;
}

// Removes everything 'money-merge-2026-10' adds, leaving the schema as it was the day before. Phase 3's
// 'staking-settlement-2026-10' runs after it and indexes two of its columns, so that goes first (the
// day before Phase 1 had neither; at the next boot both run, in order).
function unmigrate(db) {
  db.run('DROP INDEX IF EXISTS idx_backer_settlements_agreement');
  db.run('DROP INDEX IF EXISTS idx_bankroll_adj_settlement_ref');
  if (colInfo(db, 'backer_settlements').some((c) => c.name === 'snapshot')) db.run('ALTER TABLE backer_settlements DROP COLUMN snapshot');
  db.run("DELETE FROM _applied_migrations WHERE name = 'staking-settlement-2026-10'");
  for (const t of Object.keys(EXPECT_TABLES)) db.run(`DROP TABLE IF EXISTS ${t}`);
  for (const i of EXPECT_INDEXES) db.run(`DROP INDEX IF EXISTS ${i}`);
  for (const [t, cols] of Object.entries(EXPECT_COLUMNS)) for (const c of cols) db.run(`ALTER TABLE ${t} DROP COLUMN ${c[0]}`);
  db.run("DELETE FROM _applied_migrations WHERE name = 'money-merge-2026-10'");
}

(async () => {
  PORT = await freePort();
  assert.notStrictEqual(PORT, 3001);

  // ───────────── P0: a fresh database gets the whole schema ─────────────
  let srv = await boot();
  let token;
  try {
    const reg = await api('POST', '/api/register', { body: { username: 'alicex', email: 'alicex@example.test', password: 'money-merge-pw-1', realName: 'Alice' } });
    assert.strictEqual(reg.status, 201, JSON.stringify(reg.data));
  } finally { await stop(srv); }

  await test('P0 fresh database: the migration is recorded, after bankroll-transactions-2026-10', async () => {
    const db = await openDb();
    const names = applied(db);
    assert.ok(names.includes('money-merge-2026-10'));
    assert.ok(names.indexOf('money-merge-2026-10') > names.indexOf('bankroll-transactions-2026-10'));
    assert.strictEqual(names.filter((n) => n === 'money-merge-2026-10').length, 1);
    assert.strictEqual(moneyMerge.MIGRATION_NAME, 'money-merge-2026-10');
    db.close();
  });

  await test('P0 §4.1: every new table exists with exactly the spec\'s columns', async () => {
    const db = await openDb();
    for (const [t, cols] of Object.entries(EXPECT_TABLES)) {
      assert.deepStrictEqual(colInfo(db, t).map((c) => c.name), cols, t);
    }
    assert.deepStrictEqual(moneyMerge.NEW_TABLES.slice().sort(), Object.keys(EXPECT_TABLES).sort(), 'the module creates the same set');
    db.close();
  });

  await test('P0 §4.1: keys, defaults and NOT NULLs of the new tables', async () => {
    const db = await openDb();
    const info = (t, c) => colInfo(db, t).find((x) => x.name === c);
    assert.deepStrictEqual(colInfo(db, 'standing_agreements').filter((c) => c.pk).map((c) => c.name), ['id']);
    assert.deepStrictEqual(colInfo(db, 'standing_exclusions').filter((c) => c.pk).map((c) => c.name).sort(), ['agreement_id', 'ref_id', 'ref_table']);
    assert.deepStrictEqual(colInfo(db, 'session_extras').filter((c) => c.pk).map((c) => c.name).sort(), ['ref_id', 'ref_table']);
    assert.deepStrictEqual(colInfo(db, 'money_settings').filter((c) => c.pk).map((c) => c.name), ['user_id']);
    assert.strictEqual(info('standing_agreements', 'status').dflt_value, "'active'");
    assert.strictEqual(info('standing_agreements', 'opening_cents').dflt_value, '0');
    assert.strictEqual(info('standing_agreements', 'effective_from').notnull, 1);
    assert.strictEqual(info('standing_agreements', 'effective_to').notnull, 0);
    assert.strictEqual(info('standing_stakes', 'pct').notnull, 1);
    assert.strictEqual(info('money_locations', 'currency').dflt_value, "'USD'");
    assert.strictEqual(info('money_locations', 'amount').dflt_value, '0');
    assert.strictEqual(info('money_import_runs', 'status').notnull, 1);
    db.close();
  });

  await test('P0 §4.2: every new column exists with the spec\'s type, NOT NULL and default', async () => {
    const db = await openDb();
    for (const [t, cols] of Object.entries(EXPECT_COLUMNS)) {
      const have = colInfo(db, t);
      for (const [name, type, notnull, dflt] of cols) {
        const c = have.find((x) => x.name === name);
        assert.ok(c, `${t}.${name} exists`);
        assert.deepStrictEqual([c.type, c.notnull, c.dflt_value], [type, notnull, dflt], `${t}.${name}`);
      }
    }
    const declared = moneyMerge.COLUMNS.map((c) => `${c.table}.${c.column}`).sort();
    const spec = Object.entries(EXPECT_COLUMNS).flatMap(([t, cols]) => cols.map((c) => `${t}.${c[0]}`)).sort();
    assert.deepStrictEqual(declared, spec, 'the module adds exactly the spec\'s columns, no more');
    db.close();
  });

  await test('P0 indexes: the partial unique ones behave', async () => {
    const db = await openDb();
    const have = indexNames(db);
    for (const i of EXPECT_INDEXES) assert.ok(have.includes(i), i);
    // one ACTIVE agreement per (player, backer)
    db.run("INSERT INTO users (username, email, password) VALUES ('u1', 'u1@x.test', 'x')");
    const u = one(db, 'SELECT id FROM users WHERE username = ?', ['u1']);
    db.run("INSERT INTO backers (user_id, name) VALUES (?, 'B1'), (?, 'B2')", [u, u]);
    const [b1, b2] = rowsOf(db, 'SELECT id FROM backers ORDER BY id').map((r) => r.id);
    const agr = (b, st) => db.run("INSERT INTO standing_agreements (user_id, backer_id, effective_from, status, created_at) VALUES (?, ?, '2026-01-01', ?, 'x')", [u, b, st]);
    agr(b1, 'active');
    assert.throws(() => agr(b1, 'active'), /UNIQUE/);
    agr(b1, 'ended'); agr(b2, 'active');
    // public_token: unique when set, any number of NULLs
    db.run("UPDATE backers SET public_token = 'tok1' WHERE id = ?", [b1]);
    assert.throws(() => db.run("UPDATE backers SET public_token = 'tok1' WHERE id = ?", [b2]), /UNIQUE/);
    db.run("INSERT INTO backers (user_id, name) VALUES (?, 'B3'), (?, 'B4')", [u, u]);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM backers WHERE public_token IS NULL'), 3);
    db.close(); // nothing is saved
  });

  // ───────────── P1: a live-like database ─────────────
  let U; // the owner's user id
  let before;
  await test('P1 build a live-like database: legacy rows written the way today\'s code writes them, migration removed', async () => {
    const db = await openDb();
    db.run("UPDATE users SET username = 'ham' WHERE username = 'alicex'");
    U = one(db, "SELECT id FROM users WHERE username = 'ham'");
    const run = (sql, args) => db.run(sql, args);
    const T = [];
    for (const [i, buyin] of [[1, 100], [2, 200], [3, 300]]) {
      run(`INSERT INTO tournaments (event_number, event_name, date, time, buyin, game_variant, venue, notes)
           VALUES (?, ?, '2026-10-01', '12:00 PM', ?, 'NLH', 'Money Merge Test Venue', '')`, [`MM-${i}`, `Money Merge Event ${i}`, buyin]);
      T.push(one(db, 'SELECT last_insert_rowid()'));
    }
    run('INSERT INTO tracking_entries (user_id, tournament_id, num_entries, cashed, cash_amount) VALUES (?, ?, 1, 0, 0)', [U, T[0]]); // -100
    run('INSERT INTO tracking_entries (user_id, tournament_id, num_entries, cashed, cash_amount) VALUES (?, ?, 1, 1, 700)', [U, T[1]]); // +500
    run("INSERT INTO bankrolls (user_id, name, starting_balance, created_at) VALUES (?, 'Staked', 1000, '2026-10-10T00:00:00Z')", [U]);
    run("INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, occurred_on, note, created_at) VALUES (?, NULL, 'deposit', 500, '2026-10-02', 'seed', '2026-10-02T00:00:00Z')", [U]);
    run("INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, occurred_on, created_at) VALUES (?, NULL, 'withdrawal', -100, '2026-10-03', '2026-10-03T00:00:00Z')", [U]);
    run("INSERT INTO bankroll_transactions (user_id, bankroll_id, occurred_on, kind, category, amount, currency, note, created_at) VALUES (?, NULL, '2026-10-04', 'expense', 'lodging', 40.5, 'USD', 'hotel', '2026-10-04T00:00:00Z')", [U]);
    run("INSERT INTO bankroll_transactions (user_id, bankroll_id, occurred_on, kind, category, amount, currency, created_at) VALUES (?, NULL, '2026-10-05', 'income', 'rakeback', 10.5, 'USD', '2026-10-05T00:00:00Z')", [U]);
    run("INSERT INTO cash_sessions (user_id, started_at, ended_at, session_date, room, game, stakes, buy_in, cash_out, created_at) VALUES (?, '2026-10-06T18:00:00Z', '2026-10-06T22:00:00Z', '2026-10-06', 'Parx', 'PLO', '1/2', 500, 800, 'x')", [U]); // +300
    run("INSERT INTO cash_sessions (user_id, started_at, session_date, room, game, buy_in, created_at) VALUES (?, '2026-10-07T18:00:00Z', '2026-10-07', 'Parx', 'NLH', 300, 'x')", [U]); // live
    run("INSERT INTO bankroll_import_keys (user_id, fingerprint, ref_table, ref_id, created_at) VALUES (?, 'fp-1', 'bankroll_adjustments', 1, '2026-10-10T00:00:00Z')", [U]);
    // staking and the backer surface, as the dashboard's seams left them (made-up names and tokens)
    run("INSERT INTO staking_series (user_id, name) VALUES (?, 'Made-up Series')", [U]);
    const series = one(db, 'SELECT last_insert_rowid()');
    run("INSERT INTO backers (user_id, name, email, phone) VALUES (?, 'Dan Example', 'dan@example.test', '+15550100')", [U]);
    const dan = one(db, 'SELECT last_insert_rowid()');
    run("INSERT INTO backer_agreements (series_id, backer_id, backer_type, percentage, markup, makeup_balance) VALUES (?, ?, 'pay_per_play', 10, 1.2, -50)", [series, dan]);
    const agr = one(db, 'SELECT last_insert_rowid()');
    run('INSERT INTO backer_event_status (agreement_id, tournament_id) VALUES (?, ?)', [agr, T[2]]);
    run("INSERT INTO backer_settlements (series_id, backer_id, gross_investment, amount_owed, is_paid) VALUES (?, ?, 120, 100, 1)", [series, dan]);
    run("INSERT INTO backer_public (token, name, updated_at) VALUES ('TESTTOK1', 'Dan', 1760000000000), ('TESTTOK2', 'Eve', 1760000000001)");
    run("INSERT INTO backer_push_subs (token, endpoint, keys_p256dh, keys_auth) VALUES ('TESTTOK1', 'https://push.example/1', 'p', 'a')");
    const ev = (id, tok, sid, ts, result, pct, share) => run(
      'INSERT INTO backer_events (id, token, session_id, ts, date, game, venue, hours, session_result_cents, pct, share_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, tok, sid, ts, '2026-10-0' + (ts % 7 + 1), 'PLO', 'Parx', 5.5, result, pct, share]);
    ev('TESTTOK1:s1', 'TESTTOK1', 's1', 1760000100000, 124000, 20, 24800);
    ev('TESTTOK1:s2', 'TESTTOK1', 's2', 1760000200000, -100000, 20, -20000);
    ev('TESTTOK2:s1', 'TESTTOK2', 's1', 1760000100000, 124000, 10, 12400);
    run("INSERT INTO console_records (store, id, data, updated_at, deleted) VALUES ('backers', 'b1', '{\"token\":\"TESTTOK1\"}', 1760000000000, 0)");

    unmigrate(db);
    assert.ok(!applied(db).includes('money-merge-2026-10'));
    assert.ok(!tableNames(db).includes('standing_agreements'));
    assert.ok(!colInfo(db, 'backers').some((c) => c.name === 'public_token'));
    before = snapshot(db, DATA_TABLES);
    assert.strictEqual(before.backer_events.length, 3);
    saveDb(db);
    db.close();
  });

  // ───────────── P2: the migration runs on it ─────────────
  srv = await boot();
  try {
    const login = await api('POST', '/api/login', { body: { email: 'alicex@example.test', password: 'money-merge-pw-1' } });
    assert.strictEqual(login.status, 200, JSON.stringify(login.data));
    token = login.data.token;

    await test('P2 the migration ran at boot and said so', async () => {
      assert.ok(srv.log().includes('Migration "money-merge-2026-10" applied'), srv.log().slice(-1500));
      assert.ok(/Money merge schema: 8 tables, 32 columns added, 3 backer events marked delivered/.test(srv.log()), srv.log().match(/Money merge schema.*/));
      assert.ok(!/Migration "money-merge-2026-10" failed/.test(srv.log()));
    });

    await test('P2 the ledger\'s numbers did not move (legacy rows all still count)', async () => {
      const r = await api('GET', '/api/bankrolls/summary?currency=USD', { token });
      assert.strictEqual(r.status, 200, JSON.stringify(r.data));
      const all = r.data.all;
      // start 1000 (Staked); moved +500 -100; results -100 +500 +300 -40.5 +10.5 = 670
      assert.deepStrictEqual([all.start, all.moved, all.results, all.balance], [1000, 400, 670, 2070]);
      assert.ok(r.data.sources.every((s) => s.ok), JSON.stringify(r.data.sources));
      const tx = await api('GET', '/api/bankrolls/transactions', { token });
      assert.strictEqual(tx.status, 200);
      assert.deepStrictEqual(tx.data.transactions.map((t) => [t.category, t.affects_balance]).sort(), [['lodging', 1], ['rakeback', 1]]);
    });
  } finally { await stop(srv); }

  await test('P2 every pre-existing column of every row is byte-identical; new columns hold their defaults', async () => {
    const db = await openDb();
    const oldCols = Object.fromEntries(Object.keys(before).map((t) => [t, Object.keys(before[t][0] || {})]));
    // tables with no rows give no column list: read it from the live schema, minus the new columns
    const added = Object.fromEntries(Object.entries(EXPECT_COLUMNS).map(([t, c]) => [t, c.map((x) => x[0])]));
    for (const t of Object.keys(before)) {
      if (!oldCols[t].length) oldCols[t] = colInfo(db, t).map((c) => c.name).filter((c) => !(added[t] || []).includes(c));
    }
    const after = snapshot(db, Object.keys(before), oldCols);
    for (const t of Object.keys(before)) {
      // the users table moves with logins (last_login-style columns), so compare the stable ones
      if (t === 'users') continue;
      assert.deepStrictEqual(after[t], before[t], `${t} changed`);
    }
    // defaults on the rows that existed
    assert.deepStrictEqual(rowsOf(db, 'SELECT notify_sms, notify_email, public_token FROM backers').map((r) => [r.notify_sms, r.notify_email, r.public_token]), [[0, 0, null]]);
    assert.deepStrictEqual(rowsOf(db, 'SELECT role, in_roll, target_amount, target_date FROM bankrolls').map((r) => [r.role, r.in_roll, r.target_amount, r.target_date]), [[null, 1, null, null]]);
    assert.deepStrictEqual(rowsOf(db, 'SELECT DISTINCT affects_balance FROM bankroll_transactions').map((r) => r.affects_balance), [1]);
    assert.deepStrictEqual(rowsOf(db, 'SELECT DISTINCT time_known FROM cash_sessions').map((r) => r.time_known), [1]);
    assert.deepStrictEqual(rowsOf(db, 'SELECT settlement_ref FROM bankroll_adjustments').map((r) => r.settlement_ref), [null, null]);
    assert.deepStrictEqual(rowsOf(db, 'SELECT bankroll_id FROM staking_series').map((r) => r.bankroll_id), [null]);
    assert.deepStrictEqual(rowsOf(db, 'SELECT run_id, decision, source_updated_at, source_hash FROM bankroll_import_keys').map((r) => Object.values(r)), [[null, null, null, null]]);
    // agreement_id: Phase 3's migration (staking-settlement-2026-10, next at the same boot) links an old
    // row to its agreement when the backer has exactly one in the series, as Dan does here.
    assert.deepStrictEqual(rowsOf(db, 'SELECT agreement_id, computed_owed, adjustment, adjustment_note, prepaid, makeup_opening, makeup_closing, settled_at FROM backer_settlements').map((r) => Object.values(r)),
      [[one(db, 'SELECT id FROM backer_agreements'), null, 0, null, 0, null, null, null]]);
    assert.deepStrictEqual(rowsOf(db, 'SELECT makeup_opening, makeup_balance FROM backer_agreements').map((r) => Object.values(r)), [[null, -50]], 'makeup_balance is left in place, unread (§10)');
    // the one existing-row write (§4.2): the dashboard's events are already delivered
    const ev = rowsOf(db, 'SELECT id, source, share_cents, ts, notified_share_cents, notified_at, agreement_id, stake_id, ref_table, ref_id, revised_at FROM backer_events ORDER BY id');
    assert.strictEqual(ev.length, 3);
    for (const e of ev) {
      assert.strictEqual(e.source, 'dashboard');
      assert.strictEqual(e.notified_share_cents, e.share_cents);
      assert.strictEqual(e.notified_at, e.ts);
      assert.deepStrictEqual([e.agreement_id, e.stake_id, e.ref_table, e.ref_id, e.revised_at], [null, null, null, null, null]);
    }
    db.close();
  });

  await test('P2 the new tables are empty and every table the spec names exists', async () => {
    const db = await openDb();
    for (const t of Object.keys(EXPECT_TABLES)) assert.strictEqual(one(db, `SELECT COUNT(*) FROM ${t}`), 0, t);
    for (const i of EXPECT_INDEXES) assert.ok(indexNames(db).includes(i), i);
    assert.strictEqual(applied(db).filter((n) => n === 'money-merge-2026-10').length, 1);
    db.close();
  });

  // ───────────── P3: rows that use the new columns and kinds ─────────────
  await test('P3 add rows that use the new kinds and columns', async () => {
    const db = await openDb();
    const run = (sql, args) => db.run(sql, args);
    const T = rowsOf(db, "SELECT id FROM tournaments WHERE venue = 'Money Merge Test Venue' ORDER BY id").map((r) => r.id);
    // §5.3 the two new adjustment kinds: signed, money moved
    run("INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, occurred_on, note, settlement_ref, created_at) VALUES (?, NULL, 'correction', 25, '2026-10-08', 'rounding', NULL, 'x')", [U]);
    run("INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, occurred_on, note, settlement_ref, created_at) VALUES (?, NULL, 'settlement', -75, '2026-10-09', 'WSOP: backers', 'bs:3', 'x')", [U]);
    // §5.4 an expense paid from outside the roll, and the two new categories
    run("INSERT INTO bankroll_transactions (user_id, bankroll_id, occurred_on, kind, category, amount, currency, note, affects_balance, created_at) VALUES (?, NULL, '2026-10-09', 'expense', 'equipment', 60, 'USD', 'imported laptop bag', 0, 'x')", [U]);
    run("INSERT INTO bankroll_transactions (user_id, bankroll_id, occurred_on, kind, category, amount, currency, note, created_at) VALUES (?, NULL, '2026-10-09', 'expense', 'fees', 12.25, 'USD', 'wire fee', 'x')", [U]);
    // §5.2 a cash session with a day and a length but no start time: 12:00 New York, flagged
    run("INSERT INTO cash_sessions (user_id, started_at, ended_at, session_date, room, game, stakes, buy_in, cash_out, time_known, created_at) VALUES (?, '2026-10-08T16:00:00Z', '2026-10-08T19:30:00Z', '2026-10-08', 'Parx', 'PLO', '1/2', 200, 260, 0, 'x')", [U]); // +60
    run('INSERT INTO tracking_entries (user_id, tournament_id, num_entries, cashed, cash_amount) VALUES (?, ?, 1, 0, 0)', [U, T[2]]); // -300
    saveDb(db);
    db.close();
  });

  const p3Before = await (async () => { const db = await openDb(); const s = snapshot(db, DATA_TABLES.filter((t) => t !== 'users')); db.close(); return s; })();
  srv = await boot();
  try {
    token = (await api('POST', '/api/login', { body: { email: 'alicex@example.test', password: 'money-merge-pw-1' } })).data.token;

    await test('P3 a second boot does not run the migration again, and rewrites nothing', async () => {
      assert.ok(!srv.log().includes('Migration "money-merge-2026-10" applied'), 'already applied');
    });

    await test('P3 §4.3 correction and settlement move the balance and never count as profit', async () => {
      const s = (await api('GET', '/api/bankrolls/summary?currency=USD', { token })).data;
      // before: moved 400, results 670. Now moved += 25 - 75; results += (+60 cash) - 300 (tournament) - 12.25 (fees; the outside-roll equipment is skipped)
      assert.deepStrictEqual([s.all.moved, s.all.results], [350, 417.75]);
      assert.strictEqual(s.all.balance, 1000 + 350 + 417.75);
      assert.strictEqual(s.all.by_kind.correction, 25);
      assert.strictEqual(s.all.by_kind.settlement, -75);
      const main = s.bankrolls.find((b) => b.id === 'main');
      assert.strictEqual(main.moved, 350, 'Main\'s moved includes the two new kinds');
      const l = (await api('GET', '/api/bankrolls/ledger?currency=USD', { token })).data;
      const byKind = (k) => l.entries.filter((e) => e.kind === k);
      assert.deepStrictEqual(byKind('correction').map((e) => [e.label, e.amount]), [['Correction · rounding', 25]]);
      assert.deepStrictEqual(byKind('settlement').map((e) => [e.label, e.amount]), [['Paid to backers · WSOP: backers', -75]]);
      assert.ok(l.sources.every((x) => x.ok));
    });

    await test('P3 §4.3 affects_balance = 0: absent from the ledger, present in the Expenses list, totals and tax data', async () => {
      const l = (await api('GET', '/api/bankrolls/ledger?currency=USD', { token })).data;
      const ex = l.entries.filter((e) => e.kind === 'expense');
      assert.deepStrictEqual(ex.map((e) => [e.category, e.amount]).sort(), [['fees', -12.25], ['lodging', -40.5]], 'the outside-roll equipment row moves nothing');
      const list = (await api('GET', '/api/bankrolls/transactions', { token })).data.transactions;
      const eq = list.find((t) => t.category === 'equipment');
      assert.ok(eq, 'still in the list');
      assert.deepStrictEqual([eq.affects_balance, eq.amount, eq.signed_amount], [0, 60, -60]);
      assert.strictEqual(list.find((t) => t.category === 'fees').affects_balance, 1);
      const totals = (await api('GET', '/api/bankrolls/transactions/totals', { token })).data.totals;
      assert.strictEqual(totals.find((t) => t.category === 'equipment').amount, 60, 'the tax report\'s input still counts it');
      const one = (await api('GET', `/api/bankrolls/transactions?category=equipment,fees`, { token })).data;
      assert.strictEqual(one.total, 2);
    });

    await test('P3 §4.3 equipment and fees are accepted categories; others are still refused', async () => {
      for (const category of ['equipment', 'fees']) {
        const r = await api('POST', '/api/bankrolls/transactions', { token, body: { kind: 'expense', category, amount: 9.99, date: '2026-10-10' } });
        assert.strictEqual(r.status, 201, JSON.stringify(r.data));
        assert.strictEqual(r.data.transaction.category, category);
        assert.strictEqual(r.data.transaction.affects_balance, 1, 'a new expense lowers the balance, as today (Q6)');
      }
      const bad = await api('POST', '/api/bankrolls/transactions', { token, body: { kind: 'expense', category: 'bogus', amount: 1, date: '2026-10-10' } });
      assert.strictEqual(bad.status, 400);
      assert.ok(/equipment, fees, other/.test(bad.data.error), bad.data.error);
      const inc = await api('POST', '/api/bankrolls/transactions', { token, body: { kind: 'income', category: 'equipment', amount: 1, date: '2026-10-10' } });
      assert.strictEqual(inc.status, 400, 'equipment and fees are expense categories only');
      // editing an outside-roll row keeps it outside the roll
      const eq = (await api('GET', '/api/bankrolls/transactions?category=equipment', { token })).data.transactions.find((t) => t.note === 'imported laptop bag');
      const put = await api('PUT', `/api/bankrolls/transactions/${eq.id}`, { token, body: { amount: 61 } });
      assert.strictEqual(put.status, 200);
      assert.deepStrictEqual([put.data.transaction.amount, put.data.transaction.affects_balance], [61, 0]);
      const l = (await api('GET', '/api/bankrolls/ledger?currency=USD', { token })).data;
      assert.ok(!l.entries.some((e) => e.ref.table === 'bankroll_transactions' && e.ref.id === eq.id));
      // and the two 9.99 expenses did land
      assert.strictEqual(l.entries.filter((e) => e.kind === 'expense' && e.amount === -9.99).length, 2);
    });

    await test('P3 §4.3 time_known = 0: the fact carries no start time, so no daypart can be made up', async () => {
      const r = await api('GET', '/api/bankrolls/reports?currency=USD', { token });
      assert.strictEqual(r.status, 200, JSON.stringify(r.data));
      const cash = r.data.facts.filter((f) => f.type === 'cash');
      assert.strictEqual(cash.length, 2, 'the live session is not a fact');
      const unknown = cash.find((f) => f.date === '2026-10-08');
      const known = cash.find((f) => f.date === '2026-10-06');
      assert.deepStrictEqual([unknown.hour, unknown.started_at], [null, null]);
      assert.strictEqual(unknown.hours, 3.5, 'the length survives');
      assert.strictEqual(unknown.profit, 60);
      assert.strictEqual(known.started_at, '2026-10-06T18:00:00Z', 'a session with a real start keeps it');
      assert.strictEqual(known.hours, 4);
    });
  } finally { await stop(srv); }

  await test('P3 after that boot nothing the migration touched was rewritten', async () => {
    const db = await openDb();
    const after = snapshot(db, DATA_TABLES.filter((t) => t !== 'users'));
    // only rows the test itself created or edited differ: bankroll_transactions (two POSTs, one PUT)
    const same = DATA_TABLES.filter((t) => t !== 'users' && t !== 'bankroll_transactions');
    for (const t of same) assert.deepStrictEqual(after[t], p3Before[t], `${t} changed`);
    assert.strictEqual(after.bankroll_transactions.length, p3Before.bankroll_transactions.length + 2);
    assert.deepStrictEqual(after.backer_events, p3Before.backer_events, 'the delivered marks are not recomputed');
    db.close();
  });

  // ───────────── in-process: all-or-nothing, idempotent ─────────────
  await test('the migration is idempotent: a second run adds and changes nothing', async () => {
    const db = await openDb();
    unmigrate(db);
    const first = moneyMerge.migrate(db);
    assert.strictEqual(first.tables.length, 8);
    assert.strictEqual(first.columns.length, 32);
    const snap = JSON.stringify(snapshot(db, DATA_TABLES));
    // someone changes a delivered mark by hand: a later run must not "repair" it
    db.run("UPDATE backer_events SET notified_share_cents = NULL, notified_at = NULL WHERE id = 'TESTTOK1:s1'");
    const second = moneyMerge.migrate(db);
    assert.deepStrictEqual(second, { tables: [], columns: [], backfilled: 0 });
    assert.strictEqual(one(db, "SELECT notified_share_cents FROM backer_events WHERE id = 'TESTTOK1:s1'"), null, 'no backfill outside the run that added the columns');
    db.run("UPDATE backer_events SET notified_share_cents = share_cents, notified_at = ts WHERE id = 'TESTTOK1:s1'");
    assert.strictEqual(JSON.stringify(snapshot(db, DATA_TABLES)), snap);
    db.close();
  });

  await test('the migration is all-or-nothing: a failure half way leaves the database as it was', async () => {
    const db = await openDb();
    unmigrate(db);
    db.run('ALTER TABLE cash_sessions RENAME TO cash_sessions_away'); // a table the ALTERs need is missing
    const tablesBefore = tableNames(db).sort();
    const colsBefore = JSON.stringify(Object.fromEntries(Object.keys(EXPECT_COLUMNS).filter((t) => t !== 'cash_sessions').map((t) => [t, colInfo(db, t).map((c) => c.name)])));
    assert.throws(() => moneyMerge.migrate(db), /table cash_sessions does not exist/);
    assert.deepStrictEqual(tableNames(db).sort(), tablesBefore, 'no new table survived');
    for (const i of EXPECT_INDEXES) assert.ok(!indexNames(db).includes(i), i);
    assert.strictEqual(JSON.stringify(Object.fromEntries(Object.keys(EXPECT_COLUMNS).filter((t) => t !== 'cash_sessions').map((t) => [t, colInfo(db, t).map((c) => c.name)]))), colsBefore, 'no column survived');
    // fix the cause and run again: it completes
    db.run('ALTER TABLE cash_sessions_away RENAME TO cash_sessions');
    const r = moneyMerge.migrate(db);
    assert.strictEqual(r.tables.length, 8);
    assert.strictEqual(r.columns.length, 32);
    db.close();
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error('\nFAIL', err && err.stack || err);
  console.error(`(scratch dir kept for inspection: ${TMP})`);
  process.exit(1);
});
