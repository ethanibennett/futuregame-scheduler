// Quick-add: the deterministic readers and normaliser steps added from the collected
// corpora (2026-10-14; docs/quick-add-hands.md "Corpus round"). No API key: every hand
// here is a hand-written record_hand draft, as the model would send it.
// Run: node --test test/quick-add/normalisers.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCards, parseAmount, parseAmountInfo, parseStakes } = require('../../lib/quick-add/cards');
const G = require('../../lib/quick-add/games');
const S = require('../../lib/quick-add/speech');
const { normalizeDraft, normalizeHand } = require('../../lib/quick-add/normalize');
const { applyOps, fastAnswerOps } = require('../../lib/quick-add/patch');
const { HAND_TOOL, buildParseRequest, PARSE_SYSTEM } = require('../../lib/quick-add/prompt');

const cards = (s) => { const r = parseCards(s); return r && r.cards.join(''); };
const acts = (hand, si) => hand.streets[si].actions.map((a) => [a.player, a.action, a.amount]);
const pos = (hand) => hand.players.map((p) => p.position);
const D = (o) => ({ notes: [], ...o });

/* ── cards.js ─────────────────────────────────────────────────────────────── */

test('card notation: emoji selectors, the heavy heart, equal ranks, textures', () => {
  assert.equal(cards('Q♣️Q♠️'), 'QcQs');          // U+FE0F after the suit
  assert.equal(cards('K♠︎K♣︎'), 'KsKc');          // U+FE0E
  assert.equal(cards('A❤️'), 'Ah');               // U+2764
  assert.equal(cards('AA92hh'), 'AhAx9h2x');      // never two aces of hearts
  assert.equal(cards('KQJ2dd'), 'KdQdJx2x');      // unchanged
  const t5 = parseCards('T5Ttt');
  assert.deepEqual([t5.cards.join(''), t5.texture], ['Tx5xTx', 'two-tone']);
  assert.equal(cards('KdJ97'), 'KdJx9x7x');      // mixed: suits where given
  for (const s of ['569r', '732r', 'A, 9, 5r', '873R']) assert.equal(parseCards(s).texture, 'rainbow', s);
  assert.equal(parseCards('6JQQ rain bow').texture, 'rainbow');
  assert.equal(parseCards('Q72 mono').texture, 'monotone');
  assert.equal(cards('QTT'), 'QxTxTx');           // upper-case TT stays ranks
  assert.equal(cards('J83hhx'), 'Jh8h3x');        // unchanged
});

test('one suit letter after a two-card holding means both cards (owner, 2026-10-14)', () => {
  assert.equal(cards('AKh'), 'AhKh');
  assert.equal(cards('A10h'), 'AhTh');
  assert.equal(cards('J 10d'), 'JdTd');
  assert.equal(cards('QJc'), 'QcJc');
  assert.equal(parseCards('AKh').bothSuited, true);
  // Unchanged: suited-without-a-suit, pairs, longer holdings, interleaved suits.
  assert.equal(cards('AKs'), 'AxKx');
  assert.equal(parseCards('AKs').suitedness, 's');
  assert.equal(cards('KdJ'), 'KdJx');
  assert.equal(cards('KQJ2dd'), 'KdQdJx2x');
  assert.equal(cards('AAh'), 'AhAx');          // two aces cannot share a suit
  assert.equal(cards('AdKdQd'), 'AdKdQd');
});

test('"1/2/4/800" is a tower of straddles in thousands: the model\'s 100/200 stays', () => {
  const draft = (blinds) => D({
    gameType: 'PLO', gameMode: 'cash', tableSize: 2, blinds,
    players: [{ position: 'BTN', isHero: true, startingStack: 360000 }, { position: 'BB', startingStack: 320000 }],
    streets: [{ name: 'Preflop', actions: [{ player: 0, action: 'raise', toAmount: 3000 }, { player: 1, action: 'call' }] }],
  });
  const kept = normalizeDraft(draft({ sb: 100, bb: 200, ante: 0, stakes: '1/2/4/800' })).hand.blinds;
  assert.deepEqual([kept.sb, kept.bb], [100, 200]);
  // Two or three numbers are still read as written.
  const k = normalizeDraft(draft({ sb: 6, bb: 12000, ante: 0, stakes: '6/12k' })).hand.blinds;
  assert.deepEqual([k.sb, k.bb], [6000, 12000]);
});

test('card notation: unknown and face-down cards', () => {
  const q = parseCards('Q 10 x');
  assert.deepEqual([q.cards.join(''), q.unknownCount], ['QxTx', 1]);
  const s1 = parseCards('xxJc9c');
  assert.deepEqual([s1.cards.join(''), s1.hiddenCount], ['Jc9c', 2]);
  const s2 = parseCards('(xx)444A(x)');
  assert.deepEqual([s2.cards.join(''), s2.hiddenCount], ['4x4x4xAx', 3]);
  assert.equal(cards('[xx xx] 5c 9h'), '5c9h');
  assert.equal(parseCards('xx'), null);           // still no card at all
  assert.equal(parseCards('x x x'), null);
});

test('amounts: chips prefix, spaced thousands, decimal comma, grand, estimates', () => {
  assert.equal(parseAmount('t2090'), 2090);
  assert.equal(parseAmount('1,2'), 1.2);
  assert.equal(parseAmount('1,200'), 1200);
  assert.equal(parseAmount('400 000'), 400000);
  assert.equal(parseAmount('3 000'), 3000);
  assert.equal(parseAmount('35 grand'), 35000);
  assert.equal(parseAmount('1.2 mil'), 1200000);
  assert.deepEqual(parseAmountInfo('~450'), { value: 450, approx: true });
  assert.deepEqual(parseAmountInfo('like 7500'), { value: 7500, approx: true });
  assert.deepEqual(parseAmountInfo('300kish'), { value: 300000, approx: true });
  assert.deepEqual(parseAmountInfo('about 40k'), { value: 40000, approx: true });
  assert.equal(parseAmount('14-7'), null);        // the prompt's to read, not ours
});

test('stakes: the k carries back, dashes, T for ten, fused speech runs', () => {
  const st = (s, o) => { const r = parseStakes(s, o); return r && r.numbers; };
  assert.deepEqual(st('6/12k'), [6000, 12000]);
  assert.deepEqual(st('1.5/3k'), [1500, 3000]);
  assert.deepEqual(st('500/1k'), [500, 1000]);
  assert.deepEqual(st('8-16'), [8, 16]);
  assert.deepEqual(st('5/T'), [5, 10]);
  assert.deepEqual(st('$1/$2'), [1, 2]);
  assert.deepEqual(st('1/2/4/800'), [1, 2, 4, 800]);
  assert.deepEqual(st('20k/40k/5k'), [20000, 40000, 5000]);
  assert.equal(st('1224'), null);
  assert.deepEqual(st('1224', { fused: true }), [12, 24]);
  assert.deepEqual(st('510', { fused: true }), [5, 10]);
});

/* ── games.js ─────────────────────────────────────────────────────────────── */

