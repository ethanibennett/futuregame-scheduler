/**
 * What a hi-lo pot actually pays each player.
 *
 * The replayer used to divide a split pot by the NUMBER of winners, which is
 * only ever right when every winner takes an equal share. The moment one player
 * wins a half outright and ties the other he is owed three quarters and his
 * opponent one — the case this file exists to hold down, along with the two it
 * drags in: side pot layers settle independently (the player who won the main
 * pot's high may not even be in the side pot), and no chip may be created or
 * destroyed by any of the rounding.
 *
 * Every case asserts the exact per-seat award AND that the awards plus anything
 * reported unassigned sum to the pot.
 *
 * Run: node test/hilo-split-awards.mjs
 */

import { readFileSync } from 'node:fs';
import {
  computePotAwards, hiLoWinnersAmong, potLayerWinners, reconcileLayersToPot,
  seatOrderFromButton, evaluateShowdown, parseCardNotation, GAME_EVAL,
  bestOmahaHigh, bestOmahaLow, bestHighHand, bestLowA5Hand,
} from '../vite-app/src/utils/poker-engine.js';

const BTN_ORDER = seatOrderFromButton(4, 0); // 4-handed, button on seat 0 -> [1,2,3,0]

const CASES = [
  // ── the whole pot ───────────────────────────────────────────────────────
  {
    name: 'high scoops (no qualifying low)',
    layers: [{ amount: 100, hiWinners: [0], loWinners: [] }],
    expect: { 0: 100 },
  },
  {
    name: 'two-way tie for high, no low',
    layers: [{ amount: 100, hiWinners: [0, 1], loWinners: [] }],
    expect: { 0: 50, 1: 50 },
  },
  // ── clean halves ────────────────────────────────────────────────────────
  {
    name: 'clean half/half between two players',
    layers: [{ amount: 100, hiWinners: [0], loWinners: [1] }],
    expect: { 0: 50, 1: 50 },
  },
  {
    name: 'one player takes both halves (scoop with a low)',
    layers: [{ amount: 100, hiWinners: [0], loWinners: [0] }],
    expect: { 0: 100 },
  },
  // ── quartering ──────────────────────────────────────────────────────────
  {
    name: 'wins high, ties low -> 3/4 and 1/4',
    layers: [{ amount: 100, hiWinners: [0], loWinners: [0, 1] }],
    expect: { 0: 75, 1: 25 },
  },
  {
    name: 'wins low, ties high -> 3/4 and 1/4',
    layers: [{ amount: 100, hiWinners: [0, 1], loWinners: [0] }],
    expect: { 0: 75, 1: 25 },
  },
  {
    name: 'three-way tie for low, one high winner -> 1/2, 1/6, 1/6, 1/6',
    layers: [{ amount: 600, hiWinners: [0], loWinners: [1, 2, 3] }],
    expect: { 0: 300, 1: 100, 2: 100, 3: 100 },
  },
  {
    name: 'high winner is one of three tied lows -> 1/2 + 1/6',
    layers: [{ amount: 600, hiWinners: [0], loWinners: [0, 2, 3] }],
    expect: { 0: 400, 2: 100, 3: 100 },
  },
  {
    name: 'both halves tied two ways -> half each, nobody quartered',
    layers: [{ amount: 100, hiWinners: [0, 1], loWinners: [0, 1] }],
    expect: { 0: 50, 1: 50 },
  },
  // ── odd chips ───────────────────────────────────────────────────────────
  // Convention: the odd chip from halving goes to the HIGH half; odd chips
  // inside a half go one at a time clockwise from the button (here seat 1 first).
  {
    name: 'odd pot halves: the extra chip goes to the high half',
    layers: [{ amount: 101, hiWinners: [0], loWinners: [1] }],
    expect: { 0: 51, 1: 50 },
  },
  {
    name: 'odd chips inside the low half pay clockwise from the button',
    layers: [{ amount: 101, hiWinners: [0], loWinners: [1, 2, 3] }],
    // high half 51 to seat 0; low half 50 over three -> 17/17/16, seats 1,2 first
    expect: { 0: 51, 1: 17, 2: 17, 3: 16 },
  },
  {
    name: 'odd chip on a plain high chop pays clockwise from the button',
    layers: [{ amount: 5, hiWinners: [3, 2], loWinners: [] }],
    expect: { 2: 3, 3: 2 },
  },
  {
    name: 'quartered with an odd chip: 100 + 1',
    layers: [{ amount: 101, hiWinners: [0], loWinners: [0, 1] }],
    // high half 51 to seat 0; low half 50 -> 25 each, odd none
    expect: { 0: 76, 1: 25 },
  },
  // ── side pot layers ─────────────────────────────────────────────────────
  {
    name: 'side pot: each layer quarters on its own eligible players',
    // main pot 300 (seats 0,1,2), side pot 200 (seats 0,1).
    // seat 2 wins the main pot's high; 0 and 1 tie the low everywhere;
    // seat 1 wins the side pot's high because seat 2 is not in it.
    layers: [
      { amount: 300, hiWinners: [2], loWinners: [0, 1] },
      { amount: 200, hiWinners: [1], loWinners: [0, 1] },
    ],
    expect: { 0: 125, 1: 225, 2: 150 },
  },
  {
    name: 'side pot: the short stack scoops the main, the side is quartered',
    layers: [
      { amount: 300, hiWinners: [2], loWinners: [2] },
      { amount: 200, hiWinners: [0], loWinners: [0, 1] },
    ],
    expect: { 0: 150, 1: 50, 2: 300 },
  },
  {
    name: 'no winner eligible for a layer: chips are reported, not lost',
    layers: [
      { amount: 300, hiWinners: [0], loWinners: [1] },
      { amount: 200, hiWinners: [], loWinners: [] },
    ],
    expect: { 0: 150, 1: 150 },
    expectUnassigned: 200,
  },
];

