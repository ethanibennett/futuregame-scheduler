import { API_URL } from './api.js';
import { stateCodeFrom } from './online-sites.js';

/* Where the chosen location lives.
 *
 * localStorage is the immediate store: it paints on load without a round trip,
 * and it is the only store a guest has. The server copy is what makes the
 * choice follow the user — a region picked on the desktop did not exist on the
 * phone, because localStorage is per-browser by definition.
 *
 * Both hold the same location fields the filter state already uses, so neither
 * side has to know the other's shape.
 *
 * `jurisdiction` rides along because it is the same kind of fact — a standing
 * answer about where the user is, not a filter they set for one look at the
 * list — and because it is the one field that can be set with no location at
 * all: a player who never picks a radius can still say "I am in Nevada", and
 * the emptiness test below has to count that as something worth saving.
 */
const KEY = 'savedLocation';

/* `jurisdiction` is a postal code ("PA"). Until 2026-10 the first-run wizard's "Use my location"
   stored the reverse lookup's state NAME in capitals ("PENNSYLVANIA", or "ÎLE-DE-FRANCE" abroad)
   and marked it as picked by hand, so availability never matched and no later lookup could
   correct it. Repaired wherever a stored location is read: a value that is already a code is
   left alone; one that needed repair came from a lookup, not a pick, so it is not manual. */
export function repairJurisdiction(loc) {
  if (!loc || typeof loc !== 'object' || !loc.jurisdiction) return loc;
  const code = stateCodeFrom(loc.jurisdiction);
  if (code === loc.jurisdiction) return loc;
  return { ...loc, jurisdiction: code, jurisdictionManual: false };
}

export function readLocalLocation() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? repairJurisdiction(JSON.parse(raw)) : null;
  } catch (e) {
    return null;
  }
}

export function writeLocalLocation(loc) {
  try {
    if (loc && (loc.userLocation || loc.locationRegion || loc.jurisdiction)) {
      localStorage.setItem(KEY, JSON.stringify(loc));
    } else {
      localStorage.removeItem(KEY);
    }
  } catch (e) {
    // A private window with storage blocked still gets a working filter for
    // this session; it just will not survive the reload.
  }
}

/* Pull the account's copy. Returns undefined when there is nothing to say —
 * no token, a guest, or the request failed — so the caller can tell "the
 * server has no opinion" from "the server says none", which is a real
 * distinction: the second should clear a stale local value and the first
 * must not.
 */
export async function fetchServerLocation(token) {
  if (!token) return undefined;
  // A push still in flight is newer than what the server holds: a view that mounts right after
  // first-run setup saved a location would otherwise GET the old copy, adopt it, and push it back.
  if (inflight) await inflight;
  try {
    const res = await fetch(`${API_URL}/user/location`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    return data && Object.prototype.hasOwnProperty.call(data, 'location') ? repairJurisdiction(data.location) : undefined;
  } catch (e) {
    return undefined;
  }
}

/* Fire and forget: the local copy has already been written, so a failed push
 * costs the user nothing this session and is retried by the next change. The
 * last push is kept (errors swallowed) so fetchServerLocation can wait for it.
 */
let inflight = null;
export function pushServerLocation(token, loc) {
  if (!token) return;
  const body = (loc && (loc.userLocation || loc.locationRegion || loc.jurisdiction)) ? loc : null;
  const p = fetch(`${API_URL}/user/location`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: body }),
  }).then(() => {}, () => {});
  inflight = p;
  p.then(() => { if (inflight === p) inflight = null; });
  return p;
}

export function sameLocation(a, b) {
  const norm = l => JSON.stringify({
    userLocation: (l && l.userLocation) || null,
    locationRegion: (l && l.locationRegion) || null,
    maxDistance: (l && l.maxDistance) || '',
    locationLabel: (l && l.locationLabel) || null,
    jurisdiction: (l && l.jurisdiction) || null,
    jurisdictionManual: !!(l && l.jurisdictionManual),
  });
  return norm(a) === norm(b);
}

/* ── Onboarding filter prefs ────────────────────────────────────────────────
 * The first-run wizard sets more than location — games, buy-in band, whether to
 * show online play. Those are NOT location, so they live in their own key. Only
 * the fields the wizard actually writes are stored; TournamentsView merges them
 * over DEFAULT_FILTERS at init (location still comes from savedLocation above).
 * localStorage-only: they are per-browser conveniences, not account facts, and a
 * blocked store just falls back to defaults for the session.
 */
const FILTERS_KEY = 'savedFilters';

export function readLocalFilters() {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function writeLocalFilters(f) {
  try {
    if (f && Object.keys(f).length) localStorage.setItem(FILTERS_KEY, JSON.stringify(f));
    else localStorage.removeItem(FILTERS_KEY);
  } catch (e) { /* private window: session-only, fine */ }
}

/* Live-only defaults (launch plan, action 3; 2026-10-15): a new browser starts with online events
 * OFF and "available in my state" ON. Only non-default filters are saved, so flipping those
 * defaults would silently change the list for every browser already using the app. Once per
 * browser, before the first read: a browser with any sign of earlier use (saved filters
 * or location, finished setup) has its CURRENT online choices written down explicitly, so it keeps
 * what it sees; a brand-new browser writes nothing and gets the new defaults. Returns what it did. */
export const LIVE_ONLY_DEFAULTS_KEY = 'liveOnlyDefaults';
export function migrateLiveOnlyDefaults() {
  try {
    if (localStorage.getItem(LIVE_ONLY_DEFAULTS_KEY)) return 'done';
    const used = !!(localStorage.getItem(FILTERS_KEY)
      || localStorage.getItem(KEY) || localStorage.getItem('onboarded'));
    if (used) {
      const f = readLocalFilters() || {};
      // The old defaults: online shown, the state filter off. Keep whichever the browser was on.
      if (f.showOnline === undefined) f.showOnline = true;
      if (f.onlyAvailableOnline === undefined) f.onlyAvailableOnline = false;
      writeLocalFilters(f);
    }
    localStorage.setItem(LIVE_ONLY_DEFAULTS_KEY, '1');
    return used ? 'kept' : 'new';
  } catch (e) { return 'unavailable'; }
}

/* One flag, set the first time setup is finished or skipped, so it never
 * auto-opens again. The user can still reopen it by hand. Since 2026-10 this is
 * only a per-browser CACHE of the account's own answer (users.onboarding, see
 * utils/onboarding.js): a sign-in to an account that has never finished setup
 * clears it, so a shared browser does not hand one user's "done" to the next. */
export function hasOnboarded() {
  try { return localStorage.getItem('onboarded') === '1'; } catch (e) { return true; }
}
export function markOnboarded() {
  try { localStorage.setItem('onboarded', '1'); } catch (e) { /* ignore */ }
}
export function clearOnboarded() {
  try { localStorage.removeItem('onboarded'); } catch (e) { /* ignore */ }
}
