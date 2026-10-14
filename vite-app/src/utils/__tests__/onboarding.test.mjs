// node --test src/utils/__tests__/onboarding.test.mjs   (from vite-app/; or `npm run test:onboarding` from the root)
// First-run setup's pure logic (utils/onboarding.js): old answers read back into the new controls,
// what is written for which rows, state inference and its precedence, the B1 repair, the live
// count, and the game / buy-in tests moved out of TournamentsView.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// utils.js reads localStorage at module scope and api.js reads window; stub both (dynamic imports
// below, because a static import is hoisted above the stubs).
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
const events = [];
globalThis.window = { location: { origin: 'http://test.local' }, dispatchEvent: (e) => { events.push(e); return true; } };
if (typeof globalThis.CustomEvent !== 'function') {
  globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
}

const O = await import('../onboarding.js');
const U = await import('../utils.js');
const P = await import('../location-prefs.js');

const PHILLY = { lat: 39.9526, lng: -75.1652 };

// ── answersFrom: every answer the old wizard could have stored ──────────────────────────────────
// The old wizard's GAME_CHOICES and BUYIN_CHOICES, verbatim, and its location writes.
const OLD_GAMES = {
  holdem: { selectedGames: ['NLH'], mixedOnly: false },
  holdem_plo: { selectedGames: ['NLH', 'PLO'], mixedOnly: false },
  mixed: { selectedGames: [], mixedOnly: true },
  all: { selectedGames: [], mixedOnly: false },
};
const OLD_BUYINS = { low: ['0-500'], mid: ['500-1500'], high: ['1500-5000'], roller: ['5000-10000', '10000+'], any: [] };

test('answersFrom: each old games answer maps onto the chips', () => {
  const want = { holdem: ['NLH'], holdem_plo: ['NLH', 'PLO'], mixed: ['Mixed'], all: [] };
  for (const [k, f] of Object.entries(OLD_GAMES)) {
    assert.deepEqual(O.answersFrom(null, f).games, want[k], k);
    assert.deepEqual(O.answersFrom(null, f).gameExtras, [], k);
  }
});

test("answersFrom: each old buy-in answer maps onto the chips ('High roller' -> $5K+)", () => {
  const want = { low: ['low'], mid: ['mid'], high: ['high'], roller: ['roller'], any: [] };
  for (const [k, ranges] of Object.entries(OLD_BUYINS)) assert.deepEqual(O.answersFrom(null, { buyinRanges: ranges }).buyins, want[k], k);
  // One of the two top bands alone (set in the filter sheet) still lights $5K+.
  assert.deepEqual(O.answersFrom(null, { buyinRanges: ['10000+'] }).buyins, ['roller']);
});

test('answersFrom: location variants', () => {
  // Old "Use my location": a 100-mile point labelled Current Location, the state in capitals (B1).
  const cur = O.answersFrom({ userLocation: PHILLY, maxDistance: '100', locationRegion: null, locationLabel: 'Current Location', jurisdiction: 'PENNSYLVANIA', jurisdictionManual: true }, null);
  assert.equal(cur.place.kind, 'current');
  assert.equal(cur.radius, '100');
  assert.equal(cur.jurisdiction, 'PA');
  assert.equal(cur.jurisdictionManual, false, 'a repaired state came from a lookup');
  const pt = O.answersFrom({ userLocation: { lat: 30.27, lng: -97.74 }, maxDistance: '30', locationLabel: 'Austin, Texas, US' }, null);
  assert.deepEqual([pt.place.kind, pt.place.label, pt.radius], ['point', 'Austin, Texas, US', '30']);
  const reg = O.answersFrom({ userLocation: null, maxDistance: '', locationRegion: 'lasvegas', locationLabel: null }, null);
  assert.deepEqual([reg.place.kind, reg.place.region, reg.country], ['region', 'lasvegas', 'US']);
  assert.equal(O.answersFrom({ locationRegion: 'europe' }, null).country, 'other');
  const none = O.answersFrom(null, null);
  assert.deepEqual([none.place.kind, none.radius, none.jurisdiction, none.online], ['everywhere', '100', null, true]);
  // Old "Everywhere" + a state: no place, the state kept as picked.
  const st = O.answersFrom({ userLocation: null, maxDistance: '', locationRegion: null, locationLabel: null, jurisdiction: 'NV', jurisdictionManual: true }, null);
  assert.deepEqual([st.place.kind, st.jurisdiction, st.jurisdictionManual], ['everywhere', 'NV', true]);
});

