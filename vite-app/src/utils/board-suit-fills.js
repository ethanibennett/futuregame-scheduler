/* A board card with its rank and no suit ("Jx": quick add writes one when no suit was said). The replayer used to
   leave such a card out of every reading, so JJ on a J river read "Pair of Js", and marked a winner from an
   evaluator that could not read it while the pot went unpaid (owner's $1/$1 hand, 2026-11-16).

   boardSuitFills gives every board the hand could have had: each suitless card takes each suit no known card holds
   (two suitless cards of one rank never take the same one). null when the board has no suitless card, or when no
   suit is left for one. The replayer reads the hand on each: what holds on all of them is decided, what differs
   is not. */

const SUITS = ['c', 'd', 'h', 's'];
const CAP = 64;

export function boardSuitFills(board, known = []) {
  if (!Array.isArray(board) || !board.some((c) => c && c.suit === 'x')) return null;
  const taken = new Set(known.concat(board).filter((c) => c && c.suit && c.suit !== 'x').map((c) => c.rank + c.suit));
  let out = [[]];
  for (const c of board) {
    const next = [];
    for (const partial of out) {
      if (c.suit !== 'x') { next.push(partial.concat(c)); continue; }
      for (const s of SUITS) {
        const key = c.rank + s;
        if (taken.has(key) || partial.some((p) => p.rank + p.suit === key)) continue;
        next.push(partial.concat({ ...c, suit: s }));
      }
    }
    out = next.slice(0, CAP);
  }
  return out.length ? out : null;
}

/* One seat's reading across those boards: the name they all give, else each name, the commonest first, joined by
   "or" ("Pair of Ks or Flush, A-high"). null when a reading is two lines (hi-lo), which an "or" would garble: the
   caller falls back to the reading without the card. */
export function readingAcross(names) {
  const counts = new Map();
  for (const n of names) if (n) counts.set(n, (counts.get(n) || 0) + 1);
  const distinct = [...counts.keys()];
  if (distinct.length <= 1) return distinct[0] || null;
  if (distinct.some((n) => String(n).includes('\n'))) return null;
  return distinct.sort((a, b) => counts.get(b) - counts.get(a)).join(' or ');
}

/* The result line's words for an undecided showdown: which cards' suits decide it. */
export function undecidedLine(board) {
  const ranks = (board || []).filter((c) => c && c.suit === 'x').map((c) => (c.rank === 'T' ? '10' : c.rank));
  if (!ranks.length) return null;
  const owned = ranks.map((r) => r + "'s");
  if (owned.length === 1) return `The ${owned[0]} suit decides this pot: Edit to add it`;
  return `The ${owned.slice(0, -1).join(', ')} and ${owned[owned.length - 1]} suits decide this pot: Edit to add them`;
}
