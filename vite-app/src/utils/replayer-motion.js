// ── The replayer's spring moments ──
// One registry per table owns every spring on it: Map<element, { anim, channels, … }>. Anything
// that starts a new spring on an element first asks the registry where that element is and how
// fast it is moving, so an interrupted motion continues instead of restarting from a keyframe
// origin. The moments themselves (the flop deal and spread, the row yielding to a turn or river,
// a wager pushed out, the street's wagers swept in, the pot shipped to the winner) are built here
// and handed to the compositor as Web Animations — nothing runs per frame.
//
// Read, then write. A press is the frame an old phone can least afford, so the moments never measure
// the DOM themselves: the caller (HandReplayerView's moments effect) reads every rect it needs in one
// pass while the layout React just committed is still clean, and hands the numbers in; the moments
// only create elements and start animations. (Measuring per element between appends forced a layout
// per ghost and per card: 11-16 layouts on a press at a 4x CPU throttle.)
//
// Flag: localStorage.replayerSprings — '1' Set A "house" (the default on this branch), '2' or
// 'snappy' Set B, '0' today's code paths unchanged. See utils/spring.js for the springs.

import {
  SPRING_SETS, spring, springOf, timeTo, keyframes, composeAt, toLinear, prefersReducedMotion,
  channelEnd, cubicBezier,
} from './spring.js';

export { springSetFor, rateFor } from './spring.js';
export { prefersReducedMotion };

export const SPRINGS_FLAG_KEY = 'replayerSprings';

export function readSpringsFlag() {
  try { return localStorage.getItem(SPRINGS_FLAG_KEY); } catch (e) { return null; }
}

/* The exporters reach the registry through the table element they already hold. */
export function motionFor(tableEl) {
  return (tableEl && tableEl.__replayerMotion) || null;
}

/* The amount and its pill leave FIRST and fast: an ease-out, so most of the label is gone within the
   first 10px of the flight and no figure sits on top of the stakes pill or a board card. */
const EASE_LABEL_OUT = 'cubic-bezier(0.2, 0, 0.4, 1)';
const PROPS = ['x', 'y', 'rotate', 'scale', 'scaleX', 'scaleY', 'opacity'];

/* A single-channel spring can ride CSS linear() as two keyframes where the engine has it (Chrome
   113+, Safari 17.2+); everywhere else the same curve is sampled into keyframes. Either way the
   element follows the identical spring: the linear() form is just fewer keyframes. A test hook
   (localStorage.replayerSpringsLinear = '0') forces the sampled form so it can be exercised in an
   engine that supports linear(). */
let linearSupport = null;
function supportsLinearEasing() {
  if (linearSupport != null) return linearSupport;
  try {
    if (localStorage.getItem('replayerSpringsLinear') === '0') return (linearSupport = false);
  } catch (e) { /* storage unavailable */ }
  try {
    linearSupport = typeof CSS !== 'undefined' && !!CSS.supports
      && CSS.supports('animation-timing-function', 'linear(0, 1)');
  } catch (e) { linearSupport = false; }
  return linearSupport;
}

/* Whether a Web Animation has a start time on the document timeline yet. */
const startedOf = (a) => { try { return a.startTime != null; } catch (e) { return true; } };

export class MotionRegistry {
  constructor() {
    this.entries = new Map();
    this.ticks = [];
    this.capture = false;
    this.captureRate = 1;
    this.captureFps = 0;
    this.captureNow = 0;
    this.momentKind = null;
    this.pendingPot = 0;
    this.pendingStacks = new Map();
    // Supplied by the component: write the pot / a stack's digits, and one React render when
    // everything pending has landed so React's value matches the DOM again.
    this.writePot = null;
    this.writeStack = null;
    this.onSettled = null;
    this._dirty = false;
  }

  /* ── Running a spring ── */

  /**
   * A moment starts: its clock starts at 0. Under an export the clock is the seek position, and a
   * moment that kept the last one's (the flop's last seek is at 625ms) was born 625ms late: every
   * later spring of the hand sat parked for that long in its first frames, and the turn's and the
   * river's extents ran past their step, so they were never seeked at all.
   */
  beginMoment(kind) {
    this.momentKind = kind;
    this.captureNow = 0;
  }

