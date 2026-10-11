// Cash game sessions (beta): the /api/cash-sessions routes end to end — the beta gate, logging a
// past session, the live flow (start, rebuy, end), edit, delete, stats, CSV, the ?bankroll= filter,
// and CROSS-USER ISOLATION: a user must never read, change or end another user's session.
//
//   node test/cash-sessions.test.js      (part of: npm run test:cash-sessions)
//
// Boots server.js twice on a scratch port against a scratch DB (never port 3001, never
// poker-tournaments.db): once to register three accounts, then — with two renamed to the admin
// usernames 'ham' and 'ham5', which sign-up refuses — again to test.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 44000 + Math.floor(Math.random() * 2000);
assert.notStrictEqual(PORT, 3001);

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}

function request(method, p, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const h = { ...headers };
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch (_) { /* not json */ } resolve({ status: res.statusCode, body: b, json, headers: res.headers }); });
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
    try { if ((await request('GET', '/health')).status === 200) return; } catch (_) { /* not yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('server did not come up');
}
async function down(child) {
  if (child.exitCode != null) return;
  await new Promise((r) => { child.once('exit', r); child.kill(); });
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-cash-sessions-'));
  const dbPath = path.join(tmp, 'scratch.db');
  assert.notStrictEqual(path.basename(dbPath), 'poker-tournaments.db');
  const env = { ...process.env };
  for (const k of ['SYNC_TOKEN', 'DASHBOARD_TOKEN', 'TESTFLIGHT_WATCHDOG', 'RENDER_DEPLOY_WATCHDOG', 'SMTP_HOST', 'SMTP_USER',
    'SMTP_PASS', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'RENDER', 'TRUST_PROXY', 'CASHWATCHER_URL']) delete env[k];
  Object.assign(env, { JWT_SECRET: 'cash-sessions-test-secret', PORT: String(PORT), DB_PATH: dbPath, DISABLE_FEED_INGEST: '1' });

  const pw = 'cash-sessions-test-password';
  let child = boot(env);
  let deletedLiveId = null; // read back from the saved DB once the server has stopped
  try {
    await up(child);
    for (const u of ['alicex', 'bobx', 'normal']) {
      const r = await request('POST', '/api/register', { body: { username: u, email: `${u}@x.test`, password: pw, realName: u } });
      assert.strictEqual(r.status, 201, `register ${u}: ${r.body}`);
    }
  } finally { await down(child); }

  const SQL = await require(path.join(ROOT, 'node_modules', 'sql.js'))();
  let db = new SQL.Database(fs.readFileSync(dbPath));
  db.run("UPDATE users SET username = 'ham' WHERE username = 'alicex'");
  db.run("UPDATE users SET username = 'ham5' WHERE username = 'bobx'");
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();

  child = boot(env);
  try {
    await up(child);
    const login = async (email) => (await request('POST', '/api/login', { body: { email, password: pw } })).json.token;
    const A = { Authorization: 'Bearer ' + await login('alicex@x.test') };
    const B = { Authorization: 'Bearer ' + await login('bobx@x.test') };
    const N = { Authorization: 'Bearer ' + await login('normal@x.test') };
    const G = { Authorization: 'Bearer ' + (await request('POST', '/api/guest-login')).json.token };
    const get = (p, h) => request('GET', p, { headers: h });
    const post = (p, h, body) => request('POST', p, { headers: h, body });
    const put = (p, h, body) => request('PUT', p, { headers: h, body });
    const del = (p, h) => request('DELETE', p, { headers: h });
    const S = '/api/cash-sessions';
    const past = (o = {}) => ({ startedAt: '2026-10-01T22:00:00Z', endedAt: '2026-10-02T04:00:00Z', date: '2026-10-01',
      room: 'Borgata', venueSlug: 'borgata', game: 'NLH', stakes: '$2/$5', buyIn: 1000, cashOut: 1800, tips: 40, ...o });

    // ── gate ──
    await test('gate: no token 401; guest and normal user 403 on every route', async () => {
      assert.strictEqual((await get(S)).status, 401);
      for (const h of [G, N]) {
        assert.strictEqual((await get(S, h)).status, 403);
        assert.strictEqual((await get(`${S}/live`, h)).status, 403);
        assert.strictEqual((await get(`${S}/stats`, h)).status, 403);
        assert.strictEqual((await get(`${S}/export.csv`, h)).status, 403);
        assert.strictEqual((await post(S, h, past())).status, 403);
        assert.strictEqual((await post(`${S}/start`, h, { buyIn: 100 })).status, 403);
        assert.strictEqual((await get(`${S}/1`, h)).status, 403);
        assert.strictEqual((await post(`${S}/1/stack`, h, { amount: 100 })).status, 403);
        assert.strictEqual((await del(`${S}/1/stacks/1`, h)).status, 403);
      }
    });
    await test('the /api/cash watcher proxy does not swallow /api/cash-sessions', async () => {
      const r = await get(S, A);
      assert.strictEqual(r.status, 200, r.body);
      assert.ok(Array.isArray(r.json.sessions));
      assert.ok(r.json.games.includes('PLO5'));
    });

    // ── log a past session ──
    let s1;
    await test('log: validates times and money', async () => {
      assert.strictEqual((await post(S, A, past({ endedAt: '2026-10-01T21:00:00Z' }))).status, 400);
      assert.strictEqual((await post(S, A, past({ endedAt: '2026-10-05T04:00:00Z' }))).status, 400); // > 72 h
      assert.strictEqual((await post(S, A, past({ buyIn: 0 }))).status, 400);
      assert.strictEqual((await post(S, A, past({ cashOut: -5 }))).status, 400);
      assert.strictEqual((await post(S, A, past({ cashOut: undefined }))).status, 400);
      assert.strictEqual((await post(S, A, past({ startedAt: 'yesterday' }))).status, 400);
      assert.strictEqual((await post(S, A, past({ date: '10/01/2026' }))).status, 400);
      assert.strictEqual((await post(S, A, past({ currency: 'XYZ' }))).status, 400);
      assert.strictEqual((await post(S, A, past({ venueSlug: 'bad slug!' }))).status, 400);
      assert.strictEqual((await post(S, A, past({ tags: Array.from({ length: 11 }, (_, i) => 't' + i) }))).status, 400);
    });
    await test('log: 201, shaped, stakes normalised, net = cash_out - buy_in - tips - expenses', async () => {
      const r = await post(S, A, past({ expenses: 25, tags: ['deep', 'Deep', 'reg table'], notes: ' good game ' }));
      assert.strictEqual(r.status, 201, r.body);
      s1 = r.json.session;
      assert.strictEqual(s1.stakes, '2/5');
      assert.strictEqual(s1.bankroll_id, 'main');
      assert.strictEqual(s1.currency, 'USD');
      assert.deepStrictEqual([s1.result, s1.net, s1.hours, s1.live], [800, 735, 6, false]);
      assert.deepStrictEqual(s1.tags, ['deep', 'reg table']);
      assert.strictEqual(s1.notes, 'good game');
      assert.strictEqual(s1.session_date, '2026-10-01');
    });

    // ── bankrolls ──
    let aOnline, bOwn;
    await test('bankroll: filed under the caller\'s own bankroll, defaulting to its currency', async () => {
      aOnline = (await post('/api/bankrolls', A, { name: 'Euro', currency: 'EUR' })).json.bankroll.id;
      bOwn = (await post('/api/bankrolls', B, { name: 'Bob roll' })).json.bankroll.id;
      const r = await post(S, A, past({ bankroll: aOnline, game: 'PLO', stakes: '1-2', buyIn: 200, cashOut: 260, tips: 0, room: 'Dublin' }));
      assert.strictEqual(r.status, 201, r.body);
      assert.deepStrictEqual([r.json.session.bankroll_id, r.json.session.currency, r.json.session.stakes], [aOnline, 'EUR', '1/2']);
    });
    await test('bankroll: another user\'s bankroll id is a 404 and writes nothing', async () => {
      const before = (await get(S, A)).json.sessions.length;
      assert.strictEqual((await post(S, A, past({ bankroll: bOwn }))).status, 404);
      assert.strictEqual((await post(`${S}/start`, A, { buyIn: 100, bankroll: bOwn })).status, 404);
      assert.strictEqual((await get(S, A)).json.sessions.length, before);
    });
    await test('bankroll: ?bankroll= filters main / id, and another user\'s id is a 404', async () => {
      assert.deepStrictEqual((await get(`${S}?bankroll=main`, A)).json.sessions.map((s) => s.id), [s1.id]);
      assert.strictEqual((await get(`${S}?bankroll=${aOnline}`, A)).json.sessions.length, 1);
      assert.strictEqual((await get(`${S}?bankroll=${bOwn}`, A)).status, 404);
      assert.strictEqual((await get(`${S}/stats?bankroll=${bOwn}`, A)).status, 404);
      assert.strictEqual((await get(`${S}/export.csv?bankroll=${bOwn}`, A)).status, 404);
      assert.strictEqual((await get(`${S}?bankroll=x1`, A)).status, 400);
    });
    await test('bankroll: one with cash sessions cannot be deleted (409), archived refuses new sessions', async () => {
      const r = await del(`/api/bankrolls/${aOnline}`, A);
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.json.cash_sessions, 1);
      assert.strictEqual((await put(`/api/bankrolls/${aOnline}`, A, { archived: true })).status, 200);
      assert.strictEqual((await post(S, A, past({ bankroll: aOnline }))).status, 400);
      assert.strictEqual((await put(`/api/bankrolls/${aOnline}`, A, { archived: false })).status, 200);
    });

    // ── the live flow ──
    let live;
    await test('live: none to begin with', async () => {
      const r = await get(`${S}/live`, A);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.session, null);
      assert.ok(r.json.now);
    });
    await test('live: start needs a buy-in; then it runs, server-side', async () => {
      assert.strictEqual((await post(`${S}/start`, A, { game: 'NLH', stakes: '1/3' })).status, 400);
      const r = await post(`${S}/start`, A, { buyIn: 300, game: 'nlh', stakes: '1/3', room: 'Live! Philly', date: '2026-10-11' });
      assert.strictEqual(r.status, 201, r.body);
      live = r.json.session;
      assert.deepStrictEqual([live.live, live.ended_at, live.cash_out, live.net, live.game, live.buy_in], [true, null, null, null, 'NLH', 300]);
      assert.strictEqual((await get(`${S}/live`, A)).json.session.id, live.id);
    });
    await test('live: a second start is a 409 that names the running session', async () => {
      const r = await post(`${S}/start`, A, { buyIn: 100 });
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.json.session.id, live.id);
    });
    await test('live: rebuys add to the buy-in and count', async () => {
      assert.strictEqual((await post(`${S}/${live.id}/rebuy`, A, { amount: 0 })).status, 400);
      await post(`${S}/${live.id}/rebuy`, A, { amount: 300 });
      const r = await post(`${S}/${live.id}/rebuy`, A, { amount: 200 });
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual([r.json.session.buy_in, r.json.session.rebuys], [800, 2]);
    });

    // ── stack updates ──
    let stackA;
    await test('stack: validates the amount and the time', async () => {
      assert.strictEqual((await post(`${S}/${live.id}/stack`, A, {})).status, 400);
      assert.strictEqual((await post(`${S}/${live.id}/stack`, A, { amount: -1 })).status, 400);
      assert.strictEqual((await post(`${S}/${live.id}/stack`, A, { amount: 'lots' })).status, 400);
      assert.strictEqual((await post(`${S}/${live.id}/stack`, A, { amount: 100, at: '2020-01-01T00:00:00Z' })).status, 400);
      assert.strictEqual((await post(`${S}/${live.id}/stack`, A, { amount: 100, at: '2099-01-01T00:00:00Z' })).status, 400);
    });
    await test('stack: 201, each update keeps the buy-in at that moment (result = amount - invested)', async () => {
      const r1 = await post(`${S}/${live.id}/stack`, A, { amount: 650 });
      assert.strictEqual(r1.status, 201, r1.body);
      assert.deepStrictEqual(r1.json.stacks.map((x) => [x.amount, x.invested, x.result]), [[650, 800, -150]]);
      stackA = r1.json.stacks[0].id;
      await post(`${S}/${live.id}/rebuy`, A, { amount: 100 });
      const r2 = await post(`${S}/${live.id}/stack`, A, { amount: 1300 });
      assert.deepStrictEqual(r2.json.stacks.map((x) => [x.amount, x.invested, x.result]), [[650, 800, -150], [1300, 900, 400]]);
      assert.strictEqual(r2.json.session.buy_in, 900);
    });
    await test('stack: /live, a rebuy and GET /:id carry the updates, oldest first', async () => {
      const lv = (await get(`${S}/live`, A)).json;
      assert.deepStrictEqual(lv.stacks.map((x) => x.amount), [650, 1300]);
      const one = await get(`${S}/${live.id}`, A);
      assert.strictEqual(one.status, 200);
      assert.deepStrictEqual([one.json.session.id, one.json.stacks.length], [live.id, 2]);
      assert.strictEqual((await get(`${S}/999999`, A)).status, 404);
    });
    await test('stack: isolation — B cannot read, add to or delete A\'s updates (404)', async () => {
      assert.strictEqual((await get(`${S}/${live.id}`, B)).status, 404);
      assert.strictEqual((await post(`${S}/${live.id}/stack`, B, { amount: 1 })).status, 404);
      assert.strictEqual((await del(`${S}/${live.id}/stacks/${stackA}`, B)).status, 404);
      assert.strictEqual((await get(`${S}/${live.id}`, A)).json.stacks.length, 2);
    });
    await test('stack: delete one; a stack id from another session is a 404', async () => {
      assert.strictEqual((await del(`${S}/${s1.id}/stacks/${stackA}`, A)).status, 404);
      const r = await del(`${S}/${live.id}/stacks/${stackA}`, A);
      assert.strictEqual(r.status, 200, r.body);
      assert.deepStrictEqual(r.json.stacks.map((x) => x.amount), [1300]);
      assert.strictEqual((await del(`${S}/${live.id}/stacks/${stackA}`, A)).status, 404);
      // back to two for the rest of the run, the second being the newer one
      await post(`${S}/${live.id}/stack`, A, { amount: 700 });
    });
    await test('stack: a live session\'s rebuy keeps going: buy-in back to 800 for the tests below', async () => {
      // The rebuy test above fixed the live buy-in at 800 with 2 rebuys; the extra 100 is edited away.
      const r = await put(`${S}/${live.id}`, A, { buyIn: 800, rebuys: 2 });
      assert.strictEqual(r.status, 200, r.body);
      assert.deepStrictEqual([r.json.session.buy_in, r.json.session.rebuys], [800, 2]);
    });
    await test('live: PUT cannot end it (use /end), but can fix its details', async () => {
      assert.strictEqual((await put(`${S}/${live.id}`, A, { cashOut: 10 })).status, 400);
      const r = await put(`${S}/${live.id}`, A, { room: 'Live! Casino Philadelphia', tags: ['tired'] });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.session.live, true);
    });
    await test('live: a live session is not in stats', async () => {
      const st = (await get(`${S}/stats?bankroll=main`, A)).json;
      assert.strictEqual(st.sessions, 1);
      assert.strictEqual(st.live, 1);
    });
    await test('live: end with a cash-out (tips, expenses); a second end is a 409', async () => {
      assert.strictEqual((await post(`${S}/${live.id}/end`, A, {})).status, 400);
      const r = await post(`${S}/${live.id}/end`, A, { cashOut: 1210, tips: 10 });
      assert.strictEqual(r.status, 200, r.body);
      assert.deepStrictEqual([r.json.session.live, r.json.session.net], [false, 400]);
      assert.ok(Date.parse(r.json.session.ended_at) > Date.parse(r.json.session.started_at));
      assert.strictEqual((await post(`${S}/${live.id}/end`, A, { cashOut: 5 })).status, 409);
      assert.strictEqual((await post(`${S}/${live.id}/rebuy`, A, { amount: 5 })).status, 409);
      assert.strictEqual((await get(`${S}/live`, A)).json.session, null);
    });
    await test('stack: an ended session takes no more updates (409) but keeps its record', async () => {
      assert.strictEqual((await post(`${S}/${live.id}/stack`, A, { amount: 5 })).status, 409);
      assert.deepStrictEqual((await get(`${S}/${live.id}`, A)).json.stacks.map((x) => x.amount), [1300, 700]);
      assert.deepStrictEqual((await get(`${S}/live`, A)).json.stacks, []);
    });

    // ── isolation ──
    let bLive;
    await test('isolation: B sees none of A\'s sessions and cannot touch them (404)', async () => {
      assert.deepStrictEqual((await get(S, B)).json.sessions, []);
      assert.strictEqual((await get(`${S}/live`, B)).json.session, null);
      assert.strictEqual((await put(`${S}/${s1.id}`, B, { cashOut: 1 })).status, 404);
      assert.strictEqual((await del(`${S}/${s1.id}`, B)).status, 404);
      assert.strictEqual((await post(`${S}/${s1.id}/rebuy`, B, { amount: 5 })).status, 404);
      assert.strictEqual((await post(`${S}/${s1.id}/end`, B, { cashOut: 5 })).status, 404);
      assert.strictEqual((await get(`${S}/stats`, B)).json.sessions, 0);
      assert.strictEqual((await get(`${S}/export.csv`, B)).body.trim().split('\r\n').length, 1);
    });
    await test('isolation: B\'s live session is invisible to A, and A cannot end or rebuy it', async () => {
      bLive = (await post(`${S}/start`, B, { buyIn: 500, bankroll: bOwn })).json.session;
      assert.strictEqual((await post(`${S}/start`, A, { buyIn: 100 })).status, 201); // A's own start is unaffected
      const aLive = (await get(`${S}/live`, A)).json.session;
      assert.notStrictEqual(aLive.id, bLive.id);
      assert.strictEqual((await post(`${S}/${bLive.id}/end`, A, { cashOut: 0 })).status, 404);
      assert.strictEqual((await post(`${S}/${bLive.id}/rebuy`, A, { amount: 9 })).status, 404);
      assert.strictEqual((await get(`${S}/live`, B)).json.session.buy_in, 500);
      assert.strictEqual((await del(`${S}/${aLive.id}`, A)).status, 200);
    });
    await test('isolation: A cannot move a session into B\'s bankroll', async () => {
      assert.strictEqual((await put(`${S}/${s1.id}`, A, { bankroll: bOwn })).status, 404);
    });

    // ── edit / delete ──
    await test('edit: fields change, the end must stay after the start', async () => {
      assert.strictEqual((await put(`${S}/${s1.id}`, A, { endedAt: '2026-10-01T21:00:00Z' })).status, 400);
      const r = await put(`${S}/${s1.id}`, A, { cashOut: 2000, expenses: 0, stakes: '2-5', bankroll: aOnline });
      assert.strictEqual(r.status, 200, r.body);
      assert.deepStrictEqual([r.json.session.net, r.json.session.bankroll_id, r.json.session.currency], [960, aOnline, 'USD']);
      assert.strictEqual((await put(`${S}/${s1.id}`, A, { bankroll: 'main' })).json.session.bankroll_id, 'main');
    });

    // ── stats ──
    await test('stats: net, hours, hourly, win/loss, biggest, per stakes/game/room', async () => {
      await post(S, A, past({ startedAt: '2026-10-07T18:00:00Z', endedAt: '2026-10-07T20:00:00Z', date: '2026-10-07', buyIn: 1000, cashOut: 0, tips: 0, room: 'Borgata' }));
      const st = (await get(`${S}/stats?bankroll=main`, A)).json;
      assert.strictEqual(st.currency, 'USD');
      assert.strictEqual(st.sessions, 3);
      assert.strictEqual(st.overall.net, 960 + 400 - 1000);
      assert.deepStrictEqual([st.overall.wins, st.overall.losses], [2, 1]);
      assert.strictEqual(st.overall.biggest_win.amount, 960);
      assert.strictEqual(st.overall.biggest_loss.amount, -1000);
      assert.ok(st.overall.hourly !== null);
      const borgata = st.byRoom.find((g) => g.label === 'Borgata');
      assert.deepStrictEqual([borgata.sessions, borgata.hours, borgata.net], [2, 8, -40]);
      assert.ok(st.byStakes.some((g) => g.label === 'NLH 2/5'));
      assert.ok(st.byStakes.some((g) => g.label === 'NLH 1/3'));
    });
    await test('stats: mixed currencies total in USD by default, or in ?currency=', async () => {
      const all = (await get(`${S}/stats`, A)).json;
      assert.strictEqual(all.currency, 'USD');
      assert.strictEqual(all.mixed, true);
      assert.strictEqual(all.sessions, 4);
      const eur = (await get(`${S}/stats?currency=eur&bankroll=${aOnline}`, A)).json;
      assert.deepStrictEqual([eur.currency, eur.mixed, eur.overall.net], ['EUR', false, 60]);
      assert.strictEqual((await get(`${S}/stats?currency=XYZ`, A)).status, 400);
    });

    // ── CSV ──
    await test('csv: text/csv, a header and one line per session, filtered by bankroll', async () => {
      const r = await get(`${S}/export.csv`, A);
      assert.strictEqual(r.status, 200);
      assert.ok(/text\/csv/.test(r.headers['content-type']));
      const lines = r.body.trim().split('\r\n');
      assert.strictEqual(lines[0].split(',')[0], 'id');
      assert.strictEqual(lines.length, 1 + 4);
      assert.strictEqual((await get(`${S}/export.csv?bankroll=${aOnline}`, A)).body.trim().split('\r\n').length, 2);
    });

    await test('delete: the session goes; a second delete is a 404', async () => {
      assert.strictEqual((await del(`${S}/${s1.id}`, A)).status, 200);
      assert.strictEqual((await del(`${S}/${s1.id}`, A)).status, 404);
      assert.ok(!(await get(S, A)).json.sessions.some((s) => s.id === s1.id));
    });
    await test('delete: a session\'s stack updates go with it', async () => {
      assert.strictEqual((await del(`${S}/${live.id}`, A)).status, 200);
      assert.strictEqual((await get(`${S}/${live.id}`, A)).status, 404);
      deletedLiveId = live.id;
    });
  } finally { await down(child); }

  await test('delete: no stack row is left for the deleted session (read from the saved DB)', async () => {
    assert.ok(deletedLiveId);
    const after = new SQL.Database(fs.readFileSync(dbPath));
    try {
      const n = after.exec('SELECT COUNT(*) FROM cash_session_stacks WHERE session_id = ?', [deletedLiveId])[0].values[0][0];
      assert.strictEqual(n, 0);
    } finally { after.close(); }
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
