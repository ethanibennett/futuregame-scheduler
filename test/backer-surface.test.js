// The backer surface (docs/bankroll-merge.md §6.7, §7.6): lib/backer-surface.js against a database
// whose schema is the REAL one (server.js is booted once on a scratch DB so every dataMigration has
// run, then the file is opened in this process).
//
//   node test/backer-surface.test.js        (npm run test:backer-surface)
//
// The thing this exists to prove: every existing /b/<token> link keeps working with its history,
// before and after. test/helpers/legacy-backer-surface.js holds the feed and the weekly digest
// exactly as server.js had them at origin/master 4a19a4b, verbatim. The new code's default path is
// compared with that oracle BYTE FOR BYTE on dashboard-era data (console_records roster records,
// backer_public names, backer_events), including the awkward cases (a deleted record, a malformed
// one, a token only a name row knows, a 250-session history). Then the SQL path is compared with it
// for backers mirrored into the merged tables, and the parity function is shown to find exactly
// the differences that are there.
//
// Boots server.js once on a scratch port (4540-4549, never 3001) with a scratch DB and the
// production secrets scrubbed (test/helpers/scratch-server.js). Every name, token, address and
// figure is invented.
'use strict';
const assert = require('assert');
const surface = require('../lib/backer-surface');
const { legacyFeed, legacyDigests, legacyRelayMessages } = require('./helpers/legacy-backer-surface');
const { createScratch, sqlJs, one, rowsOf, runner } = require('./helpers/scratch-server');
const fx = require('./helpers/backer-fixtures');
const { seedDashboardEra, mirror, recOf, allTokens: ALL_TOKENS } = fx;

const { NOW, TODAY, DAY } = fx;
const feedJson = (db, token, opts) => JSON.stringify(surface.buildFeed(db, token, { today: TODAY, ...opts }));
const legacyJson = (db, token) => JSON.stringify(legacyFeed(db, token));

