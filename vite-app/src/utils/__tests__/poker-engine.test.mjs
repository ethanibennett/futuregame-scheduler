// node --test src/utils/__tests__/poker-engine.test.mjs   (from vite-app/)
//
// The replayer's own games for PLO5, PLO6, PLO6 8/b, NLO8 and Short Deck, held to known hands:
// Omaha plays EXACTLY two hole cards whatever the hole count, the hi-lo games use the 8-or-better
// low, and Short Deck (a 36-card deck) has its own rankings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCardNotation as P, GAME_EVAL, SHORT_DECK_RULES, SHORT_DECK_TRIPS_BEAT_STRAIGHT, gameEvalFor,
  evalHigh5, bestHighHand, bestHighFor, bestLow8For, evaluateShowdown, evaluateHand,
} from '../poker-engine.js';

const hi = (game, hole, board) => bestHighFor(GAME_EVAL[game], P(hole), P(board));
const lo = (game, hole, board) => bestLow8For(GAME_EVAL[game], P(hole), P(board));
const short = (cards) => evalHigh5(P(cards), SHORT_DECK_RULES);
const players = (...holes) => holes.map((h, idx) => ({ idx, cards: P(h) }));

test('every one of the five games has an eval entry, and "Big Easy" is gone', () => {
  assert.deepEqual(GAME_EVAL['PLO5'], { type: 'high', method: 'omaha' });
  assert.deepEqual(GAME_EVAL['PLO6'], { type: 'high', method: 'omaha' });
  assert.deepEqual(GAME_EVAL['PLO6 8/b'], { type: 'hilo', method: 'omaha' });
  assert.deepEqual(GAME_EVAL['NLO8'], { type: 'hilo', method: 'omaha' });
  assert.deepEqual(GAME_EVAL['Short Deck'], { type: 'high', method: 'short' });
  assert.equal(GAME_EVAL['Big Easy'], undefined, 'the old name is canonicalised on the way in, not evaluated');
});

// ── Omaha: exactly two hole cards, whatever the hole count ──────────────────

test('PLO5: four aces in the hole play as ONE pair of aces, not quads', () => {
  const ev = hi('PLO5', 'AsAhAdAcKd', '2c7d9hJs3s');
  assert.equal(ev.name, 'Pair of Aces');
  assert.equal(ev.cat, 2);
  // Hold'em rules on the same nine cards would make quads: that is the mistake this guards.
  assert.equal(bestHighHand(P('AsAhAdAcKd2c7d9hJs3s')).name, 'Four of a Kind, Aces');
});

test('PLO6: three kings in the hole and a king on the board make three kings, not quads or a full house', () => {
  const ev = hi('PLO6', 'KsKhKd5c5d2s', 'Kc5h9s7d3c');
  assert.equal(ev.name, 'Three Kings');
  assert.equal(ev.cat, 4);
});

test('Omaha: one suited hole card plus a four-flush board is not a flush', () => {
  // Ah is the only heart in the hole; the board has four hearts. Two hole cards are required.
  const ev = hi('PLO5', 'Ah7c8dJsTc', '2h5h9hKh3d');
  assert.ok(ev.cat < 6, 'no flush: ' + ev.name);
  // With two hearts in the hole it is a flush: Ah Jh + 2h 5h 9h.
  const flush = hi('PLO5', 'AhJh8dJsTc', '2h5h9hKh3d');
  assert.equal(flush.name, 'Flush, Ace-high');
});

test('Omaha needs two hole cards and three board cards', () => {
  assert.equal(hi('PLO6', 'Ah', '2h5h9h'), null);
  assert.equal(hi('PLO6', 'AhKd2c3s9hTd', '2h5h'), null);
  assert.ok(hi('PLO6', 'AhKd2c3s9hTd', '2h5h4h'));
});

test('PLO6: the best of the 150 two-plus-three hands is found', () => {
  // Hole 9h 8h Jd 7d Ac 2c, board Tc Jh Qc 2d Kd. 8h 9h + Tc Jh Qc is only a queen-high straight;
  // Ac Jd + Kd Qc Tc is the ace-high one (no flush: four clubs, four diamonds at most).
  const ev = hi('PLO6', '9h8hJd7dAc2c', 'TcJhQc2dKd');
  assert.equal(ev.name, 'Straight, Ace-high');
});

// ── Hi-lo with the 8-or-better low ──────────────────────────────────────────