test('positions: typed shorthand and recogniser spellings', () => {
  const c = G.canonicalPosition;
  const want = {
    '+1': 'UTG+1', '+2': 'UTG+2', 'U+1': 'UTG+1', 'UTG +1': 'UTG+1', OTB: 'BTN', STRD: 'UTG', Strdl: 'UTG',
    'first to act': 'UTG', 'under the gun one': 'UTG+1', 'the plus one player': 'UTG+1', 'Button (hero)': 'BTN',
    'the cutoff': 'CO', 'under the gone plus one': 'UTG+1', 'eight seat': 'Seat 8', 'seat eight': 'Seat 8', 'Seat #2': 'Seat 2',
    'early position': 'UTG', 'under the gun spot': 'UTG',
    'Hero (BB)': 'BB', 'Hero (HJ)': 'HJ', 'H (BTN)': 'BTN', 'V1 (CO)': 'CO', 'CO (V1)': 'CO',
  };
  for (const [k, v] of Object.entries(want)) assert.equal(c(k), v, k);
  for (const k of ['H', 'Hero', 'late position', 'LP', 'first in', 'Hero (hero)']) assert.equal(c(k), null, k);
});

/* ── speech.js ────────────────────────────────────────────────────────────── */

test('number words: only phrases that are certainly numbers', () => {
  const nw = (t) => S.numberWords(t).text;
  assert.equal(nw('he bets two hundred and ten dollars'), 'he bets 210 dollars');
  assert.equal(nw('I make it fifty three hundred'), 'I make it 5300');
  assert.equal(nw('raise to twelve hundred'), 'raise to 1200');
  assert.equal(nw('a hundred and twenty k'), '120000');
  assert.equal(nw('so thirteen thousand fifty five'), 'so 13055');
  assert.equal(nw('two point five k'), '2500');
  assert.equal(nw('forty-five hundred'), '4500');
  // Rank words and idioms stay as they are.
  for (const t of ['jack ten nine', 'the flop came ten nine five', 'one fifty', 'ace king', 'nine eight seven']) assert.equal(nw(t), t);
  assert.deepEqual(S.numberWords('call twelve hundred').conversions, [{ from: 'twelve hundred', to: 1200 }]);
});

test('spoken amounts and cards for answers', () => {
  assert.equal(S.spokenAmount('twelve hundred'), 1200);
  assert.equal(S.spokenAmount('two hundred and ten dollars'), 210);
  assert.equal(S.spokenAmount('a hundred and twenty k'), 120000);
  assert.equal(S.spokenAmount('one fifty'), 150);
  assert.equal(S.spokenAmount('five'), 5);
  assert.equal(S.spokenAmount('lots'), null);
  assert.equal(S.splitRankRun('1087'), 'T87');
  assert.equal(S.splitRankRun('109'), 'T9');
  assert.equal(S.splitRankRun('910'), '9T');
  assert.equal(S.splitRankRun('2359'), '2359');
  assert.equal(S.splitRankRun('12'), null);
  assert.equal(S.spokenCards('ace king of spades'), 'AsKs');
  assert.equal(S.spokenCards('ace of spades king of hearts'), 'AsKh');
  assert.equal(S.spokenCards('pocket nines'), '99');
  assert.equal(S.spokenCards('king queen suited'), 'KQs');
  assert.equal(S.spokenCards('jack ten of diamonds'), 'JdTd');
  assert.equal(S.spokenCards('king 75'), 'K75');
  assert.equal(S.spokenCards('coin jack'), 'QJ');
  assert.equal(S.spokenCards('the nuts'), null);
  assert.equal(S.spokenCards('AK off'), 'AKo');
  assert.equal(S.spokenCards('KQ of hearts'), 'KhQh');
});

test('answers that need no model: spoken stacks and cards', () => {
  assert.deepEqual(fastAnswerOps({}, { field: 'players.1.startingStack' }, 'twelve hundred'), [{ op: 'set', path: 'players.1.startingStack', value: 1200 }]);
  assert.deepEqual(fastAnswerOps({}, { field: 'players.1.startingStack' }, 'forty big blinds'), [{ op: 'set', path: 'players.1.startingStackBB', value: 40 }]);
  assert.deepEqual(fastAnswerOps({}, { field: 'streets.0.cards.hero' }, 'ace of hearts king of diamonds'), [{ op: 'set', path: 'streets.0.cards.hero', value: 'AhKd' }]);
});

/* ── normalize.js: suits ──────────────────────────────────────────────────── */

const flopDraft = (board, extra = {}) => D({
  gameType: 'NLH', gameMode: 'cash', tableSize: 6, othersFolded: true, blinds: { sb: 1, bb: 2, ante: 0 },
  players: [{ position: 'BTN', isHero: true, startingStack: 200 }, { position: 'BB', startingStack: 200 }],
  streets: [
    { name: 'Preflop', cards: [{ player: 0, cards: 'AhQs' }], actions: [{ player: 0, action: 'raise', toAmount: 5 }, { player: 1, action: 'call' }] },
    { name: 'Flop', board, ...extra, actions: [{ player: 1, action: 'check' }, { player: 0, action: 'check' }] },
  ],
});

test('a counted texture is kept: "ace four deuce, one spade, two clubs"', () => {
  const { hand } = normalizeDraft(flopDraft('A42', { suitCounts: { s: 1, c: 2 } }));
  const flop = hand.streets[1].cards.board;
  assert.equal((flop.match(/c/g) || []).length, 2, flop);
  assert.equal((flop.match(/s/g) || []).length, 1, flop);
  // Without it, the least-used rule still gives a rainbow flop.
  const plain = normalizeDraft(flopDraft('A42')).hand.streets[1].cards.board;
  assert.equal(new Set(plain.match(/../g).map((c) => c[1])).size, 3, plain);
});

test('rainbow, two-tone and monotone; a suffix texture counts too', () => {
  const suits = (b) => b.match(/../g).map((c) => c[1]);
  const two = normalizeDraft(flopDraft('T5T', { texture: 'two-tone' })).hand.streets[1].cards.board;
  assert.equal(new Set(suits(two)).size, 2, two);
  assert.notEqual(two.slice(1, 2), two.slice(5, 6), 'the two tens differ in suit');
  const mono = normalizeDraft(flopDraft('Q72', { texture: 'monotone' })).hand.streets[1].cards.board;
  assert.equal(new Set(suits(mono)).size, 1, mono);
  const rb = normalizeDraft(flopDraft('873r')).hand.streets[1].cards.board;
  assert.equal(new Set(suits(rb)).size, 3, rb);
  const tt = normalizeDraft(flopDraft('T5Ttt')).hand.streets[1].cards.board;
  assert.equal(new Set(suits(tt)).size, 2, tt);
});

test('a texture the given cards break is asked about, not forced', () => {
  const { hand, notes } = normalizeDraft(flopDraft('As4h2d', { suitCounts: { c: 2 } }));
  assert.equal(hand.streets[1].cards.board, 'As4h2d');
  const q = hand.quickAdd.questions.find((x) => x.id.startsWith('texture-conflict'));
  assert.ok(q && !q.blocking, JSON.stringify(hand.quickAdd));
  assert.ok(notes.some((n) => /two clubs/.test(n)));
});

test('suit patterns on a holding: double-suited, single-suited, a count', () => {
  const plo = (cardsStr, extra) => D({
    gameType: 'PLO', gameMode: 'cash', tableSize: 6, othersFolded: true, blinds: { sb: 2, bb: 5, ante: 0 },
    players: [{ position: 'BTN', isHero: true, startingStack: 500 }, { position: 'BB', startingStack: 500 }],
    streets: [{ name: 'Preflop', cards: [{ player: 0, cards: cardsStr, ...extra }], actions: [{ player: 0, action: 'raise', toAmount: 15 }, { player: 1, action: 'call' }] }],
  });
  const count = (s) => { const n = {}; for (const c of s.match(/../g)) n[c[1]] = (n[c[1]] || 0) + 1; return Object.values(n).sort().join(''); };
  assert.equal(count(normalizeDraft(plo('AAKQ', { suitPattern: 'ds' })).hand.streets[0].cards.hero), '22');
  assert.equal(count(normalizeDraft(plo('AA57', { suitPattern: 'ss' })).hand.streets[0].cards.hero), '112');
  const k = normalizeDraft(plo('KdJ97', { suitCounts: { d: 3 } })).hand.streets[0].cards.hero;
  assert.equal((k.match(/d/g) || []).length, 3, k);
  assert.ok(k.startsWith('Kd'));
  const two = normalizeDraft(plo('AAKK', { suitCounts: { d: 2, c: 2 } })).hand.streets[0].cards.hero;
  assert.deepEqual([(two.match(/d/g) || []).length, (two.match(/c/g) || []).length], [2, 2], two);
});

