// node --test src/utils/__tests__/action-razz.test.mjs   (from vite-app/)
//
// Action Razz (owner, 2026-11-28: "J, Q, K anywhere in seven; plain low wins if none"): Razz, but while anyone in
// a pot holds a jack, queen or king somewhere in their seven cards, only such a hand can win that pot. Each pot
// layer is decided among its own players, so a side pot between two hands with no face card goes to the lower.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCardNotation as P, GAME_EVAL, evaluateShowdown, evaluateHand, bestLowFor, hasActionCard } from '../poker-engine.js';
import { settlePot, scoreHand } from '../hand-history/settle.js';

globalThis.localStorage = globalThis.localStorage || { getItem() { return null; }, setItem() {} };
const { HAND_CONFIG } = await import('../utils.js');
const { GAME_CODES } = await import('../hand-shorthand.js');
const { buildCatalog, gameTypeOf, variantName } = await import('../variant-catalog.js');
const { rulesFor } = await import('../game-rules.js');
const qa = await import('../quick-add/game.js');

const cfg = GAME_EVAL['Action Razz'];
const winners = (hands) => evaluateShowdown('Action Razz', hands.map((h, idx) => ({ idx, cards: P(h) })), []).map((w) => w.playerIdx).sort();

// Hero: an 8 low with a king. Opp: a 7 low with no jack, queen or king. Third: a 6 low with a queen.
const EIGHT_K = 'Ah2h3d4c9sKc8d';
const SEVEN_BARE = '2c3s4d5c7hTd9c';
const SIX_Q = 'As2s3c4h6dQd9h';
const EIGHT_BARE = 'Ad2d3h4s9dTh8c'; // 8 4 3 2 A low, no face card

test('a face card anywhere in the seven qualifies; a lower hand without one loses to it', () => {
  assert.equal(hasActionCard(P(EIGHT_K)), true);
  assert.equal(hasActionCard(P(SEVEN_BARE)), false);
  assert.deepEqual(winners([EIGHT_K, SEVEN_BARE]), [0]);
  // In plain Razz the seven wins.
  assert.deepEqual(evaluateShowdown('Razz', [{ idx: 0, cards: P(EIGHT_K) }, { idx: 1, cards: P(SEVEN_BARE) }], []).map((w) => w.playerIdx), [1]);
});

test('the face card need not play: K or Q sits outside the five', () => {
  const lo = bestLowFor(cfg, P(EIGHT_K));
  assert.match(lo.name, /^8 4 3 2 A low$/);
  assert.equal(bestLowFor(cfg, P(SEVEN_BARE)).name, '7 5 4 3 2 low, no face card');
});

test('when two qualify, the lower of them wins; nobody qualifying, the plain low wins', () => {
  assert.deepEqual(winners([EIGHT_K, SIX_Q, SEVEN_BARE]), [1]);
  assert.deepEqual(winners([SEVEN_BARE, EIGHT_BARE]), [0]);
});

test('heads up, the hand-against-hand reading agrees', () => {
  const r = evaluateHand('Action Razz', P(EIGHT_K), P(SEVEN_BARE), [], {});
  assert.equal(r.result.outcome, 'hero');
});

test('each pot is decided among its own players: a side pot of two bare hands goes to the lower', () => {
  // Seat 0 holds the king and is all in for 100; seats 1 and 2 play on for another 200 each with no face card.
  const live = [0, 1, 2];
  const scores = Object.fromEntries([EIGHT_K, SEVEN_BARE, EIGHT_BARE].map((h, i) => [i, scoreHand(cfg, P(h), [])]));
  const out = settlePot({ n: 3, live, contrib: [100, 300, 300], dead: 0, allInEnd: new Set([0]), scores, winners: [], order: [0, 1, 2], unit: 1 });
  assert.equal(out.from, 'cards');
  // The main pot (300) to the only hand with a face card; the side pot (400) to the seven, the lower bare hand.
  assert.equal(out.won[0], 300);
  assert.equal(out.won[1], 400);
  assert.equal(out.won[2] || 0, 0);
});

test('the catalog row, the share code, the deal and the rules', () => {
  const row = buildCatalog().find((r) => r.game === 'Action Razz');
  assert.ok(row, 'Action Razz is a catalog row');
  assert.equal(row.structure, 'Limit');
  assert.equal(row.gameType, 'Action Razz');
  assert.equal(gameTypeOf('Action Razz', 'Limit'), 'Action Razz');
  assert.equal(variantName('Action Razz', 'Limit'), 'Action Razz');
  assert.equal(GAME_CODES['Action Razz'], 'AZ');
  assert.equal(Object.values(GAME_CODES).filter((c) => c === 'AZ').length, 1);
  assert.deepEqual(HAND_CONFIG['Action Razz'], { ...HAND_CONFIG.Razz });
  // The razz family's bring-in and order of play: the highest door brings it in, the lowest board acts first.
  assert.equal(qa.isLowStud('Action Razz'), true);
  const rules = rulesFor(row);
  assert.match(rules.halves[0][1], /jack, queen or king anywhere in its seven/);
});
