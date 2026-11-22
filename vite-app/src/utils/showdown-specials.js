/* Special showdowns (owner, 2026-11-22: "make a new session for special hand animations to play at showdown"). Pure:
   which result earns which moment, and the moment's motion worked out in advance, so the replay, a step back and an
   export all draw the same frames. The DOM half is utils/showdown-moments.js.

   The flush flood (owner: "Flush should be a watermark-opacity flood of the suit symbol on the felt inside the rail,
   with simulated physics allowing them to bounce off of each other"; "only when hero wins"): the flush's suit pours
   onto the cloth and piles up against the rail, each symbol a disc that bounces off the others and the rail, then the
   whole flood fades. */
import { bestHighFor } from './poker-engine.js';

const known = (cards) => (cards || []).filter((c) => c && c.suit && c.suit !== 'x');

/**
 * The special moment the hero's showdown win earns, or null.
 *   cfg     the game's eval config (gameEvalFor)
 *   hero    the hero's cards [{ rank, suit }], everything the hero holds at the result
 *   others  every other seat still in at the result, as card lists (a mucked hand is [])
 *   board   the board the hand was decided on (empty in stud and draw)
 *   heroPaid  the hero took chips from the pot
 * A flush: the hero's high hand is a flush (not a straight flush) and beats every high hand shown, so a chopped flush
 * and a flush that only took a pot the high hand did not decide earn nothing. Hi-lo: the high half is the flush's.
 */
export function showdownSpecial({ cfg, hero, others = [], board = [], heroPaid }) {
  if (!cfg || !heroPaid || !others.length) return null;
  if (cfg.type !== 'high' && cfg.type !== 'hilo') return null;
  const h = known(hero), b = known(board);
  const ev = bestHighFor(cfg, h, b);
  if (!ev || !/^Flush\b/.test(ev.name)) return null;
  for (const o of others) {
    const oe = known(o).length ? bestHighFor(cfg, known(o), b) : null;
    if (oe && oe.score >= ev.score) return null;
  }
  // The suit: the one whose cards alone make the same hand (Omaha's two-and-three rule included).
  for (const s of ['s', 'h', 'd', 'c']) {
    const e = bestHighFor(cfg, h.filter((c) => c.suit === s), b.filter((c) => c.suit === s));
    if (e && e.score === ev.score) return { kind: 'flush', suit: s, name: ev.name };
  }
  return null;
}

