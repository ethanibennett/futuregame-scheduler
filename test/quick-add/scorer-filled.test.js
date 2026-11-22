// The eval counts the suits the server fills in apart from the suits the model picks (2026-11-22: 598 of
// Opus 5.5's 602 "invented suits" were the server's, which is the design: a note tells the player). The
// eval reads them from the server's own notes, so this holds lib/quick-add/normalize.js's wording to
// eval.js filledByServer, and checks expect.mentioned. Run with `node test/quick-add/scorer-filled.test.js`
// (part of npm run test:quick-add). No API.
'use strict';
const assert = require('assert');
const path = require('path');
const E = require('./eval.js');
const { normalizeDraft } = require('../../lib/quick-add/normalize');

const concrete = (s) => (String(s || '').match(/[2-9TJQKA][hdcs]/g) || []);

// Ranks alone on the hero's hand and the board: every suit the server picks is named in its note.
{
  const { hand, notes } = normalizeDraft({
    gameType: 'NLH', gameMode: 'cash', blinds: { sb: 1, bb: 2, ante: 0 },
    players: [{ position: 'BTN', isHero: true, startingStack: 200 }, { position: 'BB', isHero: false, startingStack: 200 }],
    streets: [
      { name: 'Preflop', cards: [{ player: 0, cards: 'AK' }], actions: [{ player: 0, action: 'raise', toAmount: 6 }, { player: 1, action: 'call' }] },
      { name: 'Flop', board: '842', actions: [{ player: 1, action: 'check' }, { player: 0, action: 'check' }] },
      { name: 'Turn', board: 'Qs', actions: [{ player: 1, action: 'check' }, { player: 0, action: 'check' }] },
    ],
  }, {});
  const placed = [...concrete(hand.streets[0].cards.hero), ...concrete(hand.streets[1].cards.board)];
  assert.strictEqual(placed.length, 5, JSON.stringify(hand.streets.map((s) => s.cards)));
  assert.deepStrictEqual([...E.filledByServer(notes)].sort(), placed.sort(), notes.join(' | '));
  assert.ok(!E.filledByServer(notes).has('Qs'), 'a suit the text gave is not the server\'s');
}

// Suits counted, not placed ("ATT42cc"): the cards the server took for them are its picks too.
{
  const bigO = (flop) => ({
    gameType: 'Big O', gameMode: 'cash', blinds: { sb: 1, bb: 2, ante: 0 },
    players: [{ position: 'BTN', isHero: false }, { position: 'BB', isHero: true }],
    streets: [
      { name: 'Preflop', cards: [{ player: 1, cards: 'ATT42cc' }], actions: [{ player: 0, action: 'raise', toAmount: 6 }, { player: 1, action: 'call' }] },
      { name: 'Flop', board: flop, actions: [{ player: 1, action: 'check' }, { player: 0, action: 'check' }] },
    ],
  });
  for (const flop of ['T86', 'Tc86']) {
    const { hand, notes } = normalizeDraft(bigO(flop), {});
    const clubs = concrete(hand.streets[0].cards.hero).filter((c) => c[1] === 'c');
    const read = E.filledByServer(notes);
    assert.ok(clubs.length === 2 && clubs.every((c) => read.has(c)), `${flop}: ${clubs} | ${notes.join(' | ')}`);
  }
}

// The scorer: a filled suit is counted apart, a suit with no note is the model's.
const { cases } = E.loadCorpus(path.join(__dirname, 'corpus'));
const byId = (id) => cases.find((c) => c.id === id);
function score(id, edit, notes) {
  const c = byId(id);
  const v = E.validateCase(c, new Map());
  assert.deepStrictEqual(v.errors, [], id);
  const hand = E.buildOracleHand(c, v);
  edit(hand);
  return E.scoreCase(c, v, hand, { notes }).hallucinations;
}
{
  const sixes = (h) => { h.streets[0].cards.hero = '6s6h'; };
  const filled = score('web-acr-ft-bubble-66-bb-sizes', sixes, ['Suits that were not given were filled in: your hand 6s 6h. Edit the hand if they matter.']);
  assert.deepStrictEqual([filled.suits, filled.filledSuits, filled.cards], [[], ['6s', '6h'], []]);
  const picked = score('web-acr-ft-bubble-66-bb-sizes', sixes, []);
  assert.deepStrictEqual([picked.suits, picked.filledSuits], [['6s', '6h'], []]);
}

// expect.mentioned: cards the text names outside the hand scored count as stated, not invented.
{
  const omc = (h) => { h.streets[0].cards.opponents = [...h.streets[0].cards.opponents, 'Qs6s']; };
  const h = score('web-mtt-kk-utg-4-ways-omc-q6s', omc, []);
  assert.deepStrictEqual([h.cards, h.suits], [[], []]);
  const base = byId('web-mtt-kk-utg-4-ways-omc-q6s');
  const without = { ...base, id: 'x-no-mentioned', expect: { ...base.expect } };
  delete without.expect.mentioned;
  const v = E.validateCase(without, new Map());
  const hand = E.buildOracleHand(without, v);
  omc(hand);
  const w = E.scoreCase(without, v, hand, {}).hallucinations;
  assert.deepStrictEqual(w.suits, ['Qs', '6s'], 'without it they read as invented (the flop has those ranks, so as suits)');
  const bad = E.validateCase({ ...base, id: 'x-bad-mentioned', expect: { ...base.expect, mentioned: ['Q?6'] } }, new Map());
  assert.ok(bad.errors.length, 'a mentioned card must be a card');
}
console.log('scorer-filled.test.js - passed (the server\'s filled suits read from its notes; mentioned cards are stated)');
