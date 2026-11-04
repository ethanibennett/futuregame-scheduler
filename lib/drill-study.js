'use strict';

// The replayer drill's second opinion on a draw (owner, 2026-11-03: "both, labelled"): the study
// tool prices every discard at a draw the hero actually faced, in a hand the server dealt from a
// seed, so the hero's cards in the priced spot are the real ones.
//
// Two things make this different from POST /api/solver/draw-study, which takes a hand typed in:
//
// 1. THE REAL DEAL. The tool replays both starting hands against one deck, so handing it the seed's
//    deck reproduces the hero's real replacements. Measured 10/10; `fits` still checks it on every
//    call, because a table for cards the hero did not hold would be a confident wrong answer.
//
// 2. THE PUBLIC HISTORY. The engine applies a one-option node without recording it, and a made hand
//    has one draw option, so an opponent who stood pat on a made hand leaves no token. The line here
//    is what the table saw, that stand pat included, and where the real hand cannot take it (its
//    stand pat was forced, so the token would land on the wrong seat) a stand-in that can is used. On
//    that line, different opponent hands give identical tables (0.0000), so the answer cannot depend
//    on their cards; a test holds that.
//
//    This is NOT a correction to the price. Priced on the recorded history instead, the table reads
//    differently under any one seed, but only because the sampling seed includes the decision's
//    index: over 16 seeds a side, 0 of 128 rows differed at |z| > 3, and the levels ran z -0.60 to
//    +1.69 with mixed signs. Production's belief ignores a stand pat with `drawReweight` off (the
//    default, grade.js:225), so the token changes nothing until that is turned on. For scale, the same
//    history under another seed moves its worst row by 4 to 6 chips.

const STAND_IN_TRIES = 1500;
const REPLAY_TRIES = 1500;

function sameCards(a, b) {
  const key = (h) => (h || []).slice().sort((x, y) => x - y).join(',');
  return key(a) === key(b);
}

// How many cards a line takes from the deck: 'd3' takes 3, 'd:7c9s' takes 2.
function drawnBy(publicLine) {
  let n = 0;
  for (const { action } of publicLine) {
    const a = String(action);
    if (a.startsWith('d:')) n += (a.length - 2) / 2;
    else if (/^d\d+$/.test(a)) n += parseInt(a.slice(1), 10);
  }
  return n;
}

// A pair of starting hands and a deck that replay `publicLine` to the hero's real draw, or null.
function findLine({ game, smap, walk, makeRng, start, heroSeat, publicLine, heroHand, seed }) {
  const hist = publicLine.map((s) => s.action);
  const future = start.deck.slice().reverse();
  const opp = 1 - heroSeat;

  const fits = (hands, deck) => {
    let built;
    try {
      built = walk.buildLine(game, smap, hands, [], heroSeat, { seed, hist, future: deck });
    } catch {
      return false; // this opponent cannot take the line
    }
    if (built.terminal || built.histLeft > 0) return false;
    const end = built.endState;
    if (end.phase !== 'draw' || end.toAct !== heroSeat) return false;
    if (!sameCards(end.hands[heroSeat], heroHand)) return false;
    // Every token on the seat that really played it: a forced node would shift the rest silently.
    if (built.line.length !== publicLine.length) return false;
    return built.line.every((s, i) => s.actor === publicLine[i].actor && s.action === publicLine[i].action);
  };

  const real = start.hands.map((h) => h.slice());
  if (fits(real, future)) return { hands: real, future, hist, standIn: false };

  // A stand-in comes from the cards the line never reaches (the deck deals from the front of
  // `future`, one card per card drawn), and the real opponent's cards go where it came from, so every
  // card the hero draws stays in its own place.
  const size = real[opp].length;
  const unreached = future.slice(drawnBy(publicLine));
  if (unreached.length < size) return null;
  for (let k = 0; k < STAND_IN_TRIES; k++) {
    const rng = makeRng(((seed * 13 + k) >>> 0));
    const picked = [];
    while (picked.length < size) {
      const c = unreached[Math.floor(rng() * unreached.length)];
      if (!picked.includes(c)) picked.push(c);
    }
    const deck = future.slice();
    picked.forEach((c, i) => { deck[deck.indexOf(c)] = real[opp][i]; });
    const hands = [real[0], real[1]];
    hands[opp] = picked;
    if (fits(hands, deck)) return { hands, future: deck, hist, standIn: true };
  }
  return null;
}

