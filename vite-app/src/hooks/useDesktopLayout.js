import { useEffect, useState } from 'react';

/*
 * The desktop layout decision, in one place (docs/desktop-layout.md).
 *
 * Desktop = a window at least 1024 CSS px wide AND at least as wide as it is
 * tall. Everything else (every phone, the iOS app, a narrow or portrait browser
 * window) gets the phone layout, untouched.
 *
 * On desktop g does not change: --gu is already frozen at 430px/37 above phone
 * width (styles.css), so every pane is laid out on exactly the grid the phone
 * canvas uses. What changes is how many g the shell spans. Everything is counted
 * in whole g here and handed to CSS as unitless integers, so CSS multiplies them
 * by var(--gu) and no px value is ever written:
 *
 *   rail   = 10g   (one 8g column inside 1g margins — the wordmark's column)
 *   pane   = 9N+1g (N columns of 8g, 1g gutters, 1g margins; N=4 is the 37g phone canvas)
 *
 * Tiers (W = floor(window / g), whole g):
 *   'two'   rail 10 | list 37 | right pane 9N+1 (Event / My schedule, switchable)
 *   'three' rail 10 | list 37 | detail 9N+1 | my schedule 37   (W >= 121)
 * The flexible pane takes as many whole columns as fit, N clamped to 4..7 —
 * 7 columns (64g, ~744px) is the widest measure a single event card reads well at.
 */
export const DESKTOP_QUERY = '(min-width: 1024px) and (min-aspect-ratio: 1/1)';
export const RAIL_G = 10;
export const PHONE_PANE_G = 37;
const MIN_COLS = 4;
const MAX_COLS = 7;
export const paneG = (n) => 9 * n + 1;

// g in CSS px, MEASURED from a probe styled with the real token (never assumed).
function measureG() {
  if (typeof document === 'undefined' || !document.body) return 430 / 37;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;width:calc(var(--gu) * 100);height:0';
  document.body.appendChild(probe);
  const g = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return g || 430 / 37;
}

function colsFor(availG) {
  return Math.max(MIN_COLS, Math.min(MAX_COLS, Math.floor((availG - 1) / 9)));
}

export function computeDesktopLayout() {
  if (typeof window === 'undefined' || !window.matchMedia || !window.matchMedia(DESKTOP_QUERY).matches) {
    return { desktop: false };
  }
  const g = measureG();
  const W = Math.floor(window.innerWidth / g + 1e-6);
  const tier = W >= RAIL_G + PHONE_PANE_G * 3 ? 'three' : 'two';
  const fixed = RAIL_G + PHONE_PANE_G + (tier === 'three' ? PHONE_PANE_G : 0);
  const detailCols = colsFor(W - fixed);
  const shellG = fixed + paneG(detailCols);
  // A single-pane tab (Dashboard, Social, …) uses the same shell; its one pane
  // is as many whole columns as fit after the rail, capped at the same 7.
  const wideCols = colsFor(shellG - RAIL_G);
  return { desktop: true, g, W, tier, detailCols, shellG, wideCols };
}

export default function useDesktopLayout() {
  const [layout, setLayout] = useState(computeDesktopLayout);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = computeDesktopLayout();
        setLayout(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      });
    };
    window.addEventListener('resize', update);
    const mq = window.matchMedia ? window.matchMedia(DESKTOP_QUERY) : null;
    if (mq && mq.addEventListener) mq.addEventListener('change', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      if (mq && mq.removeEventListener) mq.removeEventListener('change', update);
    };
  }, []);
  return layout;
}
