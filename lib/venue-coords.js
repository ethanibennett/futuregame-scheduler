'use strict';
/*
 * Venue coordinates from data, for every live venue the curated client maps don't cover.
 *
 * Both location filters (radius and region) exclude an event whose venue has no coordinate, and
 * the client only knows coordinates for rooms someone hand-added to VENUE_MAP / PROPERTY_COORDS /
 * VENUE_COORDS. On 2026-10-08 that hid 423 upcoming events at 32 of 92 live venues — every new
 * room or series was invisible to location search until a person typed its coordinates in.
 *
 * This module answers "where is this venue" from what the sources themselves publish, in order:
 *
 *   1. coordinates the FEED ROW carries (venue_lat / venue_lng — the watcher change in
 *      docs/venue-coords.md emits PokerAtlas's own coordinates per row);
 *   2. the hosting room (`property`) looked up by exact name in the PokerAtlas venue directory,
 *      whose entries carry real latitude/longitude (data/venue-directory.json);
 *   3. Nominatim — the service /api/geocode already uses — for "<room>, <town>", and only when
 *      the source named BOTH (a WSOP.com stop page names its room and town; PokerAtlas rows
 *      outside its directory would name them through venue_location once the watcher emits it);
 *   4. Nominatim for the town alone ("city-level", the standard PROPERTY_COORDS already uses).
 *
 * It never geocodes a bare room name, and never derives a place from a series title: "Riverside
 * Casino" is in Iowa and in Laughlin, "Panama City" is in Florida and in Panama. A venue the
 * sources do not place stays unresolved and is reported as such.
 *
 * Regions are what LOCATION_REGIONS tests: a US state's postal code, 'CA-<province>' for Canada
 * (the existing 'CA-QC' convention — bare 'CA' is California), otherwise the ISO 3166-1 country
 * code. Where that code is ALSO a US postal code the country's name is used instead, after the
 * existing 'MACAU' entry: Panama's 'PA' is Pennsylvania and Germany's 'DE' is Delaware, and both
 * would otherwise land in the "Northeast US" filter.
 */

const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
};
const CA_PROVINCES = {
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories', NU: 'Nunavut',
  ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon',
};
// ISO 3166-1 codes that are also US postal codes → the name used as the region instead.
const COLLIDING_COUNTRIES = {
  AL: 'ALBANIA', AR: 'ARGENTINA', AZ: 'AZERBAIJAN', CO: 'COLOMBIA', DE: 'GERMANY', GA: 'GABON',
  ID: 'INDONESIA', IL: 'ISRAEL', IN: 'INDIA', KY: 'CAYMAN ISLANDS', LA: 'LAOS', MA: 'MOROCCO',
  MD: 'MOLDOVA', ME: 'MONTENEGRO', MN: 'MONGOLIA', MO: 'MACAU', MS: 'MONTSERRAT', MT: 'MALTA',
  NC: 'NEW CALEDONIA', NE: 'NIGER', PA: 'PANAMA', SC: 'SEYCHELLES', SD: 'SUDAN', TN: 'TUNISIA',
  VA: 'VATICAN',
};
// Country names as they appear at the END of a source's location string. Only needed where a
// source gives a name and no code; WSOP.com gives both, and anything unlisted is placed by
// reverse geocoding the coordinates instead.
const COUNTRY_BY_NAME = {
  'united states': 'US', 'united states of america': 'US', usa: 'US', us: 'US',
  canada: 'CA', mexico: 'MX', bahamas: 'BS', 'the bahamas': 'BS', panama: 'PA',
  'czech republic': 'CZ', czechia: 'CZ', slovakia: 'SK', spain: 'ES', france: 'FR',
  italy: 'IT', belgium: 'BE', malta: 'MT', liechtenstein: 'LI', austria: 'AT',
  switzerland: 'CH', germany: 'DE', netherlands: 'NL', 'united kingdom': 'GB', uk: 'GB',
  ireland: 'IE', cyprus: 'CY', australia: 'AU', 'south korea': 'KR', macau: 'MO', macao: 'MO',
  'dominican republic': 'DO', aruba: 'AW', 'sint maarten': 'SX', 'costa rica': 'CR',
  denmark: 'DK', uruguay: 'UY', peru: 'PE', colombia: 'CO', brazil: 'BR', argentina: 'AR',
};

const lc = (s) => String(s || '').trim().toLowerCase();
const byName = (table) => Object.fromEntries(Object.entries(table).map(([k, v]) => [v.toLowerCase(), k]));
const US_BY_NAME = byName(US_STATES);
const CA_BY_NAME = byName(CA_PROVINCES);

// Canonical region for a (country, subdivision) pair; null when the country is unknown.
function regionFor(country, subdivision) {
  const c = String(country || '').toUpperCase();
  if (!c) return null;
  if (c === 'US') return subdivision && US_STATES[subdivision] ? subdivision : null;
  if (c === 'CA') return subdivision && CA_PROVINCES[subdivision] ? `CA-${subdivision}` : 'CANADA';
  return COLLIDING_COUNTRIES[c] || c;
}

