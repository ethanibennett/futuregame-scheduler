// Quick-add: the hand-history fast path (owner decision H, 2026-10-14). Every history here is
// made up (invented names and numbers) in the layouts the sites write. No API key.
// Run: node --test test/quick-add/hh.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHandHistory } = require('../../lib/quick-add/hh');
const { normalizeDraft } = require('../../lib/quick-add/normalize');

const STARS_CASH = `PokerStars Hand #100000001: Hold'em No Limit ($0.50/$1.00 USD) - 2026/10/01 20:15:00 ET
Table 'Zeta III' 6-max Seat #3 is the button
Seat 1: quokka77 ($100.00 in chips)
Seat 2: marsupial ($98.50 in chips)
Seat 3: tallulah ($250.00 in chips)
Seat 4: ZedLeppelin ($100.00 in chips)
Seat 6: bluefin_9 ($40.25 in chips)
ZedLeppelin: posts small blind $0.50
bluefin_9: posts big blind $1.00
*** HOLE CARDS ***
Dealt to tallulah [Ah Qd]
quokka77: folds
marsupial: raises $2.00 to $3.00
tallulah: raises $9.00 to $12.00
ZedLeppelin: folds
bluefin_9: folds
marsupial: calls $9.00
*** FLOP *** [Kd 7c 2s]
marsupial: checks
tallulah: bets $15.00
marsupial: calls $15.00
*** TURN *** [Kd 7c 2s] [9h]
marsupial: checks
tallulah: bets $40.00
marsupial: raises $44.50 to $84.50 and is all-in
tallulah: calls $44.50
*** RIVER *** [Kd 7c 2s 9h] [3c]
*** SHOW DOWN ***
marsupial: shows [Kh Jh] (a pair of Kings)
tallulah: shows [Ah Qd] (high card Ace)
marsupial collected $190.00 from pot
*** SUMMARY ***
Total pot $197.00 | Rake $7.00
Board [Kd 7c 2s 9h 3c]
Seat 1: quokka77 folded before Flop (didn't bet)
Seat 2: marsupial showed [Kh Jh] and won ($190.00) with a pair of Kings
`;

test('PokerStars cash: seats, button, stacks, actions, boards, showdown and winner', () => {
  const hh = parseHandHistory(STARS_CASH);
  assert.equal(hh.format, 'pokerstars');
  assert.equal(hh.game, 'NLH');
  assert.deepEqual(hh.unread, []);
  const { draft } = hh.build();
  assert.equal(draft.gameMode, 'cash');
  assert.equal(draft.currency, 'USD');
  assert.equal(draft.buttonSeat, 3);
  assert.equal(draft.tableSize, 5);
  assert.deepEqual(draft.blinds, { sb: 0.5, bb: 1, ante: 0 });
  assert.deepEqual(draft.players.map((p) => [p.seatNumber, p.startingStack, p.isHero]), [[1, 100, false], [2, 98.5, false], [3, 250, true], [4, 100, false], [6, 40.25, false]]);
  assert.ok(draft.players.every((p) => !('name' in p)), 'no screen name in the draft');
  const pre = draft.streets[0];
  assert.deepEqual(pre.cards, [{ player: 1, cards: 'KhJh' }, { player: 2, cards: 'AhQd' }]);
  assert.deepEqual(pre.actions.map((a) => [a.player, a.action, a.toAmount ?? a.amount ?? null]),
    [[0, 'fold', null], [1, 'raise', 3], [2, 'raise', 12], [3, 'fold', null], [4, 'fold', null], [1, 'call', 9]]);
  assert.deepEqual(draft.streets.map((s) => s.board || ''), ['', 'Kd7c2s', '9h', '3c']);
  assert.equal(draft.streets[2].actions[2].action, 'all-in');
  assert.equal(draft.streets[2].actions[2].toAmount, 84.5);
  assert.deepEqual(draft.result, { winners: [{ playerIdx: 1, split: false }] });
});