// ── layer building from stored winner entries (mucked / hand-marked hands) ──
const LAYER_CASES = [
  {
    name: 'entries: hi+lo flags drive the halves on a single pot',
    layers: [{ amount: 100 }],
    winners: [{ playerIdx: 0, split: true, hi: true, lo: true }, { playerIdx: 1, split: true, hi: false, lo: true }],
    expect: { 0: 75, 1: 25 },
  },
  {
    name: 'entries: unflagged winners (a hand-marked split) share evenly',
    layers: [{ amount: 100 }],
    winners: [{ playerIdx: 0, split: true }, { playerIdx: 1, split: true }],
    expect: { 0: 50, 1: 50 },
  },
  {
    name: 'entries: a winner not eligible for the side pot is left out of it',
    layers: [
      { amount: 300, players: [0, 1, 2] },
      { amount: 200, players: [0, 1] },
    ],
    winners: [{ playerIdx: 2, split: true, hi: true, lo: false }, { playerIdx: 0, split: true, hi: false, lo: true }],
    // main: 150 high to seat 2, 150 low to seat 0. side: seat 2 ineligible, so
    // the only eligible winner (the low) takes the layer.
    expect: { 0: 350, 2: 150 },
  },
];

// ── end to end from real cards: evaluateShowdown -> layers -> awards ────────
const CARD_CASES = [
  {
    name: 'O8 end to end: no low on the board, the high scoops',
    game: 'O8',
    board: 'Kd9d8sKhQc'.match(/../g).join(''),
    hands: { 0: 'AsKsKc2h', 1: 'Ad2d3c7h' },
    pot: 400,
    // board 8,9,Q,K,K has only one card 8-or-better, so no low can be made
    expect: { 0: 400 },
  },
  {
    name: 'O8 end to end: wins high, ties low -> quartered 300/100',
    game: 'O8',
    board: '5h8s4cKd9d',
    hands: { 0: 'AsKsKc2h', 1: 'Ad2d3c7h' },
    pot: 400,
    // both hold A2 for the nut low 8-5-4-2-A; seat 0's trip kings win the high
    expect: { 0: 300, 1: 100 },
  },
  {
    name: 'O8 end to end: high and low in different hands -> clean 200/200',
    game: 'O8',
    board: '5h8s4cKd9d',
    hands: { 0: 'KsKc9sTh', 1: 'Ad2d3c7h' },
    pot: 400,
    expect: { 0: 200, 1: 200 },
  },
];

// ── runner ─────────────────────────────────────────────────────────────────
const rows = [];
let failed = 0;

function check(name, layersForSum, awards, unassigned, expect, expectUnassigned) {
  const pot = layersForSum.reduce((s, l) => s + l.amount, 0);
  const got = {};
  Object.keys(awards).forEach(k => { if (awards[k]) got[k] = awards[k]; });
  const want = {};
  Object.keys(expect).forEach(k => { if (expect[k]) want[k] = expect[k]; });
  const paid = Object.values(got).reduce((s, v) => s + v, 0);
  const conserved = paid + unassigned === pot;
  const matched = JSON.stringify(got) === JSON.stringify(want)
    && unassigned === (expectUnassigned || 0);
  const ok = matched && conserved;
  if (!ok) failed++;
  rows.push({
    ok,
    name,
    pot,
    got: JSON.stringify(got) + (unassigned ? ' +' + unassigned + ' unassigned' : ''),
    want: JSON.stringify(want) + (expectUnassigned ? ' +' + expectUnassigned + ' unassigned' : ''),
    sum: paid + unassigned + '/' + pot + (conserved ? '' : ' CHIPS LOST'),
  });
}

