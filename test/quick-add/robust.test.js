// Quick add made more robust (owner, 2026-11-19: "We need to make the shorthand and voice add more
// robust"): the fixes from the owner's two hands of 2026-11-14 and the October shorthand eval's open
// patterns. No API key: every hand is a hand-written record_hand draft, as the model would send it.
// Run: node --test test/quick-add/robust.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCards, parseStakes } = require('../../lib/quick-add/cards');
const { looksSpoken } = require('../../lib/quick-add/speech');
const { normalizeDraft } = require('../../lib/quick-add/normalize');
const { buildParseRequest } = require('../../lib/quick-add/prompt');

const cards = (s) => { const r = parseCards(s); return r && r.cards.join(''); };
const stakes = (s) => { const r = parseStakes(s); return r && [r.sb, r.bb]; };

test('a lower-case "4tt" flop is 4-T-T; a texture word needs a board of three', () => {
  assert.equal(cards('4tt'), '4xTxTx');
  assert.equal(parseCards('4tt').texture, undefined);
  assert.equal(parseCards('K72tt').texture, 'two-tone');
  assert.equal(parseCards('873r').texture, 'rainbow');
  assert.equal(cards('AKr'), 'AxKx');
});

test('stakes copied with words around them, and NL200 / 200NL / PLO200', () => {
  assert.deepEqual(stakes('1/2k bba'), [1000, 2000]);
  assert.deepEqual(stakes('lvl 18 400/800/800'), [400, 800]);
  assert.deepEqual(stakes('blinds 15k/30k, ante 30k'), [15000, 30000]);
  assert.deepEqual(stakes('1/2 w/ $4 straddle'), [1, 2]);
  assert.deepEqual(stakes('2k/4k no ante'), [2000, 4000]);
  assert.deepEqual(stakes('100/200 w/ 200 bb ante'), [100, 200]);
  assert.deepEqual(stakes('NL200'), [1, 2]);
  assert.deepEqual(stakes('200NL'), [1, 2]);
  assert.deepEqual(stakes('PLO 500'), [2.5, 5]);
  assert.equal(parseStakes('PLO5'), null); // a game
  assert.equal(parseStakes('NL 2-7 SD'), null); // a game
  assert.deepEqual(stakes('1/3'), [1, 3]); // unchanged
  assert.deepEqual(parseStakes('1/2/4/800').numbers, [1, 2, 4, 800]);
});

test('the written stakes correct the model where words were copied with them', () => {
  const d = {
    gameType: 'NLH', gameMode: 'mtt', blinds: { sb: 1, bb: 2, ante: 2, stakes: '1/2k bba' },
    players: [{ position: 'BTN', isHero: true, startingStack: 60000 }, { position: 'BB', isHero: false, startingStack: 60000 }],
    streets: [{ name: 'Preflop', cards: [{ player: 0, cards: 'AhKh' }], actions: [{ player: 0, action: 'raise', toAmount: 5000 }, { player: 1, action: 'call' }] }],
  };
  const { hand } = normalizeDraft(d, {});
  assert.equal(hand.blinds.sb, 1000);
  assert.equal(hand.blinds.bb, 2000);
});

const bigO = (flop) => ({
  gameType: 'Big O', gameMode: 'cash', blinds: { sb: 1, bb: 2, ante: 0 },
  players: [{ position: 'BTN', isHero: false }, { position: 'BB', isHero: true }],
  streets: [
    { name: 'Preflop', cards: [{ player: 1, cards: 'ATT42cc' }], actions: [{ player: 0, action: 'raise', toAmount: 6 }, { player: 1, action: 'call' }] },
    { name: 'Flop', board: flop, actions: [{ player: 1, action: 'check' }, { player: 0, action: 'check' }] },
  ],
});

test('owner, 2026-11-14: "ATT42cc" with Tc on the flop takes the clubs elsewhere, no duplicate', () => {
  const { hand, notes } = normalizeDraft(bigO('Tc86'), {});
  const hero = hand.streets[0].cards.hero.match(/../g);
  const board = hand.streets[1].cards.board.match(/../g);
  assert.ok(!hero.includes('Tc'), hero.join(' '));
  assert.equal(new Set([...hero, ...board]).size, hero.length + board.length, 'no card twice');
  assert.equal(hero.filter((c) => c[1] === 'c').length, 2, 'two clubs, as said');
  assert.ok(hero.includes('Ac'), 'the first card as written keeps the suit');
  assert.ok(!notes.some((n) => /more than once/.test(n)), notes.join(' | '));
  assert.ok(notes.some((n) => /Tc is shown elsewhere/.test(n)), notes.join(' | '));
});

test('"ATT42cc" with no clash keeps the first cards as written', () => {
  const { hand, notes } = normalizeDraft(bigO('T86'), {});
  assert.match(hand.streets[0].cards.hero, /^AcTc/);
  assert.ok(notes.some((n) => /does not say which cards/.test(n)));
});

