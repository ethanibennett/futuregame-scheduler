// ── Springs for the replayer ──
// A damped harmonic oscillator, solved in closed form, turned into Web Animations keyframes (or a
// CSS linear() easing) ONCE per moment. Nothing here runs per frame: the curve is sampled when a
// moment starts and the compositor plays it, which is what keeps it smooth on an old iPhone and
// what lets the exporters seek it frame by frame.
//
// Units are Remotion's: stiffness, damping and mass as in spring({ fps, config: { stiffness,
// damping, mass } }), time in seconds inside the oscillator, mass 1 the default. The ads are cut in
// Remotion, so the replayer and the ads share these literal numbers.
//
// Pure: no DOM except the optional prefers-reduced-motion read in keyframes()/toLinear(), which a
// caller (or a test) can override with { reducedMotion }.

/* ONE spring, five tiers. Every moving thing on the felt has the same stiffness and the same
   damping ratio; objects differ only in mass, so the table reads as one physical system and only
   the tempo changes from object to object. Damping is c = 2 * zeta * sqrt(k * m), written out as
   the rounded literals the ad team pastes into Remotion. Yield is critically damped on purpose:
   something pushed aside to make room never bounces. */
export const SPRING_SETS = {
  // Set A, "House": k 380, zeta 0.80, 1.5% overshoot. A dealer's hands.
  A: {
    name: 'house',
    tiers: {
      flick:   { stiffness: 380, damping: 23.1, mass: 0.55 },
      hand:    { stiffness: 380, damping: 31.2, mass: 1 },
      arm:     { stiffness: 380, damping: 39.5, mass: 1.6 },
      inertia: { stiffness: 380, damping: 48.3, mass: 2.4 },
      yield:   { stiffness: 380, damping: 28.9, mass: 0.55 },
    },
    stage: {
      sweepStagger: 40, sweepCap: 160,   // between wagers swept in; all gone within the cap
      place: 60,                         // sweep -> the flop stack is placed
      beat: 220,                         // placement -> the window card spreads
      midLag: 40,                        // window card -> middle card
      yieldAfterSweep: 40,               // sweep -> the row makes room
      cardLag: 30,                       // row -> the new card is placed
      shipStagger: 35,
      appear: 70, arrivalFade: 80, labelFade: 90,
      placeScale: 1.08, placeDrop: 0.15, // x card height
      rot: { flop: -3, turn: 2.5, river: -2 },
      push: 0.55, addOn: 0.3,            // x board card width
      squash: [1.04, 0.94],
      sweepLift: 0.06, shipLift: 0.15, shipShrink: 0.85,
    },
  },
  // Set B, "Snappy": k 640, zeta 0.86, 0.5% overshoot. A broadcast graphic.
  B: {
    name: 'snappy',
    tiers: {
      flick:   { stiffness: 640, damping: 32.3, mass: 0.55 },
      hand:    { stiffness: 640, damping: 43.5, mass: 1 },
      arm:     { stiffness: 640, damping: 55.0, mass: 1.6 },
      inertia: { stiffness: 640, damping: 67.4, mass: 2.4 },
      yield:   { stiffness: 640, damping: 37.5, mass: 0.55 },
    },
    stage: {
      sweepStagger: 25, sweepCap: 120,
      place: 40, beat: 140, midLag: 25, yieldAfterSweep: 25, cardLag: 20, shipStagger: 25,
      appear: 70, arrivalFade: 60, labelFade: 70,
      placeScale: 1.05, placeDrop: 0.10,
      rot: { flop: -2, turn: 1.5, river: -1.5 },
      push: 0.4, addOn: 0.22,
      squash: [1.03, 0.955],
      sweepLift: 0.04, shipLift: 0.10, shipShrink: 0.85,
    },
  },
};

/** The flag's value ('0' | '1' | '2' | 'snappy' | 'house' | anything) to a set id, or null for off. */
export function springSetFor(flag) {
  const v = flag == null ? '1' : String(flag).trim().toLowerCase();
  if (v === '0' || v === 'off' || v === 'false') return null;
  if (v === '2' || v === 'b' || v === 'snappy') return 'B';
  return 'A';
}

/** Autoplay speed (ms per step) to a time rate: motion never slows below 1x, at most doubles. */
export function rateFor(speedMs) {
  const s = Number(speedMs);
  if (!Number.isFinite(s) || s <= 0) return 1;
  return Math.min(2, Math.max(1, Math.sqrt(1000 / s)));
}

