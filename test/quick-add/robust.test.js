// Quick add made more robust (owner, 2026-11-19: "We need to make the shorthand and voice add more
// robust"): the fixes from the owner's two hands of 2026-11-14 and the October shorthand eval's open
// patterns. No API key: every hand is a hand-written record_hand draft, as the model would send it.
// Run: node --test test/quick-add/robust.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCards, parseStakes } = require('../../lib/quick-add/cards');
const { looksSpoken } = require('../../lib/quick-add/speech');
const { normalizeDraft, normalizeHand } = require('../../lib/quick-add/normalize');
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

/* The owner's PLO hand (2026-11-19, futurega.me/h/Ck3i6mIB): "QQJ4shsh" and a flop of "AQ5hch" came back as
   Qd Qs Jh 4h and Ac Qh 5s, the run twice was one board, and "AAK5ssxx" (two aces of spades as written) was never
   shown. The draft below is the reading that reproduces the saved hand exactly: the suit letters turned into counts. */
const OWNER_PLO_TEXT = `$2/2/5 plo
Ep $15, hj, Co c. Bu $50. I sb QQJ4shsh c. Hj co c
AQ5hch. X x x bu $200 with ~$450 behind. I c, f f
2cc. X he jam $435 I c run twice brick brick
He AAK5ssxx`;
const ownerPlo = (format = { runouts: 2, otherRunouts: [''] }, riverActions = null) => ({
  gameType: 'PLO', gameMode: 'cash', currency: '$', blinds: { sb: 2, bb: 5, ante: 2, stakes: '$2/2/5' },   // as the model read it
  othersFolded: true, format, tableSize: 8,
  players: [{ position: 'EP', isHero: false }, { position: 'HJ', isHero: false }, { position: 'CO', isHero: false },
    { position: 'BTN', isHero: false }, { position: 'SB', isHero: true }],
  streets: [
    { name: 'Preflop', cards: [{ player: 4, cards: 'QQJ4', suitCounts: { h: 2 } }, { player: 3, cards: 'AAK5ssxx' }], actions: [
      { player: 0, action: 'raise', toAmount: 15 }, { player: 1, action: 'call' }, { player: 2, action: 'call' },
      { player: 3, action: 'raise', toAmount: 50 }, { player: 4, action: 'call' }, { player: 0, action: 'fold' },
      { player: 1, action: 'call' }, { player: 2, action: 'call' }] },
    { name: 'Flop', board: 'AQ5', actions: [
      { player: 4, action: 'check' }, { player: 1, action: 'check' }, { player: 2, action: 'check' },
      { player: 3, action: 'bet', toAmount: 200, behind: 450 }, { player: 4, action: 'call' },
      { player: 1, action: 'fold' }, { player: 2, action: 'fold' }] },
    { name: 'Turn', board: '2c', suitCounts: { c: 2 }, actions: [
      { player: 4, action: 'check' }, { player: 3, action: riverActions ? 'bet' : 'all-in', toAmount: riverActions ? 100 : 435 }, { player: 4, action: 'call' }] },
    ...(riverActions ? [{ name: 'River', board: '9d', actions: riverActions }] : []),
  ],
  result: { winners: [{ playerIdx: 3, split: false }] },
});

test('a pair given one suit twice ("AAK5ssxx") is suited in that suit, not two aces of spades', () => {
  const r = parseCards('AAK5ssxx');
  assert.equal(r.cards.join(''), 'AsAxKs5x');
  assert.equal(r.partialSuits, true);
  assert.equal(cards('QQJ4shsh'), 'QsQhJs4h');   // as many letters as cards: in order, unchanged
  assert.equal(cards('AQ5hch'), 'AhQc5h');
  assert.equal(cards('AA92hh'), 'AhAx9h2x');      // the shorthand with fewer letters, unchanged
});

