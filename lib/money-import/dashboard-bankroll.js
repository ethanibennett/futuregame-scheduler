'use strict';
/*
 * The dashboard's roll and fund, as the dashboard computes them: a port of
 * WC:app/src/engine/bankroll.ts computeBankroll (the server copy is WC:server/lib/dashboard.js:142-157):
 *
 *   playingRoll = startingRoll + Σ non-fund session results + Σ adjustments that are neither a fund
 *                 transfer nor a backer settlement − Σ fund transfers
 *   wsopFund    = Σ fund transfers + Σ fund session results + Σ backer settlements
 *
 * The reconciliation (docs/bankroll-merge.md §5.8) needs it record by record, so a delta pull can
 * update the dashboard's figures without the whole history: `effectOf` is one record's share of the
 * two sums, and `totals` adds them up. Summed over the same records, `totals` IS computeBankroll
 * (test/money-import.test.js ports the formula a second time, independently, as the oracle).
 */

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** One live dashboard record's effect on the dashboard's roll and fund. Expenses, backers, settings: none. */
function effectOf(store, data) {
  if (!data || typeof data !== 'object') return null;
  if (store === 'sessions') {
    const r = num(data.result);
    return data.isWsopFund ? { roll: 0, fund: r } : { roll: r, fund: 0 };
  }
  if (store === 'adjustments') {
    const a = num(data.amount);
    if (data.type === 'wsop-fund-transfer') return { roll: -a, fund: a };
    if (data.type === 'backer-settlement') return { roll: 0, fund: a };
    return { roll: a, fund: 0 };
  }
  return null;
}

/** computeBankroll's two figures from a dashboard state { startingRoll, records: { fp: { roll, fund } } }. */
function totals(state) {
  let roll = num(state && state.startingRoll), fund = 0;
  for (const r of Object.values((state && state.records) || {})) { roll += num(r.roll); fund += num(r.fund); }
  return { roll: Math.round(roll * 100) / 100, fund: Math.round(fund * 100) / 100 };
}

module.exports = { effectOf, totals };