test('answersFrom: online, the sites default, and filter-sheet extras', () => {
  assert.equal(O.answersFrom(null, { showOnline: false }).online, false);
  assert.equal(O.answersFrom(null, {}).online, true);
  assert.equal(O.answersFrom(null, {}, { firstRun: true }).onlyAvailable, true, 'first run: on');
  assert.equal(O.answersFrom(null, {}, { firstRun: false }).onlyAvailable, false, 're-run: off');
  assert.equal(O.answersFrom(null, { onlyAvailableOnline: false }, { firstRun: true }).onlyAvailable, false, 'stored wins');
  const x = O.answersFrom(null, { selectedGames: ['NLH', 'Razz', 'O8'] });
  assert.deepEqual(x.games, ['NLH']);
  assert.deepEqual(x.gameExtras, ['Razz', 'O8']);
});

// Launch plan (13 Oct): online events are off until the player says yes in setup.
test('answersFrom: a first run starts at No online; a re-run shows what is stored', () => {
  assert.equal(O.answersFrom(null, null, { firstRun: true }).online, false, 'first run, nothing saved: No');
  assert.equal(O.answersFrom(null, {}, { firstRun: true }).online, false, 'first run, filters saved without the key: No');
  assert.equal(O.answersFrom(null, { showOnline: false }, { firstRun: true }).online, false);
  assert.equal(O.answersFrom(null, { showOnline: true }, { firstRun: true }).online, true, 'an explicit stored yes stands');
  assert.equal(O.answersFrom(null, null, { firstRun: false }).online, true, 're-run, nothing stored: the list shows online today, so Yes');
  assert.equal(O.answersFrom(null, { showOnline: false }, { firstRun: false }).online, false, 're-run: No stays No');
});

test('withFirstRunRows: step 2 is always answered on a first run; the sites filter where a state is known', () => {
  const none = O.answersFrom(null, null, { firstRun: true });
  assert.deepEqual(O.withFirstRunRows(none, { place: true }), { place: true, online: true }, 'no state: online only');
  const nv = O.chooseRegion(none, 'lasvegas');
  assert.deepEqual(O.withFirstRunRows(nv, {}), { online: true, sites: true }, 'a state worked out: the sites filter is answered too');
  assert.equal(O.sitesApply(nv), true);
  assert.equal(O.sitesShown(nv), false, 'but its checkbox waits for a Yes');
  assert.equal(O.sitesApply(O.chooseRegion(none, 'europe')), false, 'abroad: no state, no filter');
  // What an untouched first run writes: online off, and the sites filter on in Nevada.
  const rows = O.withFirstRunRows(nv, {});
  assert.deepEqual(O.filtersFrom(nv, null, rows), { showOnline: false, onlyAvailableOnline: true });
  assert.deepEqual(O.filtersFrom(none, null, O.withFirstRunRows(none, {})), { showOnline: false });
  // Tapping Yes writes nothing for online (true is the Schedule's default) and keeps the filter.
  assert.deepEqual(O.filtersFrom({ ...nv, online: true }, null, rows), { onlyAvailableOnline: true });
  assert.deepEqual(O.wizardSubset(O.filtersFrom(none, { hideSideEvents: true }, O.withFirstRunRows(none, {}))), { showOnline: false });
});