(async () => {
  const { test, done } = runner('backer-surface.test.js');
  const SQL = await sqlJs();
  const scratch = await createScratch();
  const fresh = () => { const db = scratch.open(); const tk = seedDashboardEra(db); return { db, tk }; };
  try {
    // ── the two switches ────────────────────────────────────────────────────
    console.log('the delivery gate and the page-source switch');
    await test('delivery: on in production (RENDER), off everywhere else, an explicit BACKER_DELIVERY wins', () => {
      const cases = [
        [{}, false], [{ RENDER: '' }, false], [{ RENDER: 'false' }, false], [{ RENDER: '0' }, false],
        [{ RENDER: 'true' }, true], [{ RENDER: '1' }, true],
        [{ BACKER_DELIVERY: '1' }, true], [{ BACKER_DELIVERY: 'true' }, true], [{ BACKER_DELIVERY: ' 1 ' }, true], [{ BACKER_DELIVERY: 'ON' }, true],
        [{ BACKER_DELIVERY: '0' }, false], [{ BACKER_DELIVERY: 'false' }, false],
        [{ RENDER: 'true', BACKER_DELIVERY: '0' }, false], [{ BACKER_DELIVERY: '1', RENDER: '' }, true],
      ];
      for (const [env, want] of cases) assert.strictEqual(surface.deliveryOn(env), want, JSON.stringify(env));
    });
    await test('delivery: a value it does not recognise is OFF, even on Render (a typo must never text a backer), and says why', () => {
      for (const env of [{ BACKER_DELIVERY: 'maybe' }, { RENDER: 'true', BACKER_DELIVERY: 'yes please' }]) {
        const d = surface.deliveryDecision(env);
        assert.strictEqual(d.on, false, JSON.stringify(env));
        assert.match(d.why, /does not recognise/);
      }
      assert.match(surface.deliveryDecision({}).why, /neither BACKER_DELIVERY nor RENDER/);
      assert.match(surface.deliveryDecision({ RENDER: 'true' }).why, /RENDER is set/);
    });
    await test('page source: console unless BACKER_PAGE_SOURCE is sql', () => {
      assert.strictEqual(surface.pageSource({}), 'console');
      assert.strictEqual(surface.pageSource({ BACKER_PAGE_SOURCE: 'sql' }), 'sql');
      assert.strictEqual(surface.pageSource({ BACKER_PAGE_SOURCE: ' SQL ' }), 'sql');
      for (const v of ['', 'console', 'yes', '1', 'true']) assert.strictEqual(surface.pageSource({ BACKER_PAGE_SOURCE: v }), 'console', v);
    });

    // ── the default path is the old code ────────────────────────────────────
    console.log('every existing link, before and after: the default path against the old code');
    await test('the feed is byte for byte what origin/master served, for every token in a dashboard-era database', () => {
      const { db } = fresh();
      const tokens = ALL_TOKENS(db);
      assert.ok(tokens.length >= 11, 'the fixture is rich: ' + tokens.length);
      for (const t of tokens) {
        assert.strictEqual(feedJson(db, t, { source: 'console' }), legacyJson(db, t), t);
      }
      db.close();
    });
    await test('the fixture really exercises the awkward cases (so the comparison above means something)', () => {
      const { db, tk } = fresh();
      const f = (t) => JSON.parse(legacyJson(db, t));
      assert.strictEqual(f('GoneInDash1').name, 'Deleted In Dashboard', 'a deleted record: the name comes from backer_public');
      assert.deepStrictEqual([f('GoneInDash1').stakes, f('GoneInDash1').openingCents], ['', 0], 'and no stakes or opening');
      assert.strictEqual(f('HistoryOnly1').stakes, '');
      assert.strictEqual(f('HistoryOnly1').sessions, 3);
      assert.strictEqual(f('LongHist001').events.length, 200);
      assert.strictEqual(f('LongHist001').sessions, 250, 'the totals are over every session');
      assert.strictEqual(f('OddGames1').stakes, '12.5% PLO5 (live) · 5% Stud8 · 5% 2-7 · 7% Big O (online) · 1% all games');
      assert.strictEqual(f('OddGames1').openingCents, 1235, 'opening rounds as it always did: 12.345 dollars');
      assert.strictEqual(f('NoNameTok1').name, null);
      assert.deepStrictEqual([f('Unknown0Token1').name, f('Unknown0Token1').sessions], [null, 0]);
      assert.ok(f(tk.full).events.length > 30);
      db.close();
    });
    await test('with the switch ON but no backers row owning any token, every page is still the old one (the fallback)', () => {
      const { db } = fresh();
      for (const t of ALL_TOKENS(db)) assert.strictEqual(feedJson(db, t, { source: 'sql' }), legacyJson(db, t), t);
      db.close();
    });
    await test('a database the money-merge migration never reached still serves the old page in either mode', () => {
      const bare = new SQL.Database();
      bare.run('CREATE TABLE console_records (store TEXT NOT NULL, id TEXT NOT NULL, data TEXT, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (store, id))');
      bare.run('CREATE TABLE backer_public (token TEXT PRIMARY KEY, name TEXT, updated_at INTEGER)');
      bare.run(`CREATE TABLE backer_events (id TEXT PRIMARY KEY, token TEXT NOT NULL, session_id TEXT NOT NULL, ts INTEGER NOT NULL, date TEXT, game TEXT, venue TEXT,
        hours REAL, session_result_cents INTEGER, pct REAL, share_cents INTEGER, UNIQUE (token, session_id))`);
      fx.addRoster(bare, { id: 'a', token: 'BareToken01', name: 'Bare', stakes: [{ format: 'PLO', pct: 20, channel: 'any' }], opening: 5 });
      bare.run("INSERT INTO backer_events (id, token, session_id, ts, date, game, venue, hours, session_result_cents, pct, share_cents) VALUES ('x', 'BareToken01', 's', 1, '2026-01-01', 'g', 'v', 1, 100, 20, 20)");
      for (const source of ['console', 'sql']) assert.strictEqual(feedJson(bare, 'BareToken01', { source }), legacyJson(bare, 'BareToken01'), source);
      bare.close();
    });

    // ── the SQL path ────────────────────────────────────────────────────────
    console.log('the SQL path: backers + standing agreements, with the old store as the fallback');
    await test('backers mirrored into the merged tables serve the identical page (the three kinds of §7.1)', () => {
      const { db, tk } = fresh();
      // 1. the live roster
      for (const t of [tk.full, tk.empty, tk.one, tk.two, 'OddGames1', 'LongHist001']) mirror(db, recOf(db, t));
      // 3. history only: a name row and events, no record anywhere -> an ended agreement, opening 0
      fx.addSqlBacker(db, { userId: 1, name: 'History Only', token: 'HistoryOnly1', agreements: [{ status: 'ended', to: '2026-09-30', openingCents: 0, stakes: [] }] });
      for (const t of [tk.full, tk.empty, tk.one, tk.two, 'OddGames1', 'LongHist001', 'HistoryOnly1']) {
        assert.strictEqual(feedJson(db, t, { source: 'sql' }), legacyJson(db, t), t);
      }
      // 2. everyone else is still the old page
      for (const t of ['GoneInDash1', 'NoNameTok1', 'Unknown0Token1', 'SubOnly0001']) assert.strictEqual(feedJson(db, t, { source: 'sql' }), legacyJson(db, t), t);
      db.close();
    });
    await test('a game the dashboard never had reads by its own label; the dashboard\'s nine keep the labels its page has always shown', () => {
      const { db } = fresh();
      fx.addSqlBacker(db, { userId: 1, name: 'Many Games', token: 'ManyGames1', agreements: [{ stakes: [
        { format: 'PLO5', pct: 5 }, { format: 'PLO6_8', pct: 6, channel: 'live' }, { format: 'stud8', pct: 7 }, { format: '2-7', pct: 8 },
        { format: '2-7sd', pct: 9 }, { format: 'dealers-choice', pct: 4 }, { format: 'all', pct: 1, channel: 'online' }] }] });
      assert.strictEqual(surface.buildFeed(db, 'ManyGames1', { source: 'sql', today: TODAY }).stakes,
        "5% PLO5 · 6% PLO6 8/b (live) · 7% Stud8 · 8% 2-7 · 9% 2-7 single draw · 4% Dealer's choice · 1% all games (online)");
      db.close();
    });
    await test('only the stakes in force TODAY are shown, windows inclusive at both ends', () => {
      const { db } = fresh();
      fx.addSqlBacker(db, { userId: 1, name: 'Dated', token: 'DatedStakes1', agreements: [{ from: '2026-01-01', stakes: [
        { format: 'PLO', pct: 20, from: '2026-01-01', to: '2026-10-13' },   // closed yesterday
        { format: 'PLO', pct: 25, from: '2026-10-14' },                      // opens today
        { format: 'NLH', pct: 10, from: '2026-10-15' },                      // opens tomorrow
        { format: 'razz', pct: 5, from: '2026-01-01', to: '2026-10-14' }] }] }); // closes today
      assert.strictEqual(surface.buildFeed(db, 'DatedStakes1', { source: 'sql', today: '2026-10-14' }).stakes, '25% PLO · 5% Razz');
      assert.strictEqual(surface.buildFeed(db, 'DatedStakes1', { source: 'sql', today: '2026-10-13' }).stakes, '20% PLO · 5% Razz');
      assert.strictEqual(surface.buildFeed(db, 'DatedStakes1', { source: 'sql', today: '2026-10-15' }).stakes, '25% PLO · 10% NLH');
      db.close();
    });
    await test('an ended agreement keeps the page and its history but shows no stakes; its opening still counts', () => {
      const { db, tk } = fresh();
      mirror(db, recOf(db, tk.full), { status: 'ended' });
      const sql = surface.buildFeed(db, tk.full, { source: 'sql', today: TODAY });
      const old = JSON.parse(legacyJson(db, tk.full));
      assert.strictEqual(sql.stakes, '');
      assert.notStrictEqual(old.stakes, '');
      assert.strictEqual(sql.openingCents, old.openingCents);
      assert.strictEqual(sql.cumulativeCents, old.cumulativeCents);
      assert.deepStrictEqual(sql.events, old.events);
      db.close();
    });
    await test('the opening is the sum of every agreement\'s, so a new agreement carries the running total on', () => {
      const { db } = fresh();
      fx.addSqlBacker(db, { userId: 1, name: 'Two Agreements', token: 'TwoAgree001', agreements: [
        { status: 'ended', to: '2026-06-30', openingCents: 10000, stakes: [{ format: 'PLO', pct: 20 }] },
        { status: 'active', from: '2026-07-01', openingCents: -2500, stakes: [{ format: 'NLH', pct: 10, from: '2026-07-01' }] }] });
      fx.addEvent(db, { token: 'TwoAgree001', sessionId: 'a', result: 100000, pct: 10, share: 10000 });
      const f = surface.buildFeed(db, 'TwoAgree001', { source: 'sql', today: TODAY });
      assert.strictEqual(f.openingCents, 7500);
      assert.strictEqual(f.stakes, '10% NLH');
      assert.strictEqual(f.cumulativeCents, 10000 + 7500);
      db.close();
    });
    await test('a backers row with a link but no agreement yet: its own name, no stakes, opening 0', () => {
      const { db } = fresh();
      fx.addSqlBacker(db, { userId: 1, name: 'Series Only', token: 'SeriesOnly1' });
      const f = surface.buildFeed(db, 'SeriesOnly1', { source: 'sql', today: TODAY });
      assert.deepStrictEqual([f.name, f.stakes, f.openingCents, f.sessions], ['Series Only', '', 0, 0]);
      db.close();
    });
    await test('name precedence (§6.7): backers.name first, the last notify\'s name second; a rename is no longer shadowed', () => {
      const { db, tk } = fresh();
      mirror(db, recOf(db, tk.full));
      assert.strictEqual(surface.buildFeed(db, tk.full, { source: 'sql', today: TODAY }).name, 'Sam Okafor');
      db.run('UPDATE backers SET name = ? WHERE public_token = ?', ['Samuel Okafor', tk.full]);
      assert.strictEqual(surface.buildFeed(db, tk.full, { source: 'sql', today: TODAY }).name, 'Samuel Okafor', 'the SQL name wins');
      assert.strictEqual(surface.buildFeed(db, tk.full, { source: 'console', today: TODAY }).name, 'Sam Okafor', 'the old path still shows the last notify\'s');
      db.close();
    });
    await test('the history is the same table either way: events, totals and order do not depend on the source', () => {
      const { db, tk } = fresh();
      mirror(db, recOf(db, tk.full));
      const a = surface.buildFeed(db, tk.full, { source: 'console', today: TODAY });
      const b = surface.buildFeed(db, tk.full, { source: 'sql', today: TODAY });
      for (const k of ['events', 'sessions', 'hours', 'grossCents', 'netSessionCents', 'cumulativeCents']) assert.deepStrictEqual(b[k], a[k], k);
      db.close();
    });

    // ── parity ──────────────────────────────────────────────────────────────
    console.log('the parity route\'s engine');
    await test('everything mirrored faithfully: differ is empty, every token counted, none leaked', () => {
      const { db, tk } = fresh();
      for (const t of [tk.full, tk.empty, tk.one, tk.two, 'OddGames1']) mirror(db, recOf(db, t), { email: (recOf(db, t).delivery || {}).email || null });
      const p = surface.parity(db, { today: TODAY });
      assert.deepStrictEqual(p.differ, []);
      assert.strictEqual(p.tokens, p.identical);
      assert.strictEqual(p.sqlBacked, 5);
      assert.strictEqual(p.fallback, p.tokens - 5);
      assert.ok(p.tokens >= 10);
      assert.strictEqual(p.legacyBackerTokens, 0);
      db.close();
    });
    await test('it finds exactly the differences that are there, names the fields, and shows both sides', () => {
      const { db, tk } = fresh();
      for (const t of [tk.full, tk.empty, tk.one, tk.two]) mirror(db, recOf(db, t), { email: (recOf(db, t).delivery || {}).email || null });
      db.run('UPDATE backers SET name = ? WHERE public_token = ?', ['Priya R.', tk.empty]);                                  // a rename
      db.run('UPDATE standing_agreements SET opening_cents = opening_cents + 12345 WHERE backer_id = (SELECT id FROM backers WHERE public_token = ?)', [tk.one]); // opening
      db.run("UPDATE standing_agreements SET status = 'ended', effective_to = '2026-09-30' WHERE backer_id = (SELECT id FROM backers WHERE public_token = ?)", [tk.two]); // ended
      const p = surface.parity(db, { today: TODAY });
      const by = Object.fromEntries(p.differ.map((d) => [d.name, d]));
      assert.deepStrictEqual(Object.keys(by).sort(), ['Daniel Whitcombe', 'Mo Chen', 'Priya R.'].sort(), 'Sam is identical');
      assert.deepStrictEqual(by['Priya R.'].fields, ['name']);
      assert.deepStrictEqual(by['Priya R.'].detail.name, { console: 'Priya Raman', sql: 'Priya R.' });
      assert.deepStrictEqual(by['Daniel Whitcombe'].fields, ['openingCents', 'cumulativeCents']);
      assert.strictEqual(by['Daniel Whitcombe'].detail.openingCents.sql - by['Daniel Whitcombe'].detail.openingCents.console, 12345);
      // Mo's agreement ended: no stakes line, and no weekly email (ended agreements send none)
      assert.deepStrictEqual(by['Mo Chen'].fields, ['stakes', 'digest']);
      assert.deepStrictEqual(by['Mo Chen'].detail.digest, { console: 'sends', sql: 'none' });
      assert.ok(p.differ.every((d) => Number.isInteger(d.backerId)));
      assert.strictEqual(p.identical + p.differ.length, p.tokens);
      db.close();
    });
    await test('it never returns a token or an address, and reports the legacy link count as a count', () => {
      const { db, tk } = fresh();
      for (const t of [tk.full, tk.two]) mirror(db, recOf(db, t), { email: 'different.address@example.test' });
      db.run("INSERT INTO backer_tokens (agreement_id, token) VALUES (1, 'LegacyTokenAAAA1111'), (2, 'LegacyTokenBBBB2222')");
      const p = surface.parity(db, { today: TODAY });
      assert.ok(p.differ.length >= 2, 'there is something to leak');
      assert.strictEqual(p.legacyBackerTokens, 2);
      const wire = JSON.stringify(p);
      const secrets = [...ALL_TOKENS(db), 'LegacyTokenAAAA1111', 'LegacyTokenBBBB2222', 'sam.okafor@example.test', 'mo.chen@example.test', 'different.address@example.test'];
      for (const s of secrets) assert.ok(!wire.includes(s), 'leaked ' + (s.includes('@') ? 'an address' : 'a token'));
      assert.ok(p.differ.some((d) => d.detail.digest && d.detail.digest.sql === 'sends to a different address'));
      db.close();
    });
    await test('a feed that throws is reported as a difference, not a crash', () => {
      const { db, tk } = fresh();
      mirror(db, recOf(db, tk.full));
      db.run('ALTER TABLE standing_agreements DROP COLUMN opening_cents'); // the SQL path now fails for the one backer it owns
      const realError = console.error; console.error = () => {}; // the digest reader logs the unreadable row, as it should
      let p;
      try { p = surface.parity(db, { today: TODAY }); } finally { console.error = realError; }
      assert.strictEqual(p.differ.length, 1);
      assert.deepStrictEqual(p.differ[0].fields, ['error']);
      assert.strictEqual(p.identical, p.tokens - 1);
      db.close();
    });

    // ── the weekly email ────────────────────────────────────────────────────
    console.log('the weekly digest');
    await test('console source: the same recipients, subject and html as the old code, character for character', () => {
      const { db } = fresh();
      const old = legacyDigests(db, NOW);
      const now = surface.weeklyDigests(db, { source: 'console', now: NOW });
      assert.ok(old.length >= 2, 'the fixture sends ' + old.length);
      assert.deepStrictEqual(now.map(({ to, subject, html }) => ({ to, subject, html })), old);
      db.close();
    });
    await test('sql source, faithfully mirrored: the same emails (the merged tables carry the address and the opt-in)', () => {
      const { db, tk } = fresh();
      for (const t of [tk.full, tk.empty, tk.one, tk.two]) mirror(db, recOf(db, t), { email: (recOf(db, t).delivery || {}).email || null });
      const old = legacyDigests(db, NOW);
      const sql = surface.weeklyDigests(db, { source: 'sql', now: NOW, today: TODAY });
      assert.deepStrictEqual(sql.map(({ to, subject, html }) => ({ to, subject, html })), old);
      db.close();
    });
    await test('sql source: notify_email decides - a backer who is off there is not emailed because the old record has an address', () => {
      const { db, tk } = fresh();
      mirror(db, recOf(db, tk.full), { email: null }); // the roster record has an email; the merged row has notify_email = 0
      const to = surface.digestRecipients(db, { source: 'sql', today: TODAY }).map((r) => r.via + ':' + (r.to));
      assert.ok(!to.some((x) => x.includes('sam.okafor')), 'Sam is not emailed');
      assert.ok(to.some((x) => x === 'console:mo.chen@example.test'), 'Mo, owned by no backers row, still comes from the old record');
      db.close();
    });
    await test('sql source: an ended agreement sends no email; the address comes from backers.email; the total uses the SQL opening', () => {
      const { db, tk } = fresh();
      mirror(db, recOf(db, tk.full), { email: 'sam.new@example.test' });
      db.run('UPDATE standing_agreements SET opening_cents = 70000');
      let d = surface.weeklyDigests(db, { source: 'sql', now: NOW, today: TODAY }).find((x) => x.token === tk.full);
      assert.strictEqual(d.to, 'sam.new@example.test');
      const net = one(db, 'SELECT SUM(share_cents) FROM backer_events WHERE token = ?', [tk.full]);
      assert.ok(d.html.includes(`Running total: ${surface.fmtSignedCents(net + 70000)}`));
      db.run("UPDATE standing_agreements SET status = 'ended', effective_to = '2026-09-30'");
      assert.ok(!surface.digestRecipients(db, { source: 'sql', today: TODAY }).some((r) => r.token === tk.full), 'ended: nothing goes out');
      db.close();
    });
    await test('a token is never emailed twice, and the merged row, not the record, decides for its own token', () => {
      const { db, tk } = fresh();
      mirror(db, recOf(db, tk.two), { email: 'mo.new@example.test' });
      const r = surface.digestRecipients(db, { source: 'sql', today: TODAY }).filter((x) => x.token === tk.two);
      assert.deepStrictEqual(r.map((x) => [x.via, x.to]), [['sql', 'mo.new@example.test']]);
      db.close();
    });

    await test('delivery off: the Sunday run sends no email to anyone, however many are due', async () => {
      const { db } = fresh();
      const sent = [];
      const logs = [];
      const r = await surface.sendWeeklyDigests(db, { env: {}, now: NOW, sendEmail: async (...a) => { sent.push(a); return true; }, log: { log: (m) => logs.push(m) } });
      assert.deepStrictEqual(r, { skipped: 'delivery-off', sent: 0 });
      assert.deepStrictEqual(sent, []);
      assert.match(logs.join(' '), /delivery is off here \(neither BACKER_DELIVERY nor RENDER is set\)/);
      assert.ok(legacyDigests(db, NOW).length >= 2, 'and there WERE emails due: the old code would have sent them');
      db.close();
    });
    await test('delivery on (Render, or BACKER_DELIVERY=1): the Sunday run sends exactly what the old code sent', async () => {
      const { db } = fresh();
      for (const env of [{ RENDER: 'true' }, { BACKER_DELIVERY: '1' }]) {
        const sent = [];
        const r = await surface.sendWeeklyDigests(db, { env, now: NOW, sendEmail: async (to, subject, html) => { sent.push({ to, subject, html }); return true; } });
        assert.strictEqual(r.sent, sent.length);
        assert.deepStrictEqual(sent, legacyDigests(db, NOW), JSON.stringify(env));
      }
      db.close();
    });

    // ── the delivery sweep ──────────────────────────────────────────────────
    console.log('the delivery sweep');
    const ENV_ON = { RENDER: 'true' };
    const posting = (db, v = 'on') => db.run('INSERT OR REPLACE INTO money_settings (user_id, data, updated_at) VALUES (1, ?, ?)', [JSON.stringify({ posting: v }), 'x']);
    const sweepFixture = () => {
      const db = scratch.open();
      posting(db);
      const backerId = fx.addSqlBacker(db, { userId: 1, name: 'Sweep Backer', token: 'SweepTok001', phone: '+15555550100', notifySms: true, agreements: [{ openingCents: 5000, stakes: [{ format: 'NLH', pct: 10 }] }] });
      const ev = (id, extra) => fx.addEvent(db, { token: 'SweepTok001', sessionId: id, date: '2026-10-13', game: '2/5 NLH', venue: 'Parx Casino', hours: 6.5, result: 84000, pct: 10, share: 8400, ...extra });
      ev('due', { source: 'ledger', ts: NOW - 10 * 60000 });
      ev('young', { source: 'ledger', ts: NOW - 30000 });
      ev('relayed', { ts: NOW - 10 * 60000 });                                   // the live relay's row: default source, notified_* never set
      ev('done', { source: 'ledger', ts: NOW - 60 * 60000, notified_share_cents: 8400, notified_at: NOW - 59 * 60000 });
      ev('edited', { source: 'ledger', ts: NOW - 60 * 60000, revised_at: NOW - 30000 });
      return { db, backerId };
    };
    await test('delivery off: nothing is delivered and nothing is read, however much is due', async () => {
      const { db } = sweepFixture();
      let calls = 0;
      assert.deepStrictEqual(await surface.sweep(db, { now: NOW, env: {}, deliver: async () => { calls++; } }), { skipped: 'delivery-off' });
      assert.strictEqual(calls, 0);
      assert.strictEqual(one(db, "SELECT COUNT(*) FROM backer_events WHERE notified_at IS NOT NULL AND id LIKE '%:due'"), 0);
      db.close();
    });
    await test('posting off (no setting, or "off"): nothing is delivered', async () => {
      const { db } = sweepFixture();
      let calls = 0;
      db.run('DELETE FROM money_settings');
      assert.deepStrictEqual(await surface.sweep(db, { now: NOW, env: ENV_ON, deliver: async () => { calls++; } }), { skipped: 'posting-off' });
      posting(db, 'off');
      assert.deepStrictEqual(await surface.sweep(db, { now: NOW, env: ENV_ON, deliver: async () => { calls++; } }), { skipped: 'posting-off' });
      db.run("UPDATE money_settings SET data = '{broken'");
      assert.deepStrictEqual(await surface.sweep(db, { now: NOW, env: ENV_ON, deliver: async () => { calls++; } }), { skipped: 'posting-off' });
      assert.strictEqual(calls, 0);
      db.close();
    });
    await test('it delivers a due ledger share once, marks it, and never takes the relay\'s rows (the trap)', async () => {
      const { db } = sweepFixture();
      const seen = [];
      const deliver = async (d) => { seen.push(d); };
      const r1 = await surface.sweep(db, { now: NOW, env: ENV_ON, deliver });
      assert.deepStrictEqual(r1, { delivered: 1, failed: 0 });
      assert.deepStrictEqual(seen.map((d) => d.event.session_id), ['due']);
      assert.strictEqual(one(db, "SELECT notified_at FROM backer_events WHERE id = 'SweepTok001:due'"), NOW);
      assert.strictEqual(one(db, "SELECT notified_share_cents FROM backer_events WHERE id = 'SweepTok001:due'"), 8400);
      // The relayed row is source 'dashboard' with notified_* NULL: a sweep that only tested
      // "notified_share_cents IS NOT share_cents" would deliver it a second time. This one never does.
      const later = NOW + 60 * 60000;
      const r2 = await surface.sweep(db, { now: later, env: ENV_ON, deliver });
      assert.deepStrictEqual(seen.map((d) => d.event.session_id).sort(), ['due', 'edited', 'young']);
      assert.strictEqual(r2.delivered, 2);
      assert.strictEqual(one(db, "SELECT notified_at FROM backer_events WHERE id = 'SweepTok001:relayed'"), null, 'the relay\'s row is untouched');
      assert.deepStrictEqual(await surface.sweep(db, { now: later + DAY, env: ENV_ON, deliver }), { delivered: 0, failed: 0 });
      assert.ok(!seen.some((d) => d.event.session_id === 'relayed' || d.event.session_id === 'done'));
      db.close();
    });
    await test('a share is held for two minutes after its last change, so a typo fixed straight away is never sent', async () => {
      const { db } = sweepFixture();
      const ids = [];
      const deliver = async (d) => { ids.push(d.event.session_id); };
      await surface.sweep(db, { now: NOW, env: ENV_ON, deliver });
      assert.ok(!ids.includes('young') && !ids.includes('edited'));
      await surface.sweep(db, { now: NOW + 2 * 60000 + 1, env: ENV_ON, deliver });
      assert.ok(ids.includes('young') && ids.includes('edited'));
      db.close();
    });
    await test('a correction after delivery sends nothing (owner Q2): the page just shows the new figure', async () => {
      const { db } = sweepFixture();
      let calls = 0;
      const deliver = async () => { calls++; };
      await surface.sweep(db, { now: NOW + 3600000, env: ENV_ON, deliver });
      const before = calls;
      db.run("UPDATE backer_events SET share_cents = 9999, session_result_cents = 99990, revised_at = ? WHERE id = 'SweepTok001:due'", [NOW + 3600001]);
      await surface.sweep(db, { now: NOW + 2 * 3600000, env: ENV_ON, deliver });
      assert.strictEqual(calls, before, 'no second delivery');
      db.close();
    });
    await test('a delivery that throws is retried next sweep, not marked', async () => {
      const { db } = sweepFixture();
      const quiet = { error() {} };
      const r1 = await surface.sweep(db, { now: NOW, env: ENV_ON, log: quiet, deliver: async () => { throw new Error('push service down'); } });
      assert.deepStrictEqual(r1, { delivered: 0, failed: 1 });
      assert.strictEqual(one(db, "SELECT notified_at FROM backer_events WHERE id = 'SweepTok001:due'"), null);
      const r2 = await surface.sweep(db, { now: NOW + 60000, env: ENV_ON, deliver: async () => {} });
      assert.strictEqual(r2.delivered, 1);
      db.close();
    });
    await test('the delivery hook gets the backer\'s text opt-in and the running total (shares + every opening)', async () => {
      const { db, backerId } = sweepFixture();
      let got;
      await surface.sweep(db, { now: NOW, env: ENV_ON, deliver: async (d) => { got = d; } });
      assert.strictEqual(got.backer.id, backerId);
      assert.strictEqual(got.backer.notify_sms, 1);
      assert.strictEqual(got.backer.phone, '+15555550100');
      const shares = one(db, "SELECT SUM(share_cents) FROM backer_events WHERE token = 'SweepTok001'");
      assert.strictEqual(got.cumulativeCents, shares + 5000);
      assert.strictEqual(got.messages.title, '2/5 NLH — +$84');
      db.close();
    });
    await test('a link no backers row owns still gets its push (no text: there is no phone)', async () => {
      const { db } = sweepFixture();
      fx.addEvent(db, { token: 'NoRowTok001', sessionId: 'n1', source: 'ledger', ts: NOW - 600000 });
      let got;
      await surface.sweep(db, { now: NOW, env: ENV_ON, deliver: async (d) => { if (d.event.token === 'NoRowTok001') got = d; } });
      assert.ok(got && got.backer === null);
      db.close();
    });
    await test('the first-post wording is the relay\'s, character for character', () => {
      const session = { game: '2/5 NLH', venue: 'Parx Casino', hours: 6.5, resultCents: 84000 };
      const cum = 123456;
      const old = legacyRelayMessages(session, 10, 8400, cum, 'SweepTok001');
      const now = surface.shareMessages({ game: session.game, venue: session.venue, hours: session.hours, session_result_cents: 84000, pct: 10, share_cents: 8400, token: 'SweepTok001' }, cum);
      assert.deepStrictEqual(now, old);
      const neg = legacyRelayMessages({ game: 'PLO', venue: 'Bellagio', hours: 3.25, resultCents: -150000 }, 12.5, -18750, -4200, 'AbCdEf12');
      assert.deepStrictEqual(surface.shareMessages({ game: 'PLO', venue: 'Bellagio', hours: 3.25, session_result_cents: -150000, pct: 12.5, share_cents: -18750, token: 'AbCdEf12' }, -4200), neg);
    });
  } finally {
    scratch.cleanup();
  }
  done();
})().catch((e) => { console.error(e); process.exit(1); });
