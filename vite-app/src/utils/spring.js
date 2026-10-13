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
   the rounded literals the ad team pastes into Remotion. Two tiers keep the stiffness and the mass
   and change only the damping ratio, on purpose: yield is critically damped, because something
   pushed aside to make room never bounces, and slide is damped to 0.92, because a card sliding on
   felt is stopped by friction and does not spring back (on the hand spring the flop's window card
   ran 1.1px past its slot and crept back for 120ms, the sharpest edge on the table never quite
   still). armLight and armHeavy are the arm with its mass varied a little either side of 1.6 (same
   stiffness, same damping ratio): the five chips shipped to a winner are a handful, each on its own
   weight, not five copies of one flight, and close enough in weight to arrive together. */
export const SPRING_SETS = {
  // Set A, "House": k 380, zeta 0.80, 1.5% overshoot. A dealer's hands.
  A: {
    name: 'house',
    tiers: {
      flick:    { stiffness: 380, damping: 23.1, mass: 0.55 },
      hand:     { stiffness: 380, damping: 31.2, mass: 1 },
      arm:      { stiffness: 380, damping: 39.5, mass: 1.6 },
      inertia:  { stiffness: 380, damping: 48.3, mass: 2.4 },
      yield:    { stiffness: 380, damping: 28.9, mass: 0.55 },
      slide:    { stiffness: 380, damping: 35.9, mass: 1 },
      armLight: { stiffness: 380, damping: 38.8, mass: 1.55 },
      armHeavy: { stiffness: 380, damping: 40.1, mass: 1.65 },
    },
    stage: {
      sweepStagger: 40, sweepCap: 160,   // between wagers swept in; all gone within the cap
      place: 60,                         // sweep -> the flop stack is placed
      beat: 150,                         // placement -> the window card spreads (as the last
                                         // swept chip lands; at 220 the placed stack sat dead
                                         // still for 13 frames)
      midLag: 40,                        // window card -> middle card
      yieldAfterSweep: 40,               // sweep -> the row makes room
      cardLag: 30,                       // row -> the new card is placed
      boardWaitMax: 90,                  // the board waits at most this long for a chip to cross
                                         // it; past that the chip flies over the moving board
      shipAfterSweep: 0,                 // the last swept wager's arrival -> the pot leaves for
                                         // the winner (plus the ghost's arrival fade)
      // A card is placed, not dissolved: opaque in two frames, entering its drop already moving.
      appear: 33, placeVelocity: 5,
      // The ghost touches down and is gone in three frames; its amount is gone in the first 10px.
      arrivalFade: 50, labelFade: 40,
      // The pile: a stack new to it fades in under the ghost that lands on it, in two frames; one
      // that leaves it (the pot's colours change as it grows) fades out as the row makes room
      // (yieldAfterSweep after the sweep starts).
      pileIn: 33, pileOut: 50,
      placeScale: 1.08, placeDrop: 0.15, // x card height
      rot: { flop: -3, turn: 2.5, river: -2 },
      push: 0.55, addOn: 0.3,            // x board card width
      squash: [1.04, 0.94],
      sweepLift: 0.06, crossLift: 0.15,  // a chip whose path crosses the board is visibly airborne
      // The ship: a handful pushed across the felt, not a file of coins. The five leave within 24ms
      // (at 22ms apart, 2,400px/s strung them over 205px, 15 diameters), on masses close enough that
      // they land within about 45ms of each other, and they fan out sideways instead: chip i flies on
      // shipTiers[i], bowed shipBows[i] * shipBow board-card widths to one side, stretched up to
      // 1 + stretchMax along its path while fast.
      shipStagger: 6, shipTiers: ['arm', 'armHeavy', 'armLight', 'arm', 'armHeavy'],
      // stretchMax 0.35: a 1.35:1 smear at the fastest, a chip moving; at 0.6 it was a 2.1:1 capsule.
      shipBow: 0.45, shipBows: [1, -1, 0.6, -0.6, 0.3], stretchMax: 0.35,
      shipLift: 0.15, shipShrink: 0.85,
      // A pile stack leaves with its chip, in a frame: the chip is under it, fully opaque, so the
      // stack going is the chip appearing (a 50ms fade over a fading-in chip was a muddy disc).
      stackOut: 16,
    },
  },
  // Set B, "Snappy": k 640, zeta 0.86, 0.5% overshoot. A broadcast graphic.
  B: {
    name: 'snappy',
    tiers: {
      flick:    { stiffness: 640, damping: 32.3, mass: 0.55 },
      hand:     { stiffness: 640, damping: 43.5, mass: 1 },
      arm:      { stiffness: 640, damping: 55.0, mass: 1.6 },
      inertia:  { stiffness: 640, damping: 67.4, mass: 2.4 },
      yield:    { stiffness: 640, damping: 37.5, mass: 0.55 },
      slide:    { stiffness: 640, damping: 46.4, mass: 1 },
      armLight: { stiffness: 640, damping: 54.2, mass: 1.55 },
      armHeavy: { stiffness: 640, damping: 55.9, mass: 1.65 },
    },
    stage: {
      sweepStagger: 25, sweepCap: 120,
      place: 40, beat: 140, midLag: 25, yieldAfterSweep: 25, cardLag: 20, boardWaitMax: 60, shipAfterSweep: 0,
      appear: 33, placeVelocity: 5,
      arrivalFade: 40, labelFade: 35,
      pileIn: 33, pileOut: 40,
      placeScale: 1.05, placeDrop: 0.10,
      rot: { flop: -2, turn: 1.5, river: -1.5 },
      push: 0.4, addOn: 0.22,
      squash: [1.03, 0.955],
      sweepLift: 0.04, crossLift: 0.12,
      shipStagger: 5, shipTiers: ['arm', 'armHeavy', 'armLight', 'arm', 'armHeavy'],
      shipBow: 0.45, shipBows: [1, -1, 0.6, -0.6, 0.3], stretchMax: 0.35,
      shipLift: 0.10, shipShrink: 0.85, stackOut: 16,
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
 *
 * Cheap to build and cheap to ask: everything is closed form or a short search, and every answer is
 * cached on the spring. A moment builds its springs in the commit of a press, on the frame an old
 * phone can least afford, so nothing here walks the curve in fixed steps. (It used to: a 4,000-step
 * overshoot scan per spring and a 10,000-step settle scan per tolerance asked, which was most of a
 * long press frame at a 4x CPU throttle.)
 * @returns {{ at(ms): number, velocityAt(ms): number, settleMs(eps?): number, overshootPct: number,
 *            stiffness, damping, mass, velocity, zeta, w0 }}
 */
export function spring({ stiffness, damping, mass = 1, velocity = 0 } = {}) {
  const k = Number(stiffness), c = Number(damping), m = Number(mass) || 1, v0 = Number(velocity) || 0;
  if (!(k > 0) || !(c >= 0)) throw new Error('spring: stiffness must be > 0 and damping >= 0');
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  // Error e(t) = 1 - x(t): e(0) = 1, e'(0) = -v0. env(t) bounds |e(t)| from above and decays
  // monotonically, so the last time |e| exceeds eps is no later than where env falls to eps.
  let e, de, env;
  if (Math.abs(zeta - 1) < 1e-9) {
    const b = w0 - v0;
    e = (t) => Math.exp(-w0 * t) * (1 + b * t);
    de = (t) => Math.exp(-w0 * t) * (b - w0 * (1 + b * t));
    env = (t) => Math.exp(-w0 * t) * (1 + Math.abs(b) * t);
  } else if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const B = (zeta * w0 - v0) / wd;
    const amp = Math.sqrt(1 + B * B);
    e = (t) => Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + B * Math.sin(wd * t));
    de = (t) => {
      const ex = Math.exp(-zeta * w0 * t), co = Math.cos(wd * t), si = Math.sin(wd * t);
      return ex * (-zeta * w0 * (co + B * si) + wd * (B * co - si));
    };
    env = (t) => amp * Math.exp(-zeta * w0 * t);
  } else {
    const s = Math.sqrt(zeta * zeta - 1);
    const r1 = -w0 * (zeta - s), r2 = -w0 * (zeta + s);
    const A = (-v0 - r2) / (r1 - r2), B = 1 - A;
    e = (t) => A * Math.exp(r1 * t) + B * Math.exp(r2 * t);
    de = (t) => A * r1 * Math.exp(r1 * t) + B * r2 * Math.exp(r2 * t);
    env = (t) => (Math.abs(A) + Math.abs(B)) * Math.exp(r1 * t);
  }
  const at = (ms) => (ms <= 0 ? 0 : ms === Infinity ? 1 : 1 - e(ms / 1000));
  const velocityAt = (ms) => (ms === Infinity ? 0 : -de(Math.max(0, ms) / 1000));
  // The last moment the error is above eps (position only, as the spec's table), to 1ms: where the
  // envelope falls to eps (doubling, then bisection), then back from there to the last excursion
  // past eps, which is never more than half an oscillation earlier.
  const settleCache = new Map();
  const settleMs = (eps = 0.001) => {
    if (settleCache.has(eps)) return settleCache.get(eps);
    let hi = 0.01;
    while (env(hi) > eps && hi < 60) hi *= 2;
    let lo = 0;
    for (let i = 0; i < 40 && hi - lo > 1e-4; i++) { const mid = (lo + hi) / 2; if (env(mid) > eps) lo = mid; else hi = mid; }
    let last = 0;
    for (let t = Math.ceil(hi * 1000); t >= 1; t--) if (Math.abs(e(t / 1000)) > eps) { last = t; break; }
    settleCache.set(eps, last + 1);
    return last + 1;
  };
  let peakPct = null;
  return {
    at, velocityAt, settleMs,
    // How far past 1 it ever goes: closed form from rest; otherwise the largest of the turning
    // points past 1 (the velocity's sign changes, each found by bisection).
    get overshootPct() {
      if (peakPct != null) return peakPct;
      if (zeta >= 1 - 1e-9 && v0 <= 0) return (peakPct = 0);
      if (zeta < 1 && v0 === 0) return (peakPct = Math.exp(-Math.PI * zeta / Math.sqrt(1 - zeta * zeta)) * 100);
      let best = 0;
      const end = settleMs(1e-4);
      let prev = velocityAt(0);
      for (let t = 2; t <= end + 2; t += 2) {
        const v = velocityAt(t);
        if (prev > 0 && v <= 0) {
          let lo = t - 2, hi = t;
          for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (velocityAt(mid) > 0) lo = mid; else hi = mid; }
          best = Math.max(best, at(lo) - 1);
        }
        prev = v;
      }
      return (peakPct = Math.max(0, best) * 100);
    },
    stiffness: k, damping: c, mass: m, velocity: v0, zeta, w0,
    _timeTo: new Map(),
  };
}

