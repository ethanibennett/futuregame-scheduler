import { useEffect, useState } from 'react';

/*
 * The desktop layout decision, in one place (docs/desktop-layout.md).
 *
 * Desktop = a window at least 1024 CSS px wide, whatever its shape. That takes
 * in the iPad app (landscape, and a 13-inch iPad in portrait) and the Mac app at
 * any window wider than that. Everything narrower (every iPhone, a smaller iPad
 * in portrait, a narrow browser or Mac window) gets the phone layout, untouched.
 *
 * On desktop g does not change: --gu is already frozen at 430px/37 above phone
 * width (styles.css), so every pane is laid out on exactly the grid the phone
 * canvas uses. What changes is how many g the shell spans. Everything is counted
 * in whole g here and handed to CSS as unitless integers, so CSS multiplies them
 * by var(--gu) and no px value is ever written:
 *
 *   rail   = 10g   (one 8g column inside 1g margins — the wordmark's column)
 *   pane   = 9N+1g (N columns of 8g, 1g gutters, 1g margins; N=4 is the 37g phone canvas)
 *            + the scrollbar's width where scrollbars take space (sbG, 0 on overlay scrollbars),
 *            so the content inside the scrollbar is still exactly 9N+1g
 *
 * Tiers (W = floor(window / g), whole g):
 *   'two'   rail 10 | list 37 | right pane 9N+1 (Event / My schedule, switchable)
 *   'three' rail 10 | list 37 | detail 9N+1 | my schedule 37   (W >= 121)
 * The flexible pane takes as many whole columns as fit, N clamped to 4..7 —
 * 7 columns (64g, ~744px) is the widest measure a single event card reads well at.
 */
export const DESKTOP_QUERY = '(min-width: 1024px)';
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

// The width a classic (always-visible) scrollbar takes from a scroller, in g. 0 where scrollbars
// overlay the content (macOS with a trackpad, iOS, iPadOS). A Mac with a mouse, or "Always show
// scroll bars", gives ~15 CSS px, and that came straight out of each pane's 37g: the Schedule
// filter row (exactly 35g) wrapped its calendar button. Each scrolling pane is widened by this so
// its content keeps the whole phone canvas.
function measureScrollbarG(g) {
  if (typeof document === 'undefined' || !document.body) return 0;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;overflow:scroll;width:calc(var(--gu) * 10);height:calc(var(--gu) * 10)';
  document.body.appendChild(probe);
  const px = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return px > 0 ? Math.round((px / g) * 1e4) / 1e4 : 0;
}

function colsFor(availG) {
  return Math.max(MIN_COLS, Math.min(MAX_COLS, Math.floor((availG - 1) / 9)));
}

export function computeDesktopLayout() {
  if (typeof window === 'undefined' || !window.matchMedia || !window.matchMedia(DESKTOP_QUERY).matches) {
    return { desktop: false };
  }
  const g = measureG();
  const sbG = measureScrollbarG(g);
  const W = Math.floor(window.innerWidth / g + 1e-6);
  // One tier since 2026-10-10: My Schedule sits under the event details in the right pane instead
  // of taking a third column, so every desktop width is rail | list | right pane.
  const tier = 'two';
  const panes = 2;
  const fixed = RAIL_G + PHONE_PANE_G;
  const detailCols = colsFor(W - fixed - panes * sbG);
  const shellG = fixed + paneG(detailCols) + panes * sbG;
  // A single-pane tab (Dashboard, Social, …) uses the same shell; its one pane
  // is as many whole columns as fit after the rail, capped at the same 7.
  const wideCols = colsFor(shellG - RAIL_G - sbG);
  return { desktop: true, g, W, tier, detailCols, shellG, wideCols, sbG };
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
