// node --test vite-app/src/utils/__tests__/wordmark-dot.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { dotGeometry, DOT_SPACE_EM, saneDotGeometry } from '../wordmark-dot.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

// Libre Baskerville bold as WebKit draws it (read off the canvas, 2026-11-20): the a's tail reaches 0.57em in the
// dot's rows, past its 0.554em advance; the m's ink starts 0.02em in; the period's ink runs 0.05 to 0.215em.
const BASKERVILLE = { aAdv: 0.554, aRight: 0.57, mLeft: 0.02, dotAdv: 0.265, dotLeft: 0.05, dotRight: 0.215, tracking: -0.05 };

test('the dot has the same clear space to the a as to the m', () => {
  const { gap, dotX } = dotGeometry(BASKERVILLE);
  // Laid out from where "me" starts at rest: the a's ink ends at aInk, the m's starts at gap + mLeft.
  const aInk = BASKERVILLE.aRight - BASKERVILLE.aAdv - BASKERVILLE.tracking;
  const dotAtRest = -BASKERVILLE.dotAdv / 2 + (BASKERVILLE.dotLeft + BASKERVILLE.dotRight) / 2;
  const half = (BASKERVILLE.dotRight - BASKERVILLE.dotLeft) / 2;
  const dotMid = dotAtRest + dotX;
  near(dotMid - half - aInk, DOT_SPACE_EM);
  near(gap + BASKERVILLE.mLeft - (dotMid + half), DOT_SPACE_EM);
});

test('Baskerville lands on the figures tuned by eye from the pixels', () => {
  const { gap, dotX } = dotGeometry(BASKERVILLE);
  near(gap, 0.311, 0.006);    // 0.3067em measured on a 120px frame
  near(dotX, 0.1985, 0.002);  // 0.1992em
});

test('a wider space opens the room by twice as much and moves the dot by the space', () => {
  const a = dotGeometry(BASKERVILLE);
  const b = dotGeometry({ ...BASKERVILLE, space: DOT_SPACE_EM + 0.02 });
  near(b.gap - a.gap, 0.04);
  near(b.dotX - a.dotX, 0.02);
});

test('tighter tracking pulls the a in, so the room and the dot both move by it', () => {
  const a = dotGeometry(BASKERVILLE);
  const b = dotGeometry({ ...BASKERVILLE, tracking: -0.07 });
  near(b.gap - a.gap, 0.02);
  near(b.dotX - a.dotX, 0.02);
});

// A canvas read back with noise (Safari's fingerprinting protection) gave a gap of a word's width (owner's video,
// 2026-11-27): a geometry no face has is refused, and the CSS's Baskerville values stand.
test('a measured geometry is used only when a face could have it', () => {
  const ok = dotGeometry(BASKERVILLE);
  assert.deepEqual(saneDotGeometry({ ...ok, base: 0.35, originY: 0.3 }), { ...ok, base: 0.35, originY: 0.3 });
  assert.equal(saneDotGeometry({ ...ok, gap: 2.6 }), null, 'me a word away');
  assert.equal(saneDotGeometry({ ...ok, gap: -0.4 }), null, 'me back over the a');
  assert.equal(saneDotGeometry({ ...ok, dotX: 1.9 }), null, 'the dot off past the m');
  assert.equal(saneDotGeometry({ ...ok, gap: NaN }), null);
  assert.equal(saneDotGeometry(null), null);
  assert.equal(saneDotGeometry({ ...ok, base: 3, originY: -2 }).base, null, 'a wild baseline falls back alone');
});