test('PLO6 8/b: the high and the low are searched separately, with different hole pairs', () => {
  const hole = 'Ac2cJdJh9s9d', board = '3h5s8dKhQc';
  assert.equal(hi('PLO6 8/b', hole, board).name, 'Pair of Jacks', 'JJ plays for the high');
  const l = lo('PLO6 8/b', hole, board);
  assert.equal(l.name, '8 5 3 2 A low', 'A2 plays for the low');
  assert.equal(l.qualified, true);
});

test('PLO6 8/b: a nine-high low, or a paired one, does not qualify', () => {
  assert.equal(lo('PLO6 8/b', 'Ac2cJdJh9s9d', '3h5s9dKhQc'), null, '9 5 3 2 A is not 8 or better');
  assert.equal(lo('PLO6 8/b', 'Ac2cJdJh9s9d', '3h3s8dKhQc'), null, 'a paired board leaves no five different low ranks');
  // Two hole cards are still needed for the low: one low card in the hole is not enough.
  assert.equal(lo('PLO6 8/b', 'Ac9c9dJdJhKs', '2h3s5d6cQs'), null);
});

test('PLO6 8/b: high to the set, low to the wheel, both flagged', () => {
  const w = evaluateShowdown('PLO6 8/b', players('Ac2cJdJh9s9d', 'KsKd4h4dTs2s'), P('3h5s8dKhQc'));
  const byIdx = Object.fromEntries(w.map((x) => [x.playerIdx, x]));
  assert.equal(byIdx[1].hi, true, 'the set of kings wins the high');
  assert.equal(byIdx[0].lo, true, 'A2 against 3-5-8 holds the better low (8 5 3 2 A against 8 5 4 3 2)');
  assert.equal(w.length, 2);
  assert.ok(w.every((x) => x.split === true));
});

test('PLO6 8/b: nobody qualifies for the low, so the best high takes the whole pot', () => {
  const w = evaluateShowdown('PLO6 8/b', players('Ac2cJdJh9s9d', 'KsKd4h4dTs2s'), P('9h9c8dKhQc'));
  assert.equal(w.length, 1);
  assert.equal(w[0].playerIdx, 0, 'the two hole nines and the two board nines are four nines; the kings are only a full house');
  assert.equal(w[0].lo, false);
  assert.equal(w[0].split, false);
});

test('NLO8 evaluates exactly like PLO8 (four hole cards, hi-lo, 8-or-better)', () => {
  assert.deepEqual(GAME_EVAL['NLO8'], GAME_EVAL['PLO8']);
  const w = evaluateShowdown('NLO8', players('As2dKcQd', 'KsKdJhTh'), P('3c4h8sKh9d'));
  const byIdx = Object.fromEntries(w.map((x) => [x.playerIdx, x]));
  assert.equal(byIdx[1].hi, true, 'KsKd + Kh plays three kings, a pair of kings beats nothing');
  assert.equal(byIdx[0].lo, true, 'As2d + 3c4h8s = 8 4 3 2 A low');
  const r = evaluateHand('NLO8', P('As2dKcQd'), P('KsKdJhTh'), P('3c4h8sKh9d'));
  assert.equal(r.result.outcome, 'split');
  assert.match(r.result.text, /^Split/);
});

// ── Short Deck ──────────────────────────────────────────────────────────────

test('Short Deck: a flush beats a full house (it does not in a 52-card game)', () => {
  const board = 'Kh6h8hKdKs';
  const sd = evaluateShowdown('Short Deck', players('Ah9h', '6s6c'), P(board));
  assert.deepEqual(sd, [{ playerIdx: 0, split: false }], 'Ah 9h makes the flush, 6s 6c only kings full of sixes');
  const nlh = evaluateShowdown('NLH', players('Ah9h', '6s6c'), P(board));
  assert.deepEqual(nlh, [{ playerIdx: 1, split: false }], 'the same cards in hold’em: the full house wins');
  const r = evaluateHand('Short Deck', P('Ah9h'), P('6s6c'), P(board));
  assert.equal(r.result.outcome, 'hero');
  assert.match(r.result.text, /Flush/);
});

test('Short Deck: A-6-7-8-9 is the lowest straight, nine-high', () => {
  const low = short('As6d7h8c9s');
  assert.equal(low.name, 'Straight, Nine-high');
  assert.equal(low.shortName, 'Straight, 9-high');
  assert.equal(low.cat, 5);
  // It loses to every higher straight and beats a hand with no straight.
  assert.ok(short('Ts6d7h8c9s').score > low.score, '6-T beats A-9');
  assert.ok(short('9s6d7h8cTs').score === short('Ts6d7h8c9s').score);
  assert.ok(low.score > short('Ks6d7h8c9s').score, 'A-6-7-8-9 beats king-high');
  // In a 52-card game A-6-7-8-9 is just ace-high, and A-2-3-4-5 is still the wheel.
  assert.equal(evalHigh5(P('As6d7h8c9s')).name, 'Ace-high');
  assert.equal(evalHigh5(P('As2d3h4c5s')).name, 'Wheel');
});

