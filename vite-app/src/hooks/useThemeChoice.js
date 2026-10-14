import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { THEME_KEY, THEME_META, isDarkTheme, nextTheme, nextThemeLabel, storedTheme, deviceTheme } from '../utils/theme.js';

const LIGHT_QUERY = '(prefers-color-scheme: light)';

const prefersLight = () => {
  try { return !!(window.matchMedia && window.matchMedia(LIGHT_QUERY).matches); } catch { return false; }
};
const readStored = () => {
  try { return storedTheme(localStorage.getItem(THEME_KEY)); } catch { return null; }
};

/**
 * The theme and the button that steps it: one rule for the main app's top bar (App.jsx) and the
 * backer page's (components/BackerPage.jsx), both rendering components/ThemeButton.jsx, so a
 * device has one preference and the two cannot drift. The order, labels and stored key are
 * utils/theme.js. The choice is applied as <html data-theme> (and the theme-color meta, and the
 * native status bar inside the Capacitor app) and kept in localStorage['theme'].
 *
 *   const { theme, toggleTheme, nextThemeLabel } = useThemeChoice();
 *
 * `followDevice` is for a page whose visitors never opened Settings (the backer page): with nothing
 * stored it takes the device's scheme (prefers-color-scheme) and keeps following it as it changes,
 * writing nothing; the first press of the button is a choice and is stored from then on. Without
 * it (the app) the theme starts as dark and is stored on first mount, as it always has been.
 */
export default function useThemeChoice({ followDevice = false } = {}) {
  const [state, setState] = useState(() => {
    const stored = readStored();
    if (stored) return { theme: stored, chosen: true };
    return followDevice ? { theme: deviceTheme(prefersLight()), chosen: false } : { theme: 'dark', chosen: true };
  });
  const { theme, chosen } = state;

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (chosen) { try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage blocked: the choice lasts this visit */ } }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_META[theme] || '#111111');

    // The <meta> above does nothing inside a Capacitor WKWebView, and
    // capacitor.config.json pins the bar to a static dark style — so switching
    // to light or cloudy left light glyphs on a near-white app. The plugin was
    // in package.json and never imported. Driven off the same THEME_META map
    // that feeds the meta tag, so the two cannot drift.
    if (window.Capacitor?.isNativePlatform?.()) {
      import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
        StatusBar.setStyle({ style: isDarkTheme(theme) ? Style.Dark : Style.Light }).catch(() => {});
        StatusBar.setBackgroundColor({ color: THEME_META[theme] || '#111111' }).catch(() => {});
      }).catch(() => {});
    }
  }, [theme, chosen]);

  // No choice made yet: stay with the device as it changes between light and dark.
  useEffect(() => {
    if (!followDevice || chosen || !window.matchMedia) return undefined;
    const mq = window.matchMedia(LIGHT_QUERY);
    const follow = () => setState((s) => (s.chosen ? s : { theme: deviceTheme(mq.matches), chosen: false }));
    mq.addEventListener('change', follow);
    return () => mq.removeEventListener('change', follow);
  }, [followDevice, chosen]);

  const toggleTheme = useCallback(() => setState((s) => ({ theme: nextTheme(s.theme), chosen: true })), []);

  return { theme, toggleTheme, nextThemeLabel: nextThemeLabel(theme) };
}
