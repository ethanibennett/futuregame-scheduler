// The Notify tap (POST /api/staking/standing/notify, lib/staking/notify.js) through the real server:
// who may ask, the preview, the tap, a second tap, an edit and a delete after it (silent, with a
// revision row), the dashboard-overlap and series warnings and their confirm, the cash share's
// net-after-tips basis, a EUR result, a result nobody is staked in, the page and the Backers view
// after it, and delivery: never attempted where BACKER_DELIVERY is off, once per backer where on.
//
//   node test/notify-tap.test.js        (npm run test:notify-tap)
//
// Boots server.js on scratch ports 4600-4609 (never 3001) against scratch DBs in a temp dir (never
// poker-tournaments.db), production secrets scrubbed (test/helpers/scratch-server.js). Web push and
// Twilio are stubbed by test/stub-delivery-preload.js, which logs `[delivery-stub] push|sms` for
// every attempt and lets nothing leave the machine; VAPID_* and TWILIO_* get made-up values so the
// senders get past "not configured" and only the BACKER_DELIVERY gate decides. Every token, name,
// number and figure is invented.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createScratch, boot, sqlJs, one, rowsOf, runner } = require('./helpers/scratch-server');
const notify = require('../lib/staking/notify');
const { shareCents } = require('../lib/staking/standing');

const PORTS = [4600, 4609];
const STUB = path.join(__dirname, 'stub-delivery-preload.js');
const PW = 'notify-tap-test-password-1';
const CONFIGURED = { VAPID_PUBLIC_KEY: 'stub-public', VAPID_PRIVATE_KEY: 'stub-private', TWILIO_ACCOUNT_SID: 'ACstub', TWILIO_AUTH_TOKEN: 'stub', TWILIO_FROM: '+15555550000' };
const TOK = { sam: 'SamOkafor01', priya: 'PriyaRam001', dan: 'DanWhit0001', mo: 'MoChen00001', lee: 'LeeSql00001', gone: 'GoneDash001' };
const SMS = { sam: '+15555550101', dan: '+15555550103', lee: '+15555550109' };

const lastId = (db) => db.exec('SELECT last_insert_rowid()')[0].values[0][0];

