// ── Quick-add: the betting table ──────────────────────────────────────────
// A chip-accurate model of one hand's betting, used by the action rules. It
// reimplements (it cannot import — the source is JSX) the replayer's own logic
// in vite-app/src/components/HandReplayerView.jsx:
//   - getStraddles / lastStraddleSeat       → straddles(), lastStraddleSeat()
//   - getActionOrder                         → seatOrder()
//   - findStudBringIn / findStudBestBoard /
//     studHasOpenPairOn4th / scoreStudBoard  → the stud helpers below
//   - calcPotsAndStacks                      → Table: antes, blinds, straddles, pot
//   - GTOEntryView streetBets / currentActor / min-raise tracking /
//     limit sizes (flBetSize, flRaiseCap, uncapHeadsUp) / pot-limit maths
//     (plEffectivePot, plRaiseToTotal)       → Table.needsToAct / sizing()
//
// One deliberate difference: the replayer's currentActor starts its search at
// actionOrder[0] when the last raiser is all-in (it is no longer in the order),
// which can name a seat that already acted. Here the next actor is always the
// next seat clockwise from the LAST actor that still owes action — the poker
// rule. The replay itself never enforces turn order, so nothing disagrees.

import { cardsOf } from './cards.js';
import { isLowStud } from './game.js';

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
  return picked.map((st, i) => ({ ...st, amount: bb * Math.pow(2, i + 1) }));
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

// Mirrors findStudBringIn (lowest door brings in; highest in razz).
export function findStudBringIn(hand, isRazz) {
  const rankBadness = isRazz
    ? { 'A':0,'2':1,'3':2,'4':3,'5':4,'6':5,'7':6,'8':7,'9':8,'T':9,'J':10,'Q':11,'K':12 }
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

// Mirrors scoreStudBoard.
function scoreStudBoard(cards) {
  const rankValues = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 };
  if (!cards.length) return 0;
  const counts = {};
  cards.forEach(c => { const r = rankValues[c.rank] || 0; counts[r] = (counts[r] || 0) + 1; });
  const pairs = [], trips = [], quads = [], kickers = [];
  Object.keys(counts).forEach(r => {
    const rv = parseInt(r, 10);
    if (counts[r] === 4) quads.push(rv);
    else if (counts[r] === 3) trips.push(rv);
    else if (counts[r] === 2) pairs.push(rv);
    else kickers.push(rv);
  });
  pairs.sort((a, b) => b - a); trips.sort((a, b) => b - a); kickers.sort((a, b) => b - a);
  if (quads.length) return 7000000 + quads[0] * 100;
  if (trips.length && pairs.length) return 6000000 + trips[0] * 100 + pairs[0];
  if (trips.length) return 5000000 + trips[0] * 100;
  if (pairs.length >= 2) return 4000000 + pairs[0] * 100 + pairs[1];
  if (pairs.length === 1) return 3000000 + pairs[0] * 100 + (kickers[0] || 0);
  const allRanks = Object.keys(counts).map(Number).sort((a, b) => b - a);
  let score = 1000000;
  for (let i = 0; i < allRanks.length; i++) score += allRanks[i] * Math.pow(100, 4 - i);
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
    const score = scoreStudBoard(studUpCards(hand, pi, si));
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

function rotateFrom(n, start) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(((start % n) + n + i) % n);
  return out;
}

// ── The table ────────────────────────────────────────────────────────────

