// node --test src/utils/__tests__/spring.test.mjs  (from vite-app/)
// The replayer's springs (utils/spring.js): the closed-form oscillator against the numbers the motion
// spec was written from, the phases a spring must go through, the CSS linear() form, the sampled
// Web Animations keyframes, and the reduced-motion path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPRING_SETS, spring, timeTo, tierSpring, toLinear, keyframes, composeAt, channelValue,
  springSetFor, rateFor, cubicBezier, prefersReducedMotion,
} from '../spring.js';

const RM = { reducedMotion: false };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

/* The spec's tables, computed from the closed form: overshoot %, t95 and the settle to 0.1% (ms). */
const SPEC = {
  A: {
    flick:   { os: 1.5, t95: 129, settle: 323 },
    hand:    { os: 1.5, t95: 174, settle: 435 },
    arm:     { os: 1.5, t95: 221, settle: 551 },
    inertia: { os: 1.5, t95: 269, settle: 674 },
    yield:   { os: 0,   t95: 181, settle: 351 },
  },
  B: {
    flick:   { os: 0.5, t95: 110, settle: 257 },
    hand:    { os: 0.5, t95: 149, settle: 347 },
    arm:     { os: 0.5, t95: 188, settle: 439 },
    inertia: { os: 0.5, t95: 230, settle: 537 },
    yield:   { os: 0,   t95: 139, settle: 271 },
  },
};

test('every tier matches the spec: overshoot, t95, settle to 0.1%', () => {
  for (const [set, tiers] of Object.entries(SPEC)) {
    for (const [tier, want] of Object.entries(tiers)) {
      const sp = tierSpring(set, tier);
      near(sp.overshootPct, want.os, 0.1, `${set}.${tier} overshoot`);
      near(timeTo(sp, 0.95), want.t95, 2, `${set}.${tier} t95`);
      near(sp.settleMs(0.001), want.settle, 2, `${set}.${tier} settle`);
    }
  }
});

test('one family: every tier of a set shares stiffness and damping ratio; only mass changes', () => {
  for (const set of ['A', 'B']) {
    const all = Object.entries(SPRING_SETS[set].tiers);
    assert.equal(new Set(all.map(([, c]) => c.stiffness)).size, 1, set + ': one stiffness, every tier');
    const tiers = all.filter(([n]) => n !== 'yield' && n !== 'slide');
    const zetas = tiers.map(([n]) => tierSpring(set, n).zeta);
    for (const z of zetas) near(z, zetas[0], 0.005, set + ' damping ratio');
    // The two that differ only in damping, on purpose: pushed aside, and slid on felt.
    near(tierSpring(set, 'yield').zeta, 1, 0.002, set + ' yield is critically damped');
    near(tierSpring(set, 'slide').zeta, 0.92, 0.005, set + ' slide is damped to 0.92');
    assert.equal(SPRING_SETS[set].tiers.slide.mass, SPRING_SETS[set].tiers.hand.mass, set + ' slide is the hand\'s mass');
  }
});

test('slide: the flop spread stops without springing back', () => {
  for (const set of ['A', 'B']) {
    const sp = tierSpring(set, 'slide');
    assert.ok(sp.overshootPct < 0.1, `${set} overshoot ${sp.overshootPct}%: under 0.1px on a 74px spread`);
    assert.ok(sp.settleMs(0.1 / 73.6) < 340, `${set} settles to 0.1px by ${sp.settleMs(0.1 / 73.6)}ms`);
  }
});

test('"hand" progress at the harness check points', () => {
  const h = tierSpring('A', 'hand');
  const pts = { 17: 0.046, 33: 0.146, 50: 0.280, 83: 0.544, 117: 0.757, 150: 0.891, 183: 0.966, 217: 1.002, 269: 1.015, 300: 1.013, 350: 1.007 };
  for (const [t, p] of Object.entries(pts)) near(h.at(Number(t)), p, 0.0015, 'hand at ' + t + 'ms');
});

test('phases: rises monotonically to its first peak; a critically damped spring never passes 1', () => {
  for (const set of ['A', 'B']) {
    for (const tier of ['flick', 'hand', 'arm', 'inertia']) {
      const sp = tierSpring(set, tier);
      let prev = 0, t = 1;
      for (; t < 2000; t++) {
        const x = sp.at(t);
        if (x < prev) break;
        prev = x;
      }
      assert.ok(prev > 1, `${set}.${tier} overshoots before it first turns back`);
      // and after the peak it comes back toward 1 without ever falling below it by more than the
      // second (much smaller) swing
      let min = Infinity;
      for (let u = t; u < 2000; u++) min = Math.min(min, sp.at(u));
      assert.ok(min > 0.999, `${set}.${tier} second swing is tiny (${min})`);
    }
    const y = tierSpring(set, 'yield');
    let prev = 0;
    for (let t = 1; t < 2000; t++) {
      const x = y.at(t);
      assert.ok(x >= prev - 1e-12, `${set}.yield monotonic at ${t}`);
      assert.ok(x <= 1 + 1e-6, `${set}.yield never passes 1 (${x} at ${t})`);
      prev = x;
    }
  }
});

