/**
 * Quick-add part A: the gap rules (vite-app/src/utils/quick-add/gaps.js).
 *
 * Complete hands in every game family must raise no blocking gap; each rule
 * must fire on a minimal broken hand; the list must come out most fundamental
 * first; and applying a gap's first option must make that gap go away.
 *
 * Run: node test/quick-add/gaps.test.mjs
 */

import assert from 'node:assert/strict';
import { findGaps, applyAnswer } from '../../vite-app/src/utils/quick-add/gaps.js';
import { HAND_CONFIG as QA_HAND_CONFIG, HAND_CONFIG_DEFAULT as QA_DEFAULT } from '../../vite-app/src/utils/quick-add/game.js';

// ── tiny harness ─────────────────────────────────────────────────────────
let assertions = 0, passed = 0, failed = 0;
const failures = [];
function check(fn) { assertions++; fn(); }
const ok = (v, msg) => check(() => assert.ok(v, msg));
const eq = (a, b, msg) => check(() => assert.deepStrictEqual(a, b, msg));
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; failures.push(name + '\n    ' + (e && e.message ? e.message.split('\n').join('\n    ') : e)); }
}

// ── builders ─────────────────────────────────────────────────────────────
const clone = (h) => JSON.parse(JSON.stringify(h));
const P = (name, position, startingStack) => ({ name, position, startingStack });
const A = (player, action, amount = 0) => ({ player, action, amount });
const St = (name, hero, opponents, board, actions, draws) => ({ name, cards: { hero: hero || '', opponents, board: board || '' }, actions: actions || [], draws: draws || [] });
const D = (player, discarded, discardedCards = '', newCards = '') => ({ player, discarded, discardedCards, newCards });
const blocking = (gaps) => gaps.filter(g => g.blocking);
const ids = (h) => findGaps(h).map(g => g.id);
const gap = (h, id) => findGaps(h).find(g => g.id === id);
const firstGap = (h) => findGaps(h)[0];
const answerFirst = (h, g) => applyAnswer(h, g, g.options[0].value);
const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const e5 = () => ['', '', '', '', ''];

// ── complete hands ───────────────────────────────────────────────────────
function nlh6max() {
  return {
    gameType: 'NLH', gameMode: 'mtt', currency: 'USD',
    blinds: { sb: 100, bb: 200, ante: 200 },
    players: [P('Alex', 'LJ', 20000), P('Ben', 'HJ', 20000), P('Cal', 'CO', 20000), P('Hero', 'BTN', 20000), P('Eve', 'SB', 20000), P('Finn', 'BB', 20000)],
    heroIdx: 3,
    streets: [
      St('Preflop', 'AsKs', ['', '', 'QhQd', '', ''], '', [A(0, 'fold'), A(1, 'fold'), A(2, 'raise', 500), A(3, 'raise', 1500), A(4, 'fold'), A(5, 'fold'), A(2, 'call', 1000)]),
      St('Flop', '', e5(), 'AhKd2c', [A(2, 'check'), A(3, 'bet', 1200), A(2, 'call', 1200)]),
      St('Turn', '', e5(), '7s', [A(2, 'check'), A(3, 'check')]),
      St('River', '', e5(), '9h', [A(2, 'bet', 3000), A(3, 'call', 3000)]),
    ],
    result: { winners: [{ playerIdx: 3, split: false }] },
  };
}

function nlhHeadsUp() {
  return {
    gameType: 'NLH', gameMode: 'cash', currency: 'USD',
    blinds: { sb: 50, bb: 100, ante: 0 },
    players: [P('Hero', 'BTN/SB', 10000), P('Vince', 'BB', 10000)],
    heroIdx: 0,
    streets: [
      St('Preflop', 'AhKh', [''], '', [A(0, 'raise', 250), A(1, 'call', 200)]),
      St('Flop', '', [''], 'Qs8d3c', [A(1, 'check'), A(0, 'bet', 300), A(1, 'raise', 900), A(0, 'call', 600)]),
      St('Turn', '', [''], '2h', [A(1, 'bet', 1500), A(0, 'fold')]),
      St('River', '', [''], '', []),
    ],
    result: { winners: [{ playerIdx: 1, split: false }] },
  };
}

function nlhStraddle() {
  return {
    gameType: 'NLH', gameMode: 'cash', currency: 'USD',
    blinds: { sb: 1, bb: 2, ante: 0, straddle: true, straddle_utg: true },
    players: [P('Ula', 'LJ', 400), P('Hal', 'HJ', 400), P('Cid', 'CO', 400), P('Hero', 'BTN', 400), P('Sam', 'SB', 400), P('Bea', 'BB', 400)],
    heroIdx: 3,
    streets: [
      St('Preflop', 'TsTd', e5(), '', [A(1, 'call', 4), A(2, 'fold'), A(3, 'raise', 16), A(4, 'fold'), A(5, 'fold'), A(0, 'call', 12), A(1, 'call', 12)]),
      St('Flop', '', e5(), 'Jh9h2s', [A(0, 'check'), A(1, 'check'), A(3, 'bet', 30), A(0, 'fold'), A(1, 'fold')]),
      St('Turn', '', e5(), '', []),
      St('River', '', e5(), '', []),
    ],
    result: { winners: [{ playerIdx: 3, split: false }] },
  };
}

function plo6max() {
  return {
    gameType: 'PLO', gameMode: 'cash', currency: 'USD',
    blinds: { sb: 100, bb: 200, ante: 0 },
    players: [P('Alex', 'LJ', 20000), P('Ben', 'HJ', 20000), P('Cal', 'CO', 20000), P('Hero', 'BTN', 20000), P('Eve', 'SB', 20000), P('Finn', 'BB', 20000)],
    heroIdx: 3,
    streets: [
      St('Preflop', 'AsKsQdJd', e5(), '', [A(0, 'fold'), A(1, 'fold'), A(2, 'raise', 700), A(3, 'raise', 2400), A(4, 'fold'), A(5, 'fold'), A(2, 'call', 1700)]),
      St('Flop', '', e5(), 'Ah7c2d', [A(2, 'check'), A(3, 'bet', 2550), A(2, 'call', 2550)]),
      St('Turn', '', e5(), '9s', [A(2, 'check'), A(3, 'check')]),
      St('River', '', e5(), '3h', [A(2, 'check'), A(3, 'bet', 5000), A(2, 'fold')]),
    ],
    result: { winners: [{ playerIdx: 3, split: false }] },
  };
}

function lhe6max() {
  return {
    gameType: 'LHE', gameMode: 'cash', currency: 'USD',
    blinds: { sb: 100, bb: 200, ante: 0 },
    players: [P('Alex', 'LJ', 10000), P('Ben', 'HJ', 10000), P('Cal', 'CO', 10000), P('Hero', 'BTN', 10000), P('Eve', 'SB', 10000), P('Finn', 'BB', 10000)],
    heroIdx: 3,
    streets: [
      St('Preflop', 'AdAc', ['', '', '', '', 'QcJc'], '', [A(0, 'fold'), A(1, 'raise', 400), A(2, 'fold'), A(3, 'raise', 600), A(4, 'fold'), A(5, 'call', 400), A(1, 'call', 200)]),
      St('Flop', '', e5(), 'Ks7h2s', [A(5, 'check'), A(1, 'check'), A(3, 'bet', 200), A(5, 'call', 200), A(1, 'fold')]),
      St('Turn', '', e5(), '4d', [A(5, 'check'), A(3, 'bet', 400), A(5, 'call', 400)]),
      St('River', '', e5(), '9c', [A(5, 'check'), A(3, 'check')]),
    ],
    result: { winners: [{ playerIdx: 3, split: false }] },
  };
}

function studHi() {
  const o = (a, b, c) => [a, b, c];
  return {
    gameType: 'Stud Hi', gameMode: 'mtt', currency: 'USD',
    blinds: { bb: 200, bigBet: 400, bringIn: 50, ante: 25 },
    players: [P('Hero', 'Seat 1', 12000), P('Pia', 'Seat 2', 12000), P('Quin', 'Seat 3', 12000), P('Rex', 'Seat 4', 12000)],
    heroIdx: 0,
    streets: [
      St('3rd Street', 'AsKdQh', o('2c', '9d', 'AhAcJc'), '', [A(1, 'bring-in', 50), A(2, 'fold'), A(3, 'call', 50), A(0, 'bet', 200), A(1, 'call', 150), A(3, 'call', 150)]),
      St('4th Street', '5c', o('8h', '', 'Td'), '', [A(0, 'bet', 200), A(1, 'fold'), A(3, 'call', 200)]),
      St('5th Street', '7d', o('', '', '6s'), '', [A(0, 'bet', 400), A(3, 'call', 400)]),
      St('6th Street', '8c', o('', '', '3d'), '', [A(0, 'check'), A(3, 'check')]),
      St('7th Street', '9s', o('', '', 'Kc'), '', [A(0, 'bet', 400), A(3, 'call', 400)]),
    ],
    result: { winners: [{ playerIdx: 3, split: false }] },
  };
}

function razz() {
  return {
    gameType: 'Razz', gameMode: 'mtt', currency: 'USD',
    blinds: { bb: 200, bigBet: 400, bringIn: 50, ante: 25 },
    players: [P('Hero', 'Seat 1', 12000), P('Kim', 'Seat 2', 12000), P('Lou', 'Seat 3', 12000)],
    heroIdx: 0,
    streets: [
      St('3rd Street', 'Ah2d3c', ['Kd', '5h'], '', [A(1, 'bring-in', 50), A(2, 'bet', 200), A(0, 'raise', 400), A(1, 'fold'), A(2, 'call', 200)]),
      St('4th Street', '4s', ['', '6d'], '', [A(0, 'bet', 200), A(2, 'call', 200)]),
      St('5th Street', '7h', ['', 'Qc'], '', [A(0, 'bet', 400), A(2, 'fold')]),
      St('6th Street', '', ['', ''], '', []),
      St('7th Street', '', ['', ''], '', []),
    ],
    result: { winners: [{ playerIdx: 0, split: false }] },
  };
}

