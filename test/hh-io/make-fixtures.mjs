// The hand-history I/O fixtures, written by hand in the replayer's hand model
// (docs/quick-add-contract.md) — one per case in docs/hand-history-io.md
// section 10. This file is where they are written; the JSON under fixtures/ is
// what the tests read. Regenerate after editing:
//
//   node test/hh-io/make-fixtures.mjs
//
// Every hand plays out legally street by street; the comments say what each
// one is there to hold down. playedAt is fixed so the output is byte-stable.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'fixtures');
fs.mkdirSync(out, { recursive: true });

const P = (name, position, startingStack) => ({ name, position, startingStack });
const A = (player, action, amount = 0) => ({ player, action, amount });
const D = (player, discarded, discardedCards = '', newCards = '') => ({ player, discarded, discardedCards, newCards });
const St = (name, hero, opponents, board, actions, draws = []) => ({ name, cards: { hero: hero || '', opponents, board: board || '' }, actions: actions || [], draws });
const W = (...idx) => ({ winners: idx.map(i => ({ playerIdx: i, split: idx.length > 1 })) });
const e = (k) => Array.from({ length: k }, () => '');
const AT = '2026-10-13T18:30:05Z';   // 14:30:05 ET (EDT)
const fixtures = {};
const add = (name, hand, opts = {}) => { fixtures[name] = { hand, opts: { playedAt: AT, ...opts } }; };
const addError = (name, hand, expectCode, opts = {}) => { fixtures['error-' + name] = { hand, opts: { playedAt: AT, ...opts }, expectCode }; };

const six = ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

// 1. NLH cash 6-max: a 3-bet pot to showdown.
add('01-nlh-cash-3bet', {
  gameType: 'NLH', gameMode: 'cash', currency: 'USD',
  blinds: { sb: 1, bb: 2, ante: 0 },
  players: [P('Lena', 'LJ', 200), P('Marco', 'HJ', 200), P('Dee', 'CO', 200), P('Ethan', 'BTN', 250), P('Sol', 'SB', 200), P('Rafe', 'BB', 200)],
  heroIdx: 3,
  streets: [
    St('Preflop', 'AsKd', ['', 'QhQc', '', '', ''], '', [A(0, 'fold'), A(1, 'raise', 6), A(2, 'fold'), A(3, 'raise', 20), A(4, 'fold'), A(5, 'fold'), A(1, 'call', 14)]),
    St('Flop', '', e(5), 'Ks7d2c', [A(1, 'check'), A(3, 'bet', 22), A(1, 'call', 22)]),
    St('Turn', '', e(5), '9h', [A(1, 'check'), A(3, 'bet', 55), A(1, 'call', 55)]),
    St('River', '', e(5), '3s', [A(1, 'check'), A(3, 'check')]),
  ],
  result: W(3),
});

// 2. A walk: everyone folds to the big blind; the big blind's uncalled half back.
add('02-walk', {
  gameType: 'NLH', gameMode: 'mtt',
  blinds: { sb: 100, bb: 200, ante: 0 },
  players: six.map((p, i) => P(['Ava', 'Bo', 'Hero', 'Dax', 'Eli', 'Fin'][i], p, 10000)),
  heroIdx: 2,
  streets: [
    St('Preflop', 'AhJs', e(5), '', [A(0, 'fold'), A(1, 'fold'), A(2, 'fold'), A(3, 'fold'), A(4, 'fold')]),
    St('Flop', '', e(5), '', []), St('Turn', '', e(5), '', []), St('River', '', e(5), '', []),
  ],
  result: W(5),
});

// 3. Heads-up: the button is the small blind and acts first preflop, last after.
add('03-heads-up', {
  gameType: 'NLH', gameMode: 'cash', currency: 'USD',
  blinds: { sb: 0.5, bb: 1 },
  players: [P('Ethan', 'BTN/SB', 100), P('Vik', 'BB', 87.25)],
  heroIdx: 0,
  streets: [
    St('Preflop', 'Td9d', [''], '', [A(0, 'raise', 2.5), A(1, 'call', 2)]),
    St('Flop', '', [''], 'Ah6c2s', [A(1, 'check'), A(0, 'bet', 3), A(1, 'fold')]),
    St('Turn', '', [''], '', []), St('River', '', [''], '', []),
  ],
  result: W(0),
});

// 4. Three-handed: the button is seat 1 and acts first preflop.
add('04-three-handed', {
  gameType: 'NLH', gameMode: 'mtt',
  blinds: { sb: 100, bb: 200 },
  players: [P('Ana', 'BTN', 9000), P('Ben', 'SB', 12000), P('Hero', 'BB', 15000)],
  heroIdx: 2,
  streets: [
    St('Preflop', 'Jc9c', ['', ''], '', [A(0, 'fold'), A(1, 'raise', 500), A(2, 'call', 400)]),
    St('Flop', '', ['', ''], 'Tc8d2h', [A(1, 'bet', 700), A(2, 'raise', 2100), A(1, 'fold')]),
    St('Turn', '', ['', ''], '', []), St('River', '', ['', ''], '', []),
  ],
  result: W(2),
});

