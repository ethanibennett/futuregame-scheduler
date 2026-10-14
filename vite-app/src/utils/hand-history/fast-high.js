// ── Hand history: the best high hand, quickly ───────────────────────────────
// The SAME score as poker-engine.js evalHigh5 / bestHighHand / bestOmahaHigh
// (category * 15^5 + five kickers in base 15), computed without the
// allocations those make per five-card combination — an Omaha showdown scores
// 60 to 150 combinations a player, and a 1,000-hand file has thousands of them.
// The scores are what settle.js compares and describe.js decodes, so they must
// be identical: test/hh-io.test.mjs holds this file to poker-engine.js on
// thousands of random hands. Change evalHigh5, change this.

const RV = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
const P1 = 15, P2 = 225, P3 = 3375, P4 = 50625, P5 = 759375;

/* Five cards' score, from five rank values and whether they are one suit. */
function score5(a, b, c, d, e, flush) {
  // Sort descending (five values: a small sorting network).
  let t;
  if (a < b) { t = a; a = b; b = t; }
  if (d < e) { t = d; d = e; e = t; }
  if (c < e) { t = c; c = e; e = t; }
  if (c < d) { t = c; c = d; d = t; }
  if (b < e) { t = b; b = e; e = t; }
  if (a < d) { t = a; a = d; d = t; }
  if (a < c) { t = a; a = c; c = t; }
  if (b < d) { t = b; b = d; d = t; }
  if (b < c) { t = b; b = c; c = t; }
  const distinct = a !== b && b !== c && c !== d && d !== e;
  let sHigh = 0;
  if (distinct && a - e === 4) sHigh = a;
  else if (a === 14 && b === 5 && c === 4 && d === 3 && e === 2) sHigh = 5;
  if (sHigh && flush) return 9 * P5 + sHigh * P4;
  if (distinct) {
    if (flush) return 6 * P5 + a * P4 + b * P3 + c * P2 + d * P1 + e;
    if (sHigh) return 5 * P5 + sHigh * P4;
    return 1 * P5 + a * P4 + b * P3 + c * P2 + d * P1 + e;
  }
  // Groups, from the sorted run (counts then ranks, both descending).
  const v = [a, b, c, d, e];
  const g = [];
  for (let i = 0; i < 5;) { let j = i; while (j < 5 && v[j] === v[i]) j++; g.push([j - i, v[i]]); i = j; }
  g.sort((x, y) => y[0] - x[0] || y[1] - x[1]);
  if (g[0][0] === 4) return 8 * P5 + g[0][1] * P4 + g[1][1] * P3;
  if (g[0][0] === 3 && g[1][0] === 2) return 7 * P5 + g[0][1] * P4 + g[1][1] * P3;
  if (flush) return 6 * P5 + a * P4 + b * P3 + c * P2 + d * P1 + e;
  if (g[0][0] === 3) return 4 * P5 + g[0][1] * P4 + g[1][1] * P3 + g[2][1] * P2;
  if (g[0][0] === 2 && g[1][0] === 2) return 3 * P5 + g[0][1] * P4 + g[1][1] * P3 + g[2][1] * P2;
  return 2 * P5 + g[0][1] * P4 + g[1][1] * P3 + g[2][1] * P2 + g[3][1] * P1;
}

const prep = (cards) => cards.map(c => ({ r: RV[c.rank] || 0, s: c.suit }));

/* bestHighHand: the best five of five to seven cards (null under five). */
export function fastBestHigh(cards) {
  if (!cards || cards.length < 5) return null;
  const x = prep(cards);
  const n = x.length;
  let best = -1;
  for (let i = 0; i < n - 4; i++) for (let j = i + 1; j < n - 3; j++) for (let k = j + 1; k < n - 2; k++)
    for (let l = k + 1; l < n - 1; l++) for (let m = l + 1; m < n; m++) {
      const s = x[i].s;
      const flush = x[j].s === s && x[k].s === s && x[l].s === s && x[m].s === s;
      const sc = score5(x[i].r, x[j].r, x[k].r, x[l].r, x[m].r, flush);
      if (sc > best) best = sc;
    }
  return { score: best, cat: Math.floor(best / P5) };
}

/* bestOmahaHigh: exactly two hole cards and three board cards (null without
   two and three). */
export function fastBestOmahaHigh(hole, board) {
  if (!hole || !board || hole.length < 2 || board.length < 3) return null;
  const h = prep(hole), b = prep(board);
  let best = -1;
  for (let i = 0; i < h.length - 1; i++) for (let j = i + 1; j < h.length; j++)
    for (let k = 0; k < b.length - 2; k++) for (let l = k + 1; l < b.length - 1; l++) for (let m = l + 1; m < b.length; m++) {
      const s = h[i].s;
      const flush = h[j].s === s && b[k].s === s && b[l].s === s && b[m].s === s;
      const sc = score5(h[i].r, h[j].r, b[k].r, b[l].r, b[m].r, flush);
      if (sc > best) best = sc;
    }
  return { score: best, cat: Math.floor(best / P5) };
}