test('the cards as typed win over the model reading their suit letters as counts', () => {
  const without = normalizeDraft(ownerPlo(), {}).hand;
  assert.equal(without.streets[0].cards.hero, 'QdQsJh4h');   // what the owner got
  assert.equal(without.streets[1].cards.board, 'AcQh5s');
  const { hand, notes } = normalizeDraft(ownerPlo(), { text: OWNER_PLO_TEXT });
  assert.equal(hand.streets[0].cards.hero, 'QsQhJs4h');
  assert.equal(hand.streets[1].cards.board, 'AhQc5h');
  assert.equal(hand.streets[2].cards.board, '2c');
  const opp = hand.streets[0].cards.opponents.find(Boolean);
  assert.match(opp, /^As(Ad|Ac)Ks5[dc]$/);                  // shown: the ace and king of spades, the rest filled
  assert.ok(notes.some((n) => /Cards read as you typed them: the flop Ah Qc 5h; your hand Qs Qh Js 4h/.test(n)), notes.join(' | '));
  assert.ok(!notes.some((n) => /more than once/.test(n)), notes.join(' | '));
  // Speech is not typed notation, and words are never cards.
  assert.equal(normalizeDraft(ownerPlo(), { source: 'speech', text: OWNER_PLO_TEXT }).hand.streets[0].cards.hero, 'QdQsJh4h');
  const words = { ...ownerPlo(), streets: ownerPlo().streets.map((st, i) => (i === 1 ? { ...st, board: 'AKJ' } : st)) };
  const w = normalizeDraft(words, { text: 'pocket Jacks, As he jams, flop AKJ' });
  assert.ok(!w.notes.some((n) => /read as you typed/.test(n)), w.notes.join(' | '));   // "Jacks" is not Jx Ac Ks
});

test('a hand run twice is stored as runs from the street after the betting, a run nobody named left open', () => {
  const { hand, notes } = normalizeDraft(ownerPlo(), { text: OWNER_PLO_TEXT });
  assert.equal(hand.runs, 2);
  assert.equal(hand.runsFrom, 3);
  assert.equal(hand.streets[3].cards.board, '');
  assert.equal(hand.streets[3].cards.board2, undefined);
  assert.ok(!(hand.quickAdd && hand.quickAdd.unsupported), JSON.stringify(hand.quickAdd));
  assert.ok(!notes.some((n) => /cannot store/.test(n)), notes.join(' | '));
  // A second river said: it is that run's river; given with the shared cards in front, they are dropped.
  const said = normalizeDraft(ownerPlo({ runouts: 2, otherRunouts: ['9d'] }), { text: OWNER_PLO_TEXT }).hand;
  assert.equal(said.streets[3].cards.board2, '9d');
  const full = normalizeDraft(ownerPlo({ runouts: 2, otherRunouts: ['AhQc5h2c9d'] }), { text: OWNER_PLO_TEXT }).hand;
  assert.equal(full.streets[3].cards.board2, '9d');
  // Three times: two later runs.
  const three = normalizeDraft(ownerPlo({ runouts: 3, otherRunouts: ['9d', ''] }), { text: OWNER_PLO_TEXT }).hand;
  assert.equal(three.runs, 3);
  assert.equal(three.streets[3].cards.board2, '9d');
  // The client's hand comes back through normalizeHand with its runs and run cards.
  const again = normalizeHand(said).hand;
  assert.equal(again.runs, 2);
  assert.equal(again.runsFrom, 3);
  assert.equal(again.streets[3].cards.board2, '9d');
  // Betting on the river leaves nothing to run: one board, said so.
  const late = normalizeDraft(ownerPlo(undefined, [{ player: 4, action: 'check' }, { player: 3, action: 'check' }]), { text: OWNER_PLO_TEXT });
  assert.equal(late.hand.runs, undefined);
  assert.ok(late.notes.some((n) => /nothing was left to run/.test(n)), late.notes.join(' | '));
});

test('a cash game\'s third number is its straddle: "$2/2/5" is $2/$2 with a $5 straddle', () => {
  const { hand, notes } = normalizeDraft(ownerPlo(), { text: OWNER_PLO_TEXT });
  assert.equal(hand.blinds.sb, 2);
  assert.equal(hand.blinds.bb, 2);
  assert.equal(hand.blinds.ante, 0);
  assert.equal(hand.blinds.straddle_utg, true);
  assert.equal(hand.blinds.straddleAmount, 5);
  assert.ok(notes.some((n) => /read as 2\/2 with a 5 straddle/.test(n)), notes.join(' | '));
  // EP opens first, from the seat after the straddler; the straddler (seat 0, $5 in) folds to the 3-bet.
  const pre = hand.streets[0].actions;
  assert.deepEqual([pre[0].player, pre[0].action, pre[0].amount], [1, 'raise', 15]);
  assert.ok(pre.some((a) => a.player === 0 && a.action === 'fold'));
  // Twice the big blind is the replayer's own straddle: no size stored. A tournament's "25/50/50" is its ante.
  const twice = normalizeDraft({ ...ownerPlo(), blinds: { stakes: '$1/2/4' } }, { text: OWNER_PLO_TEXT }).hand.blinds;
  assert.deepEqual([twice.sb, twice.bb, twice.straddle_utg, twice.straddleAmount], [1, 2, true, undefined]);
  const mtt = normalizeDraft({ ...ownerPlo(), gameMode: 'mtt', currency: null, blinds: { stakes: '25/50/50' } }, {}).hand.blinds;
  assert.equal(mtt.straddle, undefined);
});
