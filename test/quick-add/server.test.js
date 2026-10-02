// Quick-add part B: the server half. Run: node test/quick-add/server.test.js
// No API key needed or used — every Anthropic call goes to a stub client.
'use strict';
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const express = require('express');
const jwt = require('jsonwebtoken');

const QA = require('../../lib/quick-add');
const G = require('../../lib/quick-add/games');
const { parseCards, parseAmount } = require('../../lib/quick-add/cards');
const { buildParseRequest, buildAnswerRequest, HAND_TOOL, ANSWER_TOOL, PARSE_SYSTEM, SPEECH_ADDENDUM, TEXT_ADDENDUM } = require('../../lib/quick-add/prompt');
const { normalizeDraft, normalizeHand } = require('../../lib/quick-add/normalize');
const { applyOps, fastAnswerOps } = require('../../lib/quick-add/patch');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = assert.deepStrictEqual;

/* ── Stubs ─────────────────────────────────────────────────────────────────── */

function stubClient(replies) {
  const calls = [];
  const queue = Array.isArray(replies) ? replies.slice() : [replies];
  return {
    calls,
    messages: {
      async create(req) {
        calls.push(req);
        const next = queue.length > 1 ? queue.shift() : queue[0];
        if (next instanceof Error) throw next;
        return typeof next === 'function' ? next(req) : next;
      },
    },
  };
}
const toolReply = (name, input, extra = {}) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'stub', stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id: 'toolu_1', name, input }],
  usage: { input_tokens: 4000, output_tokens: 600, cache_read_input_tokens: 3500 },
  ...extra,
});
const apiError = (status, message) => Object.assign(new Error(message), { status });

/* The prompt's own worked example, as the model would send it. */
const EXAMPLE_DRAFT = () => ({
  gameType: 'NLH', gameMode: 'cash', currency: null, title: '1/3 – AQ vs KQ', tableSize: 9, othersFolded: true,
  blinds: { sb: 1, bb: 3, ante: 0 },
  players: [{ position: 'UTG', isHero: false }, { position: 'BTN', isHero: true }, { position: 'BB', isHero: false }],
  streets: [
    { name: 'Preflop', cards: [{ player: 1, cards: 'AhQh' }, { player: 0, cards: 'KxQx' }], actions: [
      { player: 0, action: 'call' }, { player: 1, action: 'raise', toAmount: 15 }, { player: 2, action: 'call' }, { player: 0, action: 'call' }] },
    { name: 'Flop', board: 'Qs7d2c', actions: [
      { player: 2, action: 'check' }, { player: 0, action: 'check' }, { player: 1, action: 'bet', toAmount: 25 },
      { player: 2, action: 'fold' }, { player: 0, action: 'call' }] },
    { name: 'Turn', board: '4h', actions: [{ player: 0, action: 'check' }, { player: 1, action: 'check' }] },
    { name: 'River', board: 'Ks', actions: [{ player: 0, action: 'bet', toAmount: 60 }, { player: 1, action: 'call' }] },
  ],
  result: { winners: [{ playerIdx: 0, split: false }] },
  notes: ["UTG's KQ was offsuit; its suits weren't said."],
});
const acts = (hand, si) => hand.streets[si].actions.map((a) => [a.player, a.action, a.amount]);

/* ── The replayer's own tables, imported to check the server's copies ─────── */

let VITE = null;
async function loadVite() {
  if (VITE) return VITE;
  // utils.js reads localStorage at import time; give it an empty one.
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const base = path.join(__dirname, '..', '..', 'vite-app', 'src', 'utils');
  const utils = await import(pathToFileURL(path.join(base, 'utils.js')).href);
  const sh = await import(pathToFileURL(path.join(base, 'hand-shorthand.js')).href);
  VITE = { HAND_CONFIG: utils.HAND_CONFIG, encodeHand: sh.encodeHand, decodeHand: sh.decodeHand, GAME_CODES: sh.GAME_CODES };
  return VITE;
}

test('game table matches the replayer\'s HAND_CONFIG', async () => {
  const { HAND_CONFIG } = await loadVite();
  for (const [name, g] of Object.entries(G.GAMES)) {
    const cfg = HAND_CONFIG[name];
    assert.ok(cfg, `${name} is in HAND_CONFIG`);
    eq(g.cards, cfg.heroCards, `${name} card count`);
    eq(g.betting, cfg.betting, `${name} betting`);
    eq(g.category === 'stud', !!cfg.isStud, `${name} stud`);
    eq(g.category === 'community', !!cfg.hasBoard, `${name} board`);
  }
  // Everything the replayer plays is here, except OFC (no betting, its own shape).
  const missing = Object.keys(HAND_CONFIG).filter((k) => !G.GAMES[k] && !/^OFC/.test(k));
  eq(missing, []);
});

test('street names and seat labels match the replayer (via decodeHand)', async () => {
  const { decodeHand, GAME_CODES } = await loadVite();
  for (const name of G.GAME_NAMES) {
    const code = GAME_CODES[name];
    assert.ok(code, `${name} has a link code`);
    const h = decodeHand(code + '60.100-200.-.-.');
    eq(h.streets.map((s) => s.name), G.gameInfo(name).streets, `${name} streets`);
  }
  for (let n = 2; n <= 10; n++) {
    const h = decodeHand('N' + (n === 10 ? 'T' : n) + '0.1-2.-.-.');
    eq(h.players.map((p) => p.position), G.positionLabels(n), `${n}-handed labels`);
  }
  eq(decodeHand('SH40.1-2.-.-.').players.map((p) => p.position), G.studLabels(4));
});

/* ── Values ────────────────────────────────────────────────────────────────── */

test('card notation: every form players and the replayer use', () => {
  const c = (s) => { const r = parseCards(s); return r && r.cards.join(''); };
  eq(c('AhKs'), 'AhKs');
  eq(c('ah ks'), 'AhKs');
  eq(c('Ah, Ks'), 'AhKs');
  eq(c('AKhs'), 'AhKs'); // the replayer's grouped placeholder form
  eq(c('10h 9h'), 'Th9h');
  eq(c('A♠K♥'), 'AsKh');
  eq(c('Qh7s2c'), 'Qh7s2c');
  eq(c('AKs'), 'AxKx');
  eq(parseCards('AKs').suitedness, 's');
  eq(c('99'), '9x9x');
  eq(c('Ax'), 'Ax');
  eq(c(''), '');
  eq(parseCards('the nuts'), null);
  eq(parseCards('Ahh'), null);
  eq(parseCards('xx'), null); // a rankless card cannot be stored
  eq(parseCards('ZzQq'), null);
});

test('amounts: chips, money and shorthand', () => {
  eq(parseAmount(1200), 1200);
  eq(parseAmount('1,200'), 1200);
  eq(parseAmount('1.2k'), 1200);
  eq(parseAmount('$1,100'), 1100);
  eq(parseAmount('2k'), 2000);
  eq(parseAmount('1.5m'), 1500000);
  eq(parseAmount('€500'), 500);
  eq(parseAmount('0.5'), 0.5);
  eq(parseAmount(-5), null);
  eq(parseAmount('lots'), null);
  eq(parseAmount(NaN), null);
  eq(parseAmount({}), null);
});

