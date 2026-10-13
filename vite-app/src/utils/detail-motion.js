// The desktop right pane's event details (App.jsx, .dk-detail-block): how the block grows open
// and collapses shut, pushing My Schedule (the block under it) down and drawing it back up.
//
// One move, two directions (owner, 2026-10-10/11: the close is "the same move in reverse"): the
// block's height between 0 and its OWN natural height, measured, never a cap like the 55% that
// let the open's motion end in 64 ms while the close took 232 ms, and its opacity between 0 and 1,
// both on one curve over one duration (styles.css, "Opening and closing an event"). A move that
// interrupts another starts where that one is, in height and in opacity, and takes the share of
// the duration that is left to travel, so nothing jumps and nothing restarts from 0.
//
// Heights are in r (the grid's row unit), opacities 0..1. planMove is pure (node test:
// utils/__tests__/detail-motion.test.mjs); moveDetailBlock and settleDetailBlock apply it.

// Below these a move is no move: no transition would run, so no transitionend would arrive.
export const EPS_R = 0.01;
export const EPS_O = 0.01;

/**
 * From where the block is to where it is going.
 *   fromH, fromO   where it is now (0, 0 for a block that has just mounted)
 *   dir            'open' or 'close'
 *   naturalH       the block's own height laid out with no move on it (r)
 * Returns { fromH, fromO, toH, toO, frac, instant }: frac is the share of the full duration the
 * move takes, the larger of the height left to travel over the whole height and the opacity left
 * to travel, so an interrupted move ends at the speed the whole one runs; instant when there is
 * nothing to travel.
 */
export function planMove({ fromH, fromO, dir, naturalH }) {
  const h0 = clamp(num(fromH), 0, Infinity);
  const o0 = clamp(num(fromO), 0, 1);
  const full = clamp(num(naturalH), 0, Infinity);
  const toH = dir === 'open' ? full : 0;
  const toO = dir === 'open' ? 1 : 0;
  const dh = Math.abs(toH - h0);
  const dO = Math.abs(toO - o0);
  const instant = dh < EPS_R && dO < EPS_O;
  const frac = instant ? 0 : clamp(Math.max(full > EPS_R ? dh / Math.max(full, h0) : (dh > 0 ? 1 : 0), dO), 0, 1);
  return { fromH: h0, fromO: o0, toH, toO, frac: round4(frac), instant };
}

// A length in r, as CSS.
export const rLen = (h) => `calc(var(--subrow) * ${round4(h)})`;

/**
 * Starts the block on its way open or shut, from wherever it is. R is one r in CSS px (measured);
 * fresh: the block has just mounted, so it starts from nothing (0 tall, transparent).
 * Returns true when there is nothing to travel: the move is already over (for a close, the caller
 * unmounts the block now, as no transitionend will come).
 */
export function moveDetailBlock(el, dir, R, fresh = false) {
  // Where it is now, a running move included (both read the animated value).
  const curH = el.getBoundingClientRect().height / R;
  const curO = parseFloat(getComputedStyle(el).opacity);
  // Its natural height: the move stopped and its inline values dropped, laid out as the
  // stylesheet has it (its content's height, at most the 55% cap).
  el.style.transition = 'none';
  el.style.height = '';
  el.style.opacity = '';
  const naturalH = el.getBoundingClientRect().height / R;
  const plan = planMove({ fromH: fresh ? 0 : curH, fromO: fresh ? 0 : (Number.isFinite(curO) ? curO : 1), dir, naturalH });
  el.dataset.dkMove = dir;
  if (plan.instant) {
    if (dir === 'open') settleDetailBlock(el);
    else { el.style.height = rLen(0); el.style.opacity = '0'; }
    return true;
  }
  // Pin the start and flush it, so the transition runs from here...
  el.style.height = rLen(plan.fromH);
  el.style.opacity = String(round4(plan.fromO));
  el.getBoundingClientRect();
  // ...to the end, over its share of the duration.
  el.style.transition = '';
  el.style.setProperty('--dk-frac', String(plan.frac));
  el.style.height = rLen(plan.toH);
  el.style.opacity = String(plan.toO);
  return false;
}

// An open that has arrived: back to the stylesheet's height (auto), so the details reflow freely
// (a section expanding inside them, another event's details) instead of holding the measured one.
export function settleDetailBlock(el) {
  el.style.transition = '';
  el.style.removeProperty('--dk-frac');
  el.style.height = '';
  el.style.opacity = '';
  el.dataset.dkMove = 'open';
}

// True while a transition on the block itself (not one inside it) has yet to finish.
export function detailBlockMoving(el) {
  if (!el.getAnimations) return false;
  return el.getAnimations().some(a => a.effect && a.effect.target === el && a.playState !== 'finished');
}

function num(v) { return Number.isFinite(v) ? v : 0; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function round4(v) { return Math.round(v * 10000) / 10000; }
