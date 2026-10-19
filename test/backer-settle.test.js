// The Settled handshake (owner, 2026-10-19; lib/staking/backer-settle.js) through the real server: the
// backer presses Settled on their page, the owner presses it on the Backers card, and only then does the
// page read $0, with one settlement entered into Main. Either side can undo before the other presses; a
// share that lands in between voids the half-confirmed settlement; a press for a figure the side was not
// shown is refused. Scratch ports 4740-4749, a scratch DB, delivery off. Every figure is invented.
//
//   node test/backer-settle.test.js        (npm run test:backer-settle)
'use strict';
const assert = require('assert');
const fs = require('fs');
const { createScratch, boot, sqlJs, one, rowsOf, runner } = require('./helpers/scratch-server');

const PORTS = [4740, 4749];
const PW = 'backer-settle-test-password-1';
const TOK = 'SettleSam01';
const REC = 'rec-sam';

(async () => {
  const { test, done } = runner('backer-settle.test.js');
  const scratch = await createScratch({ ports: PORTS, prefix: 'fg-settle-' });
  const servers = [];
  const S = await sqlJs();
  const q = (sql, args = []) => { const d = new S.Database(fs.readFileSync(scratch.dbPath)); try { return rowsOf(d, sql, args); } finally { d.close(); } };
  try {
    let srv = await boot(scratch.dbPath, {}, { ports: PORTS });
    servers.push(srv);
    const api = (p, { token, method = 'GET', body } = {}) => fetch(`http://127.0.0.1:${srv.port}${p}`, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) { /* */ } return { status: r.status, json, text }; });
    for (const [u, e] of [['adminx', 'adminx@x.test'], ['otheradm', 'otheradm@x.test']]) {
      assert.strictEqual((await api('/api/register', { method: 'POST', body: { username: u, email: e, password: PW, realName: u } })).status, 201);
    }
    await srv.stop();
    const db = scratch.open();
    db.run("UPDATE users SET username = 'ham' WHERE username = 'adminx'");
    db.run("UPDATE users SET username = 'ham5' WHERE username = 'otheradm'");
    const ham = one(db, "SELECT id FROM users WHERE username = 'ham'");
    // A roster-era backer (console_records), the way the Backers card lists them, opening $100.
    db.run("INSERT INTO console_records (store, id, data, updated_at, deleted) VALUES ('backers', ?, ?, 1, 0)",
      [REC, JSON.stringify({ token: TOK, name: 'Sam Settle', opening: 100, stakes: [] })]);
    db.run(`INSERT INTO backer_events (id, token, session_id, ts, date, game, venue, hours, session_result_cents, pct, share_cents, source)
            VALUES (?, ?, 'fg-cs-1', 1, '2026-10-01', '2/5 NLH', 'Parx', 5, 300000, 20, 60000, 'ledger')`, [`${TOK}:fg-cs-1`, TOK]);
    db.run("INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, occurred_on, note, created_at) VALUES (?, NULL, 'deposit', 5000, '2026-09-01', 'seed', '2026-09-01T00:00:00Z')", [ham]);
    scratch.save(db); db.close();
    srv = await boot(scratch.dbPath, { BACKER_DELIVERY: '0', CONSOLE_OWNER_USER_ID: String(ham) }, { ports: PORTS });
    servers.push(srv);
    const login = async (email) => (await api('/api/login', { method: 'POST', body: { email, password: PW } })).json.token;
    const owner = await login('adminx@x.test');
    const other = await login('otheradm@x.test');
    const feed = async () => (await api(`/api/backer/${TOK}/feed`)).json;
    const card = async () => (await api('/api/staking/standing/backers', { token: owner })).json.backers.find((b) => b.id === REC);
    const backer = (action, amountCents) => api(`/api/backer/${TOK}/settle`, { method: 'POST', body: { action, amountCents } });
    const mine = (action, amountCents, token = owner) => api(`/api/staking/standing/backers/${REC}/settle`, { token, method: 'POST', body: { action, amountCents } });
    const mainBalance = async () => (await api('/api/bankrolls/summary', { token: owner })).json.bankrolls.find((b) => b.id === 'main').balance;

    await test('a page never settled carries no settlement field: byte for byte as before', async () => {
      const f = await feed();
      assert.strictEqual(f.cumulativeCents, 70000);
      assert.ok(!('settlement' in f));
      assert.ok(!('settlement' in await card()));
    });
    await test('a press for a figure the side was not shown is refused, with the real one', async () => {
      const r = await backer('confirm', 12345);
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.json.balanceCents, 70000);
    });
    await test('the backer presses: open, waiting for the owner; the balance has not moved', async () => {
      const r = await backer('confirm', 70000);
      assert.strictEqual(r.status, 200, r.text);
      assert.strictEqual(r.json.completed, false);
      assert.strictEqual(r.json.balanceCents, 70000);
      assert.ok(r.json.settlement.open.backerAt && !r.json.settlement.open.ownerAt);
      const c = await card();
      assert.strictEqual(c.settlement.open.amountCents, 70000);
    });
    await test('the backer can undo before the owner presses', async () => {
      assert.strictEqual((await backer('undo')).status, 200);
      const f = await feed();
      assert.strictEqual(f.settlement.open, null);
      assert.strictEqual(f.cumulativeCents, 70000);
    });
    await test('a share landing between the two presses voids the half-confirmed one', async () => {
      assert.strictEqual((await mine('confirm', 70000)).status, 200);
      // The new share goes in through the server's own DB: stop, write, boot.
      await srv.stop();
      const d = scratch.open();
      d.run(`INSERT INTO backer_events (id, token, session_id, ts, date, game, venue, hours, session_result_cents, pct, share_cents, source)
             VALUES (?, ?, 'fg-cs-2', 2, '2026-10-02', '2/5 NLH', 'Parx', 4, -50000, 20, -10000, 'ledger')`, [`${TOK}:fg-cs-2`, TOK]);
      scratch.save(d); d.close();
      srv = await boot(scratch.dbPath, { BACKER_DELIVERY: '0', CONSOLE_OWNER_USER_ID: String(ham) }, { ports: PORTS });
      servers.push(srv);
      const f = await feed();
      assert.strictEqual(f.cumulativeCents, 60000);
      assert.strictEqual(f.settlement.open, null, 'the owner\'s press was for $700, not $600');
      const r = await backer('confirm', 60000);
      assert.strictEqual(r.json.completed, false, 'the backer\'s press opens a new one; the old one is void');
      // Two void: the one both sides withdrew (the undo above) and the owner's $700 one.
      assert.strictEqual(q('SELECT COUNT(*) AS n FROM backer_page_settlements WHERE voided_at IS NOT NULL')[0].n, 2);
    });
    await test('another admin cannot press for the owner', async () => {
      assert.strictEqual((await mine('confirm', 60000, other)).status, 403);
    });
    await test('the owner confirms: the page reads $0, one settlement leaves Main, the card says settled', async () => {
      const before = await mainBalance();
      const r = await mine('confirm', 60000);
      assert.strictEqual(r.status, 200, r.text);
      assert.strictEqual(r.json.completed, true);
      assert.strictEqual(r.json.balanceCents, 0);
      const f = await feed();
      assert.strictEqual(f.cumulativeCents, 0);
      assert.strictEqual(f.settlement.open, null);
      assert.deepStrictEqual([f.settlement.last.amountCents, f.settlement.settledCents], [60000, 60000]);
      const adj = q("SELECT kind, amount, settlement_ref FROM bankroll_adjustments WHERE settlement_ref LIKE 'bks:%'");
      assert.strictEqual(adj.length, 1);
      assert.deepStrictEqual([adj[0].kind, adj[0].amount], ['settlement', -600]);
      assert.strictEqual(await mainBalance(), before - 600);
      assert.strictEqual((await card()).cumulativeCents, 0);
    });
    await test('nothing to settle at $0', async () => {
      const r = await backer('confirm', 0);
      assert.strictEqual(r.status, 409);
    });
    await test('an unknown link is a 404', async () => {
      assert.strictEqual((await api('/api/backer/NoSuchLink99/settle', { method: 'POST', body: { action: 'confirm', amountCents: 1 } })).status, 404);
    });
  } catch (e) {
    console.log('  FAIL (setup)', e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n       ') : e);
    process.exitCode = 1;
  } finally {
    for (const s of servers) await s.stop().catch(() => {});
    scratch.cleanup();
  }
  if (process.exitCode) { process.stdout.write('\nbacker-settle.test.js - setup failed\n', () => process.exit(1)); return; }
  done();
})();