/* A small seeded generator (mulberry32): the same hand floods the same way every time it is played. */
export function seeded(seedText) {
  let h = 2166136261 >>> 0;
  for (const ch of String(seedText)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  let a = h || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Signed distance from a point to a rounded rectangle centred at the origin (half sizes hx, hy, corner r), and the
   outward normal there. */
function roundedBox(px, py, hx, hy, r) {
  const qx = Math.abs(px) - (hx - r), qy = Math.abs(py) - (hy - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  const outside = Math.hypot(ox, oy);
  const d = outside + Math.min(Math.max(qx, qy), 0) - r;
  let nx, ny;
  if (outside > 0) { nx = ox / outside; ny = oy / outside; } else if (qx > qy) { nx = 1; ny = 0; } else { nx = 0; ny = 1; }
  return { d, nx: nx * Math.sign(px || 1), ny: ny * Math.sign(py || 1) };
}

/**
 * The flood, simulated. Every length is in the caller's px; times are ms of the flood's own clock.
 *   w, h, radius   the cloth inside the rail: a w x h box with corners of `radius` (a pill: min(w, h) / 2)
 *   size           a symbol's diameter (it varies 0.85-1.15 of it)
 *   count          how many (default: enough to cover about 28% of the cloth)
 *   seed           any text; the same text gives the same flood
 *   pourMs, holdMs, fadeMs   the pour, when the whole flood starts to fade, and how long the fade takes
 * Returns { bodies: [{ d, born, x: Float32Array, y, a }], hz, end, fadeAt, fadeMs, settledAt }: each body's centre (px
 * from the box's top left) and turn (degrees) at `hz` from its birth to the end. The cap on speed keeps a symbol under
 * 18px a frame at 60 fps (a jump is 24); a body that has come to rest sleeps, so a pile never shivers.
 */
export function simulateFlood({ w, h, radius, size, count, seed = 'flood', pourMs = 1100, holdMs = 3400, fadeMs = 700, hz = 120 }) {
  const rnd = seeded(seed);
  const R = Math.max(0, Math.min(radius == null ? Math.min(w, h) / 2 : radius, w / 2, h / 2));
  const n = count != null ? count : Math.max(12, Math.min(72, Math.round(0.28 * w * h / (size * size))));
  const hx = w / 2, hy = h / 2;
  const G = 1.6 * h;                                  // px/s^2: a fall across the cloth in about 1.1 s
  const vMax = Math.min(1000, 1.9 * h);               // px/s, under 17px a frame at 60 fps
  const vRest = 0.025 * h;                            // slower than this for a quarter second: asleep
  const E_BODY = 0.32, E_WALL = 0.38, MU = 0.28, SPIN = 0.35, W_MAX = 3, PASSES = 6;
  const dt = 1 / hz;                                  // one step a recorded frame
  const end = holdMs + fadeMs;
  const frames = Math.ceil(end * hz / 1000) + 1;
  const bodies = [];
  // Births: spread over the pour, more at first (a flood, then the last few).
  for (let i = 0; i < n; i++) {
    const u = (i + rnd() * 0.6) / n;
    const born = Math.round(pourMs * (1 - Math.sqrt(1 - Math.min(0.999, u))));
    const d = size * (0.85 + 0.3 * rnd());
    bodies.push({ d, r: d * 0.46, born, x: 0, y: 0, vx: 0, vy: 0, a: 0, w: 0, live: false, sleep: false, still: 0, touch: false, at: -1, track: null });
  }
  bodies.sort((p, q) => p.born - q.born);
  for (const b of bodies) b.track = { x: new Float32Array(frames), y: new Float32Array(frames), a: new Float32Array(frames) };
  const maxR = Math.max(...bodies.map((b) => b.r));
  const cell = 2 * maxR + 1, cols = Math.max(1, Math.ceil(w / cell)), rows = Math.max(1, Math.ceil(h / cell));
  const inside = (b) => roundedBox(b.x - hx, b.y - hy, hx - b.r, hy - b.r, Math.max(0, R - b.r));
  const live = [];
  const spawn = (b) => {
    // A place along the top of the cloth clear of every body there, else wait a frame.
    for (let tries = 0; tries < 8; tries++) {
      const x = b.r + (w - 2 * b.r) * (0.08 + 0.84 * rnd());
      const y = b.r + Math.min(h * 0.12, h - 2 * b.r);
      const c = roundedBox(x - hx, y - hy, hx - b.r, hy - b.r, Math.max(0, R - b.r));
      let px = x, py = y;
      if (c.d > 0) { px -= c.nx * c.d; py -= c.ny * c.d; }
      if (live.some((o) => Math.hypot(o.x - px, o.y - py) < o.r + b.r + 1)) continue;
      b.x = px; b.y = py;
      b.vx = (rnd() - 0.5) * 0.3 * vMax; b.vy = 0.22 * vMax;
      b.a = (rnd() - 0.5) * 50; b.w = (rnd() - 0.5) * 2 * W_MAX;
      b.live = true;
      live.push(b);
      return true;
    }
    return false;
  };
  let settledAt = null;
  let f = 0;
  for (; f < frames; f++) {
    const tMs = f * 1000 / hz;
    for (const b of bodies) if (!b.live && b.born <= tMs && !spawn(b)) b.born = tMs + 1000 / hz;
    for (const b of live) {
      if (b.sleep) continue;
      b.vy += G * dt;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > vMax) { b.vx *= vMax / sp; b.vy *= vMax / sp; }
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.a += b.w * dt * 180 / Math.PI;
      // A turn dies fast against something, slowly in the air.
      b.w *= Math.exp(-(b.touch ? 7 : 1.2) * dt);
      b.touch = false;
    }
    // The pairs that touch (or nearly), found through a grid of cells a body wide.
    const grid = new Map();
    for (const b of live) {
      const k = Math.min(cols - 1, Math.max(0, Math.floor(b.x / cell))) + cols * Math.min(rows - 1, Math.max(0, Math.floor(b.y / cell)));
      let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(b);
    }
    const pairs = [];
    for (const [k, l] of grid) {
      const cx = k % cols, cy = (k - cx) / cols;
      for (let oy = 0; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (oy === 0 && ox < 0) continue;
        if (cx + ox < 0 || cx + ox >= cols) continue;
        const m = oy === 0 && ox === 0 ? l : grid.get(cx + ox + cols * (cy + oy));
        if (!m) continue;
        for (let i = 0; i < l.length; i++) for (let j = (m === l ? i + 1 : 0); j < m.length; j++) {
          const p = l[i], q = m[j];
          if (p.sleep && q.sleep) continue;
          const rr = p.r + q.r + 0.5;
          if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 < rr * rr) pairs.push(p, q);
        }
      }
    }
    // Impulses and pushes apart; a sleeping body is a wall until something hits it hard.
    for (let it = 0; it < PASSES; it++) {
      for (let c = 0; c < pairs.length; c += 2) {
        const p = pairs[c], q = pairs[c + 1];
        const dx = q.x - p.x, dy = q.y - p.y, rr = p.r + q.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        const dist = Math.sqrt(d2) || 1e-6;
        const nx = dx / dist, ny = dy / dist;
        const rvx = q.vx - p.vx, rvy = q.vy - p.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn < -40) { if (p.sleep) { p.sleep = false; p.still = 0; } if (q.sleep) { q.sleep = false; q.still = 0; } }
        const ip = p.sleep ? 0 : 1, iq = q.sleep ? 0 : 1;
        if (!ip && !iq) continue;
        p.touch = q.touch = true;
        if (vn < 0) {
          const e = it === 0 && vn < -60 ? E_BODY : 0;
          const jn = -(1 + e) * vn / (ip + iq);
          p.vx -= jn * nx * ip; p.vy -= jn * ny * ip; q.vx += jn * nx * iq; q.vy += jn * ny * iq;
          // Friction along the contact slows the slide. A knock sets the symbols turning, for the look only: the
          // turn never feeds back into the motion, and a resting contact gives none, so a pile never spins in place.
          const tx = -ny, ty = nx;
          const vt = rvx * tx + rvy * ty;
          const jt = Math.max(-MU * jn, Math.min(MU * jn, -vt / (ip + iq)));
          p.vx -= jt * tx * ip; p.vy -= jt * ty * ip; q.vx += jt * tx * iq; q.vy += jt * ty * iq;
          if (e) { p.w -= ip * vt / p.r * SPIN; q.w += iq * vt / q.r * SPIN; }
        }
        const over = rr - dist - 0.2;
        if (over > 0) {
          const k = 0.5 * over / (ip + iq);
          p.x -= nx * k * ip; p.y -= ny * k * ip; q.x += nx * k * iq; q.y += ny * k * iq;
        }
      }
      for (const b of live) {
        if (b.sleep) continue;
        const c = inside(b);
        if (c.d <= 0) continue;
        b.x -= c.nx * c.d; b.y -= c.ny * c.d;
        b.touch = true;
        const vn = b.vx * c.nx + b.vy * c.ny;
        if (vn > 0) {
          const e = it === 0 && vn > 60 ? E_WALL : 0;
          b.vx -= (1 + e) * vn * c.nx; b.vy -= (1 + e) * vn * c.ny;
          const tx = -c.ny, ty = c.nx;
          const vt = b.vx * tx + b.vy * ty;
          const jt = Math.max(-MU * vn, Math.min(MU * vn, -vt));
          b.vx += jt * tx; b.vy += jt * ty;
          if (e) b.w += vt / b.r * SPIN;
        }
      }
    }
    // Rest: slow for a quarter second, then asleep where it lies.
    for (const b of live) {
      if (b.sleep) continue;
      if (Math.abs(b.w) > W_MAX) b.w = W_MAX * Math.sign(b.w);
      if (Math.hypot(b.vx, b.vy) < vRest && Math.abs(b.w) < 0.8) { if (++b.still > hz / 4) { b.sleep = true; b.vx = b.vy = b.w = 0; } } else b.still = 0;
    }
    for (const b of live) {
      if (b.at < 0) b.at = f;
      b.track.x[f] = b.x; b.track.y[f] = b.y; b.track.a[f] = b.a;
    }
    if (tMs > pourMs && live.length === bodies.length && live.every((b) => b.sleep)) { settledAt = Math.round(tMs); f++; break; }
  }
  // Settled: every body stays where it lies to the end.
  for (; f < frames; f++) for (const b of live) { b.track.x[f] = b.x; b.track.y[f] = b.y; b.track.a[f] = b.a; }
  return {
    hz, end, fadeAt: holdMs, fadeMs, settledAt, w, h,
    // A body that waited for room is born where it first moved; one that never found room is left out.
    bodies: bodies.filter((b) => b.at >= 0).map((b) => ({
      d: b.d, born: b.at * 1000 / hz,
      x: b.track.x.subarray(b.at), y: b.track.y.subarray(b.at), a: b.track.a.subarray(b.at),
    })),
  };
}

/** A body's centre and turn at `ms` on the flood's clock (held at its birth before it, linear between samples). */
export function floodAt(sim, body, ms) {
  const f = Math.max(0, (ms - body.born) * sim.hz / 1000);
  const n = body.x.length;
  const i = Math.min(n - 1, Math.floor(f)), j = Math.min(n - 1, i + 1), u = Math.min(1, f - i);
  return { x: body.x[i] + (body.x[j] - body.x[i]) * u, y: body.y[i] + (body.y[j] - body.y[i]) * u, a: body.a[i] + (body.a[j] - body.a[i]) * u };
}
