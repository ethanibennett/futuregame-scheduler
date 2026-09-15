// ── API Helper ───────────────────────────────────────────
export const API_URL = (window.Capacitor && window.Capacitor.isNativePlatform())
  ? 'https://futurega.me/api'
  : window.location.origin + '/api';

// Canonical web origin for anything SHARED outside the app (a hand link, a share
// URL). In the native app window.location.origin is capacitor://localhost, so a
// link built from it opens nowhere — shared links must always point at the site.
export const SITE_URL = (window.Capacitor && window.Capacitor.isNativePlatform())
  ? 'https://futurega.me'
  : window.location.origin;

export async function fetchApi(path, options = {}) {
  const token = localStorage.getItem('token');
  const headers = { ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  return res;
}
