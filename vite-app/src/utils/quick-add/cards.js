// ── Quick-add: card helpers ───────────────────────────────────────────────
// Card parsing comes from the replayer's own engine (poker-engine.js, which is
// plain JS and imports nothing). The draw helpers below mirror the functions of
// the same name in vite-app/src/components/HandReplayerView.jsx, which cannot be
// imported here (it is JSX).

import { parseCardNotation } from '../poker-engine.js';

export { parseCardNotation };

export const MUCK = 'MUCK';

/* An opponent's cards live in a slot numbered without the hero: seats before
   the hero keep their index, seats after it shift down one. Every reader in the
   replayer computes it this way (`pi < heroIdx ? pi : pi - 1`). */
export function oppSlot(pi, heroIdx) {
  return pi < heroIdx ? pi : pi - 1;
}
export function slotPlayer(slot, heroIdx) {
  return slot < heroIdx ? slot : slot + 1;
}

export function asCardString(v) {
  return typeof v === 'string' ? v : '';
}

/* Cards in a string; a mucked hand has none. */
export function cardsOf(str) {
  const s = asCardString(str);
  if (!s || s.trim().toUpperCase() === MUCK) return [];
  return parseCardNotation(s);
}
export function knownKeys(str) {
  return cardsOf(str).filter(c => c.suit !== 'x').map(c => c.rank + c.suit);
}
export function isMuck(str) {
  return typeof str === 'string' && str.trim().toUpperCase() === MUCK;
}

/* A face-down card the replayer can draw: a rank with suit x. A rankless 'xx'
   is dropped by the parser, so unknown cards are written 'Ax' (the same choice
   computeDrawHand makes). */
export function backs(n) { return 'Ax'.repeat(Math.max(0, n)); }

const RANKS = 'AKQJT98765432';
const SUITS = 'hdcsx';

/* What is wrong with a card string, in the terms checkCardText in the replayer
   uses (characters the parser silently drops), plus one it does not: a rank
   with no suit. parseCardNotation pairs the i-th rank with the i-th suit and
   gives a rank without one suit 'x', so "AKh" quietly becomes Ah plus a
   face-down K — a different hand from the one typed.
   Returns null when the string is fine, else { reason, guess } where guess is
   a cleaned string to offer (or null). */
export function notationProblem(str, expected) {
  if (typeof str !== 'string' || !str.trim()) return null;
  if (isMuck(str)) return null;
  const stripped = str.replace(/[\s,]/g, '');
  const bad = [...new Set(stripped.split('').filter(ch =>
    !RANKS.includes(ch.toUpperCase()) && !SUITS.includes(ch.toLowerCase())))];
  let ranks = 0, suits = 0;
  for (const ch of stripped) {
    if (RANKS.includes(ch.toUpperCase())) ranks++;
    else if (SUITS.includes(ch.toLowerCase())) suits++;
  }
  if (!bad.length && ranks === suits) return null;
  /* "x" or "xx" (or "?") for a card nobody saw: the replayer's parser drops a
     card with no rank, so the hand would come up short. That is a card the
     player does not know — missing, not mistyped — and its face-down form is
     'Ax'. */
  const tokens = tokenizeCards(stripped, expected);
  if (tokens && tokens.some(t => t === '??')) {
    return {
      reason: 'unknown cards',
      unknown: tokens.filter(t => t === '??').length,
      known: tokens.filter(t => t !== '??'),
      guess: tokens.map(t => (t === '??' ? 'Ax' : t)).join(''),
    };
  }
  const reason = bad.length ? 'not card notation: ' + bad.join(' ') : 'a rank without a suit';
  return { reason, guess: cleanCardGuess(str) };
}

/* Interleaved cards with wholly unknown cards among them, as two-char tokens
   ('??' for an unknown card); null when the string is not that. An unknown
   card is written two ways: one 'x' each ("Tx9xx" is Tx 9x and one unknown —
   the corpus's form) or 'xx'/'Xx' each (hand-history style, "XxXx"). Runs of
   x's are read whichever way makes the count come out to `expected`; with no
   count to go by, an even run is pairs. */
