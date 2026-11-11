/**
 * Odds for any spot in a board or stud game (Features 35, 2026-11-11), scored by the replayer's own showdown
 * rules (poker-engine.js evaluateShowdown), so stud 8, Big O and PLO6 8/b come out as the app plays them.
 * Every run-out when there are few, a sample otherwise (with its margin). Draw games are left out: a draw
 * needs a plan per player.
 *
 * And the deal calculator's arithmetic (Features 34): Malmuth-Harville ICM and the chip chop.
 */
import { evaluateShowdown, parseCardNotation } from './poker-engine.js';

export const ODDS_GAMES = [
  ['NLH', 'Hold’em', 2, 'board'], ['Short Deck', 'Short Deck', 2, 'board'],
  ['PLO', 'PLO', 4, 'board'], ['PLO8', 'PLO 8/b', 4, 'board'], ['PLO5', 'PLO5', 5, 'board'], ['PLO6', 'PLO6', 6, 'board'],
  ['PLO6 8/b', 'PLO6 8/b', 6, 'board'], ['NL Big O', 'Big O', 5, 'board'], ['Courchevel', 'Courchevel', 5, 'board'],
  ['Stud Hi', 'Stud', 7, 'stud'], ['Stud 8', 'Stud 8', 7, 'stud'], ['Razz', 'Razz', 7, 'stud'],
];

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const key = (c) => c.rank + c.suit;

export function deckFor(game) {
  const short = game === 'Short Deck';
  const out = [];
  for (const r of RANKS) { if (short && '2345'.includes(r)) continue; for (const s of SUITS) out.push({ rank: r, suit: s }); }
  return out;
}

const parse = (s) => parseCardNotation(String(s || '').replace(/\s+/g, '')).filter((c) => c.suit !== 'x');

/** Shares of the pot from one showdown's winners: hi/lo halves where flagged, else equal. */
function shares(winners, n) {
  const out = new Array(n).fill(0);
  if (!winners.length) return out;
  const flagged = winners.some((w) => w.lo === true) || winners.some((w) => w.hi === true && winners.some((x) => x.lo === true));
  if (flagged) {
    const hi = winners.filter((w) => w.hi), lo = winners.filter((w) => w.lo);
    if (lo.length && hi.length) {
      for (const w of hi) out[w.playerIdx] += 0.5 / hi.length;
      for (const w of lo) out[w.playerIdx] += 0.5 / lo.length;
      return out;
    }
    const only = lo.length ? lo : hi;
    for (const w of only) out[w.playerIdx] += 1 / only.length;
    return out;
  }
  for (const w of winners) out[w.playerIdx] += 1 / winners.length;
  return out;
}

function choose(n, k) { let r = 1; for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i; return Math.round(r); }

/**
 * { players: [{ equity, scoop }], runs, exact, margin, noLow } or { error }.
 * hands: ['AsKd', ...]; board: 'As5d9h' (board games); stud hands carry every card the player holds.
 */
