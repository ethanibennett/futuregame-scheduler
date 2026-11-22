// ── The rules of the betting, one copy ──────────────────────────────────────────────────────────
// Whose turn it is, what they may do and for how much, read off a hand in the app's own saved form
// (players in position order, streets[si].actions as { player, action, amount added }). Plain ESM:
// the replayer's entry, quick add and the play-money table server (lib/tables) all read it.
//
// Ported from GTOEntryView in components/HandReplayerView.jsx, the entry screen that
// scripts/check-replayer-entry-oracle.mjs holds to PokerKit (2026-11-22, docs/play-money-platform.md §2).
// test/replayer-oracle/check-rules.mjs holds THIS module to the same model, in plain Node.
//
// The rules (TDA 2019, as the entry follows them):
//   - the forced bets are capped at the stack, the blind before a big-blind ante;
//   - a player who posts to come in at once (players[i].post, the play-money tables; owner, 2026-11-22) has posted
//     a LIVE big blind from their own seat: it is their bet on the first street, they act in their turn, and with
//     no raise they have the option, as the big blind does. It changes nobody's order;
//   - the smallest raise is the last FULL raise (a short all-in raises the price, not that size);
//   - a player who has acted may raise again only after a full raise, or short ones adding up to one
//     (rule 43); in limit, half a bet;
//   - a raise needs someone left who could call more, and a stack that covers more than the call;
//   - pot limit: the pot is everything in the middle, a big-blind ante included;
//   - limit: the small bet on the first two streets (flSmallStreets), the big bet after; four bets and
//     raises a round (betCap), uncapped heads-up on the last street unless the hand says otherwise.

import { gameConfig, gameCategory, isLowStud } from '../quick-add/game.js';
import { straddles, lastStraddleSeat, findStudBringIn, findStudBestBoard, studHasOpenPairOn4th } from './forced.js';
import { GAME_EVAL } from '../poker-engine.js';

/* Cent stakes summed in binary floating point leave residue (5.36 - 1.97 - 3.39 = 1.8e-15); every running
   total is rounded to a millionth, far below a cent and far above the residue. */
export const chipRound = (v) => Math.round(v * 1e6) / 1e6;

/* What a forced bet really takes: never more than the stack. A stack left blank (0) is not a limit. */
export const capPost = (amount, stack) => {
  const a = amount || 0;
  return Number(stack) > 0 ? Math.min(a, Math.max(0, Number(stack))) : a;
};

const isSB = (p) => p.position === 'SB' || p.position === 'BTN/SB';
const isBB = (p) => p.position === 'BB';

/* The blind a seat really posted. */
export function blindPosted(hand, i) {
  const p = hand.players[i];
  const b = hand.blinds || {};
  if (!p) return 0;
  if (isSB(p)) return capPost(b.sb, p.startingStack);
  if (isBB(p)) return capPost(b.bb, p.startingStack);
  return 0;
}

/* A seat's post to come in at once (players[i].post), as it really takes: capped at the stack. Never in stud. */
export function postOf(hand, i) {
  const p = hand.players[i];
  if (!p || !(Number(p.post) > 0) || gameCategory(hand.gameType) === 'stud') return 0;
  return capPost(Number(p.post), p.startingStack);
}
/* Every post, [{ seat, amount }], in seat order. */
export function postsOf(hand) {
  return hand.players.map((_, i) => ({ seat: i, amount: postOf(hand, i) })).filter((x) => x.amount > 0);
}

/* Stacks and the pot after action `upToAction` of street `upToStreet` (-1: before the street's first
   action). The replayer's calcPotsAndStacks. */
