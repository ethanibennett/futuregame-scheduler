// The card back preference (utils/card-back.js): what a stored or seeded value resolves to, and the root attribute
// every face-down card's CSS reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_BACKS, normalizeCardBack, applyCardBack } from '../card-back.js';

test('the designs are the standard back and BTG', () => {
  assert.deepEqual(CARD_BACKS.map(b => b.id), ['standard', 'btg']);
});

test('anything unknown, missing or stale reads as the standard back', () => {
  assert.equal(normalizeCardBack('btg'), 'btg');
  assert.equal(normalizeCardBack('standard'), 'standard');
  for (const v of [null, undefined, '', 'BTG', 'weave', 'classic']) assert.equal(normalizeCardBack(v), 'standard');
});

test('BTG sets data-card-back on the root, the standard back removes it', () => {
  const root = { dataset: {} };
  applyCardBack('btg', root);
  assert.equal(root.dataset.cardBack, 'btg');
  applyCardBack('standard', root);
  assert.equal('cardBack' in root.dataset, false);
  applyCardBack('btg', root);
  applyCardBack('something-old', root);
  assert.equal('cardBack' in root.dataset, false);
});
