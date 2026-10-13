/* First-run setup (components/OnboardingWizard.jsx; docs/onboarding.md).
 *
 * Three optional questions — where you play live, whether you play online, what you play — each
 * preset to a default and each writing the SAME stores the filters already use: `savedLocation`
 * (the location and the state, location-prefs.js) and `savedFilters` (the Schedule's standing
 * choices, TournamentsView's persistence). Nothing here has a store of its own; an old account's
 * answers are read straight back into the new controls (answersFrom), and only the rows a user
 * actually changes are written (filtersFrom, locationFrom), so every other filter they set survives.
 *
 * Whether the account has finished setup is the account's fact, not the browser's:
 * `users.onboarding` on the server (GET/PUT /api/user/onboarding). `localStorage.onboarded` is the
 * per-browser cache of it (location-prefs.js hasOnboarded).
 *
 * Pure apart from the three server helpers at the foot, so node --test can run it
 * (src/utils/__tests__/onboarding.test.mjs).
 */
import { API_URL } from './api.js';
import {
  LOCATION_REGIONS, REGION_JURISDICTION, matchesLocation, matchesOnline, matchesGames, matchesBuyin,
  isOnline, normaliseDate,
} from './utils.js';
import { stateCodeFrom } from './online-sites.js';
import { readLocalFilters, writeLocalFilters, repairJurisdiction } from './location-prefs.js';

// ── The choices ────────────────────────────────────────────────────────────────────────────────
// Step 1's region grid, two to a row: Las Vegas | Texas / Florida | Northeast US / Europe | Everywhere.
export const SETUP_REGION_ORDER = ['lasvegas', 'texas', 'florida', 'northeast', 'europe', 'everywhere'];
export const REGION_LABEL = { ...Object.fromEntries(Object.entries(LOCATION_REGIONS).map(([k, v]) => [k, v.label])), everywhere: 'Everywhere' };
// Whether a region is in the US: decides whether step 2 asks for a state at all.
export const REGION_COUNTRY = { lasvegas: 'US', texas: 'US', florida: 'US', northeast: 'US', europe: 'other' };
// The distance chips, in miles (maxDistance is a numeric string, as the location menu stores it).
export const RADII = ['50', '100', '250'];
export const DEFAULT_RADIUS = '100';
export const GAME_CHIPS = [
  { key: 'NLH', label: 'NLH' },
  { key: 'PLO', label: 'PLO' },
  { key: 'Mixed', label: 'Mixed' },
];
// The filter sheet's buy-in bands (TournamentsView), four chips: $5K+ is the sheet's top two bands.
export const BUYIN_CHIPS = [
  { key: 'low', label: 'Under $500', ranges: ['0-500'] },
  { key: 'mid', label: '$500–1.5K', ranges: ['500-1500'] },
  { key: 'high', label: '$1.5K–5K', ranges: ['1500-5000'] },
  { key: 'roller', label: '$5K+', ranges: ['5000-10000', '10000+'] },
];
// The five savedFilters keys setup writes, at TournamentsView's DEFAULT_FILTERS values. A key at
// its default is not stored, as TournamentsView's own persistence does.
export const WIZARD_DEFAULTS = { selectedGames: [], mixedOnly: false, buyinRanges: [], showOnline: true, onlyAvailableOnline: false };
export const WIZARD_KEYS = Object.keys(WIZARD_DEFAULTS);
// Which step each answer row belongs to: Skip saves only the steps already confirmed with Next.
export const ROW_STEP = { place: 0, radius: 0, state: 1, online: 1, sites: 1, games: 2, buyins: 2 };
export const ALL_ROWS = Object.fromEntries(Object.keys(ROW_STEP).map(k => [k, true]));