test('PokerStars cash: the draft becomes a seated hand with positions from the button', () => {
  const { draft } = parseHandHistory(STARS_CASH).build();
  const { hand } = normalizeDraft(draft, { source: 'text' });
  assert.equal(hand.gameType, 'NLH');
  assert.equal(hand.players.length, 5);
  // Seat 3 holds the button; the five players are BTN, SB, BB then the first two to act.
  assert.equal(hand.players[hand.heroIdx].position, 'BTN');
  assert.deepEqual(hand.players.map((p) => p.position), ['HJ', 'CO', 'BTN', 'SB', 'BB']);
  assert.deepEqual(hand.players.map((p) => p.startingStack), [100, 98.5, 250, 100, 40.25]);
});

test('screen names never survive: the anonymised text and the unread lines are scrubbed', () => {
  const hh = parseHandHistory(STARS_CASH.replace('marsupial: calls $9.00', 'marsupial: does a cartwheel $9.00'));
  assert.equal(hh.unread.length, 1);
  for (const name of ['quokka77', 'marsupial', 'tallulah', 'ZedLeppelin', 'bluefin_9', 'Zeta III']) {
    assert.ok(!hh.anonymised.includes(name), name + ' in the anonymised text');
    assert.ok(!hh.unread[0].line.includes(name), name + ' in an unread line');
  }
  assert.match(hh.unread[0].line, /^Player 2: does a cartwheel/);
  assert.match(hh.anonymised, /Dealt to Hero \[Ah Qd\]/);
});

test('an unread line is handed to the fallback one by one, and dropped without an answer', () => {
  const text = STARS_CASH.replace('marsupial: calls $9.00', 'marsupial: does a cartwheel $9.00');
  const hh = parseHandHistory(text);
  const without = hh.build().draft.streets[0].actions.map((a) => a.action);
  assert.equal(without.length, 5);
  const resolved = hh.build(new Map([[0, { player: 1, action: 'call', amount: 9 }]])).draft.streets[0].actions;
  assert.equal(resolved.length, 6);
  assert.deepEqual(resolved[5], { player: 1, action: 'call', amount: 9 });
  assert.equal(hh.build(new Map([[0, null]])).draft.streets[0].actions.length, 5);
});

const STARS_MTT = `PokerStars Hand #100000002: Tournament #900000001, $0.45+$0.05 USD Hold'em No Limit - Level III (25/50) - 2026/10/02 10:00:00 ET
Table '900000001 7' 9-max Seat #7 is the button
Seat 1: p1alpha (4200 in chips)
Seat 2: p2beta (1215 in chips)
Seat 7: p7gamma (1390 in chips)
Seat 8: p8delta (1957 in chips)
Seat 9: Hero123 (1400 in chips)
p1alpha: posts the ante 5
p2beta: posts the ante 5
p7gamma: posts the ante 5
p8delta: posts the ante 5
Hero123: posts the ante 5
p8delta: posts small blind 25
Hero123: posts big blind 50
*** HOLE CARDS ***
Dealt to Hero123 [Qc Kh]
p1alpha: folds
p2beta: calls 50
p7gamma: folds
p8delta: calls 25
Hero123: raises 300 to 350
p2beta: folds
p8delta: calls 300
*** FLOP *** [Ah 9s 6d]
p8delta: checks
Hero123: checks
*** TURN *** [Ah 9s 6d] [Jd]
p8delta: bets 1200 and is all-in
Hero123: ???
`;

test('PokerStars tournament: per-player ante, level blinds, an unfinished hand', () => {
  const hh = parseHandHistory(STARS_MTT);
  assert.equal(hh.format, 'pokerstars');
  assert.equal(hh.unread.length, 1);                 // "Hero123: ???"
  assert.ok(!/Hero123|p8delta/.test(hh.unread[0].line));
  const { draft } = hh.build();
  assert.equal(draft.gameMode, 'mtt');
  assert.equal(draft.currency, null);
  assert.deepEqual(draft.blinds, { sb: 25, bb: 50, ante: 5, anteType: 'per_player' });
  assert.equal(draft.streets[2].actions[0].action, 'all-in');
  assert.equal(draft.streets[2].actions[0].toAmount, 1200);
  assert.equal(draft.result, undefined);
});