/**
 * A spring from 0 to 1. `velocity` is the starting velocity in progress per SECOND (a retarget
 * hands over v_px / travel), as Remotion's.
 * @returns {{ at(ms): number, velocityAt(ms): number, settleMs(eps?): number, overshootPct: number,
 *            stiffness, damping, mass, velocity, zeta, w0 }}
 */
export function spring({ stiffness, damping, mass = 1, velocity = 0 } = {}) {
  const k = Number(stiffness), c = Number(damping), m = Number(mass) || 1, v0 = Number(velocity) || 0;
  if (!(k > 0) || !(c >= 0)) throw new Error('spring: stiffness must be > 0 and damping >= 0');
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  // Error e(t) = 1 - x(t): e(0) = 1, e'(0) = -v0.
  let e, de;
  if (Math.abs(zeta - 1) < 1e-9) {
    const b = w0 - v0;
    e = (t) => Math.exp(-w0 * t) * (1 + b * t);
    de = (t) => Math.exp(-w0 * t) * (b - w0 * (1 + b * t));
  } else if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const B = (zeta * w0 - v0) / wd;
    e = (t) => Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + B * Math.sin(wd * t));
    de = (t) => {
      const ex = Math.exp(-zeta * w0 * t), co = Math.cos(wd * t), si = Math.sin(wd * t);
      return ex * (-zeta * w0 * (co + B * si) + wd * (B * co - si));
    };
  } else {
    const s = Math.sqrt(zeta * zeta - 1);
    const r1 = -w0 * (zeta - s), r2 = -w0 * (zeta + s);
    const A = (-v0 - r2) / (r1 - r2), B = 1 - A;
    e = (t) => A * Math.exp(r1 * t) + B * Math.exp(r2 * t);
    de = (t) => A * r1 * Math.exp(r1 * t) + B * r2 * Math.exp(r2 * t);
  }
  const at = (ms) => (ms <= 0 ? 0 : 1 - e(ms / 1000));
  const velocityAt = (ms) => -de(Math.max(0, ms) / 1000);
  // The last moment the error is above eps (position only, as the spec's table), to 1ms.
  const settleCache = new Map();
  const settleMs = (eps = 0.001) => {
    if (settleCache.has(eps)) return settleCache.get(eps);
    let last = 0;
    for (let t = 1; t <= 10000; t++) if (Math.abs(e(t / 1000)) > eps) last = t;
    settleCache.set(eps, last + 1);
    return last + 1;
  };
  let peak = 0;
  for (let t = 1; t <= 4000; t++) peak = Math.max(peak, at(t));
  return {
    at, velocityAt, settleMs,
    overshootPct: Math.max(0, peak - 1) * 100,
    stiffness: k, damping: c, mass: m, velocity: v0, zeta, w0,
  };
}

/** The first time (ms) progress reaches `frac`. */
export function timeTo(sp, frac) {
  for (let t = 0; t <= 10000; t += 0.25) if (sp.at(t) >= frac) return t;
  return 10000;
}

/** A tier of a set as a spring (optionally with a starting velocity). */
export function tierSpring(setId, tier, velocity = 0) {
  const set = SPRING_SETS[setId] || SPRING_SETS.A;
  return spring({ ...set.tiers[tier], velocity });
}

export function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { return false; }
}

/* Ramer-Douglas-Peucker over a sampled curve. pts[i] = [t, ...values]; err(a, b, i) is the error
   of point i against the chord a..b. Keeps the first and last points. Returns the kept indices. */
