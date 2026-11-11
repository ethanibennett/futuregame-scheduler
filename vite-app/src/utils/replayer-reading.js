/**
 * Which cards play (Replayer animations 16-18, 20-23, 2026-11-11): the evaluator in poker-engine.js scores a hand
 * and names it, but never says which five cards made it. The felt now shows that, so this searches the same way
 * the evaluator does and keeps the combination. Pure: cards are { rank, suit } as parseCardNotation gives them,
 * and every answer is in indices into the arrays passed in.
 */
import { evalHigh5, evalLowA5, evalLow27, evalBadugi, combinations, SHORT_DECK_RULES } from './poker-engine.js';

const RANK_VAL = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
const known = (c) => c && c.suit && c.suit !== 'x';

/** Every pick of k from the indices 0..n-1. */
function pickIdx(n, k) {
  return combinations([...Array(n).keys()], k);
}

/**
 * The best five for one half of a game, as indices into `hole` and `board`.
 * kind: 'high' | 'low8' (A-5, eight or better) | 'lowA5' (A-5, any) | 'low27' | 'badugi'.
 * Omaha (cfg.method 'omaha') plays exactly two from the hole and three from the board.
 * @returns {{ ev: object, hole: number[], board: number[] } | null}
 */
export function bestFive(cfg, hole, board, kind = 'high') {
  const H = (hole || []).map((c, i) => ({ c, i })).filter((x) => known(x.c));
  const B = (board || []).map((c, i) => ({ c, i })).filter((x) => known(x.c));
  if (kind === 'badugi') {
    if (!H.length) return null;
    let best = null;
    for (let n = Math.min(4, H.length); n >= 1 && !best; n--) {
      for (const pick of pickIdx(H.length, n)) {
        const cs = pick.map((k) => H[k].c);
        if (new Set(cs.map((c) => c.suit)).size !== n || new Set(cs.map((c) => c.rank)).size !== n) continue;
        const ev = evalBadugi(cs);
        if (!best || ev.score < best.ev.score) best = { ev, hole: pick.map((k) => H[k].i), board: [] };
      }
    }
    return best;
  }
  const rules = cfg && (cfg.rules || (cfg.method === 'short' ? SHORT_DECK_RULES : undefined));
  const score = (cs) => {
    if (kind === 'high') { const ev = evalHigh5(cs, rules); return { ev, s: ev.score }; }
    if (kind === 'low27') { const ev = evalLow27(cs); return { ev, s: -ev.score }; }
    const ev = evalLowA5(cs, kind === 'low8');
    if (!ev.qualified) return null;
    return { ev, s: -ev.score };
  };
  let best = null;
  const consider = (hp, bp) => {
    const cs = hp.map((k) => H[k].c).concat(bp.map((k) => B[k].c));
    const r = score(cs);
    if (!r) return;
    if (!best || r.s > best.s) best = { s: r.s, ev: r.ev, hole: hp.map((k) => H[k].i), board: bp.map((k) => B[k].i) };
  };
  if (cfg && cfg.method === 'omaha') {
    if (H.length < 2 || B.length < 3) return null;
    for (const hp of pickIdx(H.length, 2)) for (const bp of pickIdx(B.length, 3)) consider(hp, bp);
  } else {
    const all = H.length + B.length;
    if (all < 5) return null;
    for (const pick of pickIdx(all, 5)) {
      consider(pick.filter((k) => k < H.length), pick.filter((k) => k >= H.length).map((k) => k - H.length));
    }
  }
  return best ? { ev: best.ev, hole: best.hole, board: best.board } : null;
}

/** The kinds a game plays for: one ('high', 'low27', ...) or a high and an 8-or-better low. */
export function halvesOf(cfg) {
  if (!cfg) return [];
  if (cfg.type === 'high') return ['high'];
  if (cfg.type === 'hilo') return ['high', cfg.anyLow ? 'lowA5' : 'low8'];
  if (cfg.type === 'low') return [cfg.lowType === 'a5' ? 'lowA5' : 'low27'];
  if (cfg.type === 'badugi') return ['badugi'];
  return [];
}

/**
 * The cards of a five that MAKE the hand, as positions in the five (0-4 in hole-then-board order): every card of a
 * straight, flush or full house; the grouped ranks of a pair, two pair, trips or quads; none of a high card.
 */
export function madeOf(fiveCards) {
  if (!fiveCards || fiveCards.length !== 5) return [];
  const counts = {};
  fiveCards.forEach((c) => { counts[c.rank] = (counts[c.rank] || 0) + 1; });
  const vals = [...new Set(fiveCards.map((c) => RANK_VAL[c.rank]))].sort((a, b) => b - a);
  const flush = fiveCards.every((c) => c.suit === fiveCards[0].suit);
  const straight = vals.length === 5 && (vals[0] - vals[4] === 4 || (vals[0] === 14 && vals[1] === 5) || (vals[0] === 14 && vals[1] === 9 && vals[4] === 6));
  // A straight, a flush and a full house play all five; otherwise the grouped ranks make the hand.
  const groups = Object.values(counts).filter((n) => n >= 2);
  if (flush || straight || (groups.length === 2 && groups.includes(3))) return fiveCards.map((_, i) => i);
  return fiveCards.map((c, i) => (counts[c.rank] >= 2 ? i : -1)).filter((i) => i >= 0);
}

