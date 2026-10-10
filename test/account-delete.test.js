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
    bankrolls: ['user_id'], bankroll_adjustments: ['user_id'],
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
