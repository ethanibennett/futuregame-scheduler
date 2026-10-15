// What each plan unlocks (lib/billing/features.js): MONETIZATION-PLAN.md §6, and PAYWALL_LIVE off = open.
'use strict';
const assert = require('assert');
const f = require('../lib/billing/features');
let passed = 0;
const t = (name, fn) => { fn(); passed += 1; console.log('  ok  ', name); };

t('with the paywall off, every plan has everything, unlimited', () => {
  for (const tier of ['free', 'suite_pro', 'suite_pro_plus', null]) {
    const x = f.featuresFor(tier, { live: false });
    assert.strictEqual(x.saves, null); assert.strictEqual(x.table_scanner, true); assert.strictEqual(x.replayer, true);
  }
  assert.strictEqual(f.paywallLive({}), false);
  assert.strictEqual(f.paywallLive({ PAYWALL_LIVE: '1' }), true);
  assert.strictEqual(f.paywallLive({ PAYWALL_LIVE: 'yes' }), false, 'anything but 1 is off');
});

t('with it on: free is capped, Pro opens the planner tools, Pro+ the power tools', () => {
  const free = f.featuresFor('free', { live: true }), pro = f.featuresFor('suite_pro', { live: true }), plus = f.featuresFor('suite_pro_plus', { live: true });
  assert.deepStrictEqual([free.saves, free.results_per_month, free.replayer, free.conflicts], [5, 5, false, false]);
  assert.deepStrictEqual([pro.saves, pro.replayer, pro.export, pro.table_scanner, pro.staking], [null, true, true, false, false]);
  assert.deepStrictEqual([plus.table_scanner, plus.staking, plus.tax_reports, plus.multi_bankrolls], [true, true, true, true]);
  assert.deepStrictEqual(f.featuresFor('planner_pro', { live: true }).replayer, true, 'a single-app Pro reads as Pro');
});

console.log(`billing-features.test.js - ${passed} passed`);