// 5. UTG, Mississippi and button straddles at a nine-handed table: priced
//    2bb, 4bb, 8bb in seat order; the action opens left of the last straddle.
const nine = ['UTG+1', 'MP1', 'MP2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
add('05-straddles', {
  gameType: 'NLH', gameMode: 'cash', currency: 'USD',
  blinds: { sb: 1, bb: 2, straddle: true, straddle_utg: true, straddle_mississippi: true, straddle_button: true, straddleSeats: { mississippi: 3 } },
  players: nine.map((p, i) => P(['Uma', 'Ike', 'Mo', 'Hero', 'Hal', 'Cy', 'Bea', 'Sid', 'Bix'][i], p, 300)),
  heroIdx: 3,
  streets: [
    St('Preflop', 'Ad5d', ['8c8h', '', '', '', '', '', '', ''], '', [
      A(7, 'fold'), A(8, 'fold'), A(0, 'call', 12), A(1, 'fold'), A(2, 'fold'), A(3, 'call', 8), A(4, 'fold'), A(5, 'fold'), A(6, 'check'),
    ]),
    St('Flop', '', e(8), 'Kd8d3s', [A(0, 'check'), A(3, 'bet', 30), A(6, 'fold'), A(0, 'call', 30)]),
    St('Turn', '', e(8), '2c', [A(0, 'check'), A(3, 'check')]),
    St('River', '', e(8), 'Qd', [A(0, 'bet', 50), A(3, 'raise', 200), A(0, 'fold')]),
  ],
  result: W(3),
});

// 6. NLH tournament: a big-blind ante (dead money, main pot), an all-in
//    preflop and the runout with no betting.
add('06-tourney-bb-ante-allin', {
  gameType: 'NLH', gameMode: 'mtt',
  blinds: { sb: 500, bb: 1000, ante: 1000 },
  players: [P('Pia', 'LJ', 30000), P('Quinn', 'HJ', 22000), P('Hero', 'CO', 40000), P('Rex', 'BTN', 15000), P('Sam', 'SB', 26000), P('Tia', 'BB', 31000)],
  heroIdx: 2,
  streets: [
    St('Preflop', 'AcQc', ['', '', 'Js9s', '', ''], '', [A(0, 'fold'), A(1, 'fold'), A(2, 'raise', 2200), A(3, 'all-in', 15000), A(4, 'fold'), A(5, 'fold'), A(2, 'call', 12800)]),
    St('Flop', '', e(5), 'Qd7s2h', []), St('Turn', '', e(5), '9c', []), St('River', '', e(5), '3d', []),
  ],
  result: W(2),
});

// 7. Three players all-in and a caller: a main pot and two side pots, each won
//    by a different player.
add('07-side-pots', {
  gameType: 'NLH', gameMode: 'mtt',
  blinds: { sb: 50, bb: 100 },
  players: [P('Ari', 'CO', 1000), P('Hero', 'BTN', 3000), P('Cal', 'SB', 6000), P('Dov', 'BB', 8000)],
  heroIdx: 1,
  streets: [
    St('Preflop', 'KsKh', ['AsAh', 'JsJh', 'QdQc'], '', [A(0, 'all-in', 1000), A(1, 'all-in', 3000), A(2, 'all-in', 5950), A(3, 'call', 5900)]),
    St('Flop', '', e(3), '8c7d2s', []), St('Turn', '', e(3), '4h', []), St('River', '', e(3), '3c', []),
  ],
  result: { winners: [{ playerIdx: 0, split: true }, { playerIdx: 1, split: true }, { playerIdx: 3, split: true }] },
});

// 8. Both play the board: a split with an odd chip (565), the odd chip to the
//    first seat left of the button.
add('08-split-odd-chip', {
  gameType: 'NLH', gameMode: 'mtt',
  blinds: { sb: 50, bb: 100, ante: 15 },
  players: [P('Hero', 'BTN', 5000), P('Kai', 'SB', 5000), P('Lux', 'BB', 5000)],
  heroIdx: 0,
  streets: [
    St('Preflop', '2c3d', ['', '4h5s'], '', [A(0, 'raise', 250), A(1, 'fold'), A(2, 'call', 150)]),
    St('Flop', '', ['', ''], '9cThJd', [A(2, 'check'), A(0, 'check')]),
    St('Turn', '', ['', ''], 'Qs', [A(2, 'check'), A(0, 'check')]),
    St('River', '', ['', ''], 'Ks', [A(2, 'check'), A(0, 'check')]),
  ],
  result: { winners: [{ playerIdx: 0, split: true }, { playerIdx: 2, split: true }] },
});

// 9. A river bet nobody calls: returned.
add('09-river-uncalled', {
  gameType: 'NLH', gameMode: 'cash', currency: 'EUR',
  blinds: { sb: 0.05, bb: 0.1 },
  players: [P('Ola', 'LJ', 10), P('Hero', 'HJ', 12.4), P('Pam', 'CO', 9.15), P('Rio', 'BTN', 10), P('Sky', 'SB', 4.8), P('Tor', 'BB', 10.65)],
  heroIdx: 1,
  streets: [
    St('Preflop', 'KcQs', e(5), '', [A(0, 'fold'), A(1, 'raise', 0.3), A(2, 'fold'), A(3, 'call', 0.3), A(4, 'fold'), A(5, 'fold')]),
    St('Flop', '', e(5), 'Qh8c4d', [A(1, 'bet', 0.35), A(3, 'call', 0.35)]),
    St('Turn', '', e(5), '6s', [A(1, 'check'), A(3, 'check')]),
    St('River', '', e(5), '2h', [A(1, 'bet', 0.6), A(3, 'fold')]),
  ],
  result: W(1),
});

// 10. A short all-in call on the flop: the excess comes back.
add('10-short-allin-call', {
  gameType: 'NLH', gameMode: 'mtt',
  blinds: { sb: 200, bb: 400, ante: 400 },
  players: [P('Uri', 'LJ', 30000), P('Val', 'HJ', 30000), P('Hero', 'CO', 25000), P('Wes', 'BTN', 2400), P('Xan', 'SB', 30000), P('Yul', 'BB', 30000)],
  heroIdx: 2,
  streets: [
    St('Preflop', 'AhKh', ['', '', '9s9c', '', ''], '', [A(0, 'fold'), A(1, 'fold'), A(2, 'raise', 1000), A(3, 'call', 1000), A(4, 'fold'), A(5, 'fold')]),
    St('Flop', '', e(5), 'Kc7c2d', [A(2, 'bet', 3000), A(3, 'all-in', 1400)]),
    St('Turn', '', e(5), '5s', []), St('River', '', e(5), 'Jd', []),
  ],
  result: W(2),
});

// 11. An all-in raise for less than a full raise: it does not reopen the
//     betting, so the first raiser can only call.
add('11-short-allin-raise', {
  gameType: 'NLH', gameMode: 'mtt',
  blinds: { sb: 100, bb: 200 },
  players: [P('Hero', 'BTN', 20000), P('Bram', 'SB', 1500), P('Coy', 'BB', 20000)],
  heroIdx: 0,
  streets: [
    St('Preflop', '7h7d', ['AdTd', 'KcJc'], '', [A(0, 'raise', 1000), A(1, 'all-in', 1400), A(2, 'call', 1300), A(0, 'call', 500)]),
    St('Flop', '', ['', ''], 'Ts6h2c', [A(2, 'check'), A(0, 'check')]),
    St('Turn', '', ['', ''], 'Qs', [A(2, 'bet', 2000), A(0, 'fold')]),
    St('River', '', ['', ''], '3h', []),
  ],
  result: W(1),
});

// 12. Pot-limit Hold'em.
add('12-plh', {
  gameType: 'PLH', gameMode: 'cash', currency: 'USD',
  blinds: { sb: 1, bb: 2 },
  players: [P('Ezra', 'CO', 400), P('Hero', 'BTN', 400), P('Gus', 'SB', 400), P('Hob', 'BB', 400)],
  heroIdx: 1,
  streets: [
    St('Preflop', 'JhJd', ['', '', 'AcKs'], '', [A(0, 'fold'), A(1, 'raise', 7), A(2, 'fold'), A(3, 'call', 5)]),
    St('Flop', '', e(3), 'Jc8s4h', [A(3, 'check'), A(1, 'bet', 10), A(3, 'call', 10)]),
    St('Turn', '', e(3), 'Ad', [A(3, 'bet', 35), A(1, 'raise', 140), A(3, 'call', 105)]),
    St('River', '', e(3), '6c', [A(3, 'check'), A(1, 'bet', 243), A(3, 'call', 243)]),
  ],
  result: W(1),
});

// 13. Limit Hold'em, capped preflop: header (bb/bigBet).
add('13-lhe-capped', {
  gameType: 'LHE', gameMode: 'cash', currency: 'USD',
  blinds: { sb: 1, bb: 2, bigBet: 4, betCap: 4 },
  players: [P('Ida', 'HJ', 120), P('Jude', 'CO', 120), P('Hero', 'BTN', 150), P('Kip', 'SB', 120), P('Lars', 'BB', 120)],
  heroIdx: 2,
  streets: [
    St('Preflop', 'AdQd', ['', '', '', 'KsKd'], '', [A(0, 'raise', 4), A(1, 'fold'), A(2, 'raise', 6), A(3, 'fold'), A(4, 'raise', 6), A(0, 'call', 4), A(2, 'call', 2)]),
    St('Flop', '', e(4), 'Qs9d4c', [A(4, 'bet', 2), A(0, 'fold'), A(2, 'call', 2)]),
    St('Turn', '', e(4), '2d', [A(4, 'bet', 4), A(2, 'raise', 8), A(4, 'call', 4)]),
    St('River', '', e(4), 'Td', [A(4, 'check'), A(2, 'bet', 4), A(4, 'call', 4)]),
  ],
  result: W(2),
});

// 14. Pot-limit Omaha.
add('14-plo', {
  gameType: 'PLO', gameMode: 'cash', currency: 'USD',
  blinds: { sb: 0.5, bb: 1 },
  players: [P('Mia', 'LJ', 100), P('Hero', 'HJ', 100), P('Nox', 'CO', 100), P('Ori', 'BTN', 100), P('Pax', 'SB', 100), P('Rue', 'BB', 100)],
  heroIdx: 1,
  streets: [
    St('Preflop', 'AsKsQhJh', ['', '', 'Tc9c8d7d', '', ''], '', [A(0, 'fold'), A(1, 'raise', 3.5), A(2, 'fold'), A(3, 'call', 3.5), A(4, 'fold'), A(5, 'fold')]),
    St('Flop', '', e(5), 'Th9h2s', [A(1, 'bet', 5), A(3, 'raise', 20), A(1, 'call', 15)]),
    St('Turn', '', e(5), '6h', [A(1, 'bet', 40), A(3, 'call', 40)]),
    St('River', '', e(5), '3c', [A(1, 'bet', 36.5), A(3, 'fold')]),
  ],
  result: W(1),
});

// 15a. PLO5, and 15b a 'PLO' hand dealt five: both 5 Card Omaha.
const plo5 = (gameType) => ({
  gameType, gameMode: 'cash', currency: 'USD',
  blinds: { sb: 1, bb: 2 },
  players: [P('Hero', 'BTN', 300), P('Sia', 'SB', 300), P('Tam', 'BB', 300)],
  heroIdx: 0,
  streets: [
    St('Preflop', 'Ac2c5d6h9s', ['', 'KhQhJs8d4c'], '', [A(0, 'raise', 6), A(1, 'fold'), A(2, 'call', 4)]),
    St('Flop', '', ['', ''], '3c4dTh', [A(2, 'check'), A(0, 'bet', 9), A(2, 'call', 9)]),
    St('Turn', '', ['', ''], 'Kd', [A(2, 'check'), A(0, 'check')]),
    St('River', '', ['', ''], '7c', [A(2, 'bet', 20), A(0, 'call', 20)]),
  ],
  result: W(0),
});
add('15a-plo5', plo5('PLO5'));
add('15b-plo-five-cards', plo5('PLO'));

// 16. PLO6.
add('16-plo6', {
  gameType: 'PLO6', gameMode: 'cash', currency: 'USD',
  blinds: { sb: 0.25, bb: 0.5 },
  players: [P('Hero', 'CO', 60), P('Uli', 'BTN', 60), P('Vee', 'SB', 60), P('Wim', 'BB', 60)],
  heroIdx: 0,
  streets: [
    St('Preflop', 'AhAdKcQs3h2h', ['', '', 'Jc Tc 9c 8s 7d 2d'.replace(/ /g, '')], '', [A(0, 'raise', 1.75), A(1, 'fold'), A(2, 'fold'), A(3, 'call', 1.25)]),
    St('Flop', '', e(3), 'Ac7c6s', [A(3, 'check'), A(0, 'bet', 2.75), A(3, 'raise', 11), A(0, 'call', 8.25)]),
    St('Turn', '', e(3), '5d', [A(3, 'bet', 20), A(0, 'call', 20)]),
    St('River', '', e(3), 'Kd', [A(3, 'bet', 25.25), A(0, 'call', 25.25)]),
  ],
  result: W(3),
});

// 17. PLO8: the high to one player, the low to the other.
add('17-plo8-split', {
  gameType: 'PLO8', gameMode: 'mtt',
  blinds: { sb: 200, bb: 400, ante: 0 },
  players: [P('Hero', 'BTN', 30000), P('Xia', 'SB', 28000), P('Yoz', 'BB', 32000)],
  heroIdx: 0,
  streets: [
    St('Preflop', 'Ah2dKhQh', ['9s8s7c6c', ''], '', [A(0, 'raise', 1200), A(1, 'call', 1000), A(2, 'fold')]),
    St('Flop', '', ['', ''], '3h5d8d', [A(1, 'check'), A(0, 'bet', 1500), A(1, 'call', 1500)]),
    St('Turn', '', ['', ''], 'Ts', [A(1, 'bet', 3000), A(0, 'call', 3000)]),
    St('River', '', ['', ''], '4c', [A(1, 'bet', 6000), A(0, 'call', 6000)]),
  ],
  result: { winners: [{ playerIdx: 0, split: true, hi: false, lo: true }, { playerIdx: 1, split: true, hi: true, lo: false }] },
});

// 18. PLO8 quartered: one player wins the high and ties the low.
add('18-plo8-quartered', {
  gameType: 'PLO8', gameMode: 'cash', currency: 'USD',
  blinds: { sb: 1, bb: 2 },
  players: [P('Hero', 'BTN', 200), P('Zed', 'SB', 200), P('Abe', 'BB', 200)],
  heroIdx: 0,
  streets: [
    St('Preflop', 'As2sKdKc', ['', 'Ad2h9c9d'], '', [A(0, 'raise', 6), A(1, 'fold'), A(2, 'call', 4)]),
    St('Flop', '', ['', ''], '3s4s8h', [A(2, 'check'), A(0, 'bet', 13), A(2, 'call', 13)]),
    St('Turn', '', ['', ''], 'Ks', [A(2, 'check'), A(0, 'bet', 20), A(2, 'call', 20)]),
    St('River', '', ['', ''], 'Qd', [A(2, 'check'), A(0, 'check')]),
  ],
  result: { winners: [{ playerIdx: 0, split: true }, { playerIdx: 2, split: true }] },
});

// 19. PLO8 with no qualifying low: the high scoops, described "HI: …" alone.
add('19-plo8-no-low', {
  gameType: 'PLO8', gameMode: 'cash', currency: 'USD',
  blinds: { sb: 1, bb: 2 },
  players: [P('Hero', 'BTN', 200), P('Bly', 'SB', 200), P('Cho', 'BB', 200)],
  heroIdx: 0,
  streets: [
    St('Preflop', 'AhKhQs2c', ['', 'JdJc3s4d'], '', [A(0, 'raise', 6), A(1, 'fold'), A(2, 'call', 4)]),
    St('Flop', '', ['', ''], '9hTh6s', [A(2, 'check'), A(0, 'bet', 13), A(2, 'call', 13)]),
    St('Turn', '', ['', ''], 'Kc', [A(2, 'check'), A(0, 'check')]),
    St('River', '', ['', ''], '2h', [A(2, 'check'), A(0, 'bet', 30), A(2, 'call', 30)]),
  ],
  result: W(0),
});

// 20. Limit Omaha Hi/Lo.
add('20-o8', {
  gameType: 'O8', gameMode: 'cash', currency: 'USD',
  blinds: { sb: 2, bb: 4, bigBet: 8 },
  players: [P('Dot', 'CO', 300), P('Hero', 'BTN', 300), P('Emu', 'SB', 300), P('Fox', 'BB', 300)],
  heroIdx: 1,
  streets: [
    St('Preflop', 'Ac3dKdQc', ['', '', '2s4h5c9h'], '', [A(0, 'fold'), A(1, 'raise', 8), A(2, 'fold'), A(3, 'call', 4)]),
    St('Flop', '', e(3), '6d7sKh', [A(3, 'check'), A(1, 'bet', 4), A(3, 'call', 4)]),
    St('Turn', '', e(3), '8c', [A(3, 'bet', 8), A(1, 'call', 8)]),
    St('River', '', e(3), 'Ks', [A(3, 'check'), A(1, 'bet', 8), A(3, 'call', 8)]),
  ],
  result: { winners: [{ playerIdx: 1, split: true }, { playerIdx: 3, split: true }] },
});

// 21. Big O (five-card Omaha Hi/Lo).
add('21-big-o', {
  gameType: 'Big O', gameMode: 'cash', currency: 'USD',
  blinds: { sb: 1, bb: 2 },
  players: [P('Hero', 'BTN', 250), P('Gil', 'SB', 250), P('Hux', 'BB', 250)],
  heroIdx: 0,
  streets: [
    St('Preflop', 'Ah2h3dKsQs', ['', 'JcJdTc9d8s'], '', [A(0, 'raise', 6), A(1, 'fold'), A(2, 'call', 4)]),
    St('Flop', '', ['', ''], '4h5h9c', [A(2, 'check'), A(0, 'bet', 13), A(2, 'call', 13)]),
    St('Turn', '', ['', ''], 'Jh', [A(2, 'bet', 20), A(0, 'raise', 80), A(2, 'call', 60)]),
    St('River', '', ['', ''], '2c', [A(2, 'check'), A(0, 'bet', 100), A(2, 'fold')]),
  ],
  result: W(0),
});

// 22. Big Easy (six-card Omaha Hi/Lo).
add('22-big-easy', {
  gameType: 'Big Easy', gameMode: 'mtt',
  blinds: { sb: 100, bb: 200 },
  players: [P('Hero', 'BTN', 12000), P('Ivo', 'SB', 12000), P('Jem', 'BB', 12000)],
  heroIdx: 0,
  streets: [
    St('Preflop', 'Ac2d4h7s8sKd', ['', 'QcQdJhTs9c3c'], '', [A(0, 'raise', 600), A(1, 'fold'), A(2, 'call', 400)]),
    St('Flop', '', ['', ''], '5d6cQs', [A(2, 'bet', 1300), A(0, 'call', 1300)]),
    St('Turn', '', ['', ''], '9h', [A(2, 'check'), A(0, 'check')]),
    St('River', '', ['', ''], '2s', [A(2, 'check'), A(0, 'check')]),
  ],
  result: W(0),
});

// 23. Limit Omaha high.
add('23-lo-hi', {
  gameType: 'LO Hi', gameMode: 'cash', currency: 'GBP',
  blinds: { sb: 1, bb: 2, bigBet: 4 },
  players: [P('Hero', 'BTN', 150), P('Kat', 'SB', 150), P('Leo', 'BB', 150)],
  heroIdx: 0,
  streets: [
    St('Preflop', 'KhKcQhJc', ['', '9s8s7d6d'], '', [A(0, 'raise', 4), A(1, 'fold'), A(2, 'call', 2)]),
    St('Flop', '', ['', ''], 'Kd7c2h', [A(2, 'check'), A(0, 'bet', 2), A(2, 'raise', 4), A(0, 'raise', 4), A(2, 'call', 2)]),
    St('Turn', '', ['', ''], '5s', [A(2, 'bet', 4), A(0, 'raise', 8), A(2, 'call', 4)]),
    St('River', '', ['', ''], '3c', [A(2, 'check'), A(0, 'bet', 4), A(2, 'call', 4)]),
  ],
  result: W(0),
});

// 24. Stud: the bring-in, the complete, an opponent showing all seven
//     (3rd street holds his hidden cards in front of the door, newest first).
const studP = (names) => names.map((nm, i) => P(nm, 'Seat ' + (i + 1), 2000));
add('24-stud-hi', {
  gameType: 'Stud Hi', gameMode: 'cash', currency: 'USD',
  blinds: { sb: 0, bb: 0.5, bigBet: 1, ante: 0.1, bringIn: 0.25 },
  players: studP(['Hero', 'Mags', 'Nell']).map(p => ({ ...p, startingStack: 40 })),
  heroIdx: 0,
  streets: [
    St('3rd Street', 'AsAd8c', ['ThTc4c3d', 'Qs'], '', [A(1, 'bring-in', 0.25), A(2, 'raise', 0.5), A(0, 'call', 0.5), A(1, 'call', 0.25)]),
    St('4th Street', 'Kh', ['5h', 'Jh'], '', [A(0, 'bet', 0.5), A(1, 'call', 0.5), A(2, 'call', 0.5)]),
    St('5th Street', '7d', ['6s', '9d'], '', [A(0, 'bet', 1), A(1, 'call', 1), A(2, 'fold')]),
    St('6th Street', '2c', ['Jc', ''], '', [A(0, 'check'), A(1, 'bet', 1), A(0, 'call', 1)]),
    St('7th Street', '9s', ['', ''], '', [A(0, 'check'), A(1, 'check')]),
  ],
  result: W(0),
});

// 25. Stud Hi/Lo: the high and the low to different players.
add('25-stud8-split', {
  gameType: 'Stud 8', gameMode: 'mtt',
  blinds: { sb: 0, bb: 200, bigBet: 400, ante: 25, bringIn: 50 },
  players: studP(['Ora', 'Hero', 'Pip']).map(p => ({ ...p, startingStack: 8000 })),
  heroIdx: 1,
  streets: [
    St('3rd Street', 'Ac2d3h', ['QcKsKd9c', 'Qd'], '', [A(1, 'bet', 200), A(2, 'fold'), A(0, 'call', 200)]),
    St('4th Street', '5c', ['9h', ''], '', [A(0, 'bet', 200), A(1, 'call', 200)]),
    St('5th Street', 'Tc', ['4s', ''], '', [A(0, 'bet', 400), A(1, 'call', 400)]),
    St('6th Street', '7h', ['Jd', ''], '', [A(0, 'bet', 400), A(1, 'call', 400)]),
    St('7th Street', 'Qh', ['', ''], '', [A(0, 'bet', 400), A(1, 'call', 400)]),
  ],
  result: { winners: [{ playerIdx: 0, split: true }, { playerIdx: 1, split: true }] },
});

// 26. Razz: the HIGHEST door brings it in; the best low wins.
add('26-razz', {
  gameType: 'Razz', gameMode: 'cash', currency: 'USD',
  blinds: { sb: 0, bb: 2, bigBet: 4, ante: 0.25, bringIn: 0.5 },
  players: studP(['Hero', 'Quil', 'Ros']).map(p => ({ ...p, startingStack: 100 })),
  heroIdx: 0,
  streets: [
    St('3rd Street', 'As3d2c', ['Kh', '5h8d6s'], '', [A(1, 'bring-in', 0.5), A(2, 'raise', 2), A(0, 'raise', 4), A(1, 'fold'), A(2, 'call', 2)]),
    St('4th Street', '7s', ['', '9c'], '', [A(0, 'bet', 2), A(2, 'call', 2)]),
    St('5th Street', '4h', ['', '4c'], '', [A(0, 'bet', 4), A(2, 'call', 4)]),
    St('6th Street', 'Qs', ['', '2s'], '', [A(2, 'bet', 4), A(0, 'call', 4)]),
    St('7th Street', '8h', ['', ''], '', [A(2, 'check'), A(0, 'bet', 4), A(2, 'call', 4)]),
  ],
  result: W(0),
});

// 27. Stud where the opponent's hidden cards were never seen: he mucks at
//     showdown; the stored result says who won.
add('27-stud-unknown-hole', {
  gameType: 'Stud Hi', gameMode: 'mtt',
  blinds: { sb: 0, bb: 100, bigBet: 200, ante: 20, bringIn: 25 },
  players: studP(['Sal', 'Hero']).map(p => ({ ...p, startingStack: 5000 })),
  heroIdx: 1,
  streets: [
    St('3rd Street', 'QhQd9s', ['2c'], '', [A(0, 'bring-in', 25), A(1, 'raise', 100), A(0, 'call', 75)]),
    St('4th Street', '9h', ['6d'], '', [A(1, 'bet', 100), A(0, 'call', 100)]),
    St('5th Street', '3c', ['7d'], '', [A(1, 'bet', 200), A(0, 'call', 200)]),
    St('6th Street', 'Ks', ['8d'], '', [A(1, 'bet', 200), A(0, 'call', 200)]),
    St('7th Street', '4h', [''], '', [A(1, 'bet', 200), A(0, 'call', 200)]),
  ],
  result: W(1),
});

// 28. 2-7 Triple Draw: the hero's discards and draws known, the opponent's
//     counts only; the opponent's final hand shown.
add('28-27td', {
  gameType: '2-7 TD', gameMode: 'cash', currency: 'USD',
  blinds: { sb: 0.5, bb: 1, bigBet: 2 },
  players: [P('Hero', 'BTN', 80), P('Tex', 'SB', 80), P('Ula', 'BB', 80)],
  heroIdx: 0,
  streets: [
    St('Pre-Draw', '2h4c7dKsQs', ['', '3s5d6h8cTh'], '', [A(0, 'raise', 2), A(1, 'fold'), A(2, 'call', 1)], [D(2, 2), D(0, 2, 'KsQs', '8d3c')]),
    St('First Draw', '', ['', ''], '', [A(2, 'check'), A(0, 'bet', 1), A(2, 'call', 1)], [D(2, 1), D(0, 1, '8d', '5s')]),
    St('Second Draw', '', ['', ''], '', [A(2, 'bet', 2), A(0, 'raise', 4), A(2, 'call', 2)], [D(2, 0), D(0, 0)]),
    St('Third Draw', '', ['', ''], '', [A(2, 'check'), A(0, 'bet', 2), A(2, 'call', 2)]),
  ],
  result: W(0),
});

// 29. Badugi.
add('29-badugi', {
  gameType: 'Badugi', gameMode: 'mtt',
  blinds: { sb: 50, bb: 100, bigBet: 200 },
  players: [P('Vic', 'CO', 6000), P('Hero', 'BTN', 6000), P('Wyn', 'SB', 6000), P('Xer', 'BB', 6000)],
  heroIdx: 1,
  streets: [
    St('Pre-Draw', 'Ac4d7hKh', ['', '', '2s3hJcJd'], '', [A(0, 'fold'), A(1, 'raise', 200), A(2, 'fold'), A(3, 'call', 100)], [D(3, 1), D(1, 1, 'Kh', '9s')]),
    St('First Draw', '', ['', '', ''], '', [A(3, 'check'), A(1, 'bet', 100), A(3, 'call', 100)], [D(3, 1), D(1, 0)]),
    St('Second Draw', '', ['', '', ''], '', [A(3, 'bet', 200), A(1, 'call', 200)], [D(3, 0), D(1, 0)]),
    St('Third Draw', '', ['', '', ''], '', [A(3, 'check'), A(1, 'bet', 200), A(3, 'call', 200)]),
  ],
  result: W(1),
});
// The opponent's showdown hand (Badugi only has four cards).
fixtures['29-badugi'].hand.streets[0].cards.opponents = ['', '', '2s3hQc5d'];

// 30. No-limit 2-7 Single Draw: the discards follow the pre-draw betting with
//     no header, and a pre-draw fold reads "folded before Flop".
add('30-nl27sd', {
  gameType: 'NL 2-7 SD', gameMode: 'cash', currency: 'USD',
  blinds: { sb: 0.25, bb: 0.5 },
  players: [P('Yan', 'CO', 50), P('Hero', 'BTN', 50), P('Zia', 'SB', 50), P('Ada', 'BB', 50)],
  heroIdx: 1,
  streets: [
    St('Pre-Draw', '2s4d6h7cKd', ['', '', '3h5c8d9sJh'], '', [A(0, 'fold'), A(1, 'raise', 1.5), A(2, 'fold'), A(3, 'call', 1)], [D(3, 1), D(1, 1, 'Kd', '3d')]),
    St('Draw', '', ['', '', ''], '', [A(3, 'check'), A(1, 'bet', 2.5), A(3, 'call', 2.5)]),
  ],
  result: W(1),
});
fixtures['30-nl27sd'].hand.streets[0].cards.opponents = ['', '', '3h5c8d9sTc'];

// 31. Pot-limit Five Card Draw (high).
add('31-pl5cd', {
  gameType: 'PL 5CD Hi', gameMode: 'cash', currency: 'CAD',
  blinds: { sb: 0.5, bb: 1 },
  players: [P('Hero', 'BTN', 100), P('Bao', 'SB', 100), P('Cai', 'BB', 100)],
  heroIdx: 0,
  streets: [
    St('Pre-Draw', 'QhQd7s4c2h', ['', '9c9d8h8s3c'], '', [A(0, 'raise', 3), A(1, 'fold'), A(2, 'call', 2)], [D(2, 1), D(0, 3, '7s4c2h', 'QsKd5h')]),
    St('Draw', '', ['', ''], '', [A(2, 'bet', 4), A(0, 'raise', 16), A(2, 'call', 12)]),
  ],
  result: W(0),
});
fixtures['31-pl5cd'].hand.streets[0].cards.opponents = ['', '9c9d8h8sAs'];

// 32. A tournament with its buy-in, level and number given.
add('32-tourney-buyin', {
  gameType: 'NLH', gameMode: 'mtt',
  blinds: { sb: 300, bb: 600, ante: 600 },
  players: [P('Dio', 'HJ', 41000), P('Hero', 'CO', 38250), P('Eko', 'BTN', 52000), P('Fay', 'SB', 18000), P('Gem', 'BB', 27500)],
  heroIdx: 1,
  streets: [
    St('Preflop', 'TsTd', e(4), '', [A(0, 'fold'), A(1, 'raise', 1350), A(2, 'fold'), A(3, 'fold'), A(4, 'call', 750)]),
    St('Flop', '', e(4), 'Ah9c4s', [A(4, 'check'), A(1, 'check')]),
    St('Turn', '', e(4), '4d', [A(4, 'bet', 1800), A(1, 'fold')]),
    St('River', '', e(4), '', []),
  ],
  result: W(4),
}, { tournament: { id: '3456789012', buyIn: 10, fee: 1, currency: 'USD', level: 7 } });

// 33. Names to clean: a colon and brackets, a duplicate (case-insensitive), an
//     empty name — and the hero renamed by heroName.
add('33-names', {
  gameType: 'NLH', gameMode: 'cash', currency: 'USD',
  blinds: { sb: 1, bb: 2 },
  players: [P('Bob: The (Great)', 'CO', 200), P('bob the great', 'BTN', 200), P('', 'SB', 200), P('[me]', 'BB', 200)],
  heroIdx: 3,
  streets: [
    St('Preflop', '8s8d', ['', '', ''], '', [A(0, 'raise', 5), A(1, 'fold'), A(2, 'fold'), A(3, 'call', 3)]),
    St('Flop', '', e(3), 'Kh8h2c', [A(3, 'check'), A(0, 'bet', 6), A(3, 'raise', 20), A(0, 'fold')]),
    St('Turn', '', e(3), '', []), St('River', '', e(3), '', []),
  ],
  result: W(3),
}, { heroName: 'Ethan B.' });

// 34. A legacy save, as sample-hands.json holds it: playerIdx, players out of
//     seat order, the old { winner } result.
{
  const sample = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'sample-hands.json'), 'utf8'))[0];
  add('34-legacy-sample', sample);
}

