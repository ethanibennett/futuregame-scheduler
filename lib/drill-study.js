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

module.exports = { priceDrillDraw, findLine };