function tripleDraw27() {
  return {
    gameType: '2-7 TD', gameMode: 'cash', currency: 'USD',
    blinds: { sb: 100, bb: 200, ante: 0 },
    players: [P('Cy', 'CO', 10000), P('Hero', 'BTN', 10000), P('Sid', 'SB', 10000), P('Bo', 'BB', 10000)],
    heroIdx: 1,
    streets: [
      St('Pre-Draw', '2s3d4h8c9d', ['', '', ''], '', [A(0, 'fold'), A(1, 'raise', 400), A(2, 'fold'), A(3, 'call', 200)], [D(1, 1, '9d', '7c'), D(3, 2)]),
      St('First Draw', '', ['', '', ''], '', [A(3, 'check'), A(1, 'bet', 200), A(3, 'call', 200)], [D(1, 0), D(3, 1)]),
      St('Second Draw', '', ['', '', ''], '', [A(3, 'check'), A(1, 'bet', 400), A(3, 'call', 400)], [D(1, 0), D(3, 1)]),
      St('Third Draw', '', ['', '', ''], '', [A(3, 'check'), A(1, 'bet', 400), A(3, 'fold')]),
    ],
    result: { winners: [{ playerIdx: 1, split: false }] },
  };
}

function badugi() {
  return {
    gameType: 'Badugi', gameMode: 'cash', currency: 'USD',
    blinds: { sb: 100, bb: 200, ante: 0 },
    players: [P('Bree', 'BTN', 10000), P('Hero', 'SB', 10000), P('Bo', 'BB', 10000)],
    heroIdx: 1,
    streets: [
      St('Pre-Draw', 'As2d3h7h', ['', '5c6d7s8h'], '', [A(0, 'fold'), A(1, 'call', 100), A(2, 'check')], [D(1, 1, '7h', '4c'), D(2, 2)]),
      St('First Draw', '', ['', ''], '', [A(1, 'check'), A(2, 'bet', 200), A(1, 'call', 200)], [D(1, 0), D(2, 1)]),
      St('Second Draw', '', ['', ''], '', [A(1, 'check'), A(2, 'check')], [D(1, 0), D(2, 0)]),
      St('Third Draw', '', ['', ''], '', [A(1, 'bet', 400), A(2, 'call', 400)]),
    ],
    result: { winners: [{ playerIdx: 1, split: false }] },
  };
}

function singleDraw() {
  return {
    gameType: 'NL 2-7 SD', gameMode: 'cash', currency: 'USD',
    blinds: { sb: 100, bb: 200, ante: 0 },
    players: [P('Hero', 'BTN/SB', 8000), P('Nia', 'BB', 8000)],
    heroIdx: 0,
    streets: [
      St('Pre-Draw', '2c3c4d7h9s', ['8s7s6d4c3h'], '', [A(0, 'raise', 500), A(1, 'call', 400)], [D(1, 1), D(0, 1, '9s', '5h')]),
      St('Draw', '', [''], '', [A(1, 'check'), A(0, 'bet', 600), A(1, 'call', 600)]),
    ],
    result: { winners: [{ playerIdx: 0, split: false }] },
  };
}

const COMPLETE = { NLH: nlh6max, 'NLH heads-up': nlhHeadsUp, 'NLH straddle': nlhStraddle, PLO: plo6max, LHE: lhe6max, 'Stud Hi': studHi, Razz: razz, '2-7 TD': tripleDraw27, Badugi: badugi, 'NL 2-7 SD': singleDraw };

// ═════════════════════════════════════════════════════════════════════════
// 1. Complete hands are clean
// ═════════════════════════════════════════════════════════════════════════
for (const [name, make] of Object.entries(COMPLETE)) {
  test('complete ' + name + ' hand has no gaps', () => {
    const gaps = findGaps(make());
    eq(blocking(gaps).map(g => g.id), [], name + ': blocking gaps ' + JSON.stringify(blocking(gaps), null, 1));
    eq(gaps.map(g => g.id), [], name + ': gaps ' + JSON.stringify(gaps, null, 1));
  });
}

test('findGaps does not modify its input', () => {
  const h = deepFreeze(nlh6max());
  findGaps(h);
  const broken = clone(nlh6max()); broken.blinds = {}; broken.players[2].startingStack = null;
  deepFreeze(broken);
  ok(findGaps(broken).length > 0);
});

test('the quick-add HAND_CONFIG copy matches utils.js', async () => {});

// ═════════════════════════════════════════════════════════════════════════
// 2. The game
// ═════════════════════════════════════════════════════════════════════════
test('missing game is the first gap and blocks', () => {
  const h = nlh6max(); delete h.gameType;
  const g = firstGap(h);
  eq(g.id, 'game'); eq(g.kind, 'missing'); ok(g.blocking);
  ok(g.options.some(o => o.label === 'NLH'));
  const fixed = answerFirst(h, g);
  ok(!ids(fixed).includes('game'));
});

test('an unknown game name gets its best guess first', () => {
  const h = nlh6max(); h.gameType = "Texas Hold'em";
  const g = firstGap(h);
  eq(g.id, 'game'); eq(g.kind, 'ambiguous'); eq(g.options[0].label, 'NLH');
  const h2 = plo6max(); h2.gameType = 'pot limit omaha';
  eq(firstGap(h2).options[0].label, 'PLO');
  const h3 = tripleDraw27(); h3.gameType = 'deuce to seven triple draw';
  eq(firstGap(h3).options[0].label, '2-7 TD');
  eq(findGaps(answerFirst(h3, firstGap(h3))).map(g => g.id), []);
});

// ═════════════════════════════════════════════════════════════════════════
// 3. Layout
// ═════════════════════════════════════════════════════════════════════════
test('missing arrays and card slots raise an auto structure gap', () => {
  const h = nlh6max();
  delete h.streets[2].draws; delete h.streets[3].cards.opponents; h.players[1].name = '';
  const g = gap(h, 'structure');
  ok(g && g.blocking && g.auto);
  const fixed = answerFirst(h, g);
  eq(ids(fixed), []);
  eq(fixed.streets[3].cards.opponents.length, 5);
  eq(fixed.players[1].name, 'Opp 2', 'seats before the hero number from 1');
});

test('missing streets are padded to the game', () => {
  const h = nlhHeadsUp(); h.streets = h.streets.slice(0, 3);
  ok(ids(h).includes('structure'));
  eq(applyAnswer(h, gap(h, 'structure'), gap(h, 'structure').options[0].value).streets.length, 4);
});

test('extra streets with content are blocking', () => {
  const h = nlh6max(); h.streets.push(St('Fifth', '', e5(), 'Jc', [A(2, 'check')]));
  const g = gap(h, 'streets');
  ok(g && g.blocking);
  eq(answerFirst(h, g).streets.length, 4);
});

// ═════════════════════════════════════════════════════════════════════════
// 4. Blinds
// ═════════════════════════════════════════════════════════════════════════
test('missing big blind blocks, with 2 x SB as the guess', () => {
  const h = nlh6max(); delete h.blinds.bb;
  const g = gap(h, 'blinds.bb');
  ok(g.blocking); eq(g.options[0].label, '100/200');
  eq(answerFirst(h, g).blinds.bb, 200);
});

test('missing blinds guess the limp size', () => {
  const h = nlh6max(); h.blinds = { ante: 0 };
  h.streets[0].actions = [A(0, 'call', 200), A(1, 'fold'), A(2, 'fold'), A(3, 'fold'), A(4, 'fold'), A(5, 'check')];
  const g = gap(h, 'blinds.bb');
  eq(g.options[0].label, '100/200');
  const fixed = answerFirst(h, g);
  eq([fixed.blinds.sb, fixed.blinds.bb], [100, 200]);
});

test('missing small blind offers half the big blind', () => {
  const h = nlh6max(); delete h.blinds.sb;
  const g = gap(h, 'blinds.sb');
  ok(g.blocking); eq(g.options[0].value, { op: 'set', path: 'blinds.sb', value: 100 });
  ok(!ids(answerFirst(h, g)).includes('blinds.sb'));
});

test('small blind bigger than the big blind', () => {
  const h = nlh6max(); h.blinds.sb = 400;
  const g = gap(h, 'blinds.sb');
  eq(g.kind, 'impossible');
  const fixed = answerFirst(h, g);
  eq([fixed.blinds.sb, fixed.blinds.bb], [200, 400]);
});

test('stud ante and tournament BB ante are asked, non-blocking', () => {
  const s = studHi(); delete s.blinds.ante;
  const g = gap(s, 'blinds.ante');
  ok(g && !g.blocking); eq(g.options[0].value.value, 25);
  const t = nlh6max(); delete t.blinds.ante;
  const g2 = gap(t, 'blinds.ante');
  ok(g2 && !g2.blocking); eq(g2.options[0].value.value, 200);
  const c = nlhHeadsUp(); delete c.blinds.ante;
  ok(!ids(c).includes('blinds.ante'), 'cash hold\'em does not ask about antes');
});

test('a straddle with no type is asked about', () => {
  const h = nlhStraddle(); delete h.blinds.straddle_utg;
  const g = gap(h, 'straddle');
  ok(g && !g.blocking);
  eq(ids(answerFirst(h, g)), []);
});