// ── Copy (docs/onboarding.md quotes these word for word) ────────────────────────────────────────
export const STEP_TITLES = ['Where do you play live?', 'Do you play online too?', 'What do you play?'];
export const STEP_LEADS = [
  "We'll show the events near you. Change it anytime from the location button on the Schedule.",
  'Online tournaments show in your list next to live ones.',
  'Pick any that apply. Leave a row empty to see everything.',
];
export const LOCATE_ERRORS = {
  denied: 'Location is off for futurega.me. Search a city or pick a region instead.',
  unavailable: "Couldn't get a location fix. Search a city or pick a region instead.",
  timeout: 'Finding you took too long. Try again, or search a city.',
  insecure: 'Location needs a secure page (it works in the app). Search a city instead.',
  unsupported: "This device can't share its location. Search a city instead.",
  search: "Couldn't search right now. Pick a region instead.",
};

const hasOwn = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const countryOf = (code) => (code ? (String(code).toUpperCase() === 'US' ? 'US' : 'other') : null);

/* The stored values, read back into the controls. Every value an older setup or the filter bar
   could have stored lands on a control (or is carried untouched):
     location   'Current Location' point -> the location tile; any other point -> a picked place
                (its label); a region -> that cell; nothing -> Everywhere
     distance   50/100/250 -> that chip; anything else (the menu takes any number) is kept as is
                and shown as "Now: 30 mi" until a chip is tapped
     online     showOnline false -> No; anything else -> Yes
     sites      onlyAvailableOnline as stored; unset -> on for a first run, off for a re-run
     games      NLH / PLO from selectedGames, Mixed from mixedOnly; the filter sheet's other
                variants are carried as gameExtras ("+2 more set in Filters")
     buy-ins    a chip is on when any of its ranges is stored */
export function answersFrom(savedLoc, savedFilters, { firstRun = false } = {}) {
  const loc = repairJurisdiction(savedLoc) || {};
  const f = savedFilters || {};
  let place = { kind: 'everywhere' };
  const pt = loc.userLocation;
  if (pt && Number.isFinite(Number(pt.lat)) && Number.isFinite(Number(pt.lng))) {
    place = loc.locationLabel === 'Current Location'
      ? { kind: 'current', point: pt, name: null }
      : { kind: 'point', point: pt, label: loc.locationLabel || null };
  } else if (loc.locationRegion && LOCATION_REGIONS[loc.locationRegion]) {
    place = { kind: 'region', region: loc.locationRegion };
  }
  const jurisdiction = stateCodeFrom(loc.jurisdiction) || null;
  const sel = Array.isArray(f.selectedGames) ? f.selectedGames : [];
  const ranges = Array.isArray(f.buyinRanges) ? f.buyinRanges : [];
  return {
    place,
    country: place.kind === 'region' ? (REGION_COUNTRY[place.region] || null) : (jurisdiction ? 'US' : null),
    radius: loc.maxDistance ? String(loc.maxDistance) : DEFAULT_RADIUS,
    jurisdiction,
    jurisdictionManual: !!(jurisdiction && loc.jurisdictionManual),
    online: f.showOnline !== false,
    onlyAvailable: hasOwn(f, 'onlyAvailableOnline') ? !!f.onlyAvailableOnline : !!firstRun,
    games: [
      ...(sel.includes('NLH') ? ['NLH'] : []),
      ...(sel.includes('PLO') ? ['PLO'] : []),
      ...(f.mixedOnly ? ['Mixed'] : []),
    ],
    gameExtras: sel.filter(g => g !== 'NLH' && g !== 'PLO'),
    buyins: BUYIN_CHIPS.filter(c => c.ranges.some(r => ranges.includes(r))).map(c => c.key),
  };
}

/* A new place. `state` is the state the place implies (a region's, a looked-up point's), or null;
   it replaces a worked-out state and never a manual one — someone registered in Nevada and
   standing in an Ohio airport wants the Nevada answer (LocationDropdown's learnJurisdiction rule).
   So choosing Everywhere, Northeast US or Europe clears a worked-out state and keeps a picked one. */
export function choosePlace(a, place, { country = null, state = null } = {}) {
  const next = { ...a, place, country };
  if (!a.jurisdictionManual) { next.jurisdiction = state || null; next.jurisdictionManual = false; }
  return next;
}

export function chooseRegion(a, key) {
  if (key === 'everywhere' || !LOCATION_REGIONS[key]) return choosePlace(a, { kind: 'everywhere' });
  return choosePlace(a, { kind: 'region', region: key }, { country: REGION_COUNTRY[key] || null, state: REGION_JURISDICTION[key] || null });
}

