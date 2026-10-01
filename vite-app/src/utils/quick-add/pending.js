// ── Quick-add: what the server left pending ───────────────────────────────
// The server's normaliser (lib/quick-add/normalize.js) leaves some values
// waiting on others: a hand whose table size is unknown lists only the players
// mentioned (hand.quickAdd = { positions: 'narrator', tableSize?, othersFolded?,
// antePerPlayer?, straddles? }); a size said as "to 3 BB" or "half pot" stays on
// the action (amount: null with toAmount / toAmountBB / potFraction) until the
// blinds are known; a stack said in big blinds stays as startingStackBB.
//
// When an answer given in the client supplies the missing piece, these finish
// the job the way the server would: seatTable is the server's seatInternal plus
// resolveStakes / insertImplicitFolds for a known table size, and resolvePending
// is its resolveAmounts — except that an amount already recorded is never
// overwritten here (a wrong one is a gap to ask about, not a thing to fix
// silently).

import { gameConfig, gameCategory } from './game.js';
import { seatHand, referencedSeats, hasCards, positionMode } from './seats.js';
import { straddles } from './betting.js';

const PENDING_ACTION_KEYS = ['toAmount', 'toAmountBB', 'potFraction'];
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/* Whole chips unless the stakes have cents (server roundChips). */
export function roundChips(x, blinds) {
  if (!Number.isFinite(x)) return null;
  const b = blinds || {};
  const fractional = [b.sb, b.bb, b.ante, b.bigBet, b.bringIn].some(v => typeof v === 'number' && !Number.isInteger(v));
  return fractional ? Math.round(x * 100) / 100 : Math.round(x);
}

export function hasPendingSize(a) {
  return !!a && PENDING_ACTION_KEYS.some(k => a[k] != null);
}

function clearPending(a) { for (const k of PENDING_ACTION_KEYS) delete a[k]; }

/* "Folds to me" (server insertImplicitFolds): seats the description never
   mentions fold preflop, in turn — only for seats that do nothing anywhere. */
export function insertImplicitFolds(hand) {
  const cfg = gameConfig(hand.gameType);
  if (!cfg || cfg.isStud || !hand.streets || !hand.streets[0]) return;
  const n = hand.players.length;
  const involved = referencedSeats(hand);
  hand.players.forEach((_, i) => { if (i === hand.heroIdx || hasCards(hand, i)) involved.add(i); });
  const st = hand.streets[0];
  const sl = straddles(hand.players, hand.blinds);
  let ptr = sl.length ? (sl[sl.length - 1].seat + 1) % n : 0;
  const out = [], gone = new Set();
  let broken = false;
  const foldUntil = (target) => {
    for (let guard = 0; guard < n && ptr !== target; guard++) {
      if (gone.has(ptr)) { ptr = (ptr + 1) % n; continue; }
      if (involved.has(ptr)) { broken = true; return; }
      out.push({ player: ptr, action: 'fold', amount: 0 });
      gone.add(ptr);
      ptr = (ptr + 1) % n;
    }
  };
  for (const a of (st.actions || [])) {
    if (!broken) foldUntil(a.player);
    out.push(a);
    if (a.action === 'fold' || a.action === 'all-in') gone.add(a.player);
    ptr = (a.player + 1) % n;
  }
  if (!broken) {
    for (let k = 0; k < n; k++, ptr = (ptr + 1) % n) {
      if (!gone.has(ptr) && !involved.has(ptr)) { out.push({ player: ptr, action: 'fold', amount: 0 }); gone.add(ptr); }
    }
  }
  st.actions = out;
}

/* Seat the (mutable, already copied) hand at an n-handed table. `remap` is
   edit.js's remapSeats, passed in to keep the modules acyclic. */