// ═════════════════════════════════════════════════════════════════════════
// 5. Players, hero, positions
// ═════════════════════════════════════════════════════════════════════════
test('no players: how many were dealt in', () => {
  const h = nlh6max(); h.players = []; h.heroIdx = null;
  h.streets.forEach(s => { s.actions = []; s.cards.opponents = []; });
  const g = gap(h, 'players');
  ok(g.blocking); eq(g.field, 'tableSize'); eq(g.options[0].value, { op: 'setTableSize', n: 6 });
  const fixed = answerFirst(h, g);
  eq(fixed.players.length, 6);
  eq(fixed.players.map(p => p.position), ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
});

test('one player with a position is seated by it and becomes the hero', () => {
  const h = { gameType: 'NLH', blinds: { sb: 1, bb: 2, ante: 0 }, players: [P('Me', 'CO', 300)], streets: [] };
  const g = gap(h, 'players');
  eq(g.options[0].value.n, 6);
  const fixed = answerFirst(h, g);
  eq(fixed.players[2].name, 'Me'); eq(fixed.heroIdx, 2);
});

/* With no hero the server lays the card slots out as if seat 0 were the hero:
   cards.hero is seat 0's, opponents[] are seats 1..n-1. */
function noHeroLayout(h) {
  delete h.heroIdx;
  h.streets.forEach(s => { s.cards.hero = ''; s.cards.opponents = e5(); });
  h.streets[0].cards.opponents = ['', 'QhQd', 'AsKs', '', ''];
  return h;
}

test('missing hero: the player called Hero is the best guess', () => {
  const h = noHeroLayout(nlh6max());
  const g = gap(h, 'hero');
  ok(g.blocking); eq(g.options[0].value, { op: 'setHero', heroIdx: 3 });
  eq(ids(answerFirst(h, g)), []);
});

test('naming the hero moves every card string to its new slot', () => {
  const h = noHeroLayout(nlh6max());
  const fixed = applyAnswer(h, gap(h, 'hero'), { op: 'setHero', heroIdx: 3 });
  eq(fixed.streets[0].cards.hero, 'AsKs');
  eq(fixed.streets[0].cards.opponents, ['', '', 'QhQd', '', '']);
  // ...and changing it again carries them on.
  const again = applyAnswer(fixed, { id: 'x' }, { op: 'setHero', heroIdx: 2 });
  eq(again.streets[0].cards.hero, 'QhQd');
  eq(again.streets[0].cards.opponents, ['', '', 'AsKs', '', '']);
});

test('no positions at all: who had the button (guess from the first actor)', () => {
  const h = nlh6max(); h.players.forEach(p => { p.position = ''; });
  const g = gap(h, 'button');
  ok(g.blocking); eq(g.options[0].value, { op: 'seatByButton', button: 3 });
  eq(ids(answerFirst(h, g)), []);
});

test('positions listed out of order are re-seated, actions travel with players', () => {
  const h = nlh6max();
  // List the BB first: everything that names a player by index must follow.
  const order = [5, 0, 1, 2, 3, 4];
  const oldToNew = {}; order.forEach((o, i) => { oldToNew[o] = i; });
  h.players = order.map(i => h.players[i]);
  h.heroIdx = oldToNew[3];
  h.streets.forEach(s => { s.actions.forEach(a => { a.player = oldToNew[a.player]; }); s.cards.opponents = ['', '', '', 'QhQd', '']; });
  h.streets.slice(1).forEach(s => { s.cards.opponents = e5(); });
  h.result.winners[0].playerIdx = oldToNew[3];
  const g = gap(h, 'positions');
  ok(g.blocking && g.auto);
  const fixed = answerFirst(h, g);
  eq(fixed.players.map(p => p.name), ['Alex', 'Ben', 'Cal', 'Hero', 'Eve', 'Finn']);
  eq(fixed.heroIdx, 3);
  eq(fixed.streets[0].cards.opponents, ['', '', 'QhQd', '', '']);
  eq(ids(fixed), []);
});

test('UTG at a six-handed table is only a label (non-blocking)', () => {
  const h = nlh6max(); h.players[0].position = 'UTG'; h.players[1].position = 'MP';
  const g = gap(h, 'positions');
  ok(g && !g.blocking && g.auto);
  eq(ids(answerFirst(h, g)), []);
});

test('positions that do not fit the player count ask for the table size', () => {
  const h = {
    gameType: 'NLH', gameMode: 'cash', blinds: { sb: 1, bb: 2, ante: 0 },
    players: [P('Hero', 'UTG', 200), P('Vic', 'BTN', 200)], heroIdx: 0,
    streets: [St('Preflop', 'AhAd', [''], '', [A(0, 'raise', 6), A(1, 'call', 6)])],
  };
  const g = gap(h, 'table-size');
  ok(g.blocking); eq(g.field, 'tableSize'); eq(g.options[0].value, { op: 'setTableSize', n: 6 });
  const six = answerFirst(h, g);
  eq(six.players.length, 6); eq(six.players[0].name, 'Hero'); eq(six.players[3].name, 'Vic'); eq(six.heroIdx, 0);
  eq(six.streets[0].actions.map(a => a.player), [0, 3]);
  // ...and then the seats nobody mentioned folded in between.
  const next = firstGap(six);
  ok(next.id.startsWith('stack') || next.id.startsWith('action'), next.id);
});

test('two players on the button: ask where the second one sat', () => {
  const h = nlh6max(); h.players[2].position = 'BTN';
  const g = gap(h, 'seat:3');
  eq(g.kind, 'impossible'); ok(g.blocking);
  eq(g.options.map(o => o.label), ['CO']);
  const fixed = answerFirst(h, g);
  eq(fixed.players.map(p => p.position), ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
  eq(fixed.players[2].name, 'Hero'); eq(fixed.heroIdx, 2);
});

// ═════════════════════════════════════════════════════════════════════════
// 6. Stacks
// ═════════════════════════════════════════════════════════════════════════
test('all stacks missing: one question, 100 BB first', () => {
  const h = nlh6max(); h.players.forEach(p => { delete p.startingStack; });
  const g = gap(h, 'stacks');
  ok(g.blocking); ok(/100 BB/.test(g.options[0].label));
  const fixed = answerFirst(h, g);
  ok(fixed.players.every(p => p.startingStack === 20000));
  eq(ids(fixed), []);
});

test('a missing stack for a player who acted blocks; same as hero first', () => {
  const h = nlh6max(); h.players[2].startingStack = null;
  const g = gap(h, 'stack:2');
  ok(g.blocking); eq(g.options[0].value, { op: 'set', path: 'players.2.startingStack', value: 20000 });
  ok(/How deep was Cal/.test(g.question));
  // Seats that only folded share one optional question.
  const h2 = nlh6max(); delete h2.players[0].startingStack; delete h2.players[1].startingStack;
  ok(!ids(h2).includes('stack:0'));
  const g2 = gap(h2, 'stacks:others');
  ok(g2 && !g2.blocking, 'a seat that only folded does not block');
  ok(/Alex and Ben/.test(g2.question), g2.question);
  const filled = answerFirst(h2, g2);
  eq([filled.players[0].startingStack, filled.players[1].startingStack], [20000, 20000]);
  eq(ids(applyAnswer(h2, g2, g2.options[g2.options.length - 1].value)), [], 'or left blank');
});

test('a zero stack is impossible', () => {
  const h = nlh6max(); h.players[4].startingStack = 0;
  eq(gap(h, 'stack:4').kind, 'impossible');
});

test('a player who moved all-in: their stack is what went in', () => {
  const h = nlhHeadsUp();
  h.players[1].startingStack = null;
  h.streets[2].actions = [A(1, 'all-in', 8800), A(0, 'fold')];
  const g = gap(h, 'stack:1');
  eq(g.options[0].value.value, 10000);
  eq(ids(answerFirst(h, g)), []);
});

test('stud stacks are counted in big bets', () => {
  const h = studHi(); h.players.forEach(p => { p.startingStack = null; });
  ok(/30 big bets \(12,000\)/.test(gap(h, 'stacks').options[0].label));
});

// ═════════════════════════════════════════════════════════════════════════
// 7. Hero cards, notation, duplicates
// ═════════════════════════════════════════════════════════════════════════
test('missing hero cards block, with an "I don\'t remember" escape', () => {
  const h = plo6max(); h.streets[0].cards.hero = '';
  const g = gap(h, 'cards:hero');
  ok(g.blocking);
  const fixed = answerFirst(h, g);
  eq(fixed.streets[0].cards.hero, 'AxAxAxAx');
  eq(ids(fixed), [], 'no follow-up question about the suits of cards nobody saw');
});

test('hero card counts per game', () => {
  const p = plo6max(); p.streets[0].cards.hero = 'AsKs';
  eq(gap(p, 'cards:hero').kind, 'missing');
  p.streets[0].cards.hero = 'AsKsQdJdTd';
  eq(gap(p, 'cards:hero').kind, 'impossible');
  const s = studHi(); s.streets[0].cards.hero = 'AsKdQhJh';
  ok(/3rd street/.test(gap(s, 'cards:hero').question));
});

test('bad notation gets a cleaned guess', () => {
  const h = nlh6max(); h.streets[0].cards.hero = '10h10s';
  const g = gap(h, 'cards:hero');
  eq(g.options[0].value.value, 'ThTs');
  const o = nlh6max(); o.streets[0].cards.opponents[2] = 'Q? Q?';
  ok(gap(o, 'notation:streets.0.cards.opponents.2'));
  const b = nlh6max(); b.streets[1].cards.board = 'AhKd2';
  const gb = gap(b, 'notation:streets.1.cards.board');
  ok(gb && gb.blocking && /rank without a suit/.test(gb.question));
});

test('a duplicate card asks where it really was', () => {
  const h = nlh6max(); h.streets[1].cards.board = 'AsKd2c';
  const g = gap(h, 'dup:As');
  ok(g.blocking); eq(g.options.length, 2);
  const fixed = answerFirst(h, g);
  eq(fixed.streets[1].cards.board, 'Kd2c');
  // ...which leaves the flop short, the next thing to ask.
  eq(firstGap(fixed).id, 'board:1');
});

test('a card twice in one hand', () => {
  const h = nlhHeadsUp(); h.streets[0].cards.hero = 'AhAh';
  ok(gap(h, 'dup:Ah'));
});

test('hole cards stored on a later street are moved (non-blocking, auto)', () => {
  const h = nlh6max(); h.streets[0].cards.opponents[2] = ''; h.streets[2].cards.opponents[2] = 'QhQd';
  const g = gap(h, 'misplaced:streets.2.cards.opponents.2');
  ok(g && !g.blocking && g.auto);
  eq(answerFirst(h, g).streets[0].cards.opponents[2], 'QhQd');
});

// ═════════════════════════════════════════════════════════════════════════
// 8. Actions
// ═════════════════════════════════════════════════════════════════════════
test('an action by a player who does not exist: the expected seat first', () => {
  const h = nlh6max(); h.streets[0].actions[2].player = 9;
  const g = gap(h, 'action:0:2');
  eq(g.options[0].value.action.player, 2);
  eq(ids(answerFirst(h, g)), []);
});

test('an action word the replayer does not know is relabelled', () => {
  const h = nlhHeadsUp(); h.streets[2].actions[0].action = 'jams'; h.streets[2].actions[0].amount = 8800;
  const g = gap(h, 'action:2:0');
  ok(g.auto); eq(g.options[0].value.action.action, 'all-in');
  eq(ids(answerFirst(h, g)), []);
});

test('acting after folding', () => {
  const h = nlh6max(); h.streets[1].actions[0].player = 0;
  const g = gap(h, 'action:1:0');
  eq(g.kind, 'impossible'); ok(/already folded/.test(g.question));
  eq(g.options[0].value.action.player, 2);
});

test('skipped seats preflop are folds; a seat that plays later called', () => {
  const h = nlh6max();
  h.streets[0].actions = [A(2, 'raise', 500), A(3, 'raise', 1500), A(2, 'call', 1000)];
  const g = firstGap(h);
  eq(g.id, 'action:0:0'); eq(g.kind, 'ambiguous');
  eq(g.options[0].value.actions, [A(0, 'fold'), A(1, 'fold')]);
  const h2 = answerFirst(h, g);
  const g2 = firstGap(h2);
  eq(g2.id, 'action:0:4');
  eq(g2.options[0].value.actions, [A(4, 'fold'), A(5, 'fold')]);
  eq(ids(answerFirst(h2, g2)), []);
});

test('a postflop check that went unsaid', () => {
  const h = nlh6max(); h.streets[2].actions = [A(3, 'check')];
  // Cal (CO) acts first on the turn; the description only says hero checked.
  const g = gap(h, 'action:2:0');
  eq(g.options[0].value.actions, [A(2, 'check')]);
});

test('acting twice without a bet in between', () => {
  const h = nlh6max(); h.streets[2].actions = [A(2, 'check'), A(2, 'check'), A(3, 'check')];
  const g = gap(h, 'action:2:1');
  eq(g.kind, 'impossible'); eq(g.options[0].value.action.player, 3);
});

test('a check facing a bet', () => {
  const h = nlh6max(); h.streets[1].actions[2] = A(2, 'check');
  const g = gap(h, 'action:1:2');
  eq(g.kind, 'impossible');
  eq(g.options[0].value.action, A(2, 'call', 1200), 'Cal plays the turn, so call first');
});

test('a call for the wrong amount: the price first', () => {
  const h = nlh6max(); h.streets[0].actions[6] = A(2, 'call', 1500);
  const g = gap(h, 'action:0:6');
  eq(g.options[0].value.action.amount, 1000);
  ok(/500 was already in/.test(g.question));
  eq(ids(answerFirst(h, g)), []);
});

test('a call with no amount is filled in (auto)', () => {
  const h = nlh6max(); h.streets[3].actions[1] = { player: 3, action: 'call' };
  const g = gap(h, 'action:3:1');
  ok(g.auto && g.blocking); eq(g.options[0].value.action.amount, 3000);
});

test('a call with nothing to call is a check', () => {
  const h = nlh6max(); h.streets[2].actions[0] = A(2, 'call', 0);
  eq(gap(h, 'action:2:0').options[0].value.action.action, 'check');
});

test('a no-limit raise under the minimum, read in big blinds', () => {
  const h = nlh6max(); h.streets[0].actions[2] = A(2, 'raise', 3); // "raises 3" = 3 BB
  const g = gap(h, 'action:0:2');
  ok(/does not raise/.test(g.question), g.question);
  eq(g.options[0].value.action.amount, 600);
  const h2 = nlh6max(); h2.streets[0].actions[2] = A(2, 'raise', 300); // to 300: under the 400 minimum
  const g2 = gap(h2, 'action:0:2');
  ok(/minimum raise was to 400/.test(g2.question), g2.question);
  eq(g2.options[0].value.action.amount, 400);
});

test('a no-limit bet under the big blind', () => {
  const h = nlh6max(); h.streets[1].actions[1] = A(3, 'bet', 50);
  ok(/minimum/.test(gap(h, 'action:1:1').question));
});

test('a pot-limit raise over the pot offers the pot', () => {
  const h = plo6max(); h.streets[0].actions[3] = A(3, 'raise', 3000);
  const g = gap(h, 'action:0:3');
  ok(/pot-limit maximum was 2,400/.test(g.question));
  eq(g.options.map(o => o.value.action.amount), [2400]);
  eq(ids(answerFirst(h, g)), []);
});

test('a limit bet of the wrong size gets the limit size (auto)', () => {
  const h = lhe6max(); h.streets[2].actions[1] = A(3, 'bet', 200); // turn is a big-bet street
  const g = gap(h, 'action:2:1');
  ok(g.auto); eq(g.options[0].value.action.amount, 400);
  eq(ids(answerFirst(h, g)), []);
});

test('a limit raise given as the raise-to total', () => {
  const h = lhe6max(); h.streets[0].actions[5] = A(5, 'raise', 800); // BB: 600 -> 800 is "to 800"
  const g = gap(h, 'action:0:5');
  eq(g.options[0].value.action.amount, 600, 'raise to 800 from the 200 blind adds 600');
});

test('raising past the limit cap is questioned, not blocked', () => {
  const h = lhe6max(); h.blinds.betCap = 1;
  const g = gap(h, 'raise-cap:0:3');
  ok(g && !g.blocking);
  eq(answerFirst(h, g).blinds.betCap, 2);
  eq(ids(answerFirst(h, g)), []);
});

test('putting in more than the stack', () => {
  const h = nlhHeadsUp(); h.streets[2].actions = [A(1, 'bet', 12000), A(0, 'fold')];
  const g = gap(h, 'action:2:0');
  ok(/only 8,800 left/.test(g.question));
  eq(g.options[0].value.action.amount, 8800);
  eq(g.options[1].value, { op: 'set', path: 'players.1.startingStack', value: 13200 });
});

test('all-in amounts: missing is filled, wrong is questioned', () => {
  const h = nlhHeadsUp(); h.streets[2].actions = [{ player: 1, action: 'all-in' }, A(0, 'fold')];
  const g = gap(h, 'action:2:0');
  ok(g.auto); eq(g.options[0].value.action.amount, 8800);
  const h2 = nlhHeadsUp(); h2.streets[2].actions = [A(1, 'all-in', 5000), A(0, 'fold')];
  eq(gap(h2, 'action:2:0').options[0].value.action.amount, 8800);
});

test('a bet into a bet is relabelled a raise (non-blocking, auto)', () => {
  const h = nlhHeadsUp(); h.streets[1].actions[2] = A(1, 'bet', 900);
  const g = gap(h, 'action-label:1:2');
  ok(g && !g.blocking && g.auto); eq(g.options[0].value.action.action, 'raise');
  eq(ids(answerFirst(h, g)), []);
});

test('a raise into nothing is relabelled a bet', () => {
  const h = nlh6max(); h.streets[1].actions[1] = A(3, 'raise', 1200);
  eq(gap(h, 'action-label:1:1').options[0].value.action.action, 'bet');
});

test('a betting round that never closes before the next street', () => {
  const h = nlh6max(); h.streets[0].actions = h.streets[0].actions.slice(0, 4); // stops after hero 3-bets
  const g = gap(h, 'street-open:0');
  ok(g.blocking);
  // SB and BB never play again (fold); Cal plays the flop, so Cal called.
  eq(g.options[0].value.actions, [A(4, 'fold'), A(5, 'fold'), A(2, 'call', 1000)]);
  eq(ids(answerFirst(h, g)), []);
});

test('an empty street before a later one is checked through', () => {
  const h = nlh6max(); h.streets[2].actions = [];
  const g = gap(h, 'street-open:2');
  ok(/Nothing is recorded on the Turn/.test(g.question));
  eq(g.options[0].value.actions, [A(2, 'check'), A(3, 'check')]);
});

test('action after everyone else folded', () => {
  const h = nlhHeadsUp(); h.streets[3].actions = [A(1, 'check')];
  const g = gap(h, 'ended:3:0');
  ok(g.blocking); eq(answerFirst(h, g).streets[3].actions, []);
});

test('an action after the round closed belongs on the next street', () => {
  const h = nlh6max();
  const flop = h.streets[1].actions;
  h.streets[0].actions = h.streets[0].actions.concat(flop); h.streets[1].actions = [];
  const g = gap(h, 'action:0:7');
  eq(g.options[0].value, { op: 'moveActionsToNextStreet', street: 0, index: 7 });
  eq(ids(answerFirst(h, g)), []);
});

test('a hand that stops mid-round asks what happened next (non-blocking)', () => {
  const h = nlhHeadsUp(); h.streets[2].actions = [A(1, 'bet', 1500)]; h.result = null;
  const g = gap(h, 'next:2:1');
  ok(g && !g.blocking);
  eq(g.options.map(o => o.value.op === 'dismiss' ? 'dismiss' : o.value.actions[0].action), ['fold', 'call', 'raise', 'all-in', 'dismiss']);
  ok(!ids(applyAnswer(h, g, g.options[g.options.length - 1].value)).includes('next:2:1'), 'dismissed');
  const called = answerFirst(h, g);
  eq(called.streets[2].actions.length, 2);
});

test('a hand that stops before a street offers a check-down', () => {
  const h = nlhHeadsUp(); h.streets[2].actions = []; h.streets[2].cards.board = '2h'; h.result = null;
  const g = gap(h, 'next:2:0');
  const down = g.options.find(o => o.value.op === 'batch');
  ok(down, 'check-down option');
  const done = applyAnswer(h, g, down.value);
  eq(done.streets[3].actions, [A(1, 'check'), A(0, 'check')]);
  // Now it reaches showdown: the river and the result are what is left.
  ok(ids(done).includes('board:3'));
  ok(ids(done).includes('result'));
});

// ── stud ──
test('stud: the bring-in is asked for when the description starts with a call', () => {
  const h = studHi(); h.streets[0].actions = h.streets[0].actions.slice(1);
  const g = gap(h, 'bringin');
  ok(/lowest door card/.test(g.options[0].label));
  eq(g.options[0].value.actions, [A(1, 'bring-in', 50)]);
  eq(ids(answerFirst(h, g)), []);
});

test('stud: a bring-in the size of a full bet', () => {
  const h = studHi(); h.streets[0].actions[0] = A(1, 'bring-in', 200);
  eq(gap(h, 'action:0:0').options[0].value.action.amount, 50);
});

test('a bring-in outside 3rd street', () => {
  const h = studHi(); h.streets[1].actions[0] = A(0, 'bring-in', 50);
  eq(gap(h, 'action:1:0').kind, 'impossible');
  const n = nlh6max(); n.streets[0].actions[0] = A(0, 'bring-in', 50);
  ok(gap(n, 'action:0:0'));
});

test('razz: the high door card brings it in; a complete is a bet', () => {
  eq(findGaps(razz()), []);
  const h = razz(); h.streets[0].actions[2] = A(0, 'raise', 300); // the raise goes to 400
  const g = gap(h, 'action:0:2');
  ok(/limit/.test(g.question), g.question);
  eq(g.options[0].value.action.amount, 400);
});

// ═════════════════════════════════════════════════════════════════════════
// 9. Draws
// ═════════════════════════════════════════════════════════════════════════
test('a missing draw count: blocking for the hero, skippable for an opponent', () => {
  const h = tripleDraw27(); h.streets[1].draws = [D(3, 1)];
  const g = gap(h, 'draw:1:1');
  ok(g.blocking); eq(g.options[0].label, 'Stood pat');
  eq(ids(answerFirst(h, g)), []);
  const o = tripleDraw27(); o.streets[1].draws = [D(1, 0)];
  const go = gap(o, 'draw:1:3');
  ok(!go.blocking);
  ok(!ids(applyAnswer(o, go, go.options[go.options.length - 1].value)).includes('draw:1:3'));
});

test('draws recorded on the round AFTER they happen', () => {
  const h = tripleDraw27();
  h.streets[3].draws = h.streets[2].draws; h.streets[2].draws = h.streets[1].draws; h.streets[1].draws = h.streets[0].draws; h.streets[0].draws = [];
  const g = gap(h, 'draws-shifted');
  ok(g.blocking && g.auto);
  eq(ids(answerFirst(h, g)), []);
});

test('draws one round late with the last round empty', () => {
  // The hand ends on the second draw's betting, so there are two draws, and
  // they are recorded one round late.
  const h = badugi();
  h.streets[2].actions = [A(1, 'check'), A(2, 'bet', 400), A(1, 'fold')];
  h.streets[2].draws = [];
  h.streets[3].actions = [];
  h.result = { winners: [{ playerIdx: 2, split: false }] };
  ok(findGaps(h).length === 0, JSON.stringify(findGaps(h)));
  h.streets[2].draws = h.streets[1].draws; h.streets[1].draws = h.streets[0].draws; h.streets[0].draws = [];
  const g = gap(h, 'draws-late');
  ok(g && !g.blocking);
  eq(ids(answerFirst(h, g)), []);
});

test('discards that do not match the count', () => {
  const h = tripleDraw27(); h.streets[0].draws[0] = D(1, 2, '9d', '7c');
  const g = gap(h, 'draw:0:1');
  eq(g.options[0].value.draw, { discarded: 1 });
  eq(ids(answerFirst(h, g)), []);
});

test('more new cards than discards', () => {
  const h = tripleDraw27(); h.streets[0].draws[0] = D(1, 1, '', '7c6c');
  eq(gap(h, 'draw:0:1').options[0].value.draw, { discarded: 2 });
});

test('fewer new cards than discards: the rest are face down', () => {
  const h = tripleDraw27(); h.streets[0].draws[0] = D(1, 2, '8c9d', '7c');
  const g = gap(h, 'draw:0:1');
  eq(g.options[0].value.draw, { newCards: '7cAx' });
  eq(ids(answerFirst(h, g)), []);
});

test('a discard that is not in the hand', () => {
  const h = tripleDraw27(); h.streets[0].draws[0] = D(1, 1, 'Kd', '7c');
  ok(/hand going in was/.test(gap(h, 'draw:0:1').question));
});

test('drawing a dead card', () => {
  const h = tripleDraw27(); h.streets[0].draws[0] = D(1, 1, '9d', '9d');
  const g = gap(h, 'draw-dead:0:1');
  ok(/already discarded/.test(g.question));
  eq(g.options[0].value.draw.newCards, 'Ax');
  const b = badugi(); b.streets[0].draws[0] = D(1, 1, '7h', '5c'); // 5c is in Bo's hand
  ok(/in Bo/.test(gap(b, 'draw-dead:0:1').question));
});

test('a draw for a player who had folded is dropped', () => {
  const h = tripleDraw27(); h.streets[0].draws.push(D(0, 2));
  const g = gap(h, 'draw-x:0:2');
  ok(g && !g.blocking && g.auto);
  eq(ids(answerFirst(h, g)), []);
});

test('draws in a game without draws', () => {
  const h = nlh6max(); h.streets[0].draws = [D(3, 1)];
  ok(gap(h, 'draws').auto);
});

// ═════════════════════════════════════════════════════════════════════════
// 10. Board and stud up cards
// ═════════════════════════════════════════════════════════════════════════
test('the whole board stored on the flop is re-dealt (auto)', () => {
  const h = nlh6max(); h.streets[1].cards.board = 'AhKd2c7s9h'; h.streets[2].cards.board = ''; h.streets[3].cards.board = '';
  const g = gap(h, 'board:1');
  ok(g.auto); eq(g.options[0].value, { op: 'redistributeBoard' });
  const fixed = answerFirst(h, g);
  eq(fixed.streets.map(s => s.cards.board), ['', 'AhKd2c', '7s', '9h']);
  eq(ids(fixed), []);
});

test('a short flop', () => {
  const h = nlh6max(); h.streets[1].cards.board = 'AhKd';
  const g = gap(h, 'board:1');
  eq(g.kind, 'impossible'); eq(g.options[0].value.value, 'AhKdAx');
});

test('a missing turn blocks when there is action on it', () => {
  const h = nlh6max(); h.streets[2].cards.board = '';
  const g = gap(h, 'board:2');
  ok(g.blocking); ok(/turn/.test(g.question));
  const h2 = nlhHeadsUp(); h2.streets[2].cards.board = '';
  ok(gap(h2, 'board:2').blocking);
});

test('no river needed when the hand ended on the turn', () => {
  ok(!ids(nlhHeadsUp()).includes('board:3'));
});

test('board cards before the flop', () => {
  const h = nlh6max(); h.streets[0].cards.board = 'AhKd2c'; h.streets[1].cards.board = '';
  h.streets[0].cards.board = 'AhKd2c7s9h'; h.streets[2].cards.board = ''; h.streets[3].cards.board = '';
  const g = gap(h, 'board:0');
  ok(g.blocking && g.auto);
  eq(ids(answerFirst(h, g)), []);
});

test('a board in a game without one', () => {
  const h = studHi(); h.streets[2].cards.board = 'Ah';
  ok(gap(h, 'board').blocking);
});

test('stud: a missing card on a later street', () => {
  const h = studHi(); h.streets[2].cards.hero = '';
  const g = gap(h, 'cards:hero:2');
  ok(!g.blocking); eq(answerFirst(h, g).streets[2].cards.hero, 'Ax');
  const o = studHi(); o.streets[1].cards.opponents[2] = '';
  const go = gap(o, 'upcards:3');
  ok(go && !go.blocking && /4th Street/.test(go.question));
  ok(!ids(answerFirst(o, go)).includes('upcards:3'));
});

test('stud: two cards on one street', () => {
  const h = studHi(); h.streets[3].cards.opponents[2] = '3d4d';
  ok(gap(h, 'oppcards:3:3').blocking);
});

// ═════════════════════════════════════════════════════════════════════════
// 11. Showdown and result
// ═════════════════════════════════════════════════════════════════════════
test('a showdown with no winner: the cards decide the best guess', () => {
  const h = lhe6max(); h.result = null;
  const g = gap(h, 'result');
  ok(!g.blocking);
  ok(/Hero won \(from the cards\)/.test(g.options[0].label), g.options[0].label);
  eq(ids(answerFirst(h, g)), []);
});

test('a showdown opponent with no cards: mucked or unknown', () => {
  const h = lhe6max(); h.streets[0].cards.opponents[4] = '';
  const g = gap(h, 'showdown:5');
  ok(!g.blocking); eq(g.options[0].value.value, 'MUCK');
  eq(ids(answerFirst(h, g)), []);
});

test('a folded player cannot win', () => {
  const h = nlh6max(); h.result = { winners: [{ playerIdx: 0, split: false }] };
  const g = gap(h, 'result');
  ok(g.blocking); eq(g.options.map(o => o.value.winners[0].playerIdx), [2, 3]);
});

test('everyone folded: the last player standing won', () => {
  const h = nlhHeadsUp(); h.result = { winners: [{ playerIdx: 0, split: false }] };
  const g = gap(h, 'result');
  ok(g.auto); eq(answerFirst(h, g).result.winners, [{ playerIdx: 1, split: false }]);
});

test('an opponent with too few cards', () => {
  const h = plo6max(); h.streets[0].cards.opponents[2] = 'KcKh';
  const g = gap(h, 'oppcards:2');
  eq(g.options[0].value.value, 'KcKhAxAx');
  const t = plo6max(); t.streets[0].cards.opponents[2] = 'KcKhQcQhJc';
  ok(gap(t, 'oppcards:2').blocking);
});

// ═════════════════════════════════════════════════════════════════════════
// 12. Order
// ═════════════════════════════════════════════════════════════════════════
test('most fundamental first', () => {
  const h = nlh6max();
  delete h.blinds.sb;
  h.players[2].startingStack = null;
  h.streets[0].cards.hero = '';
  h.streets[1].cards.board = 'AhKd';
  h.result = { winners: [{ playerIdx: 7 }] };
  const order = ids(h);
  const at = (id) => order.indexOf(id);
  ok(at('blinds.sb') >= 0 && at('blinds.sb') < at('stack:2'), order.join(' '));
  ok(at('stack:2') < at('cards:hero'), order.join(' '));
  ok(at('cards:hero') < at('board:1'), order.join(' '));
  ok(at('board:1') < at('result'), order.join(' '));
  eq(order[0], 'blinds.sb');
});

test('game before everything; actions street by street', () => {
  const h = nlh6max(); h.gameType = 'whatever'; h.blinds = {};
  eq(ids(h)[0], 'game');
  const a = nlh6max();
  a.streets[2].actions[0] = A(2, 'call', 0); // turn problem
  a.streets[1].actions[1] = A(3, 'bet', 50); // flop problem comes first
  eq(firstGap(a).id, 'action:1:1');
});

test('action problems stop at the first one', () => {
  const h = nlh6max();
  h.streets[1].actions[1] = A(3, 'bet', 50);
  h.streets[3].actions[1] = A(3, 'call', 1);
  eq(findGaps(h).filter(g => g.id.startsWith('action:')).map(g => g.id), ['action:1:1']);
});

test('ids are stable for the same problem', () => {
  const h = nlh6max(); h.players[2].startingStack = null;
  eq(ids(h), ids(clone(h)));
});

// ═════════════════════════════════════════════════════════════════════════
// 12b. Hands as the server (part B) leaves them
// ═════════════════════════════════════════════════════════════════════════
/* Only the players mentioned, in the narrator's position words, table size
   unknown, "folds to me" said: hand.quickAdd carries what waits on seating. */
function narratorHand() {
  return {
    gameType: 'NLH', gameMode: 'cash', currency: 'USD',
    blinds: { sb: 100, bb: 200, ante: 0 },
    players: [{ name: 'Hero', position: 'CO', startingStack: 20000 }, { name: 'Vic', position: 'BTN', startingStack: 30000 }],
    heroIdx: 0,
    streets: [
      St('Preflop', 'AhKh', [''], '', [A(0, 'raise', 500), A(1, 'raise', 1500), A(0, 'call', 1000)]),
      St('Flop', '', [''], 'Kd7c2s', [A(0, 'check'), A(1, 'bet', 1200), A(0, 'fold')]),
      St('Turn', '', [''], '', []),
      St('River', '', [''], '', []),
    ],
    result: null,
    quickAdd: { positions: 'narrator', othersFolded: true },
  };
}

test('narrator seating: the table size is asked first, with field tableSize', () => {
  const h = narratorHand();
  const g = firstGap(h);
  eq(g.id, 'table-size'); eq(g.field, 'tableSize'); ok(g.blocking);
  eq(g.options[0], { label: '6-max', value: { op: 'setTableSize', n: 6 } });
  ok(!g.options.some(o => o.value.n === 2 || o.value.n === 3), 'CO does not exist two- or three-handed');
  ok(!ids(h).some(id => id.startsWith('action')), 'betting waits for the seats');
});

test('answering the table size seats everyone the server\'s way', () => {
  const h = narratorHand();
  const six = answerFirst(h, firstGap(h));
  eq(six.players.map(p => p.position), ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
  eq([six.players[2].name, six.players[3].name, six.heroIdx], ['Hero', 'Vic', 2]);
  eq(six.quickAdd, undefined);
  // "Folds to me": the unmentioned seats fold, in turn.
  eq(six.streets[0].actions, [A(0, 'fold'), A(1, 'fold'), A(2, 'raise', 500), A(3, 'raise', 1500), A(4, 'fold'), A(5, 'fold'), A(2, 'call', 1000)]);
  eq(six.streets[0].cards.hero, 'AhKh');
  eq(blocking(findGaps(six)).map(g => g.id), []);
  // A typed answer works the same way.
  const nine = applyAnswer(h, firstGap(h), '9-handed');
  eq(nine.players.length, 9); eq(nine.players[nine.heroIdx].position, 'CO');
});

test('an ante per player and straddles wait for the table size', () => {
  const h = narratorHand(); h.blinds.ante = null; h.quickAdd.antePerPlayer = 25;
  ok(!ids(h).includes('blinds.ante'));
  eq(answerFirst(h, firstGap(h)).blinds.ante, 150);
  const s = narratorHand(); s.quickAdd.straddles = [{ type: 'utg' }]; s.streets.forEach(st => { st.actions = []; });
  const seated = answerFirst(s, firstGap(s));
  eq([seated.blinds.straddle, seated.blinds.straddle_utg], [true, true]);
});

test('a seat the server could not place is asked about, one player at a time', () => {
  const opp = (k) => ({ name: 'Opp ' + k, position: null, startingStack: null });
  const h = {
    gameType: 'NLH', gameMode: 'cash', blinds: { sb: 1, bb: 2, ante: 0 },
    players: [{ name: 'Vic', position: null, startingStack: 500 }, opp(1), { name: 'Hero', position: 'CO', startingStack: 500 }, opp(2), opp(3), opp(4)],
    heroIdx: 2,
    streets: [St('Preflop', 'QsQd', e5(), '', [A(0, 'raise', 6)]), St('Flop', '', e5(), '', []), St('Turn', '', e5(), '', []), St('River', '', e5(), '', [])],
    quickAdd: { tableSize: 6 },
  };
  const g = firstGap(h);
  eq(g.id, 'seat:0'); ok(g.blocking);
  eq(g.options.map(o => o.label), ['LJ', 'HJ', 'BTN', 'SB', 'BB']);
  const placed = applyAnswer(h, g, g.options[2].value); // Vic was on the button
  eq(placed.players[3].name, 'Vic'); eq(placed.players[3].position, 'BTN');
  const relabel = gap(placed, 'positions');
  ok(relabel && !relabel.blocking && relabel.auto);
  const done = answerFirst(placed, relabel);
  eq(done.players.map(p => p.position), ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
  eq(done.quickAdd, undefined);
});

test('sizes and stacks waiting on the big blind are not asked about; they resolve', () => {
  const h = nlh6max(); delete h.blinds.bb; h.blinds.sb = null;
  h.streets[0].actions[2] = { player: 2, action: 'raise', amount: null, toAmountBB: 2.5 };
  h.streets[0].actions[3] = { player: 3, action: 'raise', amount: null, toAmount: 1500 };
  h.streets[0].actions[6] = { player: 2, action: 'call', amount: null };
  h.players[5].startingStack = null; h.players[5].startingStackBB = 100;
  const gs = findGaps(h);
  eq(gs[0].id, 'blinds.bb');
  ok(!gs.some(g => g.id.startsWith('action') || g.id.startsWith('stack')), gs.map(g => g.id).join(' '));
  const fixed = applyAnswer(h, gs[0], { op: 'setMany', sets: [{ path: 'blinds.sb', value: 100 }, { path: 'blinds.bb', value: 200 }] });
  eq(fixed.streets[0].actions.map(a => a.amount), [0, 0, 500, 1500, 0, 0, 1000]);
  ok(!('toAmountBB' in fixed.streets[0].actions[2]) && !('toAmount' in fixed.streets[0].actions[3]));
  eq(fixed.players[5].startingStack, 20000);
  eq(ids(fixed), []);
});

test('a pot-fraction size waiting on the ante makes the ante blocking', () => {
  const h = nlhHeadsUp(); h.blinds.ante = null;
  h.streets[1].actions[1] = { player: 0, action: 'bet', amount: null, potFraction: 0.5 };
  const g = gap(h, 'blinds.ante');
  ok(g.blocking); eq(g.options[0].value.value, 0, 'a cash game: no ante first');
  const fixed = answerFirst(h, g);
  eq(fixed.streets[1].actions[1].amount, 300);
  eq(ids(fixed), []);
});

test('a size the server left pending is worked out once its inputs are known', () => {
  const h = nlh6max(); h.streets[0].actions[3] = { player: 3, action: 'raise', amount: null, toAmountBB: 7.5 };
  const g = gap(h, 'action:0:3');
  ok(g.auto); eq(g.options[0].value.action.amount, 1500);
});

test('stud: the small blind, bring-in and big bet may be null', () => {
  const h = studHi(); h.blinds.sb = null; h.blinds.bringIn = null; h.blinds.bigBet = null;
  eq(findGaps(h), []);
});

test('a player whose position is null does not trip the layout check', () => {
  const h = nlh6max(); h.quickAdd = { tableSize: 6 };
  h.players[0].position = null; h.players[0].name = 'Opp 1';
  ok(!ids(h).includes('structure'));
});

// ═════════════════════════════════════════════════════════════════════════
// 12c. Lessons from the corpus (test/quick-add/corpus, part D's --oracle run)
// ═════════════════════════════════════════════════════════════════════════
test('unknown cards written as single x or as xx pairs are missing cards', () => {
  const p = plo6max(); p.streets[0].cards.hero = 'AxAxxx'; // Ax Ax and two unknown (the corpus's form)
  const g = gap(p, 'cards:hero');
  eq(g.kind, 'missing'); ok(/Only 2 of your 4/.test(g.question), g.question);
  eq(answerFirst(p, g).streets[0].cards.hero, 'AxAxAxAx');
  const n = nlhHeadsUp(); n.streets[0].cards.hero = 'XxXx'; // hand-history style
  const gn = gap(n, 'cards:hero');
  eq(gn.kind, 'missing'); eq(answerFirst(n, gn).streets[0].cards.hero, 'AxAx');
  const b = nlh6max(); b.streets[1].cards.board = 'Ah9dx'; // a flop rag nobody named
  const gb = gap(b, 'notation:streets.1.cards.board');
  eq(gb.kind, 'missing'); eq(answerFirst(b, gb).streets[1].cards.board, 'Ah9dAx');
});

test('hero cards with ranks but no suits get an optional suits question', () => {
  const h = nlh6max(); h.streets[0].cards.hero = 'AxKx';
  const g = gap(h, 'cards:hero-suits');
  ok(g && !g.blocking); eq(g.kind, 'missing');
  ok(!ids(answerFirst(h, g)).includes('cards:hero-suits'));
});

test('stud: the bring-in by the wrong door card is questioned, not blocked', () => {
  const h = studHi(); h.streets[0].cards.opponents[0] = '3c'; // Pia's 3c is no longer lowest...
  h.streets[0].cards.hero = 'AsKd2h';                        // ...the hero's 2h is
  const g = gap(h, 'bringin-door');
  ok(g && !g.blocking); eq(g.options[0].value.action.player, 0);
});

test('stud: an open pair on 4th street allows the small bet as well as the big', () => {
  const h = studHi(); h.streets[1].cards.hero = 'Qd'; // Qh door + Qd: an open pair
  eq(blocking(findGaps(h)).map(g => g.id), [], 'the small bet stands');
  h.streets[1].actions = [A(0, 'bet', 400), A(1, 'fold'), A(3, 'call', 400)];
  eq(blocking(findGaps(h)).map(g => g.id), [], 'and so does the big one');
});

test('stud: shown hidden cards may sit on 7th street', () => {
  const h = studHi(); h.streets[0].cards.opponents[2] = 'Jc'; h.streets[4].cards.opponents[2] = 'AhAcKc';
  eq(findGaps(h).map(g => g.id), []);
});

test('stud: a later street is opened by whoever the description says acted first', () => {
  const h = razz(); // aces up are the best razz board, though the replayer scores them high
  h.streets[1].cards.hero = 'As'; h.streets[0].cards.hero = 'Kh2d3c'; h.streets[0].cards.opponents[0] = 'Qd';
  eq(blocking(findGaps(h)).map(g => g.id), []);
});

test('silent seats that never act fold without blocking (auto)', () => {
  const s = studHi(); s.players.push(P('Sy', 'Seat 5', 12000));
  s.streets.forEach(st => st.cards.opponents.push(''));
  // Order from the bring-in: Pia, Quin, Rex, Sy, Hero — Sy is skipped before the hero's complete.
  const g = gap(s, 'action:0:3');
  ok(g && !g.blocking && g.auto, JSON.stringify(findGaps(s)));
  eq(g.options[0].value.actions, [A(4, 'fold')]);
  eq(blocking(findGaps(s)).map(x => x.id), [], 'the rest of the hand is still checked');
  // A seat that plays later is not silent: that one still blocks.
  const h = nlh6max(); h.streets[0].actions = [A(2, 'raise', 500), A(3, 'raise', 1500), A(2, 'call', 1000)];
  h.streets[0].cards.opponents[0] = 'AdAh'; // Alex holds cards: described, not silent
  ok(gap(h, 'action:0:0').blocking);
});

test('a seat filled by deduction for a player who named none is asked about', () => {
  const h = {
    gameType: 'NLH', gameMode: 'mtt', blinds: { sb: 500, bb: 1000, ante: 1000 },
    players: [{ name: 'Sam', position: 'SB', startingStack: null }, { name: 'Bea', position: 'BB', startingStack: 30000 }, { name: 'Hero', position: '', startingStack: 25000 }],
    heroIdx: 2,
    streets: [St('Preflop', 'AsKd', ['', ''], '', [A(2, 'raise', 2200), A(0, 'fold'), A(1, 'call', 1200)]), St('Flop', '', ['', ''], 'Th8h4c', []), St('Turn', '', ['', ''], '', []), St('River', '', ['', ''], '', [])],
  };
  const g = gap(h, 'seat:2');
  ok(g && g.blocking); eq(g.kind, 'missing'); eq(g.field, 'players.2.position');
});

test('a stack the ante or blind uses up, for a player who bets later', () => {
  const h = nlhHeadsUp(); h.players[1].startingStack = 80;
  const g = gap(h, 'stack:1');
  eq(g.kind, 'impossible'); ok(g.blocking);
  ok(g.options.every(o => o.value.value > 100));
});

test('an ante bigger than the big blind', () => {
  const h = nlh6max(); h.blinds.ante = 5000;
  const g = gap(h, 'blinds.ante');
  ok(g.blocking); eq(g.kind, 'impossible'); eq(g.options[0].value.value, 200);
});

test('pot limit counts the big blind ante in the pot', () => {
  const h = plo6max(); h.gameMode = 'mtt'; h.blinds = { sb: 300, bb: 600, ante: 600 };
  h.players.forEach(p => { p.startingStack = 60000; });
  h.streets[0].actions = [A(0, 'fold'), A(1, 'fold'), A(2, 'fold'), A(3, 'raise', 2700), A(4, 'fold'), A(5, 'call', 2100)];
  h.streets[1].actions = [A(5, 'check'), A(3, 'bet', 3000), A(5, 'fold')];
  h.streets[2].actions = []; h.streets[3].actions = []; h.streets[2].cards.board = ''; h.streets[3].cards.board = '';
  eq(blocking(findGaps(h)).map(g => g.id), []);
});

test('a hand that went to showdown needs its board even when the betting check stopped early', () => {
  const h = nlh6max();
  h.streets[0].actions[6] = A(2, 'call', 9999); // the betting check stops here, preflop
  h.streets[2].actions = []; h.streets[3].actions = []; h.streets[2].cards.board = '';
  // No action on the turn, but a winner and Cal's shown cards say it was dealt.
  const got = ids(h);
  ok(got.includes('action:0:6') && got.includes('board:2'), got.join(' '));
});

test('previews: with the game unknown, the rest is listed after it, without options', () => {
  const h = nlh6max(); delete h.gameType; h.streets[0].cards.hero = '';
  const gs = findGaps(h);
  eq(gs[0].id, 'game');
  const later = gs.find(g => g.id === 'cards:hero');
  ok(later && later.provisional && !later.options && later.allowFree);
});

test('previews: with the table size unknown, later streets are previewed', () => {
  const h = narratorHand(); h.streets[1].actions[1] = { player: 1, action: 'bet', amount: null };
  const gs = findGaps(h);
  eq(gs[0].id, 'table-size');
  const p = gs.find(g => g.id === 'action:1:1');
  ok(p && p.provisional && !p.options, gs.map(g => g.id).join(' '));
  ok(!gs.some(g => g.provisional && /^stack/.test(g.id)), 'nothing indexed by seat is previewed');
});

/* Random damage to every complete hand: findGaps and applyAnswer must never
   throw, and answering the first gap again and again must keep making
   progress. Seeded, so a failure reproduces. */
test('fuzz: damaged hands never throw and answering always progresses', () => {
  let seed = 20261001;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const WEIRD = [null, undefined, -1, 0, 1, 2, 7, 99999, 'x', '', 'AhAh', 'MUCK', 'raise', 'Ah', {}, [], true, 0.5, 'BTN', 'UTG', 'Txx'];
  const paths = (o, pre = '', acc = []) => { if (o && typeof o === 'object') for (const k of Object.keys(o)) { const p = pre ? pre + '.' + k : k; acc.push(p); paths(o[k], p, acc); } return acc; };
  const setP = (o, p, v) => { const ks = p.split('.'); let c = o; for (let i = 0; i < ks.length - 1; i++) { c = c[ks[i]]; if (c == null || typeof c !== 'object') return; } if (v === undefined) delete c[ks[ks.length - 1]]; else c[ks[ks.length - 1]] = v; };
  const makers = Object.values(COMPLETE);
  let walked = 0;
  for (let it = 0; it < 400; it++) {
    const h = makers[it % makers.length]();
    const ps = paths(h);
    for (let j = 0; j < 1 + Math.floor(rnd() * 3); j++) setP(h, pick(ps), pick(WEIRD));
    let cur = h;
    const seen = new Set();
    for (let step = 0; step < 25; step++) {
      const g = findGaps(cur)[0];
      if (!g || !g.options || !g.options.length) break;
      const sig = g.id + '|' + g.question + '|' + JSON.stringify(cur);
      ok(!seen.has(sig), 'no progress on ' + g.id + ': ' + g.question);
      seen.add(sig);
      cur = applyAnswer(cur, g, g.options[0].value);
      walked++;
    }
  }
  ok(walked > 500, 'walked ' + walked);
});

// ═════════════════════════════════════════════════════════════════════════
// 13. applyAnswer
// ═════════════════════════════════════════════════════════════════════════
test('applyAnswer is pure', () => {
  const h = deepFreeze(nlh6max());
  const g = { id: 'stack:2', field: 'players.2.startingStack' };
  const out = applyAnswer(h, g, { op: 'set', path: 'players.2.startingStack', value: 5 });
  eq(out.players[2].startingStack, 5); eq(h.players[2].startingStack, 20000);
  ok(out !== h);
});

test('a plain number answers a single-field gap', () => {
  const h = nlh6max(); h.players[2].startingStack = null;
  const g = gap(h, 'stack:2');
  eq(applyAnswer(h, g, '15,000').players[2].startingStack, 15000);
  eq(applyAnswer(h, g, 12000).players[2].startingStack, 12000);
});

/* Every gap from a pile of broken hands: its first option must answer it. */
function brokenHands() {
  const out = [];
  const mk = (make, mutate) => { const h = make(); mutate(h); out.push(h); };
  mk(nlh6max, h => { delete h.gameType; });
  mk(nlh6max, h => { delete h.blinds.bb; });
  mk(nlh6max, h => { delete h.blinds.sb; h.players[1].startingStack = null; });
  mk(nlh6max, h => { delete h.heroIdx; });
  mk(nlh6max, h => { h.players.forEach(p => { p.position = ''; }); });
  mk(nlh6max, h => { h.players.forEach(p => { delete p.startingStack; }); });
  mk(nlh6max, h => { h.streets[0].actions = [A(2, 'raise', 500), A(3, 'raise', 1500), A(2, 'call', 1000)]; });
  mk(nlh6max, h => { h.streets[0].actions = h.streets[0].actions.slice(0, 4); });
  mk(nlh6max, h => { h.streets[1].cards.board = 'AhKd2c7s9h'; h.streets[2].cards.board = ''; h.streets[3].cards.board = ''; });
  mk(nlh6max, h => { h.streets[1].cards.board = 'AsKd2c'; });
  mk(nlh6max, h => { h.streets[1].actions[2] = A(2, 'check'); });
  mk(nlh6max, h => { h.streets[0].actions[6] = A(2, 'call', 1500); });
  mk(nlhHeadsUp, h => { h.streets[2].actions = [A(1, 'bet', 1500)]; h.result = null; });
  mk(nlhHeadsUp, h => { h.streets[2].actions = [A(1, 'bet', 12000), A(0, 'fold')]; });
  mk(nlhHeadsUp, h => { h.streets[1].actions[2] = A(1, 'bet', 900); });
  mk(plo6max, h => { h.streets[0].actions[3] = A(3, 'raise', 3000); });
  mk(plo6max, h => { h.streets[0].cards.hero = 'AsKs'; });
  mk(lhe6max, h => { h.streets[2].actions[1] = A(3, 'bet', 200); h.result = null; });
  mk(lhe6max, h => { h.streets[0].cards.opponents[4] = ''; });
  mk(studHi, h => { h.streets[0].actions = h.streets[0].actions.slice(1); delete h.blinds.ante; });
  mk(studHi, h => { h.streets[2].cards.hero = ''; h.streets[1].cards.opponents[2] = ''; });
  mk(razz, h => { h.players.forEach(p => { p.startingStack = null; }); });
  mk(tripleDraw27, h => { h.streets[1].draws = [D(3, 1)]; });
  mk(tripleDraw27, h => { h.streets[0].draws[0] = D(1, 2, '8c9d', '7c'); });
  mk(tripleDraw27, h => { h.streets[3].draws = h.streets[2].draws; h.streets[2].draws = h.streets[1].draws; h.streets[1].draws = h.streets[0].draws; h.streets[0].draws = []; });
  mk(badugi, h => { h.streets[0].draws[0] = D(1, 1, '7h', '5c'); });
  mk(singleDraw, h => { h.streets[0].draws = []; });
  return out;
}

test('every gap\'s first option answers that gap', () => {
  const hands = brokenHands();
  let checked = 0;
  for (const h of hands) {
    for (const g of findGaps(h)) {
      if (!g.options || !g.options.length) continue;
      const after = applyAnswer(h, g, g.options[0].value);
      const again = findGaps(after).find(x => x.id === g.id && x.question === g.question);
      ok(!again, 'still asked after its first option: ' + g.id + ' — ' + g.question);
      checked++;
    }
  }
  ok(checked >= 30, 'checked ' + checked + ' gaps');
});

test('answering the first gap repeatedly converges on a hand with no blocking gaps', () => {
  for (const h0 of brokenHands()) {
    let h = h0;
    let steps = 0;
    for (; steps < 40; steps++) {
      const b = findGaps(h).filter(g => g.blocking && g.options && g.options.length);
      if (!b.length) break;
      h = applyAnswer(h, b[0], b[0].options[0].value);
    }
    ok(steps < 40, 'did not converge: ' + JSON.stringify(findGaps(h)[0]));
    ok(findGaps(h).filter(g => g.blocking && g.options && g.options.length).length === 0);
  }
});

test('every gap has the contract shape', () => {
  for (const h of brokenHands()) {
    for (const g of findGaps(h)) {
      ok(typeof g.id === 'string' && g.id, 'id');
      ok(['missing', 'ambiguous', 'impossible'].includes(g.kind), 'kind ' + g.kind);
      ok(typeof g.field === 'string', 'field');
      ok(typeof g.question === 'string' && g.question.length > 5 && g.question.length < 260, 'question: ' + g.question);
      ok(typeof g.blocking === 'boolean', 'blocking');
      ok(g.options || g.allowFree, 'answerable: ' + g.id);
      (g.options || []).forEach(o => ok(typeof o.label === 'string' && o.value !== undefined, 'option shape'));
    }
  }
});

// ── Client and server agree (runs once part B's lib/quick-add is in the tree) ──
{
  const { existsSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const libDir = new URL('../../lib/quick-add/', import.meta.url);
  if (existsSync(new URL('normalize.js', libDir)) && existsSync(new URL('patch.js', libDir))) {
    const require = createRequire(import.meta.url);
    const { normalizeDraft, normalizeHand } = require(fileURLToPath(new URL('normalize.js', libDir)));
    const { applyOps } = require(fileURLToPath(new URL('patch.js', libDir)));
    const DRAFT = () => ({
      gameType: 'NLH', gameMode: 'cash', tableSize: null, othersFolded: true, blinds: { sb: 1, bb: 3, ante: 0 },
      players: [{ position: 'UTG', isHero: false }, { position: 'BTN', isHero: true }, { position: 'BB', isHero: false }],
      streets: [
        { name: 'Preflop', cards: [{ player: 1, cards: 'AhQh' }], actions: [
          { player: 0, action: 'call' }, { player: 1, action: 'raise', toAmount: 15 }, { player: 2, action: 'call' }, { player: 0, action: 'call' }] },
        { name: 'Flop', board: 'Qs7d2c', actions: [{ player: 2, action: 'check' }, { player: 0, action: 'check' }, { player: 1, action: 'bet', toAmount: 25 }, { player: 2, action: 'fold' }, { player: 0, action: 'call' }] },
      ],
    });
    const pick = (h) => ({ players: h.players.map(p => [p.name, p.position]), heroIdx: h.heroIdx, streets: h.streets.map(s => ({ cards: s.cards, actions: s.actions.map(a => [a.player, a.action, a.amount]) })), quickAdd: h.quickAdd });
    test('server agreement: seating a narrator hand', () => {
      for (const n of [6, 8, 9]) {
        const un = normalizeDraft(DRAFT()).hand;
        const mine = applyAnswer(un, { id: 'table-size', field: 'tableSize' }, { op: 'setTableSize', n });
        const theirs = normalizeHand(applyOps(un, [{ op: 'set', path: 'tableSize', value: n }]).hand).hand;
        eq(pick(mine), pick(theirs), n + '-handed');
      }
    });
    test('server agreement: naming the hero and finishing sizes', () => {
      const nh = normalizeDraft({ ...DRAFT(), tableSize: 9, players: DRAFT().players.map(p => ({ ...p, isHero: false })) }).hand;
      const btn = nh.players.findIndex(p => p.position === 'BTN');
      eq(applyAnswer(nh, { id: 'hero' }, { op: 'setHero', heroIdx: btn }).streets.map(s => s.cards),
        normalizeHand(applyOps(nh, [{ op: 'set', path: 'heroIdx', value: btn }]).hand).hand.streets.map(s => s.cards));
      const d = DRAFT(); d.tableSize = 9; d.blinds = { sb: null, bb: null, ante: 0 };
      d.streets.forEach(s => { s.actions = s.actions.map(a => (a.toAmount ? { player: a.player, action: a.action, toAmountBB: a.toAmount / 3 } : a)); });
      const pb = normalizeDraft(d).hand;
      const sets = [{ path: 'blinds.sb', value: 1 }, { path: 'blinds.bb', value: 3 }];
      eq(applyAnswer(pb, { id: 'blinds.bb' }, { op: 'setMany', sets }).streets.map(s => s.actions.map(a => a.amount)),
        normalizeHand(applyOps(pb, sets.map(x => ({ op: 'set', ...x }))).hand).hand.streets.map(s => s.actions.map(a => a.amount)));
    });
  } else {
    console.log('(server agreement tests skipped: lib/quick-add is not in this tree)');
  }
}

// ── The stacks best guess fits the hand's own action (integration fix, 2026-10-01) ──
test('stacks: an all-in hand suggests the all-in amount first, and taking it settles the stacks', () => {
  const h = { gameType: 'NLH', heroIdx: 0, blinds: { sb: 100, bb: 200, ante: 0 },
    players: [P('Hero', 'BTN/SB', null), P('Opp', 'BB', null)],
    streets: [St('Preflop', 'AsKd', [''], '', [A(0, 'all-in', 9900), A(1, 'call', 9800)])] };
  const g = gap(h, 'stacks');
  ok(g, 'stacks gap raised');
  ok(/10,000/.test(g.options[0].label), 'first option is the all-in amount: ' + g.options[0].label);
  const after = applyAnswer(h, g, g.options[0].value);
  ok(!ids(after).some(id => /^stack/.test(id)), 'no stack gaps after taking it: ' + ids(after).join(','));
});
test('stacks: action bigger than 100 BB never gets a best guess too shallow for it', () => {
  const h = { gameType: 'NLH', heroIdx: 0, blinds: { sb: 1, bb: 2, ante: 0 },
    players: [P('Hero', 'BTN/SB', null), P('Opp', 'BB', null)],
    streets: [St('Preflop', 'AsKd', [''], '', [A(0, 'raise', 5), A(1, 'raise', 18), A(0, 'call', 14)]),
      St('Flop', '', [''], 'Kh7c2d', [A(1, 'bet', 200), A(0, 'call', 200)])] };
  const g = gap(h, 'stacks');
  const v = g.options[0].value.sets[0].value;
  ok(v >= 220, 'best guess ' + v + ' covers the 220 put in');
});

// ── HAND_CONFIG drift (needs utils.js, which touches localStorage at import) ──
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;
const utils = await import('../../vite-app/src/utils/utils.js');
test('the quick-add HAND_CONFIG copy matches utils.js', () => {
  eq(QA_HAND_CONFIG, utils.HAND_CONFIG);
  eq(QA_DEFAULT, utils.HAND_CONFIG_DEFAULT);
});

// ── report ──
if (failures.length) console.error('FAILED:\n  ' + failures.join('\n  '));
console.log(`${passed} tests passed, ${failed} failed; ${assertions} assertions`);
process.exit(failed ? 1 : 0);