// ── filtersFrom ────────────────────────────────────────────────────────────────────────────────
const PREV = { selectedGames: ['Razz'], mixedOnly: true, siteRules: { acr: { minBuyin: 50 } }, hideSideEvents: true, showOnline: false, buyinRanges: ['0-500'] };

test('filtersFrom: untouched rows are written back unchanged, other keys kept', () => {
  const a = O.answersFrom(null, PREV);
  assert.deepEqual(O.filtersFrom(a, PREV, {}), PREV);
  const out = O.filtersFrom({ ...a, buyins: ['high'] }, PREV, { buyins: true });
  assert.deepEqual(out.selectedGames, ['Razz'], 'games row untouched: the extra stays');
  assert.equal(out.mixedOnly, true);
  assert.deepEqual(out.siteRules, PREV.siteRules);
  assert.equal(out.hideSideEvents, true);
  assert.deepEqual(out.buyinRanges, ['1500-5000']);
});

test('filtersFrom: defaults deleted; extras dropped only when the games row is touched', () => {
  const a = O.answersFrom(null, PREV);
  const out = O.filtersFrom({ ...a, games: ['NLH'], online: true, buyins: [] }, PREV, { games: true, online: true, buyins: true });
  assert.deepEqual(out.selectedGames, ['NLH'], 'Razz dropped once the row is touched');
  assert.equal('mixedOnly' in out, false, 'mixedOnly false is the default: deleted');
  assert.equal('showOnline' in out, false, 'showOnline true is the default: deleted');
  assert.equal('buyinRanges' in out, false, 'no chips is the default: deleted');
  assert.deepEqual(out.siteRules, PREV.siteRules);
  const none = O.filtersFrom({ ...a, games: [] }, PREV, { games: true });
  assert.equal('selectedGames' in none, false);
});

test('filtersFrom: $5K+ writes and removes both top bands', () => {
  const a = O.answersFrom(null, {});
  assert.deepEqual(O.filtersFrom({ ...a, buyins: ['roller'] }, {}, { buyins: true }).buyinRanges, ['5000-10000', '10000+']);
  assert.deepEqual(O.filtersFrom({ ...a, buyins: ['low', 'roller'] }, {}, { buyins: true }).buyinRanges, ['0-500', '5000-10000', '10000+']);
  const off = O.filtersFrom({ ...a, buyins: ['low'] }, { buyinRanges: ['0-500', '5000-10000', '10000+'] }, { buyins: true });
  assert.deepEqual(off.buyinRanges, ['0-500']);
  assert.deepEqual(O.filtersFrom({ ...a, onlyAvailable: true }, {}, { sites: true }), { onlyAvailableOnline: true });
});

// ── locationFrom and the state ─────────────────────────────────────────────────────────────────
test('locationFrom: point, region and Everywhere', () => {
  const a = O.answersFrom(null, null);
  const p = O.locationFrom(O.choosePoint(a, { lat: 30.27, lng: -97.74, short: 'Austin, Texas, US', region: 'Texas', country: 'US' }), null);
  assert.deepEqual(p, { userLocation: { lat: 30.27, lng: -97.74 }, maxDistance: '100', locationRegion: null, locationLabel: 'Austin, Texas, US', jurisdiction: 'TX', jurisdictionManual: false });
  const cur = O.locationFrom(O.choosePlace(a, { kind: 'current', point: PHILLY }), null);
  assert.equal(cur.locationLabel, 'Current Location', "the location menu's tick reads this label");
  const r = O.locationFrom(O.chooseRegion(a, 'florida'), null);
  assert.deepEqual([r.locationRegion, r.userLocation, r.jurisdiction, r.jurisdictionManual], ['florida', null, 'FL', false]);
  assert.equal(O.locationFrom(O.chooseRegion(a, 'everywhere'), { locationRegion: 'texas' }), null, 'Everywhere is no location');
  // Untouched: the stored location comes back as it was (a 30-mile radius kept).
  const stored = { userLocation: PHILLY, maxDistance: '30', locationRegion: null, locationLabel: 'Philadelphia', jurisdiction: 'PA', jurisdictionManual: true };
  assert.deepEqual(O.locationFrom(O.answersFrom(stored, null), stored, {}), stored);
  // A new place keeps a non-chip radius unless a chip is tapped.
  const moved = O.locationFrom(O.choosePoint(O.answersFrom(stored, null), { lat: 1, lng: 2, short: 'X' }), stored, { place: true });
  assert.equal(moved.maxDistance, '30');
});

