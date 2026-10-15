// Phase 7 of the bankroll merge (docs/bankroll-merge.md "Phase 7: as built"): standing shares live,
// through the real server. The Notify tap posts one result under the money state; the Q7 answer
// stored; a live session and a pre-effective_from result never post; every write path follows or
// voids silently; exclusions; the stakes editor (correct with preview, from today); drift; a
// dashboard share's recalc and remove; the cutover switch (posting off writes nothing; postingSince
// moves imported agreements; cutover live stops the feed's roster fallback); the agreements' routes;
// the unsaved-result preview.
//
//   node test/standing-live.test.js        (npm run test:standing-live)
//
// Boots server.js on scratch ports 4680-4689 against a scratch DB (never poker-tournaments.db) with
// production secrets scrubbed, BACKER_PAGE_SOURCE=sql, BACKER_DELIVERY=0 and the delivery stub, so
// nothing can leave the machine. Every name, token and figure is invented.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createScratch, boot, sqlJs, one, rowsOf, runner } = require('./helpers/scratch-server');

const PORTS = [4680, 4689];
const STUB = path.join(__dirname, 'stub-delivery-preload.js');
const PW = 'standing-live-test-password-1';
const TOK = { sam: 'SamLive0001', lee: 'LeeLive0001', mo: 'MoLive00001', dan: 'DanRost0001' };
const lastId = (db) => db.exec('SELECT last_insert_rowid()')[0].values[0][0];