for (const c of CASES) {
  const { awards, unassigned } = computePotAwards(c.layers, { order: BTN_ORDER });
  check(c.name, c.layers, awards, unassigned, c.expect, c.expectUnassigned);
}

for (const c of LAYER_CASES) {
  const layers = potLayerWinners(c.layers, c.winners);
  const { awards, unassigned } = computePotAwards(layers, { order: BTN_ORDER });
  check(c.name, c.layers, awards, unassigned, c.expect, c.expectUnassigned);
}

for (const c of CARD_CASES) {
  const board = parseCardNotation(c.board);
  const seats = Object.keys(c.hands).map(Number);
  const playerHands = seats.map(idx => ({ idx, cards: parseCardNotation(c.hands[idx]) }));
  const winners = evaluateShowdown(c.game, playerHands, board);
  const layers = potLayerWinners([{ amount: c.pot, players: seats }], winners);
  const { awards, unassigned } = computePotAwards(layers, { order: seatOrderFromButton(seats.length, 0) });
  check(c.name, [{ amount: c.pot }], awards, unassigned, c.expect, c.expectUnassigned);
}

// hiLoWinnersAmong is what re-decides each layer from the cards, so prove it
// picks a different high for a side pot the main pot's winner is not in.
{
  const evals = { 0: { hi: 5, lo: 10 }, 1: { hi: 7, lo: 10 }, 2: { hi: 9, lo: null } };
  const main = hiLoWinnersAmong(evals, [0, 1, 2]);
  const side = hiLoWinnersAmong(evals, [0, 1]);
  const layers = [
    { amount: 300, ...main },
    { amount: 200, ...side },
  ];
  const { awards, unassigned } = computePotAwards(layers, { order: BTN_ORDER });
  check('hiLoWinnersAmong re-decides the side pot high', layers, awards, unassigned,
    { 0: 125, 1: 225, 2: 150 });
}

// The replayer's layers are built from wagers only, so antes and blinds are
// missing from them; reconciling puts that dead money in the main pot and the
// awards then have to add up to the pot the felt is showing.
{
  const raw = [{ amount: 300, players: [0, 1, 2] }, { amount: 200, players: [0, 1] }];
  const layers = reconcileLayersToPot(raw, 560, [0, 1, 2]); // 60 of antes/blinds
  const shaped = [
    { amount: layers[0].amount, hiWinners: [2], loWinners: [0, 1] },
    { amount: layers[1].amount, hiWinners: [1], loWinners: [0, 1] },
  ];
  const { awards, unassigned } = computePotAwards(shaped, { order: BTN_ORDER });
  // main 360: 180 high to seat 2, 90/90 low. side 200: 100 high to 1, 50/50 low.
  check('dead money reconciles into the main pot', [{ amount: 560 }], awards, unassigned,
    { 0: 140, 1: 240, 2: 180 });
}
{
  const layers = reconcileLayersToPot([{ amount: 300, players: [0, 1] }], 400, [0, 1]);
  const shaped = [{ amount: layers[0].amount, hiWinners: [0], loWinners: [0, 1] }];
  const { awards, unassigned } = computePotAwards(shaped, { order: BTN_ORDER });
  check('single layer settles the whole pot, not just the wagers', [{ amount: 400 }],
    awards, unassigned, { 0: 300, 1: 100 });
}
{
  // Layers that over-count the pot cannot be trusted: settle it as one pot.
  const layers = reconcileLayersToPot([{ amount: 400, players: [0, 1] }, { amount: 400, players: [0, 1] }], 500, [0, 1]);
  const shaped = layers.map(l => ({ amount: l.amount, hiWinners: [0], loWinners: [1] }));
  const { awards, unassigned } = computePotAwards(shaped, { order: BTN_ORDER });
  check('layers that over-count fall back to one pot', [{ amount: 500 }], awards, unassigned,
    { 0: 250, 1: 250 });
}

