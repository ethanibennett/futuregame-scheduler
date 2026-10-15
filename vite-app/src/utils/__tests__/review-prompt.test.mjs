import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextReviewState } from '../review-prompt.js';

const DAY = 864e5;
test('asks on the third save, once; again on a bag only after 120 days', () => {
  let s = null; const asks = [];
  for (let i = 1; i <= 5; i++) { const r = nextReviewState(s, 'saved', 1000 * i); s = r.state; asks.push(r.ask); }
  assert.deepEqual(asks, [false, false, true, false, false]);
  assert.equal(nextReviewState(s, 'bagged', 10 * DAY).ask, false, 'too soon after the last ask');
  assert.equal(nextReviewState(s, 'bagged', 121 * DAY).ask, true);
});

test('never within an hour of a bust', () => {
  let s = nextReviewState(null, 'busted', 500 * DAY).state;
  assert.equal(nextReviewState(s, 'bagged', 500 * DAY + 60e3).ask, false);
  assert.equal(nextReviewState(s, 'bagged', 500 * DAY + 2 * 3600e3).ask, true);
});
