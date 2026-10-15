// Phase 10 of the bankroll merge (docs/bankroll-merge.md §15 row 10): the money homes through the real
// server: the fund bankroll (role, target, in_roll) on PUT /api/bankrolls/:id and in the list, GET
// /api/bankrolls/money/homes (the fund's saved / target / pace from the ledger, the places, the total
// and the drift against roll + fund, the set-aside rate), PUT /locations (the set replaced) and PUT
// /settings. Scratch ports 4710-4719, a scratch DB, secrets scrubbed. Every figure is invented.
//
//   node test/money-homes.test.js        (npm run test:money-homes)
'use strict';
const assert = require('assert');
const { createScratch, boot, runner } = require('./helpers/scratch-server');
const { fundPace, monthsUntil } = require('../lib/money-homes');

const PORTS = [4710, 4719];
const PW = 'money-homes-test-password-1';

(async () => {
  const { test, done } = runner('money-homes.test.js');
  await test('the pace: what a month must add, and whether the months so far would make it', () => {
    // Average months (365.25 / 12 days): Nov 3 to May 3 is 181 days, 5.95 months.
    const months = monthsUntil('2027-05-03', '2026-11-03');
    assert.ok(Math.abs(months - 181 / (365.25 / 12)) < 1e-9);
    const p = fundPace({ saved: 18000, target: 65000, targetDate: '2027-05-03', firstActivityDate: '2026-05-03' }, '2026-11-03');
    assert.deepStrictEqual([p.left, p.monthsLeft, p.needPerMonth, p.onTrack], [47000, 5.95, Math.round(47000 / months * 100) / 100, false]);
    assert.strictEqual(p.perMonthSoFar, Math.round(18000 / (184 / (365.25 / 12)) * 100) / 100, 'May 3 to Nov 3 is 184 days');
    assert.strictEqual(fundPace({ saved: 70000, target: 65000, targetDate: '2027-05-03' }, '2026-11-03').left, 0);
    assert.strictEqual(fundPace({ saved: 1, target: null }, '2026-11-03'), null);
  });
  const scratch = await createScratch({ ports: PORTS, prefix: 'fg-money-homes-' });
  const servers = [];
  try {
    let srv = await boot(scratch.dbPath, {}, { ports: PORTS });
    servers.push(srv);
    const api = (p, { token, method = 'GET', body } = {}) => fetch(`http://127.0.0.1:${srv.port}${p}`, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) { /* */ } return { status: r.status, json, text }; });
    for (const [u, e] of [['adminx', 'adminx@x.test'], ['plainuser', 'plainuser@x.test']]) {
      assert.strictEqual((await api('/api/register', { method: 'POST', body: { username: u, email: e, password: PW, realName: u } })).status, 201);
    }
    await srv.stop();
    const db = scratch.open();
    db.run("UPDATE users SET username = 'ham5' WHERE username = 'adminx'");
    scratch.save(db); db.close();
    srv = await boot(scratch.dbPath, {}, { ports: PORTS });
    servers.push(srv);
    const login = async (email) => (await api('/api/login', { method: 'POST', body: { email, password: PW } })).json.token;
    const admin = await login('adminx@x.test');
    const plain = await login('plainuser@x.test');
    const A = (p, o = {}) => api(p, { token: admin, ...o });

    let fundId = null;
    await test('a bankroll becomes the fund with a target; the list carries role, in_roll and the target; a second fund takes the role over', async () => {
      const c = await A('/api/bankrolls', { method: 'POST', body: { name: 'WSOP fund', startingBalance: 1000, currency: 'USD' } });
      assert.strictEqual(c.status, 201, c.text);
      fundId = c.json.bankroll.id;
      const u = await A(`/api/bankrolls/${fundId}`, { method: 'PUT', body: { role: 'fund', targetAmount: 65000, targetDate: '2027-05-03' } });
      assert.strictEqual(u.status, 200, u.text);
      assert.deepStrictEqual([u.json.bankroll.role, u.json.bankroll.in_roll, u.json.bankroll.target_amount, u.json.bankroll.target_date], ['fund', 0, 65000, '2027-05-03']);
      assert.strictEqual((await A(`/api/bankrolls/${fundId}`, { method: 'PUT', body: { targetDate: 'May' } })).status, 400);
      const c2 = await A('/api/bankrolls', { method: 'POST', body: { name: 'Side', startingBalance: 0, currency: 'USD' } });
      await A(`/api/bankrolls/${c2.json.bankroll.id}`, { method: 'PUT', body: { role: 'fund' } });
      const list = (await A('/api/bankrolls')).json.bankrolls;
      assert.deepStrictEqual(list.filter((b) => b.role === 'fund').map((b) => b.name), ['Side']);
      await A(`/api/bankrolls/${c2.json.bankroll.id}`, { method: 'PUT', body: { role: null, inRoll: false } });
      await A(`/api/bankrolls/${fundId}`, { method: 'PUT', body: { role: 'fund' } });
      const again = (await A('/api/bankrolls')).json.bankrolls;
      assert.deepStrictEqual([again.find((b) => b.name === 'Side').in_roll, again.find((b) => b.name === 'WSOP fund').role], [0, 'fund']);
    });
    await test('homes: the fund from the ledger with its pace, no places yet, the default rate; an ordinary user is refused', async () => {
      assert.strictEqual((await A('/api/bankrolls/adjustments', { method: 'POST', body: { kind: 'deposit', bankroll: 'main', amount: 5000, date: '2026-09-01' } })).status, 201);
      assert.strictEqual((await A('/api/bankrolls/adjustments', { method: 'POST', body: { kind: 'deposit', bankroll: fundId, amount: 2000, date: '2026-09-15' } })).status, 201);
      const h = await A('/api/bankrolls/money/homes');
      assert.strictEqual(h.status, 200, h.text);
      assert.deepStrictEqual([h.json.fund.bankrollId, h.json.fund.saved, h.json.fund.target, h.json.fund.targetDate, h.json.fund.firstActivityDate], [fundId, 3000, 65000, '2027-05-03', '2026-09-15']);
      assert.ok(h.json.fund.pace && h.json.fund.pace.left === 62000 && h.json.fund.pace.needPerMonth > 0);
      assert.deepStrictEqual([h.json.roll, h.json.wsopFund, h.json.locations, h.json.locationsTotal, h.json.drift, h.json.taxSetAsidePct], [5000, 3000, [], 0, -8000, 30]);
      assert.strictEqual((await api('/api/bankrolls/money/homes', { token: plain })).status, 403);
    });
    await test('the places: the set replaced in order, the total and the drift against roll + fund; a bad row refused', async () => {
      const p = await A('/api/bankrolls/money/locations', { method: 'PUT', body: { locations: [{ name: 'Safe', amount: 6000 }, { name: 'Parx cage', amount: 1500.5 }, { name: 'Euros', amount: 900, currency: 'EUR' }] } });
      assert.strictEqual(p.status, 200, p.text);
      assert.deepStrictEqual(p.json.locations.map((l) => [l.name, l.amount, l.currency]), [['Safe', 6000, 'USD'], ['Parx cage', 1500.5, 'USD'], ['Euros', 900, 'EUR']]);
      const h = (await A('/api/bankrolls/money/homes')).json;
      assert.deepStrictEqual([h.locationsTotal, h.drift, h.foreign], [7500.5, -499.5, 1]);
      const ids = p.json.locations.map((l) => l.id);
      const q = await A('/api/bankrolls/money/locations', { method: 'PUT', body: { locations: [{ id: ids[1], name: 'Parx cage', amount: 2000 }, { name: 'Bank', amount: 6000 }] } });
      assert.deepStrictEqual(q.json.locations.map((l) => [l.id === ids[1], l.name, l.amount]), [[true, 'Parx cage', 2000], [false, 'Bank', 6000]]);
      assert.strictEqual((await A('/api/bankrolls/money/homes')).json.drift, 0);
      assert.strictEqual((await A('/api/bankrolls/money/locations', { method: 'PUT', body: { locations: [{ name: '', amount: 1 }] } })).status, 400);
      assert.strictEqual((await A('/api/bankrolls/money/locations', { method: 'PUT', body: { locations: [{ name: 'x', amount: 'lots' }] } })).status, 400);
      assert.strictEqual((await api('/api/bankrolls/money/locations', { token: plain, method: 'PUT', body: { locations: [] } })).status, 403);
    });
    await test('the settings: the set-aside rate and the default bankroll, refused out of range', async () => {
      const s = await A('/api/bankrolls/money/settings', { method: 'PUT', body: { taxSetAsidePct: 35, defaultBankroll: fundId } });
      assert.strictEqual(s.status, 200, s.text);
      assert.deepStrictEqual(s.json, { taxSetAsidePct: 35, defaultBankroll: fundId });
      assert.strictEqual((await A('/api/bankrolls/money/homes')).json.taxSetAsidePct, 35);
      assert.strictEqual((await A('/api/bankrolls/money/settings', { method: 'PUT', body: { taxSetAsidePct: 120 } })).status, 400);
      assert.strictEqual((await A('/api/bankrolls/money/settings', { method: 'PUT', body: { defaultBankroll: 999 } })).status, 400);
      assert.strictEqual((await A('/api/bankrolls/money/settings', { method: 'PUT', body: { defaultBankroll: 'main' } })).json.defaultBankroll, 'main');
    });
  } catch (e) {
    console.log('  FAIL (setup)', e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n       ') : e);
    process.exitCode = 1;
  } finally {
    for (const s of servers) await s.stop().catch(() => {});
    scratch.cleanup();
  }
  if (process.exitCode) { process.stdout.write('\nmoney-homes.test.js - setup failed\n', () => process.exit(1)); return; }
  done();
})();