test('positions: vernacular → seat index at every table size', () => {
  const at = (pos, n) => G.roleIndex(G.canonicalPosition(pos), n);
  eq(at('under the gun', 9), 0);
  eq(at('UTG+1', 9), 1);       // the app LABELS seat 0 "UTG+1" nine-handed; the player means seat 1
  eq(at('hijack', 9), 4);
  eq(at('cutoff', 9), 5);
  eq(at('button', 9), 6);
  eq(at('sb', 9), 7);
  eq(at('Big Blind', 9), 8);
  eq(at('UTG', 6), 0);         // six-max UTG is the seat the app labels LJ
  eq(at('MP', 6), 1);          // and MP is HJ
  eq(G.positionLabels(6)[at('MP', 6)], 'HJ');
  eq(at('CO', 6), 2);
  eq(at('BTN', 2), 0);
  eq(at('SB', 2), 0);
  eq(at('BB', 2), 1);
  eq(at('BTN', 3), 0);
  eq(at('UTG+3', 6), null);    // there is no such seat six-handed
  eq(at('LJ', 5), null);
  eq(at('early position', 9), null);
  eq(G.canonicalPosition('Seat 3'), 'Seat 3');
});

test('game names: the replayer\'s, and the loose ones', () => {
  eq(G.canonicalGameName('NLH'), 'NLH');
  eq(G.canonicalGameName('no limit holdem'), 'NLH');
  eq(G.canonicalGameName('Omaha'), 'PLO');
  eq(G.canonicalGameName('PLO Hi-Lo'), 'PLO8');
  eq(G.canonicalGameName('Omaha 8'), 'O8');
  eq(G.canonicalGameName('2-7 triple draw'), '2-7 TD');
  eq(G.canonicalGameName('stud'), 'Stud Hi');
  eq(G.canonicalGameName('Stud Hi-Lo'), 'Stud Hi-Lo');
  eq(G.canonicalGameName('stud8'), 'Stud 8');
  eq(G.canonicalGameName('badugi'), 'Badugi');
  eq(G.canonicalGameName('OFC'), null);
  eq(G.canonicalGameName('Short Deck'), null);
});

/* ── Draft → hand ──────────────────────────────────────────────────────────── */

test('the prompt example: seats, slots, implicit folds and chips added', () => {
  const { hand, notes } = normalizeDraft(EXAMPLE_DRAFT());
  eq(hand.players.length, 9);
  eq(hand.players.map((p) => p.position), G.positionLabels(9));
  eq(hand.heroIdx, 6);
  eq(hand.players[6].name, 'Hero');
  eq(hand.streets[0].cards.hero, 'AhQh');
  eq(hand.streets[0].cards.opponents.length, 8);
  eq(hand.streets[0].cards.opponents[0], 'KdQc'); // KQ with no suits: filled in, offsuit
  eq(acts(hand, 0), [[0, 'call', 3], [1, 'fold', 0], [2, 'fold', 0], [3, 'fold', 0], [4, 'fold', 0], [5, 'fold', 0],
    [6, 'raise', 15], [7, 'fold', 0], [8, 'call', 12], [0, 'call', 12]]);
  eq(acts(hand, 1), [[8, 'check', 0], [0, 'check', 0], [6, 'bet', 25], [8, 'fold', 0], [0, 'call', 25]]);
  eq(hand.streets[3].cards.board, 'Ks');
  eq(hand.result, { winners: [{ playerIdx: 0, split: false }] });
  eq(hand.players.every((p) => p.startingStack === null), true); // never invented
  assert.ok(!('quickAdd' in hand), 'a fully seated hand carries no quick-add state');
  assert.ok(notes.some((n) => /6 players not mentioned/.test(n)));
});

test('heads-up shorthand ("x, b 4k, c") alternates; showdown cards move to the hole cards', () => {
  // 2026-10-01: the model gave the SB the flop check AND the bet, and filed the opponent's
  // shown AhKd on the river, where it was dropped.
  const d = {
    gameType: 'NLH', gameMode: 'mtt', tableSize: 6, othersFolded: true,
    blinds: { sb: 300, bb: 600, ante: 600 },
    players: [{ position: 'BTN', isHero: true, startingStack: 50000 }, { position: 'SB', startingStack: 50000 }, { position: 'BB' }],
    streets: [
      { name: 'Preflop', cards: [{ player: 0, cards: 'AdKc' }], actions: [{ player: 0, action: 'raise', toAmount: 1500 },
        { player: 1, action: 'raise', toAmount: 4000 }, { player: 2, action: 'fold' }, { player: 0, action: 'call' }] },
      { name: 'Flop', board: 'QdJd3d', actions: [{ player: 1, action: 'check' }, { player: 1, action: 'bet', toAmount: 4000 }, { player: 0, action: 'call' }] },
      { name: 'Turn', board: 'Tc', actions: [{ player: 1, action: 'check' }, { player: 0, action: 'bet', toAmount: 12000 },
        { player: 1, action: 'all-in', toAmount: 42000 }, { player: 0, action: 'call' }] },
      { name: 'River', board: '2d', cards: [{ player: 1, cards: 'AhKd' }], actions: [] },
    ],
    notes: [],
  };
  const { hand, notes } = normalizeDraft(d);
  eq(acts(hand, 1), [[4, 'check', 0], [3, 'bet', 4000], [4, 'call', 4000]]);
  eq(acts(hand, 2), [[4, 'check', 0], [3, 'bet', 12000], [4, 'all-in', 42000], [3, 'call', 30000]]); // already in turn: untouched
  eq(hand.streets[0].cards.opponents[3], 'AhKd');
  assert.ok(notes.some((n) => /Flop actions were put in turn order/.test(n)));
  assert.ok(!notes.some((n) => /Turn actions/.test(n)));
  assert.ok(!notes.some((n) => /were left out/.test(n)));
});

test('ranks without suits get real suits that fit the story (an x suit draws face down)', () => {
  // 2026-10-02: "AKo" and "river 6" replayed as card backs.
  const d = {
    gameType: 'NLH', gameMode: 'mtt', tableSize: 6, othersFolded: true, blinds: { sb: 300, bb: 600, ante: 600 },
    players: [{ position: 'CO', startingStack: 90000 }, { position: 'BB', isHero: true, startingStack: 90000 }],
    streets: [
      { name: 'Preflop', cards: [{ player: 1, cards: 'AKo' }, { player: 0, cards: '5c3c' }],
        actions: [{ player: 0, action: 'raise', toAmountBB: 4 }, { player: 1, action: 'call' }] },
      { name: 'Flop', board: '842cxx', actions: [{ player: 1, action: 'check' }, { player: 0, action: 'check' }] },
      { name: 'Turn', board: '7c', actions: [{ player: 1, action: 'check' }, { player: 0, action: 'check' }] },
      { name: 'River', board: '6', actions: [] },
    ],
    notes: [],
  };
  const { hand, notes } = normalizeDraft(d);
  const board = hand.streets.map((s) => s.cards.board).join('');
  assert.ok(!/x/.test(board + hand.streets[0].cards.hero), board + ' ' + hand.streets[0].cards.hero);
  eq(board.slice(0, 2), '8c');
  // Only the two clubs the player named: the filled-in cards add no flush draw.
  eq((board.match(/c/g) || []).length, 2);
  const [a, k] = [hand.streets[0].cards.hero.slice(0, 2), hand.streets[0].cards.hero.slice(2)];
  eq([a[0], k[0]], ['A', 'K']);
  assert.ok(a[1] !== k[1], 'AKo is offsuit');
  const cards = (board + hand.streets[0].cards.hero + '5c3c').match(/../g);
  eq(new Set(cards).size, cards.length); // no duplicates
  assert.ok(notes.some((n) => /Suits that were not given were filled in/.test(n) && /river 6/.test(n)));
  // "AKs" stays suited.
  d.streets[0].cards[0].cards = 'AKs';
  const s = normalizeDraft(d).hand.streets[0].cards.hero;
  eq(s[1], s[3]);
});