test('state: REGION_JURISDICTION, worked-out vs manual, precedence', () => {
  assert.deepEqual(U.REGION_JURISDICTION, { lasvegas: 'NV', texas: 'TX', florida: 'FL' });
  const a = O.answersFrom(null, null);
  assert.equal(O.chooseRegion(a, 'lasvegas').jurisdiction, 'NV');
  assert.equal(O.chooseRegion(O.chooseRegion(a, 'lasvegas'), 'northeast').jurisdiction, null, 'Northeast implies no state: a worked-out one goes');
  assert.equal(O.chooseRegion(O.chooseRegion(a, 'texas'), 'everywhere').jurisdiction, null, 'Everywhere clears a worked-out state');
  const manual = O.pickState(a, 'NJ');
  assert.deepEqual([manual.jurisdiction, manual.jurisdictionManual], ['NJ', true]);
  assert.equal(O.chooseRegion(manual, 'lasvegas').jurisdiction, 'NJ', 'a worked-out state never overwrites a manual one');
  assert.equal(O.chooseRegion(manual, 'everywhere').jurisdiction, 'NJ', 'Everywhere keeps a manual one');
  assert.equal(O.choosePoint(manual, { lat: 1, lng: 2, region: 'Texas', country: 'US' }).jurisdiction, 'NJ');
  assert.deepEqual([O.pickState(manual, '').jurisdiction, O.pickState(manual, '').jurisdictionManual], [null, false], '"Not set" clears it');
  // Europe is non-US: no state worked out.
  const eu = O.chooseRegion(a, 'europe');
  assert.deepEqual([eu.country, eu.jurisdiction], ['other', null]);
  assert.equal(O.sitesShown({ ...eu, online: true }), false);
  // The reverse lookup: applied only while that point is still the answer; non-US gives no state.
  const point = { lat: 48.85, lng: 2.35 };
  const here = O.choosePlace(a, { kind: 'current', point });
  const fr = O.learnPlace(here, point, { region: 'Île-de-France', country: 'FR', short: 'Paris, Île-de-France' });
  assert.deepEqual([fr.jurisdiction, fr.country, fr.place.name], [null, 'other', 'Paris, Île-de-France']);
  const pa = O.learnPlace(O.choosePlace(a, { kind: 'current', point: PHILLY }), PHILLY, { region: 'Pennsylvania', country: 'US', short: 'Philadelphia, Pennsylvania' });
  assert.deepEqual([pa.jurisdiction, pa.jurisdictionManual, pa.country], ['PA', false, 'US']);
  assert.equal(O.learnPlace(O.chooseRegion(here, 'texas'), point, { region: 'Nevada', country: 'US' }).jurisdiction, 'TX', 'a late lookup for a place no longer chosen is ignored');
});

