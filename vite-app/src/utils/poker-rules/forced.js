// The forced bets and who acts: straddles, the stud bring-in, the best board, the open pair on 4th street, and
// the seat order per street. One copy, read by the shared rules (betting.js), quick add's Table and the export
// (hand-history/prepare.js). Moved here from utils/quick-add/betting.js on the play-money branch (decision 11);
// quick add re-exports them, so every import of them there still works.
import { cardsOf } from '../quick-add/cards.js';

/* Cent stakes add up in binary floating point to 0.44999999999999996: "called 0.3,
   but the price was 0.3" (2026-10-14, a 5NL hand history). Every running total is
   cleaned of that noise; chip amounts never need more than six decimals. */
export const clean = (x) => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : x);

const STRADDLE_TYPES = ['utg', 'button', 'rock', 'mississippi'];

function straddleSeatFor(type, n, stored) {
  if (n < 4) return -1;
  if (type === 'utg') return 0;
  if (type === 'button') return n - 3;
  const s = Number(stored);
  return Number.isInteger(s) && s >= 0 && s <= n - 3 ? s : 0;
}

// Mirrors getStraddles.
export function straddles(players, blinds) {
  const b = blinds || {};
  const n = (players || []).length;
  const bb = b.bb || 0;
  if (!b.straddle || !bb || n < 4) return [];
  const seats = b.straddleSeats || {};
  const taken = new Set();
  const picked = [];
  STRADDLE_TYPES.forEach(type => {
    if (!b['straddle_' + type]) return;
    const seat = straddleSeatFor(type, n, seats[type]);
    if (seat < 0 || taken.has(seat)) return;
    taken.add(seat);
    picked.push({ type, seat });
  });
  picked.sort((a, c) => a.seat - c.seat);
  // The first straddle is blinds.straddleAmount ("2/2/5"), else twice the big blind; each after it doubles (the replayer's getStraddles).
  const sa = Number(b.straddleAmount);
  const first = sa > bb ? sa : bb * 2;
  return picked.map((st, i) => ({ ...st, amount: first * Math.pow(2, i) }));
}

export function lastStraddleSeat(list) {
  return list.length ? list[list.length - 1].seat : -1;
}

// ── Stud helpers (mirror the replayer's) ─────────────────────────────────

/* A player's cards on one stud street, as the replayer stores them: the hero's
   in cards.hero, an opponent's in their slot. */
export function studStreetCards(hand, pi, si) {
  const heroIdx = hand.heroIdx != null ? hand.heroIdx : 0;
  const st = hand.streets[si];
  if (!st || !st.cards) return '';
  if (pi === heroIdx) return st.cards.hero || '';
  const slot = pi < heroIdx ? pi : pi - 1;
  return (st.cards.opponents || [])[slot] || '';
}

/* The door card: the hero's third card on 3rd street; an opponent's first
   stored card. (When a showdown has prepended an opponent's hidden cards to
   3rd street, the door is the LAST card there — the replayer reads the first
   and gets it wrong; with more than one card stored we take the last.) */
export function doorCard(hand, pi) {
  const heroIdx = hand.heroIdx != null ? hand.heroIdx : 0;
  const cards = cardsOf(studStreetCards(hand, pi, 0));
  if (pi === heroIdx) return cards.length >= 3 ? cards[2] : null;
  if (!cards.length) return null;
  return cards[cards.length - 1];
}

/* Mirrors ACE_HIGH_LOW_STUD in HandReplayerView.jsx: in the 2-7 razz games the ace is the worst
   card, so it brings it in and counts high on a board. */
const ACE_HIGH_LOW_STUD = /2-7 Razz$|^Razzdeucy$/;

// Mirrors findStudBringIn (lowest door brings in; highest in razz).
export function findStudBringIn(hand, isRazz) {
  const rankBadness = isRazz
    ? (ACE_HIGH_LOW_STUD.test(hand.gameType || '')
      ? { '2':0,'3':1,'4':2,'5':3,'6':4,'7':5,'8':6,'9':7,'T':8,'J':9,'Q':10,'K':11,'A':12 }
      : { 'A':0,'2':1,'3':2,'4':3,'5':4,'6':5,'7':6,'8':7,'9':8,'T':9,'J':10,'Q':11,'K':12 })
    : { 'A':0,'K':1,'Q':2,'J':3,'T':4,'9':5,'8':6,'7':7,'6':8,'5':9,'4':10,'3':11,'2':12 };
  const suitBadness = isRazz ? { 'c':0,'d':1,'h':2,'s':3 } : { 's':0,'h':1,'d':2,'c':3 };
  let worstIdx = -1, worstRank = -1, worstSuit = -1;
  for (let pi = 0; pi < hand.players.length; pi++) {
    const door = doorCard(hand, pi);
    if (!door || door.suit === 'x') continue;
    const rv = rankBadness[door.rank] || 0;
    const sv = suitBadness[door.suit] || 0;
    if (worstIdx === -1 || rv > worstRank || (rv === worstRank && sv > worstSuit)) {
      worstIdx = pi; worstRank = rv; worstSuit = sv;
    }
  }
  return worstIdx;
}