  /**
   * Start a composed spring animation on `el`, replacing any it has. Returns the entry, or null
   * under reduced motion (the caller skips the motion).
   * @param {Element} el
   * @param {object} spec  { channels, size, prefix, axis, tolPx, end, transient, onDone,
   *                         extras: [{ el, frames, options }] }
   */
  run(el, spec) {
    const { channels, size, prefix = '', axis = null, tolPx = 0.25, end, transient = false, onDone = null, extras = [] } = spec;
    let kf = null;
    // One channel (or one spring shared by x and y): CSS linear() where supported.
    const single = axis == null && linearForm(channels, prefix, end);
    if (single && supportsLinearEasing()) kf = single;
    if (!kf) kf = keyframes(channels, { size, prefix, axis, tolPx, end });
    if (!kf) return null;
    this.stop(el);
    let anim;
    try {
      anim = el.animate(kf.keyframes, {
        duration: kf.duration, delay: kf.delay, easing: 'linear',
        fill: kf.delay > 0 ? 'backwards' : 'none',
      });
    } catch (e) { return null; }
    /* Where the element is visibly at rest (within 0.25px of every channel's rest): the export's
       frame budget is spent up to here, not to the 0.1% settle a linear() easing runs to. */
    const rest = Math.min(kf.end, restOf(channels, size, end));
    // t0: where this spring sits on the moment's clock. Live, every spring of a moment starts with
    // the moment; under an export's seek, a spring born at an arrival (the pot's stacks making room)
    // starts at that arrival.
    const t0 = this.capture ? this.captureNow : 0;
    const entry = {
      el, anim, channels, size, prefix, end: kf.end, rest, t0, transient, onDone,
      extras: [], ticks: [], done: false, started: false, timer: 0,
    };
    for (const x of extras) {
      try { entry.extras.push(x.el.animate(x.frames, x.options)); } catch (e) { /* no WAAPI on it */ }
    }
    anim.onfinish = () => this._done(entry);
    this.entries.set(el, entry);
    if (this.capture) {
      for (const a of [anim, ...entry.extras]) { try { a.pause(); a.currentTime = 0; } catch (e) { /* ignore */ } }
      return entry;
    }
    /* Timers count from the animation's REAL start, not from now. A Web Animation starts on the
       first frame after the task that created it, and on a long press frame (an old phone, a 4x CPU
       throttle) that is 100-500ms later: timed from creation, a ghost was removed mid-flight and the
       pot ticked before its chips arrived. `ready` resolves when the start time is set; from there,
       what is left is end - currentTime. A last-resort timer still removes a transient whose
       animation never starts (a document that never paints), well after any real start. */
    if (transient) entry.timer = setTimeout(() => this._done(entry), kf.end + 2000);
    const onStart = () => {
      if (entry.done || entry.started) return;
      entry.started = true;
      let ct = 0;
      try { ct = Math.max(0, anim.currentTime || 0); } catch (e) { ct = 0; }
      entry.startedAt = nowMs() - ct;
      if (transient) {
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => this._done(entry), Math.max(0, kf.end + 50 - ct));
      }
      for (const t of entry.ticks) this._armTick(t, entry);
    };
    if (anim.ready && typeof anim.ready.then === 'function' && !startedOf(anim)) {
      anim.ready.then(onStart, () => { /* cancelled before it started: stop()/_done handle it */ });
    } else {
      onStart();
    }
    return entry;
  }

  /** Where an element under a spring is NOW and how fast it is moving (px or units per second). */
  state(el) {
    const entry = this.entries.get(el);
    if (!entry || entry.done) return null;
    let t;
    try { t = entry.anim.currentTime; } catch (e) { t = null; }
    if (t == null || t >= entry.end) return null;
    const val = composeAt(entry.channels, t);
    const a = composeAt(entry.channels, t - 0.5), b = composeAt(entry.channels, t + 0.5);
    const vel = {};
    for (const p of PROPS) vel[p] = (b[p] - a[p]) * 1000;
    const target = composeAt(entry.channels, Infinity);
    return { t, val, vel, target, entry };
  }

  /**
   * Channels that carry on every motion an element has, except the props in `exclude`, from where
   * it is to where it was going, with its velocity: a card taken over mid-flop keeps settling its
   * drop, scale and squaring while the new spring moves it sideways.
   */
  continuation(el, exclude = []) {
    const s = this.state(el);
    if (!s) return [];
    const out = [];
    for (const p of PROPS) {
      if (exclude.includes(p)) continue;
      const chs = s.entry.channels.filter(c => c.prop === p);
      if (!chs.length) continue;
      const from = s.val[p], to = s.target[p], v = s.vel[p];
      if (Math.abs(to - from) < 1e-4 && Math.abs(v) < 1e-3) continue;
      const springCh = chs.slice().reverse().find(c => c.spring);
      const rampCh = chs.find(c => c.ramp);
      if (springCh) {
        const ts = springCh.timeScale || 1;
        const vp = Math.abs(to - from) > 1e-4 ? v / (to - from) / ts : 0;
        out.push({ prop: p, spring: spring({ ...springCfg(springCh.spring), velocity: vp }), from, to, delay: 0, timeScale: ts });
      } else if (rampCh) {
        const left = Math.max(1, (rampCh.ramp.delay + rampCh.ramp.duration) - s.t);
        out.push({ prop: p, ramp: { from, to, delay: 0, duration: left } });
      }
    }
    return out;
  }

  stop(el) {
    const entry = this.entries.get(el);
    if (!entry) return;
    this.entries.delete(el);
    entry.done = true;
    clearTimeout(entry.timer);
    for (const a of [entry.anim, ...entry.extras]) { try { a.onfinish = null; a.cancel(); } catch (e) { /* gone */ } }
  }

  _done(entry) {
    if (entry.done) return;
    entry.done = true;
    clearTimeout(entry.timer);
    if (this.entries.get(entry.el) === entry) this.entries.delete(entry.el);
    // The element's own style is the end state, so the animation simply ends; a ghost or a
    // shipped chip leaves the felt.
    for (const a of [entry.anim, ...entry.extras]) { try { a.onfinish = null; a.cancel(); } catch (e) { /* gone */ } }
    if (entry.transient && entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
    // Its arrivals land with it, whatever the timers did.
    for (const t of entry.ticks) this._runTick(t);
    if (entry.onDone) { try { entry.onDone(); } catch (e) { /* never break the replay */ } }
    this._maybeSettle();
  }

  /* ── Arrivals ──
     A tick is something that happens when a flight lands: the pot or a stack takes its chips. It
     belongs to the flight's animation: live, it is timed from that animation's real start (see
     run()), so it can never fire before the chips arrive; under capture, only a seek past its time
     fires it; and finishing the moment early (a step back, an export still) flushes it either way. */
  tick(at, fn, entry) {
    // `at` counts from the flight's own start (live: its animation's real start); `base` is where
    // that start sits on the moment's clock, which is what a seek compares against.
    const base = entry ? entry.t0 : (this.capture ? this.captureNow : 0);
    const t = { at, base, fn, done: false, timer: 0 };
    this.ticks.push(t);
    if (entry) {
      entry.ticks.push(t);
      if (!this.capture && entry.started) this._armTick(t, entry);
    } else if (!this.capture) {
      t.timer = setTimeout(() => this._runTick(t), Math.max(0, at));
    }
    return t;
  }

  _armTick(t, entry) {
    if (t.done) return;
    clearTimeout(t.timer);
    const elapsed = entry.startedAt != null ? nowMs() - entry.startedAt : 0;
    t.timer = setTimeout(() => this._runTick(t), Math.max(0, t.at - elapsed));
  }

  _runTick(t) {
    if (t.done) return;
    t.done = true;
    clearTimeout(t.timer);
    try { t.fn(); } catch (e) { /* a tick must never break the replay */ }
    this.ticks = this.ticks.filter(x => !x.done);
    this._dirty = true;
    this._maybeSettle();
  }

  /* The one React render that puts the component's figures back in step waits until nothing is
     moving at all: re-rendering the whole replayer is the most expensive thing a frame can do, and
     the last arrival is usually mid-moment (a flop is still spreading when its swept chips land). */
  _maybeSettle() {
    if (!this._dirty || this.ticks.length) return;
    for (const e of this.entries.values()) if (!e.done) return;
    this._settle();
  }

  _settle() {
    if (!this._dirty) return;
    this._dirty = false;
    if (this.onSettled) { try { this.onSettled(); } catch (e) { /* unmounted */ } }
  }

  /**
   * Finish every spring now: elements at rest, ghosts and shipped chips gone, ticks landed. Until
   * nothing is left, because an arrival can start springs of its own (the pile's stacks making room
   * for a landed wager): finished in one pass, those stayed paused at their first frame, and an
   * export's still showed a stack doubled at its old place.
   */
  finishAll() {
    for (let pass = 0; pass < 8 && (this.entries.size || this.ticks.length); pass++) {
      for (const entry of [...this.entries.values()]) this._done(entry);
      for (const t of [...this.ticks].sort((a, b) => (a.base + a.at) - (b.base + b.at))) this._runTick(t);
    }
    this.ticks = [];
    this.pendingPot = 0;
    this.pendingStacks.clear();
    this.momentKind = null;
    this.captureNow = 0;
    this._settle();
  }

  /* ── Export ── */
  setCapture(on, { rate = 1, fps = 0 } = {}) {
    this.finishAll();
    this.capture = !!on;
    this.captureRate = rate;
    this.captureFps = on ? fps : 0;
    this.captureNow = 0;
  }

  /** How long the running moment visibly lasts (ms from its start), 0 when nothing is moving. */
  extentMs() {
    let m = 0;
    for (const e of this.entries.values()) m = Math.max(m, e.t0 + e.rest);
    for (const t of this.ticks) m = Math.max(m, t.base + t.at);
    return m;
  }

  /**
   * Under capture: land what has landed by `ms` (in time order, so a spring an arrival starts is
   * born at that arrival), then put every spring of the moment at `ms` from its start.
   */
  seek(ms) {
    for (let guard = 0; guard < 256; guard++) {
      let next = null;
      for (const t of this.ticks) {
        if (t.done || t.base + t.at > ms) continue;
        if (!next || t.base + t.at < next.base + next.at) next = t;
      }
      if (!next) break;
      this.captureNow = next.base + next.at;
      this._runTick(next);
    }
    this.captureNow = ms;
    for (const e of [...this.entries.values()]) {
      // A ghost or a shipped chip whose flight is over leaves the felt, as it does live (it is
      // transparent by then): a frame is not drawn with dead elements in it.
      if (e.transient && ms - e.t0 >= e.end) { this._done(e); continue; }
      for (const a of [e.anim, ...e.extras]) { try { a.pause(); a.currentTime = Math.max(0, ms - e.t0); } catch (err) { /* ignore */ } }
    }
  }

  dispose() {
    // Unmounting: land everything without writing into a table that is going away.
    this.writePot = this.writeStack = this.onSettled = this.setPile = null;
    this.finishAll();
  }
}

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

