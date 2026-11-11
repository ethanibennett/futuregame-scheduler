// The rules sheet's halves come from the engine (Features 33): every built row has rules, and a split game
// names two halves exactly when the engine scores two.
import assert from 'node:assert';
import test from 'node:test';
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis.window || globalThis;
const { buildCatalog } = await import('../variant-catalog.js');
const { rulesFor } = await import('../game-rules.js');
const { gameEvalFor } = await import('../poker-engine.js');

test('every row has a structure, an order of play and how the pot is won', () => {
  for (const row of buildCatalog()) {
    const r = rulesFor(row);
    assert.ok(r && r.structure && r.order.length >= 3 && r.halves.length >= 1, row.key);
  }
});

test('two halves exactly where the engine scores two', () => {
  for (const row of buildCatalog()) {
    const cfg = gameEvalFor(row.gameType, {});
    const two = !!cfg && ['hilo', 'split-badugi', 'halves'].includes(cfg.type);
    assert.strictEqual(rulesFor(row).halves.length === 2, two, row.key);
  }
});