/* ── normalize.js: boards ─────────────────────────────────────────────────── */

test('a board read twice, and later streets written with the earlier cards', () => {
  let d = flopDraft('Jh3s2hJh3s2h');
  d.players[0].cards = undefined;
  let { hand, notes } = normalizeDraft(d);
  assert.deepEqual(hand.streets.slice(1).map((s) => s.cards.board), ['Jh3s2h', '', '']);
  assert.ok(notes.some((n) => /given twice/.test(n)));
  d = flopDraft('KsJc4h');
  d.streets.push({ name: 'Turn', board: 'KsJc4h7s', actions: [] }, { name: 'River', board: 'KsJc4h7sAd', actions: [] });
  ({ hand } = normalizeDraft(d));
  assert.deepEqual(hand.streets.slice(1).map((s) => s.cards.board), ['KsJc4h', '7s', 'Ad']);
});

test('a four-card flop ending in a deuce, in a transcript: three cards and a question', () => {
  const d = flopDraft('Q982');
  const text = normalizeDraft(d).hand;
  assert.deepEqual([text.streets[1].cards.board.length, text.streets[2].cards.board.length], [6, 2], 'typed: a runout');
  const { hand } = normalizeDraft(d, { source: 'speech' });
  assert.equal(hand.streets[1].cards.board.length, 6);
  assert.equal(hand.streets[2].cards.board, '');
  const q = hand.quickAdd.questions.find((x) => x.id === 'board-count:1');
  assert.ok(q, JSON.stringify(hand.quickAdd));
  assert.equal(q.options[1].value.op, 'answerQuestion');
  assert.match(q.options[1].value.sets[0].value, /^2[shdc]$/);
});

test('a card said two ways becomes a question with both readings', () => {
  const d = flopDraft('Kd8c3h');
  d.streets.push({ name: 'Turn', boardChoices: ['6', '7'], actions: [] });
  const { hand } = normalizeDraft(d);
  assert.equal(hand.streets[2].cards.board, '');
  const q = hand.quickAdd.questions.find((x) => x.id === 'choice:streets.2.cards.board');
  assert.deepEqual(q.options.map((o) => o.label[0]), ['6', '7']);
  assert.ok(q.blocking);
});

/* ── normalize.js: stakes, antes, pots, stacks ────────────────────────────── */

test('"6/12k" as written wins over 6 and 12,000', () => {
  const { hand, notes } = normalizeDraft(D({ ...flopDraft('Kd8c3h'), gameMode: 'mtt', blinds: { sb: 6, bb: 12000, ante: 12000, stakes: '6/12k' } }));
  assert.deepEqual([hand.blinds.sb, hand.blinds.bb], [6000, 12000]);
  assert.ok(notes.some((n) => /6\/12k/.test(n)));
});

const anteDraft = (pot) => D({
  gameType: 'NLH', gameMode: 'mtt', tableSize: 9, othersFolded: true,
  blinds: { sb: 20000, bb: 40000, ante: 5000 },
  players: [{ position: 'CO', isHero: true, startingStack: 2000000 }, { position: 'BB', startingStack: 2000000 }],
  streets: [
    { name: 'Preflop', actions: [{ player: 0, action: 'raise', toAmount: 100000 }, { player: 1, action: 'call' }] },
    { name: 'Flop', board: 'Kd8c3h', potBefore: pot, actions: [{ player: 1, action: 'check' }, { player: 0, action: 'check' }] },
  ],
});

test('an ante of unstated type below the big blind is asked; a stated pot settles it', () => {
  // Without a pot: kept as a big blind ante meanwhile, and marked to ask.
  let { hand } = normalizeDraft(anteDraft(null));
  assert.equal(hand.blinds.ante, 5000);
  assert.equal(hand.quickAdd.anteUnclear, 5000);
  // 100k + 100k + 20k folded SB + 9 × 5k = 265k: every player's.
  let notes;
  ({ hand, notes } = normalizeDraft(anteDraft(265000)));
  assert.equal(hand.blinds.ante, 45000);
  assert.ok(!hand.quickAdd || hand.quickAdd.anteUnclear == null);
  assert.ok(notes.some((n) => /posted by every player/.test(n)));
  // 225k: one big blind ante.
  ({ hand } = normalizeDraft(anteDraft(225000)));
  assert.equal(hand.blinds.ante, 5000);
  assert.ok(!hand.quickAdd || hand.quickAdd.anteUnclear == null);
  // An ante the size of the big blind is a big blind ante: nothing to ask.
  const bba = anteDraft(null); bba.blinds.ante = 40000;
  assert.ok(!normalizeDraft(bba).hand.quickAdd);
});

test('a pot stated before any action settles the ante too ("Pot: 95,000" at 20k/40k, ante 5,000, 7 handed)', () => {
  const d = anteDraft(null); d.tableSize = 7; d.streets[0].potBefore = 95000;
  const { hand } = normalizeDraft(d);
  assert.equal(hand.blinds.ante, 35000);
  assert.ok(!hand.quickAdd);
});

test('a free-text "everyone anted" answer makes the ante per player', () => {
  const { hand } = normalizeDraft(anteDraft(null));
  const out = normalizeHand(applyOps(hand, [{ op: 'set', path: 'blinds.anteType', value: 'per_player' }]).hand).hand;
  assert.equal(out.blinds.ante, 45000);
  assert.ok(!out.quickAdd);
});

test('a stated pot that the actions miss is asked about; rake is allowed for', () => {
  const d = anteDraft(400000); d.blinds.ante = 40000;
  let { hand } = normalizeDraft(d);
  assert.ok(hand.quickAdd.questions.some((q) => q.id === 'pot-mismatch:1'));
  d.streets[1].potBefore = 250000; // 260k computed: within 10%
  ({ hand } = normalizeDraft(d));
  assert.ok(!hand.quickAdd);
});

test('a two-way size ("b61") is settled by the next stated pot', () => {
  const d = D({
    gameType: 'NLH', gameMode: 'cash', tableSize: 6, othersFolded: true, blinds: { sb: 1, bb: 2, ante: 0 },
    players: [{ position: 'BTN', isHero: true, startingStack: 1000 }, { position: 'SB', startingStack: 1000 }],
    streets: [
      { name: 'Preflop', actions: [{ player: 0, action: 'raise', toAmount: 11 }, { player: 1, action: 'raise', toAmount: 42 }, { player: 0, action: 'call' }] },
      { name: 'Flop', board: 'Kd8c3h', potBefore: 86, actions: [{ player: 1, action: 'bet', sizeChoices: [{ potFraction: 0.61 }, { toAmount: 61 }] }, { player: 0, action: 'call' }] },
      { name: 'Turn', board: '2s', potBefore: 208, actions: [] },
    ],
  });
  const { hand, notes } = normalizeDraft(d);
  assert.deepEqual(acts(hand, 1).map((a) => a.slice(1)), [['bet', 61], ['call', 61]]);
  assert.ok(notes.some((n) => /meant 61 chips/.test(n)));
});

