// ── Settling a finished hand: the export's own arithmetic ─────────────────────────────────────────
// The play-money dealer pays a pot exactly as the hand-history export settles it (prepareHand, held to
// PokerKit by test/replayer-oracle/check-export.mjs): side pots in layers, a big-blind ante as dead money,
// odd chips by the TDA. Nothing here does its own sums of who won what.

import { prepareHand } from '../hand-history/prepare.js';

/**
 * Each seat's stack at the end of a hand, in the hand's own units, and what each won.
 * `hand` is the full hand in the app's saved form, every live seat's cards known.
 * Returns { finals: number[], won: number[], net: number[], lines, pots } (lines and pots in cents, as
 * prepareHand gives them).
 */
export function settleHand(hand) {
  const prep = prepareHand(hand);
  const n = hand.players.length;
  const cents = hand.players.map((p) => Math.round(Number(p.startingStack) * 100));
  const out = cents.slice();
  for (const f of prep.events.forced) out[f.p] -= f.amount;
  for (const sev of prep.events.streets) {
    for (const a of sev.actions) out[a.p] -= a.amount || 0;
    if (sev.uncalled) out[sev.uncalled.p] += sev.uncalled.amount;
  }
  const won = new Array(n).fill(0);
  for (const [p, amt] of Object.entries(prep.settle.won)) { out[Number(p)] += amt; won[Number(p)] = amt; }
  const total = cents.reduce((a, b) => a + b, 0);
  if (out.reduce((a, b) => a + b, 0) !== total) throw new Error('settleHand: chips in and out differ');
  return {
    finals: out.map((c) => c / 100),
    won: won.map((c) => c / 100),
    net: out.map((c, i) => (c - cents[i]) / 100),
    lines: prep.settle.lines,
    pots: prep.settle.pots,
  };
}