test('Short Deck: the straight flush A-6-7-8-9 is a nine-high straight flush', () => {
  const sf = short('Ah6h7h8h9h');
  assert.equal(sf.name, 'Straight Flush, Nine-high');
  assert.equal(sf.cat, 9);
  assert.ok(short('AhKhQhJhTh').score > sf.score, 'a royal flush still beats it');
});

test('Short Deck: the order of hands, best to worst', () => {
  const order = [
    ['straight flush', 'Th9h8h7h6h'],
    ['four of a kind', 'Ts9s9h9d9c'],
    ['flush', 'AhKh9h8h6h'],
    ['full house', '7s7h7d6s6c'],
    ['straight', 'As6d7h8c9s'],
    ['three of a kind', 'Ks7d7h7cQs'],
    ['two pair', 'AsAdKsKd6c'],
    ['pair', 'AsAd9c8s7d'],
    ['high card', 'AsKd9c8s7d'],
  ];
  const scores = order.map(([, c]) => short(c).score);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i - 1] > scores[i], order[i - 1][0] + ' beats ' + order[i][0]);
  // The flush ranks above the full house: the 52-card order is the other way round.
  assert.ok(evalHigh5(P('AhKh9h8h6h')).score < evalHigh5(P('7s7h7d6s6c')).score);
});

test('Short Deck: three of a kind against a straight is a single switch, set to the straight winning', () => {
  assert.equal(SHORT_DECK_TRIPS_BEAT_STRAIGHT, false);
  assert.ok(short('As6d7h8c9s').score > short('Ks7d7h7cQs').score, 'straight over three of a kind');
  const flipped = { ...SHORT_DECK_RULES, tripsBeatStraight: true };
  assert.ok(evalHigh5(P('Ks7d7h7cQs'), flipped).score > evalHigh5(P('As6d7h8c9s'), flipped).score, 'the flag reverses them');
});

test("Short Deck: the hand carries its room's rule (the question asked when the game is chosen)", () => {
  // As 9d makes A-6-7-8-9; Kh Qh with the board's two kings makes trip kings.
  const board = P('6c7h8sKdKc');
  const hands = players('As9d', 'KhQh');
  assert.deepEqual(evaluateShowdown('Short Deck', hands, board, { tripsBeatStraight: false }), [{ playerIdx: 0, split: false }], 'the straight wins by the usual rule');
  assert.deepEqual(evaluateShowdown('Short Deck', hands, board, { tripsBeatStraight: true }), [{ playerIdx: 1, split: false }], 'trips win where the room ranks them higher');
  assert.deepEqual(evaluateShowdown('Short Deck', hands, board, {}), [{ playerIdx: 0, split: false }], 'a hand with no answer keeps the default');
  assert.equal(gameEvalFor('Short Deck', { tripsBeatStraight: true }).rules.tripsBeatStraight, true);
  assert.equal(gameEvalFor('Short Deck', { tripsBeatStraight: true }).rules.flushBeatsFullHouse, true, 'the other Short Deck rules stay');
  assert.equal(gameEvalFor('NLH', { tripsBeatStraight: true }), GAME_EVAL.NLH, 'other games ignore it');
  assert.equal(gameEvalFor('Short Deck', null), GAME_EVAL['Short Deck']);
});

test('Short Deck: the best five of seven, with the ace playing low', () => {
  // As 9d in the hole; 6c 7h 8s on the flop: A-6-7-8-9 and nothing else, against a pair of kings.
  const ev = bestHighFor(GAME_EVAL['Short Deck'], P('As9d'), P('6c7h8sKdKc'));
  assert.equal(ev.name, 'Straight, Nine-high');
  const w = evaluateShowdown('Short Deck', players('As9d', 'KhQh'), P('6c7h8sKdKc'));
  assert.deepEqual(w, [{ playerIdx: 0, split: false }], 'the nine-high straight beats trip kings (a straight beats three of a kind here)');
  // 9-high straight is beaten by a ten-high straight made with the same board.
  const w2 = evaluateShowdown('Short Deck', players('As9d', 'Td9c'), P('6c7h8sKdQc'));
  assert.deepEqual(w2, [{ playerIdx: 1, split: false }]);
});
