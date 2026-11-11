// ── What a saved hand did for each seat ─────────────────────────────────────
// The saved list shows the hero's net for each hand (UX pick 55): the final stack less the starting
// one. It is worked out by the hand-history writer's own replay and settlement (prepareHand: the
// betting on quick-add's Table, uncalled bets returned, the pot settled as the replayer settles it),
// so the list, the export and the felt cannot disagree. A hand that cannot be settled (unknown hero
// cards, several boards, a game the writer does not carry) has no figure: null, never a guess.
import { prepareHand } from './hand-history/index.js';
import { handOfRow } from './hand-history/rows.js';

/** Each seat's net in the hand's own units (chips, or dollars and cents in a cash hand), or null. */
export function seatNets(row) {
  const hand = handOfRow(row);
  // Two seats at least: prepareHand never returns on a table with nobody at it.
  if (!hand || !Array.isArray(hand.players) || hand.players.length < 2 || !Array.isArray(hand.streets)) return null;
  let prep;
  try { prep = prepareHand(hand, {}); } catch (_) { return null; }
  const n = prep.meta.n;
  const cents = new Array(n).fill(0);
  for (const f of prep.events.forced) cents[f.p] -= f.amount || 0;
  for (const st of prep.events.streets) {
    for (const a of st.actions || []) if (Number.isInteger(a.p)) cents[a.p] -= a.amount || 0;
    if (st.uncalled) cents[st.uncalled.p] += st.uncalled.amount || 0;
  }
  for (const [seat, amt] of Object.entries(prep.settle.won || {})) cents[Number(seat)] += amt || 0;
  return cents.map((c) => Math.round(c) / 100);
}

/** The hero's net, or null. */
export function heroNet(row) {
  const nets = seatNets(row);
  if (!nets) return null;
  const h = handOfRow(row);
  const hero = h && h.heroIdx != null ? h.heroIdx : 0;
  return nets[hero] == null ? null : nets[hero];
}