test('a stack said as "behind" is what went in plus what was left', () => {
  const d = D({
    gameType: 'NLH', gameMode: 'mtt', tableSize: 8, othersFolded: true, blinds: { sb: 4000, bb: 8000, ante: 8000 },
    players: [{ position: 'BTN', isHero: true, startingStack: 600000 }, { position: 'CO' }],
    streets: [{ name: 'Preflop', actions: [
      { player: 1, action: 'raise', toAmount: 18000 }, { player: 0, action: 'raise', toAmount: 45000 },
      { player: 1, action: 'raise', toAmount: 120000, behind: 200000, approx: true }] }],
  });
  const { hand } = normalizeDraft(d);
  const co = hand.players.findIndex((p) => p.position === 'CO');
  assert.equal(hand.players[co].startingStack, 320000);
});

test('limit stakes from the sizes when none are said', () => {
  const { hand, notes } = normalizeDraft(D({
    gameType: 'O8', gameMode: 'mtt', tableSize: 6, othersFolded: true, blinds: { sb: null, bb: null, ante: 0 },
    players: [{ position: 'CO', isHero: true, startingStack: 100000 }, { position: 'BB', startingStack: 100000 }],
    streets: [{ name: 'Preflop', actions: [{ player: 0, action: 'raise', toAmount: 8000 }, { player: 1, action: 'call' }] }],
  }));
  assert.deepEqual([hand.blinds.sb, hand.blinds.bb, hand.blinds.bigBet], [2000, 4000, 8000]);
  assert.ok(notes.some((n) => /No limits were said/.test(n)));
});

/* ── normalize.js: collective and implied actions ─────────────────────────── */

test('"UTG opens, whole table calls": one call per seat, in order', () => {
  const { hand } = normalizeDraft(D({
    gameType: 'NLH', gameMode: 'cash', tableSize: 6, blinds: { sb: 1, bb: 3, ante: 0 },
    players: [{ position: 'UTG' }, { position: 'BB', isHero: true, startingStack: 2000 }],
    streets: [
      { name: 'Preflop', cards: [{ player: 1, cards: '6h6d' }], actions: [{ player: 0, action: 'raise', toAmount: 15 }, { player: null, action: 'call', group: 'rest' }, { player: 1, action: 'call' }] },
      { name: 'Flop', board: '6c5d5h', actions: [{ player: null, action: 'check', group: 'rest' }] },
    ],
  }));
  assert.deepEqual(acts(hand, 0), [[0, 'raise', 15], [1, 'call', 15], [2, 'call', 15], [3, 'call', 15], [4, 'call', 14], [5, 'call', 12]]);
  assert.deepEqual(acts(hand, 1).map((a) => a.slice(0, 2)), [[4, 'check'], [5, 'check'], [0, 'check'], [1, 'check'], [2, 'check'], [3, 'check']]);
});

test('"4 callers" picks the seats that play on, then the earliest; the rest fold', () => {
  const { hand } = normalizeDraft(D({
    gameType: 'NLH', gameMode: 'cash', tableSize: 9, blinds: { sb: 1, bb: 2, ante: 0 },
    players: [{ position: 'UTG' }, { position: 'CO' }, { position: 'BB', isHero: true, startingStack: 300 }],
    streets: [
      { name: 'Preflop', actions: [{ player: 0, action: 'raise', toAmount: 10 }, { player: null, action: 'call', group: 'rest', count: 4 }, { player: 2, action: 'call' }] },
      { name: 'Flop', board: 'Kd8c3h', actions: [{ player: 2, action: 'check' }, { player: 0, action: 'check' }, { player: 1, action: 'bet', toAmount: 30 }] },
    ],
  }));
  const pre = acts(hand, 0);
  const callers = pre.filter((a) => a[1] === 'call').map((a) => hand.players[a[0]].position);
  assert.ok(callers.includes('CO'), callers.join(','));
  assert.equal(callers.length, 5); // four in the group, then the hero
  assert.ok(hand.quickAdd.questions.some((q) => q.id.startsWith('group-seats:0')));
});

test('"all others fold" after a 3-bet folds the limpers', () => {
  const { hand } = normalizeDraft(D({
    gameType: 'NLH', gameMode: 'cash', tableSize: 6, blinds: { sb: 2, bb: 5, ante: 0 },
    players: [{ position: 'UTG' }, { position: 'HJ' }, { position: 'BTN', isHero: true, startingStack: 500 }],
    streets: [{ name: 'Preflop', actions: [
      { player: 0, action: 'call' }, { player: 1, action: 'call' }, { player: 2, action: 'raise', toAmount: 40 },
      { player: null, action: 'fold', group: 'rest' }] }],
  }));
  const pre = acts(hand, 0);
  assert.deepEqual(pre.slice(-4).map((a) => [hand.players[a[0]].position, a[1]]), [['SB', 'fold'], ['BB', 'fold'], ['LJ', 'fold'], ['HJ', 'fold']]);
});

test('a group waits for the table size and is expanded when it is answered', () => {
  const { hand } = normalizeDraft(D({
    gameType: 'NLH', gameMode: 'cash', blinds: { sb: 1, bb: 3, ante: 0 },
    players: [{ position: 'UTG' }, { position: 'BB', isHero: true, startingStack: 300 }],
    streets: [{ name: 'Preflop', actions: [{ player: 0, action: 'raise', toAmount: 15 }, { player: null, action: 'call', group: 'rest' }, { player: 1, action: 'call' }] }],
  }));
  assert.deepEqual(hand.quickAdd.groups, [{ street: 0, at: 1, action: 'call' }]);
  const seated = normalizeHand(applyOps(hand, [{ op: 'set', path: 'tableSize', value: 6 }]).hand).hand;
  assert.equal(acts(seated, 0).filter((a) => a[1] === 'call').length, 5);
  assert.ok(!seated.quickAdd);
});

test('multiway: seats before the first player named with nothing bet checked', () => {
  const { hand, notes } = normalizeDraft(D({
    gameType: 'NLH', gameMode: 'cash', tableSize: 6, othersFolded: true, blinds: { sb: 1, bb: 2, ante: 0 },
    players: [{ position: 'CO', startingStack: 200 }, { position: 'BTN', isHero: true, startingStack: 200 }, { position: 'BB', startingStack: 200 }],
    streets: [
      { name: 'Preflop', actions: [{ player: 0, action: 'raise', toAmount: 6 }, { player: 1, action: 'call' }, { player: 2, action: 'call' }] },
      { name: 'Flop', board: 'Kd8c3h', actions: [{ player: 0, action: 'bet', toAmount: 10 }, { player: 1, action: 'call' }, { player: 2, action: 'fold' }] },
    ],
  }));
  assert.deepEqual(acts(hand, 1).map((a) => [hand.players[a[0]].position, a[1]]), [['BB', 'check'], ['CO', 'bet'], ['BTN', 'call'], ['BB', 'fold']]);
  assert.ok(notes.some((n) => /checked; that check is recorded/.test(n)));
});

test('heads-up: "he bets, I call" with the bettor in position gets the check first', () => {
  const { hand } = normalizeDraft(D({
    gameType: 'NLH', gameMode: 'cash', tableSize: 6, othersFolded: true, blinds: { sb: 1, bb: 2, ante: 0 },
    players: [{ position: 'BTN', startingStack: 200 }, { position: 'BB', isHero: true, startingStack: 200 }],
    streets: [
      { name: 'Preflop', actions: [{ player: 0, action: 'raise', toAmount: 6 }, { player: 1, action: 'call' }] },
      { name: 'Flop', board: 'Kd8c3h', actions: [{ player: 0, action: 'bet', toAmount: 5 }, { player: 1, action: 'call' }] },
    ],
  }));
  assert.deepEqual(acts(hand, 1).map((a) => [hand.players[a[0]].position, a[1], a[2]]), [['BB', 'check', 0], ['BTN', 'bet', 5], ['BB', 'call', 5]]);
});

