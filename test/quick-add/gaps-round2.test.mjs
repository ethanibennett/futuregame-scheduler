// Quick-add part A: the gaps added from the collected corpora (2026-10-14).
// Run: node --test test/quick-add/gaps-round2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { findGaps, applyAnswer } from '../../vite-app/src/utils/quick-add/gaps.js';
import { smallBlindOptions } from '../../vite-app/src/utils/quick-add/rules-setup.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeDraft } = require('../../lib/quick-add/normalize.js');

const P = (name, position, startingStack) => ({ name, position, startingStack });
const A = (player, action, amount = 0) => ({ player, action, amount });
const St = (name, hero, opponents, board, actions) => ({ name, cards: { hero: hero || '', opponents, board: board || '' }, actions: actions || [], draws: [] });
const e5 = () => ['', '', '', '', ''];
const gap = (h, id) => findGaps(h).find((g) => g.id === id);
const ids = (h) => findGaps(h).map((g) => g.id);

function cash6(bb = 2, sb = 1) {
  return {
    gameType: 'NLH', gameMode: 'cash', currency: 'USD',
    blinds: { sb, bb, ante: 0 },
    players: [P('Lou', 'LJ', 200 * bb), P('Hal', 'HJ', 200 * bb), P('Cid', 'CO', 200 * bb), P('Hero', 'BTN', 200 * bb), P('Sam', 'SB', 200 * bb), P('Bea', 'BB', 200 * bb)],
    heroIdx: 3,
    streets: [
      St('Preflop', 'AsKs', e5(), '', [A(0, 'fold'), A(1, 'fold'), A(2, 'fold'), A(3, 'raise', 3 * bb), A(4, 'fold'), A(5, 'call', 2 * bb)]),
      St('Flop', '', e5(), 'Qh7d2c', [A(5, 'check'), A(3, 'check')]),
      St('Turn', '', e5(), '9s', [A(5, 'check'), A(3, 'check')]),
      St('River', '', e5(), '4h', [A(5, 'check'), A(3, 'check')]),
    ],
    result: { winners: [{ playerIdx: 3, split: false }] },
  };
}

test('small blind options are real stakes, never 0, and include sb = bb', () => {
  assert.deepEqual(smallBlindOptions(0.05), [0.02, 0.05]);
  assert.deepEqual(smallBlindOptions(0.25), [0.1, 0.25]);
  assert.deepEqual(smallBlindOptions(0.5), [0.25, 0.5]);
  assert.deepEqual(smallBlindOptions(1), [0.5, 1]);
  assert.deepEqual(smallBlindOptions(25), [10, 25]);
  assert.deepEqual(smallBlindOptions(5), [2, 3, 5]);
  assert.deepEqual(smallBlindOptions(3000), [1500, 3000]);
  const h = cash6(0.25, 0.1); delete h.blinds.sb;
  assert.deepEqual(gap(h, 'blinds.sb').options.map((o) => o.label), ['0.1/0.25', '0.25/0.25']);
});

test('"6/12k" read as 6 and 12,000 is impossible, with both readings', () => {
  const h = cash6(12000, 6); h.gameMode = 'mtt';
  const g = gap(h, 'blinds.scale');
  assert.ok(g && g.blocking && g.kind === 'impossible');
  assert.deepEqual(g.options.map((o) => o.label), ['6,000/12,000', '6/12']);
  const fixed = applyAnswer(h, g, g.options[0].value);
  assert.deepEqual([fixed.blinds.sb, fixed.blinds.bb], [6000, 12000]);
  assert.ok(!ids(cash6(2, 1)).includes('blinds.scale'));
  assert.ok(!ids(cash6(0.02, 0.01)).includes('blinds.scale'));
});

test('a hand told only in big blinds can be recorded in big blinds', () => {
  const h = cash6(); h.blinds = { ante: 0 };
  h.players.forEach((p) => { p.startingStack = null; p.startingStackBB = 100; });
  h.streets.forEach((st) => st.actions.forEach((a) => { if (a.amount) { a.toAmountBB = a.amount / 2; a.amount = null; } }));
  const g = gap(h, 'blinds.bb');
  assert.equal(g.options[0].label, 'Record it in big blinds (0.5/1)');
  const fixed = applyAnswer(h, g, g.options[0].value);
  assert.deepEqual([fixed.blinds.sb, fixed.blinds.bb], [0.5, 1]);
  assert.equal(fixed.players[0].startingStack, 100);
});

test('an ante of unstated type: per player first when small, and answered both ways', () => {
  const h = cash6(40000, 20000); h.gameMode = 'mtt'; h.blinds.ante = 5000;
  h.quickAdd = { anteUnclear: 5000 };
  const g = gap(h, 'ante-type');
  assert.ok(g && !g.blocking);
  assert.match(g.options[0].label, /^Every player posted 5,000 \(30,000 in all\)/);
  const per = applyAnswer(h, g, g.options[0].value);
  assert.equal(per.blinds.ante, 30000);
  assert.ok(!ids(per).includes('ante-type'));
  const one = applyAnswer(h, g, g.options[1].value);
  assert.equal(one.blinds.ante, 5000);
  assert.ok(!ids(one).includes('ante-type'));
  // Close to the big blind: one big blind ante first.
  h.blinds.ante = 30000; h.quickAdd = { anteUnclear: 30000 };
  assert.match(gap(h, 'ante-type').options[0].label, /^One big blind ante/);
});