test('an ambiguous size ("b40") keeps both readings and no single size', () => {
  const d = {
    gameType: 'NLH', gameMode: 'mtt', tableSize: 6, othersFolded: true, blinds: { sb: 300, bb: 600, ante: 600 },
    players: [{ position: 'CO', startingStack: 90000 }, { position: 'BB', isHero: true, startingStack: 90000 }],
    streets: [
      { name: 'Preflop', actions: [{ player: 0, action: 'raise', toAmountBB: 4 }, { player: 1, action: 'call' }] },
      { name: 'Flop', board: 'Qh7s2c', actions: [{ player: 1, action: 'bet', potFraction: 0.4, sizeChoices: [{ potFraction: 0.4 }, { toAmount: 40000 }] }, { player: 0, action: 'call' }] },
    ],
    notes: [],
  };
  const a = normalizeDraft(d).hand.streets[1].actions[0];
  eq(a.amount, null);
  eq(a.sizeChoices, [{ potFraction: 0.4 }, { toAmount: 40000 }]);
  assert.ok(!('potFraction' in a), 'the single reading is dropped');
  // One reading is just a size.
  d.streets[1].actions[0] = { player: 1, action: 'bet', sizeChoices: [{ toAmount: 12000 }] };
  eq(normalizeDraft(d).hand.streets[1].actions[0].sizeChoices, undefined);
});

test('the output is a replayer hand: it encodes and decodes through the share link', async () => {
  const { encodeHand, decodeHand } = await loadVite();
  const d = EXAMPLE_DRAFT();
  d.players.forEach((p) => { p.startingStack = 300; });
  const { hand } = normalizeDraft(d);
  hand.players.forEach((p) => { if (p.startingStack == null) p.startingStack = 300; });
  const back = decodeHand(encodeHand(hand));
  eq(back.heroIdx, hand.heroIdx);
  eq(back.players.map((p) => p.position), hand.players.map((p) => p.position));
  eq(back.streets.map((s) => s.actions), hand.streets.map((s) => s.actions));
  eq(back.streets.map((s) => s.cards.board), hand.streets.map((s) => s.cards.board));
  eq(back.streets[0].cards.hero, 'AhQh');
  eq(back.result, hand.result);
});

test('normalising is idempotent: the hand round-trips through normalizeHand unchanged', () => {
  const drafts = [EXAMPLE_DRAFT(), unseatedDraft(), studDraft(), drawDraft(), { ...EXAMPLE_DRAFT(), tableSize: null }];
  for (const d of drafts) {
    const once = normalizeDraft(d).hand;
    const again = normalizeHand(once);
    eq(again.hand, once);
    eq(normalizeHand(again.hand).hand, once);
    // Re-deriving the folds already in the hand is not news worth a note.
    eq(again.notes.filter((n) => /not mentioned/.test(n)), []);
  }
});

test('a hand from the replayer keeps everything it carries', async () => {
  const { decodeHand, encodeHand } = await loadVite();
  const link = 'N60.100-200-200~10000,12000,8000,10000,10000,10000.AhKd,-,-,-,QcQd,-/b9s8s2h/bTd/b3c.' +
    '0r500,1f,2f,3c500,4f,5c300/5x,0b600,3c600,5f/0x,3x/0b1500,3c1500.w4.fffffffb';
  const h = decodeHand(link);
  h.title = 'A saved hand';
  const { hand } = normalizeHand(h);
  eq(hand, { ...h, currency: 'USD' });
  eq(encodeHand(hand), encodeHand(h));
});

function unseatedDraft() {
  return {
    gameType: 'NLH', gameMode: 'mtt', tableSize: null, othersFolded: true,
    blinds: { sb: 1000, bb: 2000, ante: 2000 },
    players: [{ position: 'BB', isHero: true, startingStackBB: 40 }, { position: 'CO', startingStack: 150000 }],
    streets: [{ name: 'Preflop', cards: [{ player: 0, cards: 'JsJh' }], actions: [{ player: 1, action: 'raise', toAmountBB: 2.2 }, { player: 0, action: 'all-in' }, { player: 1, action: 'call' }] }],
    notes: [],
  };
}

test('table size unknown: described players only, in preflop order, waiting for the size', () => {
  const { hand } = normalizeDraft(unseatedDraft());
  eq(hand.players.map((p) => p.position), ['CO', 'BB']);
  eq(hand.heroIdx, 1);
  eq(hand.quickAdd, { positions: 'narrator', othersFolded: true });
  eq(hand.players[1].startingStack, 80000); // 40bb × 2000
  eq(hand.players[0].startingStack, 150000);
  // Sizes resolve without the full table: CO opens to 4400; the BB jams 80000 less the
  // 2000 blind and 2000 ante it posted; the CO calls the rest.
  eq(acts(hand, 0), [[0, 'raise', 4400], [1, 'all-in', 76000], [0, 'call', 73600]]);
});

test('table size answered later: the hand is re-seated and the folds inserted', () => {
  const partial = normalizeDraft(unseatedDraft()).hand;
  const { hand: seated } = applyOps(partial, [{ op: 'set', path: 'tableSize', value: 6 }]);
  const { hand } = normalizeHand(seated);
  eq(hand.players.length, 6);
  eq(hand.players.map((p) => p.position), G.positionLabels(6));
  eq(hand.heroIdx, 5);
  eq(hand.streets[0].cards.hero, 'JsJh');
  eq(acts(hand, 0), [[0, 'fold', 0], [1, 'fold', 0], [2, 'raise', 4400], [3, 'fold', 0], [4, 'fold', 0], [5, 'all-in', 76000], [2, 'call', 73600]]);
  assert.ok(!('quickAdd' in hand));
});

test('a player with no position leaves the table partly seated — except by deduction', () => {
  const d = EXAMPLE_DRAFT();
  d.players[1].position = null;
  let { hand, notes } = normalizeDraft(d);
  eq(hand.players.length, 9);
  eq(hand.quickAdd.tableSize, 9);
  eq(hand.players[hand.heroIdx].position, null);
  eq(hand.players[0].position, 'UTG+1');
  eq(hand.players[8].position, 'BB');
  // Who else sits where is unknown, so nobody is labelled or folded on their behalf yet.
  eq(hand.players.filter((p) => p.position).length, 2);
  eq(hand.streets[0].actions.length, 4);
  // Answering the hero's seat completes it.
  const fixed = normalizeHand(applyOps(hand, [{ op: 'set', path: `players.${hand.heroIdx}.position`, value: 'BTN' }]).hand).hand;
  eq(fixed.players.map((p) => p.position), G.positionLabels(9));
  eq(fixed.heroIdx, 6);
  eq(acts(fixed, 0), acts(normalizeDraft(EXAMPLE_DRAFT()).hand, 0));
  // Three-handed with two seats known, the third is the one left.
  ({ hand, notes } = normalizeDraft({
    gameType: 'NLH', tableSize: 3, blinds: { sb: 1, bb: 2, ante: 0 },
    players: [{ position: 'BTN' }, { isHero: true }, { position: 'BB' }], streets: [], notes: [],
  }));
  eq(hand.players[hand.heroIdx].position, 'SB');
  assert.ok(notes.some((n) => /the one left: SB/.test(n)));
});

