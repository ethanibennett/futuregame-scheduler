// node --test src/utils/__tests__/multi-board-link.test.mjs   (from vite-app/)
// Share links carry the extra boards and the double-board / run-it flags (utils/hand-shorthand.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis.window || globalThis;
const S = await import('../hand-shorthand.js');

const base = (extra) => ({
  gameType: 'PLO', heroIdx: 0,
  players: [{ name: 'Hero', position: 'BTN', startingStack: 50000 }, { name: 'Opp 1', position: 'BB', startingStack: 50000 }],
  blinds: { sb: 100, bb: 200, ante: 0 },
  streets: [
    { name: 'Preflop', cards: { hero: 'AsAhKdQd', opponents: ['9c8c7h6h'], board: '' }, actions: [], draws: [] },
    { name: 'Flop', cards: { hero: '', opponents: [''], board: 'Ac2s3d', ...(extra.flop2 ? { board2: extra.flop2 } : {}) }, actions: [], draws: [] },
    { name: 'Turn', cards: { hero: '', opponents: [''], board: 'Tc', board2: 'Kd', ...(extra.turn3 ? { board3: extra.turn3 } : {}) }, actions: [], draws: [] },
    { name: 'River', cards: { hero: '', opponents: [''], board: 'Th', board2: '5s', ...(extra.river3 ? { board3: extra.river3 } : {}) }, actions: [], draws: [] },
  ],
  result: null,
  ...extra.flags,
});

test('a double board survives the link', () => {
  const h = base({ flop2: '6c7d9s', flags: { doubleBoard: true } });
  const back = S.decodeHand(S.encodeHand(h));
  assert.equal(back.doubleBoard, true);
  assert.equal(back.streets[1].cards.board2, '6c7d9s');
  assert.equal(back.streets[3].cards.board2, '5s');
  assert.equal(back.players[1].startingStack, 50000);
});

test('a hand run three times survives the link, its runs starting on the turn', () => {
  const h = base({ turn3: 'Qs', river3: '2c', flags: { runs: 3, runsFrom: 2 } });
  const back = S.decodeHand(S.encodeHand(h));
  assert.equal(back.runs, 3);
  assert.equal(back.runsFrom, 2);
  assert.equal(back.streets[2].cards.board3, 'Qs');
  assert.equal(back.streets[1].cards.board2, undefined, 'the flop is shared');
  assert.ok(!back.doubleBoard);
});

test('a one-board hand is unchanged', () => {
  const h = base({ flags: {} });
  for (const s of h.streets) { delete s.cards.board2; }
  const link = S.encodeHand(h);
  assert.ok(!link.includes('*'));
  const back = S.decodeHand(link);
  assert.equal(back.runs, undefined);
  assert.equal(back.doubleBoard, undefined);
});