test('starts at 0 with the velocity it was given (a retarget hands velocity over)', () => {
  for (const v of [0, 3, -2, 12]) {
    for (const c of [{ stiffness: 380, damping: 31.2, mass: 1 }, { stiffness: 380, damping: 28.9, mass: 0.55 }, { stiffness: 380, damping: 60, mass: 1 }]) {
      const sp = spring({ ...c, velocity: v });
      assert.equal(sp.at(0), 0);
      near(sp.velocityAt(0), v, 1e-9, `velocity at 0 (${JSON.stringify(c)})`);
      // velocityAt is the derivative of at (per second)
      near(sp.velocityAt(40), (sp.at(40.5) - sp.at(39.5)) * 1000, 0.01, 'velocity is d(at)/dt');
      near(sp.at(5000), 1, 1e-6, 'comes to rest at 1');
    }
  }
});

test('toLinear: a valid CSS linear() of 26-28 points that follows the spring', () => {
  for (const set of ['A', 'B']) {
    for (const tier of Object.keys(SPRING_SETS[set].tiers)) {
      const sp = tierSpring(set, tier);
      const L = toLinear(sp, 0.0015, RM);
      assert.match(L.easing, /^linear\(0, (-?\d+(\.\d+)? \d+(\.\d+)?%, )+1\)$/, set + '.' + tier + ' syntax');
      // The spec's 26-28 for its tiers; the slide (no oscillation to draw) needs fewer.
      const [lo, hi] = tier === 'slide' ? [16, 28] : [26, 28];
      assert.ok(L.points >= lo && L.points <= hi, `${set}.${tier}: ${L.points} points`);
      assert.equal(L.durationMs, sp.settleMs(0.001));
      // Parse it back and check it against the curve.
      const inner = L.easing.slice(7, -1).split(', ');
      const pts = inner.map((s, i) => {
        if (i === 0) return [0, 0];
        if (i === inner.length - 1) return [1, 1];
        const [y, x] = s.split(' ');
        return [parseFloat(x) / 100, parseFloat(y)];
      });
      for (let i = 1; i < pts.length; i++) assert.ok(pts[i][0] > pts[i - 1][0], 'input positions increase');
      let worst = 0;
      for (let f = 0; f <= 1; f += 0.002) {
        const j = pts.findIndex(p => p[0] >= f);
        const [x0, y0] = pts[Math.max(0, j - 1)], [x1, y1] = pts[j];
        const y = x1 === x0 ? y1 : y0 + (y1 - y0) * (f - x0) / (x1 - x0);
        worst = Math.max(worst, Math.abs(y - sp.at(f * L.durationMs)));
      }
      assert.ok(worst < 0.003, `${set}.${tier} linear() within 0.3% of the spring (${worst.toFixed(4)})`);
    }
  }
});

test('reduced motion: the util returns null and callers skip the motion', () => {
  const sp = tierSpring('A', 'hand');
  assert.equal(toLinear(sp, 0.0015, { reducedMotion: true }), null);
  assert.equal(keyframes([{ prop: 'x', spring: sp, from: 10, to: 0 }], { reducedMotion: true }), null);
  // And by default it asks the platform.
  const had = globalThis.window;
  globalThis.window = { matchMedia: (q) => ({ matches: /prefers-reduced-motion: reduce/.test(q) }) };
  try {
    assert.equal(prefersReducedMotion(), true);
    assert.equal(toLinear(sp), null);
    assert.equal(keyframes([{ prop: 'x', spring: sp, from: 10, to: 0 }]), null);
  } finally {
    if (had === undefined) delete globalThis.window; else globalThis.window = had;
  }
  assert.equal(prefersReducedMotion(), false);
  assert.ok(toLinear(sp));
});

// The px translate (the last one: a prefix may lead with a percentage translate), rotate, scale.
const parseTransform = (s) => {
  const m = s.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/g).pop().match(/(-?[\d.]+)px, (-?[\d.]+)px/);
  const r = s.match(/rotate\((-?[\d.]+)deg\)/);
  const sc = s.match(/scale\((-?[\d.]+), (-?[\d.]+)\)/);
  return { x: +m[1], y: +m[2], rotate: r ? +r[1] : 0, sx: sc ? +sc[1] : 1, sy: sc ? +sc[2] : 1 };
};