// Rough national boxes, used only to refuse a parse the coordinates contradict (PokerAtlas has a
// handful of foreign venues whose city_state ends in a code that is also a US state).
const IN_US = (lat, lng) => lat >= 17 && lat <= 72 && lng >= -180 && lng <= -64;
const IN_CA = (lat, lng) => lat >= 41 && lat <= 84 && lng >= -142 && lng <= -52;

/* "Durant, OK" · "Durant, OK, United States" · "Danville, Virginia, United States" ·
   "Kahnawake, QC, Canada" · "Panama City, Panama" → region, or null when the string does not say.
   `country` (ISO code) wins over anything parsed; lat/lng, when given, veto a contradicting parse. */
function regionFromLocation(location, country, lat, lng) {
  const parts = String(location || '').split(',').map((s) => s.trim()).filter(Boolean);
  let cc = country ? String(country).toUpperCase() : null;
  const last = parts.length ? lc(parts[parts.length - 1]) : '';
  if (parts.length && COUNTRY_BY_NAME[last]) {
    if (!cc) cc = COUNTRY_BY_NAME[last];
    parts.pop();
  }
  const tail = parts.length > 1 ? parts[parts.length - 1] : null; // the first part is the town
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  if (tail && (!cc || cc === 'US')) {
    const code = US_STATES[tail.toUpperCase()] ? tail.toUpperCase() : US_BY_NAME[lc(tail)];
    if (code && (!hasCoords || IN_US(lat, lng))) return code;
  }
  if (tail && (!cc || cc === 'CA')) {
    const code = CA_PROVINCES[tail.toUpperCase()] ? tail.toUpperCase() : CA_BY_NAME[lc(tail)];
    if (code && (!hasCoords || IN_CA(lat, lng))) return `CA-${code}`;
  }
  if (cc && cc !== 'US' && cc !== 'CA') return regionFor(cc);
  return null;
}

