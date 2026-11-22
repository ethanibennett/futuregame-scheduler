// ── Quick-add: the betting table ──────────────────────────────────────────
// A chip-accurate model of one hand's betting, read action by action as a hand is described: it takes
// unknown stacks (Infinity) and seats that act out of turn, which the shared rules (utils/poker-rules/
// betting.js, one street from a whole hand) do not, so it stays its own reader. What it shares, it imports:
// the straddles, the stud bring-in, best board and open pair on 4th, and the seat order are
// utils/poker-rules/forced.js (re-exported below, so imports from here still work). The replayer's entry
// reads poker-rules too since the play-money branch (decision 11), so there is no third copy.
//
// Held together by test/replayer-oracle/check-quick-add.mjs (in test:replayer-oracle): none of the
// PokerKit corpus's 1,200 legal hands may be questioned about its betting, and a raise cut below the
// shared rules' smallest raise must be.
//
// The next actor is always the next seat clockwise from the LAST actor that still owes action.

import { clean, straddles, lastStraddleSeat, studStreetCards, doorCard, findStudBringIn, studUpCards, findStudBestBoard, studHasOpenPairOn4th, seatOrder } from '../poker-rules/forced.js';
export { clean, straddles, lastStraddleSeat, studStreetCards, doorCard, findStudBringIn, studUpCards, findStudBestBoard, studHasOpenPairOn4th, seatOrder } from '../poker-rules/forced.js';

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
    this.stacks[p] = clean(this.stacks[p] - a);
    this.pot = clean(this.pot + a);
    if (this.stacks[p] <= 0 && Number.isFinite(this.stacks[p])) this.allIn.add(p);
  }

  /* Chips wagered on this street. */
  put(p, amount) {
    const a = Math.max(0, amount);
    this.stacks[p] = clean(this.stacks[p] - a);
    this.contrib[p] = clean(this.contrib[p] + a);
    this.pot = clean(this.pot + a);
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

  callAmount(p) { return Math.max(0, clean(this.maxBet - this.contrib[p])); }
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
    /* Every total cleaned as the running ones are: unrounded, 82.55 to raise to read as 82.55000000000001 and
       a legal min-raise as one short of it (56 of the PokerKit corpus's 1,200 hands, test:quick-add's corpus check). */
    let flTarget, flTargetAlt = null;
    if (completing || this.maxBet === 0) flTarget = fixed;
    else flTarget = clean(this.maxBet + fixed);
    if (this.fixedAlt && this.maxBet === 0) flTargetAlt = this.fixedAlt;
    const minTotal = completing ? bb : (this.maxBet === 0 ? bb : clean(this.maxBet + this.lastRaise));
    const plMaxTotal = this.maxBet === 0 ? potBefore : clean(this.maxBet + potBefore + call);
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