test('keyframes: one composed transform per sample, within the tolerance of every channel', () => {
  const hand = tierSpring('A', 'hand'), inertia = tierSpring('A', 'inertia');
  const size = { w: 34.77, h: 41.58 };
  const channels = [
    { prop: 'opacity', ramp: { from: 0, to: 1, delay: 60, duration: 70 } },
    { prop: 'y', spring: hand, from: -6.2, to: 0, delay: 60 },
    { prop: 'scale', spring: hand, from: 1.08, to: 1, delay: 60 },
    { prop: 'rotate', spring: inertia, from: -3, to: 0, delay: 60 },
    { prop: 'x', spring: hand, from: -73.38, to: 0, delay: 280 },
  ];
  const k = keyframes(channels, { size, ...RM });
  assert.equal(k.delay, 60, 'starts at the first channel (fill: backwards before it)');
  assert.equal(k.keyframes[0].offset, 0);
  assert.equal(k.keyframes[k.keyframes.length - 1].offset, 1);
  for (let i = 1; i < k.keyframes.length; i++) assert.ok(k.keyframes[i].offset > k.keyframes[i - 1].offset);
  assert.ok(k.keyframes.length < 60, 'simplified: ' + k.keyframes.length + ' keyframes');
  const first = parseTransform(k.keyframes[0].transform);
  assert.deepEqual([first.x, first.y, first.rotate, first.sx], [-73.38, -6.2, -3, 1.08]);
  assert.equal(k.keyframes[0].opacity, 0);
  // Between keyframes the engine interpolates linearly: that must stay within 0.25px of the
  // true composed curve on x and y (plus the 0.01px the strings are rounded to).
  const kf = k.keyframes.map(f => ({ t: k.delay + f.offset * k.duration, ...parseTransform(f.transform), op: f.opacity }));
  let worst = 0;
  for (let t = k.delay; t <= k.end; t += 1) {
    const j = kf.findIndex(f => f.t >= t);
    const a = kf[Math.max(0, j - 1)], b = kf[j];
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    const v = composeAt(channels, t);
    worst = Math.max(worst, Math.abs(a.x + (b.x - a.x) * f - v.x), Math.abs(a.y + (b.y - a.y) * f - v.y));
  }
  assert.ok(worst <= 0.27, 'within tolerance: ' + worst.toFixed(3) + 'px');
  // It ends where the element rests (its own style takes over without a visible jump).
  const last = kf[kf.length - 1];
  assert.ok(Math.abs(last.x) <= 0.25 && Math.abs(last.y) <= 0.25 && Math.abs(last.sx - 1) < 0.01);
});

test('keyframes: a prefix leads every keyframe (a wager stays centred)', () => {
  const sp = tierSpring('A', 'flick');
  const k = keyframes([{ prop: 'x', spring: sp, from: 0, to: 0 }, { prop: 'y', spring: sp, from: -19.1, to: 0 }],
    { prefix: 'translate(-50%, -50%)', size: { w: 60, h: 20 }, ...RM });
  for (const f of k.keyframes) assert.ok(f.transform.startsWith('translate(-50%, -50%) translate('), f.transform);
});

test('channels: a launch holds `from`, an impulse holds `before`, a ramp is linear', () => {
  const sp = tierSpring('A', 'flick');
  assert.equal(channelValue({ prop: 'x', spring: sp, from: 5, to: 0, delay: 100 }, 50), 5);
  assert.equal(channelValue({ prop: 'scaleX', spring: sp, from: 1.04, to: 1, before: 1, delay: 100 }, 50), 1);
  assert.equal(channelValue({ prop: 'scaleX', spring: sp, from: 1.04, to: 1, before: 1, delay: 100 }, 100), 1.04);
  assert.equal(channelValue({ prop: 'opacity', ramp: { from: 0, to: 1, delay: 10, duration: 70 } }, 45), 0.5);
  // A time scale (autoplay rate) is the same curve, faster.
  const a = channelValue({ prop: 'x', spring: sp, from: 0, to: 1, timeScale: 2 }, 50);
  near(a, sp.at(100), 1e-12, 'rate 2 at 50ms = rate 1 at 100ms');
});

test('the flag and the autoplay rate', () => {
  assert.equal(springSetFor(null), 'A', 'unset: the default on this branch');
  assert.equal(springSetFor('1'), 'A');
  assert.equal(springSetFor('2'), 'B');
  assert.equal(springSetFor('snappy'), 'B');
  assert.equal(springSetFor('0'), null);
  near(rateFor(2000), 1, 1e-12, '0.5x');
  near(rateFor(1000), 1, 1e-12, '1x');
  near(rateFor(500), Math.SQRT2, 1e-12, '2x');
  near(rateFor(250), 2, 1e-12, '4x');
});

test('cubicBezier', () => {
  const leave = cubicBezier(0.55, 0, 0.85, 0.35);
  assert.equal(leave(0), 0);
  assert.equal(leave(1), 1);
  assert.ok(leave(0.5) < 0.25, 'ease-leave starts slow');
  const lin = cubicBezier(0.25, 0.25, 0.75, 0.75);
  near(lin(0.3), 0.3, 1e-6, 'a straight bezier is linear');
});
