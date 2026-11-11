// Odds and the deal calculator (Features 34, 35): the catalogue's measured figures, by the app's own engine.
import assert from 'node:assert';
import test from 'node:test';
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis.window || globalThis;
const { computeOdds, icm, chipChop } = await import('../odds.js');

test('ICM and the chip chop on the catalogue final table', () => {
  const st = [1840000, 1215000, 690000, 355000], pz = [52400, 33100, 22600, 16050];
  assert.deepStrictEqual(icm(st, pz).map(Math.round), [39017, 34151, 28228, 22753]);
  assert.deepStrictEqual(chipChop(st, pz).map(Math.round), [42954, 33816, 26139, 21241]);
});

test('PLO 8/b on a flop: every run-out, the shares and scoops measured', () => {
  const r = computeOdds('PLO8', ['As2s3dKd', 'AhKhQcJc'], '4s5dTh');
  assert.strictEqual(r.exact, true);
  assert.strictEqual(r.runs, 820);
  assert.deepStrictEqual(r.players.map((p) => +(p.equity * 100).toFixed(1)), [73.7, 26.3]);
  assert.deepStrictEqual(r.players.map((p) => +(p.scoop * 100).toFixed(1)), [51.8, 11.3]);
});

test('a card written twice, or a wrong count, is refused', () => {
  assert.ok(computeOdds('NLH', ['AsKd', 'AsQc'], '').error);
  assert.ok(computeOdds('PLO', ['AsKd', 'QcJc'], '').error);
});
