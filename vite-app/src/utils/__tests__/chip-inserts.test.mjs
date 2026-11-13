import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chipInsertAngles, chipSide, chipRim, chipInsertVars, CHIP_FACE_K } from '../chip-inserts.js';

const stops = s => [...s.matchAll(/#f4f1ea ([\d.]+)(%|deg) ([\d.]+)(%|deg)/g)].map(m => [+m[1], +m[3]]);

test('six inserts a sixth of a turn apart', () => {
  const a = chipInsertAngles(0.1);
  assert.equal(a.length, 6);
  for (let j = 1; j < 6; j++) assert.ok(Math.abs(a[j] - a[j - 1] - Math.PI / 3) < 1e-9);
});

test('each side band sits under its rim arc where the face meets the side', () => {
  for (const pip of [0, 0.05, 0.13, 0.2, 0.3333]) {
    const side = stops(chipSide(pip));
    const rim = stops(chipRim(pip));
    assert.ok(side.length >= 2 && side.length <= 4, `${side.length} bands at ${pip}`);
    // A side band's centre, as an angle on the face's front half, falls inside one of the rim arcs.
    for (const [a, b] of side) {
      const x = (a + b) / 100 - 1; // -1..1 across the chip
      const th = Math.asin(Math.max(-1, Math.min(1, x)));
      const deg = (Math.atan2(Math.sin(th), -CHIP_FACE_K * Math.cos(th)) * 180 / Math.PI + 360) % 360;
      assert.ok(rim.some(([p, q]) => deg >= p - 0.02 && deg <= q + 0.02), `band at ${x.toFixed(2)} (${deg.toFixed(1)}deg) has no arc, pip ${pip}`);
    }
  }
});

test('the same turn always draws the same chip, and the vars are valid gradients', () => {
  assert.deepEqual(chipInsertVars(0.2), chipInsertVars('0.2000'));
  const v = chipInsertVars(0);
  assert.match(v['--chip-side'], /^linear-gradient\(90deg, /);
  assert.match(v['--chip-rim'], /^conic-gradient\(/);
  // the arcs never run backwards
  for (const [a, b] of stops(v['--chip-rim'])) assert.ok(a <= b && a >= 0 && b <= 360);
  // six inserts of 0.32 rad each: the arcs cover well under half the rim, never all of it
  for (const pip of [0, 0.1, 0.25]) {
    const total = stops(chipRim(pip)).reduce((s, [a, b]) => s + b - a, 0);
    assert.ok(total > 60 && total < 140, `rim covers ${total}deg at ${pip}`);
  }
});