function seed(db, ham) {
  const T = (name, date, buyin, game, venue, property, extra = {}) => {
    db.run(`INSERT INTO tournaments (event_number, event_name, date, time, buyin, game_variant, venue, property, is_online, notes, uploaded_by)
            VALUES ('', ?, ?, '12:00 PM', ?, ?, ?, ?, 0, '', ?)`, [name, date, buyin, game, venue, property, extra.uploadedBy || null]);
    return lastId(db);
  };
  const TE = (tid, { cashed = 0, cash = 0 } = {}) => {
    db.run('INSERT INTO tracking_entries (user_id, tournament_id, num_entries, cashed, cash_amount) VALUES (?, ?, 1, ?, ?)', [ham, tid, cashed, cash]);
    return lastId(db);
  };
  const backer = (name, token, phone) => {
    db.run('INSERT INTO backers (user_id, name, phone, public_token, notify_sms, notify_email) VALUES (?, ?, ?, ?, 0, 0)', [ham, name, phone || null, token]);
    return lastId(db);
  };
  const agreement = (backerId, from, stakes) => {
    db.run("INSERT INTO standing_agreements (user_id, backer_id, effective_from, status, opening_cents, created_at) VALUES (?, ?, ?, 'active', 0, '2026-01-01T00:00:00Z')", [ham, backerId, from]);
    const id = lastId(db);
    for (const s of stakes) db.run("INSERT INTO standing_stakes (agreement_id, format, channel, pct, valid_from, created_at) VALUES (?, ?, ?, ?, ?, '2026-01-01T00:00:00Z')", [id, s.format, s.channel, s.pct, from]);
    return id;
  };
  const ids = {};
  ids.sam = backer('Sam Okafor', TOK.sam);
  ids.lee = backer('Lee Park', TOK.lee);
  ids.mo = backer('Mo Chen', TOK.mo);
  ids.agSam = agreement(ids.sam, '2026-10-01', [{ format: 'PLO', channel: 'any', pct: 20 }, { format: 'NLH', channel: 'live', pct: 10 }]);
  ids.agLee = agreement(ids.lee, '2026-01-01', [{ format: 'NLH', channel: 'live', pct: 30 }]);
  ids.agMo = agreement(ids.mo, '2026-05-01', [{ format: 'all', channel: 'any', pct: 5 }]);
  db.run("UPDATE standing_agreements SET status = 'ended', effective_to = '2026-06-30' WHERE id = ?", [ids.agMo]); // ended: never in a block
  db.run("INSERT INTO bankroll_import_keys (user_id, fingerprint, ref_table, ref_id, created_at) VALUES (?, 'dash:backers:b-mo', 'standing_agreements', ?, '2026-10-14T00:00:00Z')", [ham, ids.agMo]);
  // A roster-only backer (the dashboard-era store): what the feed stops falling back to after the cutover.
  db.run("INSERT INTO console_records (store, id, data, updated_at, deleted) VALUES ('backers', 'r-dan', ?, 1000, 0)",
    [JSON.stringify({ id: 'r-dan', token: TOK.dan, name: 'Dan Roster', opening: 0, stakes: [] })]);

  const t1 = T('$600 NLH Deepstack', '2026-10-10', 600, 'NLH', 'Test Series', 'Borgata');
  const t2 = T('$1,000 PLO', '2026-10-11', 1000, 'PLO', 'Test Series', 'Borgata');
  const t3 = T('$400 NLH Early', '2026-09-20', 400, 'NLH', 'Test Series', 'Borgata');
  const t4 = T('$500 PLO Old', '2026-09-05', 500, 'PLO', 'Test Series', 'Borgata');
  const tp = T('Home game $300 NLH', '2026-10-12', 300, 'NLH', 'Personal', null, { uploadedBy: ham });
  db.run('INSERT INTO user_schedules (user_id, tournament_id) VALUES (?, ?)', [ham, tp]);
  Object.assign(ids, { t1, t2, t3, t4, tp,
    te1: TE(t1, { cashed: 1, cash: 2400 }),   // +1,800
    te2: TE(t2),                               // -1,000
    te3: TE(t3),                               // -400, before Sam's agreement
    te4: TE(t4),                               // -500, a dashboard-era share on it
    teP: TE(tp, { cashed: 1, cash: 900 }),    // +600
  });
  // Q7: Lee also holds a series agreement covering t1 and t3 (the same backers row).
  db.run("INSERT INTO staking_series (user_id, name, currency, status) VALUES (?, 'Fall Series', 'USD', 'active')", [ham]);
  const series = lastId(db);
  db.run("INSERT INTO backer_agreements (series_id, backer_id, backer_type, percentage, is_active) VALUES (?, ?, 'pay_per_play', 10, 1)", [series, ids.lee]);
  const ba = lastId(db);
  for (const t of [t1, t3]) db.run("INSERT INTO backer_event_status (agreement_id, tournament_id, status) VALUES (?, ?, 'played')", [ba, t]);
  // Dashboard-era shares linked to te4 by the import: Sam's (stale: the result was -400 then) and Lee's.
  const dash = (token, sid, pct, result, share) => db.run(`INSERT INTO backer_events
      (id, token, session_id, ts, date, game, venue, hours, session_result_cents, pct, share_cents, source, notified_share_cents, notified_at, ref_table, ref_id)
      VALUES (?, ?, ?, ?, '2026-09-05', 'PLO MTT', 'Borgata', 4, ?, ?, ?, 'dashboard', ?, ?, 'tracking_entries', ?)`,
  [`${token}:${sid}`, token, sid, Date.parse('2026-09-05T23:00:00Z'), result, pct, share, share, Date.parse('2026-09-05T23:00:00Z'), ids.te4]);
  dash(TOK.sam, '0b9c2f3e-1111-4a5b-9c8d-000000000011', 20, -40000, -8000);
  dash(TOK.lee, '0b9c2f3e-1111-4a5b-9c8d-000000000012', 30, -40000, -12000);
  const CS = (o) => {
    db.run(`INSERT INTO cash_sessions (user_id, bankroll_id, started_at, ended_at, session_date, room, game, stakes, buy_in, rebuys, cash_out, tips, expenses, currency, created_at)
            VALUES (?, NULL, ?, ?, ?, 'Parx Casino', 'NLH', '2/5', ?, 0, ?, ?, ?, 'USD', '2026-10-08T00:00:00Z')`,
    [ham, o.start, o.end, o.day, o.buyIn, o.cashOut, o.tips || 0, o.expenses || 0]);
    return lastId(db);
  };
  ids.cs1 = CS({ start: '2026-10-08T22:00:00Z', end: '2026-10-09T03:00:00Z', day: '2026-10-08', buyIn: 1000, cashOut: 1800, tips: 40, expenses: 60 }); // +700
  ids.cs2 = CS({ start: '2026-10-14T20:00:00Z', end: null, day: '2026-10-14', buyIn: 500, cashOut: null });
  return ids;
}

