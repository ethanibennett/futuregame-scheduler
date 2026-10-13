/* The venue map's providers, and the ONE place a provider is chosen per platform
 * (docs/venue-map.md).
 *
 *   android                  google → mapkit → osm
 *   ios (iPhone, iPad, the   mapkit → osm
 *   Mac app), web
 *
 * A provider is a module whose default export is
 *   { id, available(): Promise<boolean>, mount(el, { lat, lng, title, theme }): Promise<{ destroy() }> }
 * `available` answers whether it is configured (and not already known broken this session);
 * `mount` draws a map centred on the pin into `el` and resolves once it shows, or rejects (no key,
 * refused token, offline), and the next provider in the order is tried. OpenStreetMap needs no key
 * and is always last. Adding a provider is one module here and one line in LOADERS / the order;
 * the popup does not change.
 *
 * Every provider module is a dynamic import, so none of them (and no map library) is in the main
 * bundle: a map library loads only when a popup asks for it.
 */

const LOADERS = {
  google: () => import('./provider-google.js'),
  mapkit: () => import('./provider-mapkit.js'),
  osm: () => import('./provider-osm.js'),
};

// Capacitor.getPlatform(): 'android' | 'ios' | 'web'. Read off the global the native bridge (and
// @capacitor/core) installs, so this module needs no import and runs under node --test.
export function currentPlatform() {
  try {
    const C = typeof window !== 'undefined' ? window.Capacitor : null;
    if (C && typeof C.getPlatform === 'function') return C.getPlatform() || 'web';
  } catch (_) { /* fall through */ }
  return 'web';
}

// Android draws Google Maps (the owner's choice for that app); everything else Apple Maps through
// MapKit JS. Either falls back to MapKit, then OpenStreetMap, when its key is not configured.
export function providerOrder(platform = currentPlatform()) {
  return platform === 'android' ? ['google', 'mapkit', 'osm'] : ['mapkit', 'osm'];
}

const loadDefault = (id) => LOADERS[id]().then((m) => m.default);

/* Mount the first provider in the platform's order that is available and draws; returns
   { provider, destroy }. `load` is injectable for tests. A provider that fails to mount leaves
   `el` empty for the next. */
export async function mountVenueMap(el, opts, { platform = currentPlatform(), load = loadDefault } = {}) {
  let lastError = null;
  for (const id of providerOrder(platform)) {
    let p;
    try { p = await load(id); } catch (e) { lastError = e; continue; }
    try { if (!(await p.available())) continue; } catch (e) { lastError = e; continue; }
    try {
      const handle = await p.mount(el, opts);
      return { provider: id, destroy: () => { try { handle.destroy(); } catch (_) { /* already gone */ } } };
    } catch (e) {
      lastError = e;
      if (el && typeof el.replaceChildren === 'function') el.replaceChildren();
    }
  }
  throw lastError || new Error('no map provider could draw');
}

// The app's brand colour, for a provider's own pin (it cannot read a CSS variable).
export function brandColour() {
  if (typeof document === 'undefined') return '#3cc8e0';
  const v = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim();
  return v || '#3cc8e0';
}

/* A <script> appended once; resolves on load. Shared by the providers that load from a CDN. */
const scripts = new Map();
export function loadScript(src, attrs = {}) {
  if (scripts.has(src)) return scripts.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'crossOrigin') s.crossOrigin = v;
      else s.setAttribute(k, v);
    }
    s.onload = () => resolve();
    s.onerror = () => { scripts.delete(src); s.remove(); reject(new Error('could not load ' + src.split('?')[0])); };
    document.head.appendChild(s);
  });
  scripts.set(src, p);
  return p;
}

// A promise that rejects after `ms` — a provider never leaves the popup on "Loading map".
export function within(promise, ms, what) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(what + ' timed out')), ms); }),
  ]).finally(() => clearTimeout(t));
}
