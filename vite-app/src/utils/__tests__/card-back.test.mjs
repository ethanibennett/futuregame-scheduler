// The card back preference (utils/card-back.js): what a stored or seeded value resolves to, which designs a viewer may
// choose (BTG's only with the registration code's unlock, owner 2026-11-21), and the root attribute every face-down
// card's CSS reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_BACKS, availableCardBacks, normalizeCardBack, applyCardBack, unlockedCardBacks } from '../card-back.js';

test('the designs are the standard back and BTG, BTG behind its code', () => {
  assert.deepEqual(CARD_BACKS.map(b => b.id), ['standard', 'btg']);
  assert.equal(CARD_BACKS.find(b => b.id === 'btg').code, 'BTG');
});

test('BTG is offered only when the account unlocked it', () => {
  assert.deepEqual(availableCardBacks([]).map(b => b.id), ['standard']);
  assert.deepEqual(availableCardBacks(['btg']).map(b => b.id), ['standard', 'btg']);
  assert.deepEqual(unlockedCardBacks(), [], 'no storage (node): nothing unlocked');
});

test('anything unknown, missing, stale or locked reads as the standard back', () => {
  assert.equal(normalizeCardBack('btg', ['btg']), 'btg');
  assert.equal(normalizeCardBack('btg', []), 'standard', 'chosen on this device under another account');
  assert.equal(normalizeCardBack('btg'), 'standard', 'no unlock stored');
  assert.equal(normalizeCardBack('standard', []), 'standard');
  for (const v of [null, undefined, '', 'BTG', 'weave', 'classic']) assert.equal(normalizeCardBack(v, ['btg']), 'standard');
});

test('BTG sets data-card-back on the root when unlocked; otherwise, and for the standard back, it is removed', () => {
  const root = { dataset: {} };
  applyCardBack('btg', root, ['btg']);
  assert.equal(root.dataset.cardBack, 'btg');
  applyCardBack('standard', root, ['btg']);
  assert.equal('cardBack' in root.dataset, false);
  applyCardBack('btg', root, ['btg']);
  applyCardBack('something-old', root, ['btg']);
  assert.equal('cardBack' in root.dataset, false);
  applyCardBack('btg', root, ['btg']);
  applyCardBack('btg', root, []);
  assert.equal('cardBack' in root.dataset, false, 'signed out of the BTG account: the standard back');
});
