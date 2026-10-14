// ── Hand history: PokerStars hand descriptions ──────────────────────────────
// "(a pair of Aces)", "(HI: a straight, Ace to Five; LO: 5,4,3,2,A)",
// "(Lo: 9,8,7,6,3)", "(Badugi: 8,4,3,A)", "(3-card: T,7,2)". Built from the
// evaluator's category and ranks, which the score encodes (base 15, category
// first — see evalHigh5 / evalLowA5 / evalLow27 / evalBadugi in poker-engine.js),
// never from its .name, which is worded differently ("Pair of Kings").
// Every wording here was seen in genuine Stars hands (docs/hand-history-io.md);
// kicker suffixes ("- Ace kicker"), which Stars adds only to break a tie, are not
// written.

import { evaluate } from './settle.js';

const P = 15;
const WORD = { 14: 'Ace', 13: 'King', 12: 'Queen', 11: 'Jack', 10: 'Ten', 9: 'Nine', 8: 'Eight', 7: 'Seven', 6: 'Six', 5: 'Five', 4: 'Four', 3: 'Three', 2: 'Deuce', 1: 'Ace' };
const PLURAL = { 14: 'Aces', 13: 'Kings', 12: 'Queens', 11: 'Jacks', 10: 'Tens', 9: 'Nines', 8: 'Eights', 7: 'Sevens', 6: 'Sixes', 5: 'Fives', 4: 'Fours', 3: 'Threes', 2: 'Deuces' };
const SHORT = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T', 9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2', 1: 'A' };

function digits(score, count) {
  const out = [];
  let s = Math.round(score);
  for (let i = 0; i < count; i++) { out.unshift(s % P); s = Math.floor(s / P); }
  return { digits: out, rest: s };
}

/* An evalHigh5 result -> "a full house, Kings full of Deuces". */
export function describeHigh(ev) {
  if (!ev) return null;
  const { digits: k, rest: cat } = digits(ev.score, 5);
  switch (cat) {
    case 9: return k[0] === 14 ? 'a Royal Flush' : 'a straight flush, ' + WORD[k[0] === 5 ? 1 : k[0] - 4] + ' to ' + WORD[k[0]];
    case 8: return 'four of a kind, ' + PLURAL[k[0]];
    case 7: return 'a full house, ' + PLURAL[k[0]] + ' full of ' + PLURAL[k[1]];
    case 6: return 'a flush, ' + WORD[k[0]] + ' high';
    case 5: return 'a straight, ' + (k[0] === 5 ? 'Ace' : WORD[k[0] - 4]) + ' to ' + WORD[k[0]];
    case 4: return 'three of a kind, ' + PLURAL[k[0]];
    case 3: return 'two pair, ' + PLURAL[k[0]] + ' and ' + PLURAL[k[1]];
    case 2: return 'a pair of ' + PLURAL[k[0]];
    default: return 'high card ' + WORD[k[0]];
  }
}

/* A low's ranks, highest first: "8,6,4,3,2", "T,5,3,2,A". */
function lowRanks(score, count) {
  return digits(score, count).digits.map(v => SHORT[v]).join(',');
}

/* The description of a player's hand for the shows line and the summary, from
   settle.js evaluate()'s result. Returns { shows, summary, unverified } or null. */
export function describeEvals(evalCfg, evs) {
  if (!evalCfg || !evs) return null;
  if (evalCfg.type === 'high') {
    const d = describeHigh(evs.hi);
    return d ? { shows: d, summary: d } : null;
  }
  if (evalCfg.type === 'hilo') {
    const hi = describeHigh(evs.hi);
    if (!hi) return null;
    const d = 'HI: ' + hi + (evs.lo ? '; LO: ' + lowRanks(evs.lo.score, 5) : '');
    return { shows: d, summary: d };
  }
  if (evalCfg.type === 'low') {
    if (evalCfg.lowType === 'a5') {
      if (evs.lo) { const d = 'Lo: ' + lowRanks(evs.lo.score, 5); return { shows: d, summary: d }; }
      // No five unpaired cards in seven: not a hand Stars was seen describing.
      const hi = describeHigh(evs.fallbackHi);
      return hi ? { shows: 'Lo: ' + hi, summary: 'Lo: ' + hi, unverified: true } : null;
    }
    const lo = evs.lo;
    if (!lo) return null;
    const d = lo.score >= 1e9 ? 'Lo: ' + describeHigh({ score: lo.score - 1e9 }) : 'Lo: ' + lowRanks(lo.score, 5);
    return { shows: d, summary: d };
  }
  if (evalCfg.type === 'badugi') {
    const bad = evs.lo;
    if (!bad || !bad.numCards) return null;
    const k = bad.numCards;
    const ranks = lowRanks(bad.score - (5 - k) * 1e8, k);
    const d = k === 4 ? 'Badugi: ' + ranks : k + '-card: ' + ranks;
    return { shows: d, summary: 'a ' + d };
  }
  return null;
}

export function describeHand(evalCfg, cards, board) {
  return describeEvals(evalCfg, evaluate(evalCfg, cards, board));
}