// Mirrors scoreStudBoard (the ace low in the A-5 razz games).
function scoreStudBoard(cards, aceLow = false) {
  const rankValues = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':aceLow ? 1 : 14 };
  if (!cards.length) return 0;
  const counts = {};
  cards.forEach(c => { const r = rankValues[c.rank] || 0; counts[r] = (counts[r] || 0) + 1; });
  const groups = Object.keys(counts).map(Number).map(r => [r, counts[r]]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map(g => g[1]);
  const cat = shape[0] === 4 ? 6 : shape[0] === 3 ? (shape[1] === 2 ? 5 : 4) : shape[0] === 2 ? (shape[1] === 2 ? 3 : 2) : 1;
  const P = 15;
  let score = cat * Math.pow(P, 5);
  groups.forEach((g, i) => { score += g[0] * Math.pow(P, 4 - i); });
  return score;
}

/* A player's visible up cards through street si (mirrors the visible-card
   collection in findStudBestBoard). */
export function studUpCards(hand, pi, si) {
  const heroIdx = hand.heroIdx != null ? hand.heroIdx : 0;
  const visible = [];
  const maxVisible = Math.min(si, 3);
  for (let s = 0; s <= maxVisible; s++) {
    const cards = cardsOf(studStreetCards(hand, pi, s));
    if (s === 0) {
      const door = doorCard(hand, pi);
      if (door && door.suit !== 'x') visible.push(door);
      continue;
    }
    if (pi === heroIdx) cards.forEach(c => { if (c.suit !== 'x') visible.push(c); });
    else cards.forEach(c => { if (c.suit !== 'x') visible.push(c); });
  }
  return visible;
}

// Mirrors findStudBestBoard.
export function findStudBestBoard(hand, si, foldedSet, isLowGame) {
  let bestIdx = -1, bestScore = isLowGame ? Infinity : -Infinity;
  for (let pi = 0; pi < hand.players.length; pi++) {
    if (foldedSet.has(pi)) continue;
    const score = scoreStudBoard(studUpCards(hand, pi, si), isLowGame && !ACE_HIGH_LOW_STUD.test(hand.gameType || ''));
    if (isLowGame ? score < bestScore : score > bestScore) { bestIdx = pi; bestScore = score; }
  }
  return bestIdx;
}

// Mirrors studHasOpenPairOn4th (the 4th-street big-bet option).
export function studHasOpenPairOn4th(hand) {
  if (!hand.streets || !hand.streets[0] || !hand.streets[1]) return false;
  for (let pi = 0; pi < hand.players.length; pi++) {
    const door = doorCard(hand, pi);
    const fourth = cardsOf(studStreetCards(hand, pi, 1))[0];
    if (door && fourth && door.suit !== 'x' && fourth.suit !== 'x' && door.rank === fourth.rank) return true;
  }
  return false;
}

// ── Seat order (mirrors getActionOrder) ──────────────────────────────────

export function seatOrder(n, isPreflop, straddleSeat) {
  const indices = [];
  if (n <= 0) return indices;
  const btnIdx = n <= 3 ? 0 : n - 3;
  const sbIdx = n <= 3 ? (n <= 2 ? 0 : 1) : n - 2;
  const bbIdx = n <= 2 ? 1 : n - 1;
  if (n === 2) return isPreflop ? [0, 1] : [1, 0];
  if (isPreflop) {
    const start = (straddleSeat >= 0 && straddleSeat < n) ? (straddleSeat + 1) % n : 0;
    for (let i = 0; i < n; i++) indices.push((start + i) % n);
  } else {
    indices.push(sbIdx);
    indices.push(bbIdx);
    for (let i = 0; i < btnIdx; i++) indices.push(i);
    indices.push(btnIdx);
  }
  return indices.filter(i => i < n);
}
