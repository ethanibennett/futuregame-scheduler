// node --test src/utils/__tests__/detail-motion.test.mjs  (from vite-app/)
// The desktop event details' open/close move (utils/detail-motion.js planMove): where each move
// starts and ends, and the share of the duration it takes, for the whole moves and the interrupted
// ones the verifier found jumping (2026-10-12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { planMove, rLen, EPS_R } from '../detail-motion.js';

const H = 24.5; // a block's natural height, r

test('a fresh open runs 0 -> its own natural height, 0 -> 1, over the whole duration', () => {
  const p = planMove({ fromH: 0, fromO: 0, dir: 'open', naturalH: H });
  assert.deepEqual(p, { fromH: 0, fromO: 0, toH: H, toO: 1, frac: 1, instant: false });
});

test('a close from settled open is the mirror: natural height -> 0, 1 -> 0, the whole duration', () => {
  const p = planMove({ fromH: H, fromO: 1, dir: 'close', naturalH: H });
  assert.deepEqual(p, { fromH: H, fromO: 1, toH: 0, toO: 0, frac: 1, instant: false });
});

test('the close ends at 0: nothing (no padding) floors it', () => {
  assert.equal(planMove({ fromH: H, fromO: 1, dir: 'close', naturalH: H }).toH, 0);
});

test('closing mid-open starts where the open is, in height AND opacity, and takes the share left', () => {
  // the open 40% of the way: 9.8r tall at opacity 0.4
  const p = planMove({ fromH: 0.4 * H, fromO: 0.4, dir: 'close', naturalH: H });
  assert.equal(p.fromH, 0.4 * H);
  assert.equal(p.fromO, 0.4);      // not snapped back to 1
  assert.equal(p.toH, 0);
  assert.equal(p.frac, 0.4);       // as fast as a whole close runs
});

test('reopening mid-close continues from the current height, not from 0', () => {
  const p = planMove({ fromH: 0.25 * H, fromO: 0.25, dir: 'open', naturalH: H });
  assert.equal(p.fromH, 0.25 * H);
  assert.equal(p.fromO, 0.25);
  assert.equal(p.toH, H);
  assert.equal(p.frac, 0.75);
});

test('another event mid-close grows from the current height to ITS natural height', () => {
  const HB = 31;
  const p = planMove({ fromH: 10, fromO: 0.4, dir: 'open', naturalH: HB });
  assert.equal(p.fromH, 10);
  assert.equal(p.toH, HB);
  assert.equal(p.frac, Math.round(((HB - 10) / HB) * 10000) / 10000);
});

test('the opacity still to travel sets the share when it is the larger', () => {
  // height nearly there, opacity far from it: the move takes the opacity's share
  const p = planMove({ fromH: H - 0.5, fromO: 0.2, dir: 'open', naturalH: H });
  assert.equal(p.frac, 0.8);
});

test('nothing to travel is instant (no transition would run, so none can be waited for)', () => {
  assert.equal(planMove({ fromH: 0, fromO: 0, dir: 'close', naturalH: H }).instant, true);
  assert.equal(planMove({ fromH: H, fromO: 1, dir: 'open', naturalH: H }).instant, true);
  assert.equal(planMove({ fromH: EPS_R / 2, fromO: 0, dir: 'close', naturalH: H }).instant, true);
  assert.equal(planMove({ fromH: 0, fromO: 0, dir: 'close', naturalH: H }).frac, 0);
});

test('a block taller than its natural height (its content shrank) closes over the whole duration', () => {
  const p = planMove({ fromH: 30, fromO: 1, dir: 'close', naturalH: 20 });
  assert.equal(p.frac, 1);
  assert.equal(p.toH, 0);
});

test('bad input is clamped, never NaN', () => {
  const p = planMove({ fromH: NaN, fromO: 7, dir: 'open', naturalH: -3 });
  assert.equal(p.fromH, 0);
  assert.equal(p.fromO, 1);
  assert.equal(p.toH, 0);
  assert.ok(Number.isFinite(p.frac));
});

test('lengths are written in r', () => {
  assert.equal(rLen(12.34567), 'calc(var(--subrow) * 12.3457)');
  assert.equal(rLen(0), 'calc(var(--subrow) * 0)');
});