// Nominatim's addressdetails → region ('ISO3166-2-lvl4' is "US-OK" / "CA-ON").
function regionFromAddress(address) {
  if (!address) return null;
  const cc = String(address.country_code || '').toUpperCase();
  const iso = String(address['ISO3166-2-lvl4'] || '');
  const sub = iso.includes('-') ? iso.split('-')[1].toUpperCase() : null;
  if (cc === 'US' && !sub && address.state) return US_BY_NAME[lc(address.state)] || null;
  return regionFor(cc, sub);
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8, rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Name comparison for exact matching: case, accents, curly quotes and spacing only.
function normName(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ`]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/* The feed's venue string for a WSOP.com circuit stop — mtt-series-watcher
   src/sources/wsop-circuit.ts seriesNameFrom(), reproduced: page title before "|", dashes to
   spaces, "WSOP Circuit" → "WSOPC", then the slug's year, or the collection year without one. */
function wsopSeriesName(rawTitle, slug, collectedAt) {
  const year = (String(slug).match(/\b(20\d{2})\b/) || [])[1] ||
    String(new Date(collectedAt || Date.now()).getUTCFullYear());
  const clean = decodeEntities(rawTitle).split('|')[0]
    .replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim().replace(/^WSOP\s+Circuit\b/i, 'WSOPC');
  return `${clean} ${year}`;
}

/* The generated directory (scripts/build-venue-directory.js). Lookups are by EXACT room name —
   the feed's `property` is PokerAtlas's own venue_name, so an exact match is the same venue, and
   anything looser would be a guess. Two venues sharing a name resolve only when they stand within
   a few miles of each other (duplicate listings) or the location hint names one's town. */
function loadVenueDirectory(json) {
  const byNameMap = new Map();
  for (const [id, name, cityState, lat, lng] of (json && json.pokeratlas) || []) {
    const key = normName(name);
    if (!key) continue;
    (byNameMap.get(key) || byNameMap.set(key, []).get(key)).push({ id, name, cityState, lat, lng });
  }
  const stops = (json && json.wsop_stops) || {};
  return {
    size: byNameMap.size,
    generatedAt: json && json.generated_at,
    wsopStop: (venue) => stops[venue] || null,
    lookup(property, locationHint) {
      const hits = byNameMap.get(normName(property));
      if (!hits || !hits.length) return null;
      if (hits.every((h) => haversineMiles(hits[0].lat, hits[0].lng, h.lat, h.lng) <= 3)) return hits[0];
      const hint = normName(locationHint);
      if (!hint) return null;
      const inTown = hits.filter((h) => {
        const town = normName(String(h.cityState).split(',')[0]);
        return town && hint.includes(town);
      });
      return inTown.length === 1 ? inTown[0] : null;
    },
  };
}

/* Nominatim, one request at a time and no faster than its usage policy allows (1/s). `fetchImpl`
   is injectable for tests. Errors resolve to null — a failed lookup leaves a venue unresolved
   for this pass, never wrongly placed. */
function makeNominatim({ fetchImpl = globalThis.fetch, userAgent, minIntervalMs = 1100, base = 'https://nominatim.openstreetmap.org' } = {}) {
  let chain = Promise.resolve();
  let last = 0;
  const call = (url) => {
    const run = chain.then(async () => {
      const wait = last + minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      try {
        const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent, 'Accept-Language': 'en' } });
        if (!res.ok) return null;
        return await res.json();
      } catch (_) { return null; }
    });
    chain = run.catch(() => {});
    return run;
  };
  return {
    async search(q, countryCode) {
      const cc = countryCode ? `&countrycodes=${encodeURIComponent(String(countryCode).toLowerCase())}` : '';
      const data = await call(`${base}/search?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1${cc}`);
      const r = Array.isArray(data) && data[0];
      if (!r) return null;
      const lat = parseFloat(r.lat), lng = parseFloat(r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng, region: regionFromAddress(r.address), display: r.display_name };
    },
    async reverse(lat, lng) {
      const r = await call(`${base}/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10&addressdetails=1`);
      return r && r.address ? regionFromAddress(r.address) : null;
    },
  };
}

const round5 = (n) => Math.round(n * 1e5) / 1e5;
const validLatLng = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) &&
  Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/* Resolve one venue. `info` = { venue, property, hint: { lat, lng, location, country } }.
   `existing` is the venue's stored row (or null): network answers are reused from it rather than
   asked again, and a recent miss for the same query is not retried for `missTtlMs`.
   Returns { lat, lng, region, source, detail } — lat null for a miss, with `detail` saying why. */
async function resolveVenue(info, { directory, geocoder, existing = null, now = Date.now(), missTtlMs = 24 * 3600e3 }) {
  const hint = info.hint || {};
  const stop = directory ? directory.wsopStop(info.venue) : null;
  const property = info.property || (stop && stop.property) || null;
  const location = hint.location || (stop && stop.location) || null;
  const country = hint.country || (stop && stop.country) || null;

  const sameSpot = (lat, lng) => existing && existing.lat != null &&
    Math.abs(existing.lat - lat) < 1e-5 && Math.abs(existing.lng - lng) < 1e-5;
  const regionOf = async (lat, lng, ...texts) => {
    for (const [loc, cc] of texts) {
      const r = regionFromLocation(loc, cc, lat, lng);
      if (r) return r;
    }
    if (sameSpot(lat, lng) && existing.region) return existing.region;
    return geocoder ? geocoder.reverse(lat, lng) : null;
  };

  // 1. The feed row's own coordinates.
  const hlat = Number(hint.lat), hlng = Number(hint.lng);
  if (hint.lat != null && hint.lng != null && validLatLng(hlat, hlng)) {
    const lat = round5(hlat), lng = round5(hlng);
    const region = hint.region || await regionOf(lat, lng, [location, country]);
    return { lat, lng, region, source: 'feed', detail: location || null };
  }

  // 2. The room, by exact name, in the PokerAtlas directory.
  if (property && directory) {
    const hit = directory.lookup(property, location);
    if (hit) {
      const region = await regionOf(hit.lat, hit.lng, [hit.cityState, null], [location, country]);
      return { lat: hit.lat, lng: hit.lng, region, source: 'pokeratlas', detail: `pa:${hit.id} ${hit.name}, ${hit.cityState}`.trim() };
    }
  }

  // 3/4. Nominatim — only for what the source named: the room in its town, else the town.
  const queries = [];
  if (property && location) queries.push(['nominatim', `${property}, ${location}`]);
  if (location) queries.push(['nominatim-city', location]);
  if (!queries.length) {
    return { lat: null, lng: null, region: null, source: 'unresolved',
      detail: property ? `room "${property}" is not in the PokerAtlas directory and the feed names no town` : 'the feed names no room and no town' };
  }
  const missKey = queries.map(([, q]) => q).join(' | ');
  // A recent miss on exactly these queries is not asked again until it ages out.
  if (existing && existing.lat == null && existing.detail === missKey &&
      now - (Date.parse(existing.updated_at) || 0) < missTtlMs) {
    return { lat: null, lng: null, region: null, source: 'unresolved', detail: missKey, cached: true };
  }
  const expectRegion = regionFromLocation(location, country);
  for (const [source, q] of queries) {
    if (existing && existing.detail === q && existing.lat != null && existing.source === source) {
      return { lat: existing.lat, lng: existing.lng, region: existing.region, source, detail: q };
    }
    if (!geocoder) continue;
    const r = await geocoder.search(q, country);
    if (!r) continue;
    // The answer must sit in the state/country the source named, or it is a different place.
    if (expectRegion && r.region && r.region !== expectRegion) continue;
    return { lat: round5(r.lat), lng: round5(r.lng), region: r.region || expectRegion, source, detail: q };
  }
  return { lat: null, lng: null, region: null, source: 'unresolved', detail: missKey };
}

module.exports = {
  regionFor, regionFromLocation, regionFromAddress, normName, wsopSeriesName,
  loadVenueDirectory, makeNominatim, resolveVenue, haversineMiles, validLatLng,
  US_STATES, CA_PROVINCES,
};
