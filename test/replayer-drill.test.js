'use strict';
// npm run test:replayer-drill. The study tool's price for a draw the hero really faced, on real seeded
// hands against the real solver (it needs ./solver; a worktree without the junction skips).
//   - the line reaches the hero's REAL cards, every time it answers
//   - the answer holds still when the opponent's cards change: no hindsight
//   - it refuses rarely, and says so rather than pricing other cards
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const S = path.join(__dirname, '..', 'solver');
if (!fs.existsSync(path.join(S, 'draw-trainer', 'study', 'walk.js'))) {
  console.log('replayer-drill: no ./solver here, skipped');
  process.exit(0);
}
const { GAMES } = require(path.join(S, 'games'));
const play = require(path.join(S, 'draw-trainer', 'play'));
const walk = require(path.join(S, 'draw-trainer', 'study', 'walk'));
const lbr = require(path.join(S, 'lbr-draw'));
const { makeRng, cardStr } = require(path.join(S, 'engine', 'cards'));
const { priceDrillDraw, findLine } = require('../lib/drill-study');

const BUDGET = { shuffles: 4, particles: 120, rangeSeeds: 1, seed: 777 };

function setup(gameId) {
  const game = GAMES[gameId];
  lbr.memoizeCfg(game);
  const smap = play.strategyMapOf(JSON.parse(fs.readFileSync(path.join(S, 'strategies', `${gameId}.json`), 'utf8')));
  return { game, smap };
}

// server.js replayDraw's loop, hero throwing one card. Stops at the hero's `drawNo`th real draw.
function playTo({ game, smap }, seed, drawNo) {
  const heroSeat = seed & 1;
  const rng = makeRng(seed >>> 0);
  let st = game.newHand(rng);
  const start = { hands: st.hands.map((h) => h.slice()), deck: st.deck.slice() };
  const publicLine = [];
  let draws = 0;
  let forced = 0;
  for (let guard = 0; !game.isTerminal(st) && guard < 500; guard++) {
    if (game.isChance(st)) { st = game.sampleChance(st, rng); continue; }
    const acts = game.legalActions(st);
    const actor = game.currentPlayer(st);
    if (acts.length <= 1) {
      if (st.phase === 'draw' && actor !== heroSeat) { publicLine.push({ actor, action: acts[0] }); forced++; }
      st = game.applyAction(st, acts[0]);
      continue;
    }
    let chosen;
    if (actor === heroSeat) {
      if (st.phase === 'draw') {
        if (draws === drawNo) return { heroSeat, start, publicLine, heroHand: st.hands[actor].slice(), legal: acts, forced };
        draws++;
        // Stand pat, throw one or throw two, in turn, so the deck moves in each way.
        const count = (seed + draws) % 3;
        chosen = 'd:' + st.hands[actor].slice().sort((x, y) => x - y).slice(-count || st.hands[actor].length, count ? undefined : 0).map(cardStr).join('');
        publicLine.push({ actor, action: chosen });
        st = game.applyDraw(st, play.keepForDiscard(st.hands[actor], chosen));
        continue;
      }
      chosen = acts.includes('c') ? 'c' : acts.includes('k') ? 'k' : acts[0];
    } else {
      chosen = acts[play.sampleIndex(play.strategyFor(smap, game.infosetKey(st), acts).probs, rng)];
    }
    publicLine.push({ actor, action: chosen });
    st = game.applyAction(st, chosen);
  }
  return null;
}

const sameSet = (a, b) => a.slice().sort().join() === b.slice().sort().join();
const worstDiff = (A, B) => {
  const a = new Map(A.rows.map((r) => [r.action, r.ev]));
  let w = 0;
  for (const r of B.rows) w = Math.max(w, Math.abs(r.ev - a.get(r.action)));
  return w;
};
const band = (t) => t.rows.filter((r) => r.tied).map((r) => r.action).sort().join();

for (const gameId of ['td27', 'badugi']) {
  const ctx = setup(gameId);
  const args = (r) => ({ ...ctx, walk, makeRng, ...r, budget: BUDGET });

  // How often is a line found, and does it reach the real cards?
  let spots = 0, forcedSpots = 0, standIns = 0, refused = 0;
  for (let seed = 1000; seed < 1400; seed += 1) {
    for (const drawNo of [0, 1, 2]) {
      const r = playTo(ctx, seed, drawNo);
      if (!r) continue;
      spots++;
      if (r.forced) forcedSpots++;
      const line = findLine({ ...args(r), seed: BUDGET.seed });
      if (!line) { refused++; continue; }
      if (line.standIn) standIns++;
      const b = walk.buildLine(ctx.game, ctx.smap, line.hands, [], r.heroSeat, { seed: BUDGET.seed, hist: line.hist, future: line.future });
      assert.ok(sameSet(b.endState.hands[r.heroSeat], r.heroHand), `${gameId} seed ${seed} draw ${drawNo}: other cards`);
    }
  }
  console.log(`${gameId}: ${spots} draws, ${forcedSpots} after a forced stand pat, ${standIns} used a stand-in, ${refused} refused`);
  assert.ok(spots > 500, 'too few draws reached');
  assert.ok(refused / spots < 0.01, `${refused} of ${spots} refused`);

  // The answer depends on what the table saw, not on the opponent's cards.
  // Alternating spots with a forced stand pat and without, where the game has any (badugi has none).
  let compared = 0;
  for (let seed = 1000; seed < 3000 && compared < 4; seed += 1) {
    const r = playTo(ctx, seed, 1);
    if (!r || (forcedSpots > 0 && (compared % 2 === 0) !== (r.forced > 0))) continue;
    const a = priceDrillDraw(args(r));
    assert.ok(a.table, `seed ${seed}: ${a.refused}`);
    // The same spot with a different real opponent: a hand from cards the line never reaches.
    const opp = 1 - r.heroSeat;
    let b = null;
    const future = r.start.deck.slice().reverse();
    for (let k = 0; k < 400 && !b; k++) {
      const rng = makeRng(seed * 101 + k);
      const pool = future.slice(30);
      const picked = [];
      while (picked.length < r.start.hands[opp].length) {
        const c = pool[Math.floor(rng() * pool.length)];
        if (!picked.includes(c)) picked.push(c);
      }
      const f2 = future.slice();
      picked.forEach((c, i) => { f2[f2.indexOf(c)] = r.start.hands[opp][i]; });
      const hands = r.start.hands.map((h) => h.slice());
      hands[opp] = picked;
      const start2 = { hands, deck: f2.slice().reverse() };
      const t = priceDrillDraw(args({ ...r, start: start2 }));
      if (t.table) b = t;
    }
    if (!b) continue;
    compared++;
    assert.equal(worstDiff(a.table, b.table), 0, `seed ${seed}: the table moved with the opponent's cards`);
    assert.equal(band(a.table), band(b.table), `seed ${seed}: the band moved with the opponent's cards`);
  }
  assert.ok(compared >= 2, 'too few comparisons');
  console.log(`${gameId}: ${compared} spots priced against two opponents, identical`);
}
console.log('replayer-drill: ok');