const FULL_TILT = `Full Tilt Poker Game #20000000001: $0.25/$0.50 Hold'em (6 max) - 2010/05/05 - 21:00:00 (ET)
Table Aurora (6 max) (Real Money)
Seat 1: Wombat42 ($50.00)
Seat 2: kiwi_bird ($61.20)
Seat 4: HeroFT ($48.75)
The button is in seat #1
kiwi_bird posts the small blind of $0.25
HeroFT posts the big blind of $0.50
The button is in seat #1
*** HOLE CARDS ***
Dealt to HeroFT [Js Jd]
Wombat42 raises to $1.50
kiwi_bird calls $1.25
HeroFT raises to $5.00
Wombat42 folds
kiwi_bird calls $3.50
*** FLOP *** [Ac 8d 3s] (Total Pot: $11.00, 2 Players)
kiwi_bird checks
HeroFT bets $6.00
kiwi_bird folds
Uncalled bet of $6.00 returned to HeroFT
HeroFT wins the pot ($10.50)
*** SUMMARY ***
Total pot $11.00 | Rake $0.50
`;

test('Full Tilt: no colon, "raises to", the button line, a pot won', () => {
  const hh = parseHandHistory(FULL_TILT);
  assert.equal(hh.format, 'fulltilt');
  assert.deepEqual(hh.unread, []);
  const { draft } = hh.build();
  assert.equal(draft.buttonSeat, 1);
  assert.deepEqual(draft.blinds, { sb: 0.25, bb: 0.5, ante: 0 });
  assert.deepEqual(draft.streets[0].actions.map((a) => [a.player, a.action, a.toAmount ?? a.amount ?? null]),
    [[0, 'raise', 1.5], [1, 'call', 1.25], [2, 'raise', 5], [0, 'fold', null], [1, 'call', 3.5]]);
  assert.deepEqual(draft.result, { winners: [{ playerIdx: 2, split: false }] });
  const { hand } = normalizeDraft(draft, { source: 'text' });
  assert.deepEqual(hand.players.map((p) => p.position), ['BTN', 'SB', 'BB']);
});

const GG_SIDE = `Poker Hand #HD900000003: Hold'em No Limit ($0.25/$0.50) - 2026/10/03 11:00:00
Table 'Gamma' 6-max Seat #1 is the button
Seat 1: 8f3a2c1d ($30.00 in chips)
Seat 2: 1b2c3d4e ($12.00 in chips)
Seat 3: Hero ($60.00 in chips)
1b2c3d4e: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to 8f3a2c1d
Dealt to 1b2c3d4e
Dealt to Hero [Ad Ac]
8f3a2c1d: raises $29.50 to $30.00 and is all-in
1b2c3d4e: calls $11.75 and is all-in
Hero: calls $29.50
*** FLOP *** [2c 5d 9h]
*** TURN *** [2c 5d 9h] [Ts]
*** RIVER *** [2c 5d 9h Ts] [4d]
*** SHOW DOWN ***
Hero: shows [Ad Ac] (a pair of Aces)
8f3a2c1d: shows [Kh Kd] (a pair of Kings)
1b2c3d4e: shows [Ah Ks] (a pair of Aces)
Hero collected $12.50 from side pot
8f3a2c1d collected $34.00 from main pot
*** SUMMARY ***
Total pot $46.50
`;

test('GGPoker: hex-id names, all-ins, and a winner per pot', () => {
  const hh = parseHandHistory(GG_SIDE);
  assert.equal(hh.format, 'gg');
  assert.deepEqual(hh.unread, []);
  const { draft } = hh.build();
  assert.deepEqual(draft.result.winners, [{ playerIdx: 0, split: false }]);
  assert.deepEqual(draft.result.pots, [
    { name: 'main', winners: [{ playerIdx: 0, split: false }] },
    { name: 'side 1', winners: [{ playerIdx: 2, split: false }] },
  ]);
  // And the normaliser keeps a winner per pot beside the main pot's.
  const { hand } = normalizeDraft(draft, { source: 'text' });
  assert.equal(hand.result.pots.length, 2);
  assert.deepEqual(hand.result.winners, hand.result.pots[0].winners);
});

