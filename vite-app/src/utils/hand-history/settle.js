// ── Hand history: who is paid what, pot by pot ──────────────────────────────
// Mirrors the replayer's own settlement in vite-app/src/components/
// HandReplayerView.jsx — `settled` (uncalled returns), `allPotLayers` (the pot
// layers) and `potAwards` (per-layer awards and their scoring) — and uses the
// same engine functions (hiLoWinnersAmong, potLayerWinners, computePotAwards).
// Change one, change the other: the replayer shows what this file writes.
//
// Differences, both deliberate and both what PokerStars does:
//   - stud antes are layered like any other chips (a player all-in on the ante
//     plays for a main pot of antes; "Main pot 320. Side pot 300." observed),
//     where the replayer counts every ante as dead money in the main pot. A
//     big-blind ante is dead money in the main pot in both.
//   - each layer is split on its own, half by half, so the text can carry one
//     collect line per share ("Hero collected 43 from side pot" for the high
//     half, then each low share) as Stars writes them.
// All amounts are integer hundredths.

import {
  computePotAwards, hiLoWinnersAmong, potLayerWinners,
  bestHighHand, bestOmahaHigh, bestOmahaLow, bestLowA5Hand, bestLow27Hand, bestBadugiHand,
} from '../poker-engine.js';
import { HandExportError } from './errors.js';

/* Pot layers from each player's contribution (the replayer's allPotLayers):
   every distinct contribution of a live all-in player caps a layer; a layer is
   contested by the live players who reached it; folded players' chips count in
   every layer they reached. Main pot first. */
export function buildLayers(contrib, live, allInEnd) {
  const n = contrib.length;
  const caps = [...new Set(live.filter(p => allInEnd.has(p)).map(p => contrib[p]))].sort((a, b) => a - b);
  const layers = [];
  let floor = 0;
  for (const cap of [...caps, Infinity]) {
    const players = live.filter(p => contrib[p] > floor);
    let amount = 0;
    for (let i = 0; i < n; i++) amount += Math.max(0, Math.min(contrib[i], cap) - floor);
    if (amount > 0) {
      if (players.length) layers.push({ amount, players });
      // Chips above every live player's total. After the uncalled returns this
      // cannot happen; if it did, they stay in the pot below rather than vanish.
      else if (layers.length) layers[layers.length - 1].amount += amount;
      else layers.push({ amount, players: live.slice() });
    }
    if (cap === Infinity) break;
    floor = cap;
  }
  return layers;
}

/* A hand's best hands for its game, evaluated once and read twice — for the
   score (settle) and the description (describe.js): { hi, lo } evaluator
   results (evalHigh5 / evalLowA5 / evalLow27 / evalBadugi objects), or null.
   The same evaluations the replayer's potAwards scoreHand makes. */
export function evaluate(evalCfg, cards, board) {
  if (!evalCfg) return null;
  const all = cards.concat(board || []);
  const omaha = evalCfg.method === 'omaha';
  if (evalCfg.type === 'high') {
    const hi = omaha ? bestOmahaHigh(cards, board) : bestHighHand(all);
    return hi ? { hi, lo: null } : null;
  }
  if (evalCfg.type === 'hilo') {
    const hi = omaha ? bestOmahaHigh(cards, board) : bestHighHand(all);
    const lo = omaha ? bestOmahaLow(cards, board) : bestLowA5Hand(all, true);
    return hi ? { hi, lo: lo && lo.qualified ? lo : null } : null;
  }
  if (evalCfg.type === 'low') {
    const lo = evalCfg.lowType === 'a5' ? bestLowA5Hand(all, false) : bestLow27Hand(all);
    return { hi: null, lo: lo && Number.isFinite(lo.score) ? lo : null, fallbackHi: lo ? null : bestHighHand(all) };
  }
  if (evalCfg.type === 'badugi') {
    const bad = bestBadugiHand(cards);
    return bad && Number.isFinite(bad.score) ? { hi: null, lo: bad } : null;
  }
  return null;
}

/* The score hiLoWinnersAmong reads ({ hi: best-high score, lo: best-low
   score }), or null when the hand cannot be scored (the replayer's scoreHand). */
export function scoreOf(evs) {
  if (!evs || (!evs.hi && !evs.lo)) return null;
  return { hi: evs.hi ? evs.hi.score : null, lo: evs.lo ? evs.lo.score : null };
}
export function scoreHand(evalCfg, cards, board) {
  return scoreOf(evaluate(evalCfg, cards, board));
}

/* The flags the replayer reads off a stored winner (its flaggedWinners): the
   hi/lo booleans where written, else "Hi:"/"Lo:" in the label. */