// 35. A hand imported from PokerStars: its hand number, table, seats kept.
add('35-imported-reuse', {
  gameType: 'NLH', gameMode: 'cash', currency: 'USD',
  blinds: { sb: 0.25, bb: 0.5 },
  players: [P('vanessa_k', 'HJ', 48.1), P('Hero', 'CO', 50), P('mtnman', 'BTN', 61.75), P('Quokka99', 'SB', 22.4), P('Bertrand', 'BB', 50)],
  heroIdx: 1,
  streets: [
    St('Preflop', 'Ah5h', ['', '', '', 'QcJc'], '', [A(0, 'fold'), A(1, 'raise', 1.25), A(2, 'fold'), A(3, 'fold'), A(4, 'call', 0.75)]),
    St('Flop', '', e(4), 'Jh9h3s', [A(4, 'check'), A(1, 'bet', 1.6), A(4, 'call', 1.6)]),
    St('Turn', '', e(4), '2d', [A(4, 'check'), A(1, 'bet', 3.9), A(4, 'call', 3.9)]),
    St('River', '', e(4), '4c', [A(4, 'check'), A(1, 'bet', 8.5), A(4, 'call', 8.5)]),
  ],
  result: W(1),
  import: {
    site: 'pokerstars', siteName: 'PokerStars', handId: '245893457123', tableName: 'Aludra II', maxSeats: 6,
    seatNumbers: [2, 3, 5, 6, 1], playedAt: '2025-03-01T02:14:09.000Z', notes: [],
  },
}, { playedAt: undefined });

