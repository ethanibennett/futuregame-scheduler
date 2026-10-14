// Phase 2 of the bankroll merge through the real server (docs/bankroll-merge.md §7.5, §7.6, §6.7):
// the backer pages under both settings of the switch, the parity route, "New link", the delivery
// gate on the notify relay, and the boot log.
//
//   node test/backer-parity.test.js        (npm run test:backer-parity)
//
// THE PROOF THAT EVERY EXISTING /b/<token> LINK KEEPS ITS HISTORY. The scratch database is seeded
// the way the live one is: dashboard roster records in console_records, names in backer_public,
// recorded shares in backer_events (including a deleted record, a malformed one, a token only a
// name row knows, and a 250-session history). Before the server boots, each token's feed is
// computed by the ORACLE (test/helpers/legacy-backer-surface.js: the route exactly as origin/master
// 4a19a4b had it). Then the real server is asked, over HTTP, and the response body must equal the
// oracle's JSON character for character:
//
//   A  switch OFF (the default)        every token == the oracle
//   B  BACKER_PAGE_SOURCE=sql          backers mirrored into the merged tables == the oracle;
//                                      a rename shows the SQL name; everyone else is the fallback
//   C  BACKER_DELIVERY=1               the relay delivers (gate open)
//
// and the parity route says, per token, what flipping the switch would change.
//
// Boots server.js on scratch ports (4540-4549, never 3001) against scratch DBs in a temp dir
// (never poker-tournaments.db), with the production secrets scrubbed. Every token, name, address
// and figure is invented.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const surface = require('../lib/backer-surface');
const { legacyFeed } = require('./helpers/legacy-backer-surface');
const { createScratch, boot, waitLog, one, rowsOf, runner } = require('./helpers/scratch-server');
const fx = require('./helpers/backer-fixtures');

const PW = 'parity-test-password-1';
const legacyJson = (db, token) => JSON.stringify(legacyFeed(db, token));

