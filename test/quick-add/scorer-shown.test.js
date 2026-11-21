// The eval's `shown` expectation (2026-11-21): cards an opponent shows whose seat the text never
// gives, scored as "some opponent holds them" and never counted as invented. Run with
// `node test/quick-add/scorer-shown.test.js` (part of npm run test:quick-add). No API.
'use strict';
const assert = require('assert');
const path = require('path');
const E = require('./eval.js');

const { cases } = E.loadCorpus(path.join(__dirname, 'corpus'));

const byId = (id) => cases.find((c) => c.id === id);

function scored(id, edit) {
  const c = byId(id);
  assert.ok(c, id);
  const v = E.validateCase(c, new Map());
  assert.deepStrictEqual(v.errors, [], id);
  const hand = E.buildOracleHand(c, v);
  if (edit) edit(hand);
  const s = E.scoreCase(c, v, hand);
  return { s, facts: Object.fromEntries(s.facts.map((f) => [f.key, f])) };
}
const oppSlot = (hand) => hand.streets[0].cards.opponents.findIndex((x) => x);

// The oracle: every shown hand on a seat of its own, all facts right, nothing invented.
{
  const { s, facts } = scored('web-rigged-rant-jj-vs-j5-555');
  assert.strictEqual(facts['shown.0'].status, 'ok');
  assert.deepStrictEqual([s.hallucinations.cards, s.hallucinations.suits], [[], []]);
}
// A parse that seats the opponent and picks suits: the fact holds, the suits are invented, no card is.
{
  const { s, facts } = scored('web-rigged-rant-jj-vs-j5-555', (h) => {
    h.streets[0].cards.hero = 'JcJd';
    h.streets[0].cards.opponents[oppSlot(h)] = 'Js5h';
    h.streets[1].cards.board = '5c5d5s';
  });
  assert.strictEqual(facts['shown.0'].status, 'ok');
  assert.deepStrictEqual(s.hallucinations.cards, []);
  assert.strictEqual(s.hallucinations.suits.length, 7); // JJ, J5 and 555: every suit was picked by the parse
}
// The wrong cards: the fact is wrong and the card the text never named is invented.
{
  const { s, facts } = scored('web-rigged-rant-jj-vs-j5-555', (h) => { h.streets[0].cards.opponents[oppSlot(h)] = 'Qs5h'; });
  assert.strictEqual(facts['shown.0'].status, 'wrong');
  assert.deepStrictEqual(s.hallucinations.cards, ['Qs']);
}
// No opponent cards at all: the fact is missing. (The oracle seats no hero for a case with no hero seat,
// so seat 0's slot is cards.hero and would read as an opponent's: clear it too.)
{
  const { facts } = scored('web-rigged-rant-jj-vs-j5-555', (h) => {
    h.streets[0].cards.hero = '';
    h.streets[0].cards.opponents = h.streets[0].cards.opponents.map(() => '');
  });
  assert.strictEqual(facts['shown.0'].status, 'missing');
}
// Three shown hands on a hero-less hand: each needs its own opponent, in any seat order.
{
  const { facts } = scored('sp-commentary-several-hands-not-one', (h) => {
    const all = [h.streets[0].cards.hero, ...h.streets[0].cards.opponents];
    const filled = all.filter(Boolean).reverse();
    h.streets[0].cards.hero = filled[0] || '';
    h.streets[0].cards.opponents = h.streets[0].cards.opponents.map((_, i) => filled[i + 1] || '');
  });
  assert.deepStrictEqual(['shown.0', 'shown.1', 'shown.2'].map((k) => facts[k].status), ['ok', 'ok', 'ok']);
}
// The validator: stud has door-card refs instead, and a shown hand must be a whole holding.
{
  const base = byId('web-rigged-rant-jj-vs-j5-555');
  const v = E.validateCase({ ...base, id: 'x-shown-short', expect: { ...base.expect, shown: ['Jx'] } }, new Map());
  assert.ok(v.errors.some((e) => /shown\[0\] has 1 cards/.test(e)), v.errors.join('; '));
}
console.log('scorer-shown.test.js - passed (a shown hand is one fact on any unseated opponent, never an invented card)');