// ── Errors ──────────────────────────────────────────────────────────────────
const simple = (gameType, extra = {}) => ({
  gameType, gameMode: 'mtt',
  blinds: { sb: 100, bb: 200 },
  players: [P('Hero', 'BTN', 5000), P('Uno', 'SB', 5000), P('Duo', 'BB', 5000)],
  heroIdx: 0,
  streets: [
    St('Preflop', 'AhKh', ['', ''], '', [A(0, 'raise', 600), A(1, 'fold'), A(2, 'fold')]),
    St('Flop', '', ['', ''], '', []), St('Turn', '', ['', ''], '', []), St('River', '', ['', ''], '', []),
  ],
  result: W(0),
  ...extra,
});
for (const g of ['A-5 TD', 'Badeucy', 'Badacy', '2-7 Razz', 'NL Stud Hi', 'OFC', 'Super Stud Hi', 'Pineapple Custom']) {
  addError('game-' + g.toLowerCase().replace(/[^a-z0-9]+/g, '-'), simple(g), 'unsupported-game');
}
addError('aud-cash', simple('NLH', { gameMode: 'cash', currency: 'AUD' }), 'unsupported-currency');
addError('unfinished', {
  ...simple('NLH'),
  streets: [
    St('Preflop', 'AhKh', ['', ''], '', [A(0, 'raise', 600), A(1, 'fold'), A(2, 'call', 400)]),
    St('Flop', '', ['', ''], 'Qs7d2c', [A(2, 'check')]),
    St('Turn', '', ['', ''], '', []), St('River', '', ['', ''], '', []),
  ],
}, 'unfinished');
addError('board-missing', {
  ...simple('NLH'),
  streets: [
    St('Preflop', 'AhKh', ['', ''], '', [A(0, 'raise', 600), A(1, 'fold'), A(2, 'call', 400)]),
    St('Flop', '', ['', ''], 'Qs7d2c', [A(2, 'check'), A(0, 'check')]),
    St('Turn', '', ['', ''], '', [A(2, 'check'), A(0, 'check')]),
    St('River', '', ['', ''], '', [A(2, 'check'), A(0, 'check')]),
  ],
}, 'board-missing');
addError('no-winner', {
  ...simple('NLH'),
  streets: [
    St('Preflop', 'AhKh', ['', ''], '', [A(0, 'raise', 600), A(1, 'fold'), A(2, 'call', 400)]),
    St('Flop', '', ['', ''], 'Qs7d2c', [A(2, 'check'), A(0, 'check')]),
    St('Turn', '', ['', ''], '9h', [A(2, 'check'), A(0, 'check')]),
    St('River', '', ['', ''], '3s', [A(2, 'check'), A(0, 'check')]),
  ],
  result: null,
}, 'no-winner');
addError('out-of-turn', {
  ...simple('NLH'),
  streets: [
    St('Preflop', 'AhKh', ['', ''], '', [A(0, 'raise', 600), A(1, 'fold'), A(2, 'call', 400)]),
    St('Flop', '', ['', ''], 'Qs7d2c', [A(0, 'bet', 600), A(2, 'call', 600)]),
    St('Turn', '', ['', ''], '', []), St('River', '', ['', ''], '', []),
  ],
}, 'out-of-turn');
addError('check-facing-bet', {
  ...simple('NLH'),
  streets: [
    St('Preflop', 'AhKh', ['', ''], '', [A(0, 'raise', 600), A(1, 'fold'), A(2, 'check')]),
    St('Flop', '', ['', ''], '', []), St('Turn', '', ['', ''], '', []), St('River', '', ['', ''], '', []),
  ],
}, 'bad-action');
addError('call-mismatch', {
  ...simple('NLH'),
  streets: [
    St('Preflop', 'AhKh', ['', ''], '', [A(0, 'raise', 600), A(1, 'fold'), A(2, 'call', 250)]),
    St('Flop', '', ['', ''], '', []), St('Turn', '', ['', ''], '', []), St('River', '', ['', ''], '', []),
  ],
}, 'bad-amount');
addError('seating', {
  ...simple('NLH'),
  players: [P('Hero', 'BTN', 5000), P('Uno', 'BTN', 5000), P('Duo', 'BB', 5000)],
}, 'seating');
addError('stack-missing', {
  ...simple('NLH'),
  players: [P('Hero', 'BTN', 5000), P('Uno', 'SB', null), P('Duo', 'BB', 5000)],
}, 'stack-missing');
addError('hero-cards', {
  ...simple('NLH'),
  streets: [St('Preflop', 'AhKx', ['', ''], '', [A(0, 'raise', 600), A(1, 'fold'), A(2, 'fold')]), St('Flop', '', ['', ''], '', []), St('Turn', '', ['', ''], '', []), St('River', '', ['', ''], '', [])],
}, 'hero-cards-unknown');
addError('draw-cards', {
  ...fixtures['28-27td'].hand,
  streets: fixtures['28-27td'].hand.streets.map((s, i) => (i === 0 ? { ...s, draws: [D(2, 2), D(0, 2, 'KsQs', '')] } : s)),
}, 'draw-cards-unknown');

for (const [name, fx] of Object.entries(fixtures)) {
  if (fx.opts.playedAt === undefined) delete fx.opts.playedAt;
  fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(fx, null, 2) + '\n');
}
console.log(Object.keys(fixtures).length + ' fixtures written to ' + out);
