// node --test src/utils/__tests__/line-shape.test.mjs   (from vite-app/)
// The graphs' three line shapes (utils/line-shape.js): steps, lines and monotone Bézier curves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapePath } from '../line-shape.js';

const K = [[0, 10], [2, 4], [5, 4], [7, 12], [10, 12]];
const nums = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number);

test('steps hold the value until the next point, then jump', () => {
  assert.equal(shapePath([[0, 1], [2, 3]], 'steps'), 'M0,1 L2,1 L2,3');
});

test('lines go straight from point to point', () => {
  assert.equal(shapePath([[0, 1], [2, 3], [4, 0]], 'lines'), 'M0,1 L2,3 L4,0');
});

test('curves pass through every point and never go past their neighbours', () => {
  const d = shapePath(K, 'curves');
  assert.ok(d.startsWith('M0,10'));
  for (const [x, y] of K) assert.ok(d.includes(`${x},${y}`), `passes through ${x},${y}`);
  // Every control point's y lies between the y of the segment's two ends (monotone: no overshoot).
  const segs = d.split(' C').slice(1).map((s) => nums(s));
  segs.forEach((c, i) => {
    const [y0, y1] = [K[i][1], K[i + 1][1]];
    const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
    for (const y of [c[1], c[3]]) assert.ok(y >= lo - 1e-9 && y <= hi + 1e-9, `segment ${i} control y ${y} within ${lo}..${hi}`);
  });
});

test('a flat run stays flat, and two points on one x are a vertical jump', () => {
  const d = shapePath([[0, 5], [2, 5], [2, 8], [4, 8]], 'curves');
  assert.ok(d.includes('L2,8'), d);
  assert.ok(d.includes('C0.667,5 1.333,5 2,5'), d);
});

test('a second edge continues a path (move: false) and runs right to left', () => {
  const d = shapePath([[4, 1], [0, 3]], 'curves', { move: false });
  assert.ok(d.startsWith('L4,1 C'));
});

test('nothing to draw draws nothing; one point is a move', () => {
  assert.equal(shapePath([], 'curves'), '');
  assert.equal(shapePath([[1, 2]], 'lines'), 'M1,2');
});