function tokenizeCards(s, expected) {
  const known = [];
  const runs = []; // [{ at: index in the token list, len }]
  let i = 0;
  while (i < s.length) {
    const a = s[i], b = s[i + 1];
    if (RANKS.includes(a.toUpperCase()) && b !== undefined && SUITS.includes(b.toLowerCase())) {
      known.push(a.toUpperCase() + b.toLowerCase()); i += 2; continue;
    }
    if (/[xX?]/.test(a)) {
      let j = i;
      while (j < s.length && /[xX?]/.test(s[j])) j++;
      runs.push({ len: j - i, pos: known.length });
      i = j; continue;
    }
    return null;
  }
  const xs = runs.reduce((t, r) => t + r.len, 0);
  if (!xs) return known;
  const allEven = runs.every(r => r.len % 2 === 0);
  let pairs;
  if (Number.isInteger(expected) && allEven && known.length + xs / 2 === expected) pairs = true;
  else if (Number.isInteger(expected) && known.length + xs === expected) pairs = false;
  else pairs = allEven;
  const out = [];
  let k = 0;
  for (const r of runs.sort((x, y) => x.pos - y.pos)) {
    while (k < r.pos) out.push(known[k++]);
    for (let u = 0; u < (pairs ? r.len / 2 : r.len); u++) out.push('??');
  }
  while (k < known.length) out.push(known[k++]);
  return out;
}

/* The most likely intended string: "10" is a ten, "xx"/"??" is an unknown card,
   separators go. Offered only if the result is itself clean. */
export function cleanCardGuess(str) {
  let s = String(str || '');
  s = s.replace(/10/g, 'T');
  s = s.replace(/[♥]/g, 'h').replace(/[♦]/g, 'd').replace(/[♣]/g, 'c').replace(/[♠]/g, 's');
  s = s.replace(/[\s,\-\/|.]/g, '');
  if (!s) return null;
  const tokens = tokenizeCards(s);
  if (tokens) return tokens.map(t => (t === '??' ? 'Ax' : t)).join('');
  for (const ch of s) {
    if (!RANKS.includes(ch.toUpperCase()) && !SUITS.includes(ch.toLowerCase())) return null;
  }
  let ranks = 0, suits = 0;
  for (const ch of s) {
    if (RANKS.includes(ch.toUpperCase())) ranks++; else suits++;
  }
  if (ranks !== suits || ranks === 0) return null;
  // Re-emit interleaved (AhKd), the house notation.
  return parseCardNotation(s).map(c => c.rank + c.suit).join('');
}

/* Remove one copy of `key` (e.g. 'Ah') from a card string, keeping the rest in
   interleaved notation. */
export function removeCardFrom(str, key) {
  const cards = cardsOf(str);
  const i = cards.findIndex(c => c.rank + c.suit === key);
  if (i < 0) return asCardString(str);
  cards.splice(i, 1);
  return cards.map(c => c.rank + c.suit).join('');
}

// ── Draw hands (mirrors HandReplayerView.jsx) ────────────────────────────

const RANK_SORT = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 };
const SUIT_SORT = { s:4, h:3, d:2, c:1, x:0 };
const ACE_LOW_DRAW = new Set(['A-5 TD', 'Badugi', 'Badacy']);
const HIGH_DRAW = new Set(['PL 5CD Hi']);
const drawBase = (gameType) => String(gameType || '').replace(/^Super /, '');

// Mirrors sortDrawHand.
export function sortDrawHand(cardStr, gameType) {
  const cards = parseCardNotation(cardStr || '');
  if (cards.length < 2) return cardStr || '';
  const aceLow = ACE_LOW_DRAW.has(drawBase(gameType));
  const rank = (r) => (r === 'A' && aceLow) ? 1 : (RANK_SORT[r] || 0);
  const rk = (c) => c.suit === 'x' ? 0 : rank(c.rank);
  return cards.slice().sort((a, b) =>
    rk(b) - rk(a) || (SUIT_SORT[b.suit] || 0) - (SUIT_SORT[a.suit] || 0)
  ).map(c => c.rank + c.suit).join('');
}
function drawThrowsFromTop(gameType) { return !HIGH_DRAW.has(drawBase(gameType)); }