/* Springs are values: the same config is the same curve, so a moment asks for its tiers by config
   and reuses the one already built, cached settle times and all. A retarget with a handed-over
   velocity is a new curve and is simply built. */
const springCache = new Map();
export function springOf(cfg) {
  const key = cfg.stiffness + '|' + cfg.damping + '|' + (cfg.mass || 1) + '|' + (cfg.velocity || 0);
  let sp = springCache.get(key);
  if (!sp) {
    if (springCache.size > 256) springCache.clear();
    sp = spring(cfg);
    springCache.set(key, sp);
  }
  return sp;
}

/** The first time (ms) progress reaches `frac`: a 2ms scan to bracket it, then bisection. */
export function timeTo(sp, frac) {
  const cache = sp._timeTo;
  if (cache && cache.has(frac)) return cache.get(frac);
  let found = 10000;
  if (sp.at(0) >= frac) found = 0;
  else {
    let prevT = 0;
    for (let t = 2; t <= 10000; t += 2) {
      if (sp.at(t) >= frac) {
        let lo = prevT, hi = t;
        for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (sp.at(mid) >= frac) hi = mid; else lo = mid; }
        found = hi;
        break;
      }
      prevT = t;
    }
  }
  if (cache) cache.set(frac, found);
  return found;
}

/** A tier of a set as a spring (optionally with a starting velocity). */
export function tierSpring(setId, tier, velocity = 0) {
  const set = SPRING_SETS[setId] || SPRING_SETS.A;
  return springOf({ ...set.tiers[tier], velocity });
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
   Props: x, y, rotate (deg) add up across channels; scale, scaleX, scaleY, opacity and stretch
   multiply. `stretch` is a velocity stretch along a fixed axis (keyframes' `axis`, in degrees): the
   element grows by `stretch` along the axis and shrinks by 1/sqrt(stretch) across it, so a fast
   flight smears along its path instead of strobing. */
const ADD = new Set(['x', 'y', 'rotate']);
const IDENTITY = { x: 0, y: 0, rotate: 0, scale: 1, scaleX: 1, scaleY: 1, opacity: 1, stretch: 1 };

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
  // Until it stays within the tolerance of where it rests, in px, however small the travel: a 1%
  // floor here let a 2.5 degree squaring ride to 600ms and RDP draw its tail as one straight line,
  // a card creeping while it looked still. The last keyframe is the exact rest (keyframes()).
  const eps = Math.min(0.5, Math.max(1e-4, tolPx / Math.max(travel, 1e-6)));
  return (ch.delay || 0) + ch.spring.settleMs(eps) / (ch.timeScale || 1);
}

/** Composed property values at time t (Infinity: where the element rests). */
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

/* The two scale factors along and across the stretch axis (or plain x and y without one). */
const scaleAlong = (v) => v.scale * v.scaleX * v.stretch;
const scaleAcross = (v) => v.scale * v.scaleY / Math.sqrt(v.stretch);

/** The transform string for a set of composed values (always the same function list). */
export function transformOf(v, { prefix = '', rotate = false, scale = false, axis = null } = {}) {
  let s = (prefix ? prefix + ' ' : '') + `translate(${fx(v.x)}px, ${fx(v.y)}px)`;
  if (rotate) s += ` rotate(${fx(v.rotate, 3)}deg)`;
  if (axis != null) {
    // rotate(a) scale(along, across) rotate(-a): a pure stretch along the axis, no net turn.
    s += ` rotate(${fx(axis, 3)}deg) scale(${fx(scaleAlong(v), 4)}, ${fx(scaleAcross(v), 4)}) rotate(${fx(-axis, 3)}deg)`;
  } else if (scale) {
    s += ` scale(${fx(v.scale * v.scaleX, 4)}, ${fx(v.scale * v.scaleY, 4)})`;
  }
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
 * @param {number} [opts.tolPx=0.25] board cards ask for 0.1: a card's edge is the sharpest thing on
 *                                   the felt, and 0.25px of rotation is half a degree
 * @param {{w:number,h:number}} [opts.size]  the element's box, to weigh scale and rotation in px
 * @param {string} [opts.prefix]     a transform that leads every keyframe (a wager's centring)
 * @param {number} [opts.axis]       the stretch axis, degrees (a flight's direction)
 * @param {number} [opts.end]        cut the animation here (ms) instead of when it settles
 * @returns {{ keyframes: object[], delay: number, duration: number, end: number } | null}
 */
export function keyframes(channels, opts = {}) {
  const { hz = 120, tolPx = 0.25, size = { w: 40, h: 56 }, prefix = '', axis = null, end: endOverride, reducedMotion } = opts;
  if (reducedMotion ?? prefersReducedMotion()) return null;
  if (!channels || !channels.length) return null;
  const w = Math.max(1, size.w || 1), h = Math.max(1, size.h || 1);
  const weight = {
    x: 1, y: 1,
    rotate: Math.hypot(w, h) / 2 * Math.PI / 180,
    scale: Math.max(w, h) / 2, scaleX: w / 2, scaleY: h / 2, stretch: Math.max(w, h) / 2,
    opacity: tolPx / 0.004,
  };
  const props = [...new Set(channels.map(c => c.prop))];
  const hasRotate = props.includes('rotate');
  const hasStretch = axis != null && props.includes('stretch');
  const hasScale = hasStretch || props.some(p => p === 'scale' || p === 'scaleX' || p === 'scaleY');
  const hasOpacity = props.includes('opacity');
  // A function channel can say when it starts moving (`start`): before that it holds, and the
  // animation's delay covers it instead of samples (the pot shipped at a result waits ~280ms for
  // the river's wagers to land: sampled from 0, that was 40% of its keyframes' work, all holding).
  const startOf = (c) => (c.fn ? (c.start || 0) : c.ramp ? (c.ramp.delay || 0) : (c.delay || 0));
  let t0 = Infinity, tEnd = endOverride;
  for (const c of channels) t0 = Math.min(t0, startOf(c));
  t0 = Math.max(0, t0);
  if (tEnd == null) {
    tEnd = t0 + 1;
    for (const c of channels) tEnd = Math.max(tEnd, channelEnd(c, weight[c.prop] || 1, tolPx));
  }
  // Samples: the grid, plus every channel's exact start (a spring that launches mid-animation has
  // a corner there that the grid would round off).
  const ts = [];
  const dt = 1000 / hz;
  for (let t = t0; t < tEnd - 1e-6; t += dt) ts.push(t);
  ts.push(tEnd);
  let extra = false;
  for (const c of channels) {
    const s = startOf(c);
    if (s > t0 && s < tEnd) { ts.push(s); extra = true; }
    if (c.ramp) { const e = c.ramp.delay + c.ramp.duration; if (e > t0 && e < tEnd) { ts.push(e); extra = true; } }
  }
  if (extra) {
    ts.sort((a, b) => a - b);
    for (let i = ts.length - 1; i > 0; i--) if (ts[i] - ts[i - 1] < 1e-3) ts.splice(i, 1);
  }
  /* Sampled channel-major into one typed array per property (a press builds every element of a
     moment in the frame an old phone can least afford: an object per sample and a closure per
     comparison made this most of the moment's script, 16ms of a result press at a 4x CPU throttle). */
  const n = ts.length;
  const arr = {};
  for (const p of ['x', 'y', 'rotate', 'scale', 'scaleX', 'scaleY', 'opacity', 'stretch']) {
    if (!props.includes(p) && !(p === 'scale' && hasScale)) continue;
    arr[p] = new Float64Array(n).fill(IDENTITY[p]);
  }
  for (const ch of channels) {
    const A = arr[ch.prop];
    const add = ADD.has(ch.prop);
    if (ch.spring && !ch.fn && !ch.ramp) {
      const d = ch.delay || 0, k = ch.timeScale || 1, from = ch.from, span = ch.to - ch.from, sp = ch.spring;
      const before = ch.before !== undefined ? ch.before : from;
      for (let i = 0; i < n; i++) {
        const t = ts[i];
        const v = t < d ? before : from + span * sp.at((t - d) * k);
        if (add) A[i] += v; else A[i] *= v;
      }
    } else {
      for (let i = 0; i < n; i++) {
        const v = channelValue(ch, ts[i]);
        if (add) A[i] += v; else A[i] *= v;
      }
    }
  }
  // Unless it is cut short (a ghost, gone at its end), the last keyframe is exactly where the element
  // rests, so the hand-off to its own style never jumps, however small.
  if (endOverride == null) {
    const rest = composeAt(channels, Infinity);
    for (const p in arr) arr[p][n - 1] = rest[p];
  }
  const one = (p) => arr[p] || null;
  const valAt = (i) => {
    const v = { ...IDENTITY };
    for (const p in arr) v[p] = arr[p][i];
    return v;
  };
  // The error of a sample against the chord, in px: the largest over every animated dimension.
  const dims = [[arr.x || new Float64Array(n), weight.x], [arr.y || new Float64Array(n), weight.y]];
  if (hasRotate) dims.push([arr.rotate, weight.rotate]);
  if (hasScale) {
    const sx = new Float64Array(n), sy = new Float64Array(n);
    const S = one('scale'), SX = one('scaleX'), SY = one('scaleY'), ST = hasStretch ? one('stretch') : null;
    for (let i = 0; i < n; i++) {
      const sc = S ? S[i] : 1;
      sx[i] = sc * (SX ? SX[i] : 1) * (ST ? ST[i] : 1);
      sy[i] = sc * (SY ? SY[i] : 1) / (ST ? Math.sqrt(ST[i]) : 1);
    }
    dims.push([sx, weight.scaleX], [sy, weight.scaleY]);
  }
  if (hasOpacity) dims.push([arr.opacity, weight.opacity]);
  const kept = rdp(n, (a, b, i) => {
    const f = (ts[i] - ts[a]) / (ts[b] - ts[a]);
    let m = 0;
    for (let k = 0; k < dims.length; k++) {
      const D = dims[k][0];
      const err = Math.abs(D[i] - (D[a] + (D[b] - D[a]) * f)) * dims[k][1];
      if (err > m) m = err;
    }
    return m;
  }, tolPx);
  const duration = Math.max(1, tEnd - t0);
  const tf = { prefix, rotate: hasRotate, scale: hasScale, axis: hasStretch ? axis : null };
  const frames = kept.map(i => {
    const v = valAt(i);
    const kf = { offset: +((ts[i] - t0) / duration).toFixed(6), transform: transformOf(v, tf) };
    if (hasOpacity) kf.opacity = +Math.min(1, Math.max(0, v.opacity)).toFixed(4);
    return kf;
  });
  frames[0].offset = 0;
  frames[frames.length - 1].offset = 1;
  return { keyframes: frames, delay: t0, duration, end: tEnd };
}
