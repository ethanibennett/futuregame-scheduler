// The owner's read-only Backers view (GET /api/staking/standing/backers) through the real server:
// its shape, who may ask, what it must never carry, and that every figure is the one the backer's
// own /b/ page is given (GET /api/backer/:token/feed), under both settings of BACKER_PAGE_SOURCE.
//
//   node test/backers-view.test.js        (npm run test:backers-view)
//
// The numbers are not recomputed here or in the route: the route builds each backer through
// buildFeed, and these tests hold it to the feed route, field for field, for every backer on the
// roster (a 250-session history among them, so "the last 10" is exercised on a long list).
//
// Boots server.js on scratch ports (4540-4549, never 3001) against scratch DBs in a temp dir
// (never poker-tournaments.db), production secrets scrubbed. Every token, name, address, phone
// number and figure is invented.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const surface = require('../lib/backer-surface');
const { createScratch, boot, waitLog, one, rowsOf, runner } = require('./helpers/scratch-server');
const fx = require('./helpers/backer-fixtures');

const PW = 'backers-view-test-password-1';
const LINK = 'https://futurega.me/b/';
const KEYS = ['cumulativeCents', 'delivery', 'hours', 'id', 'link', 'name', 'openingCents', 'played', 'sessions', 'shares', 'stakes'];
const SHARE_KEYS = ['date', 'game', 'hours', 'pct', 'sessionResultCents', 'shareCents', 'venue'];
const PHONES = { one: '+15555550123', two: '+15555550124' };
const ADDRESSES = ['sam.okafor@example.test', 'mo.chen@example.test'];