/** The world, written into a database whose schema is the real one. -> ids */
function seed(db, { ham, plain }) {
  const roster = (id, rec, deleted = 0) => db.run("INSERT INTO console_records (store, id, data, updated_at, deleted) VALUES ('backers', ?, ?, 1000, ?)",
    [id, JSON.stringify({ id, createdAt: 1, ...rec }), deleted]);
  roster('r-sam', { token: TOK.sam, name: 'Sam Okafor', opening: 500, delivery: { sms: SMS.sam },
    stakes: [{ format: 'PLO', channel: 'any', pct: 20 }, { format: 'NLH', channel: 'live', pct: 10 }] });
  roster('r-priya', { token: TOK.priya, name: 'Priya Raman', opening: 0, delivery: { email: 'priya@example.test' },
    stakes: [{ format: 'all', channel: 'online', pct: 15 }] });
  roster('r-dan', { token: TOK.dan, name: 'Dan Whitcombe', opening: 0, delivery: { sms: SMS.dan },
    stakes: [{ format: 'PLO', channel: 'live', pct: 25 }] });
  roster('r-mo', { token: TOK.mo, name: 'Mo Chen', opening: -250, delivery: {},
    stakes: [{ format: 'NLH', channel: 'any', pct: 12.5 }] });
  roster('r-gone', { token: TOK.gone, name: 'Gone Backer', opening: 0, stakes: [{ format: 'all', channel: 'any', pct: 50 }] }, 1);
  for (const t of [TOK.sam, TOK.dan, TOK.mo]) {
    db.run('INSERT INTO backer_push_subs (token, endpoint, keys_p256dh, keys_auth) VALUES (?, ?, ?, ?)', [t, `https://push.example.test/${t}/1`, 'p256dh-test', 'auth-test']);
  }
  // Dashboard-era history: a share each for Sam and Mo in September, and Dan's share of the PLO night
  // of Oct 11, which the dashboard has already notified.
  const dash = (token, sid, date, game, result, pct, share) => db.run(`INSERT INTO backer_events
      (id, token, session_id, ts, date, game, venue, hours, session_result_cents, pct, share_cents, source, notified_share_cents, notified_at)
      VALUES (?, ?, ?, ?, ?, ?, 'Borgata', 5, ?, ?, ?, 'dashboard', ?, ?)`,
  [`${token}:${sid}`, token, sid, Date.parse(date + 'T23:00:00Z'), date, game, result, pct, share, share, Date.parse(date + 'T23:00:00Z')]);
  dash(TOK.sam, '0b9c2f3e-1111-4a5b-9c8d-000000000001', '2026-09-01', '5/5/10 PLO', 50000, 20, 10000);
  dash(TOK.mo, '0b9c2f3e-1111-4a5b-9c8d-000000000002', '2026-09-02', '2/5 NLH', -40000, 12.5, -5000);
  dash(TOK.dan, '0b9c2f3e-1111-4a5b-9c8d-000000000003', '2026-10-11', 'PLO MTT', -20000, 25, -5000);

  const T = (name, date, buyin, game, venue, property) => {
    db.run(`INSERT INTO tournaments (event_number, event_name, date, time, buyin, game_variant, venue, property, is_online, notes)
            VALUES ('', ?, ?, '12:00 PM', ?, ?, ?, ?, 0, '')`, [name, date, buyin, game, venue, property]);
    return lastId(db);
  };
  const TE = (user, tid, { entries = 1, cashed = 0, cash = 0 } = {}) => {
    db.run('INSERT INTO tracking_entries (user_id, tournament_id, num_entries, cashed, cash_amount) VALUES (?, ?, ?, ?, ?)', [user, tid, entries, cashed, cash]);
    return lastId(db);
  };
  const t1 = T('$600 NLH Deepstack', '2026-10-10', 600, 'NLH', 'Test Series', 'Borgata');
  const t2 = T('$1,000 PLO', '2026-10-11', 1000, 'PLO', 'Test Series', 'Borgata');
  const t3 = T('$400 Razz', '2026-10-12', 400, 'Razz', 'Test Series', 'Borgata');
  const t4 = T('€1,100 NLH Main Event', '2026-10-09', 1100, 'NLH', 'WSOP Europe', "King's Resort");
  const t5 = T('$300 NLH', '2026-10-10', 300, 'NLH', 'Test Series', 'Borgata');
  const ids = {
    te1: TE(ham, t1, { cashed: 1, cash: 2400 }), // +1,800
    te2: TE(ham, t2),                             // -1,000
    te3: TE(ham, t3),                             // -400, nobody staked in Razz live
    te4: TE(ham, t4, { cashed: 1, cash: 5000 }), // +EUR 3,900
    tePlain: TE(plain, t5, { cashed: 1, cash: 900 }),
    t2,
  };
  const CS = (o) => {
    db.run(`INSERT INTO cash_sessions (user_id, bankroll_id, started_at, ended_at, session_date, room, game, stakes, buy_in, rebuys, cash_out, tips, expenses, currency, created_at)
            VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'USD', '2026-10-08T00:00:00Z')`,
    [ham, o.start, o.end, o.day, o.room, o.game, o.stakes, o.buyIn, o.cashOut, o.tips || 0, o.expenses || 0]);
    return lastId(db);
  };
  // Net after tips and expenses: 1,800 - 1,000 - 40 - 60 = +700 (the table did +800).
  ids.cs1 = CS({ start: '2026-10-08T22:00:00Z', end: '2026-10-09T03:00:00Z', day: '2026-10-08', room: 'Parx Casino', game: 'NLH', stakes: '2/5', buyIn: 1000, cashOut: 1800, tips: 40, expenses: 60 });
  ids.cs2 = CS({ start: '2026-10-14T20:00:00Z', end: null, day: '2026-10-14', room: 'Parx Casino', game: 'NLH', stakes: '2/5', buyIn: 500, cashOut: null });

  // Q7: the PLO event is also in a series agreement, for a backer of the same name as a standing one.
  db.run("INSERT INTO staking_series (user_id, name, currency, status) VALUES (?, 'Fall Series', 'USD', 'active')", [ham]);
  const series = lastId(db);
  db.run("INSERT INTO backers (user_id, name) VALUES (?, 'Dan Whitcombe')", [ham]);
  const danSeries = lastId(db);
  db.run("INSERT INTO backer_agreements (series_id, backer_id, backer_type, percentage, is_active) VALUES (?, ?, 'pay_per_play', 10, 1)", [series, danSeries]);
  db.run("INSERT INTO backer_event_status (agreement_id, tournament_id, status) VALUES (?, ?, 'played')", [lastId(db), t2]);

  // The merged roster (read only under BACKER_PAGE_SOURCE=sql): Lee, on no roster record, and a row
  // that owns Mo's token with a different stake.
  const sqlBacker = (name, token, phone, stake) => {
    db.run('INSERT INTO backers (user_id, name, phone, public_token, notify_sms, notify_email) VALUES (?, ?, ?, ?, ?, 0)', [ham, name, phone, token, phone ? 1 : 0]);
    const id = lastId(db);
    db.run("INSERT INTO standing_agreements (user_id, backer_id, effective_from, status, opening_cents, created_at) VALUES (?, ?, '2026-01-01', 'active', 0, '2026-01-01T00:00:00Z')", [ham, id]);
    db.run("INSERT INTO standing_stakes (agreement_id, format, channel, pct, valid_from, created_at) VALUES (?, ?, ?, ?, '2026-01-01', '2026-01-01T00:00:00Z')", [lastId(db), stake.format, stake.channel, stake.pct]);
    return id;
  };
  ids.leeId = sqlBacker('Lee Park', TOK.lee, SMS.lee, { format: 'NLH', channel: 'live', pct: 30 });
  ids.moSqlId = sqlBacker('Mo Chen', TOK.mo, null, { format: 'NLH', channel: 'any', pct: 5 });
  return ids;
}