test('impossible seats are left open, not forced', () => {
  const { hand, notes } = normalizeDraft({
    gameType: 'NLH', tableSize: 6, players: [{ position: 'UTG+3', isHero: true }, { position: 'BTN' }, { position: 'button' }],
    streets: [], notes: [],
  });
  assert.ok(notes.some((n) => /UTG\+3" does not exist at a 6-handed table/.test(n)));
  assert.ok(notes.some((n) => /same seat \(BTN\)/.test(n)));
  eq(hand.players.filter((p) => p.position === 'BTN').length, 1);
  eq(hand.players[hand.heroIdx].position, null);
});

test('heads-up: BTN/SB and BB, button acts first preflop', () => {
  const { hand } = normalizeDraft({
    gameType: 'NLH', gameMode: 'cash', tableSize: 2, blinds: { sb: 5, bb: 10, ante: 0 },
    players: [{ position: 'BB', isHero: true, startingStack: 1000 }, { position: 'button', startingStack: 2000 }],
    streets: [{ name: 'Preflop', actions: [{ player: 1, action: 'raise', toAmount: 30 }, { player: 0, action: 'raise', toAmount: 100 }, { player: 1, action: 'call' }] },
      { name: 'Flop', board: 'AhKhQh', actions: [{ player: 0, action: 'bet', potFraction: 0.5 }, { player: 1, action: 'raise', potFraction: 1 }, { player: 0, action: 'all-in' }, { player: 1, action: 'call' }] }],
    notes: [],
  });
  eq(hand.players.map((p) => p.position), ['BTN/SB', 'BB']);
  eq(acts(hand, 0), [[0, 'raise', 25], [1, 'raise', 90], [0, 'call', 70]]);
  // Pot 200: half pot = 100; pot-sized raise to 100 + (200 + 100 + 100) = 500; the BB
  // jams the 800 left; the button calls 800 - 500.
  eq(acts(hand, 1), [[1, 'bet', 100], [0, 'raise', 500], [1, 'all-in', 800], [0, 'call', 400]]);
});

test('stakes: per-player ante, limit bets, straddles', () => {
  // An old per-player ante becomes the big blind ante for the table.
  let { hand, notes } = normalizeDraft({ ...EXAMPLE_DRAFT(), gameMode: 'mtt', blinds: { sb: 100, bb: 200, ante: 25, anteType: 'per_player' } });
  eq(hand.blinds.ante, 225);
  assert.ok(notes.some((n) => /25 per player is recorded as a big blind ante of 225/.test(n)));
  // ...and waits for the table size when it is not known.
  ({ hand } = normalizeDraft({ ...unseatedDraft(), blinds: { sb: 100, bb: 200, ante: 25, anteType: 'per_player' } }));
  eq(hand.blinds.ante, null);
  eq(hand.quickAdd.antePerPlayer, 25);
  const later = normalizeHand(applyOps(hand, [{ op: 'set', path: 'tableSize', value: 8 }]).hand).hand;
  eq(later.blinds.ante, 200);
  assert.ok(!('quickAdd' in later));

  // Limit: bets and raises are the fixed sizes; big bet from the turn.
  ({ hand } = normalizeDraft({
    gameType: 'LHE', tableSize: 4, othersFolded: true, blinds: { sb: 10, bb: 20, ante: 0, bigBet: 40 },
    players: [{ position: 'CO', isHero: true }, { position: 'BB' }],
    streets: [
      { name: 'Preflop', actions: [{ player: 0, action: 'raise' }, { player: 1, action: 'raise' }, { player: 0, action: 'call' }] },
      { name: 'Turn', board: '2c', actions: [{ player: 1, action: 'bet' }, { player: 0, action: 'raise' }, { player: 1, action: 'call' }] },
    ],
    notes: [],
  }));
  eq(acts(hand, 0), [[0, 'raise', 40], [1, 'fold', 0], [2, 'fold', 0], [3, 'raise', 40], [0, 'call', 20]]);
  eq(acts(hand, 2), [[3, 'bet', 40], [0, 'raise', 80], [3, 'call', 40]]);

  // A UTG straddle posts 2bb and moves the start of the action to its left.
  ({ hand } = normalizeDraft({
    gameType: 'NLH', gameMode: 'cash', tableSize: 6, othersFolded: true,
    blinds: { sb: 2, bb: 5, ante: 0, straddles: [{ type: 'utg', player: 0 }] },
    players: [{ position: 'UTG' }, { position: 'BTN', isHero: true }],
    streets: [{ name: 'Preflop', actions: [{ player: 1, action: 'raise', toAmount: 35 }, { player: 0, action: 'call' }] }],
    notes: [],
  }));
  eq(hand.blinds.straddle, true);
  eq(hand.blinds.straddle_utg, true);
  eq(acts(hand, 0), [[1, 'fold', 0], [2, 'fold', 0], [3, 'raise', 35], [4, 'fold', 0], [5, 'fold', 0], [0, 'call', 25]]);
});

test('straddles: a Mississippi straddle keeps its seat; one described before the table is known waits', () => {
  let { hand } = normalizeDraft({
    gameType: 'NLH', gameMode: 'cash', tableSize: 9, othersFolded: true,
    blinds: { sb: 5, bb: 10, ante: 0, straddles: [{ type: 'mississippi', player: 0 }] },
    players: [{ position: 'CO' }, { position: 'BB', isHero: true }],
    streets: [{ name: 'Preflop', actions: [{ player: 1, action: 'raise', toAmount: 80 }, { player: 0, action: 'call' }] }],
    notes: [],
  });
  eq([hand.blinds.straddle_mississippi, hand.blinds.straddleSeats], [true, { mississippi: 5 }]);
  // Action starts on the button, left of the CO straddler; the CO, in for 20, calls 60.
  eq(acts(hand, 0), [[6, 'fold', 0], [7, 'fold', 0], [8, 'raise', 70], [0, 'fold', 0], [1, 'fold', 0], [2, 'fold', 0],
    [3, 'fold', 0], [4, 'fold', 0], [5, 'call', 60]]);

  ({ hand } = normalizeDraft({
    gameType: 'NLH', gameMode: 'cash', othersFolded: true,
    blinds: { sb: 5, bb: 10, ante: 0, straddles: [{ type: 'button' }] },
    players: [{ position: 'BTN' }, { position: 'BB', isHero: true }], streets: [], notes: [],
  }));
  eq(hand.blinds.straddle, undefined);
  eq(hand.quickAdd.straddles, [{ type: 'button' }]);
  const seated = normalizeHand(applyOps(hand, [{ op: 'set', path: 'tableSize', value: 6 }]).hand).hand;
  eq([seated.blinds.straddle, seated.blinds.straddle_button], [true, true]);
  assert.ok(!('quickAdd' in seated));
});

test('a seated hand re-seats when the hero\'s position is corrected', () => {
  const hand = normalizeDraft(EXAMPLE_DRAFT()).hand; // hero on the BTN (seat 6)
  const moved = normalizeHand(applyOps(hand, [{ op: 'set', path: 'players.6.position', value: 'CO' }]).hand);
  eq(moved.hand.heroIdx, 5);
  eq(moved.hand.players.map((p) => p.position), G.positionLabels(9));
  eq(moved.hand.streets[0].cards.hero, 'AhQh');
  eq(moved.notes.filter((n) => /same seat/.test(n)), []); // the anonymous seat simply gives way
  eq(acts(moved.hand, 0).find(([, a]) => a === 'raise'), [5, 'raise', 15]);
});

function studDraft() {
  return {
    gameType: 'Razz', gameMode: 'mtt', tableSize: 7, othersFolded: false,
    blinds: { bb: 400, bigBet: 800, ante: 100, bringIn: 100 },
    players: [{ isHero: true }, { name: 'Phil' }],
    streets: [
      { name: '3rd Street', cards: [{ player: 0, cards: 'As2d5c' }, { player: 1, cards: 'Kh' }],
        actions: [{ player: 1, action: 'bring-in' }, { player: 0, action: 'bet' }, { player: 1, action: 'call' }] },
      { name: '4th Street', cards: [{ player: 0, cards: '3h' }, { player: 1, cards: '7c' }], actions: [{ player: 0, action: 'bet' }, { player: 1, action: 'call' }] },
      { name: '5th Street', cards: [{ player: 0, cards: '9s' }, { player: 1, cards: '4d4h' }] },
    ],
    notes: [],
  };
}

test('stud: seat numbers, per-street cards, bring-in, fixed bets', () => {
  const { hand, notes } = normalizeDraft(studDraft());
  eq(hand.players.map((p) => p.position), G.studLabels(7));
  eq(hand.players[1].name, 'Phil');
  eq(hand.blinds, { sb: null, bb: 400, ante: 100, bigBet: 800, bringIn: 100 });
  eq(hand.streets[0].cards.hero, 'As2d5c');
  eq(hand.streets[0].cards.opponents[0], 'Kh');
  eq(hand.streets[1].cards.opponents[0], '7c');
  eq(hand.streets[2].cards.opponents[0], ''); // two up cards on one street is not stud
  assert.ok(notes.some((n) => /only an opponent's up cards/.test(n)));
  // Bring-in 100; the completion is the 400 small bet; the call is the 300 more.
  eq(acts(hand, 0), [[1, 'bring-in', 100], [0, 'bet', 400], [1, 'call', 300]]);
  eq(acts(hand, 1), [[0, 'bet', 400], [1, 'call', 400]]);
});

function drawDraft() {
  return {
    gameType: '2-7 TD', gameMode: 'mtt', tableSize: 6, othersFolded: true,
    blinds: { sb: 200, bb: 400, ante: 400, bigBet: 800 },
    players: [{ position: 'BTN', isHero: true }, { position: 'BB', name: 'Mike' }],
    streets: [
      { name: 'Pre-Draw', cards: [{ player: 0, cards: '2h3d4c7sKs' }, { player: 1, cards: '2c3c5d6h8s' }], actions: [{ player: 0, action: 'raise' }, { player: 1, action: 'call' }] },
      { name: 'First Draw', actions: [{ player: 1, action: 'check' }, { player: 0, action: 'bet' }, { player: 1, action: 'call' }] },
    ],
    draws: [
      { drawNumber: 1, player: 0, discarded: 1, discardedCards: 'Ks', newCards: '8d' },
      { drawNumber: 1, player: 1, discarded: 2 },
      { drawNumber: 3, player: 0, discarded: 0 },
      { drawNumber: 2, player: 7, discarded: 1 },
    ],
    notes: [],
  };
}

test('draw games: draws sit on the round before them; showdown hands for opponents', () => {
  const { hand } = normalizeDraft(drawDraft());
  eq(hand.streets.map((s) => s.name), ['Pre-Draw', 'First Draw', 'Second Draw', 'Third Draw']);
  eq(hand.heroIdx, 3);
  eq(hand.streets[0].draws, [
    { player: 3, discarded: 1, discardedCards: 'Ks', newCards: '8d' },
    { player: 5, discarded: 2, discardedCards: '', newCards: '' },
  ]);
  eq(hand.streets[2].draws, [{ player: 3, discarded: 0, discardedCards: '', newCards: '' }]); // the third draw
  eq(hand.streets[1].draws, []); // the draw by a player who does not exist is gone
  eq(hand.streets[0].cards.opponents[4], '2c3c5d6h8s'); // the BB's showdown hand
  // Limit: the raise is the 400 small bet on top of the 400 big blind; the BB, in for
  // 400, calls 400 more.
  eq(acts(hand, 0).filter(([, a]) => a !== 'fold'), [[3, 'raise', 800], [5, 'call', 400]]);
  eq(acts(hand, 1), [[5, 'check', 0], [3, 'bet', 400], [5, 'call', 400]]);
});

test('board: a whole runout on the flop is split; extra cards dropped', () => {
  const d = EXAMPLE_DRAFT();
  d.streets = [{ name: 'Flop', board: 'Qs 7d 2c 4h Ks' }];
  let { hand } = normalizeDraft(d);
  eq(hand.streets.slice(1).map((s) => s.cards.board), ['Qs7d2c', '4h', 'Ks']);
  d.streets = [{ name: 'Preflop', board: 'Qs7d2c' }];
  ({ hand } = normalizeDraft(d));
  eq(hand.streets[1].cards.board, 'Qs7d2c');
  d.streets = [{ name: 'Turn', board: '4h5h' }];
  ({ hand } = normalizeDraft(d));
  eq([hand.streets[2].cards.board, hand.streets[3].cards.board], ['4h', '5h']);
});

test('cards: too many, wrong street, not cards, collisions — dropped or flagged, never invented', () => {
  const d = EXAMPLE_DRAFT();
  d.streets[0].cards = [{ player: 1, cards: 'AhQhJh' }, { player: 0, cards: 'the nuts' }, { player: 2, cards: 'AhKd' }];
  d.streets[1].cards = [{ player: 1, cards: 'Ah' }];
  const { hand, notes } = normalizeDraft(d);
  eq(hand.streets[0].cards.hero, '');
  eq(hand.streets[0].cards.opponents[0], '');
  eq(hand.streets[1].cards.hero, '');
  eq(hand.streets[0].cards.opponents[7], 'AhKd');
  assert.ok(notes.some((n) => /3 cards is too many/.test(n)));
  assert.ok(notes.some((n) => /"the nuts" is not card notation/.test(n)));
  assert.ok(notes.some((n) => /belong to the first street/.test(n)));
  const dup = normalizeDraft({ ...EXAMPLE_DRAFT(), streets: [{ name: 'Preflop', cards: [{ player: 1, cards: 'AhQh' }, { player: 2, cards: 'AhQd' }] }] });
  assert.ok(dup.notes.some((n) => /Ah appears more than once/.test(n)));
  eq(dup.hand.streets[0].cards.hero, 'AhQh'); // kept: the gap engine asks which is wrong
});

test('malformed model output never throws and never leaks junk', () => {
  const junk = [
    null, 'a string', 42, [],
    { players: 'everyone', streets: {} },
    { gameType: 'Poker', players: [{ position: 7, isHero: 'yes', startingStack: 'lots' }, null, 'x'], streets: [null, { name: 'Flop', actions: 'many' }] },
    { gameType: 'NLH', players: Array.from({ length: 14 }, () => ({})), streets: [{ name: 'Preflop', actions: [{ player: 99, action: 'raise' }, { player: 0, action: 'teleport' }, { player: -1, action: 'call' }] }] },
    { gameType: 'NLH', players: [{ isHero: true }, { isHero: true }], streets: [{ name: 'The Flop', board: 12 }], result: { winners: [{ playerIdx: 5 }, 'x'] }, tableSize: 40 },
  ];
  for (const j of junk) {
    const { hand, notes } = normalizeDraft(j);
    assert.ok(Array.isArray(hand.players) && hand.players.length <= 10);
    assert.ok(Array.isArray(hand.streets) && hand.streets.length === 4);
    assert.ok(Array.isArray(notes));
    for (const st of hand.streets) {
      for (const a of st.actions) {
        assert.ok(['fold', 'check', 'call', 'bet', 'raise', 'all-in', 'bring-in'].includes(a.action));
        assert.ok(Number.isInteger(a.player) && a.player >= 0 && a.player < hand.players.length);
      }
    }
    for (const p of hand.players) assert.ok(p.startingStack === null || typeof p.startingStack === 'number');
    eq(normalizeHand(hand).hand, hand);
  }
  const last = normalizeDraft(junk[junk.length - 1]);
  eq(last.hand.result, null);
  assert.ok(last.notes.some((n) => /more than one player was marked as the hero/i.test(n)));
  assert.ok(last.notes.some((n) => /table size given was not 2 to 10/.test(n)));
  const poker = normalizeDraft(junk[5]);
  eq(poker.hand.gameType, null);
  assert.ok(poker.notes.some((n) => /"Poker" is not a game the replayer plays/.test(n)));
});

test('sizes that cannot be resolved stay empty and keep what was said', () => {
  const d = EXAMPLE_DRAFT();
  d.blinds = { sb: null, bb: null, ante: null };
  d.streets[0].actions[1] = { player: 1, action: 'raise', toAmountBB: 5 };
  const { hand } = normalizeDraft(d);
  const raise = hand.streets[0].actions.find((a) => a.action === 'raise');
  eq(raise, { player: 6, action: 'raise', amount: null, toAmountBB: 5 });
  eq(hand.streets[0].actions.find((a) => a.player === 8 && a.action === 'call').amount, null);
  // Once the stakes are answered, the size resolves.
  const after = normalizeHand(applyOps(hand, [{ op: 'set', path: 'blinds.bb', value: 3 }, { op: 'set', path: 'blinds.sb', value: 1 }, { op: 'set', path: 'blinds.ante', value: 0 }]).hand).hand;
  eq(after.streets[0].actions.find((a) => a.action === 'raise'), { player: 6, action: 'raise', amount: 15 });
});

test('no hero: noted, cards laid out provisionally and moved when the hero is named', () => {
  const d = EXAMPLE_DRAFT();
  d.players[1].isHero = false;
  const { hand, notes } = normalizeDraft(d);
  eq(hand.heroIdx, null);
  assert.ok(notes.some((n) => /No hero was identified/.test(n)));
  const named = normalizeHand(applyOps(hand, [{ op: 'set', path: 'heroIdx', value: 6 }]).hand).hand;
  // Before, seat 0's cards were the provisional "hero" slot; the BTN's were opponents[5].
  eq(hand.streets[0].cards.hero, 'KdQc');
  eq(named.streets[0].cards.hero, 'AhQh');
  eq(named.streets[0].cards.opponents[0], 'KdQc');
});

/* ── Prompts ───────────────────────────────────────────────────────────────── */

test('parse request: forced tool, cached system prompt, text vs speech', () => {
  const t = buildParseRequest({ text: 'UTG opens, I 3b', source: 'text', hints: {}, model: 'claude-sonnet-5' });
  const s = buildParseRequest({ text: 'under the gone opens i three bet', source: 'speech', hints: { gameType: 'PLO', heroName: 'Ham' }, model: 'claude-sonnet-5' });
  eq(t.model, 'claude-sonnet-5');
  eq(t.tool_choice, { type: 'tool', name: 'record_hand' });
  eq(t.tools, [HAND_TOOL]);
  eq(t.system[0].cache_control, { type: 'ephemeral' });
  assert.ok(t.system[0].text.startsWith(PARSE_SYSTEM));
  assert.ok(t.system[0].text.endsWith(TEXT_ADDENDUM));
  assert.ok(!t.system[0].text.includes(SPEECH_ADDENDUM));
  assert.ok(s.system[0].text.endsWith(SPEECH_ADDENDUM));
  assert.ok(/speech transcript/.test(s.system[0].text) && /"three bet"/.test(s.system[0].text));
  assert.ok(/pasted hand history/.test(t.system[0].text));
  assert.ok(t.messages[0].content.includes('<description source="text">\nUTG opens, I 3b\n</description>'));
  assert.ok(s.messages[0].content.includes('<description source="speech">'));
  assert.ok(s.messages[0].content.includes('selected the game PLO'));
  assert.ok(s.messages[0].content.includes("narrator's name is Ham"));
  assert.ok(!t.messages[0].content.includes('selected the game'));
  assert.ok(!('thinking' in t) && !('temperature' in t)); // Sonnet 5 rejects sampling params
  // The prompt carries the rules that matter.
  for (const must of ['Never invent', 'chips ADDED', 'toAmount', 'big blind ante', 'isHero', 'x', 'othersFolded', 'tableSize']) {
    assert.ok(PARSE_SYSTEM.includes(must), must);
  }
  // Every enum the prompt promises exists in the schema.
  eq(HAND_TOOL.input_schema.properties.gameType.enum.slice(0, -1), G.GAME_NAMES);
  eq(HAND_TOOL.input_schema.properties.streets.items.properties.actions.items.properties.action.enum,
    ['fold', 'check', 'call', 'bet', 'raise', 'all-in', 'bring-in']);
});

test('the example in the prompt is valid tool input', () => {
  const m = /record_hand input:\n([\s\S]*?)\n\(The small blind/.exec(PARSE_SYSTEM);
  assert.ok(m, 'example present');
  const parsed = JSON.parse(m[1]);
  eq(normalizeDraft(parsed).hand, normalizeDraft(EXAMPLE_DRAFT()).hand);
});

test('answer request: gap, answer, seat table and hand', () => {
  const hand = normalizeDraft(EXAMPLE_DRAFT()).hand;
  const r = buildAnswerRequest({ hand, gap: { id: 'stack:6', kind: 'missing', field: 'players.6.startingStack', question: 'How deep were you?' }, answer: 'about 300', model: 'claude-haiku-4-5-20251001' });
  eq(r.tool_choice, { type: 'tool', name: 'apply_answer' });
  eq(r.tools, [ANSWER_TOOL]);
  const c = r.messages[0].content;
  assert.ok(c.includes('"field":"players.6.startingStack"'));
  assert.ok(c.includes('<answer>\nabout 300\n</answer>'));
  assert.ok(c.includes('6: Hero (hero) · position BTN · stack unknown · cards AhQh'));
  assert.ok(c.includes('0: Opp 1 · position UTG+1 · stack unknown · cards KdQc'));
  assert.ok(c.includes(JSON.stringify(hand)));
});

/* ── Service with a stub client ────────────────────────────────────────────── */

test('parseHand: canned tool_use → normalised hand + merged notes', async () => {
  const client = stubClient(toolReply('record_hand', EXAMPLE_DRAFT()));
  const out = await QA.parseHand({ client, text: 'the hand', source: 'text', hints: {} });
  eq(client.calls.length, 1);
  eq(client.calls[0].model, 'claude-sonnet-5');
  eq(out.hand, normalizeDraft(EXAMPLE_DRAFT()).hand);
  eq(out.notes[0], "UTG's KQ was offsuit; its suits weren't said.");
  assert.ok(out.notes.some((n) => /not mentioned/.test(n)));
  eq(out.usage.cache_read_input_tokens, 3500);
});

test('parseHand: hints fill what the model left open', async () => {
  const draft = { ...EXAMPLE_DRAFT(), gameType: null };
  draft.players[1].isHero = false;
  draft.players[1].name = 'Ham';
  const out = await QA.parseHand({ client: stubClient(toolReply('record_hand', draft)), text: 'x', hints: { gameType: 'PLO', heroName: 'Ham' } });
  eq(out.hand.gameType, 'PLO');
  eq(out.hand.heroIdx, 6);
  eq(out.hand.players[6].name, 'Ham');
});

test('parseHand: refusals, truncation, missing tool use and API errors map to clear statuses', async () => {
  const status = async (reply) => {
    try { await QA.parseHand({ client: stubClient(reply), text: 'x' }); return 200; } catch (e) { assert.ok(e instanceof QA.QuickAddError, e.message); return e.status; }
  };
  eq(await status({ ...toolReply('record_hand', {}), stop_reason: 'refusal', content: [] }), 422);
  eq(await status({ ...toolReply('record_hand', {}), stop_reason: 'max_tokens' }), 422);
  eq(await status({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here is your hand!' }] }), 502);
  eq(await status(toolReply('some_other_tool', {})), 502);
  eq(await status({ ...toolReply('record_hand', null) }), 502);
  eq(await status({ content: null }), 502);
  eq(await status(apiError(429, 'rate limited')), 503);
  eq(await status(apiError(529, 'overloaded')), 503);
  eq(await status(apiError(401, 'bad key')), 503);
  eq(await status(apiError(400, 'invalid request')), 502);
  eq(await status(apiError(500, 'boom')), 502);
  eq(await status(new Error('socket hang up')), 504);
  // Junk tool input still yields a (mostly empty) hand, not an error.
  eq(await status(toolReply('record_hand', { players: 'nope' })), 200);
});

test('parseHand: a 400 about forced tools + thinking is retried once with thinking off', async () => {
  const client = stubClient([apiError(400, 'tool_choice forces tool use, which is not compatible with thinking'), toolReply('record_hand', EXAMPLE_DRAFT())]);
  const out = await QA.parseHand({ client, text: 'x' });
  eq(client.calls.length, 2);
  eq(client.calls[1].thinking, { type: 'disabled' });
  eq(out.hand.heroIdx, 6);
  const twice = stubClient([apiError(400, 'thinking is bad'), apiError(400, 'thinking is still bad')]);
  await assert.rejects(QA.parseHand({ client: twice, text: 'x' }), (e) => e.status === 502);
  eq(twice.calls.length, 2);
});

test('answerGap: plain answers need no model', async () => {
  const hand = normalizeDraft(EXAMPLE_DRAFT()).hand;
  let out = await QA.answerGap({ client: null, hand, gap: { field: 'players.6.startingStack', question: 'How deep?' }, answer: '50k' });
  eq(out.hand.players[6].startingStack, 50000);
  eq(out.applied, true);
  eq(out.usage, null);
  out = await QA.answerGap({ client: null, hand, gap: { field: 'players.6.startingStack', question: 'How deep?' }, answer: '100bb' });
  eq(out.hand.players[6].startingStack, 300);
  out = await QA.answerGap({ client: null, hand, gap: { field: 'streets.0.cards.player.0', question: 'What did UTG show?' }, answer: 'Kd Qc' });
  eq(out.hand.streets[0].cards.opponents[0], 'KdQc');
  const partial = normalizeDraft(unseatedDraft()).hand;
  out = await QA.answerGap({ client: null, hand: partial, gap: { field: 'tableSize', question: 'How many players?' }, answer: '6-max' });
  eq(out.hand.players.length, 6);
  // Anything else needs the model, and there is none: 503.
  await assert.rejects(QA.answerGap({ client: null, hand, gap: { field: 'players.6.position', question: 'Where were you?' }, answer: 'on the button' }), (e) => e.status === 503);
});

test('answerGap: model ops are applied, validated and re-normalised', async () => {
  const d = EXAMPLE_DRAFT();
  d.players[1].position = null;
  const hand = normalizeDraft(d).hand;
  const hero = hand.heroIdx;
  const client = stubClient(toolReply('apply_answer', {
    understood: true,
    ops: [
      { op: 'set', path: `players.${hero}.position`, value: 'BTN' },
      { op: 'set', path: `players.${hero}.startingStackBB`, value: 100 },
      { op: 'set', path: 'players.0.startingStack; DROP TABLE', value: 1 },   // refused
      { op: 'set', path: '__proto__.polluted', value: true },                  // refused
      { op: 'set', path: 'blinds.bb', value: 'a lot' },                       // refused
    ],
    note: null,
  }));
  const out = await QA.answerGap({ client, hand, gap: { id: 'position:hero', field: `players.${hero}.position`, question: 'Where were you sitting?' }, answer: 'I was on the button with 100 bigs' });
  eq(client.calls[0].model, 'claude-haiku-4-5-20251001');
  eq(out.hand.heroIdx, 6);
  eq(out.hand.players[6].position, 'BTN');
  eq(out.hand.players[6].startingStack, 300);
  eq(out.hand.blinds.bb, 3);
  eq(({}).polluted, undefined);
  assert.ok(out.notes.includes('Part of the answer could not be applied.'));
  // The rest of the hand is what a direct parse would have produced.
  const direct = normalizeDraft(EXAMPLE_DRAFT()).hand;
  eq(out.hand.streets, direct.streets);
});

test('answerGap: an inserted action and a size given as a total', async () => {
  const d = EXAMPLE_DRAFT();
  d.streets[0].actions.splice(2, 1); // the BB's preflop call was left out
  const hand = normalizeDraft(d).hand;
  const client = stubClient(toolReply('apply_answer', {
    understood: true,
    ops: [
      { op: 'insert', path: 'streets.0.actions.8', value: { player: 8, action: 'call' } },
      { op: 'set', path: 'streets.3.actions.0.toAmount', value: 75 },
    ],
  }));
  const out = await QA.answerGap({ client, hand, gap: { field: 'streets.0.actions', question: 'What did the big blind do?' }, answer: 'BB called, and the river bet was 75 not 60' });
  eq(acts(out.hand, 0).slice(7), [[7, 'fold', 0], [8, 'call', 12], [0, 'call', 12]]);
  eq(acts(out.hand, 3), [[0, 'bet', 75], [6, 'call', 75]]);
});

test('answerGap: an answer that does not answer changes nothing', async () => {
  const hand = normalizeDraft(EXAMPLE_DRAFT()).hand;
  const client = stubClient(toolReply('apply_answer', { understood: false, ops: [{ op: 'set', path: 'blinds.bb', value: 1000 }] }));
  const out = await QA.answerGap({ client, hand, gap: { field: 'players.6.position', question: 'Where were you?' }, answer: 'no idea honestly' });
  eq(out.hand, hand);
  eq(out.applied, false);
  assert.ok(out.notes[0].includes('did not answer the question'));
});

test('applyOps: structure the answer was not asked about cannot be touched', () => {
  const hand = normalizeDraft(EXAMPLE_DRAFT()).hand;
  const { hand: h, applied, rejected } = applyOps(hand, [
    { op: 'remove', path: 'players.3' },
    { op: 'insert', path: 'blinds.bb', value: 4 },
    { op: 'set', path: 'streets.9.cards.board', value: 'Ah' },
    { op: 'set', path: 'streets.0.actions.40', value: { player: 1, action: 'call' } },
    { op: 'set', path: 'streets.0.actions.0', value: { player: 77, action: 'call' } },
    { op: 'set', path: 'streets.0.cards.hero', value: 'not cards' },
    { op: 'set', path: 'heroIdx', value: 12 },
    { op: 'set', path: 'tableSize', value: 14 },
    { op: 'move', path: 'heroIdx', value: 1 },
    'junk',
  ]);
  eq(applied, 0);
  eq(rejected.length, 10);
  eq(h, hand);
  eq(fastAnswerOps(hand, { field: 'players.6.startingStack' }, 'deep'), null);
  eq(fastAnswerOps(hand, { field: 'streets.0.cards.hero' }, 'AK suited'), null); // ranks only: the model's job
});

/* ── Routes ────────────────────────────────────────────────────────────────── */

const SECRET = 'quick-add-test-secret';
function authenticateToken(req, res, next) { // the same shape as server.js's
  const h = req.headers.authorization;
  const token = h && h.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied' });
  jwt.verify(token, SECRET, (err, user) => {
    if (err) return res.status(401).json({ error: 'Invalid token' });
    req.user = user; next();
  });
}
const ADMINS = new Set(['ham', 'ham5', 'claude']);
const sign = (u) => 'Bearer ' + jwt.sign(u, SECRET);

async function withServer(opts, fn) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  const silent = { log() {}, error() {} };
  app.use('/api/quick-add', QA.createQuickAddRouter({
    authenticateToken, isAdmin: (u) => ADMINS.has(String(u.username || '').toLowerCase()), log: silent, ...opts,
  }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/quick-add`;
  const call = async (route, body, user) => {
    const res = await fetch(base + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: user } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
  };
  try { await fn(call); } finally { await new Promise((r) => server.close(r)); }
}

test('routes: auth, admin gate, validation, 503 without a key', async () => {
  const ham = sign({ id: 1, username: 'ham5' });
  const guest = sign({ id: 2, username: 'someone' });
  await withServer({ getClient: () => null }, async (call) => {
    eq((await call('/parse', { text: 'x' })).status, 401);
    eq((await call('/parse', { text: 'x' }, 'Bearer forged')).status, 401);
    const forbidden = await call('/parse', { text: 'x' }, guest);
    eq(forbidden.status, 403);
    assert.ok(forbidden.body.error);
    eq((await call('/parse', { source: 'text' }, ham)).status, 400);
    eq((await call('/parse', { text: '   ' }, ham)).status, 400);
    eq((await call('/parse', { text: 'x', source: 'video' }, ham)).status, 400);
    eq((await call('/parse', { text: 'x', hints: { gameType: 'Short Deck' } }, ham)).status, 400);
    eq((await call('/parse', { text: 'x'.repeat(6001) }, ham)).status, 413);
    const noKey = await call('/parse', { text: 'UTG opens, I 3-bet' }, ham);
    eq(noKey.status, 503);
    eq(noKey.body, { error: 'ANTHROPIC_API_KEY not configured on server' });
    eq((await call('/answer', { hand: {}, gap: {}, answer: 'x' }, ham)).status, 400);
    eq((await call('/answer', { hand: { players: [], streets: [], gameType: 'OFC' }, gap: { question: 'q' }, answer: 'x' }, ham)).status, 400);
    eq((await call('/answer', { hand: { players: [], streets: [] }, gap: { question: 'q' }, answer: '' }, ham)).status, 400);
    eq((await call('/answer', { hand: { players: [], streets: [], pad: 'x'.repeat(70000) }, gap: { question: 'q' }, answer: 'x' }, ham)).status, 413);
    // An answer the fast path handles works with no key at all.
    const hand = normalizeDraft(EXAMPLE_DRAFT()).hand;
    const ok = await call('/answer', { hand, gap: { field: 'players.6.startingStack', question: 'How deep?' }, answer: '$300' }, ham);
    eq(ok.status, 200);
    eq(ok.body.hand.players[6].startingStack, 300);
    eq(ok.body.applied, true);
    const needsModel = await call('/answer', { hand, gap: { field: 'players.6.position', question: 'Where?' }, answer: 'button' }, ham);
    eq(needsModel.status, 503);
  });
});

test('routes: parse end to end, and the per-user rate limit', async () => {
  const ham = sign({ id: 1, username: 'ham5' });
  const claude = sign({ id: 3, username: 'Claude' });
  const client = stubClient(toolReply('record_hand', EXAMPLE_DRAFT()));
  let t = 1_000_000;
  await withServer({ getClient: () => client, limits: { parsePerHour: 2 }, now: () => t }, async (call) => {
    const r1 = await call('/parse', { text: '1/3, UTG limps, I raise to 15 on the button…', source: 'speech' }, ham);
    eq(r1.status, 200);
    eq(r1.body.hand, normalizeDraft(EXAMPLE_DRAFT()).hand);
    assert.ok(Array.isArray(r1.body.notes));
    assert.ok(client.calls[0].system[0].text.includes('speech transcript'));
    eq((await call('/parse', { text: 'again' }, ham)).status, 200);
    const r3 = await call('/parse', { text: 'and again' }, ham);
    eq(r3.status, 429);
    eq(r3.body.retryAfterSec, 3600);
    eq(r3.headers.get('retry-after'), '3600');
    eq(client.calls.length, 2); // the limited request never reached the model
    eq((await call('/parse', { text: 'another admin' }, claude)).status, 200); // per user
    // Invalid requests do not use up the allowance; time does free it.
    t += 3600 * 1000 + 1;
    eq((await call('/parse', { text: 'next hour' }, ham)).status, 200);
  });
});

test('routes: model failures come back as JSON errors', async () => {
  const ham = sign({ id: 1, username: 'ham' });
  await withServer({ getClient: () => stubClient(apiError(429, 'slow down')) }, async (call) => {
    const r = await call('/parse', { text: 'x' }, ham);
    eq(r.status, 503);
    assert.ok(/busy/.test(r.body.error));
  });
  await withServer({ getClient: () => stubClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'no' }] }) }, async (call) => {
    eq((await call('/parse', { text: 'x' }, ham)).status, 502);
  });
  await withServer({ getClient: () => { throw new Error('boom'); } }, async (call) => {
    const r = await call('/parse', { text: 'x' }, ham);
    eq(r.status, 500);
    eq(r.body, { error: 'Quick add failed.' });
  });
});

test('rate limiter: sliding window', () => {
  let t = 0;
  const rl = QA.createRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
  eq([rl.take('a').ok, rl.take('a').ok, rl.take('a').ok, rl.take('a').ok], [true, true, true, false]);
  eq(rl.take('b').ok, true);
  t = 999; eq(rl.take('a').ok, false);
  t = 1000; eq(rl.take('a').ok, true);
});

/* ── Run ───────────────────────────────────────────────────────────────────── */

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log('  ok   ' + name);
    } catch (e) {
      failed++;
      console.log('  FAIL ' + name + '\n       ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n       '));
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
