// node --test src/utils/__tests__/hidden-games.test.mjs   (from vite-app/)
//
// The games with two different hands in one pot, held to hands that tell each rule apart. Rules and
// their sources: docs/replayer-hidden-games.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCardNotation as P, GAME_EVAL, evaluateShowdown, scoreHalves, halvesWinnersAmong, pipTotal, blackjackTotal,
  bestOmajack, computePotAwards, halvesHandName, oddChipToLo,
} from '../poker-engine.js';

globalThis.localStorage = globalThis.localStorage || { getItem() { return null; }, setItem() {} };
const { HAND_CONFIG } = await import('../utils.js');
const { GAME_CODES } = await import('../hand-shorthand.js');
const { buildCatalog, gameTypeOf, variantName } = await import('../variant-catalog.js');

/* Who took what, heads up: [[seat, 'hi'], [seat, 'lo']] for each half won, 'chop' when nobody could win either. */
function halves(game, hero, opp, board = '') {
  const w = evaluateShowdown(game, [{ idx: 0, cards: P(hero) }, { idx: 1, cards: P(opp) }], P(board));
  const won = w.flatMap((x) => [x.hi ? [x.playerIdx, 'hi'] : null, x.lo ? [x.playerIdx, 'lo'] : null]).filter(Boolean);
  return won.length ? won : (w.length === 2 ? 'chop' : []);
}
const SPLIT = [[0, 'hi'], [1, 'lo']];         // hero half A, the opponent half B

test('points: J Q K are nothing, an ace one, a ten ten', () => {
  assert.equal(pipTotal(P('TsTdThTc9s')), 49);
  assert.equal(pipTotal(P('KsQdJhAc2s')), 3);
});

test('blackjack: an ace is 1 or 11, tens and faces 10, over 21 is a bust', () => {
  assert.equal(blackjackTotal(P('AsKdTh')), 21);
  assert.equal(blackjackTotal(P('Ks9d2h')), 21);
  assert.equal(blackjackTotal(P('AsAd9h')), 21);
  assert.equal(blackjackTotal(P('As5d4h')), 20);
  assert.equal(blackjackTotal(P('KsQd5h')), null);
});

test('Razzdugi: the razz hand and the badugi split the pot, the ace low in both', () => {
  // Hero's wheel in two suits is the razz nut and a poor badugi; the opponent's seven low holds a real one.
  assert.deepEqual(halves('Razzdugi', 'AsKs2s3s4c5c9c', '2h3d4c7s8h9dTc'), SPLIT);
});

test('Razzdeucy: the ace is high and straights count against, where Razzdugi disagrees', () => {
  const wheel = 'AsAd2s3s4s5c9c', sevenLow = '2h3d4h5h7cKcKh';
  const h = (g) => scoreHalves(GAME_EVAL[g], P(wheel), []), o = (g) => scoreHalves(GAME_EVAL[g], P(sevenLow), []);
  assert.ok(o('Razzdeucy').hi > h('Razzdeucy').hi, '2-7: the seven low wins');
  assert.ok(h('Razzdugi').hi > o('Razzdugi').hi, 'A-5: the wheel wins');
});

test('Archie 99 and 66: the qualifiers', () => {
  const eightLow = '8c5d4h3s2h', sevens = '7s7d6h4c3c', nines = '9s9dKhQc2c', sixes = '6s6dKhQc2c';
  // Both qualify: aces up against the seven low.
  assert.deepEqual(halves('Archie 99', 'AsAdKcKh2c', '7c5d4h3s2h'), SPLIT);
  // A pair of nines qualifies in 99 and sevens does not; a lone low scoops.
  assert.deepEqual(halves('Archie 99', sevens, eightLow), [[1, 'lo']]);
  assert.deepEqual(halves('Archie 99', nines, eightLow), SPLIT);
  // A pair of sixes qualifies in 66 and not in 99.
  assert.deepEqual(halves('Archie 66', sixes, eightLow), SPLIT);
  assert.deepEqual(halves('Archie 99', sixes, eightLow), [[1, 'lo']]);
  // A qualifying high against one that does not: the qualifier takes it all.
  assert.deepEqual(halves('Archie 99', nines, sevens), [[0, 'hi']]);
});

test('Archie: nobody qualifies, the pot is shared among those who showed', () => {
  const a = 'KsQd9h7c3c', b = 'KhJd9s7d4c';
  assert.equal(halves('Archie 99', a, b), 'chop');
  const cfg = GAME_EVAL['Archie 99'];
  const scored = { 0: scoreHalves(cfg, P(a), []), 1: scoreHalves(cfg, P(b), []) };
  const { awards } = computePotAwards([{ amount: 1000, ...halvesWinnersAmong(cfg, scored, [0, 1]) }], { order: [0, 1] });
  assert.deepEqual(awards, { 0: 500, 1: 500 });
});

