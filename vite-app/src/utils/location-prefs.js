import { API_URL } from './api.js';

/* Where the chosen location lives.
 *
 * localStorage is the immediate store: it paints on load without a round trip,
 * and it is the only store a guest has. The server copy is what makes the
 * choice follow the user — a region picked on the desktop did not exist on the
 * phone, because localStorage is per-browser by definition.
 *
 * Both hold the same four fields the filter state already uses, so neither side
 * has to know the other's shape.
 */
const KEY = 'savedLocation';

export function readLocalLocation() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function writeLocalLocation(loc) {
  try {
    if (loc && (loc.userLocation || loc.locationRegion)) {
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
  try {
    const res = await fetch(`${API_URL}/api/user/location`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    return data && Object.prototype.hasOwnProperty.call(data, 'location') ? data.location : undefined;
  } catch (e) {
    return undefined;
  }
}

/* Fire and forget: the local copy has already been written, so a failed push
 * costs the user nothing this session and is retried by the next change.
 */
export function pushServerLocation(token, loc) {
  if (!token) return;
  const body = (loc && (loc.userLocation || loc.locationRegion)) ? loc : null;
  fetch(`${API_URL}/api/user/location`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: body }),
  }).catch(() => {});
}

export function sameLocation(a, b) {
  const norm = l => JSON.stringify({
    userLocation: (l && l.userLocation) || null,
    locationRegion: (l && l.locationRegion) || null,
    maxDistance: (l && l.maxDistance) || '',
    locationLabel: (l && l.locationLabel) || null,
  });
  return norm(a) === norm(b);
}
