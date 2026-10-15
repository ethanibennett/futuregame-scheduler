// Phase 9 of the bankroll merge (docs/bankroll-merge.md §11): the owner API through the real server,
// plus the ported session-log cases (the dashboard's session-log.test.js, the refusals above all).
//
//   node test/owner-api.test.js        (npm run test:owner-api)
//
// Boots server.js on scratch ports 4690-4699 against a scratch DB (never poker-tournaments.db) with
// production secrets scrubbed and LEDGER_TOKEN set only here, to a value made up for this run.
// Every name, token and figure is invented.
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const { createScratch, boot, sqlJs, one, rowsOf, runner } = require('./helpers/scratch-server');
const { normalizeSession, describeSession, sessionId, MAX_HOURS } = require('../lib/owner-api/session-log');
const { checkLedgerToken } = require('../lib/owner-api');

const PORTS = [4690, 4699];
const PW = 'owner-api-test-password-1';
const LEDGER = crypto.randomBytes(32).toString('hex');
const PREVIOUS = crypto.randomBytes(32).toString('hex');
const lastId = (db) => db.exec('SELECT last_insert_rowid()')[0].values[0][0];

(async () => {
  const { test, done } = runner('owner-api.test.js');

  // ── the ported unit cases: refusals first ──
  console.log('normalizeSession (ported)');
  const NOW = new Date('2026-09-09T15:00:00Z');
  const good = (over = {}) => ({ date: '2026-09-08', channel: 'live', isMTT: false, format: 'PLO', gameLabel: '2/5 PLO', venue: 'Parx', buyInTotal: 300, cashOut: 1150, hours: 5, ...over });
  const hasError = (res, needle) => res.ok === false && res.errors.some((e) => e.includes(needle));
  await test('the happy path, and the result computed rather than trusted', () => {
    const r = normalizeSession(good(), NOW);
    assert.ok(r.ok);
    assert.strictEqual(r.session.result, 850);
    assert.strictEqual(normalizeSession(good({ format: 'plo8' }), NOW).session.format, 'PLO8');
    assert.strictEqual(normalizeSession(good({ buyInTotal: '$1,200' }), NOW).session.buyInTotal, 1200);
    assert.strictEqual(normalizeSession(good({ cashOut: 0 }), NOW).session.result, -300);
    assert.strictEqual(normalizeSession(good({ cashOut: 1150.55 }), NOW).session.result, 850.55);
    assert.ok(normalizeSession(good({ result: 850 }), NOW).ok);
    assert.strictEqual(r.session.id, sessionId(r.session));
    assert.strictEqual(normalizeSession(good(), NOW).session.id, r.session.id, 'the same facts give the same id');
    assert.match(describeSession(r.session), /2026-09-08 · Parx · 2\/5 PLO · in \$300, out \$1,150, 5h → \+\$850/);
  });
  await test('the refusals: every missing or absurd field is named', () => {
    assert.ok(hasError(normalizeSession(good({ format: undefined }), NOW), 'format'));
    assert.ok(hasError(normalizeSession(good({ format: 'omaha hi-lo' }), NOW), 'not one of'));
    assert.ok(hasError(normalizeSession(good({ venue: '' }), NOW), 'venue'));
    assert.ok(hasError(normalizeSession(good({ gameLabel: undefined }), NOW), 'gameLabel'));
    assert.ok(hasError(normalizeSession(good({ buyInTotal: undefined }), NOW), 'buyInTotal'));
    assert.ok(hasError(normalizeSession(good({ cashOut: undefined }), NOW), 'cashOut'));
    assert.ok(hasError(normalizeSession(good({ hours: undefined }), NOW), 'hours'));
    assert.ok(hasError(normalizeSession(good({ buyInTotal: 'a few hundred' }), NOW), 'buyInTotal'));
    assert.ok(hasError(normalizeSession(good({ buyInTotal: -100 }), NOW), 'negative'));
    assert.ok(hasError(normalizeSession(good({ hours: 0 }), NOW), 'greater than 0'));
    assert.ok(hasError(normalizeSession(good({ hours: 30 }), NOW), `exceeds ${MAX_HOURS}`));
    assert.ok(hasError(normalizeSession(good({ cashOut: 99000000 }), NOW), 'sanity cap'));
    assert.ok(hasError(normalizeSession(good({ channel: 'casino' }), NOW), 'live or online'));
    assert.ok(hasError(normalizeSession(good({ date: 'last tuesday' }), NOW), 'YYYY-MM-DD'));
    assert.ok(hasError(normalizeSession(good({ moodRating: 9 }), NOW), 'moodRating'));
    assert.ok(hasError(normalizeSession(good({ hands: 12.5 }), NOW), 'hands'));
    assert.ok(hasError(normalizeSession(good({ tags: 'notalist' }), NOW), 'tags'));
    assert.ok(hasError(normalizeSession(good({ result: 900 }), NOW), 'one of the three numbers is wrong'));
  });
  await test('the defaults are noted, never silent; an MTT with no entries is one entry', () => {
    const r = normalizeSession(good({ date: undefined, channel: undefined }), NOW);
    assert.ok(r.ok);
    assert.strictEqual(r.session.date, '2026-09-09');
    assert.ok(r.notes.some((n) => n.startsWith('date defaulted to today')));
    assert.ok(r.notes.includes('channel defaulted to live'));
    const m = normalizeSession(good({ isMTT: true, gameLabel: 'Sunday Major' }), NOW);
    assert.deepStrictEqual([m.session.entries, m.notes.includes('entries defaulted to 1')], [1, true]);
    assert.strictEqual(normalizeSession(good({ date: '2026-09-08T03:00:00Z' }), NOW).session.date, '2026-09-07', 'a timestamp lands on its New York day');
  });
  await test('the ledger token check: shape, unset, previous', () => {
    assert.deepStrictEqual(checkLedgerToken(LEDGER, {}), { ok: false, via: null, why: 'unset' });
    assert.deepStrictEqual(checkLedgerToken(LEDGER, { LEDGER_TOKEN: 'short' }), { ok: false, via: null, why: 'unset' });
    assert.deepStrictEqual(checkLedgerToken(LEDGER, { LEDGER_TOKEN: LEDGER }), { ok: true, via: 'current' });
    assert.deepStrictEqual(checkLedgerToken(PREVIOUS, { LEDGER_TOKEN: LEDGER, LEDGER_TOKEN_PREVIOUS: PREVIOUS }), { ok: true, via: 'previous' });
    assert.strictEqual(checkLedgerToken('not a token!', { LEDGER_TOKEN: LEDGER }).ok, false);
  });

  // ── the routes ──
  const scratch = await createScratch({ ports: PORTS, prefix: 'fg-owner-api-' });
  const servers = [];
  const S = await sqlJs();
  const q = (sql, args = []) => { const d = new S.Database(fs.readFileSync(scratch.dbPath)); try { return rowsOf(d, sql, args); } finally { d.close(); } };
  try {
    let srv = await boot(scratch.dbPath, {}, { ports: PORTS });
    servers.push(srv);
    try {
      const r = await fetch(`http://127.0.0.1:${srv.port}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'adminx', email: 'adminx@x.test', password: PW, realName: 'adminx' }) });
      assert.strictEqual(r.status, 201);
    } finally { await srv.stop(); }
    // 503 while the owner is unresolved (no CONSOLE_OWNER_USER_ID, no 'ham')
    console.log('the gate');
    srv = await boot(scratch.dbPath, { LEDGER_TOKEN: LEDGER }, { ports: PORTS });
    servers.push(srv);
    const call = (p, { token = LEDGER, method = 'GET', body } = {}) => fetch(`http://127.0.0.1:${srv.port}${p}`, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) { /* */ } return { status: r.status, json, text, headers: r.headers }; });
    await test('503 while the owner is unresolved; 404 without a token, with a wrong one, or in a query string', async () => {
      assert.strictEqual((await call('/api/owner/money')).status, 503);
      assert.strictEqual((await call('/api/owner/money', { token: null })).status, 404);
      assert.strictEqual((await call('/api/owner/money', { token: crypto.randomBytes(32).toString('hex') })).status, 404);
      assert.strictEqual((await call(`/api/owner/money?token=${LEDGER}`, { token: null })).status, 404);
    });
    await srv.stop();
    const db = scratch.open();
    db.run("UPDATE users SET username = 'ham' WHERE username = 'adminx'");
    const ham = one(db, "SELECT id FROM users WHERE username = 'ham'");
    // a fund bankroll, a standing backer staked in PLO, a feed tournament result already here
    db.run("INSERT INTO bankrolls (user_id, name, currency, starting_balance, role, in_roll, target_amount, target_date, created_at) VALUES (?, 'WSOP fund', 'USD', 1000, 'fund', 0, 65000, '2027-05-03', '2026-05-01T00:00:00Z')", [ham]);
    const fundId = lastId(db);
    db.run("INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, occurred_on, note, created_at) VALUES (?, NULL, 'deposit', 5000, '2026-06-01', 'seed', '2026-06-01T00:00:00Z')", [ham]);
    db.run('INSERT INTO backers (user_id, name, public_token, notify_sms, notify_email) VALUES (?, ?, ?, 0, 0)', [ham, 'Sam Owner', 'SamOwner001']);
    const sam = lastId(db);
    db.run("INSERT INTO standing_agreements (user_id, backer_id, effective_from, status, opening_cents, created_at) VALUES (?, ?, '2026-01-01', 'active', 0, '2026-01-01T00:00:00Z')", [ham, sam]);
    db.run("INSERT INTO standing_stakes (agreement_id, format, channel, pct, valid_from, created_at) VALUES (?, 'PLO', 'any', 20, '2026-01-01', '2026-01-01T00:00:00Z')", [lastId(db)]);
    db.run(`INSERT INTO tournaments (event_number, event_name, date, time, buyin, game_variant, venue, property, is_online, notes) VALUES ('', '$600 NLH', '2026-08-10', '12:00 PM', 600, 'NLH', 'Test Series', 'Borgata', 0, '')`);
    const t1 = lastId(db);
    db.run('INSERT INTO tracking_entries (user_id, tournament_id, num_entries, cashed, cash_amount, bankroll_id) VALUES (?, ?, 1, 1, 2400, ?)', [ham, t1, fundId]);
    db.run(`INSERT INTO cash_sessions (user_id, bankroll_id, started_at, ended_at, session_date, room, game, stakes, buy_in, rebuys, cash_out, tips, expenses, currency, created_at)
            VALUES (?, NULL, '2026-10-14T20:00:00Z', NULL, '2026-10-14', 'Parx', 'NLH', '2/5', 500, 0, NULL, 0, 0, 'USD', '2026-10-14T00:00:00Z')`, [ham]); // live: never listed
    scratch.save(db);
    db.close();

    srv = await boot(scratch.dbPath, { LEDGER_TOKEN: LEDGER, LEDGER_TOKEN_PREVIOUS: PREVIOUS, CONSOLE_OWNER_USER_ID: String(ham), BACKER_PAGE_SOURCE: 'sql' }, { ports: PORTS });
    servers.push(srv);
    const login = async () => (await call('/api/login', { token: null, method: 'POST', body: { email: 'adminx@x.test', password: PW } })).json.token;
    const jwtTok = await login();

    console.log('GET /money');
    let moneyBody = null;
    await test('/money: the roll and the fund equal the ledger summary, the fund result is flagged, the live session is absent, no-store', async () => {
      const r = await call('/api/owner/money');
      assert.strictEqual(r.status, 200, r.text);
      assert.strictEqual(r.headers.get('cache-control'), 'no-store');
      moneyBody = r.json;
      const sum = (await call('/api/bankrolls/summary', { token: jwtTok })).json;
      assert.strictEqual(moneyBody.roll, sum.bankrolls.filter((b) => b.id !== fundId).reduce((s, b) => s + b.balance, 0));
      assert.strictEqual(moneyBody.wsopFund, sum.bankrolls.find((b) => b.id === fundId).balance);
      assert.strictEqual(moneyBody.wsopFund, 2800, 'the fund: 1,000 start + 1,800 net');
      assert.strictEqual(moneyBody.roll, 5000);
      assert.deepStrictEqual([moneyBody.fund.target, moneyBody.fund.targetDate, moneyBody.fund.firstActivityDate], [65000, '2027-05-03', '2026-08-10']);
      assert.strictEqual(moneyBody.sessions.length, 1, 'the live cash session is not a session yet');
      const s = moneyBody.sessions[0];
      assert.deepStrictEqual([s.id, s.isMTT, s.format, s.channel, s.buyInTotal, s.cashOut, s.result, s.isWsopFund, s.venue], [`te:${q('SELECT id FROM tracking_entries')[0].id}`, true, 'NLH', 'live', 600, 2400, 1800, true, 'Borgata']);
      assert.ok(moneyBody.bankrolls.find((b) => b.isFund).inRoll === false);
      assert.strictEqual((await call('/api/owner/money', { token: PREVIOUS })).status, 200, 'the previous token is accepted inbound');
    });
    await test('?since= limits the sessions, never the totals', async () => {
      const r = (await call('/api/owner/money?since=2027-01-01')).json;
      assert.deepStrictEqual([r.sessions.length, r.roll, r.wsopFund], [0, 5000, 2800]);
      assert.strictEqual((await call('/api/owner/money?since=2026-09-01')).json.sessions.length, 1, 'a row created after the day counts, as the rollback list needs');
    });

    console.log('POST /sessions/log');
    const sess = { date: '2026-10-12', channel: 'live', isMTT: false, format: 'PLO', gameLabel: '5/5/10 PLO', venue: 'Parx', buyInTotal: 1000, cashOut: 2240, hours: 5.2 };
    let logged = null;
    await test('the preview writes nothing and shows the summary, the roll after and the backer cuts', async () => {
      const before = q("SELECT COUNT(*) AS n FROM cash_sessions")[0].n;
      const r = await call('/api/owner/sessions/log', { method: 'POST', body: { session: sess } });
      assert.strictEqual(r.status, 200, r.text);
      assert.deepStrictEqual([r.json.ok, r.json.dryRun, r.json.replacesExisting, r.json.rollBefore, r.json.rollAfter], [true, true, false, 5000, 6240]);
      assert.match(r.json.summary, /2026-10-12 · Parx · 5\/5\/10 PLO · in \$1,000, out \$2,240, 5.2h → \+\$1,240/);
      assert.deepStrictEqual(r.json.backerCuts, [{ name: 'Sam Owner', pct: 20, shareCents: 24800 }]);
      assert.strictEqual(q("SELECT COUNT(*) AS n FROM cash_sessions")[0].n, before);
    });
    await test('a bad session is refused with its errors; the flat form is accepted', async () => {
      const r = await call('/api/owner/sessions/log', { method: 'POST', body: { session: { ...sess, result: 999 } } });
      assert.strictEqual(r.status, 400);
      assert.ok(r.json.errors.some((e) => e.includes('one of the three numbers')));
      assert.strictEqual((await call('/api/owner/sessions/log', { method: 'POST', body: { ...sess } })).status, 200);
    });
    await test('the commit writes once: a cash session with time_known 0, its extras and its key; the roll moves', async () => {
      const r = await call('/api/owner/sessions/log', { method: 'POST', body: { session: sess, commit: true } });
      assert.strictEqual(r.status, 201, r.text);
      logged = r.json;
      assert.deepStrictEqual([r.json.committed, r.json.created, r.json.ref.table, r.json.rollAfter], [true, true, 'cash_sessions', 6240]);
      const row = q('SELECT * FROM cash_sessions WHERE id = ?', [r.json.ref.id])[0];
      assert.deepStrictEqual([row.time_known, row.buy_in, row.cash_out, row.room, row.session_date], [0, 1000, 2240, 'Parx', '2026-10-12']);
      const ex = q("SELECT * FROM session_extras WHERE ref_table = 'cash_sessions' AND ref_id = ?", [r.json.ref.id])[0];
      assert.deepStrictEqual([ex.format, ex.channel, ex.origin, ex.origin_id], ['PLO', 'live', 'chat', r.json.session.id]);
      assert.strictEqual(q('SELECT ref_id FROM bankroll_import_keys WHERE fingerprint = ?', [r.json.session.id])[0].ref_id, r.json.ref.id);
      assert.strictEqual((await call('/api/owner/money')).json.roll, 6240);
    });
    await test('the same facts twice update one row; a changed figure follows into it', async () => {
      const again = await call('/api/owner/sessions/log', { method: 'POST', body: { session: sess, commit: true } });
      assert.strictEqual(again.status, 200);
      assert.deepStrictEqual([again.json.replacesExisting, again.json.created, again.json.ref.id], [true, false, logged.ref.id]);
      assert.strictEqual(q("SELECT COUNT(*) AS n FROM cash_sessions WHERE room = 'Parx' AND time_known = 0")[0].n, 1);
      const moved = await call('/api/owner/sessions/log', { method: 'POST', body: { session: { ...sess, id: logged.session.id, cashOut: 2000 }, commit: true } });
      assert.strictEqual(moved.status, 200);
      assert.strictEqual(q('SELECT cash_out FROM cash_sessions WHERE id = ?', [logged.ref.id])[0].cash_out, 2000);
      assert.strictEqual((await call('/api/owner/money')).json.roll, 6000);
    });
    await test('a kind change on the same id is a 409; an MTT lands as a Personal event with its entry', async () => {
      const r = await call('/api/owner/sessions/log', { method: 'POST', body: { session: { ...sess, id: logged.session.id, isMTT: true }, commit: true } });
      assert.strictEqual(r.status, 409);
      const m = await call('/api/owner/sessions/log', { method: 'POST', body: { session: { date: '2026-10-11', format: 'NLH', gameLabel: 'Sunday Major', venue: 'Borgata', buyInTotal: 1200, cashOut: 0, hours: 6, isMTT: true, entries: 2, isWsopFund: true }, commit: true } });
      assert.strictEqual(m.status, 201, m.text);
      assert.strictEqual(m.json.ref.table, 'tracking_entries');
      const te = q('SELECT te.*, t.venue, t.buyin, t.event_name FROM tracking_entries te JOIN tournaments t ON t.id = te.tournament_id WHERE te.id = ?', [m.json.ref.id])[0];
      assert.deepStrictEqual([te.venue, te.buyin, te.num_entries, te.cash_amount, te.bankroll_id, te.event_name], ['Personal', 600, 2, 0, fundId, 'Sunday Major']);
      const money = (await call('/api/owner/money')).json;
      assert.strictEqual(money.wsopFund, 1600, '2,800 less the 1,200 fund bust');
      assert.strictEqual(money.sessions.find((s) => s.id === `te:${m.json.ref.id}`).isWsopFund, true);
    });
    await test('60 a minute per IP, then 429', async () => {
      let last = 200;
      for (let i = 0; i < 70 && last !== 429; i++) last = (await call('/api/owner/money?since=2027-01-01')).status;
      assert.strictEqual(last, 429);
    });
  } catch (e) {
    console.log('  FAIL (setup)', e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n       ') : e);
    process.exitCode = 1;
  } finally {
    for (const s of servers) await s.stop().catch(() => {});
    scratch.cleanup();
  }
  if (process.exitCode) { process.stdout.write('\nowner-api.test.js - setup failed\n', () => process.exit(1)); return; }
  done();
})();