export function seatTable(hand, n, remap) {
  const mode = positionMode(hand);
  const seated = seatHand(hand, n, mode);
  if (!seated) return hand;
  const qaBefore = isObj(hand.quickAdd) ? { ...hand.quickAdd } : {};
  const pendingStraddles = Array.isArray(qaBefore.straddles) ? qaBefore.straddles : [];
  const order = seated.order.map(o => (o === -1 ? null : o));
  const oldToNew = {};
  order.forEach((o, k) => { if (o != null) oldToNew[o] = k; });
  let out = remap(hand, order, { positions: seated.positions });
  const qa = { ...qaBefore };
  delete qa.positions;
  if (!seated.complete) {
    qa.tableSize = n;
    out.quickAdd = qa;
    return out;
  }
  delete qa.tableSize;
  const cfg = gameConfig(out.gameType) || {};
  const b = out.blinds = { ...(out.blinds || {}) };
  if (isNum(qa.antePerPlayer)) {
    b.ante = cfg.isStud ? qa.antePerPlayer : roundChips(qa.antePerPlayer * out.players.length, b);
    delete qa.antePerPlayer;
  }
  if (pendingStraddles.length) {
    const flags = {};
    for (const s of pendingStraddles) {
      if (!s || !['utg', 'button', 'rock', 'mississippi'].includes(s.type) || out.players.length < 4) continue;
      if (s.type === 'utg' || s.type === 'button') { flags['straddle_' + s.type] = true; continue; }
      const seat = Number.isInteger(s.player) ? oldToNew[s.player] : null;
      if (seat != null && seat >= 0 && seat <= out.players.length - 3) {
        flags['straddle_' + s.type] = true;
        flags.straddleSeats = { ...(flags.straddleSeats || {}), [s.type]: seat };
      }
    }
    if (Object.keys(flags).length) Object.assign(b, flags, { straddle: true });
    delete qa.straddles;
  }
  if (qa.othersFolded) {
    insertImplicitFolds(out);
    delete qa.othersFolded;
  }
  if (Object.keys(qa).length) out.quickAdd = qa; else delete out.quickAdd;
  return out;
}

/* Fill in what can now be computed (server resolveAmounts): stacks given in big
   blinds, and action sizes given as a "to" amount, in big blinds, as a fraction
   of the pot, or as a call — but only where no amount is recorded. Mutates. */
