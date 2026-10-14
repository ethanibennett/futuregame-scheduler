/* Google Maps through the Maps JavaScript API: the venue map's provider in the Android app only
 * (providers.js providerOrder), drawn in the popup's web view like the others.
 *
 * Configured = GET /api/google-maps-config answers with the browser key (GOOGLE_MAPS_BROWSER_KEY,
 * restricted by Google to the Maps JavaScript API and the app's origins) and, when set, a Map ID
 * (GOOGLE_MAPS_MAP_ID). The API loads the documented way — the script with key, v=weekly,
 * loading=async and a callback — and the map and marker come from google.maps.importLibrary().
 * With a Map ID the pin is an AdvancedMarkerElement (which needs one); without, the classic Marker.
 * The colour scheme follows the app's theme (ColorScheme from the 'core' library; set once, at
 * creation, as the API requires).
 *
 * A key Google refuses calls window.gm_authFailure: the mount rejects (the popup falls back to
 * MapKit, then OpenStreetMap) and Google is not tried again until the page reloads.
 */
import { API_URL } from '../api.js';
import { brandColour, loadScript, within } from './providers.js';

let broken = false;
let config = null;         // Promise<{ key, mapId } | null>
let authFailed = null;     // the current mount's reject, for gm_authFailure

function getConfig() {
  if (!config) {
    config = fetch(`${API_URL}/google-maps-config`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && j.configured && j.key ? { key: j.key, mapId: j.mapId || null } : null))
      .catch(() => { config = null; return null; });
  }
  return config;
}

async function loadGoogle(key) {
  if (window.google && window.google.maps && typeof window.google.maps.importLibrary === 'function') return window.google.maps;
  window.gm_authFailure = () => { broken = true; if (authFailed) authFailed(new Error('Google Maps refused the key')); };
  const loaded = new Promise((resolve) => { window.__fgGoogleMapsLoaded = () => resolve(); });
  const q = new URLSearchParams({ key, v: 'weekly', loading: 'async', callback: '__fgGoogleMapsLoaded' });
  await loadScript(`https://maps.googleapis.com/maps/api/js?${q}`);
  await within(loaded, 15000, 'Google Maps');
  return window.google.maps;
}

export default {
  id: 'google',
  async available() {
    if (broken) return false;
    return !!(await getConfig());
  },
  async mount(el, { lat, lng, title, theme }) {
    const cfg = await getConfig();
    if (!cfg) throw new Error('Google Maps is not configured');
    const g = await loadGoogle(cfg.key);
    const [{ Map }, { ColorScheme }] = await Promise.all([g.importLibrary('maps'), g.importLibrary('core')]);
    const position = { lat, lng };
    const map = new Map(el, {
      center: position,
      zoom: 13,
      ...(cfg.mapId ? { mapId: cfg.mapId } : {}),
      colorScheme: theme === 'dark' ? ColorScheme.DARK : ColorScheme.LIGHT,
      // The popup's buttons are the controls; Google's own would sit off the app's grid.
      disableDefaultUI: true,
      clickableIcons: false,
      keyboardShortcuts: false,
      gestureHandling: 'greedy',
    });
    let marker;
    if (cfg.mapId) {
      const { AdvancedMarkerElement, PinElement } = await g.importLibrary('marker');
      const pin = new PinElement({ background: brandColour(), borderColor: brandColour(), glyphColor: '#ffffff' });
      marker = new AdvancedMarkerElement({ map, position, title: title || '', content: pin.element });
    } else {
      marker = new g.Marker({ map, position, title: title || '' });
    }
    // Drawn = the first 'tilesloaded'; refused = gm_authFailure. A slow network is not a failure:
    // after 10 s the map is shown as it is.
    await new Promise((resolve, reject) => {
      const t = setTimeout(done, 10000);
      const l = map.addListener('tilesloaded', done);
      authFailed = (e) => { clearTimeout(t); l.remove(); authFailed = null; reject(e); };
      function done() { clearTimeout(t); l.remove(); authFailed = null; resolve(); }
    }).catch((e) => {
      if (cfg.mapId) marker.map = null; else marker.setMap(null);
      g.event.clearInstanceListeners(map);
      throw e;
    });
    return {
      destroy() {
        if (cfg.mapId) marker.map = null; else marker.setMap(null);
        g.event.clearInstanceListeners(map);
        el.replaceChildren();
      },
    };
  },
};