(async () => {
  const { test, done } = runner('backers-view.test.js');
  const scratch = await createScratch();
  const servers = [];
  try {
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
    // Delivery, every way a roster record can carry it: a number, an address, both, neither, blank.
    const withDelivery = (token, delivery) => fx.addRoster(db, { ...fx.recOf(db, token), delivery }, { updatedAt: 3000 });
    withDelivery(tk.one, { sms: PHONES.one });
    withDelivery(tk.two, { sms: PHONES.two, email: 'mo.chen@example.test' });
    withDelivery('OddGames1', { sms: '   ', email: '' });
    const live = [tk.full, tk.empty, tk.one, tk.two, 'OddGames1', 'NoNameTok1', 'LongHist001']; // GoneInDash1 is deleted, 'broken' is not JSON
    const everyToken = fx.allTokens(db);
    const sessionIds = rowsOf(db, 'SELECT id, token, session_id FROM backer_events');
    assert.ok(sessionIds.length > 290, 'a real history to look for');
    scratch.save(db);
    db.close();

    const phaseDb = (name, mutate) => {
      const file = path.join(scratch.tmp, name + '.db');
      fs.copyFileSync(scratch.dbPath, file);
      if (mutate) { const d = scratch.open(); mutate(d); fs.writeFileSync(file, Buffer.from(d.export())); d.close(); }
      return file;
    };
    const api = (s, p, { token, method = 'GET', body } = {}) => fetch(`http://127.0.0.1:${s.port}${p}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) { /* html */ } return { status: r.status, headers: r.headers, text, json }; });
    const login = async (s, email) => (await api(s, '/api/login', { method: 'POST', body: { email, password: PW } })).json.token;
    const tokenOf = (b) => b.link.slice(LINK.length);

    /** Holds every backer on the view to the backer's own page, field for field. */
    const equalToThePage = async (s, backers) => {
      for (const b of backers) {
        const feed = (await api(s, `/api/backer/${tokenOf(b)}/feed`)).json;
        assert.strictEqual(b.name, feed.name, 'name');
        assert.strictEqual(b.stakes, feed.stakes, 'stakes');
        assert.strictEqual(b.openingCents, feed.openingCents, 'opening');
        assert.strictEqual(b.cumulativeCents, feed.cumulativeCents, 'running total');
        assert.strictEqual(b.sessions, feed.sessions, 'sessions');
        assert.strictEqual(b.hours, feed.hours, 'hours');
        const want = feed.events.slice(0, 10).map((e) => ({
          date: e.date, game: e.game, venue: e.venue, hours: e.hours, sessionResultCents: e.sessionResultCents, pct: e.pct, shareCents: e.shareCents,
        }));
        assert.deepStrictEqual(b.shares, want, 'the last ten shares, newest first');
        // bb/hr: the owner's tab works it out over the SAME events the page does (every event the feed
        // holds, up to its 200), from [game, hours, session result] alone.
        assert.deepStrictEqual(b.played, feed.events.map((e) => [e.game, e.hours, e.sessionResultCents]), 'played: the same events as the page, newest first');
      }
    };

    // ══ A. the switch is OFF (the default) ══════════════════════════════════
    console.log('A. default settings: the roster as the pages show it');
    {
      const file = phaseDb('a');
      srv = await boot(file); servers.push(srv);
      try {
        const ham = await login(srv, 'adminx@x.test');
        const ham5 = await login(srv, 'otheradmin@x.test');
        const plain = await login(srv, 'plainuser@x.test');
        const view = await api(srv, '/api/staking/standing/backers', { token: ham });
        const backers = (view.json || {}).backers || [];

        await test('shape: 200, no-store, { backers: [...] } with exactly the documented keys and types', () => {
          assert.strictEqual(view.status, 200, view.text);
          assert.match(view.headers.get('cache-control') || '', /no-store/);
          assert.deepStrictEqual(Object.keys(view.json), ['backers']);
          assert.strictEqual(backers.length, live.length);
          for (const b of backers) {
            assert.deepStrictEqual(Object.keys(b).sort(), KEYS, 'keys of ' + b.name);
            assert.strictEqual(typeof b.id, 'string');
            assert.ok(b.name === null || typeof b.name === 'string');
            assert.strictEqual(typeof b.stakes, 'string');
            for (const k of ['openingCents', 'cumulativeCents', 'sessions', 'hours']) assert.strictEqual(typeof b[k], 'number', k);
            assert.deepStrictEqual(Object.keys(b.delivery).sort(), ['email', 'sms']);
            assert.strictEqual(typeof b.delivery.sms, 'boolean');
            assert.strictEqual(typeof b.delivery.email, 'boolean');
            assert.ok(Array.isArray(b.shares) && b.shares.length <= 10);
            for (const sh of b.shares) assert.deepStrictEqual(Object.keys(sh).sort(), SHARE_KEYS);
            assert.ok(Array.isArray(b.played) && b.played.length <= 200);
            for (const p of b.played) assert.ok(Array.isArray(p) && p.length === 3 && typeof p[0] === 'string', 'a played row is [game, hours, resultCents]');
            assert.match(b.link, /^https:\/\/futurega\.me\/b\/[A-Za-z0-9]{6,64}$/);
          }
          assert.deepStrictEqual(backers.map(tokenOf).sort(), [...live].sort(), 'one entry per live roster record, each with its own link');
        });

        await test('the roster is read as the page reads it: a deleted record and a malformed one are not listed; a record with no name still is', () => {
          const tokens = backers.map(tokenOf);
          assert.ok(!tokens.includes('GoneInDash1'), 'deleted in the dashboard');
          const unnamed = backers.find((b) => tokenOf(b) === 'NoNameTok1');
          assert.strictEqual(unnamed.name, null);
          assert.strictEqual(unnamed.stakes, '10% NLH');
          assert.strictEqual(unnamed.openingCents, -100);
        });

        await test('ordered by name; ids are the roster record ids, not tokens', () => {
          const names = backers.map((b) => String(b.name || '').toLowerCase());
          assert.deepStrictEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
          assert.deepStrictEqual(backers.map((b) => b.id).sort(), ['demo-empty', 'demo-full', 'demo-one', 'demo-two', 'long', 'no-name', 'odd-games']);
          for (const b of backers) assert.ok(!b.id.includes(tokenOf(b)), 'an id does not embed the token');
        });

        await test('the numbers ARE the backer pages: every field equals GET /api/backer/:token/feed, the last ten shares newest first', async () => {
          await equalToThePage(srv, backers);
          const long = backers.find((b) => tokenOf(b) === 'LongHist001');
          assert.strictEqual(long.sessions, 250);
          assert.strictEqual(long.shares.length, 10);
          const dates = long.shares.map((s) => s.date);
          assert.deepStrictEqual(dates, [...dates].sort().reverse(), 'newest first');
          const sam = backers.find((b) => tokenOf(b) === tk.full);
          assert.strictEqual(sam.name, 'Sam Okafor');
          assert.strictEqual(sam.stakes, '20% PLO · 10% NLH (online)');
          assert.strictEqual(sam.openingCents, 50000);
          assert.ok(sam.sessions > 30 && sam.shares.length === 10);
          const empty = backers.find((b) => tokenOf(b) === tk.empty);
          assert.deepStrictEqual([empty.sessions, empty.hours, empty.shares.length, empty.cumulativeCents], [0, 0, 0, 0]);
        });

        await test('the running total is the page\'s: every recorded share plus the opening, across all sessions, not just the ten shown', () => {
          const d = scratch.open();
          try {
            for (const b of backers) {
              const t = tokenOf(b);
              const sum = one(d, 'SELECT COALESCE(SUM(share_cents), 0) FROM backer_events WHERE token = ?', [t]);
              assert.strictEqual(b.cumulativeCents, sum + b.openingCents, 'total of ' + b.name);
            }
          } finally { d.close(); }
        });

        await test('delivery is booleans: a number, an address, both, neither, and a blank are each told apart', () => {
          const by = Object.fromEntries(backers.map((b) => [tokenOf(b), b.delivery]));
          assert.deepStrictEqual(by[tk.full], { sms: false, email: true });
          assert.deepStrictEqual(by[tk.empty], { sms: false, email: false });
          assert.deepStrictEqual(by[tk.one], { sms: true, email: false });
          assert.deepStrictEqual(by[tk.two], { sms: true, email: true });
          assert.deepStrictEqual(by.OddGames1, { sms: false, email: false }, 'blank values are not set up');
        });

        await test('no phone number and no email address in the body, in any form', () => {
          for (const a of ADDRESSES) assert.ok(!view.text.includes(a), 'an address leaked');
          assert.ok(!/@/.test(view.text), 'an @ in the body');
          for (const n of Object.values(PHONES)) {
            assert.ok(!view.text.includes(n) && !view.text.includes(n.slice(2)), 'a phone number leaked');
          }
          assert.ok(!/\d{10}/.test(view.text.replace(/"(?:cumulativeCents|openingCents|sessionResultCents|shareCents)":-?\d+/g, '')), 'a ten-digit run (a phone number) in the body');
        });

        await test('no backer_events.id and no session id: the only token in the answer is each backer\'s own, inside its link', () => {
          for (const r of sessionIds) {
            assert.ok(!view.text.includes(r.id), 'a backer_events.id leaked: ' + r.id.slice(r.token.length));
            if (r.session_id.length >= 8) assert.ok(!view.text.includes(r.session_id), 'a session id leaked');   // the short ones (l1, h2) could match by chance
          }
          const stripped = JSON.parse(view.text).backers.map((b) => { const c = { ...b }; delete c.link; return c; });
          const rest = JSON.stringify(stripped);
          for (const t of everyToken) assert.ok(!rest.includes(t), 'a token outside a link: ' + t);
          for (const b of backers) assert.ok(!('token' in b) && !('eventId' in b) && !b.shares.some((s) => 'id' in s || 'eventId' in s));
        });

        await test('the gate: no login 401; an ordinary user 403; another ADMIN 403 (the roster is the owner\'s alone); the owner 200', async () => {
          assert.strictEqual((await api(srv, '/api/staking/standing/backers')).status, 401);
          const p = await api(srv, '/api/staking/standing/backers', { token: plain });
          assert.strictEqual(p.status, 403);
          const a = await api(srv, '/api/staking/standing/backers', { token: ham5 });
          assert.strictEqual(a.status, 403);
          for (const refused of [p, a]) {
            assert.ok(!refused.text.includes('backers'), 'a refusal carries no roster');
            assert.ok(!everyToken.some((t) => refused.text.includes(t)));
          }
          assert.strictEqual((await api(srv, '/api/staking/standing/backers', { token: ham })).status, 200);
          // a malformed bearer is no login either
          assert.strictEqual((await api(srv, '/api/staking/standing/backers', { token: 'not.a.jwt' })).status, 401);
        });

        await test('read-only: nothing else answers on the path (POST, PUT, PATCH, DELETE are refused), and none of it touches the database', async () => {
          const hash = () => require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
          const before = { text: (await api(srv, '/api/staking/standing/backers', { token: ham })).text, db: hash() };
          for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
            const r = await api(srv, '/api/staking/standing/backers', { token: ham, method, body: { name: 'x' } });
            assert.ok(r.status >= 400, `${method} answered ${r.status}`);
          }
          await api(srv, '/api/staking/standing/backers', { token: ham });
          assert.strictEqual((await api(srv, '/api/staking/standing/backers', { token: ham })).text, before.text);
          assert.strictEqual(hash(), before.db, 'the database file did not change');
        });

        await test('the live view moves with the page: a share notified through the relay shows in the view and the page alike', async () => {
          const r = await fetch(`http://127.0.0.1:${srv.port}/console/api/backers/notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`ham:${PW}`).toString('base64') },
            body: JSON.stringify({
              session: { id: 'dash-view-1', date: '2026-10-14', game: '2/5 NLH', venue: 'Parx Casino', hours: 4, resultCents: 60000 },
              recipients: [{ token: tk.one, name: 'Daniel Whitcombe', pct: 25, shareCents: 15000, openingCents: 0 }],
            }),
          });
          assert.strictEqual(r.status, 200);
          const after = (await api(srv, '/api/staking/standing/backers', { token: ham })).json.backers;
          const dan = after.find((b) => tokenOf(b) === tk.one);
          assert.strictEqual(dan.sessions, 2);
          assert.deepStrictEqual(dan.shares[0], { date: '2026-10-14', game: '2/5 NLH', venue: 'Parx Casino', hours: 4, sessionResultCents: 60000, pct: 25, shareCents: 15000 });
          await equalToThePage(srv, after);
        });
      } finally { await srv.stop(); }
    }

    // ══ B. BACKER_PAGE_SOURCE=sql ═══════════════════════════════════════════
    console.log('B. BACKER_PAGE_SOURCE=sql: the same figures as the pages, whichever store they read');
    {
      const file = phaseDb('b', (d) => {
        for (const t of [tk.full, tk.empty, tk.one, tk.two, 'OddGames1', 'LongHist001']) fx.mirror(d, fx.recOf(d, t), { userId: hamId, email: (fx.recOf(d, t).delivery || {}).email || null });
        d.run("UPDATE backers SET name = 'Priya R.' WHERE public_token = ?", [tk.empty]);                                                         // a rename shows on the page, so here
        d.run("UPDATE backers SET phone = '+15555550166', notify_sms = 1 WHERE public_token = ?", [tk.empty]);                                  // the backers row decides its own flags
        d.run("UPDATE backers SET notify_email = 0 WHERE public_token = ?", [tk.full]);                                                          // the roster says email; the row says no
        d.run("UPDATE backers SET phone = '+15555550177', notify_sms = 0 WHERE public_token = ?", [tk.one]);                                   // a number on file but texts off
        d.run("UPDATE standing_agreements SET status = 'ended', effective_to = '2026-09-30' WHERE backer_id = (SELECT id FROM backers WHERE public_token = 'OddGames1')");
      });
      srv = await boot(file, { BACKER_PAGE_SOURCE: 'sql' }); servers.push(srv);
      try {
        const ham = await login(srv, 'adminx@x.test');
        await waitLog(srv, /\[backers\] page source: sql/);
        const view = await api(srv, '/api/staking/standing/backers', { token: ham });
        const backers = (view.json || {}).backers || [];
        await test('every field equals the page, including the renamed backer and the ended agreement\'s empty stakes line', async () => {
          assert.strictEqual(view.status, 200, view.text);
          assert.strictEqual(backers.length, live.length);
          await equalToThePage(srv, backers);
          assert.strictEqual(backers.find((b) => tokenOf(b) === tk.empty).name, 'Priya R.');
          assert.strictEqual(backers.find((b) => tokenOf(b) === 'OddGames1').stakes, '');
        });
        await test('a backers row decides its own delivery (a flag on AND a number or address on file); a roster-only token keeps the roster\'s', () => {
          const by = Object.fromEntries(backers.map((b) => [tokenOf(b), b.delivery]));
          assert.deepStrictEqual(by[tk.empty], { sms: true, email: false });
          assert.deepStrictEqual(by[tk.full], { sms: false, email: false });
          assert.deepStrictEqual(by[tk.one], { sms: false, email: false });
          assert.deepStrictEqual(by[tk.two], { sms: false, email: true });          // mirrored with an address, notify_email on; no number is mirrored
          assert.deepStrictEqual(by.NoNameTok1, { sms: false, email: false });       // roster only
        });
        await test('still no number, no address and no event id', () => {
          assert.ok(!/@/.test(view.text));
          for (const n of ['5555550166', '5555550177', ...Object.values(PHONES).map((p) => p.slice(2))]) assert.ok(!view.text.includes(n));
          for (const r of sessionIds) assert.ok(!view.text.includes(r.id));
        });
      } finally { await srv.stop(); }
    }

    // ══ C. an empty roster ══════════════════════════════════════════════════
    console.log('C. no backers yet');
    {
      const file = phaseDb('c', (d) => { d.run("DELETE FROM console_records WHERE store = 'backers'"); });
      srv = await boot(file); servers.push(srv);
      try {
        const ham = await login(srv, 'adminx@x.test');
        await test('an empty roster is an empty list, not an error', async () => {
          const r = await api(srv, '/api/staking/standing/backers', { token: ham });
          assert.strictEqual(r.status, 200);
          assert.deepStrictEqual(r.json, { backers: [] });
        });
      } finally { await srv.stop(); }
    }

    // ══ D. the library, on its own ══════════════════════════════════════════
    console.log('D. backersView against a database directly');
    {
      const d = scratch.open();
      try {
        await test('two roster records with one token list one backer, the first, as the page serves it; a record with no token has no link and is not listed', () => {
          fx.addRoster(d, { id: 'dup', token: tk.full, name: 'Duplicate Of Sam', stakes: [{ format: 'NLH', pct: 99, channel: 'any' }], opening: 9999 }, { updatedAt: 5000 });
          fx.addRoster(d, { id: 'no-link', name: 'No Link At All', stakes: [] });
          const view = surface.backersView(d);
          assert.strictEqual(view.filter((b) => b.link === LINK + tk.full).length, 1);
          assert.strictEqual(view.find((b) => b.link === LINK + tk.full).id, 'demo-full');
          assert.ok(!view.some((b) => b.name === 'No Link At All'));
        });
        await test('a token the link pattern refuses is not listed', () => {
          fx.addRoster(d, { id: 'bad-token', token: 'has space!', name: 'Bad Token' });
          assert.ok(!surface.backersView(d).some((b) => b.name === 'Bad Token' || b.link.includes(' ')));
        });
        await test('the ten shown are the first ten of the page\'s own list, so a long history is cut at ten and counted in full', () => {
          const v = surface.backersView(d).find((b) => b.link === LINK + 'LongHist001');
          const feed = surface.buildFeed(d, 'LongHist001');
          assert.strictEqual(v.shares.length, surface.SHARES_SHOWN);
          assert.strictEqual(v.sessions, 250);
          assert.strictEqual(v.cumulativeCents, feed.cumulativeCents);
          assert.strictEqual(v.shares[0].date, feed.events[0].date);
        });
      } finally { d.close(); }
    }
  } finally {
    for (const s of servers) { try { await s.stop(); } catch (_) { /* gone */ } }
    scratch.cleanup();
  }
  done();
})().catch((e) => { console.error(e); process.exit(1); });
