import { useLayoutEffect } from 'react';

// The top bar's "futurega.me" is exactly one column, 8g, wide in every theme and every display face
// (owner, 2026-10-17). styles.css sets the box to var(--col) and a font size from a ratio measured
// for one face, which left the word short or long wherever the face or its tracking differ (Swiss
// sets it in Helvetica, tracked tighter; Settings can change the serif). This measures the word as
// set and scales the size so its width is the column: width is linear in font size (the tracking is
// in em), so one pass lands it, and a second takes up rounding. The size is written in g, never px,
// so it holds when the screen width (and g) changes. Re-fits on a theme or face change and when the
// webfonts finish loading.
function fit(el) {
  if (!el || !el.isConnected) return;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;width:calc(var(--gu) * 100);height:0';
  document.body.appendChild(probe);
  const g = probe.getBoundingClientRect().width / 100;
  probe.remove();
  if (!(g > 0)) return;
  const target = g * 8;
  const range = document.createRange();
  range.selectNodeContents(el);
  for (let i = 0; i < 2; i++) {
    const w = range.getBoundingClientRect().width;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (!(w > 0) || !(fs > 0)) return;
    if (Math.abs(w - target) < 0.25) return;
    el.style.fontSize = `calc(var(--gu) * ${((fs * target) / w / g).toFixed(4)})`;
  }
}

export default function useWordmarkFit(ref) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const run = () => fit(ref.current);
    run();
    let raf = 0;
    const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(run); };
    if (document.fonts) {
      document.fonts.ready.then(later).catch(() => {});
      document.fonts.addEventListener?.('loadingdone', later);
    }
    // A theme is html[data-theme]; a chosen serif is a custom property on html's style or a class.
    const mo = new MutationObserver(later);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    window.addEventListener('resize', later);
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      window.removeEventListener('resize', later);
      document.fonts?.removeEventListener?.('loadingdone', later);
    };
  }, [ref]);
}