export function computeOdds(game, hands, board, { samples = 20000, rand = Math.random } = {}) {
  const meta = ODDS_GAMES.find((g) => g[0] === game);
  if (!meta) return { error: 'That game is not in the odds tool' };
  const [, , holeN, kind] = meta;
  const ps = hands.map(parse);
  if (ps.length < 2 || ps.some((p) => !p.length)) return { error: 'Two or more hands, each with its cards' };
  const b = kind === 'board' ? parse(board) : [];
  if (kind === 'board') {
    if (ps.some((p) => p.length !== holeN)) return { error: `Each hand has ${holeN} cards in ${meta[1]}` };
    if (b.length > 5 || [1, 2].includes(b.length)) return { error: 'The board is 0, 3, 4 or 5 cards' };
  } else if (ps.some((p) => p.length > 7)) return { error: 'A stud hand has at most 7 cards' };
  const used = new Set();
  for (const c of [...ps.flat(), ...b]) { const k = key(c); if (used.has(k)) return { error: `${k} is written twice` }; used.add(k); }
  const deck = deckFor(game).filter((c) => !used.has(key(c)));
  if (deck.length + used.size < (game === 'Short Deck' ? 36 : 52)) return { error: 'A card is not in this game’s deck' };
  const n = ps.length;
  const needBoard = kind === 'board' ? 5 - b.length : 0;
  const needEach = kind === 'stud' ? ps.map((p) => 7 - p.length) : ps.map(() => 0);
  const need = needBoard + needEach.reduce((a, x) => a + x, 0);
  if (need > deck.length) return { error: 'Not enough cards left in the deck' };
  const eq = new Array(n).fill(0), scoop = new Array(n).fill(0);
  let runs = 0, noLow = 0;
  const run = (drawn) => {
    let i = 0;
    const board5 = kind === 'board' ? [...b, ...drawn.slice(0, needBoard)] : [];
    i = needBoard;
    const playerHands = ps.map((p, idx) => { const extra = drawn.slice(i, i + needEach[idx]); i += needEach[idx]; return { idx, cards: [...p, ...extra] }; });
    const winners = evaluateShowdown(game, playerHands, board5, {});
    const sh = shares(winners, n);
    for (let k = 0; k < n; k += 1) { eq[k] += sh[k]; if (sh[k] > 0.999) scoop[k] += 1; }
    if (winners.length && !winners.some((w) => w.lo) && winners.some((w) => w.hi === true)) noLow += 1;
    runs += 1;
  };
  const total = need === 0 ? 1 : choose(deck.length, need) * (kind === 'stud' ? 1 : 1);
  const exact = kind === 'board' && need <= 2 && total <= 60000;
  if (need === 0) run([]);
  else if (exact) {
    const idx = Array.from({ length: need }, (_, k) => k);
    for (;;) {
      run(idx.map((k) => deck[k]));
      let t = need - 1;
      while (t >= 0 && idx[t] === deck.length - need + t) t -= 1;
      if (t < 0) break;
      idx[t] += 1;
      for (let u = t + 1; u < need; u += 1) idx[u] = idx[u - 1] + 1;
    }
  } else {
    const d = deck.slice();
    for (let s = 0; s < samples; s += 1) {
      for (let k = 0; k < need; k += 1) { const j = k + Math.floor(rand() * (d.length - k)); const tmp = d[k]; d[k] = d[j]; d[j] = tmp; }
      run(d.slice(0, need));
    }
  }
  const players = eq.map((e, k) => ({ equity: e / runs, scoop: scoop[k] / runs }));
  // A sample's 95% margin on the largest share, in points.
  const p = Math.max(...players.map((x) => x.equity));
  return { players, runs, exact: exact || need === 0, margin: exact || need === 0 ? 0 : 1.96 * Math.sqrt((p * (1 - p)) / runs), noLow: noLow / runs };
}

/** Malmuth-Harville ICM: each stack's share of the prizes. prizes: 1st first. */
export function icm(stacks, prizes) {
  const n = stacks.length;
  const memo = new Map();
  const solve = (mask) => {
    if (memo.has(mask)) return memo.get(mask);
    const place = n - popcount(mask);
    const out = new Array(n).fill(0);
    if (place >= prizes.length || mask === 0) { memo.set(mask, out); return out; }
    let total = 0;
    for (let i = 0; i < n; i += 1) if (mask & (1 << i)) total += stacks[i];
    if (total <= 0) { memo.set(mask, out); return out; }
    for (let i = 0; i < n; i += 1) {
      if (!(mask & (1 << i))) continue;
      const p = stacks[i] / total;
      if (p === 0) continue;
      out[i] += p * prizes[place];
      const rest = solve(mask & ~(1 << i));
      for (let k = 0; k < n; k += 1) out[k] += p * rest[k];
    }
    memo.set(mask, out);
    return out;
  };
  return solve((1 << n) - 1);
}

function popcount(m) { let c = 0; while (m) { c += m & 1; m >>>= 1; } return c; }

/** The chip chop: everyone is guaranteed the smallest prize left, the rest goes by chips. */
export function chipChop(stacks, prizes) {
  const n = stacks.length;
  const pz = prizes.slice(0, n);
  const min = Math.min(...pz);
  const pool = pz.reduce((a, x) => a + x, 0);
  const chips = stacks.reduce((a, x) => a + x, 0) || 1;
  return stacks.map((s) => min + (pool - n * min) * (s / chips));
}
