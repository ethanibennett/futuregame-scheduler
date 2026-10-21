// node --test src/utils/__tests__/multi-board.test.mjs   (from vite-app/)
// Double board and running it twice or three times (utils/poker-engine.js, owner 2026-10-20).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../poker-engine.js';

const C = (s) => s.match(/../g).map((x) => ({ rank: x[0], suit: x[1] }));
const street = (board, board2, board3) => ({ cards: { hero: '', opponents: [], board, ...(board2 ? { board2 } : {}), ...(board3 ? { board3 } : {}) } });

test('handBoards: a double board fills every street; a run shares the streets before it', () => {
  const dbl = { doubleBoard: true, streets: [street(''), street('Ah7c2d', 'KsQs3h'), street('9c', '4d'), street('Td', '5s')] };
  assert.equal(E.boardCount(dbl), 2);
  assert.deepEqual(E.handBoards(dbl), ['Ah7c2d9cTd', 'KsQs3h4d5s']);
  assert.deepEqual(E.handBoards(dbl, 1), ['Ah7c2d', 'KsQs3h']);
  // All in on the flop, run three times: the flop is shared, the turn and river differ.
  const rit = { runs: 3, streets: [street(''), street('Ah7c2d'), street('9c', 'Kd', 'Qs'), street('Td', '2c', '3s')] };
  assert.equal(E.boardCount(rit), 3);
  assert.deepEqual(E.handBoards(rit), ['Ah7c2d9cTd', 'Ah7c2dKd2c', 'Ah7c2dQs3s']);
  assert.equal(E.boardCount({ runs: 1 }), 1);
  assert.equal(E.boardCount({}), 1);
});

test('a high game: each board takes its share of every layer, odd chips to the earlier boards', () => {
  const cfg = E.gameEvalFor('PLO', {});
  // Seat 0 makes aces full on board 1; seat 1 a straight on board 2 where seat 0 has nothing.
  const bySeat = { 0: C('AsAhKdQd'), 1: C('9c8c7h6h') };
  const boards = [C('Ac2s3dTcTh'), C('6c7dTd2hKc')];   // board 2: seat 1's 9-8 makes 6 to 10
  const ev = E.multiBoardEvals(cfg, bySeat, boards);
  const shaped = E.multiBoardShaped(cfg, [{ amount: 1001, players: [0, 1] }], ev, [0, 1], false);
  assert.deepEqual(shaped.map((s) => [s.amount, s.hiWinners]), [[501, [0]], [500, [1]]]);
  const three = E.multiBoardShaped(cfg, [{ amount: 1000, players: [0, 1] }], E.multiBoardEvals(cfg, bySeat, [...boards, boards[0]]), [0, 1], false);
  assert.deepEqual(three.map((s) => s.amount), [334, 333, 333]);
  const w = E.multiBoardWinners('PLO', [{ idx: 0, cards: bySeat[0] }, { idx: 1, cards: bySeat[1] }], boards, { runs: 2 }, (i) => 'P' + i);
  assert.deepEqual(w.map((x) => [x.playerIdx, x.boards, x.split]), [[0, [1], true], [1, [2], true]]);
  assert.match(w[0].label, /P0 wins run 1/);
});

test('a hi-lo double board: one ultimate high and one ultimate low over both boards', () => {
  const cfg = E.gameEvalFor('PLO8', {});
  // Seat 0 holds the nut low on board 1 (A-2 with 3 4 8) and nothing high; seat 1 a set of kings on board 2.
  const bySeat = { 0: C('As2sJdTh'), 1: C('KcKh9c9h') };
  const boards = [C('3c4d8hQs7s'), C('KdJh5d6s9s')];
  const hand = { doubleBoard: true };
  const ev = E.multiBoardEvals(cfg, bySeat, boards);
  const shaped = E.multiBoardShaped(cfg, [{ amount: 1000, players: [0, 1] }], ev, [0, 1], E.combinesHiLo(hand));
  assert.equal(shaped.length, 1, 'one hi/lo split, not one per board');
  assert.deepEqual(shaped[0].hiWinners, [1]);
  assert.deepEqual(shaped[0].loWinners, [0]);
  const w = E.multiBoardWinners('PLO8', [{ idx: 0, cards: bySeat[0] }, { idx: 1, cards: bySeat[1] }], boards, hand, (i) => 'P' + i);
  assert.deepEqual(w.map((x) => [x.playerIdx, x.hi, x.lo]).sort(), [[0, false, true], [1, true, false]]);
});

test('a hi-lo run splits its own share hi/lo', () => {
  const cfg = E.gameEvalFor('PLO8', {});
  const bySeat = { 0: C('As2sJdTh'), 1: C('KcKh9c9h') };
  const boards = [C('3c4d8hQs7s'), C('KdJh5d6s9s')];
  const shaped = E.multiBoardShaped(cfg, [{ amount: 1000, players: [0, 1] }], E.multiBoardEvals(cfg, bySeat, boards), [0, 1], E.combinesHiLo({ runs: 2 }));
  assert.equal(shaped.length, 2);
  assert.deepEqual([shaped[0].amount, shaped[1].amount], [500, 500]);
  assert.deepEqual(shaped[0].loWinners, [0], 'board 1 has a low');
  assert.deepEqual(shaped[1].loWinners, [], 'board 2 has none: its high scoops that run');
  const { awards } = E.computePotAwards(shaped, { order: [0, 1] });
  assert.equal(awards[0] + awards[1], 1000);
});
