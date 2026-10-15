// The live-only defaults (launch plan, 2026-10-15): a new browser starts with online events off and
// "available in my state" on; a browser that used the app before keeps what it saw. Once per browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { location: { origin: 'http://test.local' }, dispatchEvent: () => true };   // api.js reads window at load
const P = await import('../location-prefs.js');

test('a brand-new browser writes nothing and gets the new defaults', () => {
  store.clear();
  assert.equal(P.migrateLiveOnlyDefaults(), 'new');
  assert.equal(P.readLocalFilters(), null);
  assert.equal(P.migrateLiveOnlyDefaults(), 'done', 'once only');
});

test('a browser with saved filters keeps online on and the state filter off', () => {
  store.clear();
  store.set('savedFilters', JSON.stringify({ hideSideEvents: true }));
  assert.equal(P.migrateLiveOnlyDefaults(), 'kept');
  assert.deepEqual(P.readLocalFilters(), { hideSideEvents: true, showOnline: true, onlyAvailableOnline: false });
});

test('a browser that chose live only, or the state filter, keeps that choice', () => {
  store.clear();
  store.set('savedFilters', JSON.stringify({ showOnline: false, onlyAvailableOnline: true }));
  assert.equal(P.migrateLiveOnlyDefaults(), 'kept');
  assert.deepEqual(P.readLocalFilters(), { showOnline: false, onlyAvailableOnline: true });
});

test('finished setup or a saved location counts as earlier use', () => {
  for (const [k, v] of [['onboarded', '1'], ['savedLocation', '{"maxDistance":"100"}']]) {
    store.clear(); store.set(k, v);
    assert.equal(P.migrateLiveOnlyDefaults(), 'kept', k);
    assert.deepEqual(P.readLocalFilters(), { showOnline: true, onlyAvailableOnline: false });
  }
});