(async () => {
  const { test, done } = runner('backer-parity.test.js');
  const scratch = await createScratch();
  const servers = [];
  try {
    // ── the migration that counts the legacy links ──────────────────────────
    console.log('boot log');
    await test('the first boot ran the legacy-link audit and logged a count, never a row', () => {
      assert.match(scratch.bootLog, /Migration "backer-tokens-audit-2026-10" applied/);
      assert.match(scratch.bootLog, /Legacy backer_tokens: 0 row\(s\) - none, as expected/);
    });

    // ── accounts: the owner (ham), another admin (ham5), and an ordinary user ──
    let srv = await boot(scratch.dbPath);
    servers.push(srv);
    try {
      for (const [u, e] of [['adminx', 'adminx@x.test'], ['otheradmin', 'otheradmin@x.test'], ['plainuser', 'plainuser@x.test']]) {
        const r = await fetch(`http://127.0.0.1:${srv.port}/api/register`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, email: e, password: PW, realName: u }),
        });
        assert.strictEqual(r.status, 201, `register ${u}`);
      }
    } finally { await srv.stop(); }

    // ── the world ───────────────────────────────────────────────────────────
    const db = scratch.open();
    db.run("UPDATE users SET username = 'ham' WHERE username = 'adminx'");        // sign-up reserves the admin names
    db.run("UPDATE users SET username = 'ham5' WHERE username = 'otheradmin'");
    const hamId = one(db, "SELECT id FROM users WHERE username = 'ham'");
    const tk = fx.seedDashboardEra(db);
    const mirrored = [tk.full, tk.empty, tk.one, tk.two, 'OddGames1', 'LongHist001'];
    for (const t of mirrored) fx.mirror(db, fx.recOf(db, t), { userId: hamId, email: (fx.recOf(db, t).delivery || {}).email || null });
    fx.addSqlBacker(db, { userId: hamId, name: 'History Only', token: 'HistoryOnly1', agreements: [{ status: 'ended', to: '2026-09-30', openingCents: 0, stakes: [] }] }); // §7.1 kind 3
    fx.addSqlBacker(db, { userId: hamId, name: 'No Link Yet', token: null });                                                                                      // a staking-only backer
    const tokens = fx.allTokens(db);
    const expected = Object.fromEntries(tokens.map((t) => [t, legacyJson(db, t)]));
    const backerId = (t) => one(db, 'SELECT id FROM backers WHERE public_token = ?', [t]);
    const ids = { one: backerId(tk.one), full: backerId(tk.full), empty: backerId(tk.empty), odd: backerId('OddGames1'), noLink: one(db, "SELECT id FROM backers WHERE name = 'No Link Yet'") };
    const secrets = [...tokens, 'sam.okafor@example.test', 'mo.chen@example.test'];
    scratch.save(db);
    db.close();
    assert.ok(tokens.length >= 11);

    /** A fresh copy of the seeded database for one phase, so phases cannot touch each other. */
    const phaseDb = (name, mutate) => {
      const file = path.join(scratch.tmp, name + '.db');
      fs.copyFileSync(scratch.dbPath, file);
      if (mutate) { const d = scratch.open(); mutate(d); fs.writeFileSync(file, Buffer.from(d.export())); d.close(); }
      return file;
    };
    const readDb = async (file) => { const S = await require('./helpers/scratch-server').sqlJs(); return new S.Database(fs.readFileSync(file)); };
    const api = (s, method, p, { token, basic, body } = {}) => fetch(`http://127.0.0.1:${s.port}${p}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(basic ? { Authorization: 'Basic ' + Buffer.from(`ham:${PW}`).toString('base64') } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) { /* html */ } return { status: r.status, headers: r.headers, text, json }; });
    const login = async (s, email) => (await api(s, 'POST', '/api/login', { body: { email, password: PW } })).json.token;

    // ══ A. the switch is OFF (the default) ══════════════════════════════════
    console.log('A. switch off (default): the pages are exactly what they were');
    {
      const file = phaseDb('a');
      srv = await boot(file); servers.push(srv);
      try {
        const ham = await login(srv, 'adminx@x.test');
        const ham5 = await login(srv, 'otheradmin@x.test');
        const plain = await login(srv, 'plainuser@x.test');

        await test('boot log: delivery is OFF here and the page reads console_records', async () => {
          await waitLog(srv, /\[backers\] page source/);
          assert.match(srv.log(), /\[backers\] delivery is OFF on this instance \(neither BACKER_DELIVERY nor RENDER is set\): no push, text or digest email will be sent/);
          assert.match(srv.log(), /\[backers\] page source: console/);
          assert.ok(!/Migration "backer-tokens-audit-2026-10" applied/.test(srv.log()), 'the audit ran once, on the first boot');
        });

        await test('EVERY token\'s feed is the old code\'s feed, character for character (history, name, stakes, opening, totals)', async () => {
          for (const t of tokens) {
            const r = await api(srv, 'GET', `/api/backer/${t}/feed`);
            assert.strictEqual(r.status, 200, t);
            assert.match(r.headers.get('cache-control') || '', /no-store/);
            assert.strictEqual(r.text, expected[t], 'token ' + t);
          }
        });

        await test('the parity route: nothing differs, and the answer carries no token or address', async () => {
          const r = await api(srv, 'GET', '/api/staking/standing/parity', { token: ham });
          assert.strictEqual(r.status, 200);
          assert.match(r.headers.get('cache-control') || '', /no-store/);
          assert.strictEqual(r.json.source, 'console');
          assert.deepStrictEqual(r.json.differ, []);
          assert.strictEqual(r.json.tokens, r.json.identical);
          assert.strictEqual(r.json.sqlBacked, 7);
          assert.strictEqual(r.json.legacyBackerTokens, 0);
          for (const s of secrets) assert.ok(!r.text.includes(s), 'the response leaked ' + (s.includes('@') ? 'an address' : 'a token'));
        });

        await test('the parity route is the owner\'s alone: no login 401, a plain user 403, another admin 403', async () => {
          assert.strictEqual((await api(srv, 'GET', '/api/staking/standing/parity')).status, 401);
          assert.strictEqual((await api(srv, 'GET', '/api/staking/standing/parity', { token: plain })).status, 403);
          assert.strictEqual((await api(srv, 'GET', '/api/staking/standing/parity', { token: ham5 })).status, 403);
        });

        await test('the notify relay with delivery off: the share is recorded, nothing is sent, and the answer says so', async () => {
          const body = {
            session: { id: 'dash-relay-1', date: '2026-10-14', game: '5/5/10 PLO', venue: 'Bellagio', hours: 5, resultCents: 100000 },
            recipients: [{ token: tk.full, name: 'Sam Okafor', pct: 20, shareCents: 20000, openingCents: 50000, sms: '+15555550100' }],
          };
          const r = await api(srv, 'POST', '/console/api/backers/notify', { basic: true, body });
          assert.strictEqual(r.status, 200, r.text);
          const x = r.json.results[0];
          assert.strictEqual(x.delivery, 'off');
          assert.strictEqual(x.sms, 'off');
          assert.strictEqual(x.sent, 0);
          assert.strictEqual(x.duplicate, false);
          // the trap (Phase 1's report): the relay's row is born delivered, source 'dashboard'
          const d = await readDb(file);
          const row = rowsOf(d, "SELECT source, notified_share_cents, notified_at, ts, share_cents FROM backer_events WHERE id = ?", [`${tk.full}:dash-relay-1`])[0];
          d.close();
          assert.strictEqual(row.source, 'dashboard');
          assert.strictEqual(row.notified_share_cents, 20000);
          assert.strictEqual(row.notified_at, row.ts);
          // and the page shows it at once, with the same running total the relay reported
          const feed = (await api(srv, 'GET', `/api/backer/${tk.full}/feed`)).json;
          assert.strictEqual(feed.events.find((e) => e.shareCents === 20000 && e.date === '2026-10-14').game, '5/5/10 PLO');
          assert.strictEqual(feed.cumulativeCents, x.cumulativeCents);
          // a re-send is a duplicate, still recorded once
          const again = await api(srv, 'POST', '/console/api/backers/notify', { basic: true, body });
          assert.strictEqual(again.json.results[0].duplicate, true);
        });

        await test('"New link": the owner replaces a backer\'s link; the history, name, stakes and opening follow; the old link is dead', async () => {
          const before = JSON.parse(expected[tk.one]);
          const r = await api(srv, 'POST', `/api/staking/standing/backers/${ids.one}/rotate-link`, { token: ham });
          assert.strictEqual(r.status, 200, r.text);
          assert.match(r.json.token, /^[A-Za-z0-9]{8}$/);
          assert.notStrictEqual(r.json.token, tk.one);
          assert.strictEqual(r.json.path, `/b/${r.json.token}`);
          assert.deepStrictEqual(r.json.moved, { backer_public: 1, backer_events: 1, backer_push_subs: 0, backers: 1, backer_event_revisions: 0 });
          assert.strictEqual(r.json.rosterRecord, 'updated');
          const fresh = await api(srv, 'GET', `/api/backer/${r.json.token}/feed`);
          assert.strictEqual(fresh.text, expected[tk.one], 'the new link shows exactly what the old one did');
          const old = (await api(srv, 'GET', `/api/backer/${tk.one}/feed`)).json;
          assert.deepStrictEqual([old.name, old.stakes, old.openingCents, old.sessions, old.events.length], [null, '', 0, 0, 0], 'the old link shows nothing');
          assert.ok(before.sessions === 1 && before.name === 'Daniel Whitcombe');
          assert.ok(!srv.log().includes(r.json.token) && !srv.log().includes(tk.one), 'the log carries no token');
          // still no difference between the two settings of the switch after a rotation
          const p = await api(srv, 'GET', '/api/staking/standing/parity', { token: ham });
          assert.deepStrictEqual(p.json.differ, []);
        });

        await test('"New link" refuses what it should: another player\'s backer 404, no link 409, a plain user 403, a bad id 400, no login 401', async () => {
          assert.strictEqual((await api(srv, 'POST', `/api/staking/standing/backers/${ids.full}/rotate-link`, { token: ham5 })).status, 404);
          assert.strictEqual((await api(srv, 'POST', `/api/staking/standing/backers/${ids.noLink}/rotate-link`, { token: ham })).status, 409);
          assert.strictEqual((await api(srv, 'POST', `/api/staking/standing/backers/${ids.full}/rotate-link`, { token: plain })).status, 403);
          assert.strictEqual((await api(srv, 'POST', `/api/staking/standing/backers/abc/rotate-link`, { token: ham })).status, 400);
          assert.strictEqual((await api(srv, 'POST', `/api/staking/standing/backers/999999/rotate-link`, { token: ham })).status, 404);
          assert.strictEqual((await api(srv, 'POST', `/api/staking/standing/backers/${ids.full}/rotate-link`)).status, 401);
          const same = (await api(srv, 'GET', `/api/backer/${tk.full}/feed`)).json;
          assert.ok(same.sessions > 30, 'Sam\'s link is untouched by all of those');
        });
      } finally { await srv.stop(); }
    }

    // ══ B. BACKER_PAGE_SOURCE=sql ═══════════════════════════════════════════
    console.log('B. BACKER_PAGE_SOURCE=sql: the merged tables first, the old store as the fallback');
    {
      const file = phaseDb('b', (d) => {
        d.run("UPDATE backers SET name = 'Priya R.' WHERE public_token = ?", [tk.empty]);                                                         // a rename
        d.run("UPDATE standing_agreements SET status = 'ended', effective_to = '2026-09-30' WHERE backer_id = (SELECT id FROM backers WHERE public_token = 'OddGames1')"); // ended
      });
      srv = await boot(file, { BACKER_PAGE_SOURCE: 'sql' }); servers.push(srv);
      try {
        const ham = await login(srv, 'adminx@x.test');
        await test('boot log: the page reads the backers table', async () => {
          await waitLog(srv, /\[backers\] page source/);
          assert.match(srv.log(), /\[backers\] page source: sql \(backers table, console_records as the fallback\)/);
        });
        await test('mirrored backers are the old pages exactly; the renamed one shows its SQL name; the ended one shows no stakes; the fallback pages are untouched', async () => {
          const wantChanged = {
            [tk.empty]: JSON.stringify({ ...JSON.parse(expected[tk.empty]), name: 'Priya R.' }),
            OddGames1: JSON.stringify({ ...JSON.parse(expected.OddGames1), stakes: '' }),
          };
          for (const t of tokens) {
            const r = await api(srv, 'GET', `/api/backer/${t}/feed`);
            assert.strictEqual(r.status, 200, t);
            assert.strictEqual(r.text, wantChanged[t] || expected[t], 'token ' + t);
          }
        });
        await test('the parity route lists exactly the two pages the switch changes, by backer id, with both sides', async () => {
          const r = await api(srv, 'GET', '/api/staking/standing/parity', { token: ham });
          assert.strictEqual(r.status, 200);
          assert.strictEqual(r.json.source, 'sql');
          const by = Object.fromEntries(r.json.differ.map((d) => [d.backerId, d]));
          assert.deepStrictEqual(Object.keys(by).map(Number).sort(), [ids.empty, ids.odd].sort());
          assert.deepStrictEqual(by[ids.empty].fields, ['name']);
          assert.deepStrictEqual(by[ids.empty].detail.name, { console: 'Priya Raman', sql: 'Priya R.' });
          assert.deepStrictEqual(by[ids.odd].fields, ['stakes']);
          assert.strictEqual(by[ids.odd].detail.stakes.sql, '');
          assert.strictEqual(r.json.identical, r.json.tokens - 2);
          for (const s of secrets) assert.ok(!r.text.includes(s), 'the response leaked ' + (s.includes('@') ? 'an address' : 'a token'));
        });
      } finally { await srv.stop(); }
    }

    // ══ C. BACKER_DELIVERY=1 ════════════════════════════════════════════════
    console.log('C. BACKER_DELIVERY=1: the gate is open');
    {
      const file = phaseDb('c');
      srv = await boot(file, { BACKER_DELIVERY: '1' }); servers.push(srv);
      try {
        await test('boot log: delivery is ON', async () => {
          await waitLog(srv, /\[backers\] page source/);
          assert.match(srv.log(), /\[backers\] delivery is ON on this instance \(BACKER_DELIVERY is on\)/);
        });
        await test('the relay is no longer told "off": the gate is open (Twilio is not configured here, so no text and no network)', async () => {
          const r = await api(srv, 'POST', '/console/api/backers/notify', { basic: true, body: {
            session: { id: 'dash-relay-2', date: '2026-10-14', game: 'NLH', venue: 'Parx', hours: 3, resultCents: 50000 },
            recipients: [{ token: tk.full, name: 'Sam Okafor', pct: 10, shareCents: 5000, openingCents: 50000, sms: '+15555550100' }],
          } });
          assert.strictEqual(r.status, 200, r.text);
          const x = r.json.results[0];
          assert.ok(!('delivery' in x), 'no "off" marker');
          assert.strictEqual(x.sms, 'unconfigured', 'it got as far as asking Twilio for credentials');
        });
      } finally { await srv.stop(); }
    }

    // ══ D. a database with legacy backer links ══════════════════════════════
    console.log('D. the audit counts legacy links without printing them');
    {
      const file = phaseDb('d', (d) => {
        d.run("DELETE FROM _applied_migrations WHERE name = 'backer-tokens-audit-2026-10'");
        d.run("INSERT INTO backer_tokens (agreement_id, token) VALUES (1, 'LegacyHex0000000000000000000001'), (2, 'LegacyHex0000000000000000000002')");
      });
      srv = await boot(file); servers.push(srv);
      try {
        const ham = await login(srv, 'adminx@x.test');
        await test('the migration logs 2 rows and not one of them', () => {
          assert.match(srv.log(), /Legacy backer_tokens: 2 row\(s\) - the owner decides/);
          assert.ok(!srv.log().includes('LegacyHex'));
        });
        await test('the parity route reports the count too, and not the tokens', async () => {
          const r = await api(srv, 'GET', '/api/staking/standing/parity', { token: ham });
          assert.strictEqual(r.json.legacyBackerTokens, 2);
          assert.ok(!r.text.includes('LegacyHex'));
        });
      } finally { await srv.stop(); }
    }
  } finally {
    for (const s of servers) { try { await s.stop(); } catch (_) { /* gone */ } }
    scratch.cleanup();
  }
  done();
})().catch((e) => { console.error(e); process.exit(1); });
