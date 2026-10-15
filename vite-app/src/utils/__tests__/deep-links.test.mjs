// node --test src/utils/__tests__/deep-links.test.mjs  (from vite-app/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeepLink } from '../deep-links.js';

test('the hash routes the dashboard app can open', () => {
  assert.deepEqual(parseDeepLink('#bankroll/overview'), { view: 'tracking', bankrollTab: 'overview' });
  assert.deepEqual(parseDeepLink('#bankroll'), { view: 'tracking', bankrollTab: 'balance' });
  assert.deepEqual(parseDeepLink('#bankroll/import'), { view: 'tracking', bankrollTab: 'data' });
  assert.deepEqual(parseDeepLink('#bankroll/nonsense'), { view: 'tracking', bankrollTab: 'balance' });
  assert.deepEqual(parseDeepLink('#results/tournaments'), { view: 'tracking' });
  assert.deepEqual(parseDeepLink('#results/cash'), { view: 'cash' });
  assert.deepEqual(parseDeepLink('#staking'), { view: 'staking', standing: false });
  assert.deepEqual(parseDeepLink('#staking/standing'), { view: 'staking', standing: true });
  assert.deepEqual(parseDeepLink('#expenses'), { view: 'tracking', expenses: true });
  assert.deepEqual(parseDeepLink('#tax'), { view: 'tracking', tax: true });
  assert.equal(parseDeepLink('#h/abc'), null);
  assert.equal(parseDeepLink('#reset?token=x'), null);
  assert.equal(parseDeepLink(''), null);
  assert.equal(parseDeepLink('#something'), null);
});
