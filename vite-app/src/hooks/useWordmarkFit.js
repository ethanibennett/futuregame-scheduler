import { useLayoutEffect } from 'react';
import { measureWordmarkDot } from '../utils/wordmark-dot.js';

// The top bar's "futurega.me" is exactly one column, 8g, wide in every theme and every display face
// (owner, 2026-10-17). styles.css sets the box to var(--col) and a font size from a ratio measured
// for one face, which left the word short or long wherever the face or its tracking differ (Swiss
// sets it in Helvetica, tracked tighter; Settings can change the serif). This measures the word as
// set and scales the size so its width is the column: width is linear in font size (the tracking is
// in em), so one pass lands it, and a second takes up rounding. The size is written in g, never px,
// so it holds when the screen width (and g) changes. Re-fits on a theme or face change and when the
// webfonts finish loading.
// The app's top bar plays the dot loop (utils/wordmark-dot.js): there the word's spacing for the dot is read from the
// face first, and the width fitted is the whole mark, "futurega.me" with the room open, measured on layout (the
// animation's transforms set aside), so the fit never depends on where the loop is.
function wordWidth(el, range) {
  const rect = range.getBoundingClientRect();
  const me = el.querySelector('.wm-me');
  if (!me) return rect.width;
  const t = getComputedStyle(me).transform;
  const moved = t && t !== 'none' ? new DOMMatrixReadOnly(t).m41 : 0;
  const gap = parseFloat(getComputedStyle(el).getPropertyValue('--wm-gap')) || 0;
  return me.getBoundingClientRect().right - moved + gap * parseFloat(getComputedStyle(el).fontSize) - rect.left;
}

function setDotGeometry(el) {
  if (!el.querySelector('.wm-me')) return;
  const geo = measureWordmarkDot(el);
  if (!geo) return;
  const em = (v) => `${v.toFixed(4)}em`;
  el.style.setProperty('--wm-gap', em(geo.gap));
  el.style.setProperty('--wm-dot-x', em(geo.dotX));
  if (geo.base != null) el.style.setProperty('--wm-base', em(geo.base));
  if (geo.originY != null) el.style.setProperty('--wm-dot-oy', em(geo.originY));
}

// `fitG` null: the dot's geometry only, the size left to the element's own CSS (the sign-in card's centred mark).
function fit(el, fitG = 8) {
  if (!el || !el.isConnected) return;
  if (fitG == null) { setDotGeometry(el); return; }
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;width:calc(var(--gu) * 100);height:0';
  document.body.appendChild(probe);
  const g = probe.getBoundingClientRect().width / 100;
  probe.remove();
  if (!(g > 0)) return;
  const target = g * fitG;
  // Under Reduce Motion the app-wide rule gives every property a 1ms transition, the font size included, so the
  // second pass read the size before the first had landed and the word stayed up to half a pixel off 8g.
  el.style.transitionProperty = 'none';
  setDotGeometry(el);
  const range = document.createRange();
  range.selectNodeContents(el);
  for (let i = 0; i < 2; i++) {
    const w = wordWidth(el, range);
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (!(w > 0) || !(fs > 0)) return;
    if (Math.abs(w - target) < 0.25) return;
    el.style.fontSize = `calc(var(--gu) * ${((fs * target) / w / g).toFixed(4)})`;
  }
}

export default function useWordmarkFit(ref, { fitG = 8 } = {}) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const run = () => fit(ref.current, fitG);
    run();
    let raf = 0;
    const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(run); };
    if (document.fonts) {
      document.fonts.ready.then(later).catch(() => {});
      document.fonts.addEventListener?.('loadingdone', later);
    }
    // A theme is html[data-theme]; a chosen serif is a custom property on html's style or a class.
    const mo = new MutationObserver(later);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-serif', 'style', 'class'] });
    window.addEventListener('resize', later);
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      window.removeEventListener('resize', later);
      document.fonts?.removeEventListener?.('loadingdone', later);
    };
  }, [ref, fitG]);
}