export function flagWinners(winners) {
  return (winners || []).filter(w => w && Number.isInteger(w.playerIdx)).map(w => {
    if (typeof w.hi === 'boolean' || typeof w.lo === 'boolean') return { ...w, hi: !!w.hi, lo: !!w.lo };
    const label = w.label || '';
    if (/Hi:/.test(label) || /Lo:/.test(label)) return { ...w, hi: /Hi:/.test(label), lo: /Lo:/.test(label) };
    return { ...w, hi: false, lo: false };
  });
}

/* Settle the pot.
   in: { n, live, contrib (layered, after uncalled returns), dead (big-blind
         ante: main pot), allInEnd (Set of live seats with no chips left),
         scores ({seat: {hi, lo}} for every live seat, or null), winners (the
         stored result), order (odd-chip order: seats clockwise from the
         button), unit (hundredths per indivisible chip: 1 or 100) }
   out: { total, pots: [{ amount, players }] main first,
          lines: [{ p, amount, pot, half }] in collect-line order (the highest
          side pot first, the main pot last; the high half before the low;
          seats from the button), won: {seat: amount}, from, winnersDiffer } */
export function settlePot(inp) {
  const { n, live, contrib, dead, allInEnd, scores, order } = inp;
  const total = contrib.reduce((a, b) => a + b, 0) + (dead || 0);
  let layers;
  if (live.length <= 1) layers = [{ amount: total, players: live.slice() }];
  else {
    layers = buildLayers(contrib, live, allInEnd);
    if (!layers.length) layers = [{ amount: 0, players: live.slice() }];
    layers[0] = { ...layers[0], amount: layers[0].amount + (dead || 0) };
  }

  let shaped, from;
  const stored = flagWinners(inp.winners);
  if (live.length === 1) {
    from = 'fold';
    shaped = layers.map(l => ({ amount: l.amount, hiWinners: [live[0]], loWinners: [] }));
  } else if (scores) {
    from = 'cards';
    shaped = layers.map(l => ({ amount: l.amount, ...hiLoWinnersAmong(scores, l.players) }));
  } else {
    const storedLive = stored.filter(w => live.includes(w.playerIdx));
    if (!storedLive.length) throw new HandExportError('no-winner');
    from = 'stored';
    shaped = potLayerWinners(layers, storedLive).map((s, i) => (
      (!s.hiWinners.length && !s.loWinners.length) ? { ...s, hiWinners: layers[i].players.slice() } : s
    ));
  }

  // The odd chip is a whole tournament chip when every pot is whole chips, else a cent.
  const unit = inp.unit === 100 && layers.every(l => l.amount % 100 === 0) ? 100 : 1;
  const rank = (p) => { const i = order.indexOf(p); return i < 0 ? order.length + p : i; };
  const byOrder = (arr) => arr.slice().sort((a, b) => rank(a) - rank(b));
  const lines = [];
  const won = {};
  for (let k = layers.length - 1; k >= 0; k--) {
    const units = Math.round(layers[k].amount / unit);
    const hi = shaped[k].hiWinners || [], lo = shaped[k].loWinners || [];
    let parts;
    if (!hi.length && !lo.length) parts = [['all', units, layers[k].players]];
    else if (!lo.length) parts = [['all', units, hi]];
    else if (!hi.length) parts = [['all', units, lo]];
    else {
      const hiHalf = units - Math.floor(units / 2); // the odd chip to the high half
      parts = [['hi', hiHalf, hi], ['lo', units - hiHalf, lo]];
    }
    for (const [half, amt, players] of parts) {
      if (amt <= 0) continue;
      const { awards } = computePotAwards([{ amount: amt, hiWinners: players, loWinners: [] }], { order });
      for (const p of byOrder(players)) {
        const a = (awards[p] || 0) * unit;
        if (a <= 0) continue;
        lines.push({ p, amount: a, pot: k, half: half === 'all' ? null : half });
        won[p] = (won[p] || 0) + a;
      }
    }
  }
  const paid = lines.reduce((s, l) => s + l.amount, 0);
  if (paid !== total) throw new Error('hand-history settle: paid ' + paid + ' of a ' + total + ' pot');

  let winnersDiffer = false;
  if (from === 'cards' && stored.length) {
    const a = new Set(stored.map(w => w.playerIdx));
    const b = new Set(Object.keys(won).map(Number));
    winnersDiffer = a.size !== b.size || [...a].some(x => !b.has(x));
  }
  return { total, pots: layers, lines, won, from, winnersDiffer };
}