// A search result (GET /api/geocode): { lat, lng, display, short, region, country }.
export function choosePoint(a, r) {
  return choosePlace(a, { kind: 'point', point: { lat: r.lat, lng: r.lng }, label: r.short || r.display || null }, {
    country: countryOf(r.country),
    state: r.country === 'US' ? stateCodeFrom(r.region) : null,
  });
}

/* The reverse lookup for "Use my location" (GET /api/geocode/reverse: { region, country, short }),
   which arrives after the point is already set. Applied only while that same point is still the
   answer; it names the place and, in the US, works out the state. */
export function learnPlace(a, point, d) {
  if (!a.place || a.place.kind !== 'current' || a.place.point !== point || !d) return a;
  const next = { ...a, place: { ...a.place, name: d.short || null }, country: countryOf(d.country) };
  const state = d.country === 'US' ? stateCodeFrom(d.region) : null;
  if (state && !a.jurisdictionManual) { next.jurisdiction = state; next.jurisdictionManual = false; }
  return next;
}

// Step 2's state select: a pick is manual; "Not set" clears it.
export function pickState(a, code) {
  const c = stateCodeFrom(code);
  return c ? { ...a, jurisdiction: c, jurisdictionManual: true } : { ...a, jurisdiction: null, jurisdictionManual: false };
}

// The "Only sites open in <state>" checkbox shows only where it can mean something.
export const sitesShown = (a) => !!(a.online && a.jurisdiction && a.country !== 'other');

const isPoint = (a) => a.place && (a.place.kind === 'current' || a.place.kind === 'point');

/* savedLocation from the answers. Untouched (no location row changed), the stored value comes back
   as it was — a 30-mile radius, a label — so finishing setup never rewrites a location the user did
   not touch. Null means no location at all (Everywhere, no state). */
export function locationFrom(a, prevLoc, touched = ALL_ROWS) {
  if (!touched.place && !touched.radius && !touched.state) {
    const p = repairJurisdiction(prevLoc);
    return p && (p.userLocation || p.locationRegion || p.jurisdiction) ? p : null;
  }
  const loc = {
    userLocation: null, maxDistance: '', locationRegion: null, locationLabel: null,
    jurisdiction: a.jurisdiction || null,
    jurisdictionManual: !!(a.jurisdiction && a.jurisdictionManual),
  };
  if (isPoint(a)) {
    loc.userLocation = { lat: Number(a.place.point.lat), lng: Number(a.place.point.lng) };
    loc.maxDistance = String(a.radius || DEFAULT_RADIUS);
    // 'Current Location' is the location menu's own label for the device's position: its tick reads it.
    loc.locationLabel = a.place.kind === 'current' ? 'Current Location' : (a.place.label || null);
  } else if (a.place && a.place.kind === 'region') {
    loc.locationRegion = a.place.region;
  }
  return loc.userLocation || loc.locationRegion || loc.jurisdiction ? loc : null;
}

const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

/* savedFilters from the answers, merged over what is stored. Only setup's five keys can change, and
   only for a row the user touched: an untouched row is written back exactly as stored (the filter
   sheet's Razz stays), and every other key — siteRules, Side Events, Satellites — is kept. A key at
   its default is deleted, as TournamentsView stores it. Touching Games replaces selectedGames with
   the chips (the sheet's extras go) and mixedOnly with the Mixed chip; $5K+ is both top bands. */
export function filtersFrom(a, prev, touched = ALL_ROWS) {
  const out = { ...(prev || {}) };
  const set = (k, v) => { if (same(v, WIZARD_DEFAULTS[k])) delete out[k]; else out[k] = v; };
  if (touched.games) {
    set('selectedGames', GAME_CHIPS.filter(c => c.key !== 'Mixed' && a.games.includes(c.key)).map(c => c.key));
    set('mixedOnly', a.games.includes('Mixed'));
  }
  if (touched.buyins) set('buyinRanges', BUYIN_CHIPS.filter(c => a.buyins.includes(c.key)).flatMap(c => c.ranges));
  if (touched.online) set('showOnline', !!a.online);
  if (touched.sites) set('onlyAvailableOnline', !!a.onlyAvailable);
  return out;
}