// -> { table } priced at the hero's draw, or { refused: reason }.
function priceDrillDraw({ game, smap, walk, makeRng, start, heroSeat, publicLine, heroHand, legal, budget }) {
  const seed = budget.seed;
  const line = findLine({ game, smap, walk, makeRng, start, heroSeat, publicLine, heroHand, seed });
  if (!line) return { refused: 'no opponent hand could take this history to your real cards' };

  let w;
  try {
    // evTable prices every action at the open node whichever one is taken, so the placeholder
    // cannot bias the answer (the same move as the study route's `now` mode).
    w = walk.walk({
      game, strategyMap: smap, hands: line.hands, heroSeat, hist: line.hist, seed,
      N: budget.particles, shuffles: budget.shuffles, repeats: 8, evParticles: 60,
      rangeSeeds: budget.rangeSeeds, future: line.future, heroActions: [legal[0]], onlyLast: true,
    });
  } catch (e) {
    return { refused: e.message };
  }
  const last = w.tables && w.tables.length ? w.tables[w.tables.length - 1] : null;
  if (!last || !last.table || last.table.error) {
    return { refused: (last && last.table && last.table.error) || 'no table came back' };
  }
  if (last.table.phase !== 'draw') return { refused: 'the table came back at a different decision' };
  return { table: last.table, standIn: line.standIn };
}