test('an action said twice in a row is one', () => {
  const d = flopDraft('Kd8c3h');
  d.streets[1].actions = [{ player: 1, action: 'bet', toAmount: 50 }, { player: 1, action: 'bet', toAmount: 50 }, { player: 0, action: 'call' }];
  const { hand, notes } = normalizeDraft(d);
  assert.deepEqual(acts(hand, 1).map((a) => a[1]), ['bet', 'call']);
  assert.ok(notes.some((n) => /said twice/.test(n)));
});

/* ── normalize.js: seats and scope ────────────────────────────────────────── */

test('a pasted history: seat numbers and the button seat make the positions', () => {
  const { hand } = normalizeDraft(D({
    gameType: 'NLH', gameMode: 'cash', buttonSeat: 4, blinds: { sb: 0.01, bb: 0.02, ante: 0 },
    players: [1, 2, 3, 4, 5, 6].map((k) => ({ name: 'P' + k, seatNumber: k, startingStack: 2, isHero: k === 2 })),
    streets: [{ name: 'Preflop', actions: [] }],
  }));
  const at = Object.fromEntries(hand.players.map((p) => [p.name, p.position]));
  assert.deepEqual(at, { P1: 'LJ', P2: 'HJ', P3: 'CO', P4: 'BTN', P5: 'SB', P6: 'BB' });
  assert.equal(hand.players[hand.heroIdx].name, 'P2');
});

test('observer, not a hand, other hands and formats are carried for the client', () => {
  const base = flopDraft('Kd8c3h');
  base.players.forEach((p) => { p.isHero = false; });
  const { hand, notes } = normalizeDraft({ ...base, observer: true, otherHands: [{ summary: 'AK vs QQ preflop', index: 2 }], format: { bombPot: true }, variant: 'Courchevel' });
  assert.equal(hand.heroless, true);                 // owner decision C: stored hero-less
  assert.equal(hand.heroIdx, null);
  assert.ok(!hand.quickAdd.observer);
  assert.deepEqual(hand.quickAdd.otherHands, ['AK vs QQ preflop']);
  assert.deepEqual(hand.quickAdd.otherHandIndexes, [2]);
  assert.equal(hand.quickAdd.otherHandsBlocking, true);   // owner decision F: always ask which hand
  assert.equal(hand.quickAdd.unsupported.length, 2);      // the bomb pot, and Courchevel (no game of its own)
  assert.ok(!notes.some((n) => /No hero was identified/.test(n)));
  const nh = normalizeDraft({ ...base, recordable: false, whyNot: 'a rules question' }).hand;
  assert.equal(nh.quickAdd.notRecordable, 'a rules question');
  // They survive the server's own re-normalising (the /answer path).
  const again = normalizeHand(hand).hand;
  assert.deepEqual(again.quickAdd, hand.quickAdd);
  assert.equal(again.heroless, true);
});

/* ── prompt.js ────────────────────────────────────────────────────────────── */

test('the tool schema carries the new fields, and rock straddles', () => {
  const p = HAND_TOOL.input_schema.properties;
  for (const k of ['observer', 'recordable', 'whyNot', 'otherHands', 'format', 'variant', 'buttonSeat']) assert.ok(p[k], k);
  const st = p.streets.items.properties;
  for (const k of ['texture', 'suitCounts', 'potBefore', 'boardChoices']) assert.ok(st[k], k);
  const a = st.actions.items.properties;
  for (const k of ['group', 'count', 'behind', 'approx']) assert.ok(a[k], k);
  assert.ok(p.blinds.properties.straddles.items.properties.type.enum.includes('rock'));
  assert.ok(p.blinds.properties.stakes);
  for (const must of ['suitCounts', 'group "rest"', 'potBefore', 'observer', 'otherHands', 'behind']) assert.ok(PARSE_SYSTEM.includes(must), must);
});

test('the second worked example is valid tool input and normalises as described', () => {
  const m = /record_hand input \(second example\):\n([\s\S]*?)\n\(The callers/.exec(PARSE_SYSTEM);
  const { hand } = normalizeDraft(JSON.parse(m[1]));
  assert.equal(acts(hand, 0).filter((a) => a[1] === 'call').length, 8);
  assert.equal((hand.streets[1].cards.board.match(/c/g) || []).length, 2);
  assert.equal(hand.players[0].startingStack, 625);
  assert.ok(!hand.quickAdd);
});

test('a transcript gets its number words rewritten as digits by a pre-pass that lists them and spares rank words', () => {
  const r = buildParseRequest({ text: 'he bets twelve hundred with jack ten nine i call', source: 'speech', hints: {}, model: 'm' });
  const c = r.messages[0].content;
  assert.ok(c.includes('he bets 1200 with jack ten nine i call'), c);   // owner decision I: rewritten, rank words untouched
  assert.ok(c.includes('"twelve hundred" = 1200') && /rewritten as digits by code/.test(c));
  const t = buildParseRequest({ text: 'he bets twelve hundred', source: 'text', hints: {}, model: 'm' });
  assert.ok(!t.messages[0].content.includes('rewritten') && !t.messages[0].content.includes('= 1200'));
  const none = buildParseRequest({ text: 'jack ten nine on the flop', source: 'speech', hints: {}, model: 'm' });
  assert.ok(none.messages[0].content.includes('jack ten nine on the flop') && !/rewritten/.test(none.messages[0].content));
});

test('a holding pattern the given cards break is asked about on its card slot', () => {
  const d = flopDraft('Kd8c3h');
  d.streets[0].cards = [{ player: 0, cards: 'AhQs', suitPattern: 'suited' }];
  const { hand } = normalizeDraft(d);
  const q = hand.quickAdd.questions.find((x) => x.id.startsWith('texture-conflict:'));
  assert.equal(q.field, 'streets.0.cards.hero');
  assert.equal(hand.streets[0].cards.hero, 'AhQs');
});

/* ── review fixes (2026-10-14): number words in a row, spoken stakes, limit stakes ─ */

test('number words: two numbers said in a row are never joined into one', () => {
  const nw = (t) => S.numberWords(t).text;
  // Each of these was one wrong number before (204, 408, 1,503,000, 501,000, 3,000, 60,000, 102).
  assert.equal(nw('two hundred four hundred'), '200 400');
  assert.equal(nw('four hundred eight hundred'), '400 800');
  assert.equal(nw('fifteen hundred three thousand'), '1500 3000');
  assert.equal(nw('five hundred one thousand'), '500 1000');
  assert.equal(nw('one thousand two thousand'), '1000 2000');
  assert.equal(nw('twenty thousand forty thousand'), '20000 40000');
  assert.equal(nw('one hundred two hundred'), '100 200');
  // "fifty one hundred" is 5,100 or the stakes 50/100: not certain, so not rewritten.
  assert.equal(nw('fifty one hundred'), 'fifty one hundred');
  assert.equal(nw('ten twenty'), 'ten twenty');
  assert.equal(nw('fifteen thirty'), 'fifteen thirty');
  // One number stays one number.
  assert.equal(nw('two hundred fifty thousand'), '250000');
  assert.equal(nw('two thousand five hundred'), '2500');
  assert.equal(nw('two million five hundred thousand'), '2500000');
  assert.equal(nw('two and a half k'), '2500');
  assert.equal(nw('twenty six handed'), '20 six handed');
});

/* The spoken form of a chip count, the way a recogniser writes it (thousands as
   "thousand", never "k"), to test each corpus case's stakes. */
function spoken(n) {
  const U = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const T = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const below100 = (x) => (x < 20 ? U[x] : T[Math.floor(x / 10)] + (x % 10 ? ' ' + U[x % 10] : ''));
  const below1000 = (x) => (x >= 100 ? U[Math.floor(x / 100)] + ' hundred' + (x % 100 ? ' ' + below100(x % 100) : '') : below100(x));
  if (n >= 1000) return below1000(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? ' ' + below1000(n % 1000) : '');
  return below1000(n);
}

test('every speech case: its stakes said aloud give its blinds, or nothing', () => {
  const fs = require('node:fs'), path = require('node:path');
  const dir = path.join(__dirname, 'corpus');
  let checked = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    for (const c of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      const b = c.expect && c.expect.blinds;
      if (c.source !== 'speech' || !b || !Number.isInteger(b.sb) || !Number.isInteger(b.bb) || b.bb < b.sb) continue;
      const phrase = spoken(b.sb) + ' ' + spoken(b.bb);
      const allowed = new Set([b.sb, b.bb]);
      for (const cv of S.numberWords(phrase).conversions) assert.ok(allowed.has(cv.to), `${c.id}: "${phrase}" read as ${cv.to}`);
      const st = S.spokenStakes(phrase);
      assert.ok(st === null || (st.sb === b.sb && st.bb === b.bb && st.numbers.length === 2), `${c.id}: "${phrase}" as stakes ${st && st.numbers}`);
      checked++;
    }
  }
  assert.ok(checked >= 20, 'checked ' + checked);
});

