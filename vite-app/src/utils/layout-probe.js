/* The in-app layout check (owner, 2026-11-27, after a hand link opened in the iPhone app with the table under the clock:
 * "This kind of thing just can not happen"). A page opened with ?probe=layout reports, on the console, where every
 * piece of the replay (or the top bar, off the replay) sits against the safe area the WINDOW gives (the SafeArea
 * plugin, utils/native-insets.js), not the one env() gives, since env() is what came back 0. On the Mac,
 * .github/workflows/app-link-check.yml builds the app for the simulator, opens a hand link in it the way a tap in
 * another app does, reads these lines from the app's console and fails on any piece under the clock or the home bar.
 * Off the app the page's own env() is the band. Nothing is drawn and nothing is sent anywhere. */
import { nativeInsetsNow } from './native-insets.js';

export const PIECES = [
  '.replayer-replay .replayer-seat-info',
  '.replayer-replay .replayer-seat-cards .card-row > *',
  '.replayer-replay .replayer-board-area .card-row > *',
  '.replayer-replay .replayer-pot-display',
  '.replayer-quick-btn',
  '.replayer-replay .hx-chips > *',
  '.replayer-replay .replayer-controls > button',
  '.replayer-replay .replayer-actions-bar > *',
  '.replayer-replay .replayer-street-track',
  '.top-bar > *',
];

/* Every rect ({ sel, top, bottom, left, right }) that reaches into the bands: above `top`, below `H - bottom`,
   or off the screen's sides (half a pixel of rounding allowed). */
export function outOfBands(rects, { W, H, top, bottom }) {
  const e = 0.5;
  return rects.filter((r) => r.top < top - e || r.bottom > H - bottom + e || r.left < -e || r.right > W + e);
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

function measureInsets(doc, top, bottom) {
  const el = doc.createElement('div');
  el.style.cssText = `position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:${top};padding-bottom:${bottom}`;
  doc.body.appendChild(el);
  const cs = getComputedStyle(el);
  const out = { top: num(cs.paddingTop), bottom: num(cs.paddingBottom) };
  el.remove();
  return out;
}

export function layoutReport(win = window) {
  const doc = win.document;
  const W = win.innerWidth, H = win.innerHeight;
  const env = measureInsets(doc, 'env(safe-area-inset-top, 0px)', 'env(safe-area-inset-bottom, 0px)');
  const sa = measureInsets(doc, 'var(--sa-t, 0px)', 'var(--sa-b, 0px)');
  const native = nativeInsetsNow();
  const has = native && Number.isFinite(native.top);
  const band = { W, H, top: has ? native.top : env.top, bottom: has ? native.bottom : env.bottom };
  const rects = [];
  for (const sel of PIECES) {
    for (const el of doc.querySelectorAll(sel)) {
      const q = el.getBoundingClientRect();
      if (q.width < 1 || q.height < 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || num(cs.opacity) < 0.05) continue;
      rects.push({ sel, top: Math.round(q.top * 10) / 10, bottom: Math.round(q.bottom * 10) / 10, left: Math.round(q.left * 10) / 10, right: Math.round(q.right * 10) / 10 });
    }
  }
  const bad = outOfBands(rects, band);
  return { W, H, native: has ? native : null, env, sa, band: { top: band.top, bottom: band.bottom }, view: doc.querySelector('.replayer-replay') ? 'replay' : 'app', pieces: rects.length, bad: bad.slice(0, 12), ok: rects.length > 0 && bad.length === 0 };
}

export function startLayoutProbe(win = typeof window !== 'undefined' ? window : null) {
  if (!win || !/[?&]probe=layout\b/.test(win.location.search || '')) return false;
  [3000, 6000, 10000, 15000].forEach((t) => setTimeout(() => {
    try { console.log('[fg-layout] ' + JSON.stringify({ at: t / 1000, path: win.location.pathname, ...layoutReport(win) })); }
    catch (e) { console.log('[fg-layout] ' + JSON.stringify({ at: t / 1000, error: String(e && e.message || e) })); }
  }, t));
  return true;
}
