import { getVenueInfo, getVenueCoords, isOnline, haversineDistance } from './utils.js';

/* Where an event's room is, for the venue map (docs/venue-map.md). Pure: what the app already
 * knows, never a guess. The popup adds the server's answer (GET /api/venue-place: the town, and its
 * own placement for a venue the client's maps lack, as on the shared-schedule page, which does
 * not load /api/venue-coords).
 */

// A room someone can drive to. Online events have no place, and 'Personal' rows (travel and rest
// days) are not at a venue: their strips keep their old behaviour and get no map.
export function hasVenueMap(t) {
  return !!(t && t.venue && t.venue !== 'Personal' && !isOnline(t));
}

/* The room's name: the feed's `property` is the room by contract. Without one, a curated entry's
   longName is the room by convention for feed-era series ("WSOPC " is a display prefix), and the
   legacy entries' longName is what their strip has always said. */
export function venueRoomName(t) {
  if (!t) return '';
  if (t.property) return String(t.property);
  const info = getVenueInfo(t.venue, t.property);
  const long = (info && info.longName ? String(info.longName) : '').replace(/^WSOPC\s+/, '');
  return long || String(t.venue || '');
}

// The client's own placement: curated maps first, then the server-placed ones (getVenueCoords).
export function venuePlace(t) {
  const c = t ? getVenueCoords(t.venue, t.property) : null;
  return {
    name: venueRoomName(t),
    venue: t ? t.venue : '',
    property: t && t.property ? t.property : null,
    coords: c ? { lat: c.lat, lng: c.lng } : null,
    approx: !!(c && c.approx),
    region: c && c.region ? c.region : null,
  };
}

/* "48 mi from Philadelphia" — from the user's saved location (location-prefs.js savedLocation:
   userLocation + locationLabel). Null without a point to measure from. */
export function distanceLine(coords, saved) {
  const from = saved && saved.userLocation;
  if (!coords || !from || !Number.isFinite(Number(from.lat)) || !Number.isFinite(Number(from.lng))) return null;
  const mi = haversineDistance(Number(from.lat), Number(from.lng), coords.lat, coords.lng);
  if (!Number.isFinite(mi)) return null;
  const n = mi < 10 ? (Math.round(mi * 10) / 10).toLocaleString('en-US') : Math.round(mi).toLocaleString('en-US');
  const label = String((saved && saved.locationLabel) || '').split(',')[0].trim();
  const where = !label || /^current location$/i.test(label) ? 'your location' : label;
  return `${n} mi from ${where}`;
}

/* The two hand-offs. With coordinates: Apple Maps at the pin with the room's name (opens the Maps
   app on iOS and the Mac), Google Maps at the coordinates. Without: a search for the room and its
   town in each. */
export function mapsLinks({ name, town, coords }) {
  if (coords) {
    const ll = `${coords.lat},${coords.lng}`;
    return {
      search: false,
      apple: `https://maps.apple.com/?q=${encodeURIComponent(name || 'Venue')}&ll=${ll}`,
      google: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ll)}`,
    };
  }
  const q = [name, town].filter(Boolean).join(', ');
  return {
    search: true,
    apple: `https://maps.apple.com/?q=${encodeURIComponent(q)}`,
    google: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`,
  };
}

// The app's theme, as a map's colour scheme: light, cloudy and swiss-light are light grounds.
export function mapTheme() {
  if (typeof document === 'undefined') return 'dark';
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'cloudy' || t === 'swiss-light' ? 'light' : 'dark';
}