// Mirrors computeDrawHand: the hand after every draw up to and including the
// draw recorded on `upToStreetIdx` (a draw is recorded on the round BEFORE it).
export function computeDrawHand(originalCards, draws, upToStreetIdx, gameType = '') {
  if (!originalCards) return '';
  let current = sortDrawHand(originalCards, gameType);
  for (let si = 0; si <= upToStreetIdx; si++) {
    if (!draws || !draws[si]) continue;
    const draw = draws[si];
    // Guarded where the replayer is not: a quick-add hand can hold anything here.
    const count = Number.isInteger(draw && draw.discarded) && draw.discarded > 0 ? Math.min(draw.discarded, 13) : 0;
    if (!count) continue;
    const thrown = asCardString(draw.discardedCards);
    const drawn = asCardString(draw.newCards);
    if (thrown) {
      const discarded = parseCardNotation(thrown);
      const currentParsed = parseCardNotation(current);
      const remaining = [];
      const discardSet = {};
      discarded.forEach(c => { discardSet[c.rank + c.suit] = (discardSet[c.rank + c.suit] || 0) + 1; });
      currentParsed.forEach(c => {
        const key = c.rank + c.suit;
        if (discardSet[key] && discardSet[key] > 0) { discardSet[key]--; }
        else { remaining.push(c); }
      });
      current = remaining.map(c => c.rank + c.suit).join('');
    } else {
      const parsed = parseCardNotation(current);
      const n = Math.min(parsed.length, count);
      const kept = drawThrowsFromTop(gameType) ? parsed.slice(n) : parsed.slice(0, parsed.length - n);
      current = kept.map(c => c.rank + c.suit).join('');
    }
    if (drawn) current = sortDrawHand(current + drawn, gameType);
    else current = current + 'Ax'.repeat(count);
  }
  return current;
}

// Mirrors getPlayerDrawsByStreet.
export function getPlayerDrawsByStreet(hand, playerIdx) {
  const result = {};
  (hand.streets || []).forEach((s, si) => {
    if (!s || !Array.isArray(s.draws)) return;
    const d = s.draws.find(dd => dd && dd.player === playerIdx);
    if (d) result[si] = d;
  });
  return result;
}

/* Mirrors drawDeadCards: the cards that cannot be dealt to `playerIdx` on the
   draw recorded at `streetIdx`, each with the reason. One deliberate difference:
   an OPPONENT's stored cards are their showdown hand, which already contains the
   cards they drew, so their own stored hand is not dead to their own draw (the
   replayer never asks for an opponent's new cards, so it never meets this). */
export function drawDeadCards(hand, streetIdx, playerIdx) {
  const dead = new Map();
  const heroIdx = hand.heroIdx != null ? hand.heroIdx : 0;
  const players = hand.players || [];
  const streets = hand.streets || [];
  const nameOf = (pi) => (players[pi] && players[pi].name) || 'another player';
  const add = (str, why) => {
    for (const c of cardsOf(str)) {
      if (c.suit === 'x') continue;
      const k = c.rank + c.suit;
      if (!dead.has(k)) dead.set(k, why);
    }
  };
  for (let si = 0; si <= streetIdx && si < streets.length; si++) {
    for (const d of ((streets[si] && streets[si].draws) || [])) if (d) add(d.discardedCards, 'already discarded');
  }
  const s0 = (streets[0] && streets[0].cards) || {};
  players.forEach((_, pi) => {
    if (pi !== heroIdx && pi === playerIdx) return; // see the note above
    const base = pi === heroIdx ? (s0.hero || '') : ((s0.opponents || [])[oppSlot(pi, heroIdx)] || '');
    const held = pi === heroIdx ? computeDrawHand(base, getPlayerDrawsByStreet(hand, pi), streetIdx - 1, hand.gameType) : base;
    add(held, pi === playerIdx ? 'already in this hand' : 'in ' + nameOf(pi) + "'s hand");
  });
  for (let si = 0; si < streetIdx && si < streets.length; si++) {
    for (const d of ((streets[si] && streets[si].draws) || [])) {
      if (!d) continue;
      if (d.player !== heroIdx && d.player === playerIdx) continue; // in their stored hand, see above
      add(d.newCards, d.player === playerIdx ? 'already in this hand' : 'in ' + nameOf(d.player) + "'s hand");
    }
  }
  const cur = streets[streetIdx];
  for (const d of ((cur && cur.draws) || [])) {
    if (d && d.player !== playerIdx) add(d.newCards, 'already dealt to ' + nameOf(d.player));
  }
  return dead;
}