(async () => {
  const { test, done } = runner('standing-live.test.js');
  const scratch = await createScratch({ ports: PORTS, prefix: 'fg-standing-live-' });
  const servers = [];
  const S = await sqlJs();
  const readDb = () => new S.Database(fs.readFileSync(scratch.dbPath));
  const q = (sql, args = []) => { const d = readDb(); try { return rowsOf(d, sql, args); } finally { d.close(); } };
  try {
    let srv = await boot(scratch.dbPath, {}, { ports: PORTS });
    servers.push(srv);
    try {
      for (const [u, e] of [['adminx', 'adminx@x.test'], ['plainuser', 'plainuser@x.test']]) {
        const r = await fetch(`http://127.0.0.1:${srv.port}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, email: e, password: PW, realName: u }) });
        assert.strictEqual(r.status, 201, `register ${u}`);
      }
    } finally { await srv.stop(); }
    const db = scratch.open();
    db.run("UPDATE users SET username = 'ham' WHERE username = 'adminx'");
    const ham = one(db, "SELECT id FROM users WHERE username = 'ham'");
    const ids = seed(db, ham);
    scratch.save(db);
    db.close();

    srv = await boot(scratch.dbPath, { BACKER_PAGE_SOURCE: 'sql', BACKER_DELIVERY: '0', CONSOLE_OWNER_USER_ID: String(ham),
      VAPID_PUBLIC_KEY: 'stub-public', VAPID_PRIVATE_KEY: 'stub-private', TWILIO_ACCOUNT_SID: 'ACstub', TWILIO_AUTH_TOKEN: 'stub', TWILIO_FROM: '+15555550000' },
    { ports: PORTS, preloads: [STUB] });
    servers.push(srv);
    const api = (p, { token, method = 'GET', body } = {}) => fetch(`http://127.0.0.1:${srv.port}${p}`, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) { /* */ } return { status: r.status, text, json }; });
    const login = async (email) => (await api('/api/login', { method: 'POST', body: { email, password: PW } })).json.token;
    const owner = await login('adminx@x.test');
    const plain = await login('plainuser@x.test');
    const O = (p, o = {}) => api(p, { token: owner, ...o });
    const tap = (refTable, refId, extra = {}) => O('/api/staking/standing/notify', { method: 'POST', body: { refTable, refId, ...extra } });
    const preview = (t, id) => tap(t, id, { preview: true });
    const commit = (t, id, extra = {}) => tap(t, id, { preview: false, ...extra });
    const byName = (body, name) => (body.backers || []).find((b) => b.name === name);
    const ledger = (table, id) => q("SELECT * FROM backer_events WHERE ref_table = ? AND ref_id = ? AND source = 'ledger' ORDER BY token", [table, id]);
    const revs = (table, id, cause) => q("SELECT r.* FROM backer_event_revisions r WHERE r.event_id LIKE ? AND r.cause = ? ORDER BY r.id", [`%:fg-${table === 'cash_sessions' ? 'cs' : 'te'}-${id}`, cause]);
    const delivered = () => srv.log().split('\n').filter((l) => l.includes('[delivery-stub]')).length;
    const noSecrets = (text) => { for (const t of Object.values(TOK)) assert.ok(!text.includes(t), 'a token in the answer'); assert.ok(!/fg-(te|cs)-\d/.test(text), 'an event id in the answer'); };
    const KEY = { sam: `b${ids.sam}`, lee: `b${ids.lee}` };

    console.log('the tap under the money state');
    await test('the money state starts unset (the tap is on); another user is refused everywhere', async () => {
      const s = await O('/api/bankrolls/money/cutover');
      assert.strictEqual(s.status, 200);
      assert.deepStrictEqual(s.json.state, { posting: null, cutover: 'none', postingSince: null, notify: true });
      assert.strictEqual((await api('/api/bankrolls/money/cutover', { token: plain })).status, 403);
      assert.strictEqual((await api('/api/staking/standing/drift', { token: plain })).status, 403);
      assert.strictEqual((await api('/api/staking/standing', { token: plain })).status, 403);
    });
    await test('preview: the standing cuts from the dated stakes; the series overlap flagged (Q7); nothing before effective_from; a live session never', async () => {
      const r = await preview('tracking_entries', ids.te1);
      assert.strictEqual(r.status, 200, r.text);
      noSecrets(r.text);
      assert.deepStrictEqual([byName(r.json, 'Sam Okafor').pct, byName(r.json, 'Sam Okafor').shareCents], [10, 18000]);
      assert.deepStrictEqual([byName(r.json, 'Lee Park').pct, byName(r.json, 'Lee Park').shareCents], [30, 54000]);
      assert.ok(byName(r.json, 'Lee Park').warnings.some((w) => w.kind === 'series'), 'Lee is flagged: a series agreement covers t1');
      assert.strictEqual(r.json.needsConfirm, true);
      assert.strictEqual(r.json.posting, null);
      const early = await preview('tracking_entries', ids.te3);
      assert.ok(!byName(early.json, 'Sam Okafor'), 'Sam\'s agreement starts Oct 1: a Sept result is not his');
      assert.ok(byName(early.json, 'Lee Park'));
      assert.ok(!byName(early.json, 'Mo Chen'), 'an ended agreement never posts');
      assert.strictEqual((await preview('cash_sessions', ids.cs2)).status, 409);
    });
    await test('Notify posts one result: refused without the Q7 answer; with answers { lee: standing } both shares are recorded and the flag is gone', async () => {
      assert.strictEqual((await commit('tracking_entries', ids.te1)).status, 409);
      assert.strictEqual(ledger('tracking_entries', ids.te1).length, 0, 'nothing written on the 409');
      const r = await commit('tracking_entries', ids.te1, { answers: { [KEY.lee]: 'standing' } });
      assert.strictEqual(r.status, 200, r.text);
      assert.strictEqual(r.json.sentNow, 2);
      assert.strictEqual(r.json.delivery, 'off');
      assert.strictEqual(ledger('tracking_entries', ids.te1).length, 2);
      assert.deepStrictEqual(q("SELECT answer FROM standing_result_answers WHERE token = ? AND ref_id = ?", [TOK.lee, ids.te1]).map((x) => x.answer), ['standing']);
      assert.strictEqual(delivered(), 0, 'BACKER_DELIVERY=0: nobody messaged');
    });
    await test('the Q7 answer "series" keeps that backer off the result for good, and is not asked again', async () => {
      const r = await commit('tracking_entries', ids.te3, { answers: { [KEY.lee]: 'series' } });
      assert.strictEqual(r.status, 200, r.text);
      assert.strictEqual(r.json.sentNow, 0);
      assert.deepStrictEqual(r.json.skipped, [{ key: KEY.lee, name: 'Lee Park', reason: 'series' }]);
      assert.strictEqual(ledger('tracking_entries', ids.te3).length, 0);
      const again = await preview('tracking_entries', ids.te3);
      assert.strictEqual(again.json.needsConfirm, false);
      assert.ok(!byName(again.json, 'Lee Park'));
    });

    console.log('every write path follows, silently');
    await test('an edit re-derives each share (a revise revision); what the backer was told is kept; nobody is messaged', async () => {
      const put = await O(`/api/tracking/${ids.te1}`, { method: 'PUT', body: { numEntries: 1, cashed: true, cashAmount: 3000 } });
      assert.strictEqual(put.status, 200, put.text);
      const rows = ledger('tracking_entries', ids.te1);
      assert.deepStrictEqual(rows.map((e) => [e.token, e.share_cents, e.notified_share_cents]), [[TOK.lee, 72000, 54000], [TOK.sam, 24000, 18000]]);
      assert.strictEqual(revs('tracking_entries', ids.te1, 'owner-edit').length, 2);
      assert.strictEqual(delivered(), 0);
    });
    await test('a Personal event\'s buy-in edited: its result\'s shares follow', async () => {
      assert.strictEqual((await commit('tracking_entries', ids.teP)).status, 200);
      assert.deepStrictEqual(ledger('tracking_entries', ids.teP).map((e) => e.share_cents), [18000, 6000]);
      const put = await O(`/api/tournaments/${ids.tp}`, { method: 'PUT', body: { buyin: 500 } });
      assert.strictEqual(put.status, 200, put.text);
      assert.deepStrictEqual(ledger('tracking_entries', ids.teP).map((e) => e.share_cents), [12000, 4000]);
    });
    await test('a deleted result voids its shares: the events are gone, a void revision kept', async () => {
      assert.strictEqual((await O(`/api/tracking/${ids.teP}`, { method: 'DELETE' })).status, 200);
      assert.strictEqual(ledger('tracking_entries', ids.teP).length, 0);
      assert.strictEqual(revs('tracking_entries', ids.teP, 'owner-delete').filter((r) => r.action === 'void').length, 2);
      assert.strictEqual(delivered(), 0);
    });

    console.log('exclusions, the stakes editor, drift');
    await test('an exclusion voids the posted share and keeps the backer out of the block; undoing it brings the backer back unposted', async () => {
      assert.strictEqual((await commit('cash_sessions', ids.cs1)).status, 200);
      assert.deepStrictEqual(ledger('cash_sessions', ids.cs1).map((e) => [e.token, e.share_cents]), [[TOK.lee, 21000], [TOK.sam, 7000]]);
      const ex = await O('/api/staking/standing/exclusions', { method: 'POST', body: { refTable: 'cash_sessions', refId: ids.cs1, key: KEY.sam } });
      assert.strictEqual(ex.status, 200, ex.text);
      noSecrets(ex.text);
      assert.deepStrictEqual(ex.json.skipped, [{ key: KEY.sam, name: 'Sam Okafor', reason: 'excluded' }]);
      assert.deepStrictEqual(ledger('cash_sessions', ids.cs1).map((e) => e.token), [TOK.lee]);
      assert.strictEqual(revs('cash_sessions', ids.cs1, 'exclude').length, 1);
      assert.strictEqual(q('SELECT COUNT(*) AS n FROM standing_exclusions WHERE agreement_id = ? AND ref_id = ?', [ids.agSam, ids.cs1])[0].n, 1);
      const un = await O('/api/staking/standing/exclusions', { method: 'DELETE', body: { refTable: 'cash_sessions', refId: ids.cs1, key: KEY.sam } });
      assert.strictEqual(un.status, 200);
      assert.strictEqual(byName(un.json, 'Sam Okafor').status, 'new', 'back in the block, not re-posted');
      assert.strictEqual(q('SELECT COUNT(*) AS n FROM standing_exclusions WHERE agreement_id = ?', [ids.agSam])[0].n, 0);
    });
    await test('a stake correction: the preview lists every share it changes with the total; the confirm re-derives them in place', async () => {
      const body = { mode: 'correct', stakes: [{ format: 'NLH', channel: 'live', pct: 25 }] };
      const pv = await O(`/api/staking/standing/${ids.agLee}/stakes`, { method: 'POST', body });
      assert.strictEqual(pv.status, 200, pv.text);
      assert.strictEqual(pv.json.preview, true);
      assert.deepStrictEqual(pv.json.affected.map((a) => [a.refTable, a.refId, a.shareBefore, a.shareAfter]).sort(), [['cash_sessions', ids.cs1, 21000, 17500], ['tracking_entries', ids.te1, 72000, 60000]].sort());
      assert.strictEqual(pv.json.totalDeltaCents, -15500);
      assert.strictEqual(q('SELECT pct FROM standing_stakes WHERE agreement_id = ?', [ids.agLee])[0].pct, 30, 'nothing written by the preview');
      const ok = await O(`/api/staking/standing/${ids.agLee}/stakes`, { method: 'POST', body: { ...body, confirm: true } });
      assert.strictEqual(ok.status, 200, ok.text);
      assert.deepStrictEqual(q('SELECT pct, valid_from FROM standing_stakes WHERE agreement_id = ?', [ids.agLee]).map((s) => [s.pct, s.valid_from]), [[25, '2026-01-01']]);
      assert.strictEqual(ledger('tracking_entries', ids.te1).find((e) => e.token === TOK.lee).share_cents, 60000);
      assert.strictEqual(revs('tracking_entries', ids.te1, 'stake-correction').length, 1);
      assert.strictEqual(delivered(), 0);
    });
    await test('a stake "from today" closes the old row the day before and opens the new one; no past share moves', async () => {
      const r = await O(`/api/staking/standing/${ids.agLee}/stakes`, { method: 'POST', body: { mode: 'from-today', stakes: [{ format: 'NLH', channel: 'live', pct: 35 }] } });
      assert.strictEqual(r.status, 200, r.text);
      const rows = q('SELECT pct, valid_from, valid_to FROM standing_stakes WHERE agreement_id = ? ORDER BY id', [ids.agLee]);
      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[0].pct, 25);
      assert.ok(rows[0].valid_to < rows[1].valid_from, 'closed the day before the new one opens');
      assert.strictEqual(rows[1].valid_to, null);
      assert.strictEqual(ledger('tracking_entries', ids.te1).find((e) => e.token === TOK.lee).share_cents, 60000);
    });
    await test('drift: a feed row edited under a notified result is listed, not applied; apply follows it (cause drift)', async () => {
      assert.strictEqual((await O(`/api/tournaments/${ids.t1}`, { method: 'PUT', body: { buyin: 800 } })).status, 200);
      assert.strictEqual(ledger('tracking_entries', ids.te1).find((e) => e.token === TOK.sam).share_cents, 24000, 'a feed edit is not an owner write');
      const d = await O('/api/staking/standing/drift');
      assert.strictEqual(d.status, 200, d.text);
      noSecrets(d.text);
      assert.deepStrictEqual(d.json.lines.map((l) => [l.key, l.shareCents, l.freshShareCents]).sort(), [[KEY.lee, 60000, 55000], [KEY.sam, 24000, 22000]].sort());
      const a = await O('/api/staking/standing/drift/apply', { method: 'POST', body: { refTable: 'tracking_entries', refId: ids.te1 } });
      assert.deepStrictEqual(a.json, { revised: 2, voided: 0 });
      assert.strictEqual(revs('tracking_entries', ids.te1, 'drift').length, 2);
      assert.deepStrictEqual((await O('/api/staking/standing/drift')).json.lines, []);
    });

    console.log('a dashboard share: recalc and remove');
    await test('Recalculate turns a linked dashboard share into a ledger share at its own pct from the result now; Remove deletes one', async () => {
      const rc = await O('/api/staking/standing/events/recalc', { method: 'POST', body: { refTable: 'tracking_entries', refId: ids.te4, key: KEY.sam } });
      assert.strictEqual(rc.status, 200, rc.text);
      const sam = q('SELECT * FROM backer_events WHERE token = ? AND ref_id = ?', [TOK.sam, ids.te4])[0];
      assert.deepStrictEqual([sam.source, sam.pct, sam.session_result_cents, sam.share_cents, sam.notified_share_cents], ['ledger', 20, -50000, -10000, -8000]);
      assert.strictEqual(q("SELECT COUNT(*) AS n FROM backer_event_revisions WHERE event_id = ? AND action = 'recalc'", [sam.id])[0].n, 1);
      assert.strictEqual(byName(rc.json, 'Sam Okafor').status, 'sent');
      const rm = await O('/api/staking/standing/events/remove', { method: 'POST', body: { refTable: 'tracking_entries', refId: ids.te4, key: KEY.lee } });
      assert.strictEqual(rm.status, 200, rm.text);
      assert.strictEqual(q('SELECT COUNT(*) AS n FROM backer_events WHERE token = ? AND ref_id = ?', [TOK.lee, ids.te4])[0].n, 0);
      assert.strictEqual(q("SELECT COUNT(*) AS n FROM backer_event_revisions WHERE token = ? AND action = 'void' AND cause = 'owner-remove'", [TOK.lee])[0].n, 1);
      assert.strictEqual((await O('/api/staking/standing/events/remove', { method: 'POST', body: { refTable: 'tracking_entries', refId: ids.te4, key: KEY.lee } })).status, 404);
    });

    console.log('the cutover switch');
    await test('posting off: the tap is refused and writes nothing; the preview says so', async () => {
      assert.strictEqual((await O('/api/bankrolls/money/cutover', { method: 'PUT', body: { posting: 'off' } })).status, 200);
      const r = await commit('tracking_entries', ids.te2);
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.json.posting, 'off');
      assert.strictEqual(ledger('tracking_entries', ids.te2).length, 0);
      assert.strictEqual((await preview('tracking_entries', ids.te2)).json.posting, 'off');
      assert.strictEqual((await O('/api/bankrolls/money/cutover', { method: 'PUT', body: { posting: 'sideways' } })).status, 400);
    });
    await test('posting on with postingSince moves effective_from on the agreements an import created, and no other', async () => {
      const r = await O('/api/bankrolls/money/cutover', { method: 'PUT', body: { posting: 'on', postingSince: '2026-09-15' } });
      assert.strictEqual(r.status, 200, r.text);
      assert.strictEqual(r.json.moved, 1);
      assert.deepStrictEqual(q('SELECT id, effective_from FROM standing_agreements ORDER BY id').map((a) => a.effective_from), ['2026-10-01', '2026-01-01', '2026-09-15']);
      assert.strictEqual((await commit('tracking_entries', ids.te2)).status, 200, 'the tap is back');
      assert.strictEqual(ledger('tracking_entries', ids.te2).length, 1);
    });
    await test('cutover live: the feed stops falling back to the old roster for a token no backers row owns', async () => {
      const before = (await api(`/api/backer/${TOK.dan}/feed`)).json;
      assert.strictEqual(before.name, 'Dan Roster');
      assert.strictEqual((await O('/api/bankrolls/money/cutover', { method: 'PUT', body: { cutover: 'live' } })).status, 200);
      const after = (await api(`/api/backer/${TOK.dan}/feed`)).json;
      assert.deepStrictEqual([after.name, after.stakes], [null, '']);
      const sam = (await api(`/api/backer/${TOK.sam}/feed`)).json;
      assert.strictEqual(sam.name, 'Sam Okafor', 'a backers row is served as before');
      assert.deepStrictEqual((await O('/api/bankrolls/money/cutover')).json.state, { posting: 'on', cutover: 'live', postingSince: '2026-09-15', notify: true });
    });

    console.log('the agreements\' routes and the unsaved preview');
    let newId = null;
    await test('create: a new backer is minted a link; one active agreement per backer; list; update; delivery; events', async () => {
      const c = await O('/api/staking/standing', { method: 'POST', body: { newBacker: { name: 'New Backer' }, effectiveFrom: '2026-10-01', stakes: [{ format: 'PLO', channel: 'any', pct: 15 }] } });
      assert.strictEqual(c.status, 201, c.text);
      assert.match(c.json.link, /^\/b\/[A-Za-z0-9]{8}$/);
      newId = c.json.id;
      const dup = await O('/api/staking/standing', { method: 'POST', body: { backerId: c.json.backerId, effectiveFrom: '2026-10-01', stakes: [{ format: 'all', channel: 'any', pct: 5 }] } });
      assert.strictEqual(dup.status, 409);
      assert.strictEqual((await O('/api/staking/standing', { method: 'POST', body: { backerId: c.json.backerId, effectiveFrom: '2026-10-01', stakes: [{ format: 'Nope', channel: 'any', pct: 5 }] } })).status, 400);
      const list = await O('/api/staking/standing');
      assert.strictEqual(list.status, 200);
      noSecrets(list.text);
      const lee = list.json.agreements.find((a) => a.id === ids.agLee);
      assert.deepStrictEqual([lee.active, lee.stakes.length, lee.inForce, lee.sharesCount], [true, 2, '35% NLH (live)', 2]);
      assert.strictEqual(list.json.agreements.find((a) => a.id === newId).backer.link.length, 8);
      const end = await O(`/api/staking/standing/${newId}`, { method: 'PUT', body: { status: 'ended' } });
      assert.strictEqual(end.status, 200, end.text);
      assert.ok(q('SELECT effective_to FROM standing_agreements WHERE id = ?', [newId])[0].effective_to, 'ended today');
      const dl = await O(`/api/staking/standing/backers/${ids.sam}/delivery`, { method: 'PUT', body: { sms: '+15555550199' } });
      assert.deepStrictEqual(dl.json.delivery, { sms: true, email: false });
      assert.strictEqual((await O(`/api/staking/standing/backers/${ids.sam}/delivery`, { method: 'PUT', body: { email: 'not-an-address' } })).status, 400);
      const ev = await O(`/api/staking/standing/${ids.agLee}/events`);
      assert.strictEqual(ev.status, 200);
      noSecrets(ev.text);
      const te1 = ev.json.events.find((e) => e.refId === ids.te1);
      assert.deepStrictEqual([te1.shareCents, te1.sentShareCents, te1.revisions.map((r) => r.cause)], [55000, 54000, ['notify', 'owner-edit', 'stake-correction', 'drift']]);
      assert.strictEqual((await O(`/api/staking/standing/${ids.agLee}/events?source=dashboard`)).json.events.length, 0, 'Lee\'s dashboard share was removed');
    });
    await test('the preview for an unsaved result: the cuts and the "Posts to backers" line', async () => {
      const r = await O('/api/staking/standing/preview?kind=tournament&date=2026-10-20&game=NLH&online=0&resultCents=100000');
      assert.strictEqual(r.status, 200, r.text);
      assert.deepStrictEqual(r.json.backers.map((b) => [b.key, b.pct, b.shareCents]), [[KEY.lee, 35, 35000], [KEY.sam, 10, 10000]]);
      assert.strictEqual(r.json.line, 'Posts to backers: +$350 (35%), +$100 (10%)');
      assert.strictEqual((await O('/api/staking/standing/preview?kind=tournament&game=Razz&online=0&resultCents=100000')).json.line, 'Posts to no backers');
      assert.strictEqual((await O('/api/staking/standing/preview?kind=cash&resultCents=x')).status, 400);
    });
    await test('nothing left the machine', () => { assert.strictEqual(delivered(), 0); });
  } catch (e) {
    console.log('  FAIL (setup)', e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n       ') : e);
    process.exitCode = 1;
  } finally {
    for (const s of servers) await s.stop().catch(() => {});
    scratch.cleanup();
  }
  if (process.exitCode) { process.stdout.write('\nstanding-live.test.js - setup failed\n', () => process.exit(1)); return; }
  done();
})();
