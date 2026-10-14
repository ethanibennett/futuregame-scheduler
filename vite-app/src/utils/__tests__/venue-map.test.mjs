// node --test src/utils/__tests__/venue-map.test.mjs   (from vite-app/; or `npm run test:venue-map` from the root)
// The venue map's client logic: which provider each platform asks for and how it falls back
// (utils/venue-map/providers.js), and what the popup says (utils/venue-place.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';

// utils.js reads localStorage at module scope (a debug clock); nothing here touches it.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { currentPlatform, providerOrder, mountVenueMap } = await import('../venue-map/providers.js');
const { hasVenueMap, venueRoomName, venuePlace, distanceLine, mapsLinks } = await import('../venue-place.js');

const withPlatform = (platform, fn) => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const prev = globalThis.window;
  globalThis.window = platform === undefined ? {} : { Capacitor: { getPlatform: () => platform } };
  try { return fn(); } finally { if (had) globalThis.window = prev; else delete globalThis.window; }
};

test('platform: Capacitor.getPlatform(), else web', () => {
  assert.equal(withPlatform('android', () => currentPlatform()), 'android');
  assert.equal(withPlatform('ios', () => currentPlatform()), 'ios');
  assert.equal(withPlatform(undefined, () => currentPlatform()), 'web');
  assert.equal(currentPlatform(), 'web', 'no window at all (node)');
});

test('order: Android asks Google first; iOS, the Mac app and the web ask MapKit; OSM is always last', () => {
  assert.deepEqual(withPlatform('android', () => providerOrder()), ['google', 'mapkit', 'osm']);
  assert.deepEqual(withPlatform('ios', () => providerOrder()), ['mapkit', 'osm']);
  assert.deepEqual(withPlatform('web', () => providerOrder()), ['mapkit', 'osm']);
  assert.deepEqual(withPlatform(undefined, () => providerOrder()), ['mapkit', 'osm']);
});

// Fake providers: `cfg` says which are configured and which fail to draw.
const fakes = (cfg, log) => (id) => Promise.resolve({
  id,
  available: async () => { log.push(`${id}?`); return !!cfg[id]; },
  mount: async () => {
    log.push(`${id}!`);
    if (cfg[id] === 'fails') throw new Error(`${id} refused`);
    return { destroy: () => log.push(`${id}x`) };
  },
});
const el = { replaceChildren() {} };

test('Android: Google when its key is configured', async () => {
  const log = [];
  const r = await mountVenueMap(el, {}, { platform: 'android', load: fakes({ google: true, mapkit: true, osm: true }, log) });
  assert.equal(r.provider, 'google');
  assert.deepEqual(log, ['google?', 'google!']);
  r.destroy();
  assert.deepEqual(log.slice(-1), ['googlex']);
});

test('Android without a Google key: MapKit, then OpenStreetMap', async () => {
  let log = [];
  let r = await mountVenueMap(el, {}, { platform: 'android', load: fakes({ google: false, mapkit: true, osm: true }, log) });
  assert.equal(r.provider, 'mapkit');
  log = [];
  r = await mountVenueMap(el, {}, { platform: 'android', load: fakes({ google: false, mapkit: false, osm: true }, log) });
  assert.equal(r.provider, 'osm');
  assert.deepEqual(log, ['google?', 'mapkit?', 'osm?', 'osm!']);
});

test('iOS / web: MapKit when configured, OpenStreetMap otherwise; Google is never asked', async () => {
  for (const platform of ['ios', 'web']) {
    let log = [];
    let r = await mountVenueMap(el, {}, { platform, load: fakes({ google: true, mapkit: true, osm: true }, log) });
    assert.equal(r.provider, 'mapkit', platform);
    log = [];
    r = await mountVenueMap(el, {}, { platform, load: fakes({ google: true, mapkit: false, osm: true }, log) });
    assert.equal(r.provider, 'osm', platform);
    assert.ok(!log.some((l) => l.startsWith('google')), `${platform} never asks Google`);
  }
});

