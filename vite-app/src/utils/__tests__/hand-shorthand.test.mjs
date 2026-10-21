// node --test src/utils/__tests__/hand-shorthand.test.mjs   (from vite-app/)
//
// The five games the replayer plays natively (PLO5, PLO6, PLO6 8/b, NLO8, Short Deck), and the
// rename of "Big Easy" to "PLO6 8/b" (2026-10-14): a hand saved, shared or encoded under the old
// name must still decode and open as PLO6 8/b.
//
// utils.js reads localStorage at module scope; stub it, and import dynamically so the stub is first.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const SH = await import('../hand-shorthand.js');
const U = await import('../utils.js');

const hand = (gameType, hero, board) => ({
  gameType, gameMode: 'cash', currency: 'USD', heroIdx: 0,
  players: [
    { name: 'Hero', position: 'BTN', startingStack: 20000 },
    { name: 'Opp 1', position: 'SB', startingStack: 20000 },
    { name: 'Opp 2', position: 'BB', startingStack: 20000 },
  ],
  blinds: { sb: 100, bb: 200, ante: 0 },
  streets: [
    { name: 'Preflop', cards: { hero, opponents: ['', ''], board: '' }, actions: [{ player: 1, action: 'call', amount: 100 }, { player: 2, action: 'check' }], draws: [] },
    { name: 'Flop', cards: { hero: '', opponents: [], board: board.slice(0, 6) }, actions: [], draws: [] },
    { name: 'Turn', cards: { hero: '', opponents: [], board: board.slice(6, 8) }, actions: [], draws: [] },
    { name: 'River', cards: { hero: '', opponents: [], board: board.slice(8, 10) }, actions: [], draws: [] },
  ],
  result: { winners: [{ playerIdx: 0, split: false }] },
});

// Exactly what the encoder wrote for a "Big Easy" hand before the rename (produced by the encoder on
// master before this change, for the hand below): the code is BE, and the format has not changed since.
const OLD_BIG_EASY_LINK = 'BE30.100-200~20000.Ah2dKcQs9d8d,-,-/bJh7d6c/b3s/b2h.1c100,2x///.w0.$USD';

test('an old encoded "Big Easy" hand (code BE) decodes and opens as PLO6 8/b', () => {
  const h = SH.decodeHand(OLD_BIG_EASY_LINK);
  assert.ok(h, 'it decodes');
  assert.equal(h.gameType, 'PLO6 8/b');
  assert.equal(h.players.length, 3);
  assert.equal(h.streets[0].cards.hero, 'Ah2dKcQs9d8d', 'six hole cards survive');
  assert.equal(h.streets[1].cards.board, 'Jh7d6c');
  assert.ok(U.HAND_CONFIG[h.gameType], 'the replayer has a config for the game it opened as');
  assert.equal(U.HAND_CONFIG[h.gameType].heroCards, 6);
});

test('a header that spells the old name out also opens as PLO6 8/b', () => {
  const h = SH.decodeHand(OLD_BIG_EASY_LINK.replace(/^BE/, 'Big Easy'));
  assert.equal(h.gameType, 'PLO6 8/b');
  assert.equal(h.players.length, 3);
  assert.equal(h.heroIdx, 0);
});

test('a hand still carrying the old name encodes as the same code, and round-trips as PLO6 8/b', () => {
  const old = hand('Big Easy', 'Ah2dKcQs9d8d', 'Jh7d6c3s2h');
  const now = hand('PLO6 8/b', 'Ah2dKcQs9d8d', 'Jh7d6c3s2h');
  assert.equal(SH.encodeHand(old), OLD_BIG_EASY_LINK);
  assert.equal(SH.encodeHand(now), OLD_BIG_EASY_LINK, 'a link made now opens in a build from before the rename');
  assert.equal(SH.decodeHand(SH.encodeHand(old)).gameType, 'PLO6 8/b');
});

test('the old name is canonicalised wherever a saved game comes in', () => {
  assert.equal(U.canonicalGameType('Big Easy'), 'PLO6 8/b');
  assert.equal(U.canonicalGameType('PLO6 8/b'), 'PLO6 8/b');
  assert.equal(U.canonicalGameType('Big O'), 'Big O');
  assert.equal(U.canonicalGameType('Big Easy Casino'), 'Big Easy Casino', 'a venue is not a game');
  assert.equal(U.canonicalGameType(undefined), undefined);
  const saved = { gameType: 'Big Easy', players: [], streets: [] };
  assert.equal(U.canonicalHand(saved).gameType, 'PLO6 8/b');
  assert.equal(saved.gameType, 'Big Easy', 'the saved object is not mutated');
  const current = { gameType: 'PLO6 8/b' };
  assert.equal(U.canonicalHand(current), current, 'nothing to change, nothing copied');
  assert.deepEqual(U.getVariantStrip('Big Easy'), U.getVariantStrip('PLO6 8/b'));
  assert.equal(U.getVariantStrip('PLO6 8/b').abbr, 'PLO6 8/B');
  assert.equal(U.HAND_CONFIG['Big Easy'], undefined, 'no replayer game goes by the old name');
});

