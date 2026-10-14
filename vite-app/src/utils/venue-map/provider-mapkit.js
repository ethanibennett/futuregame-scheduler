/* Apple Maps through MapKit JS: the venue map's provider on the web, iPhone, iPad and the Mac app
 * (and Android's second choice), once the owner has a MapKit JS key (docs/venue-map.md).
 *
 * Configured = GET /api/mapkit-token answers with a token; the server signs a 30-minute one with
 * the team's key (lib/map-providers.js), and MapKit asks for a fresh one through
 * authorizationCallback whenever it needs to. MapKit JS loads from Apple's CDN (major version 6,
 * mapkit.core.js with only the map and annotations libraries) the first time a popup draws with
 * it, and is initialised once per page.
 *
 * A refused token (MapKit's 'error' event: Unauthorized, Too Many Requests, ...) or a CDN that
 * does not load rejects the mount, so the popup falls back to OpenStreetMap, and MapKit is not
 * tried again until the page reloads.
 */
import { API_URL } from '../api.js';
import { brandColour, loadScript, within } from './providers.js';

const CDN = 'https://cdn.apple-mapkit.com/mk/6/mapkit.core.js';
const LIBRARIES = ['map', 'annotations'];

let broken = false;
let probe = null;          // Promise<boolean>: does the server have a key?
let ready = null;          // Promise<mapkit>: loaded and initialised

async function fetchToken() {
  const r = await fetch(`${API_URL}/mapkit-token`, { cache: 'no-store' });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j && j.configured && j.token ? j.token : null;
}

function loadMapKit() {
  if (ready) return ready;
  ready = (async () => {
    // mapkit.core.js calls the named callback once it has loaded (data-callback is required).
    const loaded = new Promise((resolve) => { window.__fgMapKitLoaded = () => resolve(); });
    await loadScript(CDN, { crossOrigin: 'anonymous', 'data-callback': '__fgMapKitLoaded', 'data-libraries': LIBRARIES.join(',') });
    await within(loaded, 15000, 'MapKit JS');
    const mk = window.mapkit;
    if (!mk) throw new Error('MapKit JS did not define mapkit');
    // Initialised: 'configuration-change' with status Initialized; refused: 'error'.
    const initialised = new Promise((resolve, reject) => {
      const onChange = (e) => { if (e.status === 'Initialized' || e.status === 'Refreshed') { cleanup(); resolve(); } };
      const onError = (e) => { cleanup(); reject(new Error('MapKit JS: ' + (e && e.status ? e.status : 'error'))); };
      const cleanup = () => { mk.removeEventListener('configuration-change', onChange); mk.removeEventListener('error', onError); };
      mk.addEventListener('configuration-change', onChange);
      mk.addEventListener('error', onError);
    });
    mk.init({
      authorizationCallback: (done) => { fetchToken().then((t) => done(t || '')).catch(() => done('')); },
      language: (typeof navigator !== 'undefined' && navigator.language) || 'en-US',
    });
    await within(initialised, 15000, 'MapKit JS authorisation');
    // The libraries named on the script tag; load() resolves at once for any already loaded.
    if (typeof mk.load === 'function') await within(Promise.resolve(mk.load(LIBRARIES)), 15000, 'MapKit JS libraries');
    // Later failures (a refresh refused mid-session) mark MapKit broken for the next popup.
    mk.addEventListener('error', () => { broken = true; });
    return mk;
  })();
  ready.catch(() => { broken = true; ready = null; });
  return ready;
}

// The region a zoom-13 web map shows over a box this size (256px tiles), so every provider frames
// the pin alike.
function spanFor(el, lat, zoom = 13) {
  const w = el.clientWidth || 1, h = el.clientHeight || 1;
  const lngSpan = (360 / 2 ** zoom) * (w / 256);
  const latSpan = lngSpan * (h / w) * Math.cos((lat * Math.PI) / 180);
  return [latSpan, lngSpan];
}

export default {
  id: 'mapkit',
  async available() {
    if (broken) return false;
    if (!probe) probe = fetch(`${API_URL}/mapkit-token`, { cache: 'no-store' }).then((r) => r.ok).catch(() => { probe = null; return false; });
    return probe;
  },
  async mount(el, { lat, lng, title, theme }) {
    const mk = await loadMapKit();
    const at = new mk.Coordinate(lat, lng);
    const [dLat, dLng] = spanFor(el, lat);
    const schemes = mk.ColorScheme || (mk.Map && mk.Map.ColorSchemes) || {};
    const map = new mk.Map(el, {
      region: new mk.CoordinateRegion(at, new mk.CoordinateSpan(dLat, dLng)),
      colorScheme: theme === 'dark' ? (schemes.Dark || 'dark') : (schemes.Light || 'light'),
      // The popup's buttons are the controls; MapKit's own would sit off the app's grid.
      showsZoomControl: false,
      showsMapTypeControl: false,
      showsCompass: mk.FeatureVisibility ? mk.FeatureVisibility.Hidden : 'hidden',
      showsScale: mk.FeatureVisibility ? mk.FeatureVisibility.Hidden : 'hidden',
      isRotationEnabled: false,
    });
    const marker = new mk.MarkerAnnotation(at, { title: title || '', color: brandColour(), selected: true });
    map.addAnnotation(marker);
    return { destroy() { try { map.removeAnnotation(marker); } catch (_) { /* gone */ } map.destroy(); } };
  },
};