/* The replayer's own wiring, lifted out of the JSX and run.
   The maths above can be right while the component feeds it the wrong thing,
   so these run the ACTUAL bodies of the flaggedWinners and potAwards memos —
   sliced out of HandReplayerView.jsx by their opening and closing lines — over
   a hi-lo hand. If either memo is rewritten, this stops finding its markers and
   fails loudly rather than quietly testing nothing. */
{
  const src = readFileSync(new URL('../vite-app/src/components/HandReplayerView.jsx', import.meta.url), 'utf8');
  const slice = (open, close) => {
    const a = src.indexOf(open);
    if (a < 0) throw new Error('marker not found in HandReplayerView.jsx: ' + open);
    const b = src.indexOf(close, a);
    if (b < 0) throw new Error('closing marker not found: ' + close);
    return src.slice(a + open.length, b);
  };
  const flagWinners = new Function('hand',
    'return ' + slice('const flaggedWinners = useMemo(() => ', ', [hand]);'));
  const potAwardsOf = new Function(
    'showResult', 'flaggedWinners', 'hand', 'allPotLayers', 'pot', 'folded', 'category',
    'boardCards', 'heroCards', 'opponentCards', 'replayHeroIdx', 'gameCfg',
    'GAME_EVAL', 'parseCardNotation', 'bestOmahaHigh', 'bestOmahaLow', 'bestHighHand',
    'bestLowA5Hand', 'hiLoWinnersAmong', 'potLayerWinners', 'computePotAwards',
    'reconcileLayersToPot', 'seatOrderFromButton',
    slice('const potAwards = useMemo(() => {', '\n  }, [showResult, flaggedWinners'));

  const run = (winners, layers, pot) => {
    const hand = {
      gameType: 'O8',
      players: [{ position: 'BTN' }, { position: 'BB' }],
      result: { winners },
    };
    const awards = potAwardsOf(
      true, flagWinners(hand), hand, layers, pot, new Set(), 'community',
      '5h8s4cKd9d', 'AsKsKc2h', [undefined, 'Ad2d3c7h'], 0, { heroCards: 4, isStud: false },
      GAME_EVAL, parseCardNotation, bestOmahaHigh, bestOmahaLow, bestHighHand,
      bestLowA5Hand, hiLoWinnersAmong, potLayerWinners, computePotAwards,
      reconcileLayersToPot, seatOrderFromButton);
    return awards || {};
  };

  // Seat 0 has trip kings and the nut low; seat 1 ties that low with A2.
  const evaluated = evaluateShowdown('O8',
    [{ idx: 0, cards: parseCardNotation('AsKsKc2h') }, { idx: 1, cards: parseCardNotation('Ad2d3c7h') }],
    parseCardNotation('5h8s4cKd9d'));

  check('replayer memo: freshly evaluated hi-lo hand is quartered',
    [{ amount: 400 }], run(evaluated, [{ amount: 400, players: [0, 1] }], 400), 0, { 0: 300, 1: 100 });

  check('replayer memo: a hand saved with only Hi:/Lo: labels is quartered too',
    [{ amount: 400 }], run([
      { playerIdx: 0, split: true, label: 'Hero wins Hi: Three Kings, Lo: 8-5-4-2-A' },
      { playerIdx: 1, split: true, label: 'P2 wins Lo: 8-5-4-2-A' },
    ], [{ amount: 400, players: [0, 1] }], 400), 0, { 0: 300, 1: 100 });

  check('replayer memo: a hand-marked split stays an even split',
    [{ amount: 400 }], run([{ playerIdx: 0, split: true }, { playerIdx: 1, split: true }],
      [{ amount: 400, players: [0, 1] }], 400), 0, { 0: 200, 1: 200 });

  check('replayer memo: antes outside the wager layers still get paid out',
    [{ amount: 440 }], run(evaluated, [{ amount: 400, players: [0, 1] }], 440), 0, { 0: 330, 1: 110 });
}

const w = arr => Math.max(...arr.map(s => s.length));
const cols = [
  ['', rows.map(r => (r.ok ? 'PASS' : 'FAIL'))],
  ['case', rows.map(r => r.name)],
  ['pot', rows.map(r => String(r.pot))],
  ['awarded', rows.map(r => r.got)],
  ['expected', rows.map(r => r.want)],
  ['sum', rows.map(r => r.sum)],
];
const widths = cols.map(([h, vals]) => Math.max(h.length, w(vals)));
const line = cells => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
console.log(line(cols.map(c => c[0])));
console.log(widths.map(n => '-'.repeat(n)).join('  '));
rows.forEach((_, i) => console.log(line(cols.map(c => c[1][i]))));
console.log('\n' + (rows.length - failed) + '/' + rows.length + ' passed');
if (failed) process.exit(1);
