// Phase 5 of the bankroll merge (docs/bankroll-merge.md §5, §7.1, §8.2, §9): the dashboard import,
// end to end, through the real server.
//
//   node test/money-import.test.js        (npm run test:money-import)
//
// A STUB DASHBOARD runs in this process on a scratch port and serves GET /api/money-export the way
// WC:server/lib/money-export.js does (Bearer-only, sorted records, tombstones, the four blobs, a
// cursor, the sha256 hash). server.js boots on another scratch port (4610-4619, never 3001) against a
// SCRATCH database in a temp dir (never poker-tournaments.db or a copy of it), with SYNC_TOKEN,
// DASHBOARD_TOKEN, ROSTER_TOKEN, LEDGER_TOKEN, TESTFLIGHT_WATCHDOG, RENDER, TRUST_PROXY and
// ANTHROPIC_API_KEY scrubbed (test/helpers/scratch-server.js), and LEDGER_TOKEN set ONLY here, to a
// value made up for this run. ./solver is stubbed (-r test/stub-solver-preload.js).
//
// What it proves:
//   - the plan's every mapping (§5.2-§5.6), the opening deposit, the rounding, the flags and errors;
//   - duplicate pairs found (late night ±1 day, alias rooms, unequal nets, deposits, expenses) and
//     not found (another room, two days apart, cash against a tournament);
//   - nothing is written on fetch; a commit refuses without the reviewed planHash, with unanswered
//     pairs, and against a plan the database has moved past;
//   - commit then a second import is idempotent;
//   - the ledger totals: the roll is the dashboard's computeBankroll (ported AGAIN below as the
//     oracle) plus the listed lines, to the cent, and exactly it on a clean account; the fund apart;
//   - every backer's /b/ feed is byte-identical after the import (BACKER_PAGE_SOURCE unset), and the
//     parity route lists exactly the expected differences;
//   - the delta re-pulls from cursor − 14 days and catches a late-synced older record;
//   - a hash or count mismatch, a non-JSON answer, a 404 and a timeout refuse;
//   - undo refuses an edited row and lists it, and otherwise restores every table byte for byte.
//
// Every name, token, address and figure is invented.
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createScratch, boot, waitLog, sqlJs, freePort, one, runner } = require('./helpers/scratch-server');
const { createStub } = require('./helpers/stub-dashboard');
const fx = require('./helpers/money-import-fixtures');
const pull = require('../lib/money-import/pull');
const M = require('../lib/money-import/map');
const S = require('../lib/money-import/score');
const engine = require('../lib/money-import');
const ALIASES = require('../lib/money-import/room-aliases');

const PORTS = [4610, 4619];
const LEDGER = crypto.randomBytes(32).toString('hex'); // made up, for this run only
const PW = 'money-import-test-pw-1';
const DAY = fx.DAY;
const near = (a, b, tol = 0.005) => Math.abs(a - b) < tol;

// ── The oracle: the dashboard's computeBankroll (WC:app/src/engine/bankroll.ts), ported again,
// independently of lib/money-import/dashboard-bankroll.js. ────────────────────────────────────
function computeBankroll(sessions, adjustments, startingRoll) {
  const isWsop = (s) => !!s.isWsopFund;
  const sessionPnl = sessions.filter((s) => !isWsop(s)).reduce((a, s) => a + s.result, 0);
  const transfers = adjustments.filter((a) => a.type === 'wsop-fund-transfer');
  const backerSettle = adjustments.filter((a) => a.type === 'backer-settlement').reduce((a, x) => a + x.amount, 0);
  const rollAdj = adjustments.filter((a) => a.type !== 'wsop-fund-transfer' && a.type !== 'backer-settlement').reduce((a, x) => a + x.amount, 0);
  const transferTotal = transfers.reduce((a, x) => a + x.amount, 0);
  const wsopSessionPnl = sessions.filter(isWsop).reduce((a, s) => a + s.result, 0);
  return { playingRoll: startingRoll + sessionPnl + rollAdj - transferTotal, wsopFund: transferTotal + wsopSessionPnl + backerSettle };
}
const oracleOf = (stub) => {
  const st = stub.live('settings')[0];
  const o = computeBankroll(stub.live('sessions'), stub.live('adjustments'), st ? st.startingRoll : 0);
  return { roll: Math.round(o.playingRoll * 100) / 100, fund: Math.round(o.wsopFund * 100) / 100 };
};

async function dumpFile(file) {
  const S2 = await sqlJs();
  const db = new S2.Database(fs.readFileSync(file));
  const out = {};
  const t = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('sqlite_sequence', 'money_import_runs') ORDER BY name");
  for (const [name] of t[0].values) {
    const r = db.exec(`SELECT * FROM ${name} ORDER BY rowid`);
    out[name] = JSON.stringify(r.length ? r[0].values : []);
  }
  db.close();
  return out;
}
const diffTables = (a, b) => Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]).sort();

