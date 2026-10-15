// DELETE /api/account, end to end against the real server and a real SQLite file.
//
//   node test/account-delete.test.js        (or: npm run test:account)
//
// Boots server.js TWICE on a scratch port with a scratch DB in a temp dir, never
// poker-tournaments.db and never port 3001 (the pm2 instance):
//   1. boot on a fresh DB so the server builds its own schema, register three
//      users through the API, stop;
//   2. seed rows for every user-linked table straight into that file (the
//      routes that create some of them need the solver, a PDF or Apple), boot
//      again, delete one account through the API, stop;
//   3. open the file and count.
// What is checked: every row the deleted user owned is gone, rows of OTHER
// users that merely pointed at them survive with the pointer cleared, other
// users' own rows are untouched, the shared tournaments stay, the re-confirm
// is enforced, and the dead account's token stops working.
//
// The solver is not in this repo (a gitignored junction to futuregame-solver),
// so a preload stubs every `./solver/...` require with an inert proxy.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const initSqlJs = require('sql.js');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-account-delete-'));
const DB_PATH = path.join(TMP, 'scratch.db');
const PORT = 41000 + Math.floor(Math.random() * 8000);
const BASE = `http://127.0.0.1:${PORT}/api`;
assert.notStrictEqual(PORT, 3001);
assert.notStrictEqual(path.basename(DB_PATH), 'poker-tournaments.db');

const STUB = path.join(TMP, 'solver-stub.js');
fs.writeFileSync(STUB, `
const Module = require('module');
const orig = Module._load;
const fn = function () {};
const stub = new Proxy(fn, {
  get(t, k) { return (typeof k === 'symbol' || k === 'then') ? undefined : stub; },
  apply() { return stub; },
  construct() { return stub; },
});
Module._load = function (request) {
  if (/^\\.\\/solver\\//.test(request)) return stub;
  return orig.apply(this, arguments);
};
`);

// The child sees none of the live box's seams: no prod push, no roster pull, no
// watchdogs, no mail, no push, no model calls.
const env = { ...process.env, PORT: String(PORT), DB_PATH, JWT_SECRET: 'account-delete-test-secret' };
for (const k of Object.keys(env)) {
  if (/^(SYNC_TOKEN|DASHBOARD_|TESTFLIGHT_WATCHDOG|RENDER_DEPLOY_WATCHDOG|ADMIN_(USER|PASS|KEY)|SMTP_|VAPID_|APNS_|TWILIO_|ANTHROPIC_|CONSOLE_OWNER_USER_ID|RENDER$|IS_PRODUCTION|SOLVER_URL|CASHWATCHER_URL)/.test(k)) delete env[k];
}

function boot() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-r', STUB, 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch (_) { /* empty */ }
  return { status: res.status, data };
}

let SQL;
async function openDb() { SQL = SQL || await initSqlJs(); return new SQL.Database(fs.readFileSync(DB_PATH)); }
function saveDb(db) { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); }
const one = (db, sql, args = []) => { const r = db.exec(sql, args); return r.length && r[0].values.length ? r[0].values[0][0] : null; };
const ids = (db, sql, args = []) => { const r = db.exec(sql, args); return r.length ? r[0].values.map(v => v[0]) : []; };

let pass = 0;
const check = (label, fn) => { fn(); pass++; console.log('  ok   ' + label); };

