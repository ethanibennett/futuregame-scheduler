'use strict';
/*
 * What each plan unlocks (MONETIZATION-PLAN.md §6, as written; 2026-10-15). The server answers it, so
 * the web and the app can never disagree: GET /api/subscription carries { paywallLive, features }.
 *
 * PAYWALL_LIVE is OFF until the owner turns it on (planned for Mon 1 Mar 2027). While it is off every
 * feature is open and every limit unlimited, whatever the plan, so shipping this changes nothing.
 * Owner decisions still open before it goes on: the launch feature set (launch plan action 2) and
 * whether the clash check stays free, since the launch plan leads every ad with it and §6 gates it.
 *
 * A value is true / false, or a number: a limit (saves, results a month); null = unlimited.
 */
const TIERS = ['free', 'suite_pro', 'suite_pro_plus'];
const MATRIX = {
  //                   free   pro    pro+
  saves:              [5,     null,  null],
  results_per_month:  [5,     null,  null],
  calendar_sync:      [false, true,  true],
  export:             [false, true,  true],
  replayer:           [false, true,  true],
  live_updates:       [false, true,  true],
  smart_alerts:       [false, true,  true],
  conflicts:          [false, true,  true],
  social_full:        [false, true,  true],
  ad_free:            [false, true,  true],
  table_scanner:      [false, false, true],
  staking:            [false, false, true],
  analytics:          [false, false, true],
  tax_reports:        [false, false, true],
  multi_bankrolls:    [false, false, true],
  priority_support:   [false, false, true],
};

const paywallLive = (env = process.env) => env.PAYWALL_LIVE === '1';

/** The plan's features for a tier ('free' for no plan; the suite tiers; single-app tiers read as Pro). */
function featuresFor(tier, { live = paywallLive() } = {}) {
  const col = tier === 'suite_pro_plus' ? 2 : (!tier || tier === 'free') ? 0 : 1;
  const out = {};
  for (const [k, v] of Object.entries(MATRIX)) {
    out[k] = live ? v[col] : (typeof v[0] === 'number' || v[0] === null ? null : true);
  }
  return out;
}

module.exports = { TIERS, MATRIX, paywallLive, featuresFor };