function springCfg(sp) {
  return { stiffness: sp.stiffness, damping: sp.damping, mass: sp.mass };
}

/* The latest any channel is still visibly moving: from then on within half a pixel of where it rests
   (scale and rotation weighed by the element's size, opacity by 1/125) — the measuring harness's
   "at rest". A 1.5% overshoot on a 19px push is 0.3px: settled, though still a hair from exact. */
function restOf(channels, size = {}, end) {
  const w = Math.max(1, size.w || 1), h = Math.max(1, size.h || 1);
  const weight = {
    x: 1, y: 1, rotate: Math.hypot(w, h) / 2 * Math.PI / 180,
    scale: Math.max(w, h) / 2, scaleX: w / 2, scaleY: h / 2, opacity: 125,
  };
  let m = 0;
  for (const c of channels) {
    if (c.spring && !c.fn) {
      const travel = Math.abs(c.to - c.from) * (weight[c.prop] || 1);
      const d = c.delay || 0;
      if (travel < 0.5 && !c.spring.velocity) { m = Math.max(m, d); continue; }
      m = Math.max(m, d + c.spring.settleMs(Math.max(1e-5, 0.5 / Math.max(travel, 1e-6))) / (c.timeScale || 1));
    } else {
      m = Math.max(m, channelEnd(c, weight[c.prop] || 1, 0.5));
    }
  }
  return end != null ? Math.min(end, m) : m;
}

/* A spring that moves one thing along one line — a single channel, or x and y on one shared spring
   from one shared start — as two keyframes on a CSS linear() easing. Null when the motion has any
   other shape. */
function linearForm(channels, prefix, end) {
  if (!channels.length || channels.length > 2) return null;
  if (!channels.every(c => c.spring && !c.before && (c.prop === 'x' || c.prop === 'y'))) return null;
  const [a, b] = channels;
  if (b && (b.spring !== a.spring || (b.delay || 0) !== (a.delay || 0) || (b.timeScale || 1) !== (a.timeScale || 1))) return null;
  if (end != null) return null;
  const L = toLinear(a.spring, 0.0015);
  if (!L) return null;
  const ts = a.timeScale || 1;
  const at = (k) => {
    const v = { x: 0, y: 0 };
    for (const c of channels) v[c.prop] = k ? c.to : c.from;
    return (prefix ? prefix + ' ' : '') + `translate(${+v.x.toFixed(2)}px, ${+v.y.toFixed(2)}px)`;
  };
  const duration = L.durationMs / ts;
  return {
    keyframes: [{ offset: 0, transform: at(0), easing: L.easing }, { offset: 1, transform: at(1) }],
    delay: a.delay || 0, duration, end: (a.delay || 0) + duration,
  };
}

/* ── Geometry helpers (pure) ───────────────────────────────────────────────────────────────── */

const tierOf = (set, name, velocity = 0) => springOf({ ...SPRING_SETS[set].tiers[name], velocity });
const stageOf = (set) => SPRING_SETS[set].stage;
export const centreOf = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** Liang-Barsky: where the segment a->b is inside rect r, as [uIn, uOut] in [0, 1], or null. */
export function segmentInRect(a, b, r) {
  let u0 = 0, u1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const u = q / p;
    if (p < 0) { if (u > u1) return false; if (u > u0) u0 = u; }
    else { if (u < u0) return false; if (u < u1) u1 = u; }
    return true;
  };
  if (clip(-dx, a.x - r.left) && clip(dx, r.right - a.x) && clip(-dy, a.y - r.top) && clip(dy, r.bottom - a.y)) {
    return u0 <= u1 ? [u0, u1] : null;
  }
  return null;
}

const inflate = (r, dx, dy = dx) => ({ left: r.left - dx, right: r.right + dx, top: r.top - dy, bottom: r.bottom + dy });