/**
 * 17 and 18, the hero's hand across one street of a flop game: the card just dealt lifts the hand into a new
 * category (the five that now play: `made`), or the hole cards that made the hand no longer do (`counterfeit`).
 * prevBoard is the board before the card, board after it. High games only (the low halves are read at the result).
 * @returns {{ made: { hole: number[], board: number[] } | null, counterfeit: number[] }}
 */
export function streetChange(cfg, hole, prevBoard, board) {
  const out = { made: null, counterfeit: [] };
  if (!cfg || cfg.type !== 'high' || !board || board.length < 3) return out;
  const now = bestFive(cfg, hole, board, 'high');
  if (!now) return out;
  const before = prevBoard && prevBoard.length >= 3 ? bestFive(cfg, hole, prevBoard, 'high') : null;
  const newIdx = board.length - 1;
  if (before && now.ev.cat > before.ev.cat && now.board.includes(newIdx) && now.hole.length) {
    out.made = { hole: now.hole.slice(), board: now.board.slice() };
  }
  if (before && cfg.method !== 'omaha') {
    const fiveOf = (r, b) => r.hole.map((i) => hole[i]).concat(r.board.map((i) => b[i]));
    const madeBefore = madeOf(fiveOf(before, prevBoard)).filter((k) => k < before.hole.length).map((k) => before.hole[k]);
    const madeNow = new Set(madeOf(fiveOf(now, board)).filter((k) => k < now.hole.length).map((k) => now.hole[k]));
    // Every hole card that made the hand before and makes nothing now (a kicker is not making the hand).
    if (madeBefore.length && madeBefore.every((i) => !madeNow.has(i))) out.counterfeit = madeBefore;
  }
  return out;
}

/** 18 standing: the hole cards counterfeited at some street up to the board's length, still not making the hand. */
export function counterfeitedNow(cfg, hole, fullBoard, upTo) {
  if (!cfg || cfg.type !== 'high' || cfg.method === 'omaha') return [];
  let dead = [];
  for (let n = 4; n <= Math.min(upTo, (fullBoard || []).length); n++) {
    const ch = streetChange(cfg, hole, fullBoard.slice(0, n - 1), fullBoard.slice(0, n));
    if (ch.counterfeit.length) dead = ch.counterfeit;
    else if (ch.made) dead = [];
  }
  if (!dead.length) return [];
  // Still dead at the board as it stands.
  const now = bestFive(cfg, hole, fullBoard.slice(0, upTo), 'high');
  if (!now) return [];
  const five = now.hole.map((i) => hole[i]).concat(now.board.map((i) => fullBoard[i]));
  const made = new Set(madeOf(five).filter((k) => k < now.hole.length).map((k) => now.hole[k]));
  return dead.filter((i) => !made.has(i));
}

/**
 * 16: the tabled hand in front on this board (high games), or -1 for a tie or nothing to compare.
 * hands: [{ seat, cards }]; board: the cards dealt so far.
 */
export function leaderOf(cfg, hands, board) {
  if (!cfg || cfg.type !== 'high' || hands.length < 2) return -1;
  let best = null, tie = false;
  for (const h of hands) {
    const known5 = h.cards.filter(known);
    let s = null;
    if (cfg.method === 'omaha') { const r = bestFive(cfg, h.cards, board, 'high'); s = r ? r.ev.score : null; }
    else if (known5.length + (board || []).filter(known).length >= 5) { const r = bestFive(cfg, h.cards, board, 'high'); s = r ? r.ev.score : null; }
    else s = preFlopScore(known5);
    if (s == null) return -1;
    if (!best || s > best.s) { best = { s, seat: h.seat }; tie = false; } else if (s === best.s) tie = true;
  }
  return best && !tie ? best.seat : -1;
}

/* Before five cards are out: pairs first, then the high cards (what a broadcast's leader line uses pre-flop). */
function preFlopScore(cards) {
  const vals = cards.map((c) => RANK_VAL[c.rank] || 0).sort((a, b) => b - a);
  const pair = vals.length >= 2 && new Set(vals).size < vals.length ? 1 : 0;
  return vals.reduce((s, v) => s * 15 + v, pair);
}

/**
 * 23: where two lows part, from the top: the rank each hand plays there, or null when no rank decides (a paired,
 * straight or flushed hand against a clean one). Each is { ev, cards } with `cards` the five that play.
 */
export function lowDecider(kind, a, b) {
  if (!a || !b) return null;
  const ranks = (five) => five.map((c) => (kind === 'low27' ? RANK_VAL[c.rank] : (c.rank === 'A' ? 1 : RANK_VAL[c.rank]))).sort((x, y) => y - x);
  const clean = (r, ev) => new Set(r).size === 5 && !(kind === 'low27' && ev.score >= 1e9) && !ev.paired;
  const ra = ranks(a.cards), rb = ranks(b.cards);
  if (!clean(ra, a.ev) || !clean(rb, b.ev)) return null;
  for (let i = 0; i < 5; i++) if (ra[i] !== rb[i]) return { a: ra[i], b: rb[i] };
  return null;
}

/** The index (in `cards`) of the card of rank value v as a low counts it, among the indices given. */
export function indexOfLowRank(kind, cards, idxs, v) {
  for (const i of idxs) {
    const c = cards[i];
    const rv = kind === 'low27' ? RANK_VAL[c.rank] : (c.rank === 'A' ? 1 : RANK_VAL[c.rank]);
    if (rv === v) return i;
  }
  return -1;
}
