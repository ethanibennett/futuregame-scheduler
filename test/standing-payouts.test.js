// Phase 14 of the bankroll merge (owner Q10): standing payouts through the real server. A payout
// lowers the backer's running total on their page and in the Standing list, writes one settlement into
// the chosen bankroll (settlement_ref 'sp:<id>', never profit), and removing it takes both back. A
// backer who pays the player raises the total and adds to the bankroll. Another player's agreement is
// refused. Scratch ports 4730-4739, a scratch DB, secrets scrubbed, delivery off. Every figure is
// invented.
//
//   node test/standing-payouts.test.js        (npm run test:standing-payouts)
'use strict';
const assert = require('assert');
const fs = require('fs');
const { createScratch, boot, sqlJs, one, rowsOf, runner } = require('./helpers/scratch-server');

const PORTS = [4730, 4739];
const PW = 'standing-payouts-test-password-1';
const TOK = 'PayoutSam01';

(async () => {
  const { test, done } = runner('standing-payouts.test.js');
  const scratch = await createScratch({ ports: PORTS, prefix: 'fg-payouts-' });
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
    db.run('INSERT INTO backers (user_id, name, public_token, notify_sms, notify_email) VALUES (?, ?, ?, 0, 0)', [ham, 'Sam Payout', TOK]);
    const sam = one(db, 'SELECT last_insert_rowid()');
    db.run("INSERT INTO standing_agreements (user_id, backer_id, effective_from, status, opening_cents, created_at) VALUES (?, ?, '2026-01-01', 'active', 10000, '2026-01-01T00:00:00Z')", [ham, sam]);
    const ag = one(db, 'SELECT last_insert_rowid()');
    db.run(`INSERT INTO backer_events (id, token, session_id, ts, date, game, venue, hours, session_result_cents, pct, share_cents, source, agreement_id, notified_share_cents, notified_at)
            VALUES (?, ?, 'fg-cs-1', 1, '2026-10-01', '2/5 NLH', 'Parx', 5, 300000, 20, 60000, 'ledger', ?, 60000, 1)`, [`${TOK}:fg-cs-1`, TOK, ag]);
    db.run("INSERT INTO bankroll_adjustments (user_id, bankroll_id, kind, amount, occurred_on, note, created_at) VALUES (?, NULL, 'deposit', 5000, '2026-09-01', 'seed', '2026-09-01T00:00:00Z')", [ham]);
    scratch.save(db); db.close();
    srv = await boot(scratch.dbPath, { BACKER_PAGE_SOURCE: 'sql', BACKER_DELIVERY: '0' }, { ports: PORTS });
    servers.push(srv);
    const login = async (email) => (await api('/api/login', { method: 'POST', body: { email, password: PW } })).json.token;
    const owner = await login('adminx@x.test');
    const other = await login('otheradm@x.test');
    const O = (p, o = {}) => api(p, { token: owner, ...o });
    const feed = async () => (await api(`/api/backer/${TOK}/feed`)).json;
    const main = async () => (await O('/api/bankrolls/summary')).json.bankrolls.find((b) => b.id === 'main');

    let first = null;
    await test('before any payout the page is as it was: no paidCents, the total is shares plus opening', async () => {
      const f = await feed();
      assert.strictEqual(f.cumulativeCents, 70000);
      assert.ok(!('paidCents' in f));
      assert.strictEqual((await main()).balance, 5000);
    });
    await test('the player pays $500: the page drops by it, the list says paid, one settlement leaves Main', async () => {
      const r = await O(`/api/staking/standing/${ag}/payments`, { method: 'POST', body: { amountCents: 50000, paidOn: '2026-10-10', note: 'cash' } });
      assert.strictEqual(r.status, 201, r.text);
      first = r.json.payment;
      assert.deepStrictEqual([first.amountCents, first.paidOn, first.note, r.json.paidCents], [50000, '2026-10-10', 'cash', 50000]);
      const f = await feed();
      assert.deepStrictEqual([f.cumulativeCents, f.paidCents, f.netSessionCents], [20000, 50000, 60000]);
      const adj = q('SELECT kind, amount, occurred_on, settlement_ref, bankroll_id FROM bankroll_adjustments WHERE settlement_ref = ?', [`sp:${first.id}`]);
      assert.deepStrictEqual(adj, [{ kind: 'settlement', amount: -500, occurred_on: '2026-10-10', settlement_ref: `sp:${first.id}`, bankroll_id: null }]);
      const m = await main();
      assert.deepStrictEqual([m.balance, m.results], [4500, 0], 'the balance moves and the results do not');
      const list = (await O('/api/staking/standing')).json.agreements.find((a) => a.id === ag);
      assert.deepStrictEqual([list.paidCents, list.runningCents], [50000, 20000]);
    });
    await test('the backer pays $200 back: the total rises, Main gains it; the list shows both, newest first', async () => {
      const r = await O(`/api/staking/standing/${ag}/payments`, { method: 'POST', body: { amountCents: -20000, paidOn: '2026-10-12' } });
      assert.strictEqual(r.status, 201, r.text);
      assert.strictEqual((await feed()).cumulativeCents, 40000);
      assert.strictEqual((await main()).balance, 4700);
      const l = await O(`/api/staking/standing/${ag}/payments`);
      assert.deepStrictEqual(l.json.payments.map((p) => [p.amountCents, p.paidOn]), [[-20000, '2026-10-12'], [50000, '2026-10-10']]);
      assert.strictEqual(l.json.paidCents, 30000);
    });
    await test('the refusals: zero, cents, a bad day, another bankroll in another currency, another player\'s agreement', async () => {
      const bad = (body) => O(`/api/staking/standing/${ag}/payments`, { method: 'POST', body }).then((r) => r.status);
      assert.strictEqual(await bad({ amountCents: 0 }), 400);
      assert.strictEqual(await bad({ amountCents: 1050 }), 400);
      assert.strictEqual(await bad({ amountCents: 1000, paidOn: 'yesterday' }), 400);
      const eur = await O('/api/bankrolls', { method: 'POST', body: { name: 'Euro roll', startingBalance: 0, currency: 'EUR' } });
      assert.strictEqual(await bad({ amountCents: 1000, bankroll: eur.json.bankroll.id }), 400);
      assert.strictEqual((await api(`/api/staking/standing/${ag}/payments`, { token: other, method: 'POST', body: { amountCents: 1000 } })).status, 404);
      assert.strictEqual((await api(`/api/staking/standing/payments/${first.id}`, { token: other, method: 'DELETE' })).status, 404);
    });
    await test('removing a payout takes its settlement with it and the total back', async () => {
      const r = await O(`/api/staking/standing/payments/${first.id}`, { method: 'DELETE' });
      assert.strictEqual(r.status, 200, r.text);
      assert.strictEqual(r.json.paidCents, -20000);
      assert.strictEqual(q('SELECT COUNT(*) AS n FROM bankroll_adjustments WHERE settlement_ref = ?', [`sp:${first.id}`])[0].n, 0);
      assert.strictEqual((await feed()).cumulativeCents, 90000);
      assert.strictEqual((await main()).balance, 5200);
    });
  } catch (e) {
    console.log('  FAIL (setup)', e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n       ') : e);
    process.exitCode = 1;
  } finally {
    for (const s of servers) await s.stop().catch(() => {});
    scratch.cleanup();
  }
  if (process.exitCode) { process.stdout.write('\nstanding-payouts.test.js - setup failed\n', () => process.exit(1)); return; }
  done();
})();