test('repair (B1): state names become codes and lose manual; codes stand', () => {
  assert.deepEqual(P.repairJurisdiction({ jurisdiction: 'PENNSYLVANIA', jurisdictionManual: true }), { jurisdiction: 'PA', jurisdictionManual: false });
  assert.deepEqual(P.repairJurisdiction({ jurisdiction: 'ÎLE-DE-FRANCE', jurisdictionManual: true }), { jurisdiction: null, jurisdictionManual: false });
  const ok = { jurisdiction: 'PA', jurisdictionManual: true };
  assert.equal(P.repairJurisdiction(ok), ok);
  assert.equal(P.repairJurisdiction(null), null);
  store.set('savedLocation', JSON.stringify({ userLocation: PHILLY, maxDistance: '100', locationLabel: 'Current Location', jurisdiction: 'PENNSYLVANIA', jurisdictionManual: true }));
  assert.deepEqual([P.readLocalLocation().jurisdiction, P.readLocalLocation().jurisdictionManual], ['PA', false]);
  store.delete('savedLocation');
});

// ── The live count ────────────────────────────────────────────────────────────────────────────
const TODAY = '2026-10-13';
const ev = (extra) => ({ event_name: 'NLH', game_variant: 'NLH', buyin: 400, date: '2026-10-20', venue: 'Horseshoe / Paris Las Vegas', ...extra });
const FIX = [
  ev({}),                                                        // live, Vegas
  ev({ venue: 'Texas Card House Austin' }),                      // live, Texas
  ev({ game_variant: 'PLO', buyin: 1500 }),                      // live, Vegas, PLO
  ev({ game_variant: 'Razz', buyin: 10000 }),                    // live, Vegas, mixed, $5K+
  ev({ is_online: 1, site: 'acr', venue: 'ACR Online' }),        // online
  ev({ venue: 'Personal' }),                                     // a Personal entry
  ev({ date: '2026-10-01' }),                                    // past
  ev({ is_satellite: 1 }),                                       // satellite
  ev({ is_restart: 1 }),                                         // Day 2
];

test('countSetup: online / Personal / past / satellite / restart', () => {
  assert.deepEqual(O.countSetup(FIX, null, {}, TODAY), { live: 4, online: 1 });
  assert.deepEqual(O.countSetup(FIX, { locationRegion: 'lasvegas' }, {}, TODAY), { live: 3, online: 1 }, 'online is near no one, and not hidden by location');
  assert.deepEqual(O.countSetup(FIX, null, { showOnline: false }, TODAY), { live: 4, online: 0 });
  assert.deepEqual(O.countSetup(FIX, null, { selectedGames: ['NLH'] }, TODAY), { live: 2, online: 1 });
  assert.deepEqual(O.countSetup(FIX, null, { mixedOnly: true }, TODAY), { live: 1, online: 0 });
  assert.deepEqual(O.countSetup(FIX, null, { buyinRanges: ['5000-10000', '10000+'] }, TODAY), { live: 1, online: 0 });
  assert.deepEqual(O.countSetup([], null, {}, TODAY), { live: 0, online: 0 });
});

test('statusLine and showLabel', () => {
  assert.equal(O.statusLine({ live: 1204, online: 890 }, { located: true }), '1,204 live events near you · 890 online');
  assert.equal(O.statusLine({ live: 3410, online: 890 }, { located: false }), '3,410 live events · 890 online');
  assert.equal(O.statusLine({ live: 1204, online: 890 }, { located: true, showOnline: false }), '1,204 live events near you');
  assert.equal(O.statusLine({ live: 1, online: 0 }, { showOnline: false }), '1 live event');
  assert.equal(O.statusLine({ live: 0, online: 0 }, {}), 'Nothing upcoming matches all of this. Loosen a choice.');
  assert.equal(O.statusLine({ live: 0, online: 5 }, { showOnline: false }), 'Nothing upcoming matches all of this. Loosen a choice.');
  assert.equal(O.statusLine(null), '');
  assert.equal(O.showLabel({ live: 1204, online: 890 }), 'Show 2,094 events');
  assert.equal(O.showLabel({ live: 1204, online: 890 }, { showOnline: false }), 'Show 1,204 events');
  assert.equal(O.showLabel({ live: 1, online: 0 }), 'Show 1 event');
  assert.equal(O.showLabel({ live: 0, online: 0 }), 'Show events');
  assert.equal(O.showLabel(null), 'Show events');
});

