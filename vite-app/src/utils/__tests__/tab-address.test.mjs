// Tabs have addresses (App improvements 453).
import test from 'node:test';
import assert from 'node:assert/strict';
import { tabHash, viewFromHash } from '../tab-address.js';
import { parseDeepLink } from '../deep-links.js';

test('each tab has an address and the address names the tab', () => {
  for (const v of ['dashboard', 'tournaments', 'schedule', 'calendar', 'tracking', 'hands', 'social', 'settings']) {
    assert.equal(viewFromHash(tabHash(v)), v, v);
  }
  assert.equal(tabHash('admin'), null);
  assert.equal(viewFromHash('#h/abc'), null);
  assert.equal(viewFromHash('#reset?token=1'), null);
});

test('a tab address is no admin deep link, and the deep links keep their meaning', () => {
  assert.equal(parseDeepLink(tabHash('tracking')), null);
  assert.deepEqual(parseDeepLink('#bankroll'), { view: 'tracking', bankrollTab: 'balance' });
});
