// A board card with its rank and no suit (utils/board-suit-fills.js): the boards it could be, one seat's reading
// across them, and the result line's words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boardSuitFills, readingAcross, undecidedLine } from '../board-suit-fills.js';
import { parseCardNotation } from '../poker-engine.js';

const keys = (boards) => boards.map((b) => b.map((c) => c.rank + c.suit).join(''));

test('a board with every suit has no fills', () => {
  assert.equal(boardSuitFills(parseCardNotation('Ks7s2c4dJh'), []), null);
  assert.equal(boardSuitFills([], []), null);
});

test('a suitless card takes each suit no known card holds', () => {
  const fills = boardSuitFills(parseCardNotation('Ks7s2c4dJx'), parseCardNotation('JhJdAsKs'));
  assert.deepEqual(keys(fills), ['Ks7s2c4dJc', 'Ks7s2c4dJs']);
});

test('two suitless cards of one rank never take the same suit', () => {
  const fills = boardSuitFills(parseCardNotation('2c7x7x'), parseCardNotation('7h'));
  assert.deepEqual(keys(fills), ['2c7c7d', '2c7c7s', '2c7d7c', '2c7d7s', '2c7s7c', '2c7s7d']);
});

test('no suit left for the card: no fills', () => {
  assert.equal(boardSuitFills(parseCardNotation('Jx'), parseCardNotation('JcJdJhJs')), null);
});

test('one reading on every board is the reading; different ones are joined by "or", the commonest first', () => {
  assert.equal(readingAcross(['Three of a Kind', 'Three of a Kind']), 'Three of a Kind');
  assert.equal(readingAcross(['Flush, A-high', 'Pair of Ks', 'Pair of Ks']), 'Pair of Ks or Flush, A-high');
  assert.equal(readingAcross([null, null]), null);
  assert.equal(readingAcross(['Hi: Flush\nLo: 7 low', 'Hi: Pair\nLo: 7 low']), null);
});

test('the result line names the card whose suit decides the pot', () => {
  assert.equal(undecidedLine(parseCardNotation('Ks7s2c4dJx')), "The J's suit decides this pot: Edit to add it");
  assert.equal(undecidedLine(parseCardNotation('Ks7s2cTx9x')), "The 10's and 9's suits decide this pot: Edit to add them");
  assert.equal(undecidedLine(parseCardNotation('Ks7s2c')), null);
});