// ── THE REPLAYER'S "Study this draw": a hand someone typed in or saved, not one the server dealt ──
//
// There is no seed here, so there is no real deck: the only cards known are the hero's. So the deck is
// BUILT: the hero's real replacements go where the history will deal them, anything else is filler,
// and an opponent is sampled who can take the counts the history records (their own hand governs which
// counts are legal). `tokens` is [{ actor, action }], the opponent's draws as counts.
//
// Two engine facts the history has to be fitted to:
//  - A made hand has ONE draw option, applied unrecorded. So the hero's stand pat on a made hand drops
//    out of the line, or its token would land on the next seat. The opponent's stays in, as in the drill,
//    and needs a stand-in who had a choice.
//  - For the same reason the engine cannot play a hero who BROKE a made hand: it would stand them pat
//    and go on with the wrong cards. That refuses, by name.
//
// -> { hands, future, hist, line, heroNow, forcedOpen, tries } or { refused }. `heroNow` is null once the
// history runs past the cards we were given (the Draw Study page's play-through); until then the line
// must reach exactly those cards.
function replayRealHand({ game, smap, walk, play, L, cardStr, hero, opp, heroSeat, tokens, drawn, seed, pickSeed }) {
  const handSize = game.cfg.handSize;
  const seen = new Set();
  for (const c of [...hero, ...drawn, ...(opp || [])]) {
    if (seen.has(c)) return { refused: `${cardStr(c)} is in the hand twice` };
    seen.add(c);
  }

  // The hero's own cards, draw by draw.
  const line = [];
  let hand = hero.slice();
  let left = drawn.slice();
  let known = true;
  let tookForced = false; // the history ends with the hero standing a made hand pat: the page's play-through
  const isDrawToken = (a) => /^d(:|\d)/.test(a);
  for (const t of tokens) {
    tookForced = false;
    if (t.actor !== heroSeat || !isDrawToken(t.action)) { line.push(t); continue; }
    if (!known) { line.push(t); continue; }
    const forced = game.cfg.drawOptions(hand).length === 1;
    const explicit = play.isExplicitDiscard(t.action);
    let keep = hand;
    if (explicit) {
      try { keep = play.keepForDiscard(hand, t.action); } catch (e) { return { refused: e.message }; }
    }
    const n = explicit ? hand.length - keep.length : parseInt(t.action.slice(1), 10);
    if (forced) {
      if (n > 0) {
        return { refused: `this hand breaks a made hand (${hand.map(cardStr).join(' ')}), and the engine can only stand a made hand pat, so it cannot play on from there` };
      }
      tookForced = true;
      continue; // the engine applies this one itself
    }
    line.push(t);
    if (!n) continue;
    if (!explicit || left.length < n) {
      if (left.length) return { refused: `${left.length} replacement card(s) left over for a draw of ${n}` };
      known = false; // past what we were told: the deck deals from here on
      continue;
    }
    hand = keep.concat(left.slice(0, n));
    left = left.slice(n);
  }
  if (left.length) return { refused: `${left.length} replacement card(s) with no draw to go with them` };

  const hist = line.map((t) => t.action);
  const usedByHero = (a) => (play.isExplicitDiscard(a) ? (a.length - 2) / 2 : /^d\d+$/.test(a) ? parseInt(a.slice(1), 10) : 0);
  const known_ = [...hero, ...drawn];
  // Why the tries failed, when it was always the same reason: a fifth bet, say, is no opponent's fault.
  // It cannot be read off one error, because a stand-in's forced stand pat shifts the next token onto
  // the hero and that looks just like the hero's own illegal action.
  let why;

  for (let k = 0; k < REPLAY_TRIES; k++) {
    const shuffled = L.remainingDeck([known_, opp || []], ((pickSeed * 13 + k) >>> 0));
    const cand = opp || shuffled.slice(0, handSize);
    const filler = opp ? shuffled : shuffled.slice(handSize);

    const future = [];
    let d = 0;
    let f = 0;
    for (const t of line) {
      const n = usedByHero(t.action);
      for (let i = 0; i < n; i++) {
        future.push(t.actor === heroSeat && d < drawn.length ? drawn[d++] : filler[f++]);
      }
    }
    future.push(...filler.slice(f));

    const hands = heroSeat === 0 ? [hero.slice(), cand.slice()] : [cand.slice(), hero.slice()];
    let built;
    try {
      built = walk.buildLine(game, smap, hands, [], heroSeat, { seed, hist, future });
    } catch (e) {
      why = why === undefined || why === e.message ? e.message : null;
      continue;
    }
    why = null;
    if (built.histLeft > 0 || built.line.length < line.length) continue;
    if (!line.every((t, i) => built.line[i].actor === t.actor && built.line[i].action === t.action)) continue;
    const forcedOpen = tookForced ? null : ((built.forcedHeroDraws || []).find((x) => x.gradeIdx === line.length) || null);
    const at = forcedOpen ? forcedOpen.state : built.endState;
    if (known && !sameCards(at.hands[heroSeat], hand)) continue;
    return { hands, future, hist, line, heroNow: known ? hand : null, forcedOpen, at, tries: k + 1 };
  }
  return { refused: why || 'no opponent hand could take the draws this history records' };
}

// The table at a made hand's draw, which is forced and so not a decision the record holds: what breaking
// it is worth. The belief is walked to that node, unclamped (walk.js has why).
function priceForcedDraw({ game, smap, ev, play, real, heroSeat, budget }) {
  const built = { line: real.line };
  const rec = play.buildHandRecord({ hands: real.hands.map((h) => h.slice()), future: real.future }, built.line, { game, heroSeat });
  return ev.evTable({
    game, strategyMap: smap, rec, gradeIdx: real.forcedOpen.gradeIdx, state: real.forcedOpen.state, heroSeat,
    N: budget.particles, shuffles: budget.shuffles, repeats: 8, evParticles: 60, rangeSeeds: budget.rangeSeeds, seed: budget.seed,
  });
}

// "1:k 0:b* 1:d2" -> [{ actor, action }], or null if a token has no seat. The `*` is the page's mark for
// an action the blueprint guessed; parseHist counts those.
function parseSeatedHist(str) {
  const out = [];
  for (const raw of String(str || '').split(/\s+/)) {
    if (!raw) continue;
    const m = raw.match(/^([01]):(.+?)\*?$/);
    if (!m) return null;
    out.push({ actor: Number(m[1]), action: m[2] });
  }
  return out;
}

module.exports = { priceDrillDraw, findLine, replayRealHand, priceForcedDraw, parseSeatedHist };
