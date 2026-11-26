// The Schedule's location filter as several places (owner, 2026-11-26): utils/location-places.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  placeOf, placesOf, withPlaces, addPlace, removePlace, togglePlace, setPlaceRadius,
  placeName, locationTileText, locationTitle,
} from '../location-places.js';

const REGIONS = { lasvegas: { label: 'Las Vegas' }, florida: { label: 'Florida' } };
const PHILLY = { userLocation: { lat: 39.9526, lng: -75.1652 }, maxDistance: '300', locationLabel: 'Philadelphia, Pennsylvania' };
const VEGAS = { userLocation: { lat: 36.1699, lng: -115.1398 }, maxDistance: '20', locationLabel: 'Las Vegas, Nevada' };
const HOLLYWOOD = { userLocation: { lat: 26.0112, lng: -80.1495 }, maxDistance: '30', locationLabel: 'Hollywood, Florida' };
const EMPTY = { userLocation: null, maxDistance: '', locationRegion: null, locationLabel: null, moreLocations: [], jurisdiction: 'PA' };

test('the first place stays in the classic fields, the rest in moreLocations', () => {
  let f = addPlace(EMPTY, PHILLY);
  f = addPlace(f, VEGAS);
  f = addPlace(f, HOLLYWOOD);
  assert.deepEqual(f.userLocation, PHILLY.userLocation);
  assert.equal(f.maxDistance, '300');
  assert.equal(f.locationLabel, 'Philadelphia, Pennsylvania');
  assert.equal(f.locationRegion, null);
  assert.deepEqual(f.moreLocations, [placeOf(VEGAS), placeOf(HOLLYWOOD)]);
  assert.equal(f.jurisdiction, 'PA', 'other fields are untouched');
  assert.equal(placesOf(f).length, 3);
});

test('a filter saved before places existed reads as one place, unchanged', () => {
  const old = { userLocation: PHILLY.userLocation, maxDistance: '100', locationLabel: 'Current Location', locationRegion: null };
  assert.deepEqual(placesOf(old), [{ userLocation: PHILLY.userLocation, maxDistance: '100', locationLabel: 'Current Location' }]);
  assert.deepEqual(placesOf({ locationRegion: 'florida' }), [{ locationRegion: 'florida' }]);
  assert.deepEqual(placesOf(EMPTY), []);
  assert.deepEqual(placesOf(null), []);
});

test('removing the first place moves the next one up', () => {
  const f = removePlace(addPlace(addPlace(EMPTY, PHILLY), VEGAS), 0);
  assert.deepEqual(f.userLocation, VEGAS.userLocation);
  assert.equal(f.maxDistance, '20');
  assert.deepEqual(f.moreLocations, []);
  const none = removePlace(f, 0);
  assert.equal(none.userLocation, null);
  assert.equal(none.maxDistance, '');
  assert.equal(none.locationLabel, null);
});

test('a region can lead, and a point after it keeps its radius', () => {
  const f = addPlace(togglePlace(EMPTY, { locationRegion: 'lasvegas' }), PHILLY);
  assert.equal(f.locationRegion, 'lasvegas');
  assert.equal(f.userLocation, null);
  assert.equal(f.maxDistance, '');
  assert.deepEqual(f.moreLocations, [placeOf(PHILLY)]);
  const off = togglePlace(f, { locationRegion: 'lasvegas' });
  assert.equal(off.locationRegion, null);
  assert.deepEqual(off.userLocation, PHILLY.userLocation, 'Philadelphia moved up');
});

test('the same spot twice is one place: a new radius replaces it where it stands', () => {
  let f = addPlace(addPlace(EMPTY, PHILLY), VEGAS);
  f = addPlace(f, { ...PHILLY, userLocation: { lat: 39.95261, lng: -75.16521 }, maxDistance: '50' });
  assert.equal(placesOf(f).length, 2);
  assert.equal(f.maxDistance, '50');
  const here = { userLocation: { lat: 40, lng: -75 }, maxDistance: '100', locationLabel: 'Current Location' };
  const moved = addPlace(addPlace(f, here), { ...here, userLocation: { lat: 41, lng: -74 } });
  assert.equal(placesOf(moved).length, 3, 'the device has one position');
  assert.equal(togglePlace(moved, here).moreLocations.length, 1, 'and toggling it takes it off');
});

test("each place's radius is its own", () => {
  const f = setPlaceRadius(addPlace(addPlace(EMPTY, PHILLY), VEGAS), 1, 25);
  assert.equal(f.maxDistance, '300');
  assert.equal(f.moreLocations[0].maxDistance, '25');
  assert.equal(setPlaceRadius(togglePlace(EMPTY, { locationRegion: 'florida' }), 0, 9).locationRegion, 'florida', 'a region has no radius');
});

test('the tile reads one place as it always did, several by name', () => {
  const one = addPlace(EMPTY, PHILLY);
  assert.equal(locationTileText(one, REGIONS), 'Philadelphia, Pennsylvania · 300 mi');
  const three = addPlace(addPlace(addPlace(one, VEGAS), HOLLYWOOD), { locationRegion: 'florida' });
  assert.equal(locationTileText(three, REGIONS), 'Philadelphia, Las Vegas, Hollywood, Florida');
  assert.equal(locationTitle(three, REGIONS), 'Philadelphia, Pennsylvania · 300 mi; Las Vegas, Nevada · 20 mi; Hollywood, Florida · 30 mi; Florida');
  assert.equal(locationTileText(EMPTY, REGIONS), null);
  assert.equal(locationTileText({ locationRegion: 'lasvegas' }, REGIONS), 'Las Vegas');
  assert.equal(placeName({ userLocation: { lat: 1, lng: 1 }, maxDistance: '5', locationLabel: null }, REGIONS), 'Location');
});

test('withPlaces drops what names nowhere', () => {
  const f = withPlaces(EMPTY, [null, { locationLabel: 'no point' }, VEGAS]);
  assert.deepEqual(placesOf(f), [placeOf(VEGAS)]);
});