(async () => {
  const { test, done } = runner('money-import.test.js');
  const cleanups = [];
  const servers = [];
  let stub = null;
  try {
    // ══ pure ═══════════════════════════════════════════════════════════════════════════════
    console.log('the pull: token, checks, delta');
    await test('LEDGER_TOKEN unset, short, with whitespace, or equal to DASHBOARD_TOKEN: the pull is off, and the line says why without the value', () => {
      assert.deepStrictEqual(pull.ledgerTokenStatus({}), { on: false, why: 'LEDGER_TOKEN is not set' });
      assert.match(pull.ledgerTokenStatus({ LEDGER_TOKEN: 'a'.repeat(31) }).why, /shorter than 32 characters/);
      assert.match(pull.ledgerTokenStatus({ LEDGER_TOKEN: 'a'.repeat(20) + ' ' + 'b'.repeat(20) }).why, /whitespace/);
      assert.match(pull.ledgerTokenStatus({ LEDGER_TOKEN: LEDGER, DASHBOARD_TOKEN: LEDGER }).why, /DASHBOARD_TOKEN/);
      assert.strictEqual(pull.ledgerTokenStatus({ LEDGER_TOKEN: LEDGER }).on, true);
      assert.strictEqual(pull.ledgerTokenStatus({ LEDGER_TOKEN: ' ' + LEDGER + '\n' }).on, true, 'a pasted trailing newline is trimmed');
      for (const env of [{}, { LEDGER_TOKEN: 'short-one' }, { LEDGER_TOKEN: LEDGER }]) assert.ok(!pull.bootLine(env).includes(LEDGER) && !pull.bootLine(env).includes('short-one'));
      assert.match(pull.bootLine({}), /^\[money-import\] the dashboard pull is OFF: LEDGER_TOKEN is not set/);
    });
    await test('an export is checked before it is staged: hash, count, per-store counts, app and version', () => {
      const s = createStub({ token: LEDGER });
      fx.seedDashboard(s);
      const good = s.build(null);
      assert.deepStrictEqual(pull.verifyExport(good), { ok: true, problems: [] });
      const bad = (mut) => { const b = JSON.parse(JSON.stringify(good)); mut(b); return pull.verifyExport(b); };
      assert.match(bad((b) => { b.hash = 'f'.repeat(64); }).problems.join(), /hash does not match/);
      assert.match(bad((b) => { b.count += 1; }).problems.join(), /count says/);
      assert.match(bad((b) => { b.counts.sessions -= 1; }).problems.join(), /counts\.sessions/);
      assert.match(bad((b) => { b.records.pop(); }).problems.join(), /count says .* records came/);
      assert.match(bad((b) => { b.app = 'other'; }).problems.join(), /wsop-console/);
      assert.match(bad((b) => { b.version = 2; }).problems.join(), /version/);
      assert.match(bad((b) => { b.local['wsop-staking'].value.push({ id: 'x' }); }).problems.join(), /hash does not match/);
    });
    await test('the delta re-pulls from the cursor less 14 days: a record stamped 3 days before the cursor is in, 15 days is not', () => {
      const C = fx.T0;
      assert.strictEqual(pull.deltaSince(C), C - 14 * DAY);
      assert.strictEqual(pull.DELTA_MARGIN_MS, 14 * DAY);
      assert.strictEqual(pull.deltaSince(0), null);
      const s = createStub({ token: LEDGER });
      s.put('sessions', 'late', { id: 'late' }, C - 3 * DAY);
      s.put('sessions', 'too-late', { id: 'too-late' }, C - 15 * DAY);
      const ids = s.build(pull.deltaSince(C)).records.map((r) => r.id);
      assert.deepStrictEqual(ids, ['late']);
      assert.deepStrictEqual(s.build(C).records, [], 'a strict since = cursor would miss it');
    });

    console.log('rooms and scoring (§9.1)');
    await test('the server copy of the room aliases is exactly what VENUE_MAP says', async () => {
      globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
      globalThis.window = globalThis.window || globalThis;
      const m = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'vite-app', 'src', 'utils', 'utils.js')).href);
      const want = new Map();
      for (const [k, v] of Object.entries(m.VENUE_MAP)) { want.set(k, v.abbr); if (v.longName && !want.has(v.longName)) want.set(v.longName, v.abbr); }
      assert.deepStrictEqual(ALIASES, [...want]);
    });
    await test('roomKey folds aliases and noise words; scores 3 / 2 / 0 / -3', () => {
      assert.strictEqual(S.roomKey('Parx'), S.roomKey('Parx Casino'));
      assert.strictEqual(S.roomKey('Borgata'), S.roomKey('Borgata Hotel Casino & Spa'));
      assert.strictEqual(S.roomKey('WSOP.com'), S.roomKey('WSOP Online'));
      assert.strictEqual(S.roomKey('Horseshoe Las Vegas'), S.roomKey('Horseshoe / Paris Las Vegas'));
      assert.strictEqual(S.roomScore('Parx', 'PARX casino'), 3);
      assert.strictEqual(S.roomScore('Live! Casino', 'Live! Casino Philadelphia'), 2);
      assert.strictEqual(S.roomScore('Parx', ''), 0);
      assert.strictEqual(S.roomScore('Wynn', 'Aria'), -3);
    });
    await test('scoring classes on crafted pairs: late night ±1 day, unequal nets, deposits, expenses; one to one', () => {
      const d = { date: '2026-03-05', room: 'Parx', in: 500, out: 1300, result: 800, hours: 6 };
      assert.strictEqual(S.scoreCash(d, { ...d, date: '2026-03-04', room: 'Parx Casino' }).score, 10);                  // 2 + 3 + 3 + 1 + 1
      assert.strictEqual(S.classOf(S.scoreCash(d, { ...d, out: 1250, result: 750 }).score), 'possible');                 // 3 + 3 - 2 + 0 + 1 = 5
      assert.strictEqual(S.scoreCash(d, { ...d, date: '2026-03-07' }), null);                                           // out of the window
      assert.strictEqual(S.classOf(S.scoreCash(d, { ...d, room: 'Aria', hours: 2 }).score), null);                       // 3 - 3 + 3 + 1 = 4
      assert.strictEqual(S.scoreAdjustment({ kind: 'deposit', date: '2026-05-03', amount: 2000 }, { kind: 'deposit', date: '2026-05-01', amount: 2000 }).score, 6);
      assert.strictEqual(S.scoreAdjustment({ kind: 'deposit', date: '2026-05-03', amount: 2000 }, { kind: 'withdrawal', date: '2026-05-03', amount: -2000 }), null);
      assert.strictEqual(S.scoreExpense({ date: '2026-06-10', amount: 412.5, category: 'travel' }, { date: '2026-06-10', amount: 412.5, category: 'travel' }).score, 8);
      assert.strictEqual(S.scoreExpense({ date: '2026-06-10', amount: 412.5, category: 'travel' }, { date: '2026-06-11', amount: 412.5, category: 'travel' }), null);
      const won = S.pairUp([
        { dashKey: 'a', hereKey: 'h1', score: 8, dayDiff: 1 }, { dashKey: 'b', hereKey: 'h1', score: 10, dayDiff: 0 },
        { dashKey: 'a', hereKey: 'h2', score: 5, dayDiff: 0 }, { dashKey: 'c', hereKey: 'h3', score: 4, dayDiff: 0 }]);
      assert.deepStrictEqual(won.map((p) => [p.dashKey, p.hereKey, p.class]), [['b', 'h1', 'likely'], ['a', 'h2', 'possible']]);
    });
    await test('mapping helpers: 12:00 New York in winter and summer, stakes and notes, fingerprints', () => {
      assert.strictEqual(M.etNoonIso('2026-02-01'), '2026-02-01T17:00:00.000Z');
      assert.strictEqual(M.etNoonIso('2026-06-01'), '2026-06-01T16:00:00.000Z');
      assert.strictEqual(M.etNoonIso('2026-03-08'), '2026-03-08T16:00:00.000Z', 'the spring-forward Sunday is EDT at noon');
      assert.deepStrictEqual(M.stakesAndNote('5/5/10 PLO', '5/5/10', 'PLO'), { stakes: '5/5/10', note: null });
      assert.deepStrictEqual(M.stakesAndNote('40/80 mix', null, 'mixed'), { stakes: '40/80', note: '40/80 mix' });
      assert.deepStrictEqual(M.stakesAndNote('$2-$5 NLH', null, 'NLH'), { stakes: '2/5', note: null });
      assert.strictEqual(M.fingerprintOf('sessions', 'chat-1a2b3c4d5e6f'), 'chat-1a2b3c4d5e6f');
      assert.strictEqual(M.fingerprintOf('sessions', 's-1'), 'dash:sessions:s-1');
      assert.strictEqual(M.fingerprintOf('adjustments', 'chat-x'), 'dash:adjustments:chat-x', 'only a session keeps a chat id verbatim');
      assert.strictEqual(M.personalStableId(7, 's-fund-1'), 'PERSONAL-7-dash-' + crypto.createHash('sha1').update('s-fund-1').digest('hex').slice(0, 12));
    });

    // ══ the world ══════════════════════════════════════════════════════════════════════════
    const scratch = await createScratch({ ports: PORTS, prefix: 'fg-money-import-' });
    cleanups.push(() => scratch.cleanup());
    let srv = await boot(scratch.dbPath, {}, { ports: PORTS });
    servers.push(srv);
    try {
      for (const [u, e] of [['adminx', 'adminx@x.test'], ['otheradmin', 'otheradmin@x.test'], ['plainuser', 'plainuser@x.test']]) {
        const r = await fetch(`http://127.0.0.1:${srv.port}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, email: e, password: PW, realName: u }) });
        assert.strictEqual(r.status, 201, 'register ' + u);
      }
    } finally { await srv.stop(); }
    const db0 = scratch.open();
    db0.run("UPDATE users SET username = 'ham' WHERE username = 'adminx'");
    db0.run("UPDATE users SET username = 'ham5' WHERE username = 'otheradmin'");
    const hamId = one(db0, "SELECT id FROM users WHERE username = 'ham'");
    const here = fx.seedHere(db0, hamId);
    scratch.save(db0);
    db0.close();

    const api = (s, method, p, { token, body } = {}) => fetch(`http://127.0.0.1:${s.port}${p}`, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) { /* not JSON */ } return { status: r.status, headers: r.headers, text, json }; });
    const login = async (s, email) => (await api(s, 'POST', '/api/login', { body: { email, password: PW } })).json.token;
    const BASE = '/api/bankrolls/import/dashboard';

    // ── the pull is off without the secret ──
    console.log('the pull is off without LEDGER_TOKEN');
    for (const [label, extra, re] of [['unset', {}, /the dashboard pull is OFF: LEDGER_TOKEN is not set/], ['31 characters', { LEDGER_TOKEN: 'z'.repeat(31) }, /the dashboard pull is OFF: LEDGER_TOKEN is shorter than 32 characters/]]) {
      const copy = path.join(scratch.tmp, `off-${label.replace(/\W/g, '')}.db`);
      fs.copyFileSync(scratch.dbPath, copy);
      const off = await boot(copy, extra, { ports: PORTS });
      servers.push(off);
      try {
        await test(`LEDGER_TOKEN ${label}: one clear boot line, and a fetch is a 503 that stages nothing`, async () => {
          await waitLog(off, re);
          const t = await login(off, 'adminx@x.test');
          const r = await api(off, 'POST', `${BASE}/fetch`, { token: t, body: {} });
          assert.strictEqual(r.status, 503);
          assert.match(r.json.error, /The dashboard pull is off on this server/);
          const list = await api(off, 'GET', BASE, { token: t });
          assert.strictEqual(list.json.pull.on, false);
          assert.deepStrictEqual(list.json.runs, []);
        });
      } finally { await off.stop(); }
    }

    // ── the stub dashboard, and the server with the secret ──
    stub = createStub({ token: LEDGER });
    fx.seedDashboard(stub);
    await stub.listen(await freePort(PORTS));
    srv = await boot(scratch.dbPath, { LEDGER_TOKEN: LEDGER, DASHBOARD_BASE_URL: `http://127.0.0.1:${stub.port}`, MONEY_IMPORT_FETCH_TIMEOUT_MS: '1500' }, { ports: PORTS });
    servers.push(srv);
    const ham = await login(srv, 'adminx@x.test');
    const ham5 = await login(srv, 'otheradmin@x.test');
    const plain = await login(srv, 'plainuser@x.test');
    const tokens = [fx.TOKEN.sam, fx.TOKEN.mo, fx.TOKEN.lee, fx.TOKEN.gone, fx.TOKEN.hist];
    const feeds = async () => Object.fromEntries(await Promise.all(tokens.map(async (t) => [t, (await api(srv, 'GET', `/api/backer/${t}/feed`)).text])));

    console.log('boot, gate, baseline');
    await test('boot log: the pull is available; the page reads console_records (BACKER_PAGE_SOURCE unset)', async () => {
      await waitLog(srv, /\[money-import\] the dashboard pull is available/);
      assert.match(srv.log(), /\[backers\] page source: console/);
      assert.match(scratch.bootLog, /Migration "money-import-2026-10" applied/);
    });
    const baselineFeeds = await feeds();
    await test('before the import: every page answers and the parity route lists nothing', async () => {
      for (const t of tokens) assert.ok(JSON.parse(baselineFeeds[t]).name !== undefined, t);
      const p = await api(srv, 'GET', '/api/staking/standing/parity', { token: ham });
      assert.deepStrictEqual(p.json.differ, []);
    });

    // ── refused pulls ──
    console.log('refused pulls stage nothing');
    const preFetchDump = await dumpFile(scratch.dbPath);
    for (const [mode, status, re] of [
      ['bad-hash', 502, /failed its checks.*hash does not match/],
      ['bad-count', 502, /failed its checks.*count says/],
      ['html', 502, /not JSON/],
      ['404', 502, /refused the pull \(404\)/],
      ['slow', 504, /did not answer within 1500 ms/],
    ]) {
      await test(`a ${mode} answer is refused (${status}) and nothing is staged`, async () => {
        stub.mode = mode;
        const r = await api(srv, 'POST', `${BASE}/fetch`, { token: ham, body: {} });
        stub.mode = 'ok';
        assert.strictEqual(r.status, status, r.text);
        assert.match(r.json.error, re);
        assert.deepStrictEqual((await api(srv, 'GET', BASE, { token: ham })).json.runs, []);
      });
    }

    // ── the full pull ──
    console.log('the first (rehearsal) pull: the plan');
    const f1 = await api(srv, 'POST', `${BASE}/fetch`, { token: ham, body: {} });
    const plan1 = f1.json && f1.json.plan;
    const runId1 = f1.json && f1.json.runId;
    await test('POST /fetch stages a run and returns its plan; the request carried the token in the header only', () => {
      assert.strictEqual(f1.status, 200, f1.text.slice(0, 500));
      assert.strictEqual(f1.json.mode, 'full');
      assert.strictEqual(f1.json.since, null);
      assert.match(f1.headers.get('cache-control') || '', /no-store/);
      const last = stub.requests[stub.requests.length - 1];
      assert.strictEqual(last.url, '/api/money-export');
      assert.strictEqual(last.auth, `Bearer ${LEDGER}`);
      assert.strictEqual(plan1.sourceHash, stub.build(null).hash);
    });
    await test('nothing is written on fetch: every table but the staging one is as it was', async () => {
      assert.deepStrictEqual(diffTables(preFetchDump, await dumpFile(scratch.dbPath)), []);
    });
    const row = (fp) => plan1.rows.find((r) => r.fp === fp);
    await test('§5.2 cash: a dashboard cash night is a cash session at 12:00 New York, time unknown, with its extras', () => {
      const r = row('dash:sessions:s-cash-3');
      assert.strictEqual(r.status, 'new');
      assert.strictEqual(r.kind, 'cash');
      assert.strictEqual(r.bankroll, 'target');
      assert.deepStrictEqual(r.rows, {
        cash_sessions: { started_at: '2026-02-01T17:00:00.000Z', ended_at: '2026-02-01T19:30:00.000Z', session_date: '2026-02-01', room: 'ACR', venue_slug: null,
          game: 'NLH', stakes: '', buy_in: 200, rebuys: 0, cash_out: 650, tips: 0, expenses: 0, currency: 'USD', notes: 'NL200 6-max', tags: '["zoom","6max"]', time_known: 0 },
        session_extras: { format: 'NLH', channel: 'online', hands: 800, mood_rating: null, tilt_note: 'stayed calm', journal: 'good session', origin: 'dashboard', origin_id: 's-cash-3', hours: null, tags: null },
      });
      assert.deepStrictEqual(r.exact, { roll: 449.85, fund: 0 });
      assert.deepStrictEqual(r.rounded, { roll: 450, fund: 0 });
      const fund2 = row('dash:sessions:s-fund-2');
      assert.strictEqual(fund2.bankroll, 'fund');
      assert.strictEqual(fund2.rows.cash_sessions.game, 'Mixed');
      assert.strictEqual(fund2.rows.cash_sessions.notes, '10/20 mix', 'a label that says more than stakes plus format goes into notes');
      assert.strictEqual(fund2.rows.cash_sessions.stakes, '10/20');
      assert.strictEqual(fund2.rows.cash_sessions.started_at, '2026-06-01T16:00:00.000Z');
      assert.deepStrictEqual(fund2.exact, { roll: 0, fund: -500 });
      assert.strictEqual(row('dash:sessions:s-bigo').rows.cash_sessions.game, 'Big O');
    });
    await test('§5.1 a chat-logged id is its own fingerprint, verbatim, with origin chat', () => {
      const r = row('chat-1a2b3c4d5e6f');
      assert.ok(r, 'the chat session is keyed by its id');
      assert.strictEqual(r.rows.session_extras.origin, 'chat');
      assert.strictEqual(r.rows.session_extras.origin_id, 'chat-1a2b3c4d5e6f');
      assert.strictEqual(r.rows.cash_sessions.stakes, '1/3');
    });
    await test('§5.2 tournaments: a Personal event with a deterministic stable_id, the room as property (and site online), the fund by bankroll', () => {
      const f = row('dash:sessions:s-fund-1');
      assert.strictEqual(f.kind, 'tournament');
      assert.strictEqual(f.bankroll, 'fund');
      assert.deepStrictEqual(f.rows.tournaments, {
        stable_id: M.personalStableId(hamId, 's-fund-1'), event_number: '', event_name: 'WSOP $1,500 PLO', date: '2026-05-20', time: '', buyin: 1500,
        game_variant: 'PLO', venue: 'Personal', notes: '', uploaded_by: hamId, total_entries: 1200, source_pdf: 'dashboard-import', is_online: 0, site: null, property: 'Horseshoe Las Vegas',
      });
      assert.deepStrictEqual(f.rows.tracking_entries, { num_entries: 1, cashed: 1, finish_place: 31, cash_amount: 4201, notes: 'Imported from the dashboard' });
      assert.strictEqual(f.rows.session_extras.hours, 9);
      assert.deepStrictEqual(f.exact, { roll: 0, fund: 2700.75 });
      assert.deepStrictEqual(f.rounded, { roll: 0, fund: 2701 });
      const o = row('dash:sessions:s-mtt-2');
      assert.strictEqual(o.rows.tournaments.is_online, 1);
      assert.strictEqual(o.rows.tournaments.site, 'WSOP.com');
      assert.strictEqual(o.rows.tournaments.property, 'WSOP.com');
      assert.strictEqual(o.rows.tournaments.buyin, 105);
      assert.strictEqual(o.rows.tournaments.game_variant, 'PLO8');
      assert.strictEqual(o.rows.tracking_entries.num_entries, 3);
      assert.strictEqual(o.rows.session_extras.tags, null);
      const r3 = row('dash:sessions:s-mtt-3');
      assert.strictEqual(r3.rows.tournaments.buyin, 133, '400 over 3 entries rounds per entry; the residue goes to the correction');
      assert.deepStrictEqual(r3.rounded, { roll: 601, fund: 0 });
      assert.ok(plan1.flags.rows.some((x) => x.fp === 'dash:sessions:s-mtt-3' && /not whole dollars/.test(x.flag)));
    });
    await test('§5.3 adjustments: sign follows the amount, corrections and settlements are kinds, a transfer is two legs with transfer_id dash:<id>', () => {
      const legs = (fp) => row(fp).legs.map(({ bankroll, kind, amount, transfer_id }) => [bankroll, kind, amount, transfer_id]);
      assert.deepStrictEqual(legs('dash:adjustments:a-wd-1'), [['target', 'withdrawal', -1500, null]]);
      assert.deepStrictEqual(legs('dash:adjustments:a-wd-pos'), [['target', 'deposit', 500, null]]);
      assert.deepStrictEqual(legs('dash:adjustments:a-corr'), [['target', 'correction', -37, null]]);
      assert.deepStrictEqual(legs('dash:adjustments:a-xfer-1'), [['target', 'transfer_out', -5000, 'dash:a-xfer-1'], ['fund', 'transfer_in', 5000, 'dash:a-xfer-1']]);
      assert.deepStrictEqual(legs('dash:adjustments:a-xfer-2'), [['fund', 'transfer_out', -1000, 'dash:a-xfer-2'], ['target', 'transfer_in', 1000, 'dash:a-xfer-2']]);
      assert.deepStrictEqual(legs('dash:adjustments:a-settle-1'), [['fund', 'settlement', -1260, null]]);
      assert.strictEqual(row('dash:adjustments:a-wd-1').legs[0].note, 'withdrawal · rent', 'the dashboard type survives in the note');
      assert.deepStrictEqual(plan1.flags.signs.map((s) => [s.id, s.note]), [['a-wd-pos', 'A withdrawal of +$500 — the dashboard added this to the roll, so it imports as a deposit.']]);
      assert.strictEqual(row('dash:adjustments:a-zero').status, 'skipped');
      assert.ok(!plan1.rows.some((r) => r.id === 'a-gone' || r.id === 's-gone'), 'a tombstone for a record never seen is ignored');
    });
    await test('§5.4 expenses: cents kept, meals become food, equipment and fees their own, affects_balance 0; other is listed with its total', () => {
      const tx = (id) => row('dash:expenses:' + id).rows.bankroll_transactions;
      assert.deepStrictEqual(tx('e-2'), { occurred_on: '2026-05-19', kind: 'expense', category: 'lodging', amount: 899.99, currency: 'USD', note: null, affects_balance: 0 });
      assert.strictEqual(tx('e-3').category, 'food');
      assert.strictEqual(tx('e-5').category, 'equipment');
      assert.strictEqual(tx('e-6').category, 'fees');
      assert.deepStrictEqual([plan1.flags.otherExpenses.count, plan1.flags.otherExpenses.total], [1, 20]);
    });
    await test('§5.2 errors: a result that is not cash-out minus buy-in is skipped and listed', () => {
      assert.deepStrictEqual(plan1.errors.find((e) => e.id === 's-err-1'), { fp: 'dash:sessions:s-err-1', store: 'sessions', id: 's-err-1', date: '2026-07-05', error: 'the result (250) is not cash-out minus buy-in (200)', skipped: false });
    });
    await test('§9.1 pairs FOUND: late night ±1 day, an alias room, unequal nets (Possible), a deposit ±2 days, an expense', () => {
      assert.deepStrictEqual(plan1.pairs.map((p) => [p.id, p.class, p.score, p.here.table, p.here.id]), [
        ['pair:dash:sessions:s-mtt-1', 'likely', 11, 'tracking_entries', here.feedE],
        ['pair:dash:sessions:s-cash-1', 'likely', 10, 'cash_sessions', here.h1],
        ['pair:dash:expenses:e-1', 'likely', 8, 'bankroll_transactions', here.tx1],
        ['pair:dash:adjustments:a-dep-1', 'possible', 6, 'bankroll_adjustments', here.dep1],
        ['pair:dash:sessions:s-cash-2', 'possible', 5, 'cash_sessions', here.h2],
      ]);
      const p2 = plan1.pairs.find((p) => p.id === 'pair:dash:sessions:s-cash-2');
      assert.strictEqual(p2.netsDiffer, true);
      assert.deepStrictEqual([p2.dash.result, p2.here.result], [1000, 950]);
      assert.strictEqual(plan1.pairs.find((p) => p.id === 'pair:dash:sessions:s-cash-1').same.result, true);
      assert.strictEqual(plan1.undecided, 5);
    });
    await test('§9.1 pairs NOT found: another room the same night, two days apart, a cash row against a tournament', () => {
      const paired = new Set(plan1.pairs.map((p) => p.dashId));
      for (const id of ['s-wynn', 's-dup-a', 's-dup-b', 's-mtt-2', 'chat-1a2b3c4d5e6f', 's-cash-3']) assert.ok(!paired.has(id), id);
      const hereIds = new Set(plan1.pairs.map((p) => `${p.here.table}:${p.here.id}`));
      for (const id of [here.h3, here.h4, here.h6, here.preD]) assert.ok(!hereIds.has(`cash_sessions:${id}`));
      assert.deepStrictEqual(plan1.inside, [{ date: '2026-07-20', room: 'Parx', result: 200, ids: ['s-dup-a', 's-dup-b'] }], 'two dashboard rows that look the same are listed, and both import');
    });
    await test('§7.1 backers: three live, one deleted in the dashboard (ended), one with history only (ended); tokens masked; a name match offered', () => {
      const b = Object.fromEntries(plan1.backers.map((x) => [x.fp, x]));
      const histFp = Object.keys(b).find((k) => k.startsWith('dash:backer-token:'));
      assert.deepStrictEqual(Object.keys(b).sort(), [histFp, 'dash:backers:b-gone', 'dash:backers:b-lee', 'dash:backers:b-mo', 'dash:backers:b-sam'].sort());
      assert.notStrictEqual(histFp, 'dash:backer-token:' + M.sha1(fx.TOKEN.hist).slice(0, 16), "a link-only backer's fingerprint is a keyed hash, not sha1 of the link");
      assert.deepStrictEqual([b['dash:backers:b-sam'].token, b['dash:backers:b-sam'].stakes, b['dash:backers:b-sam'].openingCents, b['dash:backers:b-sam'].agreement], ['Sa••••••', '20% PLO · 10% NLH (live)', 12550, 'active']);
      assert.deepStrictEqual(b['dash:backers:b-sam'].delivery, { sms: false, email: true });
      assert.deepStrictEqual([b['dash:backers:b-gone'].source, b['dash:backers:b-gone'].agreement, b['dash:backers:b-gone'].openingCents], ['deleted-in-dashboard', 'ended', 4000]);
      const hist = b[histFp];
      assert.deepStrictEqual([hist.source, hist.name, hist.agreement, hist.openingCents], ['history-only', 'Hist Only', 'ended', 0]);
      assert.deepStrictEqual(b['dash:backers:b-lee'].matches, [{ backerId: here.leeBacker, name: 'Lee Park' }]);
      assert.strictEqual(b['dash:backers:b-lee'].default, 'new');
      for (const t of tokens) assert.ok(!f1.text.includes(t), 'the plan carries a token');
      for (const s of ['sam@example.test', 'ari@example.test', '+15555550100']) assert.ok(!f1.text.includes(s), 'the plan carries an address or a number');
    });
    await test('§5.6 the slate: series per event, a settled deal linked to its settlement, unlinked ones listed; balances; the tax rate', () => {
      const d = Object.fromEntries(plan1.slate.deals.map((x) => [x.id, x]));
      assert.deepStrictEqual(d['d-1'].settlement, { adjustmentFp: 'dash:adjustments:a-settle-1', amount: -1260, date: '2026-05-25' });
      assert.strictEqual(d['d-4'].unlinked, true, 'settled in the dashboard with no payment found');
      assert.deepStrictEqual(plan1.slate.unlinkedSettlements.map((u) => u.fp), ['dash:adjustments:a-settle-2']);
      const sb = Object.fromEntries(plan1.slate.backers.map((x) => [x.key, x]));
      assert.strictEqual(sb['sam okafor'].default, 'roster:dash:backers:b-sam');
      assert.strictEqual(sb['dana slate'].default, 'new');
      assert.strictEqual(sb['unnamed slate backer'].unnamed, true);
      assert.deepStrictEqual(plan1.balances.map((x) => [x.id, x.name, x.amount]), [['bank', 'Bank', 30000], ['parx', 'Parx front', 1500.5]]);
      assert.deepStrictEqual(plan1.settings.taxSetAsidePct, { value: 28, status: 'new' });
      assert.strictEqual(plan1.fund.create, true);
      assert.deepStrictEqual([plan1.fund.name, plan1.fund.target, plan1.fund.targetDate], ['WSOP fund', 65000, '2027-05-03']);
    });
    await test('§9.2 recorded shares that disagree, and notify consistency, are listed for information', () => {
      assert.deepStrictEqual(plan1.divergences.map((x) => [x.sessionId, x.recorded.resultCents, x.now.resultCents, x.now.shareCents]), [['s-cash-2', 90000, 100000, 20000]]);
      assert.deepStrictEqual(plan1.consistency, { notifiedWithoutEvent: ['s-ghost'], eventWithoutNotified: ['g-old', 'h-old-1', 's-mtt-2'] });
      assert.deepStrictEqual(plan1.flags.onlineRoomsUnknown, ['Ace Poker Club']);
    });
    await test('§5.8 the opening deposit: startingRoll less what the roll held before the first dashboard day, rounded, the rest a reconciliation line', () => {
      assert.deepStrictEqual(plan1.opening, { date: '2026-02-01', amount: 14750, kind: 'deposit', override: false,
        computed: { amount: 14750.4, date: '2026-02-01', startingRoll: 25000.4, priorBalance: 10250, parts: { starts: 0, moved: 10000, results: 250 } } });
    });
    await test('§5.8 the reconciliation\'s dashboard figures are computeBankroll\'s on the same data (the oracle)', () => {
      const o = oracleOf(stub);
      assert.deepStrictEqual(plan1.reconciliation.dashboard, o);
      assert.strictEqual(plan1.reconciliation.provisional, true, 'with pairs unanswered the after figure assumes them');
    });

    // ── answers, refusals, commit ──
    console.log('the owner\'s answers and the commit');
    await test('commit refuses: no planHash (400), a planHash that is not the stored one (409), unanswered pairs (409)', async () => {
      assert.strictEqual((await api(srv, 'POST', `${BASE}/${runId1}/commit`, { token: ham, body: {} })).status, 400);
      const wrong = await api(srv, 'POST', `${BASE}/${runId1}/commit`, { token: ham, body: { planHash: 'x'.repeat(64) } });
      assert.strictEqual(wrong.status, 409); assert.strictEqual(wrong.json.stale, true);
      const und = await api(srv, 'POST', `${BASE}/${runId1}/commit`, { token: ham, body: { planHash: plan1.planHash } });
      assert.strictEqual(und.status, 409); assert.strictEqual(und.json.undecided, 5);
    });
    await test('PUT decisions refuses a bad answer and an unusable target', async () => {
      assert.strictEqual((await api(srv, 'PUT', `${BASE}/${runId1}/decisions`, { token: ham, body: { pairs: { 'pair:dash:sessions:s-cash-1': 'maybe' } } })).status, 400);
      assert.strictEqual((await api(srv, 'PUT', `${BASE}/${runId1}/decisions`, { token: ham, body: { backers: { 'dash:backers:b-sam': 999 } } })).status, 400);
      assert.strictEqual((await api(srv, 'PUT', `${BASE}/${runId1}/decisions`, { token: ham, body: { target: 999 } })).status, 400);
    });
    const d1 = await api(srv, 'PUT', `${BASE}/${runId1}/decisions`, { token: ham, body: {
      pairs: { 'pair:dash:sessions:s-cash-2': 'same-take', 'pair:dash:adjustments:a-dep-1': 'different' },
      fillLikely: 'same-keep',
      backers: { 'dash:backers:b-lee': here.leeBacker },
    } });
    await test('PUT decisions: answers stored, "same night" fills only the unanswered Likely pairs, the plan rebuilt', () => {
      assert.strictEqual(d1.status, 200, d1.text.slice(0, 300));
      assert.strictEqual(d1.json.plan.undecided, 0);
      assert.deepStrictEqual(Object.fromEntries(d1.json.plan.pairs.map((p) => [p.id, p.decision])), {
        'pair:dash:sessions:s-mtt-1': 'same-keep', 'pair:dash:sessions:s-cash-1': 'same-keep', 'pair:dash:expenses:e-1': 'same-keep',
        'pair:dash:adjustments:a-dep-1': 'different', 'pair:dash:sessions:s-cash-2': 'same-take' });
      assert.strictEqual(d1.json.plan.reconciliation.provisional, false);
      assert.notStrictEqual(d1.json.plan.planHash, plan1.planHash);
    });
    // Something here changes after the plan was read: the commit must not run on the old plan.
    const staleLog = await api(srv, 'POST', '/api/cash-sessions', { token: ham, body: { startedAt: '2026-09-10T22:00:00Z', endedAt: '2026-09-11T02:00:00Z', buyIn: 200, cashOut: 300, room: 'Harrah\'s', game: 'NLH', stakes: '1/2' } });
    await test('a result logged after the plan was read makes the commit refuse as stale (409), nothing written', async () => {
      assert.strictEqual(staleLog.status, 201, staleLog.text);
      const before = await dumpFile(scratch.dbPath);
      const r = await api(srv, 'POST', `${BASE}/${runId1}/commit`, { token: ham, body: { planHash: d1.json.plan.planHash } });
      assert.strictEqual(r.status, 409, r.text);
      assert.strictEqual(r.json.stale, true);
      assert.deepStrictEqual(diffTables(before, await dumpFile(scratch.dbPath)), []);
    });
    const g1 = await api(srv, 'GET', `${BASE}/${runId1}`, { token: ham });
    const preCommitDump = await dumpFile(scratch.dbPath);
    const c1 = await api(srv, 'POST', `${BASE}/${runId1}/commit`, { token: ham, body: { planHash: g1.json.plan.planHash } });
    const s1 = c1.json && c1.json.summary;
    await test('the re-read plan commits in one go and says what it wrote', () => {
      assert.strictEqual(g1.status, 200);
      assert.strictEqual(c1.status, 200, c1.text.slice(0, 500));
      assert.deepStrictEqual([s1.cash, s1.tournaments, s1.adjustments, s1.transfers, s1.settlements, s1.expenses, s1.backers, s1.agreements, s1.stakes, s1.series, s1.deals, s1.slateSettlements, s1.locations, s1.same, s1.linkedEvents],
        [7, 3, 4, 2, 2, 6, 6, 5, 5, 3, 4, 1, 2, 4, 3]);
      assert.deepStrictEqual(s1.taken, [{ pairId: 'pair:dash:sessions:s-cash-2', table: 'cash_sessions', id: here.h2, from: 950, to: 1000 }]);
      assert.deepStrictEqual(s1.opening, { amount: 14750, date: '2026-02-01' });
      assert.deepStrictEqual(s1.corrections, [{ side: 'roll', amount: -2, residue: -1.55 }], "the rows' cents (+1.95 here) and the opening's (−0.40)");
      assert.strictEqual(s1.fundCreated, true);
      assert.strictEqual(s1.undoCount, s1.created);
    });

    // ── what landed ──
    const S2 = await sqlJs();
    const look = () => new S2.Database(fs.readFileSync(scratch.dbPath));
    const q = (d, sql, p = []) => { const r = d.exec(sql, p); return r.length ? r[0].values.map((v) => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]]))) : []; };
    await test('the rows as written: keys (chat id verbatim), results in their bankrolls, legs, expenses, extras, the fund', () => {
      const d = look();
      const key = (fp) => q(d, 'SELECT * FROM bankroll_import_keys WHERE user_id = ? AND fingerprint = ?', [hamId, fp])[0];
      const fundId = s1.reconciliation.fundId;
      assert.deepStrictEqual(q(d, 'SELECT name, role, in_roll, target_amount, target_date, currency, starting_balance FROM bankrolls WHERE id = ?', [fundId])[0],
        { name: 'WSOP fund', role: 'fund', in_roll: 0, target_amount: 65000, target_date: '2027-05-03', currency: 'USD', starting_balance: 0 });
      const chat = key('chat-1a2b3c4d5e6f');
      assert.deepStrictEqual([chat.ref_table, chat.decision, chat.run_id], ['cash_sessions', 'imported', runId1]);
      const cs = q(d, 'SELECT * FROM cash_sessions WHERE id = ?', [chat.ref_id])[0];
      assert.deepStrictEqual([cs.time_known, cs.bankroll_id, cs.started_at, cs.buy_in, cs.cash_out, cs.room], [0, null, '2026-08-01T16:00:00.000Z', 300, 0, 'Parx']);
      const ff = key('dash:sessions:s-fund-1');
      const te = q(d, 'SELECT te.*, t.stable_id, t.venue, t.source_pdf FROM tracking_entries te JOIN tournaments t ON t.id = te.tournament_id WHERE te.id = ?', [ff.ref_id])[0];
      assert.deepStrictEqual([te.bankroll_id, te.stable_id, te.venue, te.source_pdf, te.cash_amount], [fundId, M.personalStableId(hamId, 's-fund-1'), 'Personal', 'dashboard-import', 4201]);
      assert.strictEqual(q(d, 'SELECT COUNT(*) AS n FROM user_schedules WHERE user_id = ?', [hamId])[0].n, 0, 'imported events are not put on the schedule');
      const x = key('dash:adjustments:a-xfer-1');
      const legs = q(d, "SELECT bankroll_id, kind, amount FROM bankroll_adjustments WHERE transfer_id = 'dash:a-xfer-1' ORDER BY id");
      assert.deepStrictEqual(legs, [{ bankroll_id: null, kind: 'transfer_out', amount: -5000 }, { bankroll_id: fundId, kind: 'transfer_in', amount: 5000 }]);
      assert.strictEqual(q(d, 'SELECT kind FROM bankroll_adjustments WHERE id = ?', [x.ref_id])[0].kind, 'transfer_out', 'the key points at the transfer_out leg');
      const st = q(d, 'SELECT kind, amount, bankroll_id, settlement_ref FROM bankroll_adjustments WHERE id = ?', [key('dash:adjustments:a-settle-1').ref_id])[0];
      const bs = q(d, 'SELECT * FROM backer_settlements')[0];
      assert.deepStrictEqual([st.kind, st.amount, st.bankroll_id, st.settlement_ref], ['settlement', -1260, fundId, 'bs:' + bs.id]);
      assert.deepStrictEqual([bs.amount_owed, bs.is_paid, bs.paid_at], [1260, 1, '2026-05-25']);
      assert.strictEqual(q(d, 'SELECT settlement_ref FROM bankroll_adjustments WHERE id = ?', [key('dash:adjustments:a-settle-2').ref_id])[0].settlement_ref, null);
      const tx = q(d, 'SELECT category, amount, affects_balance FROM bankroll_transactions WHERE id = ?', [key('dash:expenses:e-3').ref_id])[0];
      assert.deepStrictEqual(tx, { category: 'food', amount: 64.2, affects_balance: 0 });
      assert.deepStrictEqual([key('dash:expenses:e-1').decision, key('dash:expenses:e-1').ref_id], ['same', here.tx1]);
      assert.deepStrictEqual(q(d, 'SELECT buy_in, cash_out FROM cash_sessions WHERE id = ?', [here.h2])[0], { buy_in: 1000, cash_out: 2000 }, 'same-take moved the row to the dashboard\'s figures');
      assert.deepStrictEqual(q(d, 'SELECT buy_in, cash_out FROM cash_sessions WHERE id = ?', [here.h1])[0], { buy_in: 500, cash_out: 1300 }, 'same-keep wrote no money');
      assert.strictEqual(q(d, "SELECT mood_rating FROM session_extras WHERE ref_table = 'cash_sessions' AND ref_id = ?", [here.h1])[0].mood_rating, 4, 'same-keep filled the extras the row had none of');
      const op = q(d, 'SELECT kind, amount, occurred_on, bankroll_id FROM bankroll_adjustments WHERE id = ?', [key('dash:opening').ref_id])[0];
      assert.deepStrictEqual(op, { kind: 'deposit', amount: 14750, occurred_on: '2026-02-01', bankroll_id: null });
      assert.strictEqual(q(d, 'SELECT amount FROM bankroll_adjustments WHERE id = ?', [key('dash:rounding:main').ref_id])[0].amount, -2);
      assert.strictEqual(key('dash:rounding:fund'), undefined, 'the fund\'s remainder (-0.15) is under $0.50: no correction');
      assert.deepStrictEqual(q(d, 'SELECT data FROM money_settings WHERE user_id = ?', [hamId])[0], { data: '{"posting":"off","cutover":"imported","taxSetAsidePct":28}' });
      assert.deepStrictEqual(q(d, 'SELECT name, amount FROM money_locations ORDER BY sort_order'), [{ name: 'Bank', amount: 30000 }, { name: 'Parx front', amount: 1500.5 }]);
      d.close();
    });
    await test('backers: tokens verbatim on backers.public_token, agreements active or ended, stakes dated, the slate on its series', () => {
      const d = look();
      const by = Object.fromEntries(q(d, 'SELECT * FROM backers WHERE user_id = ?', [hamId]).map((b) => [b.public_token || b.name, b]));
      assert.strictEqual(by[fx.TOKEN.sam].name, 'Sam Okafor');
      assert.deepStrictEqual([by[fx.TOKEN.sam].notify_email, by[fx.TOKEN.sam].email, by[fx.TOKEN.mo].notify_sms, by[fx.TOKEN.mo].phone], [1, 'sam@example.test', 1, '+15555550100']);
      assert.strictEqual(by[fx.TOKEN.lee].id, here.leeBacker, 'Lee was matched to the existing staking backer');
      assert.ok(by[fx.TOKEN.gone] && by[fx.TOKEN.hist]);
      const ag = (bid) => q(d, 'SELECT * FROM standing_agreements WHERE backer_id = ?', [bid])[0];
      const today = M.etDay(Date.now());
      assert.deepStrictEqual([ag(by[fx.TOKEN.sam].id).status, ag(by[fx.TOKEN.sam].id).effective_from, ag(by[fx.TOKEN.sam].id).opening_cents], ['active', today, 12550]);
      assert.deepStrictEqual([ag(by[fx.TOKEN.gone].id).status, ag(by[fx.TOKEN.gone].id).effective_to, ag(by[fx.TOKEN.gone].id).opening_cents], ['ended', today, 4000]);
      assert.deepStrictEqual(q(d, 'SELECT format, channel, pct, valid_from, valid_to FROM standing_stakes WHERE agreement_id = ? ORDER BY id', [ag(by[fx.TOKEN.sam].id).id]),
        [{ format: 'PLO', channel: 'any', pct: 20, valid_from: today, valid_to: null }, { format: 'NLH', channel: 'live', pct: 10, valid_from: today, valid_to: null }]);
      const series = q(d, 'SELECT id, name, status FROM staking_series WHERE user_id = ? ORDER BY id', [hamId]);
      assert.deepStrictEqual(series.map((x) => [x.name, x.status]), [['WSOP $1,500 PLO', 'active'], ['WSOP $10K Main', 'active'], ['Old Event', 'settled']]);
      const deals = q(d, 'SELECT ba.percentage, ba.markup, ba.notes, b.name FROM backer_agreements ba JOIN backers b ON b.id = ba.backer_id ORDER BY ba.id');
      assert.deepStrictEqual(deals.map((x) => [x.name, x.percentage, x.notes]), [['Sam Okafor', 30, 'Slate buy-in $1500 (imported)'], ['Dana Slate', 10, 'Slate buy-in $1500 (imported)'],
        ['Unnamed slate backer', 50, 'Slate buy-in $10000 (imported)'], ['Lee Park', 20, 'Slate buy-in $500 (imported)']]);
      assert.strictEqual(by['Dana Slate'].public_token, null, 'a staking-only slate backer has no link');
      d.close();
    });
    await test('§6.8 the recorded shares: figures untouched, linked to the imported or matched result, a link revision each', () => {
      const d = look();
      const ev = Object.fromEntries(q(d, 'SELECT * FROM backer_events').map((e) => [e.id, e]));
      assert.deepStrictEqual([ev[`${fx.TOKEN.sam}:s-cash-1`].ref_table, ev[`${fx.TOKEN.sam}:s-cash-1`].ref_id], ['cash_sessions', here.h1]);
      assert.deepStrictEqual([ev[`${fx.TOKEN.sam}:s-cash-2`].ref_table, ev[`${fx.TOKEN.sam}:s-cash-2`].ref_id, ev[`${fx.TOKEN.sam}:s-cash-2`].share_cents], ['cash_sessions', here.h2, 18000]);
      assert.strictEqual(ev[`${fx.TOKEN.mo}:s-mtt-2`].ref_table, 'tracking_entries');
      assert.strictEqual(ev[`${fx.TOKEN.hist}:h-old-1`].ref_table, null);
      assert.deepStrictEqual(q(d, "SELECT action, cause, share_before, share_after FROM backer_event_revisions ORDER BY id").map((r) => r.action + '/' + r.cause), ['link/import', 'link/import', 'link/import']);
      d.close();
    });

    console.log('the ledger totals against the dashboard\'s computeBankroll (the oracle)');
    const fundId = s1.reconciliation.fundId;
    const pockets = async () => {
      const r = await api(srv, 'GET', '/api/bankrolls/summary?currency=USD', { token: ham });
      assert.strictEqual(r.status, 200);
      const roll = r.json.bankrolls.filter((b) => b.id !== fundId).reduce((a, b) => a + b.balance, 0);
      const fund = (r.json.bankrolls.find((b) => b.id === fundId) || { balance: 0 }).balance;
      return { roll: Math.round(roll * 100) / 100, fund };
    };
    await test('the roll is the oracle plus the listed lines, to the cent; every line is what the seed says; the fund apart, within its remainder', async () => {
      const o = oracleOf(stub);
      const got = await pockets();
      const L = s1.reconciliation.lines.roll;
      assert.deepStrictEqual(s1.reconciliation.dashboard, o);
      assert.deepStrictEqual(s1.reconciliation.after, got);
      assert.deepStrictEqual(s1.reconciliation.unexplained, { roll: 0, fund: 0 });
      // Lines the test knows from its own seed:
      assert.strictEqual(L.opening, -0.4, '10,250 here before 2026-02-01, plus the 14,750 deposit, less the 25,000.40 starting roll');
      assert.strictEqual(L.onlyHere, 300 + 200 + 500 - 315 + 1500 + 2000 + 100, 'the rows only here from the opening date (the "different" deposit included)');
      assert.strictEqual(L.pairs, -412.5, 'the expense kept as the same: it lowers this roll; the dashboard\'s never read expenses');
      assert.strictEqual(L.skipped, -250, 'the error row the dashboard counted');
      assert.strictEqual(L.editedHere, 0);
      assert.strictEqual(L.deletedThere, 0);
      assert.ok(Math.abs(L.rounding) < 0.5 && near(L.rounding, -0.05), 'the remainder after the -2 correction');
      assert.ok(near(got.roll - o.roll, L.opening + L.onlyHere + L.pairs + L.skipped + L.rounding), 'roll − oracle is the sum of the lines');
      assert.ok(Math.abs(got.fund - o.fund) < 0.5 && near(got.fund - o.fund, -0.15), 'the fund equals the oracle\'s within its remainder');
      assert.strictEqual(s1.reconciliation.fundWithinRemainder, true);
    });

    console.log('the backer pages and the parity route');
    await test('every backer\'s /b/ feed is byte-identical after the import (BACKER_PAGE_SOURCE unset)', async () => {
      assert.deepStrictEqual(await feeds(), baselineFeeds);
    });
    let sqlIds;
    await test('the parity route lists exactly the expected differences: the stale name, and the deleted backer\'s stakes and email', async () => {
      const p = await api(srv, 'GET', '/api/staking/standing/parity', { token: ham });
      assert.strictEqual(p.status, 200);
      const d = look();
      sqlIds = Object.fromEntries(q(d, 'SELECT id, public_token FROM backers WHERE public_token IS NOT NULL').map((b) => [b.public_token, b.id]));
      d.close();
      assert.deepStrictEqual(p.json.differ.map((x) => [x.backerId, x.fields]).sort((a, b) => a[0] - b[0]), [
        [sqlIds[fx.TOKEN.sam], ['name']],
        [sqlIds[fx.TOKEN.gone], ['stakes', 'digest']],
      ].sort((a, b) => a[0] - b[0]));
      const sam = p.json.differ.find((x) => x.backerId === sqlIds[fx.TOKEN.sam]);
      assert.deepStrictEqual(sam.detail.name, { console: 'Sam O.', sql: 'Sam Okafor' });
      const gone = p.json.differ.find((x) => x.backerId === sqlIds[fx.TOKEN.gone]);
      assert.deepStrictEqual(gone.detail.stakes, { console: '10% NLH', sql: '' });
      assert.deepStrictEqual(gone.detail.digest, { console: 'sends', sql: 'none' });
      assert.strictEqual(p.json.sqlBacked, 5);
      for (const t of tokens) assert.ok(!p.text.includes(t));
    });

    // ── a second pull of the same data ──
    console.log('a second import is idempotent');
    const f2 = await api(srv, 'POST', `${BASE}/fetch`, { token: ham, body: { mode: 'full' } });
    const dumpAfter1 = await dumpFile(scratch.dbPath);
    await test('the second pull plans nothing: every record unchanged, no pair, no row to write', () => {
      assert.strictEqual(f2.status, 200, f2.text.slice(0, 300));
      const p = f2.json.plan;
      assert.strictEqual(p.writes.rows, 0);
      assert.deepStrictEqual(p.pairs, []);
      assert.deepStrictEqual(p.rows.map((r) => [r.id, r.status]), [['s-err-1', 'error'], ['a-zero', 'skipped']]);
      assert.deepStrictEqual([p.changes, p.deletions, p.opening], [[], [], null]);
      assert.strictEqual(p.counts.sessions.unchanged + p.counts.tournaments.unchanged, 9 + 4);
    });
    const c2 = await api(srv, 'POST', `${BASE}/${f2.json.runId}/commit`, { token: ham, body: { planHash: f2.json.plan.planHash } });
    await test('and its commit writes nothing: every table byte-identical', async () => {
      assert.strictEqual(c2.status, 200, c2.text.slice(0, 300));
      assert.strictEqual(c2.json.summary.created, 0);
      assert.deepStrictEqual(diffTables(dumpAfter1, await dumpFile(scratch.dbPath)), []);
    });

    // ── the delta ──
    console.log('the delta pull');
    const cashId3 = one(look(), 'SELECT ref_id FROM bankroll_import_keys WHERE fingerprint = ?', ['dash:sessions:s-cash-3']);
    const edit = await api(srv, 'PUT', `/api/cash-sessions/${cashId3}`, { token: ham, body: { notes: 'edited here' } });
    fx.seedDelta(stub);
    const nReq = stub.requests.length;
    const f3 = await api(srv, 'POST', `${BASE}/fetch`, { token: ham, body: {} });
    const plan3 = f3.json && f3.json.plan;
    await test('a delta asks for since = cursor − 14 days, in the query, with the token in the header', () => {
      assert.strictEqual(edit.status, 200);
      assert.strictEqual(f3.status, 200, f3.text.slice(0, 300));
      assert.strictEqual(f3.json.mode, 'delta');
      const req = stub.requests[nReq];
      assert.strictEqual(req.url, `/api/money-export?since=${fx.T0 - 14 * DAY}`);
      assert.strictEqual(req.auth, `Bearer ${LEDGER}`);
      assert.strictEqual(f3.json.since, fx.T0 - 14 * DAY);
    });
    await test('the margin catches the late-synced older record; the re-sent unchanged ones cost nothing', () => {
      assert.deepStrictEqual(plan3.rows.filter((r) => r.status === 'new').map((r) => r.id), ['s-late-1']);
      assert.ok(plan3.counts.sessions.unchanged >= 2, 'records inside the margin come again and are unchanged');
      assert.deepStrictEqual(plan3.pairs, []);
    });
    await test('changed in the dashboard (apply), changed on both sides (a conflict: keep), deleted in the dashboard (remove), a backer changed', () => {
      const ch = Object.fromEntries(plan3.changes.map((c) => [c.itemId, c]));
      assert.deepStrictEqual([ch['dash:sessions:s-wynn'].default, ch['dash:sessions:s-wynn'].conflict], ['apply', false]);
      assert.deepStrictEqual([ch['dash:sessions:s-cash-3'].default, ch['dash:sessions:s-cash-3'].conflict], ['keep', true]);
      assert.deepStrictEqual([ch['dash:backers:b-mo'].default, ch['dash:backers:b-mo'].conflict], ['apply', false]);
      assert.deepStrictEqual(Object.keys(ch).sort(), ['dash:backers:b-mo', 'dash:sessions:s-cash-3', 'dash:sessions:s-wynn']);
      assert.deepStrictEqual(plan3.deletions.map((x) => [x.itemId, x.default]), [['dash:expenses:e-6', 'remove']]);
      assert.deepStrictEqual(plan3.reconciliation.dashboard, oracleOf(stub), 'the delta is reconciled against the whole dashboard, from the stored state');
      assert.strictEqual(plan3.opening, null);
    });
    const preDeltaDump = await dumpFile(scratch.dbPath);
    const c3 = await api(srv, 'POST', `${BASE}/${f3.json.runId}/commit`, { token: ham, body: { planHash: plan3.planHash } });
    await test('the delta commits: the change applied, the conflict kept, the deletion removed, the late night imported', async () => {
      assert.strictEqual(c3.status, 200, c3.text.slice(0, 300));
      const d = look();
      const key = (fp) => q(d, 'SELECT * FROM bankroll_import_keys WHERE user_id = ? AND fingerprint = ?', [hamId, fp])[0];
      assert.strictEqual(q(d, 'SELECT cash_out FROM cash_sessions WHERE id = ?', [key('dash:sessions:s-wynn').ref_id])[0].cash_out, 650);
      assert.deepStrictEqual(q(d, 'SELECT cash_out, notes FROM cash_sessions WHERE id = ?', [cashId3])[0], { cash_out: 650, notes: 'edited here' });
      assert.strictEqual(key('dash:expenses:e-6'), undefined);
      assert.ok(key('dash:sessions:s-late-1'));
      assert.strictEqual(q(d, 'SELECT opening_cents FROM standing_agreements WHERE id = ?', [key('dash:standing:b-mo').ref_id])[0].opening_cents, 5000);
      d.close();
      const o = oracleOf(stub);
      const got = await pockets();
      const s3 = c3.json.summary;
      assert.deepStrictEqual(s3.reconciliation.dashboard, o);
      assert.deepStrictEqual(s3.reconciliation.after, got);
      assert.deepStrictEqual(s3.reconciliation.unexplained, { roll: 0, fund: 0 });
      assert.strictEqual(s3.reconciliation.lines.roll.pairs, -412.5 - 49.85, 'the kept conflict: 450 here against 499.85 there');
      assert.deepStrictEqual([s3.changed, s3.kept, s3.removed], [2, 1, 1]);
    });

    // ── undo ──
    console.log('undo');
    await test('undo refuses out of order (a later import is committed), and with the wrong typed count', async () => {
      const r = await api(srv, 'POST', `${BASE}/${runId1}/undo`, { token: ham, body: { expect: s1.undoCount } });
      assert.strictEqual(r.status, 409); assert.match(r.json.error, /Undo the later import/);
      const w = await api(srv, 'POST', `${BASE}/${f3.json.runId}/undo`, { token: ham, body: { expect: 999 } });
      assert.strictEqual(w.status, 409); assert.strictEqual(w.json.expect, c3.json.summary.undoCount);
    });
    await test('undoing the delta restores every table byte for byte', async () => {
      const r = await api(srv, 'POST', `${BASE}/${f3.json.runId}/undo`, { token: ham, body: { expect: c3.json.summary.undoCount } });
      assert.strictEqual(r.status, 200, r.text);
      assert.deepStrictEqual(diffTables(preDeltaDump, await dumpFile(scratch.dbPath)), []);
      const u2 = await api(srv, 'POST', `${BASE}/${f2.json.runId}/undo`, { token: ham, body: { expect: 0 } });
      assert.strictEqual(u2.status, 200, u2.text);
    });
    await test('undo refuses when a row it would remove was edited since, and lists it', async () => {
      const r = await api(srv, 'POST', `${BASE}/${runId1}/undo`, { token: ham, body: { expect: s1.undoCount } });
      assert.strictEqual(r.status, 409, r.text);
      assert.deepStrictEqual(r.json.edited, [{ table: 'cash_sessions', id: cashId3, why: 'edited since the import' }]);
    });
    await test('with that row deleted by its owner, the rehearsal undoes: every table byte-identical to before the commit', async () => {
      assert.strictEqual((await api(srv, 'DELETE', `/api/cash-sessions/${cashId3}`, { token: ham })).status, 200);
      const r = await api(srv, 'POST', `${BASE}/${runId1}/undo`, { token: ham, body: { expect: s1.undoCount } });
      assert.strictEqual(r.status, 200, r.text);
      assert.strictEqual(r.json.missing, 1);
      assert.deepStrictEqual(diffTables(preCommitDump, await dumpFile(scratch.dbPath)), []);
      assert.deepStrictEqual(await feeds(), baselineFeeds);
      assert.deepStrictEqual((await api(srv, 'GET', '/api/staking/standing/parity', { token: ham })).json.differ, []);
      const list = (await api(srv, 'GET', BASE, { token: ham })).json.runs;
      assert.deepStrictEqual(list.filter((x) => x.id === runId1).map((x) => [x.status, x.payloadKept]), [['undone', false]], 'an undone run keeps no payload');
    });

    // ── the gate ──
    console.log('the gate');
    const staged = await api(srv, 'POST', `${BASE}/fetch`, { token: ham, body: {} });
    await test('every route is the owner\'s: no login 401, a plain user 403, another admin 403', async () => {
      assert.strictEqual(staged.status, 200);
      const id = staged.json.runId;
      for (const [m, p, body] of [['GET', BASE], ['POST', `${BASE}/fetch`, {}], ['GET', `${BASE}/${id}`], ['PUT', `${BASE}/${id}/decisions`, {}],
        ['POST', `${BASE}/${id}/commit`, { planHash: 'x' }], ['POST', `${BASE}/${id}/undo`, { expect: 0 }], ['DELETE', `${BASE}/${id}`]]) {
        assert.strictEqual((await api(srv, m, p, { body })).status, 401, `${m} ${p} without a login`);
        assert.strictEqual((await api(srv, m, p, { token: plain, body })).status, 403, `${m} ${p} as a plain user`);
        assert.strictEqual((await api(srv, m, p, { token: ham5, body })).status, 403, `${m} ${p} as another admin`);
      }
    });
    await test('LEDGER_TOKEN appeared in no URL and in no line of the server log', () => {
      for (const r of stub.requests) assert.ok(!r.url.includes(LEDGER));
      assert.ok(!srv.log().includes(LEDGER));
      assert.match(srv.log(), /\[money-import\] staged run #\d+: \d+ records/);
      assert.match(srv.log(), /\[money-import\] pull refused: The export failed its checks/);
    });
    await srv.stop();

    // ── the commit's own refusals, on the engine, against the database the server left ──
    await test('the commit refuses a payload that no longer matches its source hash, and a plan built from another source', async () => {
      const d = look();
      const run = engine.getRun(d, hamId, staged.json.runId);
      assert.strictEqual(run.status, 'staged');
      const tampered = JSON.parse(run.payload);
      tampered.records[0].updatedAt += 1;
      const a = engine.commit(d, hamId, { ...run, payload: JSON.stringify(tampered) }, { planHash: run.plan_hash });
      assert.strictEqual(a.status, 409); assert.match(a.body.error, /no longer matches the hash/);
      const b = engine.commit(d, hamId, { ...run, source_hash: 'f'.repeat(64) }, { planHash: run.plan_hash });
      assert.strictEqual(b.status, 409);
      d.close();
    });
    await test('the accepted cursor never moves back: an empty delta echoes its since, and the run keeps the last cursor', () => {
      const d = look();
      const since = 5000, base = 5000 + 14 * DAY;
      const counts = { sessions: 0, adjustments: 0, expenses: 0, backers: 0, settings: 0 };
      const empty = { app: 'wsop-console', version: 1, mode: 'delta', since, cursor: since, count: 0, deleted: 0, counts, localCount: 0, records: [], local: {}, hash: pull.payloadHash([], {}) };
      assert.deepStrictEqual(pull.verifyExport(empty, { since }), { ok: true, problems: [] });
      const { runId } = engine.stage(d, hamId, empty, { mode: 'delta', since, baseCursor: base });
      assert.strictEqual(engine.getRun(d, hamId, runId).cursor, base);
      d.close();
    });

    // ══ a clean account: the roll IS computeBankroll ══════════════════════════════════════
    console.log('a clean account: the roll equals computeBankroll');
    const clean = await createScratch({ ports: PORTS, prefix: 'fg-money-import-clean-' });
    cleanups.push(() => clean.cleanup());
    let cs = await boot(clean.dbPath, {}, { ports: PORTS });
    servers.push(cs);
    try {
      const r = await fetch(`http://127.0.0.1:${cs.port}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'adminx', email: 'adminx@x.test', password: PW, realName: 'x' }) });
      assert.strictEqual(r.status, 201);
    } finally { await cs.stop(); }
    const dc = clean.open(); dc.run("UPDATE users SET username = 'ham' WHERE username = 'adminx'"); clean.save(dc); dc.close();
    const cleanStub = createStub({ token: LEDGER });
    fx.seedDashboard(cleanStub, { clean: true });
    await stub.close(); stub = null;
    await cleanStub.listen(await freePort(PORTS));
    stub = cleanStub;
    cs = await boot(clean.dbPath, { LEDGER_TOKEN: LEDGER, DASHBOARD_BASE_URL: `http://127.0.0.1:${cleanStub.port}` }, { ports: PORTS });
    servers.push(cs);
    await test('with nothing here before, the roll after the import is the dashboard\'s roll and the fund its fund, within the rounding remainder', async () => {
      const t = await login(cs, 'adminx@x.test');
      const f = await api(cs, 'POST', `${BASE}/fetch`, { token: t, body: {} });
      assert.strictEqual(f.status, 200, f.text.slice(0, 300));
      assert.strictEqual(f.json.plan.undecided, 0);
      // Q3: the opening deposit is editable in the review, and the edit can be taken back.
      const ed = await api(cs, 'PUT', `${BASE}/${f.json.runId}/decisions`, { token: t, body: { opening: { amount: 24000, date: '2026-01-31' } } });
      assert.strictEqual(ed.status, 200, ed.text.slice(0, 300));
      assert.deepStrictEqual([ed.json.plan.opening.amount, ed.json.plan.opening.date, ed.json.plan.opening.override, ed.json.plan.opening.computed.amount], [24000, '2026-01-31', true, 25000.4]);
      assert.ok(near(ed.json.plan.reconciliation.after.roll - f.json.plan.reconciliation.after.roll, -1000, 1.01), 'the typed figure is what the roll would get');
      const back = await api(cs, 'PUT', `${BASE}/${f.json.runId}/decisions`, { token: t, body: { opening: null } });
      assert.deepStrictEqual([back.json.plan.opening.amount, back.json.plan.opening.override], [25000, false]);
      assert.strictEqual(back.json.plan.planHash, f.json.plan.planHash, 'taking the edit back is the plan as first read');
      const c = await api(cs, 'POST', `${BASE}/${f.json.runId}/commit`, { token: t, body: { planHash: back.json.plan.planHash } });
      assert.strictEqual(c.status, 200, c.text.slice(0, 300));
      const fid = c.json.summary.reconciliation.fundId;
      const sum = await api(cs, 'GET', '/api/bankrolls/summary?currency=USD', { token: t });
      const roll = sum.json.bankrolls.filter((b) => b.id !== fid).reduce((a, b) => a + b.balance, 0);
      const fund = sum.json.bankrolls.find((b) => b.id === fid).balance;
      const o = oracleOf(cleanStub);
      assert.ok(Math.abs(roll - o.roll) < 0.5, `roll ${roll} vs the oracle's ${o.roll}`);
      assert.ok(Math.abs(fund - o.fund) < 0.5, `fund ${fund} vs the oracle's ${o.fund}`);
      const L = c.json.summary.reconciliation.lines.roll;
      assert.deepStrictEqual([L.onlyHere, L.pairs, L.skipped, L.editedHere, L.deletedThere], [0, 0, 0, 0, 0]);
      assert.ok(near(roll - o.roll, L.opening + L.rounding));
    });
  } catch (err) {
    console.log('  FAIL (setup)\n       ' + (err && err.stack ? err.stack.split('\n').slice(0, 8).join('\n       ') : err));
    process.exitCode = 1;
  } finally {
    for (const s of servers) { try { await s.stop(); } catch (_) { /* gone */ } }
    if (stub) { try { await stub.close(); } catch (_) { /* gone */ } }
    for (const c of cleanups) c();
  }
  if (process.exitCode) { process.stdout.write('\nmoney-import.test.js - setup failed\n', () => process.exit(1)); return; }
  done();
})();