/** The union's bounding box of a list of rects (empty ones skipped), or null. */
export function unionRect(rects) {
  let u = null;
  for (const r of rects) {
    if (!r || !(r.right > r.left) || !(r.bottom > r.top)) continue;
    u = u ? { left: Math.min(u.left, r.left), right: Math.max(u.right, r.right), top: Math.min(u.top, r.top), bottom: Math.max(u.bottom, r.bottom) }
      : { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }
  return u;
}

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* ── The moments ───────────────────────────────────────────────────────────────────────────── */

/* Placement: the card (or the flop's stack) is PLACED, not dissolved. It is opaque within two frames
   and enters its drop and scale already moving, at `placeVelocity` progress per second — the ads'
   hit() enters its spring at speed for the same reason: a spring released from rest is at its
   slowest on its first frame, so the card hung there half-transparent with the watermark showing
   through it before its weight arrived. At 5/s about a quarter of the drop is done by the first
   opaque frame, and the overshoot is unchanged (1.58% against 1.5%). */
function placementChannels(set, rate, { t, height, rot }) {
  const st = stageOf(set);
  const hit = tierOf(set, 'hand', st.placeVelocity || 0), inertia = tierOf(set, 'inertia');
  return [
    { prop: 'opacity', ramp: { from: 0, to: 1, delay: t, duration: st.appear / rate } },
    { prop: 'y', spring: hit, from: -st.placeDrop * height, to: 0, delay: t, timeScale: rate },
    { prop: 'scale', spring: hit, from: st.placeScale, to: 1, delay: t, timeScale: rate },
    { prop: 'rotate', spring: inertia, from: rot, to: 0, delay: t, timeScale: rate },
  ];
}

/**
 * The flop, "placed, squared, spread": the cards land as one stack in the first slot with the
 * window card on top (DOM order already paints the last slot over the others), the dealer squares
 * it, it holds a beat, and the window card spreads to its slot with the middle card dragged 40ms
 * behind it. Travel is measured from the real slots, so every table size gets the same choreography.
 *
 * @param {object} p
 * @param {{el:Element, rect:DOMRect}[]} p.cards   in slot order, measured by the caller
 */
export function dealBoard(reg, { set, rate = 1, cards, tPlace = 0, street = 'flop' }) {
  const st = stageOf(set);
  if (!cards.length) return;
  cards.forEach(c => reg.stop(c.el));
  const ch = cards[0].rect.height, cw = cards[0].rect.width;
  const x0 = cards[0].rect.left;
  const dxs = cards.map(c => x0 - c.rect.left);
  const spreadOrder = cards.map((_, i) => i).filter(i => Math.abs(dxs[i]) > 0.5)
    .sort((a, b) => Math.abs(dxs[b]) - Math.abs(dxs[a]));
  // The spread slides on the felt: friction stops it (slide, zeta 0.92), it does not spring back.
  // The placement keeps the hand spring's 1.5% (a card set down has weight).
  const slide = tierOf(set, 'slide');
  const rot = st.rot[street] != null ? st.rot[street] : st.rot.flop;
  cards.forEach((c, i) => {
    const channels = placementChannels(set, rate, { t: tPlace, height: ch, rot });
    const k = spreadOrder.indexOf(i);
    if (k >= 0) {
      channels.push({ prop: 'x', spring: slide, from: dxs[i], to: 0, delay: tPlace + (st.beat + k * st.midLag) / rate, timeScale: rate });
    }
    reg.run(c.el, { channels, size: { w: cw, h: ch }, tolPx: 0.1 });
  });
}

/**
 * The turn or the river, "the row makes room, the card is placed at its end": every card already
 * on the board moves from where it was SEEN to its new slot on the critically damped yield spring
 * (one spring, one start: the row moves as a rigid unit), the new card's x rides the same spring a
 * pitch to the right of the last card, and 30ms later the card is placed — dropped, scaled down,
 * squared — on the hand and inertia springs. A card still moving (a fast turn over a running
 * spread) is taken over from where it is, with its velocity.
 *
 * ONE start for the row. If any card on the board is still moving, the whole row yields at once
 * (no wait for a crossing chip, which flies over it lifted): a row split between cards that moved
 * at once and cards that waited for the chips slid one card over its neighbour and opened a gap
 * beside another (Forward every 100ms, the river: the turn card slid 11px over the flop's last).
 *
 * @param {object} p
 * @param {{el:Element, from:number, rect:DOMRect}[]} p.stayed   from = previous centre + presented shift - new centre
 * @param {{el:Element, rect:DOMRect}[]} p.added                 new cards, in slot order
 * @returns {number} when the row starts to yield (ms)
 */
export function yieldBoard(reg, { set, rate = 1, stayed, added, tYield = 0, street = 'turn' }) {
  const st = stageOf(set);
  const yieldSp = tierOf(set, 'yield');
  // Read every card first: whether any is moving decides the row's one start.
  const read = stayed.map(({ el }) => {
    const s = reg.state(el);
    const cont = s ? reg.continuation(el, ['x']) : [];
    const v = s ? s.vel.x : 0;
    return { s, cont, v, moving: !!s && (Math.abs(v) > 1 || cont.length > 0) };
  });
  const t0 = read.some(r => r.moving) ? 0 : tYield;
  let lastX = null;
  stayed.forEach(({ el, from, rect }, i) => {
    const { cont, v, moving } = read[i];
    if (Math.abs(from) < 0.5 && !moving) { lastX = null; return; }
    // Its velocity as progress per second of the yield spring, bounded: a card passing through
    // its new slot (from near 0, still fast) would otherwise hand over a near-infinite rate.
    const vp = Math.abs(from) > 0.5 ? Math.max(-40, Math.min(40, (-v / from) / rate)) : 0;
    const sp = vp ? spring({ ...SPRING_SETS[set].tiers.yield, velocity: vp }) : yieldSp;
    const xCh = { prop: 'x', spring: sp, from, to: 0, delay: t0, timeScale: rate };
    reg.run(el, { channels: [xCh, ...cont], size: { w: rect.width, h: rect.height }, tolPx: 0.1 });
    lastX = xCh;
  });
  const rot = st.rot[street] != null ? st.rot[street] : 0;
  added.forEach(({ el, rect }, i) => {
    reg.stop(el);
    const tCard = t0 + (st.cardLag + i * st.sweepStagger) / rate;
    const channels = placementChannels(set, rate, { t: tCard, height: rect.height, rot });
    // A pitch right of the last card on every frame: the same channel, so the gap never changes.
    if (lastX) channels.push({ ...lastX });
    reg.run(el, { channels, size: { w: rect.width, h: rect.height }, tolPx: 0.1 });
  });
  return t0;
}

/**
 * A wager pushed out from its seat: the stack translates from 0.55 card widths back toward the
 * seat to its spot on the flick spring. Fully opaque and legible from the press frame — a wager is
 * a fact, not an event — the motion only says where it came from. An add-on (a raise over chips
 * already out) pushes again from 0.3 card widths, starting from wherever the stack is now.
 *
 * @param {object} p
 * @param {{x:number,y:number}} p.dir  unit vector from the wager toward its seat (px space)
 * @param {number} p.pushPx           already shortened for clearance
 * @param {{w:number,h:number}} p.size the wager's box
 */
export function pushOut(reg, { set, rate = 1, el, dir, pushPx, addOn = false, size }) {
  const s = reg.state(el);
  let from = { x: dir.x * pushPx, y: dir.y * pushPx };
  let v = { x: 0, y: 0 };
  if (addOn && s) {
    const p = { x: s.val.x, y: s.val.y };
    const along = p.x * dir.x + p.y * dir.y;
    const extra = Math.max(0, pushPx - along);
    from = { x: p.x + dir.x * extra, y: p.y + dir.y * extra };
    v = { x: s.vel.x, y: s.vel.y };
  }
  const d2 = from.x * from.x + from.y * from.y;
  if (d2 < 0.25) { reg.stop(el); return null; }
  const vp = d2 > 0 ? (-(v.x * from.x + v.y * from.y) / d2) / rate : 0;
  const sp = vp ? spring({ ...SPRING_SETS[set].tiers.flick, velocity: vp }) : tierOf(set, 'flick');
  return reg.run(el, {
    channels: [
      { prop: 'x', spring: sp, from: from.x, to: 0, timeScale: rate },
      { prop: 'y', spring: sp, from: from.y, to: 0, timeScale: rate },
    ],
    size,
    prefix: 'translate(-50%, -50%)',
  });
}

/**
 * Plan the sweep: where each wager's chips start (where they were SEEN, a push-out still running
 * included), where they land, when they leave and arrive, and whether their straight path crosses
 * the board. Pure: everything comes from the caller's measurements and the registry's state, so the
 * board can be staged after the crossing before anything is written.
 *
 * Each ghost lands ON the pile: on the stack of its own top chip's colour as the pile will be once
 * it has landed (the pile is a centred row of one stack per colour, so that position is known
 * without measuring), its chips' bottom on the pile's bottom. Without a pile (chip stacks off, side
 * pots) it lands on the pot's anchor.
 *
 * @param {object} p
 * @param {{seat:number, amount:number, el:Element, geo:object, topColor:string}[]} p.wagers  collect order
 *        geo: { cx, cy, w, h, chip: { dx, dy, w, h } }  client px: the wager's resting centre and box,
 *        its chips' centre relative to it and size
 * @param {object} p.pile  { cx, cy, bottom, pitch, base, stacksFor(amount) => [{color}] } or { cx, cy }
 * @param {object} [p.board]  the rect a crossing chip must clear before the board moves
 */
export function planSweep(reg, { set, rate = 1, wagers, pile, board = null }) {
  const st = stageOf(set);
  const n = wagers.length;
  const stagger = n > 1 ? Math.min(st.sweepStagger, st.sweepCap / (n - 1)) : 0;
  let running = pile.base || 0;
  const startOf = (w) => {
    const g = w.geo;
    const s = reg.state(w.el);
    const ox = s ? s.val.x : 0, oy = s ? s.val.y : 0;
    return { s, ox, oy, start: { x: g.cx + g.chip.dx + ox, y: g.cy + g.chip.dy + oy } };
  };
  /* The dealer collects in action order, except that a wager whose straight path crosses the board
     goes first: the board waits for those to clear it (up to boardWaitMax), so sending them first
     lets the new card land sooner. Judged against the pile's centre; the stack each lands on is a
     pitch or two from it. */
  const crossing = board ? wagers.map(w => {
    const { start } = startOf(w);
    const span = segmentInRect(start, { x: pile.cx, y: pile.cy }, inflate(board, w.geo.chip.w / 2, w.geo.chip.h / 2));
    return !!(span && span[1] > 0 && span[1] < 1);
  }) : wagers.map(() => false);
  const order = wagers.map((_, i) => i).sort((a, b) => (crossing[b] - crossing[a]) || (a - b));
  return order.map((wi, i) => {
    const w = wagers[wi];
    const g = w.geo;
    const { s, ox, oy, start } = startOf(w);
    const vx = s ? s.vel.x : 0, vy = s ? s.vel.y : 0;
    running += w.amount;
    let target = { x: pile.cx, y: pile.cy };
    if (pile.stacksFor && pile.pitch > 0) {
      const stacks = pile.stacksFor(running);
      let idx = stacks.findIndex(x => x.color === w.topColor);
      if (idx < 0) idx = (stacks.length - 1) / 2;
      target = { x: pile.cx + (idx - (stacks.length - 1) / 2) * pile.pitch, y: pile.bottom - g.chip.h / 2 };
    }
    const dX = target.x - start.x, dY = target.y - start.y, travel = Math.hypot(dX, dY);
    const vAlong = travel > 0.5 ? (vx * dX + vy * dY) / travel : 0;
    const vp = travel > 0.5 ? (vAlong / travel) / rate : 0;
    const hand = vp ? spring({ ...SPRING_SETS[set].tiers.hand, velocity: vp }) : tierOf(set, 'hand');
    const d = (i * stagger) / rate;
    const arrive = d + timeTo(hand, 0.98) / rate;
    // A path over the board: the chips are airborne over it (a bigger lift that holds), and the
    // board does not move until they have cleared its far edge.
    let clear = null;
    if (board) {
      const span = segmentInRect(start, target, inflate(board, g.chip.w / 2, g.chip.h / 2));
      if (span && span[1] > 0 && span[1] < 1) clear = d + timeTo(hand, Math.min(0.999, span[1])) / rate;
    }
    return { w, s, start, target, hand, d, arrive, travel, crosses: clear != null, clear, ox, oy };
  });
}

/**
 * The street's wagers swept into the pot, from a plan (planSweep). Each wager that was on the felt
 * becomes a ghost — a copy of the same stack in a wrapper that flies, created in the commit that
 * unmounts the wagers. They leave in the street's action order, 40ms apart (compressed so any number
 * are gone within 160ms). The wager's pill and amount (the copy's face) fade out over the first 40ms
 * on an ease-out, so no figure flies over the board; the chips travel straight to their stack on the
 * hand spring, lifted mid-flight (more, and held longer, over the board); and at arrival (progress
 * 0.98) the pot takes that wager and the ghost touches down on the pile, squashing once as it fades.
 *
 * @param {object} p
 * @param {Element} p.layer                         the motion layer (the table's padding box)
 * @param {object[]} p.plan                         from planSweep
 * @param {(amount:number, last:boolean) => void} p.onArrive
 * @returns {number} how long the sweep lasts (ms)
 */
export function sweepWagers(reg, { set, rate = 1, layer, plan, onArrive }) {
  const st = stageOf(set);
  const n = plan.length;
  if (!n) return 0;
  const flick = tierOf(set, 'flick');
  const fade = st.arrivalFade / rate;
  let last = 0;
  plan.forEach((p, i) => {
    const { w, s, start, target, hand, d, arrive } = p;
    const g = w.geo;
    if (s) reg.stop(w.el);
    // The ghost: a wrapper at the wager's own left/top, sized by a copy of the wager (its face).
    const ghost = document.createElement('div');
    ghost.className = 'replayer-chip-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.left = w.el.style.left;
    ghost.style.top = w.el.style.top;
    // Scale about the chips, not the wrapper: the lift and the squash happen to the stack itself.
    const ocx = (g.w / 2 + g.chip.dx) / g.w * 100, ocy = (g.h / 2 + g.chip.dy) / g.h * 100;
    ghost.style.transformOrigin = ocx.toFixed(2) + '% ' + ocy.toFixed(2) + '%';
    const face = w.el.cloneNode(true);
    face.classList.add('replayer-chip-ghost-face');
    face.classList.remove('animate-chips');
    face.removeAttribute('data-seat');
    face.style.left = face.style.top = '';
    const chipsEl = face.querySelector('.chip-stack-visual');
    const chips = chipsEl ? chipsEl.cloneNode(true) : null;
    ghost.appendChild(face);
    if (chips) {
      chips.classList.add('replayer-chip-ghost-chips');
      chips.style.left = ((g.w / 2 + g.chip.dx - g.chip.w / 2) / g.w * 100).toFixed(3) + '%';
      chips.style.top = ((g.h / 2 + g.chip.dy - g.chip.h / 2) / g.h * 100).toFixed(3) + '%';
      ghost.appendChild(chips);
    }
    ghost.style.transform = 'translate(-50%, -50%)';
    layer.appendChild(ghost);
    const tx = target.x - start.x + p.ox, ty = target.y - start.y + p.oy;
    const lift = p.crosses ? st.crossLift : st.sweepLift;
    // Over the board the lift holds (a flat top: 1 - (2p - 1)^4) and comes down only for the last
    // stretch onto the pile; elsewhere a plain arc.
    const liftOf = p.crosses ? (q) => 1 - Math.pow(2 * q - 1, 4) : (q) => 4 * q * (1 - q);
    const channels = [
      { prop: 'x', spring: hand, from: p.ox, to: tx, delay: d, timeScale: rate },
      { prop: 'y', spring: hand, from: p.oy, to: ty, delay: d, timeScale: rate },
      { prop: 'scale', fn: (t) => { const q = t <= d ? 0 : t === Infinity ? 1 : hand.at((t - d) * rate); return 1 + lift * liftOf(Math.min(1, Math.max(0, q))); }, end: arrive + fade },
      { prop: 'scaleX', spring: flick, from: st.squash[0], to: 1, before: 1, delay: arrive, timeScale: rate },
      { prop: 'scaleY', spring: flick, from: st.squash[1], to: 1, before: 1, delay: arrive, timeScale: rate },
      { prop: 'opacity', ramp: { from: 1, to: 0, delay: arrive, duration: fade } },
    ];
    // Own style is the end state: invisible. fill: backwards holds the first keyframe until it leaves.
    ghost.style.opacity = '0';
    face.style.opacity = '0';
    const entry = reg.run(ghost, {
      channels, size: { w: g.chip.w, h: g.chip.h }, prefix: 'translate(-50%, -50%)', end: arrive + fade, transient: true,
      extras: [{
        el: face,
        frames: [{ opacity: 1, easing: EASE_LABEL_OUT }, { opacity: 0 }],
        options: { duration: st.labelFade / rate, delay: d, fill: 'backwards' },
      }],
    });
    if (!entry) { ghost.remove(); onArrive(w.amount, i === n - 1); return; }
    reg.tick(arrive, () => onArrive(w.amount, i === n - 1), entry);
    last = Math.max(last, arrive + fade);
  });
  return last;
}

/**
 * Where a shipped chip lands on a winner's plaque. Owner, 2026-10-12: the chips never cross the
 * winner's name, they land on the edge of the name plaque nearest the table's centre, and the
 * stack takes them there.
 *
 * Aimed at the plaque's centre (as before), a chip met the hole cards first wherever they hang
 * between the pot and the plaque, and vanished into them 10-80px short of it: the hero, the usual
 * winner, every time. So the landing is chosen on the plaque itself. Of the plaque's edges that face
 * the chips' origin, every point a chip can touch without touching a hole card or the dealer button
 * (and come to rest without touching the name) is a candidate; the one nearest the origin wins,
 * unless the straight path to it runs under the cards, the button or the hand's name, which costs
 * it heavily, or it would arrive at a grazing angle. Deterministic: the same table, the same point.
 *
 * @param {{x:number,y:number}} origin             where the chips leave from (the pile)
 * @param {{left,top,right,bottom}} plaque
 * @param {object} o
 * @param {object[]} [o.cards]    each hole card's box
 * @param {object|null} [o.button]   the dealer button's box
 * @param {object[]} [o.covers]   what hides a chip on its way (the flight's clip holes)
 * @param {object|null} [o.name]  the winner's name text
 * @param {number} o.chipD
 * @returns {{x:number, y:number, contact:{x:number,y:number}, edge:string}}  x, y: the chip's
 *          resting centre, half a chip inside the edge (under the plaque); contact: where it
 *          first touches the edge
 */
export function seatLanding(origin, plaque, { cards = [], button = null, covers = [], name = null, chipD = 12 } = {}) {
  const P = plaque, r = chipD / 2, m = 1;
  const edges = [];
  if (origin.y < P.top) edges.push({ edge: 'top', n: { x: 0, y: -1 }, a: { x: P.left, y: P.top }, b: { x: P.right, y: P.top } });
  if (origin.y > P.bottom) edges.push({ edge: 'bottom', n: { x: 0, y: 1 }, a: { x: P.left, y: P.bottom }, b: { x: P.right, y: P.bottom } });
  if (origin.x < P.left) edges.push({ edge: 'left', n: { x: -1, y: 0 }, a: { x: P.left, y: P.top }, b: { x: P.left, y: P.bottom } });
  if (origin.x > P.right) edges.push({ edge: 'right', n: { x: 1, y: 0 }, a: { x: P.right, y: P.top }, b: { x: P.right, y: P.bottom } });
  const diskHits = (c, rad, box) => box && c.x + rad > box.left && c.x - rad < box.right && c.y + rad > box.top && c.y - rad < box.bottom;
  const blockers = [...cards, button].filter(Boolean);
  const hidden = [...covers, P].filter(Boolean);
  let best = null;
  for (const e of edges) {
    const L = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
    const ux = (e.b.x - e.a.x) / (L || 1), uy = (e.b.y - e.a.y) / (L || 1);
    // Every half pixel along the edge, a chip's radius in from each corner, both ends included.
    const span = L - 2 * r, steps = Math.max(0, Math.ceil(span / 0.5));
    for (let k = 0; k <= steps; k++) {
      const s = r + (steps ? span * k / steps : 0);
      const E = { x: e.a.x + ux * s, y: e.a.y + uy * s };
      const T = { x: E.x - e.n.x * r, y: E.y - e.n.y * r };
      const ox = origin.x - E.x, oy = origin.y - E.y, dist = Math.hypot(ox, oy) || 1;
      const cos = (e.n.x * ox + e.n.y * oy) / dist;
      let cost = dist;
      if (cos < 0.3) cost += 1e5;                                     // a grazing arrival
      if (blockers.some(bx => diskHits(E, r + m, bx))) cost += 1e5;   // touches a card or the button
      if (name && diskHits(T, r + m, name)) cost += 1e6;              // the name, never
      // Under what hides it on the way, px of path: heavily, the chip would vanish short of the edge.
      const out = { x: E.x + e.n.x * (r + m), y: E.y + e.n.y * (r + m) };
      let under = 0;
      for (const h of hidden) {
        const span = segmentInRect(origin, out, inflate(h, r));
        if (span) under += (span[1] - span[0]) * Math.hypot(out.x - origin.x, out.y - origin.y);
      }
      cost += under * 8;
      if (!best || cost < best.cost) best = { cost, E, T, edge: e.edge };
    }
  }
  if (!best) {
    const c = { x: (P.left + P.right) / 2, y: (P.top + P.bottom) / 2 };
    return { x: c.x, y: c.y, contact: c, edge: 'centre' };
  }
  return { x: best.T.x, y: best.T.y, contact: best.E, edge: best.edge };
}

/* The flight layer for the ship: nested boxes over the table, each with one evenodd clip (the felt
   minus a set of non-overlapping holes: the plaques and the hands' names, then the hole cards, then
   the dealer button), so what flies inside is hidden wherever any of them is. */
function shipClip(layer, L, holes) {
  const pct = (v, o, s) => ((v - o) / s * 100).toFixed(3) + '%';
  const poly = (rects) => {
    const pts = ['0% 0%', '100% 0%', '100% 100%', '0% 100%', '0% 0%'];
    for (const r of rects) {
      const x1 = pct(r.left, L.left, L.width), x2 = pct(r.right, L.left, L.width);
      const y1 = pct(r.top, L.top, L.height), y2 = pct(r.bottom, L.top, L.height);
      pts.push(`${x1} ${y1}`, `${x2} ${y1}`, `${x2} ${y2}`, `${x1} ${y2}`, `${x1} ${y1}`, '0% 0%');
    }
    return 'polygon(evenodd, ' + pts.join(', ') + ')';
  };
  let parent = layer, outer = null;
  for (const set of holes) {
    if (!set || !set.length) continue;
    const box = document.createElement('div');
    box.className = 'replayer-ship-clip';
    box.style.clipPath = poly(set);
    box.style.webkitClipPath = box.style.clipPath;
    parent.appendChild(box);
    if (!outer) outer = box;
    parent = box;
  }
  if (!outer) {
    outer = document.createElement('div');
    outer.className = 'replayer-ship-clip';
    layer.appendChild(outer);
    parent = outer;
  }
  return { outer, inner: parent };
}

/**
 * When the pot leaves for the winner (ms from the result press): at once, or, when the river's
 * wagers are swept in first, once the last of them has landed on the pile and faded. The same
 * number in render (the plaque's gold is timed from it) and in the moment.
 */
export function shipStartAfterSweep(set, rate = 1, nWagers = 0) {
  if (!nWagers) return 0;
  const st = stageOf(set);
  const stagger = nWagers > 1 ? Math.min(st.sweepStagger, st.sweepCap / (nWagers - 1)) : 0;
  const lastArrive = ((nWagers - 1) * stagger + timeTo(tierOf(set, 'hand'), 0.98)) / rate;
  return lastArrive + (st.arrivalFade + (st.shipAfterSweep || 0)) / rate;
}

/**
 * The pot shipped to the winner on the arm spring: five gold chips per winner (ten at most in all,
 * split pots in parallel), a handful rather than a file. Each leaves from one of the pile's stacks,
 * 22ms apart, on its own weight (arm, with the mass varied between 1.45, 1.6 and 1.75 on the same
 * stiffness and damping ratio), bowing a little to alternate sides, lifted over the board and set
 * down a little smaller, stretched along its path while it is fast (in place of the motion blur the
 * ads have), fully opaque for the whole flight. It comes out from under the pile as its stack
 * leaves (the pile empties, onDepart), lands on the plaque's edge nearest the pile (seatLanding) and
 * tucks under it, and at its arrival the stack takes a fifth of the award.
 *
 * It flies in the sweep's layer: over the board and the seats, under the pot's figure, the wagers
 * and the button, so it never covers a figure on its way.
 *
 * @param {object} p
 * @param {DOMRect} p.layerRect
 * @param {{x:number,y:number}} p.origin          the pile's centre, client px
 * @param {number[]} [p.starts]                   x offsets of the pile's stacks from its centre
 * @param {{seat:number, x:number, y:number}[]} p.dests   landings (seatLanding), client px
 * @param {object[][]} p.holes                    clip levels, each a list of non-overlapping boxes
 * @param {number} p.chipD                        the flying chip's diameter
 * @param {number} p.cardW                        a board card's width (the bow is a share of it)
 * @param {number} [p.tStart]                     when the first chip leaves (ms, already at rate)
 * @param {(seat:number, k:number, n:number) => void} p.onArrive   the k-th arrival of n at that seat
 * @param {() => void} [p.onDepart]               the pot leaves the pile (at tStart)
 * @returns {{ end:number, firstArrive:number, lastArrive:Map<number, number> }}
 */
export function shipPot(reg, { set, rate = 1, layer, layerRect, origin, starts = [0], dests, holes, chipD, cardW, tStart = 0, onArrive, onDepart = null }) {
  const st = stageOf(set);
  const out = { end: 0, firstArrive: Infinity, lastArrive: new Map() };
  if (!dests.length) return out;
  const per = Math.max(1, Math.min(5, Math.floor(10 / dests.length)));
  const L = layerRect;
  const fade = st.arrivalFade / rate;
  const appear = st.appear / rate;
  const clip = shipClip(layer, L, holes);
  // Under an export the frames are 42ms (video) or 80ms (GIF) apart, not 17: the stretch is sized to
  // the distance a chip covers between two of them (a 180-degree shutter, at most three diameters),
  // or five dots strobe across the table instead of a handful of chips in flight.
  const fps = reg.capture && reg.captureFps > 0 ? reg.captureFps : 0;
  let alive = 0;
  const onDone = () => { if (--alive <= 0 && clip.outer.parentNode) clip.outer.parentNode.removeChild(clip.outer); };
  const landed = new Map();
  let k = 0, firstEntry = null;
  for (const dest of dests) {
    for (let i = 0; i < per; i++) {
      const sx = starts[i % starts.length] || 0;
      const chip = document.createElement('div');
      chip.className = 'replayer-flying-chip to-winner is-spring';
      chip.setAttribute('aria-hidden', 'true');
      chip.dataset.fly = String(k++);   // a stable name for a measuring harness; they leave one by one
      chip.style.left = ((origin.x - L.left) / L.width * 100).toFixed(4) + '%';
      chip.style.top = ((origin.y - L.top) / L.height * 100).toFixed(4) + '%';
      chip.style.transform = 'translate(-50%, -50%)';
      clip.inner.appendChild(chip);
      const dx = dest.x - origin.x, dy = dest.y - origin.y;
      const cx = dx - sx, len = Math.hypot(cx, dy) || 1;
      const arm = tierOf(set, st.shipTiers[i % st.shipTiers.length]);
      const d = tStart + (i * st.shipStagger) / rate;
      const arrive = d + timeTo(arm, 0.98) / rate;
      const lift = st.shipLift, shrink = st.shipShrink;
      const bow = st.shipBows[i % st.shipBows.length] * st.shipBow * cardW;
      const nx = -dy / len, ny = cx / len;
      const prog = (t) => (t <= d ? 0 : t === Infinity ? 1 : arm.at((t - d) * rate));
      // The handful fans out as it leaves and closes up on the way in: the bow peaks a third of the
      // way (27q(1-q)^2/4) and is under a pixel by the time a chip passes the winner's cards, so the
      // path seatLanding cleared is the path flown.
      const arc = (t) => { const q = prog(t); return bow * 6.75 * q * (1 - q) * (1 - q); };
      // Live, in diameters per 60fps frame: 1 below about 0.6 (the chip reads as itself), up to
      // 1 + stretchMax along the path at about two diameters a frame (the peak is ~3.7).
      const stretch = (t) => {
        if (t <= d || t === Infinity) return 1;
        const v = Math.abs(len * arm.velocityAt((t - d) * rate) * rate);
        if (fps) return 1 + Math.min(2, 0.5 * (v / fps) / chipD);
        return 1 + st.stretchMax * smoothstep(0.6, 2, v / (60 * chipD));
      };
      const channels = [
        { prop: 'x', spring: arm, from: sx, to: dx, delay: d, timeScale: rate },
        { prop: 'y', spring: arm, from: 0, to: dy, delay: d, timeScale: rate },
        { prop: 'x', fn: (t) => nx * arc(t), end: arrive },
        { prop: 'y', fn: (t) => ny * arc(t), end: arrive },
        { prop: 'scale', fn: (t) => { const q = prog(t); return (1 + lift * 4 * q * (1 - q)) * (1 + (shrink - 1) * q); }, end: arrive + fade },
        { prop: 'stretch', fn: stretch, end: arrive },
        // Out from under its stack as the stack leaves; gone into the plaque after it lands.
        { prop: 'opacity', ramp: { from: 0, to: 1, delay: d, duration: appear } },
        { prop: 'opacity', ramp: { from: 1, to: 0, delay: arrive, duration: fade } },
      ];
      chip.style.opacity = '0';
      alive++;
      const entry = reg.run(chip, {
        channels, size: { w: chipD, h: chipD }, prefix: 'translate(-50%, -50%)',
        axis: Math.atan2(dy, cx) * 180 / Math.PI, end: arrive + fade, transient: true, onDone,
      });
      out.firstArrive = Math.min(out.firstArrive, arrive);
      out.lastArrive.set(dest.seat, Math.max(out.lastArrive.get(dest.seat) || 0, arrive));
      out.end = Math.max(out.end, arrive + fade);
      if (!entry) { chip.remove(); onDone(); onArrive(dest.seat, i, per); continue; }
      if (!firstEntry) firstEntry = entry;
      reg.tick(arrive, () => {
        const nth = (landed.get(dest.seat) || 0) + 1;
        landed.set(dest.seat, nth);
        onArrive(dest.seat, nth - 1, per);
      }, entry);
    }
  }
  if (onDepart) {
    // On the first chip's own clock (its animation starts with the moment), so a long press frame
    // cannot empty the pile before the chips are under it.
    if (firstEntry) reg.tick(tStart, onDepart, firstEntry); else onDepart();
  }
  if (!alive && clip.outer.parentNode) clip.outer.parentNode.removeChild(clip.outer);
  return out;
}

/** When the first shipped chip lands (ms from the result press): the winner's plaque takes its gold. */
export function shipFirstArrival(set, rate = 1) {
  const st = stageOf(set);
  return timeTo(tierOf(set, st.shipTiers[0]), 0.98) / rate;
}

/**
 * The pot's stacks making room when chips land on them: a stack that is still there moves from its
 * old place in the centred row to its new one on the critically damped yield spring (no bounce: it
 * is pushed aside). New stacks appear under the ghost that brought them.
 */
export function shiftPile(reg, { set, rate = 1, moves }) {
  const sp = tierOf(set, 'yield');
  for (const { el, dx, size } of moves) {
    if (Math.abs(dx) < 0.25) continue;
    const s = reg.state(el);
    const from = dx + (s ? s.val.x : 0);
    reg.run(el, { channels: [{ prop: 'x', spring: sp, from, to: 0, timeScale: rate }], size, tolPx: 0.1 });
  }
}

/**
 * The pile empties as the pot leaves it: each stack fades out (linear, over the arrival fade) as
 * the first shipped chip leaves from under it, the chips coming out where the stacks were. The
 * pile is drawn shipped from then on (its own style is the end state); a stack still making room
 * keeps moving while it fades.
 * @param {{el:Element, size:{w:number,h:number}}[]} p.stacks   left to right
 */
export function emptyPile(reg, { set, rate = 1, stacks }) {
  const st = stageOf(set);
  stacks.forEach(({ el, size }, j) => {
    const cont = reg.continuation(el, ['opacity']);
    reg.run(el, {
      channels: [{ prop: 'opacity', ramp: { from: 1, to: 0, delay: (j * st.shipStagger) / rate, duration: st.arrivalFade / rate } }, ...cont],
      size, tolPx: 0.1,
    });
  });
}

/**
 * Something appearing at a moment's beat, linear 0 to 1 over 70ms (opacity is never a spring): the
 * won pill in front of the winner as the last of the pot lands on the plaque.
 */
export function appearAt(reg, { rate = 1, el, at, size, prefix = '' }) {
  return reg.run(el, { channels: [{ prop: 'opacity', ramp: { from: 0, to: 1, delay: at, duration: 70 / rate } }], size, prefix });
}

/**
 * How far a wager can be pushed back toward its seat without its start box touching that seat's
 * hole cards or action badge: the full distance where it is clear, shorter where it is not.
 * @param {DOMRect} box        the wager's box at rest
 * @param {{x:number,y:number}} dir
 * @param {number} pushPx
 * @param {DOMRect[]} obstacles
 */
export function clearPush(box, dir, pushPx, obstacles, margin = 1) {
  const hits = (k) => obstacles.some(o => {
    const dx = dir.x * pushPx * k, dy = dir.y * pushPx * k;
    return box.left + dx < o.right + margin && box.right + dx > o.left - margin
      && box.top + dy < o.bottom + margin && box.bottom + dy > o.top - margin;
  });
  for (let k = 1; k > 0.001; k -= 0.1) if (!hits(k)) return pushPx * k;
  return 0;
}

export { cubicBezier };
