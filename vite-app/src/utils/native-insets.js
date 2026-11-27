/* The safe area from the app itself (owner, 2026-11-27, a hand link opened in the iPhone app: "why is it so high").
 * The app reloads at a link's path, and on that load the web view's env(safe-area-inset-*) came back 0, top and
 * bottom: the replay ran up under the clock and its buttons sat on the home bar. The window always knows its real
 * insets, so the app's SafeArea plugin (AppDelegate.swift) gives them, and they are written over the CSS's own
 * --sa-t / --sa-b / --sa-l / --sa-r, which every inset in the styles goes through. A side the window reports as 0
 * is left to env(), so a moment when the window is not yet laid out never freezes a 0. A <style>, not the root's
 * inline style: it outlasts anything else that writes there. */

const round = (v) => Math.round(v * 100) / 100;

// The window's insets as the app last gave them (null before the first answer, or off the app): the truth the
// in-app layout check (utils/layout-probe.js) holds the page to.
let lastNative = null;
export const nativeInsetsNow = () => lastNative;

/* The rule for a set of insets ({ top, bottom, left, right } in CSS px), or '' when none is above 0. */
export function insetsCss(v) {
  const parts = [];
  const side = (name, n) => { if (Number.isFinite(n) && n > 0) parts.push(`${name}:${round(n)}px`); };
  side('--sa-t', v && v.top);
  side('--sa-b', v && v.bottom);
  side('--sa-l', v && v.left);
  side('--sa-r', v && v.right);
  return parts.length ? `html:root{${parts.join(';')}}` : '';
}

export function applyInsets(doc, v) {
  const css = insetsCss(v);
  let el = doc.getElementById('native-insets');
  if (!css) { if (el) el.remove(); return; }
  if (!el) { el = doc.createElement('style'); el.id = 'native-insets'; doc.head.appendChild(el); }
  if (el.textContent !== css) el.textContent = css;
}

/* In the iPhone and iPad app only (an app without the plugin, the web and the Mac app are left as they are). */
export function startNativeInsets(win = typeof window !== 'undefined' ? window : null) {
  const C = win && win.Capacitor;
  if (!(C && C.isNativePlatform && C.isNativePlatform() && C.registerPlugin)) return false;
  if (C.getPlatform && C.getPlatform() !== 'ios') return false;
  if (C.isPluginAvailable && !C.isPluginAvailable('SafeArea')) return false;
  const SA = C.registerPlugin('SafeArea');
  const doc = win.document;
  const apply = (v) => { lastNative = v || {}; try { applyInsets(doc, v || {}); } catch { /* no head yet */ } };
  const sync = () => { Promise.resolve().then(() => SA.get()).then(apply).catch(() => {}); };
  sync();
  // iOS applies the inset after the first layout (see GridOverlay), so ask again as the page settles.
  [150, 500, 1200, 3000].forEach((t) => setTimeout(sync, t));
  try { SA.addListener('change', apply); } catch { /* an older bridge */ }
  win.addEventListener('resize', sync);
  win.addEventListener('orientationchange', sync);
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden) sync(); });
  return true;
}
