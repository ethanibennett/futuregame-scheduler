// The Schedule's active-filter chips and the sheet's section values (utils/filter-chips.js; UX picks 17, 28).
import test from 'node:test';
import assert from 'node:assert/strict';
// shared-filters.js reads the browser's storage when it loads: a stand-in for Node.
globalThis.window = globalThis;
globalThis.location = { origin: 'http://localhost', href: 'http://localhost/', search: '', pathname: '/', hostname: 'localhost', protocol: 'http:' };
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { activeFilterChips, sectionValues } = await import('../filter-chips.js');
const { DEFAULT_FILTERS, clearedFilters } = await import('../shared-filters.js');

test('the defaults are no filters, and the standing choices are never chips', () => {
  assert.deepEqual(activeFilterChips(DEFAULT_FILTERS), []);
  const standing = { ...DEFAULT_FILTERS, showOnline: true, onlyAvailableOnline: false, locationRegion: 'northeast', jurisdiction: 'NJ', siteRules: { acr: { minBuyin: 50 } } };
  assert.deepEqual(activeFilterChips(standing), []);
});

test('each filter that is on is a chip that removes itself', () => {
  const f = { ...DEFAULT_FILTERS, selectedGames: ['PLO', 'NLH'], bountyOnly: true, buyinRanges: ['1500-5000'], hiddenVenues: ['A', 'B'], hideSatellites: false, dateFrom: '2026-11-12', dateTo: '2026-11-20' };
  const chips = activeFilterChips(f);
  assert.deepEqual(chips.map((c) => c.label), ['PLO', 'NLH', 'Bounty', '$1.5K–$5K', '2 series off', 'Nov 12–Nov 20', 'Satellites']);
  let g = f;
  for (const c of chips) g = c.remove(g);
  assert.deepEqual(activeFilterChips(g), []);
  // and nothing else moved
  assert.deepEqual(clearedFilters(g), clearedFilters(f));
});

test('the sheet says what each section holds', () => {
  const v = sectionValues({ ...DEFAULT_FILTERS, selectedGames: ['PLO', 'O8'], hiddenVenues: ['x'], ladiesOnly: true, headsUpOnly: true }, { venueCount: 88, onlineRoomCount: 4 });
  assert.equal(v.variant, 'PLO, O8');
  assert.equal(v.series, '87 of 88');
  assert.equal(v.buyin, 'Any');
  assert.equal(v.special, 'Heads Up');
  assert.equal(v.online, 'All 4 rooms');
  assert.equal(sectionValues(DEFAULT_FILTERS, { venueCount: 3 }).series, 'All 3');
});