test('spoken stakes: pairs of numbers, and what is not stakes', () => {
  const st = (t) => { const r = S.spokenStakes(t); return r && r.numbers; };
  assert.deepEqual(st('ten twenty'), [10, 20]);
  assert.deepEqual(st('fifteen thirty'), [15, 30]);
  assert.deepEqual(st('one two'), [1, 2]);
  assert.deepEqual(st('two five'), [2, 5]);
  assert.deepEqual(st('fifty one hundred'), [50, 100]);
  assert.deepEqual(st('five hundred one thousand'), [500, 1000]);
  assert.deepEqual(st('one thousand two thousand'), [1000, 2000]);
  assert.deepEqual(st('twenty thousand forty thousand'), [20000, 40000]);
  assert.deepEqual(st('the blinds are ten and twenty'), [10, 20]);
  assert.deepEqual(st('6/12k'), [6000, 12000]);
  assert.equal(st('two hundred'), null);          // one number is an amount, not stakes
  assert.equal(st('forty'), null);
  assert.equal(st('twenty ten'), null);           // not rising
  assert.equal(S.spokenAmount('ten twenty'), null);
  assert.equal(S.spokenAmount('fifteen thirty'), null);
  assert.equal(S.spokenAmount('twelve fifty'), null);
  assert.equal(S.spokenAmount('one fifty'), 150);
  assert.equal(S.spokenAmount('fifty one hundred'), 5100);
  assert.equal(S.spokenAmount('fifty one hundred', { strict: true }), null);
  assert.equal(S.spokenAmount('15 hundred'), 1500);
  assert.equal(S.spokenAmount('500 eff'), 500);
  assert.equal(S.spokenAmount('a buck fifty'), 1.5);
  assert.equal(S.spokenAmount('two and a half k'), 2500);
});

test('answering "what were the blinds?" aloud never stores a joined number', () => {
  const ask = (field, text, hand = {}) => fastAnswerOps(hand, { field }, text);
  const sbbb = (a, b) => [{ op: 'set', path: 'blinds.sb', value: a }, { op: 'set', path: 'blinds.bb', value: b }];
  assert.deepEqual(ask('blinds.bb', 'ten twenty'), sbbb(10, 20));
  assert.deepEqual(ask('blinds.bb', 'fifteen thirty'), sbbb(15, 30));
  assert.deepEqual(ask('blinds.bb', 'fifty one hundred'), sbbb(50, 100));
  assert.deepEqual(ask('blinds.bb', 'five hundred one thousand'), sbbb(500, 1000));
  assert.deepEqual(ask('blinds.bb', 'one thousand two thousand'), sbbb(1000, 2000));
  assert.deepEqual(ask('blinds.bb', '6/12k'), sbbb(6000, 12000));
  assert.deepEqual(ask('blinds.bb', 'twenty'), [{ op: 'set', path: 'blinds.bb', value: 20 }]);
  assert.deepEqual(ask('blinds.bb', '2000'), [{ op: 'set', path: 'blinds.bb', value: 2000 }]);
  // Never one stored number for two said; fixed-limit and three-number stakes go to the model.
  assert.equal(ask('blinds.ante', 'ten twenty'), null);
  assert.equal(ask('blinds.bb', 'four eight', { gameType: "Limit Hold'em" }), null);
  assert.equal(ask('blinds.bb', 'twenty forty forty'), null);
  assert.equal(ask('players.1.startingStack', 'one fifty')[0].value, 150);   // "one fifty" is still 150 for a stack
});

test('limit stakes in the stakes text name the bets, not the blinds', () => {
  const draft = (gameType, stakes) => D({
    gameType, gameMode: 'cash', tableSize: 3, blinds: { sb: null, bb: null, ante: 0, stakes },
    players: [{ position: 'BTN', isHero: true, startingStack: 500 }, { position: 'SB', startingStack: 500 }, { position: 'BB', startingStack: 500 }],
    streets: [],
  });
  const td = normalizeDraft(draft('2-7 Triple Draw', '1224'), { source: 'speech' }).hand.blinds;
  assert.deepEqual([td.sb, td.bb, td.bigBet], [6, 12, 24]);
  const lhe = normalizeDraft(draft("Limit Hold'em", '4/8')).hand.blinds;
  assert.deepEqual([lhe.sb, lhe.bb, lhe.bigBet], [2, 4, 8]);
  const stud = normalizeDraft(draft('Stud Hi', '10/20')).hand.blinds;
  assert.equal(stud.bb, 10); assert.equal(stud.bigBet, 20); assert.ok(stud.sb == null);
  // No-limit stakes are still the blinds.
  const nl = normalizeDraft(draft('NLH', '6/12k')).hand.blinds;
  assert.deepEqual([nl.sb, nl.bb], [6000, 12000]);
});

test('limit stakes from sizes: the first flop bet, not a raise that may be a 3-bet', () => {
  const draft = (preflop, flop) => D({
    gameType: "Limit Hold'em", gameMode: 'cash', tableSize: 2, blinds: { sb: null, bb: null, ante: 0 },
    players: [{ position: 'BTN', isHero: true, startingStack: 500 }, { position: 'BB', startingStack: 500 }],
    streets: [{ name: 'Preflop', actions: preflop }, { name: 'Flop', board: '7s8d2c', actions: flop }],
  });
  const r = normalizeDraft(draft(
    [{ player: 1, action: 'raise', toAmount: 12 }, { player: 0, action: 'call' }],
    [{ player: 1, action: 'bet', toAmount: 4 }, { player: 0, action: 'call' }]));
  assert.deepEqual([r.hand.blinds.sb, r.hand.blinds.bb, r.hand.blinds.bigBet], [2, 4, 8]);
  const g = normalizeDraft(draft([{ player: 1, action: 'raise', toAmount: 12 }, { player: 0, action: 'call' }], []));
  assert.equal(g.hand.blinds.bb, 6);
  assert.ok(g.notes.some((n) => /guess/.test(n)), g.notes.join(' | '));
});

