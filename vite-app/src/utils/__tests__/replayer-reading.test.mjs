import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCardNotation, GAME_EVAL } from '../poker-engine.js';
import { bestFive, madeOf, streetChange, counterfeitedNow, leaderOf, lowDecider, indexOfLowRank } from '../replayer-reading.js';

const C = (s) => parseCardNotation(s);
const NLH = GAME_EVAL.NLH;
const PLO = GAME_EVAL.PLO;

test('the five that make a straight on the river', () => {
  const hole = C('9h8h'), board = C('2c7dTsKdJc');
  const r = bestFive(NLH, hole, board, 'high');
  assert.equal(r.ev.cat, 5);
  assert.deepEqual(r.hole.sort(), [0, 1]);
  assert.deepEqual(r.board.sort(), [1, 2, 4]);
});

test('Omaha plays exactly two from the hole', () => {
  const r = bestFive(PLO, C('AhAdKhKd'), C('Ac2c3c4c5c'), 'high');
  assert.equal(r.hole.length, 2);
  assert.equal(r.board.length, 3);
});

test('madeOf: a pair is its two cards, a straight all five', () => {
  assert.deepEqual(madeOf(C('KhKd7c4s2d')), [0, 1]);
  assert.deepEqual(madeOf(C('9h8h7dTsJc')), [0, 1, 2, 3, 4]);
  assert.deepEqual(madeOf(C('AhKd7c4s2d')), []);
});

test('the river that makes the straight: the five that now play', () => {
  const ch = streetChange(NLH, C('9h8h'), C('2c7dTsKd'), C('2c7dTsKdJc'));
  assert.ok(ch.made);
  assert.deepEqual(ch.made.hole.sort(), [0, 1]);
  assert.deepEqual(ch.made.board.sort(), [1, 2, 4]);
});

test('counterfeited: two pair on the board over the fives', () => {
  const board = C('KhQd2cKsQc');
  const ch = streetChange(NLH, C('5h5d'), board.slice(0, 4), board);
  assert.deepEqual(ch.counterfeit.sort(), [0, 1]);
  assert.deepEqual(counterfeitedNow(NLH, C('5h5d'), board, 5).sort(), [0, 1]);
  // Not before the river.
  assert.deepEqual(counterfeitedNow(NLH, C('5h5d'), board, 4), []);
});

test('the leader of a tabled run-out, and a tie leads nobody', () => {
  const hands = [{ seat: 1, cards: C('AhAd') }, { seat: 4, cards: C('KcKs') }];
  assert.equal(leaderOf(NLH, hands, []), 1);
  assert.equal(leaderOf(NLH, hands, C('Kh7d2c')), 4);
  assert.equal(leaderOf(NLH, [{ seat: 1, cards: C('AhKd') }, { seat: 2, cards: C('AcKs') }], C('2c7d9h')), -1);
});

test('the rank where two lows part, from the top', () => {
  const kind = 'low27';
  const a = bestFive(GAME_EVAL['2-7 Triple Draw'] || { type: 'low', lowType: '27' }, C('8h7d5c3s2d'), [], kind);
  const b = bestFive(GAME_EVAL['2-7 Triple Draw'] || { type: 'low', lowType: '27' }, C('8c7h6d3c2h'), [], kind);
  const d = lowDecider(kind, { ev: a.ev, cards: C('8h7d5c3s2d') }, { ev: b.ev, cards: C('8c7h6d3c2h') });
  assert.deepEqual(d, { a: 5, b: 6 });
  assert.equal(indexOfLowRank(kind, C('8h7d5c3s2d'), [0, 1, 2, 3, 4], 5), 2);
  // A pair against a clean low: no rank decides.
  const p = C('8h8d5c3s2d');
  assert.equal(lowDecider(kind, { ev: bestFive({ type: 'low' }, p, [], kind).ev, cards: p }, { ev: a.ev, cards: C('8h7d5c3s2d') }), null);
});

test('badugi: the card that cannot count is left out', () => {
  const r = bestFive(GAME_EVAL.Badugi || { type: 'badugi' }, C('7h7d4c2s'), [], 'badugi');
  assert.equal(r.hole.length, 3);
  assert.ok(!r.hole.includes(0) || !r.hole.includes(1));
});
