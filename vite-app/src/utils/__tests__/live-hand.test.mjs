// The play-money dealer's hand (utils/poker-rules/live-hand.js): dealing, turns, refusals, the run-out,
// the showdown's auto-muck, and that no seat's view or saved hand ever holds a card that seat did not see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startHand, act, viewFor, savedHandFor, timeoutMove, currentState } from '../poker-rules/live-hand.js';

const RANKS = '23456789TJQKA', SUITS = 'hdcs';
const FULL = [...RANKS].flatMap((r) => [...SUITS].map((s) => r + s));
/* A deck whose first cards are `top`, the rest in order. */
const deckWith = (...top) => [...top, ...FULL.filter((c) => !top.includes(c))];

const HU = [{ id: 11, name: 'Ava', stack: 1000 }, { id: 22, name: 'Bo', stack: 1000 }];
const BL = { sb: 5, bb: 10, ante: 0 };

const cardsIn = (obj) => JSON.stringify(obj).match(/[2-9TJQKA][hdcs]/g) || [];

test('heads-up NLH to a showdown: turns, settlement, auto-muck', () => {
  // Ava (BTN/SB) AhAd, Bo (BB) KcKs; board 2c 7d 9h | 3s | 4d: aces hold.
  const s = startHand({ gameType: 'NLH', blinds: BL, seats: HU, deck: deckWith('Ah', 'Ad', 'Kc', 'Ks', '2c', '7d', '9h', '3s', '4d') });
  assert.equal(s.players[0].position, 'BTN/SB');
  assert.equal(currentState(s).actor, 0, 'the button acts first before the flop heads-up');
  assert.deepEqual(act(s, 1, { action: 'call' }).error, 'Not your turn');
  assert.ok(act(s, 0, { action: 'raise', to: 30 }).ok);
  assert.ok(act(s, 1, { action: 'call' }).ok);
  assert.equal(s.si, 1);
  assert.equal(currentState(s).actor, 1, 'the big blind acts first after the flop');
  act(s, 1, { action: 'check' }); act(s, 0, { action: 'check' });
  act(s, 1, { action: 'bet', to: 50 }); act(s, 0, { action: 'call' });
  act(s, 1, { action: 'check' });
  assert.ok(act(s, 0, { action: 'check' }).ok);
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.result.finals, [1080, 920]);
  assert.deepEqual(s.result.shown, [0], 'the winner shows, the loser mucks');
  // Bo's saved hand shows Ava's aces (shown); Ava's never shows Bo's kings (mucked).
  assert.equal(savedHandFor(s, 1).streets[0].cards.opponents[0], 'AhAd');
  assert.equal(savedHandFor(s, 0).streets[0].cards.opponents[0], '');
  assert.ok(!cardsIn(savedHandFor(s, 0)).includes('Kc'));
});

test('no view carries an unseen card at any step', () => {
  const s = startHand({ gameType: 'NLH', blinds: BL, seats: HU, deck: deckWith('Ah', 'Ad', 'Kc', 'Ks', '2c', '7d', '9h', '3s', '4d') });
  const check = () => {
    const v0 = cardsIn(viewFor(s, 0)), v1 = cardsIn(viewFor(s, 1));
    assert.ok(!v0.includes('Kc') && !v0.includes('Ks'), 'seat 0 never sees seat 1 before a show');
    if (s.phase !== 'over') assert.ok(!v1.includes('Ah') && !v1.includes('Ad'));
    const dealtBoard = s.board.slice(0, s.si + 1).flat();
    for (const c of s.board.flat()) if (!dealtBoard.includes(c)) assert.ok(!v0.includes(c) && !v1.includes(c), `undealt ${c} in a view`);
  };
  check();
  for (const [p, m] of [[0, { action: 'call' }], [1, { action: 'check' }], [1, { action: 'check' }], [0, { action: 'check' }], [1, { action: 'check' }], [0, { action: 'check' }], [1, { action: 'check' }], [0, { action: 'check' }]]) {
    assert.ok(act(s, p, m).ok, JSON.stringify([p, m]));
    check();
  }
  assert.equal(s.phase, 'over');
});

test('all in before the flop: the board runs out and both hands are tabled', () => {
  const s = startHand({ gameType: 'NLH', blinds: BL, seats: HU, deck: deckWith('Ah', 'Ad', 'Kc', 'Ks', '2c', '7d', 'Kh', '3s', '4d') });
  act(s, 0, { action: 'raise', to: 1000 });
  act(s, 1, { action: 'call' });
  assert.equal(s.phase, 'over');
  assert.equal(s.runOut, true);
  assert.deepEqual(s.result.shown, [0, 1]);
  assert.deepEqual(s.result.finals, [0, 2000], 'the kings hit a set');
  assert.equal(savedHandFor(s, 0).streets[3].cards.board, '4d');
});

test('a fold: no showdown, nobody shown, the blinds go to the raiser', () => {
  const s = startHand({ gameType: 'NLH', blinds: BL, seats: HU, deck: deckWith('Ah', 'Ad', 'Kc', 'Ks') });
  act(s, 0, { action: 'raise', to: 30 });
  act(s, 1, { action: 'fold' });
  assert.deepEqual(s.result.finals, [1010, 990]);
  assert.deepEqual(s.result.shown, []);
  assert.ok(!cardsIn(savedHandFor(s, 1)).includes('Ah'));
});

test('refusals: out of range, stale seq, a check facing a bet', () => {
  const s = startHand({ gameType: 'NLH', blinds: BL, seats: HU, deck: FULL.slice() });
  const r = act(s, 0, { action: 'raise', to: 15 });
  assert.match(r.error, /From 20 to 1000/);
  assert.equal(act(s, 0, { action: 'check' }).error, 'There is a bet to call');
  assert.equal(act(s, 0, { action: 'call', seq: s.seq + 1 }).stale, true);
  assert.ok(act(s, 0, { action: 'call', seq: s.seq }).ok);
  assert.deepEqual(timeoutMove(s), { action: 'check' }, 'the big blind times out into a check');
});

test('three-handed: positions and the first to act', () => {
  const seats = [{ id: 1, name: 'A', stack: 500 }, { id: 2, name: 'B', stack: 500 }, { id: 3, name: 'C', stack: 500 }];
  const s = startHand({ gameType: 'NLH', blinds: BL, seats, deck: FULL.slice() });
  assert.deepEqual(s.players.map((p) => p.position), ['BTN', 'SB', 'BB']);
  assert.equal(currentState(s).actor, 0);
  act(s, 0, { action: 'fold' }); act(s, 1, { action: 'call' }); act(s, 2, { action: 'check' });
  assert.equal(currentState(s).actor, 1, 'the small blind acts first after the flop');
});

test('PLO deals four each and pot-limits the raise', () => {
  const s = startHand({ gameType: 'PLO', blinds: BL, seats: HU, deck: FULL.slice() });
  assert.equal(s.holes[0].length, 4);
  const L = currentState(s).legal;
  assert.equal(L.maxTo, 30, 'the button may raise to three big blinds heads-up');
});