test('a repeated card is not a hand: the fast answer path refuses it', () => {
  assert.equal(S.spokenCards('ace king with the ace of spades'), null);
  assert.equal(fastAnswerOps({}, { field: 'streets.0.cards.hero' }, 'ace king with the ace of spades'), null);
  assert.equal(fastAnswerOps({}, { field: 'streets.0.cards.hero' }, 'AhAh'), null);
  assert.deepEqual(fastAnswerOps({}, { field: 'streets.1.cards.board' }, 'Jh3s2h Jh3s2h'), [{ op: 'set', path: 'streets.1.cards.board', value: 'Jh3s2h' }]);
});

test('Omaha pattern letters are a pattern, not a diamond and a spade', () => {
  for (const [s, k] of [['AAKKds', 'ds'], ['AJT9ss', 'ss'], ['KQJT ds', 'ds'], ['QJT8SS', 'ss']]) {
    const r = parseCards(s);
    assert.equal(r.suitPattern, k, s);
    assert.ok(r.cards.length === 4 && r.cards.every((c) => c[1] === 'x'), s);
  }
  assert.equal(cards('KQJ2dd'), 'KdQdJx2x');      // two diamonds: unchanged
  const d = D({
    gameType: 'PLO', gameMode: 'cash', tableSize: 2, blinds: { sb: 1, bb: 2, ante: 0 },
    players: [{ position: 'BTN', isHero: true, startingStack: 200 }, { position: 'BB', startingStack: 200 }],
    streets: [{ name: 'Preflop', cards: [{ player: 0, cards: 'AAKKds' }], actions: [{ player: 0, action: 'raise', toAmount: 6 }, { player: 1, action: 'call' }] }],
  });
  const hero = normalizeDraft(d).hand.streets[0].cards.hero;
  const bySuit = {};
  for (const c of hero.match(/../g)) bySuit[c[1]] = (bySuit[c[1]] || 0) + 1;
  assert.deepEqual(Object.values(bySuit).sort(), [2, 2], hero);   // double suited
});

test('two cards of unknown suit that look the same are not one board read twice', () => {
  const t = D({
    gameType: 'NLH', gameMode: 'cash', tableSize: 2, blinds: { sb: 1, bb: 2, ante: 0 },
    players: [{ position: 'BTN', isHero: true, startingStack: 200 }, { position: 'BB', startingStack: 200 }],
    streets: [{ name: 'Preflop', cards: [{ player: 0, cards: 'AhQs' }], actions: [{ player: 0, action: 'raise', toAmount: 6 }, { player: 1, action: 'call' }] },
      { name: 'Flop', board: 'KKx', actions: [{ player: 1, action: 'check' }, { player: 0, action: 'check' }] }],
  });
  assert.equal(normalizeDraft(t).hand.streets[1].cards.board.length, 4);   // two kings, kept
});

/* ── the owner's decisions (lib/quick-add/decisions.js) ───────────────────── */

test("the owner's decisions: each answer, and each switch that exists", () => {
  const DEC = require('../../lib/quick-add/decisions');
  const was = JSON.parse(JSON.stringify(DEC));
  assert.deepEqual(was, {
    UTG_WITH_STRADDLE: 'next-seat', HEDGED_VALUES: 'note', OBSERVER_HANDS: 'heroless', UNSUPPORTED_FORMATS: 'approximate',
    OWN_GAMES: ['PLO5', 'PLO6', 'PLO6 8/b', 'Short Deck', 'NLO8'], VARIANT_GAMES: { Pineapple: 'NLH', Courchevel: 'PLO' },
    SEVERAL_HANDS: 'ask', PER_POT_WINNERS: true, HAND_HISTORY_FAST_PATH: true, NUMBER_WORDS: 'rewrite',
  });
  // E: every own game is a game of its own in G.GAMES, never collapsed.
  for (const g of was.OWN_GAMES) assert.ok(G.GAMES[g], g + ' is a game');
  const draft = (extra = {}) => D({
    gameMode: 'cash', tableSize: 2, blinds: { sb: 1, bb: 2, ante: 0 },
    players: [{ position: 'BTN', isHero: true, startingStack: 200 }, { position: 'BB', startingStack: 200 }],
    streets: [{ name: 'Preflop', actions: [{ player: 0, action: 'raise', toAmount: 6, approx: true }, { player: 1, action: 'call' }] }],
    ...extra,
  });
  const run = (extra) => normalizeDraft(draft(extra));
  try {
    // E: a named own game stays itself; a variant with no game of its own takes the nearest.
    assert.equal(run({ variant: 'PLO5' }).hand.gameType, 'PLO5');
    assert.equal(run({ gameType: 'PLO6 8/b' }).hand.gameType, 'PLO6 8/b');
    assert.equal(run({ gameType: 'Big Easy' }).hand.gameType, 'PLO6 8/b');
    assert.ok(!run({ variant: 'PLO5' }).hand.quickAdd, 'PLO5 is no longer an unsupported variant');
    assert.equal(run({ variant: 'Courchevel' }).hand.gameType, 'PLO');
    assert.ok(run({ variant: 'Courchevel' }).hand.quickAdd.unsupported);
    DEC.VARIANT_GAMES = {};
    assert.equal(run({ variant: 'Courchevel' }).hand.gameType, null);
    DEC.VARIANT_GAMES = was.VARIANT_GAMES;
    // B: an estimate is a note; with 'ask' it is also a question.
    assert.ok(!run({ gameType: 'NLH' }).hand.quickAdd, 'note only');
    DEC.HEDGED_VALUES = 'ask';
    assert.ok(run({ gameType: 'NLH' }).hand.quickAdd.questions.some((q) => /^approx:/.test(q.id)));
    DEC.HEDGED_VALUES = was.HEDGED_VALUES;
    // C: an observer hand is stored hero-less; 'refuse' makes it not recordable.
    const obs = { gameType: 'NLH', observer: true, players: [{ position: 'BTN', startingStack: 200 }, { position: 'BB', startingStack: 200 }] };
    assert.equal(run(obs).hand.heroless, true);
    assert.equal(run(obs).hand.heroIdx, null);
    DEC.OBSERVER_HANDS = 'refuse';
    assert.ok(run(obs).hand.quickAdd.notRecordable && !run(obs).hand.heroless);
    DEC.OBSERVER_HANDS = was.OBSERVER_HANDS;
    // D (deferred): a bomb pot is approximated with a note; 'refuse' would make it not recordable.
    const bomb = { gameType: 'NLH', format: { bombPot: true } };
    assert.ok(run(bomb).hand.quickAdd.unsupported);
    DEC.UNSUPPORTED_FORMATS = 'refuse';
    assert.ok(run(bomb).hand.quickAdd.notRecordable && !run(bomb).hand.quickAdd.unsupported);
    DEC.UNSUPPORTED_FORMATS = was.UNSUPPORTED_FORMATS;
    // F: always ask which hand; the other settings make the gap a note.
    const many = { gameType: 'NLH', otherHands: [{ summary: 'a second hand' }] };
    assert.equal(run(many).hand.quickAdd.otherHandsBlocking, true);
    DEC.SEVERAL_HANDS = 'most-detailed';
    assert.ok(run(many).hand.quickAdd.otherHands && !run(many).hand.quickAdd.otherHandsBlocking);
    DEC.SEVERAL_HANDS = was.SEVERAL_HANDS;
    // G: a winner per pot beside the main pot's; off, only the winners.
    const pots = { gameType: 'NLH', result: { winners: [{ playerIdx: 0 }], pots: [{ name: 'main', winners: [{ playerIdx: 0 }] }, { name: 'side 1', winners: [{ playerIdx: 1 }] }] } };
    assert.deepEqual(run(pots).hand.result.pots.map((p) => [p.name, p.winners.map((w) => w.playerIdx)]), [['main', [0]], ['side 1', [1]]]);
    assert.deepEqual(run(pots).hand.result.winners, [{ playerIdx: 0, split: false }]);
    DEC.PER_POT_WINNERS = false;
    assert.ok(!run(pots).hand.result.pots);
    DEC.PER_POT_WINNERS = was.PER_POT_WINNERS;
  } finally {
    Object.assign(DEC, was);
  }
  // A, E and I shape the prompt and the request (read when prompt.js loads): load it fresh.
  const loadPrompt = () => { delete require.cache[require.resolve('../../lib/quick-add/prompt')]; return require('../../lib/quick-add/prompt'); };
  try {
    const p0 = loadPrompt();
    assert.match(p0.PARSE_SYSTEM, /the seat AFTER the straddler/);        // A: the opener is the seat after the straddler
    assert.match(p0.PARSE_SYSTEM, /PLO6 8\/b six-card PLO hi-lo/);        // E / E2
    assert.doesNotMatch(p0.PARSE_SYSTEM, /Big Easy six-card/);
    assert.match(p0.PARSE_SYSTEM, /six hole cards → PLO6, or PLO6 8\/b when hi-lo is indicated/);
    DEC.UTG_WITH_STRADDLE = 'both-act';
    DEC.NUMBER_WORDS = 'aid';
    DEC.VARIANT_GAMES = { Pineapple: 'PLH' };
    const p = loadPrompt();
    assert.match(p.PARSE_SYSTEM, /the straddler is UTG and that opener UTG\+1/);
    assert.doesNotMatch(p.PARSE_SYSTEM, /the seat AFTER the straddler/);
    assert.match(JSON.stringify(p.HAND_TOOL), /nearest game \(Pineapple → PLH\)/);
    const r = p.buildParseRequest({ text: 'he bets twelve hundred i call', source: 'speech', hints: {}, model: 'm' });
    assert.match(r.messages[0].content, /he bets twelve hundred i call/);
    assert.match(r.messages[0].content, /worked out by code/);
    DEC.UTG_WITH_STRADDLE = 'ask';
    assert.match(loadPrompt().PARSE_SYSTEM, /never UTG\+1 on your own/);
  } finally {
    Object.assign(DEC, was);
    loadPrompt();
  }
});