test('Ari: the community card plays for the high only', () => {
  const cfg = GAME_EVAL.Ari;
  // A-2-3-4-K with a community 5: a wheel for high, and no low, because the low is the five hole cards.
  const s = scoreHalves(cfg, P('As2d3h4cKs'), P('5d'));
  assert.equal(s.hiEv.name, 'Wheel');
  assert.equal(s.lo, null);
  // The card makes the qualifying pair the hole cards alone do not hold.
  assert.equal(scoreHalves(cfg, P('9sKdQh7c3c'), P('9d')).hiEv.name, 'Pair of Nines');
  assert.equal(scoreHalves(cfg, P('9sKdQh7c3c'), []).hi, null);
  assert.deepEqual(halves('Ari', '9sKdQh7c3c', 'KsJd8h6c4d', '9d'), [[0, 'hi']]);
});

test('Dramaha: Omaha on the board, the draw half from the five hole cards alone', () => {
  const board = 'Ah7d2c9s4c';
  // Hero's aces make a set on the board; the opponent's three kings are only a pair of them in Omaha, but
  // trips against a pair for the five-card draw.
  assert.deepEqual(halves('Dramaha Hi', 'AsAd8h6c3s', 'KsKdKh5c6d', board), SPLIT);
});

test('Dramaha 2-7, 49, Zero and Dramadugi each judge the draw half their own way', () => {
  const board = 'KhQdJc9s2d';
  const low = '2c3d4h5s7c', tens = 'TsThTdTc9c';
  const draw = (g, h) => scoreHalves(GAME_EVAL[g], P(h), P(board)).lo;
  assert.ok(draw('Dramaha 2-7', low) < draw('Dramaha 2-7', tens), '2-7: the seven low');
  assert.ok(draw('Dramaha 49', tens) < draw('Dramaha 49', low), '49: the most points');
  assert.ok(draw('Dramaha 0', low) < draw('Dramaha 0', tens), 'Zero: the fewest points');
  assert.equal(scoreHalves(GAME_EVAL['Dramaha 49'], P(tens), P(board)).loEv.name, '49');
  assert.ok(draw('Dramadugi', 'As2d3h4cKs') < draw('Dramadugi', '3s5s7s9sJh'), 'four suits beat one');
  // And Dramaha Hi's draw half is the opposite of 2-7's.
  assert.ok(draw('Dramaha Hi', tens) < draw('Dramaha Hi', low));
});

test('Omajack: the blackjack hand is what the best Omaha hand leaves', () => {
  const board = 'Ah7d2c9s4c';
  const o = bestOmajack(P('AsAdKhTc5c'), P(board));
  assert.equal(o.omaha.name, 'Three Aces');
  assert.equal(o.total, null, 'K T 5 is 25: the aces went to the Omaha hand, so it busts');
  assert.equal(scoreHalves(GAME_EVAL.Omajack, P('AsAdKhTc5c'), P(board)).lo, null, 'a bust cannot win the half');
  // Everyone busts: Omaha scoops.
  assert.deepEqual(halves('Omajack', 'AsAdKhTc5c', 'KsKdQhJc6c', board), [[0, 'hi']]);
  // The opponent's lesser Omaha hand leaves 21, which takes the other half.
  assert.deepEqual(halves('Omajack', 'AsAdKhTc5c', '9d9hKdQsAc', board), SPLIT);
});

test('Omajack: of two pairs making the same Omaha hand, the better blackjack stands', () => {
  // J-7 and 7-8 both make the jack-high straight on this board. J-7 leaves 8-2-3 (13), 7-8 leaves J-2-3 (15).
  const o = bestOmajack(P('Js7h8d2s3s'), P('8c9dTcJd2h'));
  assert.equal(o.omaha.name, 'Straight, Jack-high');
  assert.equal(o.total, 15);
});

test('Stud Hi/Lo Regular: any low plays', () => {
  const noEight = 'Kd9h7s6c4d3hJc', fullHouse = 'AhAdAsKhKdKsQc';
  assert.deepEqual(halves('Stud Regular', fullHouse, noEight), SPLIT);
  assert.deepEqual(halves('Stud 8', fullHouse, noEight), [[0, 'hi']]);
});

test('a hand is named once', () => {
  const cfg = GAME_EVAL.Razzdugi;
  const s = scoreHalves(cfg, P('2h3d7s8cThJdQh'), []);
  assert.equal(halvesHandName(cfg, s, false, true, true), 'Badugi: 8 7 3 2');
});

test('an odd chip goes to the high half unless the layer says otherwise', () => {
  const r = computePotAwards([{ amount: 101, hiWinners: [0], loWinners: [1] }], { order: [0, 1] });
  assert.deepEqual(r.awards, { 0: 51, 1: 50 });
  const lo = computePotAwards([{ amount: 101, hiWinners: [0], loWinners: [1], oddToLo: true }], { order: [0, 1] });
  assert.deepEqual(lo.awards, { 0: 50, 1: 51 });
});