// ── matchesGames / matchesBuyin: parity with TournamentsView's old inline code ───────────────────
function oldBuyin(t, filters) {
  if (filters.buyinRanges && filters.buyinRanges.length > 0) {
    const b = Number(t.buyin) || 0;
    const matchesBuyin = filters.buyinRanges.some(r => {
      if (r === '0-500') return b < 500;
      if (r === '500-1500') return b >= 500 && b < 1500;
      if (r === '1500-5000') return b >= 1500 && b < 5000;
      if (r === '5000-10000') return b >= 5000 && b <= 10000;
      if (r === '10000+') return b > 10000;
      return true;
    });
    if (!matchesBuyin) return false;
  }
  return true;
}
function oldGames(t, filters) {
  if (filters.selectedGames.length > 0 || filters.mixedOnly) {
    const isMixed = t.game_variant !== 'NLH' && t.game_variant !== 'PLO';
    const matchesGame = filters.selectedGames.length > 0 && filters.selectedGames.includes(t.game_variant);
    const matchesMixed = filters.mixedOnly && isMixed;
    if (!matchesGame && !matchesMixed) return false;
  }
  return true;
}

test('matchesBuyin: the old code, at every band edge', () => {
  const sets = [[], ['0-500'], ['500-1500'], ['1500-5000'], ['5000-10000'], ['10000+'], ['0-500', '10000+'], ['5000-10000', '10000+'], ['junk']];
  for (const b of [0, 499, 500, 1499, 1500, 4999, 5000, 10000, 10001, '', null, 'abc']) {
    for (const r of sets) {
      const t = { buyin: b }, f = { buyinRanges: r };
      assert.equal(U.matchesBuyin(t, f), oldBuyin(t, f), `buyin ${b} ranges ${r}`);
    }
  }
});

test('matchesGames: the old code, every combination', () => {
  const sels = [[], ['NLH'], ['PLO'], ['NLH', 'PLO'], ['Razz'], ['NLH', 'Razz']];
  for (const v of ['NLH', 'PLO', 'Razz', 'O8', 'HORSE', undefined]) {
    for (const s of sels) for (const m of [false, true]) {
      const t = { game_variant: v }, f = { selectedGames: s, mixedOnly: m };
      assert.equal(U.matchesGames(t, f), oldGames(t, f), `${v} ${s} ${m}`);
    }
  }
});

// ── The account's record ──────────────────────────────────────────────────────────────────────
test('adoptServerOnboarding: seeds a device with no filters, never one with its own', () => {
  store.clear(); events.length = 0;
  const rec = { v: 2, at: 1, skipped: false, filters: { selectedGames: ['NLH'], showOnline: true, buyinRanges: ['0-500'] } };
  assert.equal(O.adoptServerOnboarding(rec), true);
  assert.deepEqual(JSON.parse(store.get('savedFilters')), { selectedGames: ['NLH'], buyinRanges: ['0-500'] }, 'defaults left out');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'onboarding-applied');
  assert.equal('location' in events[0].detail, false, 'a filters-only adoption leaves the location alone');
  store.set('savedFilters', JSON.stringify({ hideSideEvents: true }));
  assert.equal(O.adoptServerOnboarding(rec), false);
  assert.deepEqual(JSON.parse(store.get('savedFilters')), { hideSideEvents: true });
  store.clear();
  assert.equal(O.adoptServerOnboarding({ v: 1, legacy: true }), false, 'a legacy record carries no answers');
  assert.equal(store.has('savedFilters'), false);
});

test('onboarded flag: clearOnboarded undoes markOnboarded', () => {
  store.clear();
  assert.equal(P.hasOnboarded(), false);
  P.markOnboarded();
  assert.equal(P.hasOnboarded(), true);
  P.clearOnboarded();
  assert.equal(P.hasOnboarded(), false);
});