function rdp(n, err, tol) {
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = err(a, b, i);
      if (d > md) { md = d; mi = i; }
    }
    if (mi >= 0 && md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

const r4 = (v) => +v.toFixed(4);

/**
 * The spring as a CSS linear() easing over its settle-to-0.1% duration, RDP-simplified to within
 * `eps` of progress. Returns null under prefers-reduced-motion (callers skip the motion).
 */
export function toLinear(sp, eps = 0.0015, { reducedMotion } = {}) {
  if (reducedMotion ?? prefersReducedMotion()) return null;
  const D = sp.settleMs(0.001);
  const N = 240;
  const ys = Array.from({ length: N + 1 }, (_, i) => (i === N ? 1 : sp.at((i / N) * D)));
  const kept = rdp(N + 1, (a, b, i) => {
    const y = ys[a] + (ys[b] - ys[a]) * (i - a) / (b - a);
    return Math.abs(ys[i] - y);
  }, eps);
  const parts = kept.map((i, k) => {
    if (k === 0) return '0';
    if (k === kept.length - 1) return '1';
    return `${r4(ys[i])} ${+(i / N * 100).toFixed(2)}%`;
  });
  return { easing: 'linear(' + parts.join(', ') + ')', durationMs: D, points: kept.length };
}

/* cubic-bezier(x1,y1,x2,y2) as a function of x in [0,1] (Newton then bisection). */
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (s) => ((ax * s + bx) * s + cx) * s;
  const Y = (s) => ((ay * s + by) * s + cy) * s;
  const dX = (s) => (3 * ax * s + 2 * bx) * s + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let s = x;
    for (let i = 0; i < 8; i++) {
      const d = X(s) - x;
      if (Math.abs(d) < 1e-7) return Y(s);
      const D = dX(s);
      if (Math.abs(D) < 1e-6) break;
      s -= d / D;
    }
    let lo = 0, hi = 1; s = x;
    for (let i = 0; i < 40; i++) { const v = X(s); if (Math.abs(v - x) < 1e-7) break; if (v < x) lo = s; else hi = s; s = (lo + hi) / 2; }
    return Y(s);
  };
}

/* ── Channels ──
   A channel drives one property of one element:
     { prop, spring, from, to, delay, timeScale }   a spring (progress at (t - delay) * timeScale)
     { prop, ramp: { from, to, delay, duration, ease } }   opacity is never a spring
     { prop, fn: (t) => value, end }                anything derived (a lift from a flight's progress)
   Props: x, y, rotate (deg) add up across channels; scale, scaleX, scaleY, opacity multiply. */
const ADD = new Set(['x', 'y', 'rotate']);
const IDENTITY = { x: 0, y: 0, rotate: 0, scale: 1, scaleX: 1, scaleY: 1, opacity: 1 };

export function channelValue(ch, t) {
  if (ch.fn) return ch.fn(t);
  if (ch.ramp) {
    const { from, to, delay = 0, duration, ease } = ch.ramp;
    if (t <= delay) return from;
    if (t >= delay + duration) return to;
    const p = (t - delay) / duration;
    return from + (to - from) * (ease ? ease(p) : p);
  }
  const d = ch.delay || 0;
  // `before`: what the channel holds until it starts. A spring that launches from a displaced
  // position (a spread, a flight) holds `from`; an impulse (a landing squash) holds its rest value
  // and jumps at its start.
  if (t < d) return ch.before !== undefined ? ch.before : ch.from;
  return ch.from + (ch.to - ch.from) * ch.spring.at((t - d) * (ch.timeScale || 1));
}

/** When a channel stops changing by more than tolPx (in its own px-equivalent units). */
export function channelEnd(ch, weight = 1, tolPx = 0.25) {
  if (ch.fn) return ch.end || 0;
  if (ch.ramp) return (ch.ramp.delay || 0) + ch.ramp.duration;
  const travel = Math.abs(ch.to - ch.from) * weight;
  if (travel < 1e-6 && !ch.spring.velocity) return ch.delay || 0;
  // Until it stays within the tolerance of where it rests (in px), and never longer than the
  // settle to 1% of its travel: past that the element's own style takes over with a jump below
  // the tolerance.
  const eps = Math.max(1e-5, Math.min(0.01, tolPx / Math.max(travel, 1e-6)));
  return (ch.delay || 0) + ch.spring.settleMs(eps) / (ch.timeScale || 1);
}

/** Composed property values at time t. */
export function composeAt(channels, t) {
  const v = { ...IDENTITY };
  for (const ch of channels) {
    const x = channelValue(ch, t);
    if (ADD.has(ch.prop)) v[ch.prop] += x;
    else v[ch.prop] *= x;
  }
  return v;
}

const fx = (n, d = 2) => {
  const s = (+n).toFixed(d);
  return s === '-0' || /^-0\.0+$/.test(s) ? '0' : String(+s);
};

/** The transform string for a set of composed values (always the same function list). */
export function transformOf(v, { prefix = '', rotate = false, scale = false } = {}) {
  let s = (prefix ? prefix + ' ' : '') + `translate(${fx(v.x)}px, ${fx(v.y)}px)`;
  if (rotate) s += ` rotate(${fx(v.rotate, 3)}deg)`;
  if (scale) s += ` scale(${fx(v.scale * v.scaleX, 4)}, ${fx(v.scale * v.scaleY, 4)})`;
  return s;
}