// Setup's own keys of a savedFilters blob, defaults left out: what users.onboarding keeps.
export function wizardSubset(f) {
  const out = {};
  for (const k of WIZARD_KEYS) if (hasOwn(f, k) && !same(f[k], WIZARD_DEFAULTS[k])) out[k] = f[k];
  return out;
}

/* The live count under every step: the upcoming events the answers so far would list. The same
   predicates as the Schedule list (matchesLocation / matchesOnline / matchesGames / matchesBuyin)
   and its default Satellites and Day 2 filters; Personal entries are not events to go and play.
   `filters` is the merged savedFilters (siteRules included), `loc` the merged savedLocation. */
export function countSetup(tournaments, loc, filters, todayIso) {
  const f = { ...(filters || {}), ...(loc || {}) };
  let live = 0, online = 0;
  for (const t of tournaments || []) {
    if (!t || t.venue === 'Personal') continue;
    const d = normaliseDate(t.date);
    if (!d || (todayIso && d < todayIso)) continue;
    if (t.is_satellite || t.is_restart) continue;
    if (!matchesLocation(t, f) || !matchesOnline(t, f) || !matchesGames(t, f) || !matchesBuyin(t, f)) continue;
    if (isOnline(t)) online++; else live++;
  }
  return { live, online };
}

export const isLocated = (loc) => !!(loc && ((loc.userLocation && loc.maxDistance) || loc.locationRegion));

const fmt = (n) => Number(n).toLocaleString('en-US');

// "1,204 live events near you · 890 online"; '' until the tournaments have loaded.
export function statusLine(counts, { located = false, showOnline = true } = {}) {
  if (!counts) return '';
  const { live, online } = counts;
  if (live + (showOnline ? online : 0) === 0) return 'Nothing upcoming matches all of this. Loosen a choice.';
  let s = `${fmt(live)} live event${live === 1 ? '' : 's'}${located ? ' near you' : ''}`;
  if (showOnline) s += ` · ${fmt(online)} online`;
  return s;
}

// The last step's button: "Show 2,094 events", or "Show events" when the count is unknown or 0.
export function showLabel(counts, { showOnline = true } = {}) {
  const n = counts ? counts.live + (showOnline ? counts.online : 0) : 0;
  return n > 0 ? `Show ${fmt(n)} event${n === 1 ? '' : 's'}` : 'Show events';
}

// ── The account's record (users.onboarding) ───────────────────────────────────────────────────
/* undefined: no answer (no token, offline, an older server); null: the account has never finished
   or skipped setup; an object: it has ({v:1, legacy:true} for every account older than this, or
   {v:2, at, skipped, filters}). */
export async function fetchServerOnboarding(token) {
  if (!token) return undefined;
  try {
    const res = await fetch(`${API_URL}/user/onboarding`, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return undefined;
    const d = await res.json();
    return hasOwn(d, 'onboarding') ? (d.onboarding || null) : undefined;
  } catch (e) {
    return undefined;
  }
}

// Fire and forget, like pushServerLocation: the local flag is already set.
export function pushServerOnboarding(token, body) {
  if (!token) return undefined;
  return fetch(`${API_URL}/user/onboarding`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then(() => {}, () => {});
}

/* A device signing in to an account that has finished setup elsewhere: if this device has no
   savedFilters of its own, it starts from the answers the account gave (the location already
   follows the account through /api/user/location). A device with its own filters keeps them. The
   account keeps its last SETUP answers, not every later change made in the filter bar. */
export function adoptServerOnboarding(rec) {
  if (!rec || rec.v !== 2 || !rec.filters || typeof rec.filters !== 'object') return false;
  if (readLocalFilters()) return false;
  const out = wizardSubset(rec.filters);
  if (!Object.keys(out).length) return false;
  writeLocalFilters(out);
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('onboarding-applied', { detail: { filters: { ...WIZARD_DEFAULTS, ...out } } }));
  }
  return true;
}
