/**
 * Land a scroller on a target that can move while it goes and after it arrives, and keep it there until the user
 * takes the scroll (owner, 2026-11-28: "clicking today's date pill scrolls here. How we still have any scroll errors is
 * completely beyond me").
 *
 * Why not scrollTo({ behavior: 'smooth' }): that animates to a position read once, at the press. While it runs the
 * Schedule's window (UX pick 97) gives days their rows and measures them, and a day above that changes height moves
 * the day it was sent to; the list's own hold (TournamentsView's liveAnchor) then writes scrollTop, which in WebKit
 * also stops a smooth scroll where it is. And once it was there, nothing kept it there: yesterday's event still
 * running past midnight takes its room clock row a moment later, and today's date sat a row below the filters with
 * yesterday's pinned over it.
 *
 * So: the scroll is animated here, a frame at a time, reading `target()` (the scrollTop that puts the thing where it
 * belongs, off the live layout, or null when it is gone) every frame; at the end it is placed exactly; then, for
 * `holdMs`, any change of size in `observe` (default: the scroller's children) places it again, before the paint.
 * Any wheel, touch, pointer press or key, anywhere, ends it at once: the scroll is the user's again.
 *
 * `env` swaps the browser's clock, frames, observer, timers and window, for the tests.
 */
const INPUTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'];

const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/** How long a landing of `px` takes, ms: a quarter second for a nudge, 0.6 s at most. */
export const landMs = (px) => Math.min(600, 240 + Math.abs(px) * 0.12);

export function landOn(scroller, { target, smooth = true, holdMs = 15000, observe = null, env = {} } = {}) {
  const w = env.win || (typeof window !== 'undefined' ? window : null);
  const raf = env.raf || ((f) => requestAnimationFrame(f));
  const caf = env.caf || ((id) => cancelAnimationFrame(id));
  const now = env.now || (() => performance.now());
  const RO = 'RO' in env ? env.RO : (typeof ResizeObserver === 'function' ? ResizeObserver : null);
  const later = env.setTimeout || ((f, ms) => setTimeout(f, ms));
  const unlater = env.clearTimeout || ((id) => clearTimeout(id));
  let stopped = false, frame = 0, ro = null, timer = 0;

  // The target inside what the scroller can reach (a target past its end is its end).
  const reach = () => {
    const T = target();
    if (T == null || !Number.isFinite(T)) return null;
    const max = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || 0));
    return Math.max(0, Math.min(T, max));
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (frame) caf(frame);
    if (ro) ro.disconnect();
    if (timer) unlater(timer);
    if (w) INPUTS.forEach((ev) => w.removeEventListener(ev, stop, true));
  };
  // Exactly the target, never "close enough": WebKit keeps whole pixels and drops a fraction, so 1883.97 would rest at
  // 1883, the day above showing in the sliver under the filters (the reason the caller's target is rounded up).
  const place = () => {
    const T = reach();
    if (T == null) { stop(); return; }
    if (scroller.scrollTop !== T) scroller.scrollTop = T;
  };
  const hold = () => {
    frame = 0;
    place();
    if (stopped) return;
    if (RO) {
      ro = new RO(() => { if (!stopped) place(); });
      (observe || [...(scroller.children || [])]).forEach((el) => { if (el) ro.observe(el); });
    }
    timer = later(stop, holdMs);
  };

  if (w) INPUTS.forEach((ev) => w.addEventListener(ev, stop, { passive: true, capture: true }));
  const from = scroller.scrollTop;
  const T0 = reach();
  if (T0 == null) { stop(); return { stop }; }
  const reduced = !!(w && w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const dur = smooth && !reduced && Math.abs(T0 - from) >= 1 ? landMs(T0 - from) : 0;
  if (!dur) { hold(); return { stop }; }
  const t0 = now();
  const step = () => {
    if (stopped) return;
    const T = reach();
    if (T == null) { stop(); return; }
    const p = Math.min(1, (now() - t0) / dur);
    if (p >= 1) { hold(); return; }
    scroller.scrollTop = from + (T - from) * easeInOut(p);
    frame = raf(step);
  };
  frame = raf(step);
  return { stop };
}
