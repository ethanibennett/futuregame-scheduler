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
// Additions to the contract, all optional for callers:
//   - gap.auto: true marks a mechanical fix whose first option follows from the
//     hand itself (fill the layout, relabel a bet as a raise, call the price,
//     fold a seat that never did anything). A UI may apply it without asking.
//   - gap.provisional: true marks a PREVIEW. While the game or the seating is
//     unknown nothing downstream can be checked, so the rest is read on a copy
//     with the likeliest answer taken and listed after the real question, with
//     no options (allowFree only). Ask the first gap first; once it is answered
//     the previews come back as real gaps with options.
//   - a non-blocking gap may offer { op: 'dismiss' } ("I don't know", "That's
//     where the hand ends"); applyAnswer records the gap's id in
//     hand.quickAddDismissed so it is not asked again. The replayer ignores the
//     field; strip it before saving if you like.
//
// Option values are plain JSON { op, ...args } (see edit.js applyOp), so they
// can travel through the server untouched. applyAnswer also takes a plain value
// (a string or number typed against a gap with a single `field`, or a table
// size like "9-handed" for field 'tableSize') and writes it there, as a
// convenience for the UI's free-text box; real free text is part B's
// /api/quick-add/answer.
//
// Hands as the server (part B, lib/quick-add/normalize.js) leaves them are read
// on its terms: hand.quickAdd ({ positions: 'narrator', tableSize, othersFolded,
// antePerPlayer, straddles }) while the table is not seated — field 'tableSize'
// is asked, and answering it seats the table exactly as the server would
// (seats.js / pending.js are ports); sizes still pending (amount: null with
// toAmount / toAmountBB / potFraction, startingStackBB) wait for what they need
// and are finished by applyAnswer once it is known; with no hero the card slots
// read as if seat 0 were the hero, and naming the hero moves every card string.

import { gameConfig, gameCategory, isDrawCategory, streetDef, guessGameType } from './game.js';
import { cardsOf, notationProblem } from './cards.js';
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

/* Every rule over one (normalised) hand. Returns the raw gaps (with sort keys)
   and how far the hand got: the previews below re-run this on a copy. */
function collect(hand, changed, dismissed, input) {
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
    /* When the betting could not be read to the end, the hand still shows
       whether it reached a showdown: a winner or an opponent's cards, with two
       or more players never recorded folding. Then every street was dealt. */
    const scanLive = hand.players.map((_, i) => i).filter(i => !foldScan(hand, hand.streets.length).has(i));
    const winners = (hand.result && Array.isArray(hand.result.winners)) ? hand.result.winners.filter(Boolean) : [];
    const shown = scanLive.some(i => i !== hand.heroIdx && hand.streets.some((st, si) => (si === 0 || env.isStud) &&
      cardsOf((st.cards.opponents || [])[i < hand.heroIdx ? i : i - 1]).length > 0));
    const showdownEvidence = (!trace || !trace.completed) && scanLive.length >= 2 && (winners.length > 0 || shown);
    const ctx = {
      trace,
      live,
      showdown,
      hasResult: winners.length > 0,
      dismissed,
      reached: (si) => si === 0 || (trace ? si <= reachedThrough : false) || hasActionsFrom(si) || showdownEvidence,
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
  return { out, env, playersOk, heroOk, positionsOk };
}

/* A best guess at the game, used only to preview what else will be asked
   once the game is known: the name's alias, else the street names and the
   hero's card count. */
function provisionalGame(hand) {
  const named = guessGameType(typeof hand.gameType === 'string' ? hand.gameType : '');
  if (named) return named;
  const names = hand.streets.map(st => (st && typeof st.name === 'string' ? st.name : '')).join(' ').toLowerCase();
  const s = hand.streets[0] && hand.streets[0].cards ? hand.streets[0].cards.hero : '';
  const bad = notationProblem(s);
  const count = bad && bad.unknown ? bad.known.length + bad.unknown : cardsOf(s).length;
  if (/street/.test(names) || (hand.blinds && hand.blinds.bringIn != null)) return 'Stud Hi';
  if (/draw/.test(names)) return hand.streets.length <= 2 ? 'NL 2-7 SD' : (count === 4 ? 'Badugi' : '2-7 TD');
  if (count === 4) return 'PLO';
  if (count === 5) return 'Big O';
  if (count === 6) return 'Big Easy';
  return 'NLH';
}

const SEATING_IDS = /^(table-size|players|button|positions|seat:\d+)$/;
/* Gaps that name no seat by index, so they read the same before and after
   the table is seated (street-0 actions excluded: seating inserts folds there). */
const INDEX_FREE = /^(board(:\d+)?|cards:hero(:\d+)?|cards:hero-suits|notation:streets\.\d+\.cards\.(hero|board)|action(-label)?:[1-9]\d*:\d+|raise-cap:[1-9]\d*:\d+|street-open:[1-9]\d*|next:[1-9]\d*:\d+|result|bringin(-door)?|draws(-shifted|-late)?|blinds\.\w+|straddle)$/;

/* What a preview gap looks like: the question and where it points, with no
   options — they would be computed against a guess. Answer the first gap
   first; the real question replaces the preview when its turn comes. */
function asPreview(g) {
  const copy = { id: g.id, kind: g.kind, field: g.field, question: g.question, blocking: g.blocking, allowFree: true, provisional: true };
  Object.defineProperty(copy, '_key', { value: g._key, enumerable: false });
  return copy;
}

export function findGaps(input) {
  const { hand, changed } = normalizeStructure(input);
  const dismissed = new Set(Array.isArray(hand[DISMISSED_KEY]) ? hand[DISMISSED_KEY] : []);
  const res = collect(hand, changed, dismissed, input);
  let out = res.out;

  /* Previews. Two answers hold up everything after them — the game, and the
     seating — and until they are given the rules downstream cannot run. So
     the rest is read on a copy with the first option taken (the game's best
     guess, the likeliest seating) and listed after, as previews: the count of
     questions ahead is right, and nothing is offered that rests on a guess. */
  if (!res.env.cfg && res.playersOk) {
    const g = provisionalGame(hand);
    if (g) {
      const copy = normalizeStructure({ ...hand, gameType: g }).hand;
      const sub = collect(copy, false, dismissed, copy);
      out = out.concat(sub.out.filter(x => !/^(game|structure|streets)$/.test(x.id)).map(asPreview));
    }
  } else if (res.env.cfg && res.heroOk && !res.positionsOk) {
    const first = out.filter(x => SEATING_IDS.test(x.id) && x.options && x.options.length)
      .sort((x, y) => compareKeys(x._key, y._key))[0];
    if (first) {
      const copy = normalizeStructure(applyOp(hand, first.options[0].value, first)).hand;
      const sub = collect(copy, false, dismissed, copy);
      if (sub.positionsOk) out = out.concat(sub.out.filter(x => INDEX_FREE.test(x.id)).map(asPreview));
    }
  }

  const kept = out.filter(g => g.blocking || !dismissed.has(g.id));
  // Stable sort by key (Array.prototype.sort is stable).
  const sorted = kept.map((g, i) => ({ g, i })).sort((a, b) => compareKeys(a.g._key, b.g._key) || a.i - b.i).map(x => x.g);
  // One gap per id: the first (most fundamental, and real before preview) wins.
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
    if (g.provisional) copy.provisional = true;
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