/* Who gets the odd chip when seat 0 takes half A and seat 1 half B. */
const oddToB = (game, a, b, board = '') => {
  const cfg = GAME_EVAL[game];
  const scores = { 0: scoreHalves(cfg, P(a), P(board)), 1: scoreHalves(cfg, P(b), P(board)) };
  return oddChipToLo(cfg, scores, [0], [1]);
};

test('the odd chip goes to the half with the most of the player\'s own cards', () => {
  const board = 'Ah7d2c9s4c';
  for (const g of ['Dramaha Hi', 'Dramaha 2-7', 'Dramaha 49', 'Dramaha 0', 'L Dramaha Hi', 'L Dramaha 2-7', 'L Dramaha 49', 'L Dramaha 0']) {
    assert.equal(oddToB(g, 'AsAd8h6c3s', 'KsKdKh5c6d', board), true, g + ': five of the draw hand against two of the Omaha hand');
  }
  assert.equal(oddToB('Omajack', 'AsAdKhTc5c', '9d9hKdQsAc', board), true, 'three of the blackjack hand against two');
  assert.equal(oddToB('Razzdugi', 'As2s3s4c5c9cKs', '2h3d7s8cThJdQh'), false, 'five of the razz hand against four of a badugi');
  assert.equal(oddToB('Razzdeucy', '2c3c4c5c7d9dJd', 'Ah2h3s4s5dKhQh'), false, 'the same in 2-7');
  assert.equal(oddChipToLo(GAME_EVAL.Badeucy, {}, [0], [1]), true, 'the low\'s five against the badugi\'s four');
  assert.equal(oddChipToLo(GAME_EVAL.Badacy, {}, [0], [1]), true, 'the same in A-5');
});

test('level on own cards, the odd chip stays with the high half', () => {
  assert.equal(oddToB('Archie 99', '9s9dKh7c3c', '2d3h4s5c8d'), false, 'five against five');
  assert.equal(oddChipToLo(GAME_EVAL['Stud 8'], {}, [0], [1]), false, 'an ordinary hi-lo game is unchanged');
  assert.equal(oddChipToLo(GAME_EVAL.O8, {}, [0], [1]), false);
});

test('a hand decides it where its own cards differ from the usual', () => {
  // Dramadugi: a two-card badugi is level with Omaha's two; a one-card badugi has fewer.
  const board = 'Ah7d2c9s4c';
  assert.equal(oddToB('Dramadugi', 'AsAd8h6c3s', '2d3h4s5c9h', board), true, 'four against two');
  assert.equal(oddToB('Dramadugi', 'AsAd8h6c3s', '2s5s7s8sKs', board), false, 'a one-card badugi against two');
  // Ari: the high that needs the community card plays four of its own, against the low's five.
  assert.equal(oddToB('Ari', '9sKdQh7c3c', '2d3h4s5c8d', '9d'), true, 'the community nine makes the pair');
  assert.equal(oddToB('Ari', '9s9hKdQc7c', '2d3h4s5c8d', '2c'), false, 'the pair is in the hand: five against five');
});

test('a mucked winner counts as that half normally plays', () => {
  assert.equal(oddChipToLo(GAME_EVAL['Dramaha Hi'], {}, [0], [1]), true);
  assert.equal(oddChipToLo(GAME_EVAL['Archie 99'], {}, [0], [1]), false);
});

test('Limit Dramaha: five rows, the pot-limit rules, the small bet to the flop and the big bet after', () => {
  for (const [row, limit] of [['Dramaha Hi', 'L Dramaha Hi'], ['Dramaha 2-7', 'L Dramaha 2-7'], ['Dramaha 49', 'L Dramaha 49'], ['Dramaha 0', 'L Dramaha 0'], ['Dramadugi', 'L Dramadugi']]) {
    assert.equal(gameTypeOf(row, 'Limit'), limit);
    assert.deepEqual(GAME_EVAL[limit], GAME_EVAL[row]);
    assert.equal(HAND_CONFIG[limit].betting, 'fl');
    assert.deepEqual(HAND_CONFIG[limit].flSmallStreets, [0, 1]);
    assert.equal(HAND_CONFIG[limit].drawAfter, 1);
    assert.ok(GAME_CODES[limit], limit + ' has a share code');
    assert.ok(buildCatalog().some((r) => r.gameType === limit && r.structure === 'Limit' && !r.rare), limit + ' is in the picker');
    assert.equal(variantName(row, 'Limit'), 'Limit ' + row);
  }
  assert.equal(new Set(Object.values(GAME_CODES)).size, Object.keys(GAME_CODES).length, 'no two games share a code');
});
