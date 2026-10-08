'use strict';
// node test/venue-coords.test.js — lib/venue-coords.js, no network.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const V = require('../lib/venue-coords');

let failed = 0;
const t = async (name, fn) => {
  try { await fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
};

(async () => {
  await t('regions: US, Canada, colliding and plain countries', () => {
    assert.strictEqual(V.regionFromLocation('Durant, OK'), 'OK');
    assert.strictEqual(V.regionFromLocation('Durant, OK, United States', 'US'), 'OK');
    assert.strictEqual(V.regionFromLocation('Danville, Virginia, United States', 'US'), 'VA');
    assert.strictEqual(V.regionFromLocation('Kahnawake, QC, Canada', 'CA'), 'CA-QC');
    assert.strictEqual(V.regionFromLocation('Niagara Falls, ON'), 'CA-ON');
    // Panama's ISO code is Pennsylvania's postal code; Germany's is Delaware's.
    assert.strictEqual(V.regionFromLocation('Panama City, Panama', 'PA'), 'PANAMA');
    assert.strictEqual(V.regionFromLocation('Berlin', 'DE'), 'GERMANY');
    assert.strictEqual(V.regionFromLocation('Madrid, Spain', 'ES'), 'ES');
    assert.strictEqual(V.regionFromLocation('Nassau, Bahamas'), 'BS');
    // Nothing to go on → null (the caller reverse-geocodes the coordinates instead).
    assert.strictEqual(V.regionFromLocation('Rozvadov'), null);
    assert.strictEqual(V.regionFromLocation(''), null);
    // A US code the coordinates contradict is refused (a foreign "…, DE" is not Delaware).
    assert.strictEqual(V.regionFromLocation('Somewhere, DE', null, 52.5, 13.4), null);
    assert.strictEqual(V.regionFromLocation('Dover, DE', null, 39.16, -75.52), 'DE');
  });

  await t('regions from Nominatim address details', () => {
    assert.strictEqual(V.regionFromAddress({ country_code: 'us', 'ISO3166-2-lvl4': 'US-NJ' }), 'NJ');
    assert.strictEqual(V.regionFromAddress({ country_code: 'us', state: 'Oklahoma' }), 'OK');
    assert.strictEqual(V.regionFromAddress({ country_code: 'ca', 'ISO3166-2-lvl4': 'CA-AB' }), 'CA-AB');
    assert.strictEqual(V.regionFromAddress({ country_code: 'cz' }), 'CZ');
    assert.strictEqual(V.regionFromAddress({ country_code: 'mt' }), 'MALTA');
  });

  await t('WSOP.com series name matches the watcher (seriesNameFrom)', () => {
    assert.strictEqual(V.wsopSeriesName('WSOP Circuit - Panama City | WSOP.com', 'wsop-circuit-panama-city', '2026-10-08T00:00:00Z'), 'WSOPC Panama City 2026');
    assert.strictEqual(V.wsopSeriesName('WSOP Circuit - Choctaw Durant | WSOP.com', 'wsop-circuit-choctaw-durant-october-2026', '2025-12-30T00:00:00Z'), 'WSOPC Choctaw Durant 2026');
    assert.strictEqual(V.wsopSeriesName('WSOP Circuit - Harrah&#39;s Cherokee | WSOP.com', 'x', '2026-01-01'), "WSOPC Harrah's Cherokee 2026");
  });

  const dir = V.loadVenueDirectory({
    pokeratlas: [
      [1, 'Riverside Casino', 'Riverside, IA', 41.4963, -91.528],
      [2, 'Texas Card House', 'Austin, TX', 30.4456, -97.7905],
      [3, 'Texas Card House', 'Dallas, TX', 32.7763, -96.7969],
      [4, 'Casino de Santa Cruz', 'Santa Cruz de Tenerife', 28.47435, -16.25292],
      [5, 'Casino de Santa Cruz', 'Santa Cruz de Tenerife, Santa Cruz de Tenerife', 28.47442, -16.25313],
      [6, "King's Resort Rozvadov", 'Rozvadov', 49.6702, 12.5544],
    ],
    wsop_stops: { 'WSOPC Panama City 2026': { property: 'Sortis Hotel, Spa & Casino', location: 'Panama City, Panama', country: 'PA' } },
  });

  await t('directory: exact names only; duplicates need a town or co-location', () => {
    assert.strictEqual(dir.lookup('Riverside Casino').id, 1);
    assert.strictEqual(dir.lookup('riverside  casino').id, 1); // case and spacing only
    assert.strictEqual(dir.lookup('Riverside Casino & Golf Resort'), null); // not fuzzy
    assert.strictEqual(dir.lookup('Texas Card House'), null); // ambiguous, no hint
    assert.strictEqual(dir.lookup('Texas Card House', 'Austin, Texas, United States').id, 2);
    assert.strictEqual(dir.lookup('Casino de Santa Cruz').id, 4); // duplicate listing, same spot
    assert.strictEqual(dir.lookup('King’s Resort Rozvadov').id, 6); // curly apostrophe
  });

  // A fake geocoder that records what it was asked.
  const fakeGeo = (answers = {}) => {
    const asked = [];
    return {
      asked,
      async search(q, cc) { asked.push(['search', q, cc]); return answers[q] || null; },
      async reverse(lat, lng) { asked.push(['reverse', lat, lng]); return answers.reverse || null; },
    };
  };

  await t('resolve: feed coordinates win', async () => {
    const geo = fakeGeo();
    const r = await V.resolveVenue({ venue: 'X', property: 'Riverside Casino', hint: { lat: 33.99, lng: -96.39, location: 'Durant, OK' } }, { directory: dir, geocoder: geo });
    assert.deepStrictEqual([r.lat, r.lng, r.region, r.source], [33.99, -96.39, 'OK', 'feed']);
    assert.strictEqual(geo.asked.length, 0);
  });

  await t('resolve: PokerAtlas directory by property, region from city_state', async () => {
    const geo = fakeGeo();
    const r = await V.resolveVenue({ venue: "MSPT '26 Fall Festival", property: 'Riverside Casino' }, { directory: dir, geocoder: geo });
    assert.deepStrictEqual([r.lat, r.lng, r.region, r.source], [41.4963, -91.528, 'IA', 'pokeratlas']);
    assert.strictEqual(geo.asked.length, 0);
  });

  await t('resolve: directory hit with no parseable region reverse-geocodes once, then reuses', async () => {
    const geo = fakeGeo({ reverse: 'CZ' });
    const r = await V.resolveVenue({ venue: 'Rozvadov', property: "King's Resort Rozvadov" }, { directory: dir, geocoder: geo });
    assert.deepStrictEqual([r.region, r.source], ['CZ', 'pokeratlas']);
    assert.strictEqual(geo.asked.length, 1);
    const geo2 = fakeGeo();
    const again = await V.resolveVenue({ venue: 'Rozvadov', property: "King's Resort Rozvadov" }, { directory: dir, geocoder: geo2, existing: { ...r } });
    assert.strictEqual(again.region, 'CZ');
    assert.strictEqual(geo2.asked.length, 0);
  });

  await t('resolve: WSOP.com stop → room + town geocode, constrained to its country', async () => {
    const q = 'Sortis Hotel, Spa & Casino, Panama City, Panama';
    const geo = fakeGeo({ [q]: { lat: 8.98, lng: -79.52, region: 'PANAMA' } });
    const r = await V.resolveVenue({ venue: 'WSOPC Panama City 2026', property: null }, { directory: dir, geocoder: geo });
    assert.deepStrictEqual([r.lat, r.region, r.source, r.detail], [8.98, 'PANAMA', 'nominatim', q]);
    assert.deepStrictEqual(geo.asked[0], ['search', q, 'PA']);
    // Cached: the same query is not asked again.
    const geo2 = fakeGeo();
    const again = await V.resolveVenue({ venue: 'WSOPC Panama City 2026', property: null }, { directory: dir, geocoder: geo2, existing: r });
    assert.strictEqual(again.lat, 8.98);
    assert.strictEqual(geo2.asked.length, 0);
  });

  await t('resolve: a geocode in the wrong state falls back to the town', async () => {
    const geo = fakeGeo({
      'Some Room, Durant, OK, United States': { lat: 30, lng: -97, region: 'TX' },
      'Durant, OK, United States': { lat: 33.99, lng: -96.39, region: 'OK' },
    });
    const r = await V.resolveVenue({ venue: 'V', property: 'Some Room', hint: { location: 'Durant, OK, United States', country: 'US' } }, { directory: dir, geocoder: geo });
    assert.deepStrictEqual([r.lat, r.region, r.source], [33.99, 'OK', 'nominatim-city']);
  });

  await t('resolve: never geocodes a bare room name or a title', async () => {
    const geo = fakeGeo({ 'Bally Room': { lat: 1, lng: 1, region: 'NV' } });
    const r = await V.resolveVenue({ venue: 'WSOPC Somewhere 2027', property: 'Bally Room' }, { directory: dir, geocoder: geo });
    assert.strictEqual(r.lat, null);
    assert.strictEqual(r.source, 'unresolved');
    assert.strictEqual(geo.asked.length, 0);
  });

  await t('resolve: a recent miss is not retried; an old one is', async () => {
    const info = { venue: 'V', property: 'Nowhere Club', hint: { location: 'Atlantis' } };
    const geo = fakeGeo();
    const miss = await V.resolveVenue(info, { directory: dir, geocoder: geo });
    assert.strictEqual(miss.lat, null);
    assert.strictEqual(geo.asked.length, 2);
    const geo2 = fakeGeo();
    const recent = { ...miss, updated_at: new Date().toISOString() };
    await V.resolveVenue(info, { directory: dir, geocoder: geo2, existing: recent });
    assert.strictEqual(geo2.asked.length, 0);
    const old = { ...miss, updated_at: new Date(Date.now() - 2 * 86400e3).toISOString() };
    await V.resolveVenue(info, { directory: dir, geocoder: geo2, existing: old });
    assert.strictEqual(geo2.asked.length, 2);
  });

  await t('the committed directory loads and places the 2026-10-08 misses', () => {
    const json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'venue-directory.json'), 'utf8'));
    const d = V.loadVenueDirectory(json);
    assert.ok(d.size > 1000, `only ${d.size} venues`);
    for (const p of ['Choctaw Casino Durant', "King's Resort Rozvadov", 'Riverside Casino', 'Bellagio Casino', 'Resorts World Catskills', 'Baha Mar Casino']) {
      assert.ok(d.lookup(p), `${p} not found`);
    }
    assert.strictEqual(d.wsopStop('WSOPC Turning Stone 2026').location, 'Verona, NY, United States');
  });

  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
  console.log('\nall passed');
})();
