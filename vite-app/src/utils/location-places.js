/* The Schedule's location filter as a list of places (owner, 2026-11-26: "the option to have multiple
   location filters (Philadelphia + 300 miles, Las Vegas + 20 miles, Hollywood, FL + 30 miles)").

   A place is a point with its own radius ({ userLocation: { lat, lng }, maxDistance, locationLabel })
   or a region ({ locationRegion }). The FIRST place stays in the filter fields every reader already
   knows (userLocation, maxDistance, locationLabel, locationRegion), so first-run setup, the venue
   map's "N mi from" line, Home and the Cash tab's first location read it exactly as before; the rest
   ride in `moreLocations`, each in the same shape. An event passes when it is near ANY place
   (utils.js matchesLocation). Removing the first place moves the next one up.

   Pure: no imports, so utils.js can use it without a cycle. */

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

/** One place from a filter object or a stored entry; null when it names nowhere. */
export function placeOf(o) {
  if (!o || typeof o !== 'object') return null;
  if (o.locationRegion) return { locationRegion: o.locationRegion };
  const u = o.userLocation;
  if (u && Number.isFinite(num(u.lat)) && Number.isFinite(num(u.lng))) {
    return {
      userLocation: { lat: Number(u.lat), lng: Number(u.lng) },
      maxDistance: o.maxDistance === undefined || o.maxDistance === null ? '' : String(o.maxDistance),
      locationLabel: o.locationLabel || null,
    };
  }
  return null;
}

/** Two places name the same spot: the same region, the device's own position, or points within
    about 50 m of each other. The radius is not part of a place's identity. */
export function samePlace(a, b) {
  if (!a || !b) return false;
  if (a.locationRegion || b.locationRegion) return a.locationRegion === b.locationRegion;
  if (a.locationLabel === 'Current Location' && b.locationLabel === 'Current Location') return true;
  return Math.abs(a.userLocation.lat - b.userLocation.lat) < 5e-4
    && Math.abs(a.userLocation.lng - b.userLocation.lng) < 5e-4;
}

const cache = new WeakMap();
/** Every place the filter names, first one first, each spot once. Cached per filter object: the
    list's filter asks once per event. */
export function placesOf(f) {
  if (!f || typeof f !== 'object') return [];
  const hit = cache.get(f);
  if (hit) return hit;
  const out = [];
  for (const p of [placeOf(f), ...(Array.isArray(f.moreLocations) ? f.moreLocations.map(placeOf) : [])]) {
    if (p && !out.some((q) => samePlace(p, q))) out.push(p);
  }
  cache.set(f, out);
  return out;
}

/** The filter with these places: the first in the classic fields, the rest in moreLocations. */
export function withPlaces(f, places) {
  const list = (places || []).map(placeOf).filter(Boolean);
  const first = list[0] || null;
  const point = first && first.userLocation ? first : null;
  return {
    ...f,
    userLocation: point ? point.userLocation : null,
    maxDistance: point ? point.maxDistance : '',
    locationLabel: point ? point.locationLabel : null,
    locationRegion: first && first.locationRegion ? first.locationRegion : null,
    moreLocations: list.slice(1),
  };
}

/** Adds a place, or, when the spot is already there, replaces it where it stands (a new radius, the
    device's new position). */
export function addPlace(f, place) {
  const p = placeOf(place);
  if (!p) return f;
  const list = placesOf(f).slice();
  const i = list.findIndex((q) => samePlace(q, p));
  if (i >= 0) list[i] = p; else list.push(p);
  return withPlaces(f, list);
}

export function removePlace(f, index) {
  return withPlaces(f, placesOf(f).filter((_, i) => i !== index));
}

/** A region or the device's position, on if it is off and off if it is on. */
export function togglePlace(f, place) {
  const p = placeOf(place);
  if (!p) return f;
  const list = placesOf(f);
  const i = list.findIndex((q) => samePlace(q, p));
  return i >= 0 ? removePlace(f, i) : addPlace(f, p);
}

export function setPlaceRadius(f, index, miles) {
  return withPlaces(f, placesOf(f).map((p, i) => (i === index && p.userLocation ? { ...p, maxDistance: String(miles) } : p)));
}

/** A place's name: a region's label, else the first part of a looked-up place ("Philadelphia"). */
export function placeName(p, regions) {
  if (!p) return '';
  if (p.locationRegion) return (regions && regions[p.locationRegion] && regions[p.locationRegion].label) || p.locationRegion;
  return String(p.locationLabel || 'Location').split(',')[0].trim() || 'Location';
}

/** A place in full: "Philadelphia, Pennsylvania · 300 mi", or the region's label. */
export function placeText(p, regions) {
  if (!p) return '';
  if (p.locationRegion) return placeName(p, regions);
  return (p.locationLabel || 'Location') + (p.maxDistance ? ` · ${p.maxDistance} mi` : '');
}

/** The Schedule's location tile: one place as it always read, several by name
    ("Philadelphia, Las Vegas, Hollywood"); null with none. */
export function locationTileText(f, regions) {
  const list = placesOf(f).filter((p) => p.locationRegion ? regions && regions[p.locationRegion] : p.maxDistance);
  if (!list.length) return null;
  if (list.length === 1) return placeText(list[0], regions);
  return list.map((p) => placeName(p, regions)).join(', ');
}

/** The same, in full, for the tile's title. */
export function locationTitle(f, regions) {
  const list = placesOf(f).filter((p) => p.locationRegion ? regions && regions[p.locationRegion] : p.maxDistance);
  return list.length ? list.map((p) => placeText(p, regions)).join('; ') : null;
}
