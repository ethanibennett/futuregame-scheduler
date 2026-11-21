// First-party growth measurement (lib/growth.js; launch plan, action 5): sources cleaned, activation
// recorded once, active days, and the weekly cohort report's arithmetic.
//
//   node test/growth.test.js        (npm run test:growth)
//
// In process, on a scratch sql.js database. Every account and figure is invented.
'use strict';
const assert = require('assert');
const initSqlJs = require('sql.js');
const growth = require('../lib/growth');

const DAY = 864e5;
let passed = 0;
const t = (name, fn) => { fn(); passed += 1; console.log('  ok  ', name); };

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  growth.migrate(db);
  growth.migrate(db); // idempotent
  db.run('CREATE TABLE user_schedules (user_id INTEGER, tournament_id INTEGER, added_at TEXT)');

  t('cleanSource keeps known fields and drops the rest', () => {
    assert.deepStrictEqual(growth.cleanSource({ ct: 'meta-m1', landing: 'live', ref: 'L.Instagram.com', heard: 'friend', platform: 'ios', evil: 'x' }),
      { ct: 'meta-m1', landing: 'live', ref: 'l.instagram.com', heard: 'friend', platform: 'ios' });
    assert.deepStrictEqual(growth.cleanSource({ ct: 'a b', heard: 'billboard', platform: 'windows', ref: 'x/y' }), {});
    assert.deepStrictEqual(growth.cleanSource(null), {});
  });

  const NOW = Date.UTC(2026, 11, 31, 12); // Thu 31 Dec 2026
  // Week of Mon 9 Nov: three sign-ups, old enough for D7 and D30.
  const nov9 = Date.UTC(2026, 10, 9, 15);
  growth.recordSignup(db, 1, { ct: 'meta-m1', landing: 'live' }, nov9);
  growth.recordSignup(db, 2, { heard: 'friend' }, nov9 + DAY);
  growth.recordSignup(db, 3, {}, nov9 + 2 * DAY);
  growth.recordOnce(db, 1, 'activated', { tournamentId: 7 }, nov9 + 2 * DAY);      // within 7 days
  growth.recordOnce(db, 2, 'activated', null, nov9 + DAY + 9 * DAY);              // too late for activated7
  growth.touchDay(db, 1, nov9 + 8 * DAY);   // D7
  growth.touchDay(db, 1, nov9 + 30 * DAY);  // D30
  growth.touchDay(db, 2, nov9 + DAY + 20 * DAY); // neither window
  // Account 1: three saves in its first week and one after; it finished setup, logged a result, shared.
  const sql = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  for (const d of [0, 2, 5, 9]) db.run('INSERT INTO user_schedules VALUES (1, ?, ?)', [d, sql(nov9 + d * DAY + 3600e3)]);
  growth.recordOnce(db, 1, 'onboarded', null, nov9 + 60e3);
  growth.recordOnce(db, 1, 'result_logged', null, nov9 + 3 * DAY);
  growth.recordOnce(db, 1, 'share_sent', null, nov9 + 4 * DAY);
  growth.recordOnce(db, 2, 'followed', null, nov9 + 30 * DAY);   // too late for the 7-day count
  growth.recordSignup(db, 5, { utm_source: 'meta', utm_campaign: '2701-midatl', fbclid: 'x' }, nov9 + 3 * DAY);
  // Week of Mon 21 Dec: one sign-up, too young for D7.
  growth.recordSignup(db, 4, { src: 'reddit' }, Date.UTC(2026, 11, 22, 10));

  t('recordOnce writes the first time only', () => {
    assert.strictEqual(growth.recordOnce(db, 1, 'activated', null, NOW), false);
    const n = db.exec("SELECT COUNT(*) FROM growth_events WHERE user_id = 1 AND kind = 'activated'")[0].values[0][0];
    assert.strictEqual(n, 1);
  });

  t('touchDay records one row per account per day', () => {
    growth.touchDay(db, 9, NOW); growth.touchDay(db, 9, NOW + 1000);
    assert.strictEqual(db.exec('SELECT COUNT(*) FROM user_days WHERE user_id = 9')[0].values[0][0], 1);
    growth.touchDay(db, 'guest', NOW);
  });

  t('the cohort report: activation within 7 days, D7 and D30 once old enough, by source', () => {
    const r = growth.report(db, { now: NOW, weeks: 13 });
    assert.deepStrictEqual(r.weeks.map((w) => w.week), ['2026-12-21', '2026-11-09']);
    const [dec, nov] = r.weeks;
    const pick = (w, ks) => Object.fromEntries(ks.map((k) => [k, w[k]]));
    assert.deepStrictEqual(pick(nov, ['week', 'signups', 'activated7', 'd7', 'd30', 'd7Ready', 'd30Ready']), { week: '2026-11-09', signups: 4, activated7: 1, d7: 1, d30: 1, d7Ready: 4, d30Ready: 4 });
    assert.deepStrictEqual(pick(nov, ['onboarded7', 'results7', 'shared7', 'followed7', 'savesFirst7']), { onboarded7: 1, results7: 1, shared7: 1, followed7: 0, savesFirst7: 3 });
    assert.deepStrictEqual(nov.sources, { 'meta-m1': 1, friend: 1, unknown: 1, 'meta/2701-midatl': 1 }, 'UTM source/campaign when no ct');
    assert.strictEqual(dec.d7Ready, 0, 'nine days old: no D7 yet');
    assert.deepStrictEqual(dec.sources, { reddit: 1 });
    assert.strictEqual(r.totals.signups, 5);
    const five = JSON.parse(db.exec('SELECT data FROM growth_events WHERE user_id = 5')[0].values[0][0]);
    assert.deepStrictEqual(five, { utm_source: 'meta', utm_campaign: '2701-midatl' }, 'no click id kept');
  });

  t('mondayOf: a Sunday belongs to the week before', () => {
    assert.strictEqual(growth.mondayOf(Date.UTC(2026, 10, 15, 23)), '2026-11-09');
    assert.strictEqual(growth.mondayOf(Date.UTC(2026, 10, 16, 0)), '2026-11-16');
  });

  t('isPaid: Apple Ads, a paid UTM medium, or a paid channel ct; everything else organic', () => {
    assert.strictEqual(growth.isPaid({ ct: 'meta-ad02-phl-2701' }), true);
    assert.strictEqual(growth.isPaid({ utm_source: 'meta', utm_medium: 'paid' }), true);
    assert.strictEqual(growth.isPaid({}, { campaignId: 42 }), true);
    assert.strictEqual(growth.isPaid({ utm_source: 'meta', utm_medium: 'organic' }), false);
    assert.strictEqual(growth.isPaid({ heard: 'instagram' }), false);
    assert.strictEqual(growth.isPaid({ ct: 'live-page' }), false);
  });

  t('setSpend: a Monday and a known channel only; 0 removes the row', () => {
    assert.throws(() => growth.setSpend(db, '2027-01-06', 'meta', 100), /Monday/);
    assert.throws(() => growth.setSpend(db, '2027-01-04', 'tiktok', 100), /channel/);
    assert.throws(() => growth.setSpend(db, '2027-01-04', 'meta', 1.5), /whole/);
    growth.setSpend(db, '2027-01-04', 'meta', 5000);
    growth.setSpend(db, '2027-01-04', 'meta', 7000);
    assert.deepStrictEqual(db.exec("SELECT cents FROM growth_spend WHERE week = '2027-01-04'")[0].values, [[7000]]);
    growth.setSpend(db, '2027-01-04', 'meta', 0);
    assert.strictEqual(db.exec("SELECT COUNT(*) FROM growth_spend WHERE week = '2027-01-04'")[0].values[0][0], 0);
  });

  t('the Monday scorecard: last week, each cohort once old enough, spend, statuses from launch', () => {
    // A separate database: launch week and the two after it, every account invented.
    const sdb = new SQL.Database();
    growth.migrate(sdb);
    sdb.run('CREATE TABLE user_schedules (user_id INTEGER, tournament_id INTEGER, added_at TEXT)');
    const jan4 = Date.UTC(2027, 0, 4, 15);   // Mon 4 Jan 2027
    // Week of 4 Jan: four sign-ups, two paid (a Meta ct, an Apple Ads install), two organic.
    growth.recordSignup(sdb, 11, { ct: 'meta-ad02-phl-2701' }, jan4 + 3600e3);
    growth.recordSignup(sdb, 12, {}, jan4 + DAY); sdb.run("INSERT INTO growth_events (user_id, kind, at, data) VALUES (12, 'apple_ads', ?, ?)", [jan4 + DAY, JSON.stringify({ campaignId: 7 })]);
    growth.recordSignup(sdb, 13, { heard: 'friend' }, jan4 + 2 * DAY);
    growth.recordSignup(sdb, 14, { heard: 'instagram' }, jan4 + 3 * DAY);
    growth.recordOnce(sdb, 11, 'activated', null, jan4 + DAY);       // paid, activated
    growth.recordOnce(sdb, 12, 'activated', null, jan4 + 2 * DAY);   // paid, activated
    growth.recordOnce(sdb, 13, 'activated', null, jan4 + 3 * DAY);   // organic, activated
    growth.recordOnce(sdb, 11, 'share_sent', null, jan4 + 2 * DAY);
    growth.touchDay(sdb, 11, jan4 + DAY + 3600e3);                    // D1 for 11
    growth.touchDay(sdb, 13, jan4 + 3 * DAY + 3600e3);                // D1 for 13
    growth.touchDay(sdb, 11, jan4 + 9 * DAY);                         // D7 for 11
    growth.setSpend(sdb, '2027-01-04', 'meta', 2000);
    growth.setSpend(sdb, '2027-01-04', 'apple', 1000);
    // Week of 18 Jan: two sign-ups, one paid.
    const jan18 = Date.UTC(2027, 0, 18, 12);
    growth.recordSignup(sdb, 21, { utm_source: 'meta', utm_medium: 'paid' }, jan18);
    growth.recordSignup(sdb, 22, { heard: 'reddit' }, jan18 + DAY);
    growth.setSpend(sdb, '2027-01-18', 'meta', 4500);

    const NOW2 = Date.UTC(2027, 0, 25, 14);   // Mon 25 Jan 2027, 09:00 ET
    const s = growth.scorecard(sdb, { now: NOW2 });
    const f = Object.fromEntries(s.figures.map((x) => [x.key, x]));
    assert.strictEqual(s.week, '2027-01-18');
    assert.strictEqual(s.live, true);
    assert.deepStrictEqual([f.newAccounts.value, f.newAccounts.week, f.newAccounts.status], [2, '2027-01-18', 'act'], '2 in a week is under 150');
    assert.strictEqual(f.organicShare.value, 0.5);
    assert.strictEqual(f.organicShare.status, 'ok');
    // Activation needs 7 days after the week ends: on 25 Jan that is the week of 11 Jan (empty)...
    assert.strictEqual(f.activation.week, '2027-01-11');
    assert.strictEqual(f.activation.value, null);
    // ...so read it a week later, when the week of 4 Jan is the newest one with D7 too.
    const s2 = growth.scorecard(sdb, { now: Date.UTC(2027, 0, 26, 14) });
    const g = Object.fromEntries(s2.figures.map((x) => [x.key, x]));
    assert.strictEqual(s2.week, '2027-01-18');
    const s3 = growth.scorecard(sdb, { now: Date.UTC(2027, 0, 18, 14) });   // Mon 18 Jan
    const h = Object.fromEntries(s3.figures.map((x) => [x.key, x]));
    assert.strictEqual(h.activation.week, '2027-01-04');
    assert.strictEqual(h.activation.value, 0.75);
    assert.strictEqual(h.activation.status, 'ok');
    assert.strictEqual(h.savesPerActivated.value, 0);
    assert.strictEqual(h.sharesPer100.value, 25);
    assert.strictEqual(h.costPerActivated.value, 1500, '$30 over 2 paid activated accounts = $15');
    assert.strictEqual(h.costPerActivated.status, 'watch', '$15 is past the $12 target, short of the $20 line');
    assert.strictEqual(h.d1.week, '2027-01-04');
    assert.strictEqual(h.d1.value, 0.5);
    assert.strictEqual(g.d7.week, '2027-01-04');
    assert.strictEqual(g.d7.value, 0.25);
    assert.strictEqual(f.costPerPaidSignup.value, 4500, '$45 over one paid sign-up');
    assert.deepStrictEqual(s.spend, { week: '2027-01-18', channels: { meta: 4500 }, totalCents: 4500 });
    assert.ok(s.elsewhere.length >= 4);
    // Before launch, figures but no statuses.
    const pre = growth.scorecard(sdb, { now: Date.UTC(2026, 11, 28, 14) });
    assert.strictEqual(pre.live, false);
    assert.ok(pre.figures.every((x) => x.status === null));
  });

  console.log(`growth.test.js — ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