/**
 * Web Animations keyframes for one element: every channel contributes one term to a single composed
 * transform (plus opacity) per sample, sampled at `hz` and RDP-simplified to within `tolPx`.
 * Returns null under prefers-reduced-motion.
 *
 * @param {object[]} channels
 * @param {object} [opts]
 * @param {number} [opts.hz=120]     sample rate: at 60Hz the launch of a 400px flight misses the
 *                                   true curve by ~3px, visible on a 120Hz screen; at 120 it is <1
 * @param {number} [opts.tolPx=0.25]
 * @param {{w:number,h:number}} [opts.size]  the element's box, to weigh scale and rotation in px
 * @param {string} [opts.prefix]     a transform that leads every keyframe (a wager's centring)
 * @param {number} [opts.end]        cut the animation here (ms) instead of when it settles
 * @returns {{ keyframes: object[], delay: number, duration: number, end: number } | null}
 */
export function keyframes(channels, opts = {}) {
  const { hz = 120, tolPx = 0.25, size = { w: 40, h: 56 }, prefix = '', end: endOverride, reducedMotion } = opts;
  if (reducedMotion ?? prefersReducedMotion()) return null;
  if (!channels || !channels.length) return null;
  const w = Math.max(1, size.w || 1), h = Math.max(1, size.h || 1);
  const weight = {
    x: 1, y: 1,
    rotate: Math.hypot(w, h) / 2 * Math.PI / 180,
    scale: Math.max(w, h) / 2, scaleX: w / 2, scaleY: h / 2,
    opacity: tolPx / 0.004,
  };
  const props = [...new Set(channels.map(c => c.prop))];
  const hasRotate = props.includes('rotate');
  const hasScale = props.some(p => p === 'scale' || p === 'scaleX' || p === 'scaleY');
  const hasOpacity = props.includes('opacity');
  const startOf = (c) => (c.fn ? 0 : c.ramp ? (c.ramp.delay || 0) : (c.delay || 0));
  const t0 = Math.max(0, Math.min(...channels.map(startOf)));
  const tEnd = endOverride != null ? endOverride
    : Math.max(t0 + 1, ...channels.map(c => channelEnd(c, weight[c.prop] || 1, tolPx)));
  // Samples: the grid, plus every channel's exact start (a spring that launches mid-animation has
  // a corner there that the grid would round off).
  const times = new Set();
  const dt = 1000 / hz;
  for (let t = t0; t < tEnd; t += dt) times.add(+t.toFixed(4));
  times.add(+tEnd.toFixed(4));
  for (const c of channels) {
    const s = startOf(c);
    if (s > t0 && s < tEnd) times.add(+s.toFixed(4));
    if (c.ramp) { const e = c.ramp.delay + c.ramp.duration; if (e > t0 && e < tEnd) times.add(+e.toFixed(4)); }
  }
  const ts = [...times].sort((a, b) => a - b);
  const vals = ts.map(t => composeAt(channels, t));
  // The error of a sample against the chord, in px: the largest over every animated dimension.
  const dims = [['x', 'x'], ['y', 'y']];
  if (hasRotate) dims.push(['rotate', 'rotate']);
  if (hasScale) dims.push(['sx', 'scaleX'], ['sy', 'scaleY']);
  if (hasOpacity) dims.push(['opacity', 'opacity']);
  const get = (v, d) => (d === 'sx' ? v.scale * v.scaleX : d === 'sy' ? v.scale * v.scaleY : v[d]);
  const kept = rdp(ts.length, (a, b, i) => {
    const f = (ts[i] - ts[a]) / (ts[b] - ts[a]);
    let m = 0;
    for (const [d, wk] of dims) {
      const va = get(vals[a], d), vb = get(vals[b], d), vi = get(vals[i], d);
      m = Math.max(m, Math.abs(vi - (va + (vb - va) * f)) * weight[wk]);
    }
    return m;
  }, tolPx);
  const duration = Math.max(1, tEnd - t0);
  const frames = kept.map(i => {
    const kf = { offset: +((ts[i] - t0) / duration).toFixed(6), transform: transformOf(vals[i], { prefix, rotate: hasRotate, scale: hasScale }) };
    if (hasOpacity) kf.opacity = +Math.min(1, Math.max(0, vals[i].opacity)).toFixed(4);
    return kf;
  });
  frames[0].offset = 0;
  frames[frames.length - 1].offset = 1;
  return { keyframes: frames, delay: t0, duration, end: tEnd };
}
