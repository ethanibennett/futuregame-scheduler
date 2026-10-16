/* The app's themes and the one rule for moving between them: pure, so node can test it
 * (utils/__tests__/theme.test.mjs) and so the main app's top bar and the backer page's (components/
 * ThemeButton.jsx, hooks/useThemeChoice.js) read the same order, icons, labels and stored key and
 * cannot drift apart. utils.js re-exports these names for the code that imported them from there.
 *
 * The choice is one string in localStorage['theme'], one of THEME_ORDER, applied as
 * <html data-theme="...">. The button steps through THEME_ORDER and wraps. */

export const THEME_KEY = 'theme';
// swiss-light and swiss-dark are the EXPERIMENTAL Swiss theme (owner brief, 2026-10-16): Helvetica
// only, bold and ultralight, white/black with one red. Every style it has is in theme-swiss.css and
// applies only under these two values; the four themes before them are untouched by it.
export const THEME_ORDER = ['dark', 'dusk', 'light', 'cloudy', 'swiss-light', 'swiss-dark'];
export const isDarkTheme = (t) => t === 'dark' || t === 'dusk' || t === 'swiss-dark';
export const THEME_ICON = { dark: 'moon', dusk: 'sunset', light: 'sun', cloudy: 'cloud', 'swiss-light': 'swissLight', 'swiss-dark': 'swissDark' };
export const THEME_LABEL = { dark: 'Dark', dusk: 'Dusk', light: 'Light', cloudy: 'Cloudy', 'swiss-light': 'Swiss light', 'swiss-dark': 'Swiss dark' };
export const THEME_META = { dark: '#111111', dusk: '#0d1525', light: '#f5f5f5', cloudy: '#cbcbcb', 'swiss-light': '#ffffff', 'swiss-dark': '#000000' };

/** The Swiss themes are for app admins only while they are tried out (owner, 2026-10-16): only an
 *  admin's button steps into them. Everyone else's order is the four themes. */
export const ADMIN_ONLY_THEMES = ['swiss-light', 'swiss-dark'];
export function themeOrder(admin = false) {
  return admin ? THEME_ORDER : THEME_ORDER.filter((t) => !ADMIN_ONLY_THEMES.includes(t));
}

/** The theme after `t` in the order this person may use, wrapping. A value not in that order (an
 *  unknown one, or a Swiss theme a non-admin still has stored) steps to the first. */
export function nextTheme(t, admin = false) {
  const order = themeOrder(admin);
  return order[(order.indexOf(t) + 1) % order.length];
}

/** The name of the theme the button switches to ("Dusk"), for its label. */
export function nextThemeLabel(t, admin = false) {
  return THEME_LABEL[nextTheme(t, admin)];
}

/** What a stored value means: the theme it names, or null for nothing stored or a value that is
 *  not one of ours (a stale or hand-edited key), so a bad value never reaches data-theme. */
export function storedTheme(raw) {
  return typeof raw === 'string' && THEME_ORDER.includes(raw) ? raw : null;
}

/** The theme a device that has made no choice gets: its scheme, light or dark. */
export function deviceTheme(prefersLight) {
  return prefersLight ? 'light' : 'dark';
}