test('the hero question has an "I wasn\'t in this hand" answer, then asks whose seat to follow', () => {
  const h = cash6(); delete h.heroIdx;
  h.streets.forEach((s) => { s.cards.hero = ''; });
  const g = gap(h, 'hero');
  const out = g.options[g.options.length - 1];
  assert.equal(out.label, 'I wasn’t in this hand');
  const obs = applyAnswer(h, g, out.value);
  const g2 = gap(obs, 'hero');
  assert.match(g2.question, /Whose seat should the replay follow/);
  assert.equal(g2.options[0].value.heroIdx, 3, 'the winner first');
  const followed = applyAnswer(obs, g2, g2.options[0].value);
  assert.equal(followed.heroIdx, 3);
  assert.equal(followed.quickAdd.observer, true);
});

test('not a hand: one blocking question, and "record it anyway" clears it', () => {
  const h = cash6(); h.quickAdd = { notRecordable: 'a rules question' };
  const g = findGaps(h)[0];
  assert.equal(g.id, 'scope');
  assert.ok(g.blocking && /a rules question/.test(g.question));
  assert.ok(!ids(applyAnswer(h, g, g.options[0].value)).includes('scope'));
});

test('other hands and unsupported formats are said once, and can be dismissed', () => {
  const h = cash6(); h.quickAdd = { otherHands: ['KK vs AA all in'], unsupported: ['a bomb pot'] };
  const g = gap(h, 'hand-choice');
  assert.ok(g && !g.blocking && /2 hands/.test(g.question));
  assert.ok(gap(h, 'unsupported'));
  const d = applyAnswer(h, g, g.options[0].value);
  assert.ok(!ids(d).includes('hand-choice'));
});

test('server questions: shown until answered or their field is filled', () => {
  const draft = {
    notes: [], gameType: 'NLH', gameMode: 'cash', tableSize: 6, othersFolded: true, blinds: { sb: 1, bb: 2, ante: 0 },
    players: [{ position: 'BTN', isHero: true, startingStack: 200 }, { position: 'BB', startingStack: 200 }],
    streets: [
      { name: 'Preflop', cards: [{ player: 0, cards: 'AhQs' }], actions: [{ player: 0, action: 'raise', toAmount: 5 }, { player: 1, action: 'call' }] },
      { name: 'Flop', board: 'Kd8c3h', actions: [{ player: 1, action: 'check' }, { player: 0, action: 'check' }] },
      { name: 'Turn', boardChoices: ['6', '7'], actions: [{ player: 1, action: 'check' }, { player: 0, action: 'check' }] },
    ],
  };
  const { hand } = normalizeDraft(draft);
  const g = gap(hand, 'choice:streets.2.cards.board');
  assert.ok(g && g.blocking);
  const answered = applyAnswer(hand, g, g.options[1].value);
  assert.equal(answered.streets[2].cards.board[0], '7');
  assert.ok(!ids(answered).some((id) => id.startsWith('choice:')));
  assert.ok(!(answered.quickAdd && answered.quickAdd.questions));
  // Filled another way: the question goes too.
  const other = JSON.parse(JSON.stringify(hand)); other.streets[2].cards.board = '6c';
  assert.ok(!ids(other).some((id) => id.startsWith('choice:')));
});

test('postflop checks that went unsaid are filled in without asking', () => {
  const h = cash6();
  h.streets[0].actions = [A(0, 'fold'), A(1, 'fold'), A(2, 'raise', 6), A(3, 'call', 6), A(4, 'fold'), A(5, 'call', 4)];
  h.streets[1].actions = [A(2, 'bet', 10), A(3, 'call', 10), A(5, 'fold')];
  h.streets[2].actions = []; h.streets[2].cards.board = '';
  h.streets[3].actions = []; h.streets[3].cards.board = '';
  const g = gap(h, 'action:1:0');
  assert.ok(g && g.auto && !g.blocking, JSON.stringify(g));
  assert.deepEqual(g.options[0].value.actions, [A(5, 'check')]);
});

test('a group action waiting for the table size is expanded when it is answered', () => {
  const draft = {
    notes: [], gameType: 'NLH', gameMode: 'cash', blinds: { sb: 1, bb: 3, ante: 0 },
    players: [{ position: 'UTG', startingStack: 300 }, { position: 'BB', isHero: true, startingStack: 300 }],
    streets: [{ name: 'Preflop', cards: [{ player: 1, cards: '6h6d' }], actions: [{ player: 0, action: 'raise', toAmount: 15 }, { player: null, action: 'call', group: 'rest' }, { player: 1, action: 'call' }] }],
  };
  const { hand } = normalizeDraft(draft);
  const g = gap(hand, 'table-size');
  const six = g.options.find((o) => o.value.n === 6);
  const seated = applyAnswer(hand, g, six.value);
  assert.deepEqual(seated.streets[0].actions.map((a) => a.action), ['raise', 'call', 'call', 'call', 'call', 'call']);
  assert.deepEqual(seated.streets[0].actions.map((a) => a.amount), [15, 15, 15, 15, 14, 12]);
  assert.ok(!(seated.quickAdd && seated.quickAdd.groups));
});
