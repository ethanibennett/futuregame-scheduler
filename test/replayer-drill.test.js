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
const ev = require(path.join(S, 'draw-trainer', 'study', 'ev'));
const L = require(path.join(S, 'draw-trainer', 'study', 'line'));
const { makeRng, cardStr, cardFromStr } = require(path.join(S, 'engine', 'cards'));
const { priceDrillDraw, findLine, replayRealHand, priceForcedDraw, parseSeatedHist } = require('../lib/drill-study');

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
        if (draws === drawNo) return { heroSeat, start, publicLine, heroHand: st.hands[actor].slice(), legal: acts, forced, street: st.street };
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

// ── "Study this draw": a saved hand, with no seed and no real deck ──────────────────────────────
// The same hands as above, handed over as a saved hand would be: the hero's start and the cards they
// really drew, the opponent as counts. The deck behind it is gone.
function asSavedHand(r) {
  const future = r.start.deck.slice().reverse();
  const drawn = [];
  let at = 0;
  const tokens = r.publicLine.map((t) => {
    const a = String(t.action);
    const n = a.startsWith('d:') ? (a.length - 2) / 2 : /^d\d+$/.test(a) ? parseInt(a.slice(1), 10) : 0;
    const cards = future.slice(at, at + n);
    at += n;
    if (t.actor === r.heroSeat) { drawn.push(...cards); return { actor: t.actor, action: a }; }
    return { actor: t.actor, action: n || a === 'd0' ? `d${n}` : a };
  });
  return { hero: r.start.hands[r.heroSeat].slice(), heroSeat: r.heroSeat, tokens, drawn };
}

for (const gameId of ['td27', 'badugi']) {
  const ctx = setup(gameId);
  const replay = (s, pickSeed = 777) => replayRealHand({
    ...ctx, walk, play, L, cardStr, opp: null, ...s, seed: BUDGET.seed, pickSeed,
  });

  let spots = 0, refused = 0, tries = 0, worstTries = 0;
  const reasons = {};
  const started = Date.now();
  for (let seed = 5000; seed < 5400; seed += 1) {
    for (const drawNo of [0, 1, 2]) {
      const r = playTo(ctx, seed, drawNo);
      if (!r) continue;
      spots++;
      const got = replay(asSavedHand(r));
      if (got.refused) { refused++; reasons[got.refused.slice(0, 40)] = (reasons[got.refused.slice(0, 40)] || 0) + 1; continue; }
      tries += got.tries;
      worstTries = Math.max(worstTries, got.tries);
      assert.ok(sameSet(got.heroNow, r.heroHand), `${gameId} seed ${seed} draw ${drawNo}: not the real cards`);
      assert.ok(sameSet(got.at.hands[r.heroSeat], r.heroHand), `${gameId} seed ${seed} draw ${drawNo}: the engine holds other cards`);
      assert.equal(got.at.phase, 'draw', `${gameId} seed ${seed}: not at a draw`);
      assert.equal(got.at.toAct, r.heroSeat, `${gameId} seed ${seed}: not the hero's turn`);
      assert.equal(got.at.street, r.street, `${gameId} seed ${seed}: another street`);
    }
  }
  const ms = Math.round((Date.now() - started) / Math.max(1, spots));
  console.log(`${gameId} saved hands: ${spots} draws, ${refused} refused ${JSON.stringify(reasons)}, tries mean ${(tries / Math.max(1, spots - refused)).toFixed(1)} worst ${worstTries}, ${ms} ms each`);
  assert.ok(spots > 500, 'too few draws reached');
  assert.ok(refused / spots < 0.01, `${refused} of ${spots} refused`);

  // Whichever opponent and filler the search lands on, the table is the same: it cannot read them.
  let compared = 0;
  for (let seed = 5000; seed < 7000 && compared < 3; seed += 1) {
    const r = playTo(ctx, seed, 1);
    if (!r) continue;
    const s = asSavedHand(r);
    const a = replay(s, 777);
    const b = replay(s, 4321);
    if (a.refused || b.refused) continue;
    assert.notDeepEqual(a.hands[1 - r.heroSeat], b.hands[1 - r.heroSeat], 'the two searches should differ');
    const price = (x) => {
      const w = walk.walk({
        game: ctx.game, strategyMap: ctx.smap, hands: x.hands, heroSeat: r.heroSeat, hist: x.hist, seed: BUDGET.seed,
        N: BUDGET.particles, shuffles: BUDGET.shuffles, repeats: 8, evParticles: 60, rangeSeeds: 1,
        future: x.future, heroActions: [ctx.game.legalActions(x.at)[0]], onlyLast: true,
      });
      return w.tables[w.tables.length - 1].table;
    };
    const ta = price(a), tb = price(b);
    compared++;
    assert.equal(worstDiff(ta, tb), 0, `seed ${seed}: the table moved with the stand-in`);
    assert.equal(band(ta), band(tb), `seed ${seed}: the band moved with the stand-in`);
  }
  assert.ok(compared >= 2, 'too few comparisons');
  console.log(`${gameId} saved hands: ${compared} spots priced from two searches, identical`);
}