(async () => {
  // ── 1. fresh schema + three accounts ──
  let srv = await boot();
  const users = {};
  try {
    for (const name of ['alice', 'bob', 'carol']) {
      const r = await api('POST', '/register', { body: { username: name, email: `${name}@example.test`, password: 'correct-horse-1', realName: name.toUpperCase() } });
      assert.strictEqual(r.status, 201, `register ${name}: ${JSON.stringify(r.data)}`);
      const l = await api('POST', '/login', { body: { email: `${name}@example.test`, password: 'correct-horse-1' } });
      assert.strictEqual(l.status, 200);
      users[name] = { id: l.data.userId, token: l.data.token };
    }
    // An admin name cannot be claimed by sign-up (it would inherit admin rights).
    const adm = await api('POST', '/register', { body: { username: 'Ham', email: 'imposter@example.test', password: 'correct-horse-1', realName: 'X' } });
    check('an admin username cannot be registered', () => assert.strictEqual(adm.status, 409));
  } finally { await stop(srv); }

  // ── 2. seed every user-linked table ──
  const A = users.alice.id, B = users.bob.id, C = users.carol.id;
  let db = await openDb();
  const [t1, t2, t3] = ids(db, "SELECT id FROM tournaments WHERE venue != 'Personal' ORDER BY id LIMIT 3");
  assert.ok(t1 && t2 && t3, 'the fresh DB is seeded with tournaments');
  const run = (sql, args) => db.run(sql, args);
  const lastId = () => one(db, 'SELECT last_insert_rowid()');

  run("UPDATE users SET avatar = 'data:image/png;base64,AAAA', saved_location = '{\"label\":\"Philly\"}' WHERE id = ?", [A]);
  run('UPDATE tournaments SET uploaded_by = ? WHERE id = ?', [A, t3]); // a shared event alice imported
  for (const [u, t] of [[A, t1], [A, t2], [B, t1], [C, t2]]) {
    run('INSERT INTO user_schedules (user_id, tournament_id) VALUES (?, ?)', [u, t]);
    run('INSERT INTO tracking_entries (user_id, tournament_id, num_entries) VALUES (?, ?, 1)', [u, t]);
    run("INSERT INTO live_updates (user_id, tournament_id, update_text) VALUES (?, ?, 'bagged 40k')", [u, t]);
  }
  run("INSERT INTO schedule_conditions (user_id, tournament_id, depends_on_tournament_id, condition_type) VALUES (?, ?, ?, 'if_bust')", [A, t2, t1]);
  run("INSERT INTO schedule_conditions (user_id, tournament_id, depends_on_tournament_id, condition_type) VALUES (?, ?, ?, 'if_bust')", [B, t2, t1]);
  // alice's Personal event
  run(`INSERT INTO tournaments (stable_id, event_number, event_name, date, time, buyin, game_variant, venue, notes, uploaded_by)
       VALUES (?, '', 'Day Off', 'October 9, 2026', '12:00 AM', 0, 'Personal', 'Personal', '', ?)`, [`PERSONAL-${A}-1`, A]);
  const personal = lastId();
  run('INSERT INTO user_schedules (user_id, tournament_id) VALUES (?, ?)', [A, personal]);

  for (const u of [A, B]) {
    run("INSERT INTO saved_hands (user_id, hand_data, game_type) VALUES (?, '{}', 'NLH')", [u]);
    run("INSERT INTO replayer_games (user_id, name, definition) VALUES (?, 'g', '{}')", [u]);
    run("INSERT INTO trainer_hands (user_id, game, played_at, ev_loss_total, hand_json) VALUES (?, 'razz', 1, 0.5, '{}')", [u]);
    run("INSERT INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth) VALUES (?, ?, 'p', 'a')", [u, `https://push.example/${u}`]);
    run("INSERT INTO apns_tokens (user_id, token) VALUES (?, ?)", [u, `apns-${u}`]);
    run("INSERT INTO subscriptions (user_id, tier, status, source, starts_at, created_at, updated_at) VALUES (?, 'pro', 'active', 'manual', 1, 1, 1)", [u]);
    run("INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, '2099-01-01')", [u, `reset-${u}`]);
    run('INSERT INTO share_tokens (user_id, token) VALUES (?, ?)', [u, `share-${u}`]);
    run("INSERT INTO staking_sell_params (user_id, param_type, param_key) VALUES (?, 'venue', 'x')", [u]);
    run("INSERT INTO staking_markup_settings (user_id, setting_type, setting_key) VALUES (?, 'venue', 'x')", [u]);
    run("INSERT INTO shared_hands (id, shorthand, uploaded_by) VALUES (?, 'N60.1-2.-.-.', ?)", [`h${u}`, u]);
    // bankrolls (beta): one bankroll, a deposit into it and a withdrawal from Main (bankroll_id NULL)
    run("INSERT INTO bankrolls (user_id, name, created_at) VALUES (?, 'Staked', '2026-10-10T00:00:00Z')", [u]);
    run("INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, occurred_on, created_at) VALUES (?, ?, 'deposit', 100, '2026-10-10', '2026-10-10T00:00:00Z')", [u, lastId()]);
    run("INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, occurred_on, created_at) VALUES (?, NULL, 'withdrawal', -5, '2026-10-10', '2026-10-10T00:00:00Z')", [u]);
    // the combined ledger's state: a rules/goals row and an import dedupe key
    run("INSERT INTO bankroll_prefs (user_id, bankroll_key, prefs, updated_at) VALUES (?, 'all', '{}', '2026-10-10T00:00:00Z')", [u]);
    run("INSERT INTO bankroll_import_keys (user_id, fingerprint, ref_table, ref_id, created_at) VALUES (?, ?, 'bankroll_adjustments', 1, '2026-10-10T00:00:00Z')", [u, `fp-${u}`]);
    // cash sessions (beta): one ended under the bankroll above, one live in Main
    run(`INSERT INTO cash_sessions (user_id, bankroll_id, started_at, ended_at, session_date, buy_in, cash_out, created_at)
         VALUES (?, (SELECT id FROM bankrolls WHERE user_id = ?), '2026-10-10T18:00:00Z', '2026-10-10T22:00:00Z', '2026-10-10', 500, 800, 'x')`, [u, u]);
    run("INSERT INTO cash_sessions (user_id, started_at, session_date, buy_in, created_at) VALUES (?, '2026-10-11T18:00:00Z', '2026-10-11', 300, 'x')", [u]);
    // ... with two stack updates on the live one
    const liveCash = lastId();
    for (const amt of [250, 420]) run("INSERT INTO cash_session_stacks (session_id, user_id, at, amount, invested, created_at) VALUES (?, ?, '2026-10-11T19:00:00Z', ?, 300, 'x')", [liveCash, u, amt]);
    // expenses / income and trips (beta): a trip, an expense tagged to it and to an event, an income in Main
    run("INSERT INTO bankroll_trips (user_id, name, start_date, end_date, created_at) VALUES (?, 'Vegas', '2026-06-01', '2026-06-10', '2026-10-10T00:00:00Z')", [u]);
    const trip = lastId();
    run("INSERT INTO bankroll_transactions (user_id, bankroll_id, occurred_on, kind, category, amount, currency, tournament_id, trip_id, created_at) VALUES (?, NULL, '2026-06-02', 'expense', 'lodging', 412.5, 'USD', ?, ?, '2026-10-10T00:00:00Z')", [u, t1, trip]);
    run("INSERT INTO bankroll_transactions (user_id, bankroll_id, occurred_on, kind, category, amount, currency, created_at) VALUES (?, NULL, '2026-06-03', 'income', 'rakeback', 20, 'USD', '2026-10-10T00:00:00Z')", [u]);
  }
  // buddies, both directions, and a stranger pair that must survive
  run("INSERT INTO share_requests (from_user_id, to_user_id, status) VALUES (?, ?, 'accepted')", [A, B]);
  run("INSERT INTO share_requests (from_user_id, to_user_id, status) VALUES (?, ?, 'pending')", [C, A]);
  run("INSERT INTO share_requests (from_user_id, to_user_id, status) VALUES (?, ?, 'accepted')", [B, C]);
  run('INSERT INTO schedule_permissions (owner_id, viewer_id) VALUES (?, ?)', [B, A]);
  run("INSERT INTO swap_suggestions (from_user_id, to_user_id, tournament_id, type, my_pct, their_pct) VALUES (?, ?, ?, 'swap', 5, 5)", [B, A, t1]);
  run("INSERT INTO swap_suggestions (from_user_id, to_user_id, tournament_id, type, my_pct, their_pct) VALUES (?, ?, ?, 'swap', 5, 5)", [B, C, t1]);

  // groups: alice owns G1 (bob is in it); bob owns G2 (alice and carol are in it)
  run("INSERT INTO groups (name, created_by) VALUES ('alice crew', ?)", [A]); const G1 = lastId();
  run("INSERT INTO groups (name, created_by) VALUES ('bob crew', ?)", [B]); const G2 = lastId();
  run("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'owner'), (?, ?, 'member')", [G1, A, G1, B]);
  run("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'owner'), (?, ?, 'member'), (?, ?, 'member')", [G2, B, G2, A, G2, C]);
  run("INSERT INTO group_messages (group_id, user_id, message) VALUES (?, ?, 'a in g1'), (?, ?, 'b in g1'), (?, ?, 'a in g2'), (?, ?, 'b in g2')", [G1, A, G1, B, G2, A, G2, B]);
  run('INSERT INTO group_invites (group_id, invited_by, invited_user_id) VALUES (?, ?, ?)', [G1, A, C]);
  run('INSERT INTO group_invites (group_id, invited_by, invited_user_id) VALUES (?, ?, ?)', [G2, A, C]);

  // staking: alice's whole tree; bob's agreement that names alice as a swap partner
  run("INSERT INTO staking_series (user_id, name) VALUES (?, 'alice WSOP')", [A]); const SA = lastId();
  run("INSERT INTO backers (user_id, name, app_user_id) VALUES (?, 'Dan', ?)", [A, C]); const BA = lastId();
  run("INSERT INTO backer_agreements (series_id, backer_id, backer_type) VALUES (?, ?, 'stake')", [SA, BA]); const AGA = lastId();
  run('INSERT INTO backer_event_overrides (agreement_id, tournament_id) VALUES (?, ?)', [AGA, t1]);
  run('INSERT INTO backer_event_status (agreement_id, tournament_id) VALUES (?, ?)', [AGA, t1]);
  run('INSERT INTO backer_tokens (agreement_id, token) VALUES (?, ?)', [AGA, 'btok-alice']);
  run('INSERT INTO backer_settlements (series_id, backer_id) VALUES (?, ?)', [SA, BA]);
  run("INSERT INTO staking_series (user_id, name) VALUES (?, 'bob WSOP')", [B]); const SB = lastId();
  run("INSERT INTO backers (user_id, name, app_user_id) VALUES (?, 'Alice as backer', ?)", [B, A]); const BB = lastId();
  run("INSERT INTO backer_agreements (series_id, backer_id, backer_type, swap_user_id, crossbook_user_id) VALUES (?, ?, 'swap', ?, ?)", [SB, BB, A, A]); const AGB = lastId();
  run('INSERT INTO backer_event_status (agreement_id, tournament_id) VALUES (?, ?)', [AGB, t1]);
  run('INSERT INTO backer_tokens (agreement_id, token) VALUES (?, ?)', [AGB, 'btok-bob']);
  run('INSERT INTO backer_settlements (series_id, backer_id) VALUES (?, ?)', [SB, BB]);

  // money merge ('money-merge-2026-10'): standing agreements (alice's backer Dan, bob's backer
  // "Alice as backer") with stakes and exclusions, plus the per-user tables. backer_events and their
  // revisions are keyed by a backer's token, not an app user, and are left alone on purpose.
  const STANDING = {};
  for (const [u, backer, tok] of [[A, BA, 'btok-alice'], [B, BB, 'btok-bob']]) {
    run("INSERT INTO standing_agreements (user_id, backer_id, effective_from, status, opening_cents, created_at) VALUES (?, ?, '2026-01-01', 'active', -2500, 'x')", [u, backer]);
    const ag = lastId(); STANDING[u] = ag;
    run("INSERT INTO standing_stakes (agreement_id, format, channel, pct, valid_from, created_at) VALUES (?, 'PLO', 'any', 20, '2026-01-01', 'x'), (?, 'all', 'online', 5, '2026-01-01', 'x')", [ag, ag]);
    run("INSERT INTO standing_exclusions (agreement_id, ref_table, ref_id, created_at) VALUES (?, 'tracking_entries', 1, 'x')", [ag]);
    run("INSERT INTO session_extras (user_id, ref_table, ref_id, format, channel, updated_at) VALUES (?, 'tracking_entries', ?, 'PLO', 'live', 'x')", [u, u]);
    run("INSERT INTO session_extras (user_id, ref_table, ref_id, origin, origin_id, updated_at) VALUES (?, 'cash_sessions', ?, 'dashboard', 'chat-0123456789ab', 'x')", [u, u]);
    run("INSERT INTO money_locations (user_id, name, amount, updated_at) VALUES (?, 'Wallet', 120.5, 'x')", [u]);
    run("INSERT INTO money_settings (user_id, data, updated_at) VALUES (?, '{\"cutover\":\"none\"}', 'x')", [u]);
    run("INSERT INTO money_import_runs (user_id, source, fetched_at, payload, status) VALUES (?, 'dashboard', 'x', '{}', 'staged')", [u]);
    run("INSERT INTO backer_events (id, token, session_id, ts, share_cents, source, notified_share_cents) VALUES (?, ?, 's1', 1760000000000, 24800, 'dashboard', 24800)", [`${tok}:s1`, tok]);
    run("INSERT INTO backer_event_revisions (event_id, token, at, action, share_before, share_after) VALUES (?, ?, 1760000001000, 'revise', 24800, 25000)", [`${tok}:s1`, tok]);
  }
  saveDb(db);
  db.close();

  // ── 3. delete alice through the API ──
  srv = await boot();
  try {
    const guest = await api('POST', '/guest-login');
    const g = await api('DELETE', '/account', { token: guest.data.token, body: { confirm: 'Guest' } });
    check('a guest cannot delete anything', () => assert.strictEqual(g.status, 403));

    const noConfirm = await api('DELETE', '/account', { token: users.alice.token, body: {} });
    check('missing confirmation is refused', () => assert.strictEqual(noConfirm.status, 400));
    const wrong = await api('DELETE', '/account', { token: users.alice.token, body: { confirm: 'bob' } });
    check('someone else\'s username is refused', () => assert.strictEqual(wrong.status, 400));
    const still = await api('GET', '/user/location', { token: users.alice.token });
    check('and the account is still there afterwards', () => assert.strictEqual(still.status, 200));

    const del = await api('DELETE', '/account', { token: users.alice.token, body: { confirm: '@Alice' } });
    check('the matching username deletes the account', () => assert.deepStrictEqual([del.status, del.data], [200, { deleted: true }]));

    const after = await api('GET', '/user/location', { token: users.alice.token });
    check('the deleted account\'s token stops working', () => assert.strictEqual(after.status, 401));
    const again = await api('DELETE', '/account', { token: users.alice.token, body: { confirm: 'alice' } });
    check('a second delete is a 401, not a crash', () => assert.strictEqual(again.status, 401));
    const relog = await api('POST', '/login', { body: { email: 'alice@example.test', password: 'correct-horse-1' } });
    check('the credentials no longer log in', () => assert.strictEqual(relog.status, 401));
    const bobOk = await api('GET', '/user/location', { token: users.bob.token });
    check('another user\'s token is unaffected', () => assert.strictEqual(bobOk.status, 200));
    check('the deletion is logged by id only', () => {
      const line = srv.log().split(/\r?\n/).find(l => l.includes('[account] deleted user'));
      assert.ok(line, 'audit line present');
      assert.ok(line.includes(`user ${A} `), line);
      assert.ok(!/alice/i.test(line), 'no username in the audit line');
    });
  } finally { await stop(srv); }

  // ── 4. count ──
  db = await openDb();
  const userCols = {
    users: ['id'], user_schedules: ['user_id'], schedule_conditions: ['user_id'], tracking_entries: ['user_id'],
    live_updates: ['user_id'], saved_hands: ['user_id'], replayer_games: ['user_id'], trainer_hands: ['user_id'],
    push_subscriptions: ['user_id'], apns_tokens: ['user_id'], subscriptions: ['user_id'], password_resets: ['user_id'],
    share_tokens: ['user_id'], staking_sell_params: ['user_id'], staking_markup_settings: ['user_id'],
    staking_series: ['user_id'], backers: ['user_id', 'app_user_id'],
    backer_agreements: ['swap_user_id', 'crossbook_user_id'], share_requests: ['from_user_id', 'to_user_id'],
    schedule_permissions: ['owner_id', 'viewer_id'], swap_suggestions: ['from_user_id', 'to_user_id'],
    groups: ['created_by'], group_members: ['user_id'], group_messages: ['user_id'],
    group_invites: ['invited_by', 'invited_user_id'], shared_hands: ['uploaded_by'], tournaments: ['uploaded_by'],
    bankrolls: ['user_id'], bankroll_adjustments: ['user_id'], cash_sessions: ['user_id'], cash_session_stacks: ['user_id'],
    bankroll_prefs: ['user_id'], bankroll_import_keys: ['user_id'],
    bankroll_transactions: ['user_id'], bankroll_trips: ['user_id'],
    standing_agreements: ['user_id'], session_extras: ['user_id'], money_locations: ['user_id'],
    money_settings: ['user_id'], money_import_runs: ['user_id'],
    growth_events: ['user_id'], user_days: ['user_id'], apple_notifications: ['user_id'],
  };
  check('no row anywhere still points at the deleted user', () => {
    const left = [];
    for (const [t, cols] of Object.entries(userCols)) {
      for (const c of cols) { const n = one(db, `SELECT COUNT(*) FROM ${t} WHERE ${c} = ?`, [A]); if (n) left.push(`${t}.${c}=${n}`); }
    }
    assert.deepStrictEqual(left, []);
  });
  check('every user-linked table in the schema is covered by this check', () => {
    const tables = ids(db, "SELECT name FROM sqlite_master WHERE type = 'table'");
    const linked = tables.filter(t => {
      const cols = db.exec(`PRAGMA table_info(${t})`)[0].values.map(v => v[1]);
      return cols.some(c => /(^|_)user_id$|^uploaded_by$|^created_by$|^invited_by$|^owner_id$|^viewer_id$/.test(c));
    });
    assert.deepStrictEqual(linked.filter(t => !userCols[t]), []);
  });
  check('alice\'s staking tree is gone, leaves included', () => {
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM staking_series WHERE id = ?', [SA]), 0);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM backers WHERE id = ?', [BA]), 0);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM backer_agreements WHERE id = ?', [AGA]), 0);
    for (const t of ['backer_event_overrides', 'backer_event_status', 'backer_tokens']) {
      assert.strictEqual(one(db, `SELECT COUNT(*) FROM ${t} WHERE agreement_id = ?`, [AGA]), 0, t);
    }
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM backer_settlements WHERE series_id = ?', [SA]), 0);
  });
  check('bob\'s staking survives, with alice unlinked from it', () => {
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM staking_series WHERE id = ?', [SB]), 1);
    assert.deepStrictEqual(db.exec('SELECT swap_user_id, crossbook_user_id FROM backer_agreements WHERE id = ?', [AGB])[0].values[0], [null, null]);
    assert.strictEqual(one(db, 'SELECT app_user_id FROM backers WHERE id = ?', [BB]), null);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM backer_event_status WHERE agreement_id = ?', [AGB]), 1);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM backer_tokens WHERE agreement_id = ?', [AGB]), 1);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM backer_settlements WHERE series_id = ?', [SB]), 1);
  });
  check('alice\'s standing agreement goes with its stakes and exclusions; session extras and money settings go too', () => {
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM standing_agreements WHERE id = ?', [STANDING[A]]), 0);
    for (const t of ['standing_stakes', 'standing_exclusions']) {
      assert.strictEqual(one(db, `SELECT COUNT(*) FROM ${t} WHERE agreement_id = ?`, [STANDING[A]]), 0, t);
    }
    for (const t of ['session_extras', 'money_locations', 'money_settings', 'money_import_runs']) {
      assert.strictEqual(one(db, `SELECT COUNT(*) FROM ${t} WHERE user_id = ?`, [A]), 0, t);
    }
  });
  check('bob\'s standing agreement survives whole, stakes and exclusions included', () => {
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM standing_agreements WHERE id = ?', [STANDING[B]]), 1);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM standing_stakes WHERE agreement_id = ?', [STANDING[B]]), 2);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM standing_exclusions WHERE agreement_id = ?', [STANDING[B]]), 1);
  });
  check('backer_events and their revisions are left alone on purpose (keyed by token, not by app user)', () => {
    for (const tok of ['btok-alice', 'btok-bob']) {
      assert.strictEqual(one(db, 'SELECT COUNT(*) FROM backer_events WHERE token = ?', [tok]), 1, tok);
      assert.strictEqual(one(db, 'SELECT COUNT(*) FROM backer_event_revisions WHERE token = ?', [tok]), 1, tok);
    }
  });
  check('the group alice owned is deleted with everything in it', () => {
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM groups WHERE id = ?', [G1]), 0);
    for (const t of ['group_members', 'group_messages', 'group_invites']) {
      assert.strictEqual(one(db, `SELECT COUNT(*) FROM ${t} WHERE group_id = ?`, [G1]), 0, t);
    }
  });
  check('bob\'s group survives without alice', () => {
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM groups WHERE id = ?', [G2]), 1);
    assert.deepStrictEqual(ids(db, 'SELECT user_id FROM group_members WHERE group_id = ? ORDER BY user_id', [G2]), [B, C].sort((x, y) => x - y));
    assert.deepStrictEqual(ids(db, 'SELECT message FROM group_messages WHERE group_id = ?', [G2]), ['b in g2']);
  });
  check('the Personal event is deleted; shared events are not', () => {
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM tournaments WHERE id = ?', [personal]), 0);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM tournaments WHERE id IN (?, ?, ?)', [t1, t2, t3]), 3);
    assert.strictEqual(one(db, 'SELECT uploaded_by FROM tournaments WHERE id = ?', [t3]), null);
  });
  check('bob and carol keep their own rows', () => {
    const per = (u) => ['user_schedules', 'tracking_entries', 'live_updates'].map(t => one(db, `SELECT COUNT(*) FROM ${t} WHERE user_id = ?`, [u]));
    assert.deepStrictEqual(per(B), [1, 1, 1]);
    assert.deepStrictEqual(per(C), [1, 1, 1]);
    for (const t of ['saved_hands', 'replayer_games', 'trainer_hands', 'push_subscriptions', 'apns_tokens', 'subscriptions',
                     'password_resets', 'share_tokens', 'staking_sell_params', 'staking_markup_settings', 'schedule_conditions']) {
      assert.strictEqual(one(db, `SELECT COUNT(*) FROM ${t} WHERE user_id = ?`, [B]), 1, t);
    }
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM shared_hands WHERE uploaded_by = ?', [B]), 1);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM bankrolls WHERE user_id = ?', [B]), 1);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM bankroll_adjustments WHERE user_id = ?', [B]), 2);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM bankroll_prefs WHERE user_id = ?', [B]), 1);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM bankroll_import_keys WHERE user_id = ?', [B]), 1);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM cash_sessions WHERE user_id = ?', [B]), 2);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM cash_session_stacks WHERE user_id = ?', [B]), 2);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM bankroll_transactions WHERE user_id = ?', [B]), 2);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM bankroll_trips WHERE user_id = ?', [B]), 1);
    for (const t of ['standing_agreements', 'money_locations', 'money_settings', 'money_import_runs']) {
      assert.strictEqual(one(db, `SELECT COUNT(*) FROM ${t} WHERE user_id = ?`, [B]), 1, t);
    }
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM session_extras WHERE user_id = ?', [B]), 2);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM share_requests WHERE from_user_id = ? AND to_user_id = ?', [B, C]), 1);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM swap_suggestions WHERE from_user_id = ? AND to_user_id = ?', [B, C]), 1);
    assert.strictEqual(one(db, 'SELECT COUNT(*) FROM users WHERE id IN (?, ?)', [B, C]), 2);
  });
  db.close();

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${pass} passed`);
})().catch((err) => {
  console.error('\nFAIL', err && err.stack || err);
  console.error(`(scratch dir kept for inspection: ${TMP})`);
  process.exit(1);
});
