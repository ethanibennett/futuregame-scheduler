// ── Quick-add: what a parsed hand is missing ──────────────────────────────
// Part A of quick-add (docs/quick-add-hands.md, docs/quick-add-contract.md).
//
//   findGaps(hand)                -> Gap[]  ordered; ask the first one first
//   applyAnswer(hand, gap, value) -> hand   a new hand with that answer merged
//
// Gaps come from RULES over the replayer's own hand format and betting logic —
// never from a model's judgement. Each answer is merged and findGaps re-runs, so
// a fix that exposes another problem is asked about next.
//
// The list runs most fundamental first: game → layout → blinds → players → hero
// → positions/button → stacks → hero cards → card notation and duplicates →
// actions street by street → draws → board / stud up cards (and "what happened
// next" for a hand that stops early) → showdown cards → result.
//
// Two additions to the contract, both optional for callers:
//   - gap.auto: true marks a mechanical fix whose first option follows from the
//     hand itself (fill the layout, relabel a bet as a raise, call the price).
//     A UI may apply it without asking.
//   - a non-blocking gap may offer { op: 'dismiss' } ("I don't know", "That's
//     where the hand ends"); applyAnswer records the gap's id in
//     hand.quickAddDismissed so it is not asked again. The replayer ignores the
//     field; strip it before saving if you like.
//
// applyAnswer also takes a plain value (a string or number typed against a gap
// that has a single `field`) and writes it there, as a convenience for the UI's
// free-text box when the answer is just a number; real free text is part B's
// /api/quick-add/answer.

import { gameConfig, gameCategory, isDrawCategory, streetDef } from './game.js';
import { normalizeStructure, applyOp, applyFreeValue, DISMISSED_KEY } from './edit.js';
import { checkActions } from './actions.js';
import { gameRules, structureRules, blindRules, playerRules, heroRules, positionRules, stackRules } from './rules-setup.js';
import { heroCardRules, cardRules, opponentCardRules, boardRules, studCardRules } from './rules-cards.js';
import { drawRules, showdownRules } from './rules-late.js';
import { compareKeys, num } from './common.js';
import { resolvePending } from './pending.js';

const isIdx = (v, n) => Number.isInteger(v) && v >= 0 && v < n;

function buildEnv(hand, dismissed) {
  const cfg = gameConfig(hand.gameType);
  const category = gameCategory(hand.gameType);
  const b = hand.blinds || {};
  const bb = num(b.bb) > 0 ? num(b.bb) : 0;
  return {
    cfg,
    category,
    gameType: hand.gameType,
    isStud: !!(cfg && cfg.isStud),
    isDraw: isDrawCategory(category),
    betting: (cfg && cfg.betting) || 'nl',
    n: hand.players.length,
    heroIdx: hand.heroIdx,
    bb,
    sb: num(b.sb) >= 0 ? num(b.sb) : 0,
    ante: num(b.ante) > 0 ? num(b.ante) : 0,
    bigBet: num(b.bigBet) > 0 ? num(b.bigBet) : 0,
    bringIn: num(b.bringIn) > 0 ? num(b.bringIn) : Math.floor(bb / 4),
    betCap: num(b.betCap) > 0 ? num(b.betCap) : ((cfg && cfg.raiseCap) || 4),
    uncapHU: b.uncapHeadsUp !== false,
    flSmallStreets: (cfg && cfg.flSmallStreets) || [0, 1],
    numStreets: cfg ? streetDef(hand.gameType).streets.length : hand.streets.length,
    dismissed,
  };
}

function foldScan(hand, before) {
  const f = new Set();
  for (let si = 0; si < before && si < hand.streets.length; si++) {
    for (const a of (hand.streets[si].actions || [])) if (a && a.action === 'fold') f.add(a.player);
  }
  return f;
}

export function findGaps(input) {
  const { hand, changed } = normalizeStructure(input);
  const dismissed = new Set(Array.isArray(hand[DISMISSED_KEY]) ? hand[DISMISSED_KEY] : []);
  const out = [];

  gameRules(hand, out);
  structureRules(input, changed, hand, out);
  const env = buildEnv(hand, dismissed);
  const n = hand.players.length;

  const playersOk = playerRules(hand, env, out);
  const heroOk = playersOk && heroRules(hand, out);
  if (env.cfg) blindRules(hand, env, out);
  const positionsOk = env.cfg && heroOk ? positionRules(hand, env, out) : false;
  if (playersOk) stackRules(hand, env, out);

  let trace = null;
  if (env.cfg && heroOk) {
    heroCardRules(hand, env, out);
    cardRules(hand, env, out);
    const canBet = positionsOk && env.bb > 0 && env.category !== 'ofc';
    if (canBet) trace = checkActions(hand, env, out);

    const lastStreet = env.numStreets - 1;
    const live = trace ? trace.live : [];
    const showdown = !!(trace && trace.completed && trace.openAt == null && live.length >= 2);
    let reachedThrough = 0;
    if (trace) {
      if (!trace.completed) reachedThrough = trace.stoppedAt.si;
      else if (trace.openAt != null) reachedThrough = trace.openAt;
      else if (live.length <= 1) reachedThrough = trace.handOverAt != null ? trace.handOverAt : 0;
      else reachedThrough = lastStreet;
    }
    const hasActionsFrom = (si) => hand.streets.slice(si).some(st => (st.actions || []).length);
    const ctx = {
      trace,
      live,
      showdown,
      hasResult: !!(hand.result && Array.isArray(hand.result.winners) && hand.result.winners.length),
      dismissed,
      reached: (si) => si === 0 || (trace ? si <= reachedThrough : false) || hasActionsFrom(si),
      closed: (si) => !!(trace && trace.closed[si]),
      foldedBefore: (si) => (trace && trace.foldedBefore[si]) || foldScan(hand, si),
      foldedAfter: (si) => (trace && trace.foldedAfter[si]) || foldScan(hand, si + 1),
    };
    if (env.category !== 'ofc') {
      drawRules(hand, env, out, ctx);
      boardRules(hand, env, out, ctx);
      studCardRules(hand, env, out, ctx);
      opponentCardRules(hand, env, out, ctx);
      if (isIdx(hand.heroIdx, n)) showdownRules(hand, env, out, ctx);
    }
  }

  const kept = out.filter(g => g.blocking || !dismissed.has(g.id));
  // Stable sort by key (Array.prototype.sort is stable).
  const sorted = kept.map((g, i) => ({ g, i })).sort((a, b) => compareKeys(a.g._key, b.g._key) || a.i - b.i).map(x => x.g);
  // One gap per id: the first (most fundamental) wins.
  const seen = new Set();
  const result = [];
  for (const g of sorted) {
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    const copy = { id: g.id, kind: g.kind, field: g.field, question: g.question };
    if (g.options) copy.options = g.options;
    if (g.allowFree) copy.allowFree = true;
    copy.blocking = g.blocking;
    if (g.auto) copy.auto = true;
    result.push(copy);
  }
  return result;
}

export function applyAnswer(hand, gap, value) {
  const base = normalizeStructure(hand).hand;
  let next;
  if (value && typeof value === 'object' && typeof value.op === 'string') next = applyOp(base, value, gap);
  else if (value !== undefined && value !== null && typeof value !== 'object') next = applyFreeValue(base, gap, value);
  else next = base;
  // Sizes and stacks that were waiting on this answer (a big blind, a stack)
  // are finished now, the way the server would finish them.
  return resolvePending(normalizeStructure(next).hand);
}