export function potAndStacks(hand, upToStreet, upToAction) {
  const blinds = hand.blinds || { sb: 0, bb: 0, ante: 0 };
  const stacks = hand.players.map((p) => Number(p.startingStack) || 0);
  const category = gameCategory(hand.gameType);
  const isBBante = category !== 'stud' && (blinds.ante || 0) > 0;
  let pot = 0;
  const post = (i, amount) => { const paid = capPost(amount, stacks[i]); stacks[i] = chipRound(stacks[i] - paid); pot = chipRound(pot + paid); };
  if (!isBBante) stacks.forEach((_, i) => post(i, blinds.ante));
  if (category !== 'stud') {
    const sbIdx = hand.players.findIndex(isSB);
    const bbIdx = hand.players.findIndex(isBB);
    if (sbIdx >= 0) post(sbIdx, blinds.sb);
    if (bbIdx >= 0) {
      const hadChips = Number(stacks[bbIdx]) > 0;
      post(bbIdx, blinds.bb);
      if (isBBante && !(hadChips && stacks[bbIdx] <= 0)) post(bbIdx, blinds.ante);
    }
    straddles(hand.players, blinds).forEach((st) => post(st.seat, st.amount));
    postsOf(hand).forEach((x) => post(x.seat, x.amount));
  }
  const folded = new Set();
  for (let si = 0; si <= upToStreet && si < hand.streets.length; si++) {
    const acts = hand.streets[si].actions || [];
    const last = si === upToStreet ? upToAction : acts.length - 1;
    for (let ai = 0; ai <= last && ai < acts.length; ai++) {
      const a = acts[ai];
      if (a.action === 'fold') { folded.add(a.player); continue; }
      if (a.amount > 0) { stacks[a.player] = chipRound(stacks[a.player] - a.amount); pot = chipRound(pot + a.amount); }
    }
  }
  return { stacks, pot, folded };
}

/* The seat order of a street: index 0 is UTG (BTN in 3-handed, BTN/SB heads-up) and the last three are
   BTN, SB, BB. The replayer's getActionOrder. */
export function seatOrderFor(n, isPreflop, studInfo, straddleSeat) {
  if (n <= 0) return [];
  const out = [];
  if (studInfo) {
    const start = studInfo.is3rdStreet ? studInfo.bringInIdx : studInfo.bestBoardIdx;
    for (let i = 0; i < n; i++) out.push(start >= 0 ? (start + i) % n : i);
    return out;
  }
  if (n === 2) return isPreflop ? [0, 1] : [1, 0];
  const btnIdx = n <= 3 ? 0 : n - 3;
  const sbIdx = n <= 3 ? 1 : n - 2;
  const bbIdx = n - 1;
  if (isPreflop) {
    const start = straddleSeat >= 0 && straddleSeat < n ? (straddleSeat + 1) % n : 0;
    for (let i = 0; i < n; i++) out.push((start + i) % n);
  } else {
    out.push(sbIdx, bbIdx);
    for (let i = 0; i < btnIdx; i++) out.push(i);
    out.push(btnIdx);
  }
  return out.filter((i) => i < n);
}

/**
 * Everything about street `si` as it stands: the price, whose turn it is, and what that player may do.
 *
 * `legal` is null when nobody is to act. Otherwise, every amount in "to" terms (the total the seat is in
 * for on this street once it acts) as well as what it adds:
 *   { player, canFold, canCheck, call (added), canRaise, raiseWord: 'Bet'|'Raise to'|'Complete',
 *     minTo, maxTo, fixedTo (limit: the one size), bigTo (stud 4th street open pair: the big bet too),
 *     bringIn (stud: the bring-in's amount when it is on offer), contrib, stack }
 */