export function validStack(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

export class Table {
  /* env: { n, isStud, betting, bb, sb, ante, bigBet, bringIn, betCap,
            uncapHU, flSmallStreets, numStreets, gameType } */
  constructor(hand, env) {
    this.env = env;
    this.n = env.n;
    this.stacks = hand.players.map(p => (validStack(p && p.startingStack) ? p.startingStack : Infinity));
    this.pot = 0;
    this.folded = new Set();
    this.allIn = new Set();
    this.si = -1;
    // Antes. Mirrors calcPotsAndStacks: outside stud an ante is a big-blind
    // ante, paid by the big blind alone; in stud every player antes.
    const ante = env.ante || 0;
    this.bbAnte = !env.isStud && ante > 0;
    if (!this.bbAnte && ante > 0) {
      for (let i = 0; i < this.n; i++) this.post(i, ante);
    }
  }

  clone() {
    const t = Object.create(Table.prototype);
    t.env = this.env;
    t.n = this.n;
    t.stacks = this.stacks.slice();
    t.pot = this.pot;
    t.folded = new Set(this.folded);
    t.allIn = new Set(this.allIn);
    t.bbAnte = this.bbAnte;
    t.si = this.si;
    t.contrib = this.contrib ? this.contrib.slice() : null;
    t.maxBet = this.maxBet;
    t.lastRaise = this.lastRaise;
    t.raiseCount = this.raiseCount;
    t.acted = new Set(this.acted || []);
    t.order = this.order ? this.order.slice() : [];
    t.pointer = this.pointer;
    t.bringInPending = this.bringInPending;
    t.fixed = this.fixed;
    t.fixedAlt = this.fixedAlt;
    return t;
  }

  /* Chips into the pot that are not a wager on this street (antes). */
  post(p, amount) {
    const a = Math.max(0, amount);
    this.stacks[p] -= a;
    this.pot += a;
    if (this.stacks[p] <= 0 && Number.isFinite(this.stacks[p])) this.allIn.add(p);
  }

  /* Chips wagered on this street. */
  put(p, amount) {
    const a = Math.max(0, amount);
    this.stacks[p] -= a;
    this.contrib[p] += a;
    this.pot += a;
    if (this.stacks[p] <= 0 && Number.isFinite(this.stacks[p])) this.allIn.add(p);
  }

  /* Open street si with its seat order. order: indices in acting order. */
  startStreet(si, hand, order) {
    this.si = si;
    this.contrib = new Array(this.n).fill(0);
    this.maxBet = 0;
    this.lastRaise = this.env.bb || 0;
    this.raiseCount = 0;
    this.acted = new Set();
    this.order = order;
    this.pointer = 0;
    this.bringInPending = this.env.isStud && si === 0;
    const bbSize = this.env.bb || 0;
    const small = (this.env.flSmallStreets || []).includes(si);
    const openPair = this.env.isStud && si === 1 && studHasOpenPairOn4th(hand);
    this.fixed = this.env.betting === 'fl' ? ((small && !openPair) ? bbSize : (this.env.bigBet || bbSize * 2)) : 0;
    /* An open pair on 4th street gives the OPTION of the big bet (the
       replayer's entry form imposes it); the small bet stays legal, and once
       a bet is made the street is played at that size. */
    this.fixedAlt = this.env.betting === 'fl' && small && openPair ? bbSize : null;
    if (si === 0 && !this.env.isStud) {
      const sbIdx = hand.players.findIndex(p => p && (p.position === 'SB' || p.position === 'BTN/SB'));
      const bbIdx = hand.players.findIndex(p => p && p.position === 'BB');
      if (sbIdx >= 0) this.put(sbIdx, Math.min(this.env.sb || 0, this.stacks[sbIdx]));
      if (bbIdx >= 0) {
        this.put(bbIdx, Math.min(this.env.bb || 0, this.stacks[bbIdx]));
        if (this.bbAnte) this.post(bbIdx, Math.min(this.env.ante || 0, this.stacks[bbIdx]));
      }
      this.maxBet = this.env.bb || 0;
      let prevLevel = 0;
      for (const st of straddles(hand.players, hand.blinds)) {
        prevLevel = this.maxBet;
        this.put(st.seat, Math.min(st.amount, this.stacks[st.seat]));
        if (st.amount > this.maxBet) this.maxBet = st.amount;
      }
      if (prevLevel > 0) this.lastRaise = Math.max(this.env.bb || 0, this.maxBet - prevLevel);
    }
  }

  live() { const out = []; for (let i = 0; i < this.n; i++) if (!this.folded.has(i)) out.push(i); return out; }
  canAct() { return this.live().filter(i => !this.allIn.has(i)); }

  needsToAct(p) {
    if (this.folded.has(p) || this.allIn.has(p)) return false;
    if (this.live().length <= 1) return false;
    if (this.contrib[p] < this.maxBet) return true;
    if (this.acted.has(p)) return false;
    // Nobody left to bet against: everyone else still in is all-in.
    if (this.canAct().length <= 1) return false;
    return true;
  }

  /* { p, pos } of the next seat that owes action, or null when the round is
     closed. */
  nextToAct() {
    const len = this.order.length;
    for (let k = 0; k < len; k++) {
      const pos = (this.pointer + k) % len;
      const p = this.order[pos];
      if (this.needsToAct(p)) return { p, pos };
    }
    return null;
  }

  /* Players who owe action, walking clockwise from the pointer up to (not
     including) seat `until`. */
  owingBefore(until) {
    const len = this.order.length;
    const out = [];
    for (let k = 0; k < len; k++) {
      const p = this.order[(this.pointer + k) % len];
      if (p === until) break;
      if (this.needsToAct(p)) out.push(p);
    }
    return out;
  }

  callAmount(p) { return Math.max(0, this.maxBet - this.contrib[p]); }
  remaining(p) { return this.stacks[p]; }

  /* Bet sizes for the street and the seat about to act. */
  sizing(p, hand) {
    const env = this.env;
    const si = this.si;
    const bb = env.bb || 0;
    const fixed = this.fixed;
    const call = this.callAmount(p);
    /* The replayer's entry form leaves a big-blind ante out of the pot-limit
       pot preflop (plAnteAdjust in GTOEntryView). Rooms count it — the ante is
       in the pot — and so do hands as players describe them, so the larger,
       ante-inclusive maximum is the one a described raise is held to. */
    const potBefore = this.pot;
    // Stud: after a bring-in nobody has completed yet, the first full bet is
    // the complete — a raise to the small bet, not a raise of it.
    const completing = env.isStud && si === 0 && this.raiseCount === 0 && this.maxBet > 0 && this.maxBet < bb;
    let flTarget, flTargetAlt = null;
    if (completing || this.maxBet === 0) flTarget = fixed;
    else flTarget = this.maxBet + fixed;
    if (this.fixedAlt && this.maxBet === 0) flTargetAlt = this.fixedAlt;
    const minTotal = completing ? bb : (this.maxBet === 0 ? bb : this.maxBet + this.lastRaise);
    const plMaxTotal = this.maxBet === 0 ? potBefore : this.maxBet + potBefore + call;
    const cap = env.betCap || 4;
    const headsUp = this.canAct().length <= 2;
    const lastStreet = si === env.numStreets - 1;
    const capped = !(env.uncapHU && headsUp && lastStreet) && this.raiseCount >= cap;
    return { fixed, flTarget, flTargetAlt, minTotal, plMaxTotal, potBefore, call, completing, cap, capped };
  }

  /* Record an action. kind: 'fold'|'check'|'call'|'bet'|'raise'|'all-in'|'bring-in'. */
  apply(p, kind, amount) {
    const len = this.order.length;
    const pos = this.order.indexOf(p);
    if (pos >= 0) this.pointer = (pos + 1) % len;
    if (kind === 'fold') { this.folded.add(p); return; }
    if (kind === 'check') { this.acted.add(p); return; }
    if (kind === 'bring-in') {
      this.put(p, amount);
      if (this.contrib[p] > this.maxBet) this.maxBet = this.contrib[p];
      this.bringInPending = false;
      this.acted.add(p);
      return;
    }
    const before = this.maxBet;
    this.put(p, amount);
    if (kind === 'all-in') this.allIn.add(p);
    const total = this.contrib[p];
    this.bringInPending = false;
    if (total <= before) { this.acted.add(p); return; }
    const inc = total - before;
    const bb = this.env.bb || 0;
    const completing = this.env.isStud && this.si === 0 && this.raiseCount === 0 && before > 0 && before < bb;
    /* A full bet or raise reopens the betting for everyone who already acted;
       an all-in for less than a full raise does not (they still owe the
       difference, but only that). Min-raise tracking mirrors GTOEntryView's
       _lastRaiseSize: the size of the last full raise, never under the big
       blind. */
    let full;
    if (before === 0) full = true;
    else if (completing) full = total >= bb;
    else if (this.env.betting === 'fl') full = inc >= this.fixed;
    if (before === 0 && this.fixedAlt && inc === this.fixedAlt) { this.fixed = this.fixedAlt; this.fixedAlt = null; }
    else full = inc >= this.lastRaise;
    this.maxBet = total;
    this.raiseCount++;
    if (full) {
      if (before === 0) this.lastRaise = Math.max(inc, bb);
      else if (completing) this.lastRaise = bb;
      else this.lastRaise = inc;
      this.acted = new Set([p]);
    } else {
      this.acted.add(p);
    }
  }
}