test('a provider that fails to draw (a refused token) falls through to the next', async () => {
  const log = [];
  const r = await mountVenueMap(el, {}, { platform: 'ios', load: fakes({ mapkit: 'fails', osm: true }, log) });
  assert.equal(r.provider, 'osm');
  assert.deepEqual(log, ['mapkit?', 'mapkit!', 'osm?', 'osm!']);
});

test('nothing draws (offline): the mount rejects, and the popup says so', async () => {
  await assert.rejects(mountVenueMap(el, {}, { platform: 'web', load: fakes({ mapkit: false, osm: 'fails' }, []) }), /osm refused/);
});

test('a map only for a room: not online events, not Personal days', () => {
  assert.equal(hasVenueMap({ venue: 'Borgata Fall Poker Open 2026', property: 'Borgata Hotel Casino & Spa' }), true);
  assert.equal(hasVenueMap({ venue: 'ACR Venom', is_online: 1 }), false);
  assert.equal(hasVenueMap({ venue: 'WSOP Online' }), false);
  assert.equal(hasVenueMap({ venue: 'Personal' }), false);
  assert.equal(hasVenueMap(null), false);
});

test('the room: the feed\'s property, else the curated name without its WSOPC prefix', () => {
  assert.equal(venueRoomName({ venue: 'Borgata Fall Poker Open 2026', property: 'Borgata Hotel Casino & Spa' }), 'Borgata Hotel Casino & Spa');
  assert.equal(venueRoomName({ venue: 'Turning Stone Casino' }), 'Turning Stone');
  assert.equal(venueRoomName({ venue: 'Aria' }), 'Aria Resort & Casino');
});

test('place: curated coordinates, and city-level ones are flagged approximate', () => {
  const borgata = venuePlace({ venue: 'Borgata Fall Poker Open 2026', property: 'Borgata Hotel Casino & Spa' });
  assert.ok(borgata.coords && Math.abs(borgata.coords.lat - 39.378) < 0.01);
  assert.equal(borgata.approx, false);
  const tch = venuePlace({ venue: 'Some Houston Series', property: 'Texas Card House Houston' });
  assert.ok(tch.coords);
  assert.equal(tch.approx, true, 'Texas Card House Houston is a town-centre coordinate');
  assert.equal(venuePlace({ venue: 'Nowhere Open 2099', property: 'Unknown Room' }).coords, null);
});

test('distance: from the saved location, in miles, named by its first part', () => {
  const borgata = { lat: 39.37853, lng: -74.43493 };
  const philly = { userLocation: { lat: 39.9526, lng: -75.1652 }, locationLabel: 'Philadelphia, Pennsylvania, United States' };
  assert.match(distanceLine(borgata, philly), /^5\d mi from Philadelphia$/);
  assert.match(distanceLine(borgata, { userLocation: { lat: 39.36, lng: -74.43 }, locationLabel: 'Current Location' }), /^\d\.\d mi from your location$/);
  assert.equal(distanceLine(borgata, { locationRegion: 'northeast' }), null, 'a region is not a point');
  assert.equal(distanceLine(null, philly), null);
});

test('links: Apple Maps at the pin with the name, Google Maps at the coordinates; search without them', () => {
  const a = mapsLinks({ name: 'Borgata Hotel Casino & Spa', town: 'Atlantic City, NJ', coords: { lat: 39.37853, lng: -74.43493 } });
  assert.equal(a.search, false);
  assert.equal(a.apple, 'https://maps.apple.com/?q=Borgata%20Hotel%20Casino%20%26%20Spa&ll=39.37853,-74.43493');
  assert.equal(a.google, 'https://www.google.com/maps/search/?api=1&query=39.37853%2C-74.43493');
  const b = mapsLinks({ name: 'Lodge Card Club', town: 'Round Rock, TX', coords: null });
  assert.equal(b.search, true);
  assert.equal(b.apple, 'https://maps.apple.com/?q=Lodge%20Card%20Club%2C%20Round%20Rock%2C%20TX');
  assert.equal(b.google, 'https://www.google.com/maps/search/?api=1&query=Lodge%20Card%20Club%2C%20Round%20Rock%2C%20TX');
});
