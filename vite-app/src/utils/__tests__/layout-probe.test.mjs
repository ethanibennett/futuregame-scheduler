// node --test src/utils/__tests__/layout-probe.test.mjs  (from vite-app/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { outOfBands } from '../layout-probe.js';

const band = { W: 402, H: 874, top: 62, bottom: 34 };
const r = (top, bottom, left = 100, right = 200) => ({ sel: 'x', top, bottom, left, right });

test('a piece under the clock, on the home bar or off a side is out; one inside the bands is in', () => {
  assert.deepEqual(outOfBands([r(77, 142)], band), []);
  assert.equal(outOfBands([r(21, 86)], band).length, 1);          // the owner's screenshot: cards under the clock
  assert.equal(outOfBands([r(800, 866)], band).length, 1);        // buttons on the home bar
  assert.equal(outOfBands([r(300, 340, -4, 80)], band).length, 1);
  assert.equal(outOfBands([r(300, 340, 330, 406)], band).length, 1);
});

test('half a pixel of rounding is allowed', () => {
  assert.deepEqual(outOfBands([r(61.6, 100), r(700, 840.4)], band), []);
  assert.equal(outOfBands([r(61.4, 100)], band).length, 1);
});