const CONVERTER = `5NL 6-max, Stars. $0.02/$0.05.
Stacks: UTG $5.62 / MP $4.25 / CO $7.17 / BTN $3.94 / SB $2.82 / Hero BB $5.90
Preflop ($0.07): Hero BB with Jc Js. UTG folds, MP folds, CO raises to $0.15, BTN calls, SB folds, Hero raises to $0.60, CO calls, BTN folds.
Flop ($1.25) 6h 8c 7h: Hero bets $0.60, CO calls.
Turn ($2.45) 5c: Hero checks, CO bets $1.04, Hero calls.
`;

test('a converter layout is read when every clause is understood', () => {
  const hh = parseHandHistory(CONVERTER);
  assert.equal(hh.format, 'converter');
  const { draft } = hh.build();
  assert.equal(draft.players.length, 6);
  assert.equal(draft.players[5].isHero, true);
  assert.equal(draft.streets[0].cards[0].cards, 'JcJs');
  assert.deepEqual(draft.streets[0].actions.map((a) => [a.player, a.action, a.toAmount ?? null]),
    [[0, 'fold', null], [1, 'fold', null], [2, 'raise', 0.15], [3, 'call', null], [4, 'fold', null], [5, 'raise', 0.6], [2, 'call', null], [3, 'fold', null]]);
  assert.equal(draft.streets[1].board, '6h8c7h');
  assert.equal(draft.streets[1].potBefore, 1.25);
  const { hand } = normalizeDraft(draft, { source: 'text' });
  assert.equal(hand.gameType, null);   // the layout names no game
  assert.equal(hand.players.length, 6);
});

test('a converter layout with a clause the grammar cannot read goes to the model whole', () => {
  const hh = parseHandHistory(CONVERTER.replace('Hero bets $0.60, CO calls.', 'Hero $0.60, CO snap called.'));
  assert.equal(hh, null);
});

test('prose is not a hand history', () => {
  assert.equal(parseHandHistory('1/3 live, 9 handed. UTG limps, I raise to 15 on the button with AhQh, BB calls, UTG calls. Flop Qs7d2c, checks to me.'), null);
  assert.equal(parseHandHistory('short'), null);
});

test('stud and draw histories are recognised as histories but not read in code', () => {
  const stud = `PokerStars Hand #1: 7 Card Stud Limit ($1/$2 USD) - 2026/10/01
Table 'S' 8-max
Seat 1: alpha ($50 in chips)
Seat 2: beta ($50 in chips)
alpha: posts the ante $0.25
*** 3rd STREET ***
Dealt to alpha [2c 3d 4h]
`;
  const hh = parseHandHistory(stud);
  assert.ok(hh);
  assert.equal(hh.unsupported, true);
  assert.ok(!hh.anonymised.includes('alpha'));
});

test('a blind posted all-in for less than the blind does not become the stakes', () => {
  const short = `PokerStars Hand #100000009: Tournament #5550001, $1+$0.10 USD Hold'em No Limit - Level II (500/1000) - 2026/10/01 20:15:00 ET
Table '5550001 1' 6-max Seat #2 is the button
Seat 1: kestrel (20000 in chips)
Seat 2: osprey (20000 in chips)
Seat 3: plover (15000 in chips)
Seat 4: wren (800 in chips)
plover: posts small blind 500
wren: posts big blind 800 and is all-in
*** HOLE CARDS ***
Dealt to osprey [Ah Kh]
kestrel: folds
osprey: raises 1500 to 2500
plover: folds
Uncalled bet (1700) returned to osprey
*** SUMMARY ***
Total pot 2100 | Rake 0
`;
  const { draft } = parseHandHistory(short).build();
  assert.equal(draft.blinds.bb, 1000, 'the big blind is the header\'s 1000, not the 800 posted');
  assert.equal(draft.blinds.sb, 500);
  // A limit header reads big blind / big bet, so the post stays what it is.
  const limit = short.replace("Hold'em No Limit - Level II (500/1000)", "Hold'em Limit - Level II (1000/2000)");
  assert.equal(parseHandHistory(limit).build().draft.blinds.bb, 800);
});
