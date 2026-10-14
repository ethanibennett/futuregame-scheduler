/* OpenStreetMap through Leaflet: the venue map's fallback, and the map everywhere until a MapKit
 * JS key (or, on Android, a Google Maps key) is configured. No key, no account.
 *
 * Tiles come from tile.openstreetmap.org under its usage policy: the attribution below is
 * required, and the volume (one popup's worth of tiles, on a tap) is the light use it allows.
 * Leaflet and its stylesheet live in this module's chunk only (providers.js imports it
 * dynamically), so neither is in the main bundle.
 *
 * Leaflet's own controls are off: its zoom buttons are 30px boxes off the app's grid, and its
 * keyboard handler makes the map a tab stop whose "label" is a field of tiles. Pinch, double-tap
 * and the wheel still zoom; the popup's Open in Maps buttons are the way to do more.
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { within } from './providers.js';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

// The pin: an SVG drop sized in g/r by venue-map.css (.vm-pin); its tip is the point.
const PIN = '<svg viewBox="0 0 24 32" aria-hidden="true"><path class="vm-pin-body" d="M12 31C12 31 2 18.6 2 11.5a10 10 0 0 1 20 0C22 18.6 12 31 12 31z"/><circle class="vm-pin-dot" cx="12" cy="11.5" r="4"/></svg>';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default {
  id: 'osm',
  async available() { return true; },
  async mount(el, { lat, lng, title, theme }) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline');
    el.classList.toggle('vm-osm-dark', theme === 'dark');
    const map = L.map(el, {
      center: [lat, lng],
      zoom: 13,
      zoomControl: false,
      keyboard: false,
      attributionControl: true,
      scrollWheelZoom: 'center',
      touchZoom: 'center',
      doubleClickZoom: 'center',
    });
    map.attributionControl.setPrefix(false);
    const tiles = L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION, referrerPolicy: 'strict-origin-when-cross-origin' });
    // Ready on the first tile drawn; failed when tiles only error (offline, blocked), or nothing in 12 s.
    const ready = new Promise((resolve, reject) => {
      let ok = 0, bad = 0;
      tiles.on('tileload', () => { ok++; resolve(); });
      tiles.on('tileerror', () => { bad++; if (!ok && bad >= 3) reject(new Error('map tiles unavailable')); });
    });
    tiles.addTo(map);
    // The size is the stylesheet's; no iconSize, so Leaflet sets no px of its own (.vm-pin anchors
    // its tip on the point with margins in g and r).
    const icon = L.divIcon({ className: 'vm-pin', html: PIN, iconSize: null });
    const marker = L.marker([lat, lng], { icon, interactive: false, keyboard: false, title: '' }).addTo(map);
    if (title) marker.bindTooltip(escapeHtml(title), { permanent: true, direction: 'top', className: 'vm-pin-label', opacity: 1, interactive: false });
    // The sheet may still be sliding in when this runs; size the map to its box once it settles.
    requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    try {
      await within(ready, 12000, 'OpenStreetMap');
    } catch (e) {
      map.remove();
      throw e;
    }
    return { destroy() { map.remove(); } };
  },
};