test('a UTG straddle: a second player called UTG is the seat after the straddler', () => {
  const d = D({
    gameType: 'NLH', gameMode: 'cash', tableSize: 6, blinds: { sb: 1, bb: 2, ante: 0, straddles: [{ type: 'utg', player: 0 }] },
    players: [{ position: 'UTG', startingStack: 400 }, { position: 'UTG', startingStack: 400 }, { position: 'BTN', isHero: true, startingStack: 400 }],
    streets: [{ name: 'Preflop', actions: [{ player: 1, action: 'raise', toAmount: 12 }, { player: 2, action: 'call' }, { player: 0, action: 'fold' }] }],
  });
  const { hand, notes } = normalizeDraft(d);
  // Six-handed the app calls the first two seats LJ and HJ: the straddler first, the opener after.
  assert.deepEqual(hand.players.map((p) => p.position), ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
  assert.ok(notes.some((n) => /UTG straddle on/.test(n)), notes.join(' | '));
  // With no straddle on, two players at one seat are left for the rules to ask about.
  const plain = normalizeDraft({ ...d, blinds: { sb: 1, bb: 2, ante: 0 } });
  assert.ok(!plain.notes.some((n) => /UTG straddle on/.test(n)));
});

test('owner decision G: per-pot winners survive the /answer round trip and a result answer', () => {
  const pots = [{ name: 'main', winners: [{ playerIdx: 0, split: false }] }, { name: 'side 1', winners: [{ playerIdx: 1, split: false }] }];
  const base = normalizeDraft(flopDraft('Kd8c3h', {}), {}).hand;
  const withPots = { ...base, result: { winners: pots[0].winners, pots } };
  assert.deepEqual(normalizeHand(withPots).hand.result.pots.length, 2);
  const out = applyOps(withPots, [{ op: 'set', path: 'result', value: { winners: [{ playerIdx: 1 }], pots } }]).hand;
  assert.equal(out.result.pots.length, 2);
  assert.deepEqual(out.result.winners, [{ playerIdx: 1, split: false }]);
});

test('owner decision C: a hero-less hand keeps every known card, with seat 0 as the first slot', () => {
  const { hand } = normalizeDraft(D({
    gameType: 'NLH', gameMode: 'cash', tableSize: 2, observer: true, blinds: { sb: 1, bb: 2, ante: 0 },
    players: [{ position: 'BTN', startingStack: 200 }, { position: 'BB', startingStack: 200 }],
    streets: [{ name: 'Preflop', cards: [{ player: 0, cards: 'JhTh' }, { player: 1, cards: 'AsKd' }], actions: [{ player: 0, action: 'raise', toAmount: 6 }, { player: 1, action: 'call' }] }],
  }));
  assert.equal(hand.heroless, true);
  assert.equal(hand.streets[0].cards.hero, 'JhTh');
  assert.deepEqual(hand.streets[0].cards.opponents, ['AsKd']);
  // The answer path can set it too ("I wasn't in this hand").
  const out = applyOps({ ...hand, heroless: undefined, heroIdx: 0 }, [{ op: 'set', path: 'heroless', value: true }]).hand;
  assert.equal(out.heroless, true);
  assert.equal(out.heroIdx, null);
});

test('PLO5, PLO6, PLO6 8/b, NLO8 and Short Deck: recognised, own names, own card counts', () => {
  const c = G.canonicalGameName;
  for (const [said, game] of [['PLO5', 'PLO5'], ['5 card PLO', 'PLO5'], ['plo6', 'PLO6'], ['PLO6 hi-lo', 'PLO6 8/b'], ['PLO6 8/b', 'PLO6 8/b'], ['Big Easy', 'PLO6 8/b'],
    ['NLO8', 'NLO8'], ['no limit omaha hi-lo', 'NLO8'], ['short deck', 'Short Deck'], ['6+ hold\'em', 'Short Deck'], ['Big O', 'Big O']]) assert.equal(c(said), game, said);
  assert.deepEqual([G.GAMES.PLO5.cards, G.GAMES.PLO6.cards, G.GAMES['PLO6 8/b'].cards, G.GAMES.NLO8.cards, G.GAMES['Short Deck'].cards], [5, 6, 6, 4, 2]);
  assert.equal(G.GAMES.NLO8.betting, 'nl');
  // A six-card hand told as a drafted game keeps its own name through the normaliser.
  const six = normalizeDraft(D({
    gameType: 'PLO6', gameMode: 'cash', tableSize: 2, blinds: { sb: 1, bb: 2, ante: 0 },
    players: [{ position: 'BTN', isHero: true, startingStack: 200 }, { position: 'BB', startingStack: 200 }],
    streets: [{ name: 'Preflop', cards: [{ player: 0, cards: 'AhKd2c3s9hTd' }], actions: [{ player: 0, action: 'raise', toAmount: 6 }, { player: 1, action: 'call' }] }],
  })).hand;
  assert.equal(six.gameType, 'PLO6');
  assert.equal(six.streets[0].cards.hero, 'AhKd2c3s9hTd');
});