test('owner, 2026-11-14: "b40" with a 35bb stack, told in big blinds, can only be 40% of the pot', () => {
  const d = {
    gameType: 'NLH', tableSize: 6, othersFolded: true,
    players: [{ position: 'UTG', isHero: false, startingStackBB: 35 }, { position: 'UTG+1', isHero: true, startingStackBB: 35 }],
    streets: [
      { name: 'Preflop', cards: [{ player: 1, cards: 'JhJc' }], actions: [{ player: 0, action: 'raise', toAmountBB: 2 }, { player: 1, action: 'raise', toAmountBB: 5 }, { player: 0, action: 'call' }] },
      { name: 'Flop', board: 'Th9s4h', actions: [{ player: 0, action: 'check' }, { player: 1, action: 'bet', sizeChoices: [{ potFraction: 0.4 }, { toAmount: 40 }] }, { player: 0, action: 'call' }] },
    ],
  };
  const { hand, notes } = normalizeDraft(d, {});
  const bet = hand.streets[1].actions[1];
  assert.equal(bet.potFraction, 0.4);
  assert.equal(bet.sizeChoices, undefined);
  assert.ok(notes.some((n) => /can only be 40% of the pot/.test(n)), notes.join(' | '));
});

const chipsHand = (stack, preflop, choices) => ({
  gameType: 'NLH', blinds: { sb: 1, bb: 2, ante: 0 },
  players: [{ position: 'BTN', isHero: true, startingStack: stack }, { position: 'BB', isHero: false, startingStack: 200 }],
  streets: [
    { name: 'Preflop', actions: preflop },
    { name: 'Flop', board: 'Kd7c2h', actions: [{ player: 1, action: 'check' }, { player: 0, action: 'bet', sizeChoices: choices }] },
  ],
});

test('a two-way size: both readings possible stays a question; an impossible one is dropped', () => {
  const open = [{ player: 0, action: 'raise', toAmount: 6 }, { player: 1, action: 'call' }];
  const both = normalizeDraft(chipsHand(200, open, [{ potFraction: 0.25 }, { toAmount: 25 }]), {}).hand;
  assert.equal(both.streets[1].actions[1].sizeChoices.length, 2);
  // 25 chips is more than a 30 stack after a 6 open: 25% of the pot it is.
  const short = normalizeDraft(chipsHand(30, open, [{ potFraction: 0.25 }, { toAmount: 25 }]), {}).hand;
  assert.equal(short.streets[1].actions[1].amount, 3);
  // A limped pot of 4: 25% of it is 1, under the 2 big blind: 25 chips it is.
  const limped = [{ player: 0, action: 'call' }, { player: 1, action: 'check' }];
  const small = normalizeDraft(chipsHand(200, limped, [{ potFraction: 0.25 }, { toAmount: 25 }]), {}).hand;
  assert.equal(small.streets[1].actions[1].amount, 25);
});

test('"everyone $320": every dealt seat gets the stack; before seating it waits in quickAdd', () => {
  const d = {
    gameType: 'NLH', gameMode: 'cash', blinds: { sb: 2, bb: 5, ante: 0 }, tableSize: 6, othersFolded: true, allStacks: { startingStack: 320 },
    players: [{ position: 'CO', isHero: true }, { position: 'BB', isHero: false, startingStack: 500 }],
    streets: [{ name: 'Preflop', cards: [{ player: 0, cards: 'AhKh' }], actions: [{ player: 0, action: 'raise', toAmount: 15 }, { player: 1, action: 'call' }] }],
  };
  const seated = normalizeDraft(d, {}).hand;
  assert.deepEqual(seated.players.map((p) => p.startingStack), [320, 320, 320, 320, 320, 500]);
  assert.equal(seated.quickAdd && seated.quickAdd.allStacks, undefined);
  const d2 = { ...d };
  delete d2.tableSize;
  const waiting = normalizeDraft(d2, {}).hand;
  assert.deepEqual(waiting.quickAdd.allStacks, { startingStack: 320 });
  assert.deepEqual(waiting.players.map((p) => p.startingStack), [320, 500]);
});

test('dictation sent as typed text is recognised; typed shorthand is not', () => {
  assert.equal(looksSpoken('two five live nine handed under the gun opens to fifteen I three bet to forty five on the button with ace king of spades he calls flop comes king seven deuce rainbow he checks I bet fifty he calls'), true);
  assert.equal(looksSpoken('So I have pocket jacks in the hijack, the cutoff raises to twelve hundred, I three bet to thirty five hundred and he calls. The flop is queen nine four with two hearts.'), true);
  assert.equal(looksSpoken('1/3 live 9 handed. UTG limps, I raise to 15 on the BTN with AhQh, BB calls, UTG calls. Flop Qs7d2c, x to me, b25, BB f, UTG c. Turn 4h xx. River Ks, he bets 60, I call'), false);
  assert.equal(looksSpoken('JJ utg+1 vs utg 2bb open, 5bb 3b, 35bb eff. flop T94hh b40 c turn 8x x x river h'), false);
  assert.equal(looksSpoken('*** HOLE CARDS ***\nDealt to Hero [Ah Kh]\nSeat 1: someone (100 in chips) and twenty thousand forty thousand king queen jack ace of spades'), false);
});

test('a speech description gets the speech reading and the number-word pass', () => {
  const r = buildParseRequest({ text: 'I raise to twelve hundred with pocket jacks', source: 'speech', hints: {}, model: 'm' });
  assert.match(r.system[0].text, /speech transcript/);
  assert.match(JSON.stringify(r.messages), /1200/);
});