test('PLO5, PLO6, PLO6 8/b, NLO8 and Short Deck: own config, own link code, and they round-trip', () => {
  const cases = [
    ['PLO5',      'P5', 5, 'pl', 'AhKdQc9s8h'],
    ['PLO6',      'P6', 6, 'pl', 'AhKdQc9s8h7d'],
    ['PLO6 8/b',  'BE', 6, 'pl', 'Ah2dKcQs9d8d'],
    ['NLO8',      'NO', 4, 'nl', 'Ah2dKcQs'],
    ['Short Deck','SK', 2, 'nl', 'AhKd'],
  ];
  for (const [game, code, cards, betting, hero] of cases) {
    const cfg = U.HAND_CONFIG[game];
    assert.ok(cfg, game + ' has a HAND_CONFIG entry');
    assert.equal(cfg.heroCards, cards, game + ' hole cards');
    assert.equal(cfg.betting, betting, game + ' betting');
    assert.equal(cfg.hasBoard, true);
    assert.ok(cfg.heroPlaceholder && cfg.boardPlaceholder, game + ' placeholders');
    assert.equal(SH.GAME_CODES[game], code, game + ' link code');
    const enc = SH.encodeHand(hand(game, hero, 'Jh7d6c3s2h'));
    assert.ok(enc.startsWith(code + '30.'), game + ' header: ' + enc.slice(0, 6));
    const dec = SH.decodeHand(enc);
    assert.equal(dec.gameType, game);
    assert.equal(dec.streets[0].cards.hero, hero);
    assert.equal(dec.streets.map(s => s.name).join(), 'Preflop,Flop,Turn,River');
  }
  assert.equal(U.HAND_CONFIG['Short Deck'].shortDeck, true, 'only Short Deck is a 36-card deck');
  assert.ok(!Object.entries(U.HAND_CONFIG).some(([g, c]) => c.shortDeck && g !== 'Short Deck'));
});

test("a Short Deck link carries the room's rule: SKT when trips beat a straight, SK otherwise", () => {
  const trips = { ...hand('Short Deck', 'AhKd', 'Jh7d6c3s2h'), tripsBeatStraight: true };
  const encT = SH.encodeHand(trips);
  assert.ok(encT.startsWith('SKT30.'), encT.slice(0, 7));
  const decT = SH.decodeHand(encT);
  assert.deepEqual([decT.gameType, decT.tripsBeatStraight, decT.players.length], ['Short Deck', true, 3]);
  const plain = SH.decodeHand(SH.encodeHand(hand('Short Deck', 'AhKd', 'Jh7d6c3s2h')));
  assert.deepEqual([plain.gameType, plain.tripsBeatStraight], ['Short Deck', false]);
  assert.equal(SH.decodeHand(SH.encodeHand(hand('NLH', 'AhKd', 'Jh7d6c3s2h'))).tripsBeatStraight, undefined, 'other games carry nothing');
});

test('the new codes do not eat a player count: 8-handed PLO6 is still PLO6, not NLO8 or PLO6 8/b', () => {
  assert.equal(SH.decodeHand('P683.100-200.-.-.').gameType, 'PLO6');
  assert.equal(SH.decodeHand('P683.100-200.-.-.').players.length, 8);
  assert.equal(SH.decodeHand('NO63.100-200.-.-.').gameType, 'NLO8');
  assert.equal(SH.decodeHand('SK63.100-200.-.-.').gameType, 'Short Deck');
  assert.equal(SH.decodeHand('N63.100-200.-.-.').gameType, 'NLH', 'and hold’em is untouched');
});

test('the game codes stay one-to-one, so no two games share a header', () => {
  const codes = Object.values(SH.GAME_CODES);
  assert.equal(new Set(codes).size, codes.length);
});

test("a straddled hand keeps its stacks: the '!' code is written before the '~' stacks (owner's hand, 2026-10-21)", () => {
  const h = SH.decodeHand('P84.10-10!u~4000,4000,4500,4000,7350,4000,9000,4000.AdAcQd9c,-,-,-,-,-,KcJhJsTc,-/bKdJdTh/bKh/bKs.1f,2r80,3f,4r280,5f,6r940,7f,0f,2f,4c670/6b2010,4r6400,6c4390/6b1650/.w6');
  assert.deepEqual(h.players.map(p => p.startingStack), [4000, 4000, 4500, 4000, 7350, 4000, 9000, 4000]);
  assert.ok(Object.keys(h.blinds).some(k => k.startsWith('straddle_') && h.blinds[k]), 'the straddle survives');
  const back = SH.decodeHand(SH.encodeHand(h));
  assert.deepEqual(back.players.map(p => p.startingStack), [4000, 4000, 4500, 4000, 7350, 4000, 9000, 4000]);
});