export function resolvePending(hand) {
  const b = hand.blinds || {};
  const bb = isNum(b.bb) && b.bb > 0 ? b.bb : null;
  for (const p of (hand.players || [])) {
    if (!p) continue;
    if (p.startingStack == null && isNum(p.startingStackBB) && bb) {
      p.startingStack = roundChips(p.startingStackBB * bb, b);
    }
    if (isNum(p.startingStack) && p.startingStackBB != null) delete p.startingStackBB;
  }
  const cfg = gameConfig(hand.gameType);
  if (!cfg || !Array.isArray(hand.streets)) return hand;
  const cat = gameCategory(hand.gameType);
  const n = (hand.players || []).length;
  const r = (x) => roundChips(x, b);
  const committed = new Array(n).fill(0);
  const cKnown = new Array(n).fill(true);
  let pot = 0, potKnown = true;
  const sbIdx = hand.players.findIndex(p => p && (p.position === 'SB' || p.position === 'BTN/SB'));
  const bbIdx = hand.players.findIndex(p => p && p.position === 'BB');
  const ante = isNum(b.ante) ? b.ante : null;
  if (cat === 'stud') {
    if (ante == null) { potKnown = false; cKnown.fill(false); } else { committed.fill(ante); pot += ante * n; }
  } else if (ante == null) {
    potKnown = false; if (bbIdx >= 0) cKnown[bbIdx] = false;
  } else if (ante > 0) {
    pot += ante; if (bbIdx >= 0) committed[bbIdx] += ante;
  }
  const remaining = (p) => {
    const s = hand.players[p];
    return s && isNum(s.startingStack) && cKnown[p] ? r(s.startingStack - committed[p]) : null;
  };
  hand.streets.forEach((st, si) => {
    if (!st || !Array.isArray(st.actions)) return;
    const contrib = new Array(n).fill(0);
    const known = new Array(n).fill(true);
    let maxBet = 0, maxKnown = true;
    const post = (p, amt) => {
      if (p < 0) return;
      if (amt == null) { known[p] = false; cKnown[p] = false; potKnown = false; return; }
      contrib[p] = amt; committed[p] += amt; pot += amt;
      if (amt > maxBet) maxBet = amt;
    };
    if (si === 0 && cat !== 'stud') {
      post(sbIdx, isNum(b.sb) ? b.sb : null);
      post(bbIdx, bb);
      if (bb == null) maxKnown = false; else maxBet = Math.max(maxBet, bb);
      if (sbIdx < 0 || bbIdx < 0) {
        if (sbIdx < 0) { if (!isNum(b.sb)) potKnown = false; else pot += b.sb; }
        if (bbIdx < 0) { if (bb == null) potKnown = false; else pot += bb; }
        hand.players.forEach((s, p) => { if (!s || !s.position) { known[p] = false; cKnown[p] = false; } });
      }
      for (const sd of straddles(hand.players, b)) { contrib[sd.seat] = sd.amount; committed[sd.seat] += sd.amount; pot += sd.amount; maxBet = Math.max(maxBet, sd.amount); }
    }
    const fixedBet = () => {
      if (cfg.betting !== 'fl' || bb == null) return null;
      return [0, 1].includes(si) ? bb : (isNum(b.bigBet) && b.bigBet > 0 ? b.bigBet : bb * 2);
    };
    for (const a of st.actions) {
      if (!a || !(Number.isInteger(a.player) && a.player >= 0 && a.player < n)) continue;
      const p = a.player;
      if (a.action === 'fold' || a.action === 'check') {
        if (a.amount == null) a.amount = 0;
        clearPending(a);
        continue;
      }
      const recorded = isNum(a.amount) && (a.amount > 0 || a.action === 'bring-in') ? a.amount : null;
      let amt = recorded;
      if (amt == null) {
        if (a.action === 'bring-in') {
          if (isNum(b.bringIn)) amt = b.bringIn;
        } else if (a.action === 'call') {
          if (maxKnown && known[p]) {
            const toCall = Math.max(0, maxBet - contrib[p]);
            const rem = remaining(p);
            amt = rem != null ? Math.min(toCall, rem) : toCall;
          }
        } else {
          let to = null;
          if (isNum(a.toAmount)) to = a.toAmount;
          else if (isNum(a.toAmountBB) && bb != null) to = r(a.toAmountBB * bb);
          else if (isNum(a.potFraction) && potKnown && maxKnown && known[p]) {
            const toCall = Math.max(0, maxBet - contrib[p]);
            to = maxBet === 0 || a.action === 'bet'
              ? contrib[p] + r(a.potFraction * pot)
              : r(maxBet + a.potFraction * (pot + toCall));
          }
          if (to != null && known[p]) {
            if (to - contrib[p] > 0) amt = r(to - contrib[p]);
          } else if (to == null) {
            if (a.action === 'all-in') amt = remaining(p);
            else {
              const fb = fixedBet();
              if (fb != null && a.action === 'bet') amt = fb;
              else if (fb != null && a.action === 'raise' && maxKnown && known[p]) amt = r(maxBet + fb - contrib[p]);
            }
          }
        }
      }
      if (amt != null) {
        a.amount = amt;
        clearPending(a);
        if (a.action === 'bring-in') { committed[p] += amt - contrib[p]; pot += amt - contrib[p]; contrib[p] = amt; }
        else { contrib[p] += amt; committed[p] += amt; pot += amt; }
        if (contrib[p] > maxBet) maxBet = contrib[p];
      } else {
        a.amount = null;
        known[p] = false; cKnown[p] = false; potKnown = false;
        if (a.action !== 'call') maxKnown = false;
      }
    }
  });
  return hand;
}