export function streetState(hand, si) {
  const cfg = gameConfig(hand.gameType) || {};
  const category = gameCategory(hand.gameType);
  const isStud = !!cfg.isStud;
  const street = hand.streets[si] || { actions: [] };
  const actions = street.actions || [];
  const n = hand.players.length;
  const blinds = hand.blinds || { sb: 0, bb: 0, ante: 0 };
  const isPreflop = si === 0;

  const { stacks, pot } = potAndStacks(hand, si, actions.length - 1);
  const folded = new Set();
  const priorFolded = new Set();
  for (let s = 0; s <= si; s++) {
    for (const a of hand.streets[s].actions || []) {
      if (a.action === 'fold') { folded.add(a.player); if (s < si) priorFolded.add(a.player); }
    }
  }
  const allIn = new Set();
  stacks.forEach((s, i) => { if (s <= 0 && !folded.has(i)) allIn.add(i); });

  const lowStud = isLowStud(hand.gameType);
  const studInfo = isStud
    ? (si === 0
      ? { is3rdStreet: true, bringInIdx: findStudBringIn(hand, lowStud), bestBoardIdx: -1 }
      : { is3rdStreet: false, bringInIdx: -1, bestBoardIdx: findStudBestBoard(hand, si, priorFolded, lowStud) })
    : null;
  const straddleList = !isStud ? straddles(hand.players, blinds) : [];
  const postList = !isStud ? postsOf(hand) : [];
  const seatOrder = seatOrderFor(n, isPreflop, studInfo, isPreflop ? lastStraddleSeat(straddleList) : -1);
  const actionOrder = seatOrder.filter((i) => !folded.has(i) && !allIn.has(i));
  const bringInAmount = isStud ? (blinds.bringIn || Math.floor((blinds.bb || 200) / 4)) : 0;

  // The street's bets: each seat's total in, and the price.
  const contrib = new Array(n).fill(0);
  let maxBet = 0;
  if (isPreflop && !isStud) {
    const sbIdx = hand.players.findIndex(isSB);
    const bbIdx = hand.players.findIndex(isBB);
    if (sbIdx >= 0) contrib[sbIdx] = blinds.sb || 0;
    if (bbIdx >= 0) contrib[bbIdx] = blinds.bb || 0;
    maxBet = blinds.bb || 0;
    straddleList.forEach((st) => { contrib[st.seat] = st.amount; if (st.amount > maxBet) maxBet = st.amount; });
    postList.forEach((x) => { contrib[x.seat] = x.amount; });
  }
  for (const a of actions) {
    if (a.action === 'fold') continue;
    if (a.action === 'bring-in') { contrib[a.player] = a.amount || bringInAmount; if (contrib[a.player] > maxBet) maxBet = contrib[a.player]; continue; }
    if (a.amount > 0) { contrib[a.player] = chipRound(contrib[a.player] + a.amount); if (contrib[a.player] > maxBet) maxBet = contrib[a.player]; }
  }

  // Whose turn: the seat after the last aggression that has not acted since it.
  const actor = (() => {
    if (actionOrder.length === 0) return -1;
    if (actionOrder.length === 1 && contrib[actionOrder[0]] >= maxBet) return -1;
    let lastRaiser = -1, lastRaiseIdx = -1;
    const before = new Array(n).fill(0);
    let priceBefore = 0;
    if (isPreflop && !isStud) {
      const sbIdx = hand.players.findIndex(isSB);
      const bbIdx = hand.players.findIndex(isBB);
      if (sbIdx >= 0) before[sbIdx] = blinds.sb || 0;
      if (bbIdx >= 0) before[bbIdx] = blinds.bb || 0;
      priceBefore = blinds.bb || 0;
      straddleList.forEach((st) => { before[st.seat] = st.amount; if (st.amount > priceBefore) priceBefore = st.amount; });
      postList.forEach((x) => { before[x.seat] = x.amount; });
    }
    actions.forEach((a, i) => {
      if (a.action === 'fold') return;
      if (a.action === 'bring-in') { before[a.player] = a.amount || bringInAmount; priceBefore = Math.max(priceBefore, before[a.player]); return; }
      const after = before[a.player] + (a.amount > 0 ? a.amount : 0);
      if (a.action === 'raise' || a.action === 'bet' || (a.action === 'all-in' && after > priceBefore)) { lastRaiseIdx = i; lastRaiser = a.player; }
      before[a.player] = after;
      if (after > priceBefore) priceBefore = after;
    });
    let start = 0;
    if (lastRaiser >= 0) { const pos = seatOrder.indexOf(lastRaiser); if (pos >= 0) start = pos + 1; }
    for (let k = 0; k < seatOrder.length; k++) {
      const p = seatOrder[(start + k) % seatOrder.length];
      if (folded.has(p) || allIn.has(p)) continue;
      let lastAct = -1;
      for (let j = actions.length - 1; j >= 0; j--) { if (actions[j].player === p) { lastAct = j; break; } }
      if (lastAct === -1 || lastAct < lastRaiseIdx) return p;
    }
    return -1;
  })();

  const live = hand.players.map((_, i) => i).filter((i) => !folded.has(i));
  const base = { si, category, pot, stacks, contrib, maxBet, folded, allIn, live, seatOrder, actor, bringInAmount };
  if (actor < 0 || live.length <= 1) return { ...base, actor: live.length <= 1 ? -1 : actor, legal: null };

  // ── What the player to act may do ──
  const playerContrib = chipRound(contrib[actor] || 0);
  const playerStack = chipRound(stacks[actor] || 0);
  const callAmount = chipRound(Math.max(0, Math.min(maxBet - playerContrib, playerStack)));
  const canCheck = callAmount <= 0;

  const betting = cfg.betting || 'nl';
  const isLimit = betting === 'fl';
  const isPotLimit = betting === 'pl';
  const flSmallStreets = cfg.flSmallStreets || [0, 1];
  const raiseCap = blinds.betCap || cfg.raiseCap || 4;
  /* Bets and raises in the round, toward the limit cap: every action that raised the price (an all-in that
     raised included, as the entry stores one as a bet or raise), never the bring-in or a call. */
  const betRaiseCount = (() => {
    let k = 0, top = isPreflop && !isStud ? Math.max(blinds.bb || 0, ...straddleList.map((s) => s.amount)) : 0;
    const inFor = new Array(n).fill(0);
    if (isPreflop && !isStud) {
      const sbIdx = hand.players.findIndex(isSB), bbIdx = hand.players.findIndex(isBB);
      if (sbIdx >= 0) inFor[sbIdx] = blinds.sb || 0;
      if (bbIdx >= 0) inFor[bbIdx] = blinds.bb || 0;
      straddleList.forEach((s) => { inFor[s.seat] = s.amount; });
      postList.forEach((x) => { inFor[x.seat] = x.amount; });
    }
    for (const a of actions) {
      if (a.action === 'fold') continue;
      if (a.action === 'bring-in') { inFor[a.player] = a.amount || bringInAmount; top = Math.max(top, inFor[a.player]); continue; }
      inFor[a.player] = chipRound(inFor[a.player] + (a.amount || 0));
      if (inFor[a.player] > top) { k++; top = inFor[a.player]; }
    }
    return k;
  })();
  const isHeadsUp = actionOrder.length <= 2;
  const stud4thOpenPair = isStud && si === 1 && (GAME_EVAL[hand.gameType] || {}).type === 'high' && studHasOpenPairOn4th(hand);
  const flSmall = blinds.bb || 100;
  const flBig = blinds.bigBet || flSmall * 2;
  const openingBet = actions.find((a) => a.action === 'bet');
  const flBetSize = stud4thOpenPair
    ? (openingBet && chipRound(openingBet.amount) >= flBig ? flBig : flSmall)
    : (flSmallStreets.includes(si) ? flSmall : flBig);
  const openPairChoice = stud4thOpenPair && !openingBet;
  const isLastStreet = si === hand.streets.length - 1;
  const uncapHeadsUp = blinds.uncapHeadsUp !== false;
  const flCanRaise = (uncapHeadsUp && isHeadsUp && isLastStreet) || betRaiseCount < raiseCap;

  // Pot limit: everything in the middle, a big-blind ante included.
  const plPotAfterCall = chipRound(pot + callAmount);
  const plRaiseTo = chipRound(maxBet + plPotAfterCall);

  // One walk: the last FULL raise and whether the betting is open again to this player.
  const bbAmt = blinds.bb || 0;
  let prevMax = 0, lastRaiseSize = bbAmt;
  const run = new Array(n).fill(0);
  if (isPreflop && !isStud) {
    const sbIdx = hand.players.findIndex(isSB);
    const bbIdx = hand.players.findIndex(isBB);
    if (sbIdx >= 0) run[sbIdx] = blinds.sb || 0;
    if (bbIdx >= 0) run[bbIdx] = bbAmt;
    prevMax = bbAmt;
    straddleList.forEach((st) => { run[st.seat] = st.amount; prevMax = Math.max(prevMax, st.amount); lastRaiseSize = Math.max(lastRaiseSize, st.amount); });
    postList.forEach((x) => { run[x.seat] = x.amount; });
  }
  let myLast = -1, priceAtMine = 0, fullSinceMine = false;
  actions.forEach((a, i) => {
    if (a.action === 'fold') return;
    if (a.action === 'bring-in') {
      run[a.player] = a.amount || bringInAmount;
      prevMax = Math.max(prevMax, run[a.player]);
    } else {
      if (a.amount > 0) run[a.player] = chipRound(run[a.player] + a.amount);
      const to = run[a.player];
      if (to > prevMax) {
        const size = chipRound(to - prevMax);
        const full = isLimit ? size * 2 >= flBetSize : size >= lastRaiseSize;
        if (full && !isLimit) lastRaiseSize = Math.max(size, bbAmt);
        if (full) fullSinceMine = true;
        prevMax = to;
      }
    }
    if (a.player === actor) { myLast = i; priceAtMine = prevMax; fullSinceMine = false; }
  });
  const minRaiseTo = chipRound(maxBet + lastRaiseSize);
  const reopened = myLast < 0 || priceAtMine <= 0 || fullSinceMine
    || chipRound(prevMax - priceAtMine) >= (isLimit ? flBetSize / 2 : lastRaiseSize);
  const othersWithChips = hand.players.some((_, i) => i !== actor && !folded.has(i) && !allIn.has(i)
    && chipRound((stacks[i] || 0) + (contrib[i] || 0)) > chipRound(maxBet));
  let canRaise = othersWithChips && reopened && chipRound(playerStack - callAmount) > 0;
  const allInTo = chipRound(playerContrib + playerStack);

  const legal = { player: actor, canFold: !canCheck, canCheck, call: canCheck ? 0 : callAmount, contrib: playerContrib, stack: playerStack,
    canRaise: false, raiseWord: canCheck && playerContrib === 0 ? 'Bet' : 'Raise to', minTo: null, maxTo: null, fixedTo: null, bigTo: null, bringIn: null };

  // Stud's 3rd street: the bring-in (first to act) and the completion over it.
  if (isStud && si === 0 && studInfo.bringInIdx === actor && actions.length === 0) {
    return { ...base, legal: { ...legal, canFold: false, canCheck: false, call: 0, bringIn: Math.min(bringInAmount, playerStack),
      canRaise: true, raiseWord: 'Complete', fixedTo: Math.min(flBetSize, allInTo), minTo: Math.min(flBetSize, allInTo), maxTo: isLimit ? Math.min(flBetSize, allInTo) : allInTo } };
  }
  if (isStud && si === 0 && actions.length > 0 && maxBet <= bringInAmount && betRaiseCount === 0) {
    const completeTo = Math.min(flBetSize, allInTo);
    return { ...base, legal: { ...legal, canFold: true, canRaise: playerStack > callAmount, raiseWord: 'Complete', fixedTo: isLimit ? completeTo : null,
      minTo: completeTo, maxTo: isLimit ? completeTo : allInTo } };
  }

  if (isLimit) {
    canRaise = canRaise && flCanRaise;
    if (canRaise) {
      // Checked to (the big blind's option included): a bet of one more unit on what the seat is in for.
      const to = canCheck ? Math.min(chipRound(playerContrib + flBetSize), allInTo) : Math.min(chipRound(maxBet + flBetSize), allInTo);
      legal.canRaise = true; legal.fixedTo = to; legal.minTo = to; legal.maxTo = to;
      if (canCheck && openPairChoice && flBig > flBetSize) legal.bigTo = Math.min(chipRound(playerContrib + flBig), allInTo);
    }
    return { ...base, legal };
  }
  if (canRaise) {
    const betMin = canCheck ? Math.min(bbAmt || flSmall, playerStack) : Math.min(chipRound(minRaiseTo - playerContrib), playerStack);
    const betMax = isPotLimit
      ? (canCheck ? Math.min(pot, playerStack) : Math.min(chipRound(plRaiseTo - playerContrib), playerStack))
      : playerStack;
    legal.canRaise = true;
    legal.minTo = chipRound(playerContrib + betMin);
    legal.maxTo = chipRound(playerContrib + betMax);
  }
  return { ...base, legal };
}