(async () => {
  const { test, done } = runner('notify-tap.test.js');
  const scratch = await createScratch({ ports: PORTS, prefix: 'fg-notify-tap-' });
  const servers = [];
  const S = await sqlJs();
  const readDb = (file) => new S.Database(fs.readFileSync(file));
  try {
    // ── accounts: the owner (ham), another admin (ham5), an ordinary user ──
    let srv = await boot(scratch.dbPath, {}, { ports: PORTS });
    servers.push(srv);
    try {
      for (const [u, e] of [['adminx', 'adminx@x.test'], ['otheradmin', 'otheradmin@x.test'], ['plainuser', 'plainuser@x.test']]) {
        const r = await fetch(`http://127.0.0.1:${srv.port}/api/register`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, email: e, password: PW, realName: u }),
        });
        assert.strictEqual(r.status, 201, `register ${u}`);
      }
    } finally { await srv.stop(); }

    const db = scratch.open();
    db.run("UPDATE users SET username = 'ham' WHERE username = 'adminx'");        // sign-up reserves the admin names
    db.run("UPDATE users SET username = 'ham5' WHERE username = 'otheradmin'");
    const ham = one(db, "SELECT id FROM users WHERE username = 'ham'");
    const plain = one(db, "SELECT id FROM users WHERE username = 'plainuser'");
    const ids = seed(db, { ham, plain });
    scratch.save(db);
    db.close();

    const phaseDb = (name) => { const f = path.join(scratch.tmp, name + '.db'); fs.copyFileSync(scratch.dbPath, f); return f; };
    const api = (s, p, { token, method = 'GET', body } = {}) => fetch(`http://127.0.0.1:${s.port}${p}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) { /* html */ } return { status: r.status, text, json }; });
    const login = async (s, email) => (await api(s, '/api/login', { method: 'POST', body: { email, password: PW } })).json.token;
    const tap = (s, token, refTable, refId, extra = {}) => api(s, '/api/staking/standing/notify', { token, method: 'POST', body: { refTable, refId, ...extra } });
    const preview = (s, token, refTable, refId) => tap(s, token, refTable, refId, { preview: true });
    const commit = (s, token, refTable, refId, extra = {}) => tap(s, token, refTable, refId, { preview: false, ...extra });
    const feed = async (s, token) => (await api(s, `/api/backer/${token}/feed`)).json;
    const byName = (body, name) => (body.backers || []).find((b) => b.name === name);
    const stubLines = (s, kind) => s.log().split('\n').filter((l) => l.includes(`[delivery-stub] ${kind}`));
    const noSecrets = (text) => {
      for (const t of Object.values(TOK)) assert.ok(!text.includes(t), 'a token is in the answer');
      assert.ok(!/fg-(te|cs)-\d/.test(text), 'an event id is in the answer');
      for (const n of Object.values(SMS)) assert.ok(!text.includes(n), 'a phone number is in the answer');
    };
    const revisions = (file, where = '1 = 1', args = []) => { const d = readDb(file); try { return rowsOf(d, `SELECT * FROM backer_event_revisions WHERE ${where} ORDER BY id`, args); } finally { d.close(); } };
    const ledgerRows = (file) => { const d = readDb(file); try { return rowsOf(d, "SELECT * FROM backer_events WHERE source = 'ledger' ORDER BY id"); } finally { d.close(); } };

    // ══ A. delivery OFF (BACKER_DELIVERY=0), push and SMS configured and stubbed ══════════
    console.log('A. BACKER_DELIVERY=0: the tap records, nobody is messaged');
    {
      const file = phaseDb('a');
      srv = await boot(file, { BACKER_DELIVERY: '0', ...CONFIGURED }, { ports: PORTS, preloads: [STUB] });
      servers.push(srv);
      try {
        const owner = await login(srv, 'adminx@x.test');
        const other = await login(srv, 'otheradmin@x.test');
        const user = await login(srv, 'plainuser@x.test');

        await test('the gate: no session 401, an ordinary user 403, another admin 403, and none of them gets a figure', async () => {
          const anon = await tap(srv, null, 'tracking_entries', ids.te1);
          assert.strictEqual(anon.status, 401);
          const u = await preview(srv, user, 'tracking_entries', ids.te1);
          assert.strictEqual(u.status, 403);
          const o = await preview(srv, other, 'tracking_entries', ids.te1);
          assert.strictEqual(o.status, 403);
          const oc = await commit(srv, other, 'tracking_entries', ids.te1);
          assert.strictEqual(oc.status, 403);
          for (const r of [u, o, oc]) assert.ok(!/Cents|backers/.test(r.text), 'no block in a refusal');
        });

        await test('owner scoping and input: another user\'s result 404, a bad table or id 400, a live session 409', async () => {
          assert.strictEqual((await preview(srv, owner, 'tracking_entries', ids.tePlain)).status, 404);
          assert.strictEqual((await commit(srv, owner, 'tracking_entries', ids.tePlain)).status, 404);
          assert.strictEqual((await preview(srv, owner, 'tracking_entries', 999999)).status, 404);
          assert.strictEqual((await preview(srv, owner, 'tournaments', ids.te1)).status, 400);
          assert.strictEqual((await preview(srv, owner, 'tracking_entries', 'x')).status, 400);
          const live = await preview(srv, owner, 'cash_sessions', ids.cs2);
          assert.strictEqual(live.status, 409);
          assert.strictEqual(live.json.live, true);
        });

        let samBefore, moBefore;
        await test('preview: every staked backer with their pct and share, from the server\'s own figures; nothing written', async () => {
          samBefore = await feed(srv, TOK.sam);
          moBefore = await feed(srv, TOK.mo);
          const r = await preview(srv, owner, 'tracking_entries', ids.te1);
          assert.strictEqual(r.status, 200, r.text);
          const b = r.json;
          assert.strictEqual(b.state, 'preview');
          assert.strictEqual(b.result.resultCents, 180000);
          assert.strictEqual(b.result.game, 'NLH MTT');
          assert.strictEqual(b.result.venue, 'Borgata');
          assert.strictEqual(b.result.currency, 'USD');
          assert.strictEqual(b.delivery, 'off');
          assert.strictEqual(b.rosterSize, 4, 'the deleted roster record is not a backer');
          assert.deepStrictEqual(b.backers.map((x) => [x.key, x.name, x.pct, x.shareCents, x.status]), [
            ['r-mo', 'Mo Chen', 12.5, 22500, 'new'],     // NLH any
            ['r-sam', 'Sam Okafor', 10, 18000, 'new'],   // NLH live beats PLO any; Priya is online only, Dan PLO only
          ]);
          assert.strictEqual(b.pending, 2);
          assert.strictEqual(b.needsConfirm, false);
          noSecrets(r.text);
          assert.deepStrictEqual(await feed(srv, TOK.sam), samBefore, 'a preview writes nothing');
          assert.strictEqual(ledgerRows(file).length, 0);
        });

        await test('the client cannot supply a figure: shareCents, pct and resultCents in the body are ignored', async () => {
          const r = await tap(srv, owner, 'tracking_entries', ids.te1, { preview: true, shareCents: 1, pct: 99, resultCents: 5, backers: [{ key: 'r-sam', shareCents: 1 }] });
          assert.strictEqual(byName(r.json, 'Sam Okafor').shareCents, 18000);
        });

        await test('the tap: records both shares, sends nothing where delivery is off, and says so', async () => {
          const r = await commit(srv, owner, 'tracking_entries', ids.te1);
          assert.strictEqual(r.status, 200, r.text);
          assert.strictEqual(r.json.sentNow, 2);
          assert.strictEqual(r.json.already, false);
          assert.strictEqual(r.json.state, 'sent');
          assert.strictEqual(r.json.delivery, 'off');
          assert.deepStrictEqual(r.json.results.map((x) => [x.name, x.sms]), [['Mo Chen', 'off'], ['Sam Okafor', 'off']]);
          for (const x of r.json.backers) {
            assert.strictEqual(x.status, 'sent');
            assert.ok(Number.isFinite(x.sentAt));
            assert.strictEqual(x.updated, false);
          }
          noSecrets(r.text);
          assert.strictEqual(stubLines(srv, 'push').length, 0, 'no push was attempted');
          assert.strictEqual(stubLines(srv, 'sms').length, 0, 'no SMS was attempted');
          const rows = ledgerRows(file);
          assert.deepStrictEqual(rows.map((e) => [e.token, e.session_id, e.ref_table, e.ref_id, e.share_cents, e.notified_share_cents]).sort(), [
            [TOK.mo, `fg-te-${ids.te1}`, 'tracking_entries', ids.te1, 22500, 22500],
            [TOK.sam, `fg-te-${ids.te1}`, 'tracking_entries', ids.te1, 18000, 18000],
          ]);
          for (const e of rows) {
            assert.strictEqual(e.id, `${e.token}:fg-te-${ids.te1}`, 'the <token>:<session> shape');
            assert.ok(e.notified_at > 0, 'born delivered: the sweep never takes it');
            assert.strictEqual(e.date, '2026-10-10');
          }
          assert.deepStrictEqual(revisions(file).map((v) => [v.action, v.cause, v.share_after]).sort(), [['post', 'notify', 18000], ['post', 'notify', 22500]]);
        });

        await test('the page and the Backers view show the new share and the right running total', async () => {
          const sam = await feed(srv, TOK.sam);
          assert.deepStrictEqual(sam.events[0], {
            ts: sam.events[0].ts, date: '2026-10-10', game: 'NLH MTT', venue: 'Borgata', hours: 0,
            sessionResultCents: 180000, pct: 10, shareCents: 18000,
          });
          assert.strictEqual(sam.cumulativeCents, samBefore.cumulativeCents + 18000);
          assert.strictEqual(sam.cumulativeCents, 10000 + 18000 + 50000, 'September + this night + the opening');
          assert.strictEqual(sam.sessions, samBefore.sessions + 1);
          const mo = await feed(srv, TOK.mo);
          assert.strictEqual(mo.cumulativeCents, moBefore.cumulativeCents + 22500);
          const view = (await api(srv, '/api/staking/standing/backers', { token: owner })).json.backers;
          const v = view.find((x) => x.name === 'Sam Okafor');
          assert.strictEqual(v.cumulativeCents, sam.cumulativeCents);
          assert.deepStrictEqual(v.shares[0], { date: '2026-10-10', game: 'NLH MTT', venue: 'Borgata', hours: 0, sessionResultCents: 180000, pct: 10, shareCents: 18000 });
          assert.strictEqual(view.find((x) => x.name === 'Mo Chen').cumulativeCents, mo.cumulativeCents);
        });

        await test('idempotent: a second tap on an unchanged result sends nothing new and says "already sent"', async () => {
          const before = ledgerRows(file);
          const r = await commit(srv, owner, 'tracking_entries', ids.te1);
          assert.strictEqual(r.status, 200);
          assert.strictEqual(r.json.already, true);
          assert.strictEqual(r.json.sentNow, 0);
          assert.deepStrictEqual(r.json.results, []);
          assert.deepStrictEqual(ledgerRows(file), before);
          assert.strictEqual(revisions(file).length, 2);
          assert.strictEqual((await feed(srv, TOK.sam)).sessions, samBefore.sessions + 1);
        });

        await test('an edit after the tap: the shares follow it silently, with a revision row; the block says Updated', async () => {
          const put = await api(srv, `/api/tracking/${ids.te1}`, { token: owner, method: 'PUT', body: { numEntries: 1, cashed: true, cashAmount: 3000 } });
          assert.strictEqual(put.status, 200, put.text);
          const sam = await feed(srv, TOK.sam);
          assert.strictEqual(sam.events[0].sessionResultCents, 240000);
          assert.strictEqual(sam.events[0].shareCents, 24000);
          assert.strictEqual(sam.cumulativeCents, samBefore.cumulativeCents + 24000);
          const rows = ledgerRows(file);
          for (const e of rows) {
            assert.ok(e.revised_at > 0);
            assert.strictEqual(e.notified_share_cents, e.token === TOK.sam ? 18000 : 22500, 'what the backer was told is kept');
          }
          const rev = revisions(file, "action = 'revise'");
          assert.deepStrictEqual(rev.map((v) => [v.token, v.share_before, v.share_after, v.result_before, v.result_after, v.cause]).sort(), [
            [TOK.mo, 22500, 30000, 180000, 240000, 'owner-edit'],
            [TOK.sam, 18000, 24000, 180000, 240000, 'owner-edit'],
          ]);
          const block = (await preview(srv, owner, 'tracking_entries', ids.te1)).json;
          const s = byName(block, 'Sam Okafor');
          assert.deepStrictEqual([s.status, s.shareCents, s.sentShareCents, s.updated], ['sent', 24000, 18000, true]);
          assert.strictEqual(block.pending, 0);
          assert.strictEqual(stubLines(srv, 'push').length + stubLines(srv, 'sms').length, 0);
        });

        await test('an edit that moves no figure writes no revision', async () => {
          const before = revisions(file).length;
          const put = await api(srv, `/api/tracking/${ids.te1}`, { token: owner, method: 'PUT', body: { numEntries: 1, cashed: true, cashAmount: 3000, notes: 'deep run' } });
          assert.strictEqual(put.status, 200);
          assert.strictEqual(revisions(file).length, before);
        });

        await test('another user\'s delete of the owner\'s result removes nothing and voids nothing', async () => {
          const r = await api(srv, `/api/tracking/${ids.te1}`, { token: user, method: 'DELETE' });
          assert.strictEqual(r.status, 200);
          assert.strictEqual(ledgerRows(file).filter((e) => e.ref_id === ids.te1).length, 2);
        });

        await test('the dashboard overlap and the series ask: flagged in the preview, a 409 without confirm, sent with it', async () => {
          const p = await preview(srv, owner, 'tracking_entries', ids.te2);
          assert.strictEqual(p.status, 200);
          assert.strictEqual(p.json.needsConfirm, true);
          const dan = byName(p.json, 'Dan Whitcombe');
          assert.deepStrictEqual([dan.pct, dan.shareCents], [25, -25000]);
          assert.deepStrictEqual(dan.warnings, [
            { kind: 'dashboard', date: '2026-10-11', game: 'PLO MTT', venue: 'Borgata', shareCents: -5000 },
            { kind: 'series', series: ['Fall Series'] },
          ]);
          assert.deepStrictEqual(byName(p.json, 'Sam Okafor').warnings, []);
          assert.strictEqual(byName(p.json, 'Sam Okafor').shareCents, -20000);
          const danBefore = await feed(srv, TOK.dan);
          const no = await commit(srv, owner, 'tracking_entries', ids.te2);
          assert.strictEqual(no.status, 409);
          assert.strictEqual(no.json.needsConfirm, true);
          assert.deepStrictEqual(await feed(srv, TOK.dan), danBefore, 'nothing sent without the confirm');
          assert.strictEqual(ledgerRows(file).filter((e) => e.ref_id === ids.te2).length, 0);
          // "Send the others": the flagged backer skipped, the rest sent without a confirm.
          const others = await commit(srv, owner, 'tracking_entries', ids.te2, { skip: ['r-dan'] });
          assert.strictEqual(others.status, 200, others.text);
          assert.strictEqual(others.json.sentNow, 1);
          assert.deepStrictEqual(others.json.backers.map((x) => [x.name, x.status]), [['Dan Whitcombe', 'new'], ['Sam Okafor', 'sent']]);
          assert.deepStrictEqual([others.json.state, others.json.pending, others.json.needsConfirm], ['partial', 1, true]);
          assert.deepStrictEqual(await feed(srv, TOK.dan), danBefore, 'the skipped backer is not sent');
          assert.strictEqual((await commit(srv, owner, 'tracking_entries', ids.te2)).status, 409, 'and is asked about again');
          const yes = await commit(srv, owner, 'tracking_entries', ids.te2, { confirm: true });
          assert.strictEqual(yes.status, 200, yes.text);
          assert.strictEqual(yes.json.sentNow, 1);
          assert.strictEqual(yes.json.state, 'sent');
          const after = await feed(srv, TOK.dan);
          assert.strictEqual(after.sessions, danBefore.sessions + 1, 'the dashboard\'s share and this one are both on the page');
          assert.strictEqual(after.cumulativeCents, danBefore.cumulativeCents - 25000);
        });

        await test('no backer staked: an empty block with the game to name ("No backers staked in Razz MTT")', async () => {
          const r = await preview(srv, owner, 'tracking_entries', ids.te3);
          assert.strictEqual(r.status, 200);
          assert.deepStrictEqual([r.json.state, r.json.backers.length, r.json.result.game, r.json.rosterSize], ['none', 0, 'Razz MTT', 4]);
          const c = await commit(srv, owner, 'tracking_entries', ids.te3);
          assert.deepStrictEqual([c.status, c.json.sentNow, c.json.already], [200, 0, false]);
        });

        await test('a EUR result: converted to USD cents at the server\'s rate, the share of the USD figure', async () => {
          const r = await preview(srv, owner, 'tracking_entries', ids.te4);
          assert.strictEqual(r.status, 200, r.text);
          const x = r.json.result;
          assert.strictEqual(x.currency, 'EUR');
          assert.strictEqual(x.nativeCents, 390000);
          assert.ok(x.rate > 0 && x.rate !== 1);
          assert.strictEqual(x.resultCents, Math.round(390000 / x.rate));
          assert.strictEqual(byName(r.json, 'Sam Okafor').shareCents, shareCents(x.resultCents, 10));
          assert.strictEqual(byName(r.json, 'Mo Chen').shareCents, shareCents(x.resultCents, 12.5));
          const c = await commit(srv, owner, 'tracking_entries', ids.te4);
          assert.strictEqual(c.status, 200);
          const ev = (await feed(srv, TOK.sam)).events.find((e) => e.date === '2026-10-09');
          assert.deepStrictEqual([ev.sessionResultCents, ev.shareCents, ev.venue], [x.resultCents, shareCents(x.resultCents, 10), "King's Resort"]);
          const post = revisions(file, "action = 'post' AND event_id = ?", [`${TOK.sam}:fg-te-${ids.te4}`])[0];
          assert.deepStrictEqual(JSON.parse(post.note).basis, { format: 'NLH', channel: 'live', date: '2026-10-09', currency: 'EUR', rate: x.rate, nativeCents: 390000 });
        });

        await test('a cash session: the share is of the net after tips and expenses (Q12); an edit follows; a delete voids', async () => {
          const r = await preview(srv, owner, 'cash_sessions', ids.cs1);
          assert.strictEqual(r.status, 200, r.text);
          assert.strictEqual(r.json.result.resultCents, 70000, 'cash-out - buy-in - tips - expenses, not the table\'s +800');
          assert.strictEqual(r.json.result.game, '2/5 NLH');
          assert.strictEqual(r.json.result.hours, 5);
          assert.deepStrictEqual(r.json.backers.map((b) => [b.name, b.pct, b.shareCents]), [['Mo Chen', 12.5, 8750], ['Sam Okafor', 10, 7000]]);
          assert.strictEqual((await commit(srv, owner, 'cash_sessions', ids.cs1)).json.sentNow, 2);
          const samMid = await feed(srv, TOK.sam);
          const ev = samMid.events.find((e) => e.date === '2026-10-08');
          assert.deepStrictEqual([ev.game, ev.venue, ev.hours, ev.sessionResultCents, ev.shareCents], ['2/5 NLH', 'Parx Casino', 5, 70000, 7000]);
          const put = await api(srv, `/api/cash-sessions/${ids.cs1}`, { token: owner, method: 'PUT', body: { tips: 140 } });
          assert.strictEqual(put.status, 200, put.text);
          const samEdit = await feed(srv, TOK.sam);
          assert.strictEqual(samEdit.events.find((e) => e.date === '2026-10-08').shareCents, 6000, '600 net now');
          assert.strictEqual(samEdit.cumulativeCents, samMid.cumulativeCents - 1000);
          const del = await api(srv, `/api/cash-sessions/${ids.cs1}`, { token: owner, method: 'DELETE' });
          assert.strictEqual(del.status, 200);
          const samGone = await feed(srv, TOK.sam);
          assert.ok(!samGone.events.some((e) => e.date === '2026-10-08'), 'the share left the page');
          assert.strictEqual(samGone.cumulativeCents, samMid.cumulativeCents - 7000);
          const voids = revisions(file, "action = 'void' AND event_id LIKE ?", [`%:fg-cs-${ids.cs1}`]);
          assert.deepStrictEqual(voids.map((v) => [v.share_before, v.cause]).sort(), [[6000, 'owner-delete'], [7500, 'owner-delete']]);
        });

        await test('a delete after the tap voids the shares silently; the page\'s total drops by them', async () => {
          const before = await feed(srv, TOK.sam);
          const del = await api(srv, `/api/tracking/${ids.te1}`, { token: owner, method: 'DELETE' });
          assert.strictEqual(del.status, 200);
          const after = await feed(srv, TOK.sam);
          assert.ok(!after.events.some((e) => e.date === '2026-10-10'));
          assert.strictEqual(after.cumulativeCents, before.cumulativeCents - 24000);
          assert.strictEqual(ledgerRows(file).filter((e) => e.ref_id === ids.te1 && e.ref_table === 'tracking_entries').length, 0);
          const voids = revisions(file, "action = 'void' AND event_id LIKE ?", [`%:fg-te-${ids.te1}`]);
          assert.deepStrictEqual(voids.map((v) => [v.share_before, v.result_before]).sort(), [[24000, 240000], [30000, 240000]]);
          assert.strictEqual(stubLines(srv, 'push').length + stubLines(srv, 'sms').length, 0, 'nobody was told of any of it');
        });

        await test('a live session once ended: previewable, and never touched before its tap', async () => {
          const end = await api(srv, `/api/cash-sessions/${ids.cs2}/end`, { token: owner, method: 'POST', body: { cashOut: 900 } });
          assert.strictEqual(end.status, 200, end.text);
          const r = await preview(srv, owner, 'cash_sessions', ids.cs2);
          assert.strictEqual(r.status, 200);
          assert.strictEqual(r.json.state, 'preview');
          assert.strictEqual(r.json.result.resultCents, 40000);
          assert.strictEqual(ledgerRows(file).filter((e) => e.ref_table === 'cash_sessions' && e.ref_id === ids.cs2).length, 0);
        });

        await test('the log names results and counts, never a token, a phone number or a backer', () => {
          const log = srv.log().split('\n').filter((l) => !l.includes('[delivery-stub]')).join('\n');
          for (const t of Object.values(TOK)) assert.ok(!log.includes(t), 'a token in the log');
          for (const n of Object.values(SMS)) assert.ok(!log.includes(n), 'a number in the log');
          assert.match(log, /\[backers\] notify: tracking_entries #\d+ recorded for 2 backer\(s\); delivery off/);
          assert.match(log, /changed after its backers were notified: 2 share\(s\) followed it, 0 voided\. Nobody was told\./);
        });
      } finally { await srv.stop(); }
    }

    // ══ B. delivery ON (BACKER_DELIVERY=1), stubbed ═══════════════════════════════════════
    console.log('B. BACKER_DELIVERY=1: each backer is told once, by the stubs');
    {
      const file = phaseDb('b');
      srv = await boot(file, { BACKER_DELIVERY: '1', ...CONFIGURED }, { ports: PORTS, preloads: [STUB] });
      servers.push(srv);
      try {
        const owner = await login(srv, 'adminx@x.test');
        await test('the tap delivers exactly once per backer: one push to each subscription, one text where they take texts', async () => {
          const r = await commit(srv, owner, 'tracking_entries', ids.te1);
          assert.strictEqual(r.status, 200, r.text);
          assert.strictEqual(r.json.delivery, 'on');
          assert.deepStrictEqual(r.json.results.map((x) => [x.name, x.pushed, x.subs, x.sms]), [['Mo Chen', 1, 1, 'none'], ['Sam Okafor', 1, 1, 'sent']]);
          assert.deepStrictEqual(stubLines(srv, 'push').map((l) => l.split(' ').pop()).sort(),
            [`https://push.example.test/${TOK.mo}/1`, `https://push.example.test/${TOK.sam}/1`]);
          assert.deepStrictEqual(stubLines(srv, 'sms').map((l) => l.split(' ').pop()), [SMS.sam]);
          noSecrets(r.text);
        });
        await test('a second tap, an edit and a delete tell nobody', async () => {
          await commit(srv, owner, 'tracking_entries', ids.te1);
          await api(srv, `/api/tracking/${ids.te1}`, { token: owner, method: 'PUT', body: { numEntries: 2, cashed: true, cashAmount: 2400 } });
          await api(srv, `/api/tracking/${ids.te1}`, { token: owner, method: 'DELETE' });
          assert.strictEqual(stubLines(srv, 'push').length, 2);
          assert.strictEqual(stubLines(srv, 'sms').length, 1);
        });
        await test('the confirmed overlap tap: once each for Dan and Sam', async () => {
          const r = await commit(srv, owner, 'tracking_entries', ids.te2, { confirm: true });
          assert.strictEqual(r.status, 200, r.text);
          assert.deepStrictEqual(r.json.results.map((x) => [x.name, x.pushed, x.sms]), [['Dan Whitcombe', 1, 'sent'], ['Sam Okafor', 1, 'sent']]);
          assert.strictEqual(stubLines(srv, 'push').length, 4);
          assert.deepStrictEqual(stubLines(srv, 'sms').map((l) => l.split(' ').pop()), [SMS.sam, SMS.dan, SMS.sam]);
        });
        await test('every recorded share is born delivered (notified_at set), so the delivery sweep never sends it again', async () => {
          const rows = ledgerRows(file);
          assert.ok(rows.length >= 2);
          for (const e of rows) assert.ok(e.notified_at > 0 && e.notified_share_cents === e.share_cents);
        });
      } finally { await srv.stop(); }
    }

    // ══ C. BACKER_PAGE_SOURCE=sql: a backers row that owns a token decides for it ═════════
    console.log('C. BACKER_PAGE_SOURCE=sql: the merged roster joins the roster');
    {
      const file = phaseDb('c');
      srv = await boot(file, { BACKER_DELIVERY: '0', BACKER_PAGE_SOURCE: 'sql' }, { ports: PORTS });
      servers.push(srv);
      try {
        const owner = await login(srv, 'adminx@x.test');
        await test('under sql: a backers row with a link is a backer (Lee), and one that owns a roster token replaces its stakes (Mo at 5%)', async () => {
          const r = await preview(srv, owner, 'tracking_entries', ids.te1);
          assert.strictEqual(r.status, 200, r.text);
          assert.deepStrictEqual(r.json.backers.map((b) => [b.key, b.name, b.pct, b.shareCents]), [
            [`b${ids.leeId}`, 'Lee Park', 30, 54000],
            ['r-sam', 'Sam Okafor', 10, 18000],
            [`b${ids.moSqlId}`, 'Mo Chen', 5, 9000],
          ]);
          assert.strictEqual(r.json.rosterSize, 5);
          noSecrets(r.text);
          const c = await commit(srv, owner, 'tracking_entries', ids.te1);
          assert.strictEqual(c.json.sentNow, 3);
          const lee = await feed(srv, TOK.lee);
          assert.deepStrictEqual([lee.name, lee.events.length, lee.events[0].shareCents, lee.cumulativeCents], ['Lee Park', 1, 54000, 54000]);
          const rows = ledgerRows(file);
          const leeRow = rows.find((e) => e.token === TOK.lee);
          assert.ok(leeRow.agreement_id > 0 && leeRow.stake_id > 0, 'a standing share records its agreement and stake');
        });
      } finally { await srv.stop(); }
    }

    // ══ D. the module itself, against the same database (no server) ═════════════════════
    console.log('D. lib/staking/notify.js in-process');
    {
      const base = readDb(scratch.dbPath);
      const ref = { table: 'tracking_entries', id: ids.te1 };
      const ctx = (d, extra = {}) => ({ ownerId: ham, ref, source: 'console', rates: { EUR: 0.9 }, env: { BACKER_DELIVERY: '1' }, ...extra });
      try {
        await test('deliver(): a stubbed delivery is called exactly once per backer where delivery is on, and never where it is off', async () => {
          const d1 = new S.Database(base.export());
          const w = notify.commitWrite(d1, { ...ctx(d1), now: 1_800_000_000_000 });
          assert.strictEqual(w.inserted.length, 2);
          const calls = [];
          const on = await notify.deliver(d1, w.inserted, { env: { BACKER_DELIVERY: '1' }, deliver: async (x) => { calls.push(x); return { push: { sent: 1, subs: 1 }, sms: x.sms ? 'sent' : 'none' }; } });
          assert.strictEqual(on.delivery, 'on');
          assert.strictEqual(calls.length, 2);
          assert.deepStrictEqual(calls.map((c) => c.token).sort(), [TOK.mo, TOK.sam]);
          assert.strictEqual(calls.find((c) => c.token === TOK.sam).sms, SMS.sam);
          assert.strictEqual(calls.find((c) => c.token === TOK.mo).sms, null);
          const sam = calls.find((c) => c.token === TOK.sam).messages;
          assert.strictEqual(sam.title, 'NLH MTT — +$180');
          assert.match(sam.body, /Your 10% = \+\$180\. Running: \+\$780\.$/, '100 + 180 + the 500 opening');
          const off = [];
          const r = await notify.deliver(d1, w.inserted, { env: { BACKER_DELIVERY: '0' }, deliver: async (x) => { off.push(x); } });
          assert.strictEqual(r.delivery, 'off');
          assert.strictEqual(off.length, 0);
          const unset = await notify.deliver(d1, w.inserted, { env: {}, deliver: async (x) => { off.push(x); } });
          assert.strictEqual(unset.delivery, 'off');
          assert.strictEqual(off.length, 0, 'neither RENDER nor BACKER_DELIVERY: off');
          d1.close();
        });

        await test('follow(): a EUR share keeps the rate it was sent at when the result changes and the rates move', () => {
          const d2 = new S.Database(base.export());
          const eur = { table: 'tracking_entries', id: ids.te4 };
          const w = notify.commitWrite(d2, { ...ctx(d2, { ref: eur }), now: 1 });
          assert.strictEqual(w.status, 200);
          const sent = rowsOf(d2, "SELECT share_cents, session_result_cents FROM backer_events WHERE token = ? AND ref_id = ?", [TOK.sam, ids.te4])[0];
          assert.strictEqual(sent.session_result_cents, Math.round(390000 / 0.9));
          d2.run('UPDATE tracking_entries SET cash_amount = 6000 WHERE id = ?', [ids.te4]);
          const f = notify.follow(d2, eur, { rates: { EUR: 0.5 }, source: 'console', now: 2 });
          assert.deepStrictEqual(f, { revised: 2, voided: 0 });
          const row = rowsOf(d2, "SELECT share_cents, session_result_cents FROM backer_events WHERE token = ? AND ref_id = ?", [TOK.sam, ids.te4])[0];
          assert.strictEqual(row.session_result_cents, Math.round(490000 / 0.9), 'the rate it was sent at, not 0.5');
          assert.strictEqual(row.share_cents, shareCents(Math.round(490000 / 0.9), 10));
          assert.deepStrictEqual(notify.follow(d2, eur, { rates: { EUR: 0.4 }, source: 'console', now: 3 }), { revised: 0, voided: 0 }, 'nothing moved: nothing written');
          d2.close();
        });

        await test('follow(): a game corrected so no stake covers it voids the share (cause reclassified); one still covered re-matches the pct', () => {
          const d3 = new S.Database(base.export());
          const cs = { table: 'cash_sessions', id: ids.cs1 };
          notify.commitWrite(d3, { ...ctx(d3, { ref: cs }), now: 1 });
          d3.run("UPDATE cash_sessions SET game = 'PLO' WHERE id = ?", [ids.cs1]);
          assert.deepStrictEqual(notify.follow(d3, cs, { source: 'console', now: 2 }), { revised: 1, voided: 1 });
          const sam = rowsOf(d3, "SELECT pct, share_cents, game FROM backer_events WHERE token = ? AND ref_table = 'cash_sessions'", [TOK.sam])[0];
          assert.deepStrictEqual([sam.pct, sam.share_cents, sam.game], [20, 14000, '2/5 PLO'], 'Sam\'s PLO any stake');
          assert.strictEqual(rowsOf(d3, "SELECT 1 FROM backer_events WHERE token = ? AND ref_table = 'cash_sessions'", [TOK.mo]).length, 0, 'Mo is NLH only');
          assert.strictEqual(rowsOf(d3, "SELECT cause FROM backer_event_revisions WHERE action = 'void'")[0].cause, 'reclassified');
          d3.close();
        });

        await test('follow(): a result nobody notified is never touched; an unknown table is a no-op', () => {
          const d4 = new S.Database(base.export());
          d4.run('UPDATE tracking_entries SET cash_amount = 1 WHERE id = ?', [ids.te2]);
          assert.deepStrictEqual(notify.follow(d4, { table: 'tracking_entries', id: ids.te2 }, { now: 1 }), { revised: 0, voided: 0 });
          assert.deepStrictEqual(notify.follow(d4, { table: 'tournaments', id: 1 }, { now: 1 }), { revised: 0, voided: 0 });
          assert.strictEqual(rowsOf(d4, 'SELECT COUNT(*) AS n FROM backer_event_revisions')[0].n, 0);
          d4.close();
        });
      } finally { base.close(); }
    }
  } catch (err) {
    await test('the suite ran to the end', () => { throw err; });
  } finally {
    for (const s of servers) await s.stop().catch(() => {});
    scratch.cleanup();
    done();
  }
})();
