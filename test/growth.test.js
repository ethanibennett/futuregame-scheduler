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
    assert.deepStrictEqual({ ...nov, sources: undefined }, { week: '2026-11-09', signups: 3, activated7: 1, d7: 1, d30: 1, d7Ready: 3, d30Ready: 3, sources: undefined });
    assert.deepStrictEqual(nov.sources, { 'meta-m1': 1, friend: 1, unknown: 1 });
    assert.strictEqual(dec.d7Ready, 0, 'nine days old: no D7 yet');
    assert.deepStrictEqual(dec.sources, { reddit: 1 });
    assert.strictEqual(r.totals.signups, 4);
  });

  t('mondayOf: a Sunday belongs to the week before', () => {
    assert.strictEqual(growth.mondayOf(Date.UTC(2026, 10, 15, 23)), '2026-11-09');
    assert.strictEqual(growth.mondayOf(Date.UTC(2026, 10, 16, 0)), '2026-11-16');
  });

  console.log(`growth.test.js — ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