// td27's shapes a real hand takes that the engine's own play never does.
{
  const ctx = setup('td27');
  const C = (s) => s.split(/\s+/).filter(Boolean).map((c) => cardFromStr(c));
  const replay = (hero, heroSeat, hist, drawn) => replayRealHand({
    ...ctx, walk, play, L, cardStr, opp: null, hero: C(hero), heroSeat, tokens: parseSeatedHist(hist), drawn: C(drawn), seed: 777, pickSeed: 777,
  });
  const cards = (r) => r.heroNow.map(cardStr).sort().join(' ');

  // A human's line: the opponent draws 3, 2, 1, the hero breaking a nine on the way. 1:d3 is a count
  // the opponent's own hand has to allow, each time, on filler the search picks.
  let r = replay('2h 3d 4c 7s Kd', 0, '0:c 1:k 1:d3 0:d:Kd 1:k 0:k 1:d2 0:d:9c 1:b 0:c 1:d1', '9c 8h');
  assert.ok(!r.refused, r.refused);
  assert.equal(cards(r), '2h 3d 4c 7s 8h'.split(' ').sort().join(' '));
  assert.equal(r.at.street, 2);

  // The hero's stand pat on a made hand: forced, so its token goes, and the opponent's next token still
  // lands on the opponent. Seat 1 draws first, so the hero's forced node comes first.
  r = replay('2h 3d 4c 5s 7d', 1, '0:c 1:k 1:d0 0:d1 1:k 0:k', '');
  assert.ok(!r.refused, r.refused);
  assert.ok(r.line.every((t) => !(t.actor === 1 && t.action === 'd0')), 'the forced stand pats leave the line');
  assert.ok(r.forcedOpen, 'the spot is the forced node');
  assert.equal(r.at.street, 1);

  // A made hand's own draw is priced, for what breaking it is worth.
  const t = priceForcedDraw({ game: ctx.game, smap: ctx.smap, ev, play, real: r, heroSeat: 1, budget: BUDGET });
  assert.equal(t.phase, 'draw');
  assert.ok(t.rows.length > 2, 'a made hand gets every discard priced');
  assert.ok(t.rows.some((row) => row.action === 'd0' || row.action === 'd:'), 'standing pat is one of them');

  // Standing it pat moves on: the history ends in that token, so the spot is the next decision.
  r = replay('2h 3d 4c 5s 7d', 1, '0:c 1:k 1:d0 0:d1 1:k 0:k 1:d0', '');
  assert.ok(!r.refused, r.refused);
  assert.equal(r.forcedOpen, null);
  assert.notEqual(r.at.street, 1, 'still on the same draw');

  // Breaking a made hand is what the engine cannot play: it would go on with the wrong cards.
  r = replay('2h 3d 4c 5s 7d', 0, '0:c 1:k 1:d1 0:d:7d 1:k 0:k 1:d1', '9c');
  assert.match(r.refused, /breaks a made hand \(2h 3d 4c 5s 7d\)/);

  // A fifth bet: not the opponent's cards' fault, so it answers at once rather than after 1,500 hands.
  r = replay('2h 3d 4c 7s Kd', 0, '0:r 1:r 0:r 1:r 0:r', '');
  assert.match(r.refused, /not legal/);

  // The same card twice, a discard not held, replacements with no draw.
  assert.match(replay('2h 3d 4c 7s Kd', 0, '0:c 1:k 1:d1 0:d:Kd 1:k 0:k 1:d1', '2h').refused, /twice/);
  assert.match(replay('2h 3d 4c 7s Kd', 0, '0:c 1:k 1:d1 0:d:Qd 1:k 0:k 1:d1', '9c').refused, /not in hand/);
  assert.match(replay('2h 3d 4c 7s Kd', 0, '0:c 1:k 1:d1', '9c').refused, /no draw to go with them/);
  assert.equal(parseSeatedHist('c k'), null);
  assert.deepEqual(parseSeatedHist('1:d2* 0:d:KsQs'), [{ actor: 1, action: 'd2' }, { actor: 0, action: 'd:KsQs' }]);
  console.log('td27 saved hands: the human line, the forced stand pat, the break and the refusals hold');
}
console.log('replayer-drill: ok');