/**
 * Checks one action against the rules and returns the action as the hand stores it, or { error }.
 * `move` is { action: 'fold'|'check'|'call'|'bet'|'raise'|'complete'|'bring-in', to } — `to` the total
 * in on this street for a bet, raise or completion (the entry's "raise to").
 */
export function checkAction(hand, si, player, move) {
  const st = streetState(hand, si);
  const L = st.legal;
  if (!L) return { error: 'Nobody is to act' };
  if (L.player !== player) return { error: 'Not your turn' };
  const kind = String((move && move.action) || '');
  const asAdded = (to) => chipRound(to - L.contrib);
  switch (kind) {
    case 'fold':
      // Folding when a check is free is allowed in the replayer's saved form only as a check; refuse it.
      if (!L.canFold) return { error: 'Nothing to call: check instead' };
      return { action: { player, action: 'fold', amount: 0 } };
    case 'check':
      if (!L.canCheck || L.bringIn != null) return { error: 'There is a bet to call' };
      return { action: { player, action: 'check', amount: 0 } };
    case 'call':
      if (L.canCheck || L.bringIn != null) return { error: 'Nothing to call' };
      return { action: { player, action: 'call', amount: L.call } };
    case 'bring-in':
      if (L.bringIn == null) return { error: 'No bring-in here' };
      return { action: { player, action: 'bring-in', amount: L.bringIn } };
    case 'bet': case 'raise': case 'complete': {
      if (!L.canRaise) return { error: 'No raise is allowed here' };
      const to = chipRound(Number(move.to));
      if (!Number.isFinite(to)) return { error: 'No amount' };
      const ok = L.fixedTo != null
        ? (to === L.fixedTo || (L.bigTo != null && to === L.bigTo))
        : (to >= L.minTo && to <= L.maxTo);
      if (!ok) {
        return { error: L.fixedTo != null ? `The bet here is ${L.fixedTo}` : `From ${L.minTo} to ${L.maxTo}`, range: [L.minTo, L.maxTo] };
      }
      // A completion is stored as a bet, as the entry stores it; so is the first bet of a street.
      const word = L.raiseWord === 'Complete' || st.maxBet === 0 ? 'bet' : 'raise';
      return { action: { player, action: word, amount: asAdded(to) } };
    }
    default:
      return { error: 'Unknown action' };
  }
}

/* No more betting: everyone still in but one is all in (or all are), so the rest of the board is dealt out. */
export function bettingIsOver(st) {
  const withChips = st.live.filter((i) => !st.allIn.has(i));
  return st.live.length > 1 && withChips.length <= 1 && st.actor < 0;
}
