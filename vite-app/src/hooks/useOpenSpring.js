import { useLayoutEffect, useRef } from 'react';
import { tierSpring, toLinear } from '../utils/spring.js';

/**
 * One motion for opening and closing on the Bankroll tab (Bankroll design 98): the replayer's spring, set B
 * tier "hand" (29% of the way at 40 ms, 97% at 160 ms, settled at about 350 ms, 0.5% overshoot), on
 * transform and opacity only. The block takes its new height at once; the rows below it that are in view
 * start where they were (displaced by the change) and ride to their place; an opened detail fades in and
 * settles from 1r above. Computed once per press, Web Animations, nothing under reduced motion (toLinear
 * answers null there).
 */
let curve;
function handCurve() {
  if (curve === undefined) curve = toLinear(tierSpring('B', 'hand')) || null;
  return curve;
}

export function springOpen(el, delta, reveal = null) {
  const c = handCurve();
  if (!c || !el || typeof el.animate !== 'function') return;
  const opts = { duration: c.durationMs, easing: c.easing };
  if (delta) {
    const vh = window.innerHeight;
    const stop = el.closest('.tab-panel, .dk-scroll, .content-area, .bk-side');
    let moved = 0;
    for (let node = el; node && node !== stop && moved < 60; node = node.parentElement) {
      for (let s = node.nextElementSibling; s && moved < 60; s = s.nextElementSibling) {
        const r = s.getBoundingClientRect();
        if (r.top > vh) break;          // below the view: nothing to see move
        if (r.bottom < 0 || !r.height) continue;
        s.animate([{ transform: `translateY(${-delta}px)` }, { transform: 'none' }], opts);
        moved += 1;
      }
    }
  }
  if (reveal && typeof reveal.animate === 'function') {
    const r = parseFloat(getComputedStyle(reveal).getPropertyValue('--subrow')) || 0;
    const probe = r ? null : document.createElement('div');
    let rPx = r;
    if (probe) {
      probe.style.cssText = 'position:absolute;visibility:hidden;height:var(--subrow)';
      reveal.appendChild(probe); rPx = probe.getBoundingClientRect().height; probe.remove();
    }
    reveal.animate([{ opacity: 0, transform: `translateY(${-rPx}px)` }, { opacity: 1, transform: 'none' }], opts);
  }
}

/**
 * Runs springOpen when `open` changes: `ref` is the block that opens, `revealSelector` (inside it) what
 * fades in on opening. The first render only records the height.
 */
export default function useOpenSpring(open, ref, revealSelector = null) {
  const last = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.getBoundingClientRect().height;
    if (last.current != null && last.current !== h) {
      springOpen(el, h - last.current, open && revealSelector ? el.querySelector(revealSelector) : null);
    }
    last.current = h;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}
