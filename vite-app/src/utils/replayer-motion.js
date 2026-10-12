// ── The replayer's spring moments ──
// One registry per table owns every spring on it: Map<element, { anim, channels, … }>. Anything
// that starts a new spring on an element first asks the registry where that element is and how
// fast it is moving, so an interrupted motion continues instead of restarting from a keyframe
// origin. The moments themselves (the flop deal and spread, the row yielding to a turn or river,
// a wager pushed out, the street's wagers swept in, the pot shipped to the winner) are built here
// from measured geometry and handed to the compositor as Web Animations — nothing runs per frame.
//
// Flag: localStorage.replayerSprings — '1' Set A "house" (the default on this branch), '2' or
// 'snappy' Set B, '0' today's code paths unchanged. See utils/spring.js for the springs.

import {
  SPRING_SETS, spring, timeTo, keyframes, composeAt, toLinear, prefersReducedMotion, channelEnd,
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

const EASE_LEAVE = 'cubic-bezier(0.55, 0, 0.85, 0.35)';
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

export class MotionRegistry {
  constructor() {
    this.entries = new Map();
    this.ticks = [];
    this.capture = false;
    this.captureRate = 1;
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
   * Start a composed spring animation on `el`, replacing any it has. Returns the entry, or null
   * under reduced motion (the caller skips the motion).
   * @param {Element} el
   * @param {object} spec  { channels, size, prefix, end, transient, extras: [{ el, frames, options }] }
   */
  run(el, spec) {
    const { channels, size, prefix = '', end, transient = false, extras = [] } = spec;
    let kf = null;
    // One channel (or one spring shared by x and y): CSS linear() where supported.
    const single = linearForm(channels, prefix, end);
    if (single && supportsLinearEasing()) kf = single;
    if (!kf) kf = keyframes(channels, { size, prefix, end });
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
    const entry = { el, anim, channels, size, prefix, end: kf.end, rest, transient, extras: [], ticks: [], done: false };
    for (const x of extras) {
      try { entry.extras.push(x.el.animate(x.frames, x.options)); } catch (e) { /* no WAAPI on it */ }
    }
    if (this.capture) {
      for (const a of [anim, ...entry.extras]) { try { a.pause(); a.currentTime = 0; } catch (e) { /* ignore */ } }
    } else if (transient) {
      // Removal is not left to the finish event alone: a hidden tab or a paused document never
      // fires it, and a ghost must not outlive its moment.
      entry.timer = setTimeout(() => this._done(entry), kf.end + 50);
    }
    anim.onfinish = () => this._done(entry);
    this.entries.set(el, entry);
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
    const target = composeAt(entry.channels, entry.end + 1e4);
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
  }

  /* ── Arrivals ──
     A tick is something that happens when a flight lands: the pot or a stack takes its chips.
     Live, a timer fires it at its arrival time; under capture, only a seek past that time does;
     and finishing the moment early (a step back, an export still) flushes it either way. */
  tick(at, fn, entry) {
    const t = { at, fn, done: false };
    this.ticks.push(t);
    if (entry) entry.ticks.push(t);
    if (!this.capture) t.timer = setTimeout(() => this._runTick(t), Math.max(0, at));
    return t;
  }

  _runTick(t) {
    if (t.done) return;
    t.done = true;
    clearTimeout(t.timer);
    try { t.fn(); } catch (e) { /* a tick must never break the replay */ }
    this.ticks = this.ticks.filter(x => !x.done);
    this._dirty = true;
    if (!this.ticks.length) this._settle();
  }

  _settle() {
    if (!this._dirty) return;
    this._dirty = false;
    if (this.onSettled) { try { this.onSettled(); } catch (e) { /* unmounted */ } }
  }

  /** Finish every spring now: elements at rest, ghosts and shipped chips gone, ticks landed. */
  finishAll() {
    for (const entry of [...this.entries.values()]) this._done(entry);
    for (const t of [...this.ticks].sort((a, b) => a.at - b.at)) this._runTick(t);
    this.ticks = [];
    this.pendingPot = 0;
    this.pendingStacks.clear();
    this._settle();
  }

  /* ── Export ── */
  setCapture(on, { rate = 1 } = {}) {
    this.finishAll();
    this.capture = !!on;
    this.captureRate = rate;
  }

  /** How long the running moment visibly lasts (ms from its start), 0 when nothing is moving. */
  extentMs() {
    let m = 0;
    for (const e of this.entries.values()) m = Math.max(m, e.rest);
    for (const t of this.ticks) m = Math.max(m, t.at);
    return m;
  }

  /** Under capture: put every spring of the moment at `ms` from its start and land what has landed. */
  seek(ms) {
    for (const e of [...this.entries.values()]) {
      for (const a of [e.anim, ...e.extras]) { try { a.pause(); a.currentTime = ms; } catch (err) { /* ignore */ } }
    }
    for (const t of [...this.ticks].sort((a, b) => a.at - b.at)) if (t.at <= ms) this._runTick(t);
  }

  dispose() {
    this.finishAll();
    this.writePot = this.writeStack = this.onSettled = null;
  }
}

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

/* ── The moments ───────────────────────────────────────────────────────────────────────────── */

const tierOf = (set, name, velocity = 0) => spring({ ...SPRING_SETS[set].tiers[name], velocity });
const stageOf = (set) => SPRING_SETS[set].stage;
const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/**
 * The flop, "placed, squared, spread": the cards land as one stack in the first slot with the
 * window card on top (DOM order already paints the last slot over the others), the dealer squares
 * it, it holds a beat, and the window card spreads to its slot with the middle card dragged 40ms
 * behind it. Travel is measured from the real slots, so every table size gets the same choreography.
 */
export function dealBoard(reg, { set, rate = 1, cards, tPlace = 0, street = 'flop' }) {
  const st = stageOf(set);
  if (!cards.length) return;
  cards.forEach(el => reg.stop(el));
  const rects = cards.map(el => el.getBoundingClientRect());
  const ch = rects[0].height, cw = rects[0].width;
  const x0 = rects[0].left;
  const dxs = rects.map(r => x0 - r.left);
  const spreadOrder = cards.map((_, i) => i).filter(i => Math.abs(dxs[i]) > 0.5)
    .sort((a, b) => Math.abs(dxs[b]) - Math.abs(dxs[a]));
  const hand = tierOf(set, 'hand'), inertia = tierOf(set, 'inertia');
  const rot = st.rot[street] != null ? st.rot[street] : st.rot.flop;
  cards.forEach((el, i) => {
    const channels = [
      { prop: 'opacity', ramp: { from: 0, to: 1, delay: tPlace, duration: st.appear / rate } },
      { prop: 'y', spring: hand, from: -st.placeDrop * ch, to: 0, delay: tPlace, timeScale: rate },
      { prop: 'scale', spring: hand, from: st.placeScale, to: 1, delay: tPlace, timeScale: rate },
      { prop: 'rotate', spring: inertia, from: rot, to: 0, delay: tPlace, timeScale: rate },
    ];
    const k = spreadOrder.indexOf(i);
    if (k >= 0) {
      channels.push({ prop: 'x', spring: hand, from: dxs[i], to: 0, delay: tPlace + (st.beat + k * st.midLag) / rate, timeScale: rate });
    }
    reg.run(el, { channels, size: { w: cw, h: ch } });
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
 * @param {object} p
 * @param {{el:Element, from:number}[]} p.stayed   from = previous centre + presented shift - new centre
 * @param {Element[]} p.added                     new cards, in slot order
 */
export function yieldBoard(reg, { set, rate = 1, stayed, added, tYield = 0, street = 'turn' }) {
  const st = stageOf(set);
  const yieldSp = tierOf(set, 'yield');
  let lastX = null;
  for (const { el, from } of stayed) {
    const s = reg.state(el);
    const cont = s ? reg.continuation(el, ['x']) : [];
    const v = s ? s.vel.x : 0;
    const moving = !!s && (Math.abs(v) > 1 || cont.length > 0);
    if (Math.abs(from) < 0.5 && !moving) { lastX = null; continue; }
    const vp = Math.abs(from) > 0.01 ? (-v / from) / rate : 0;
    const sp = moving && vp ? spring({ ...SPRING_SETS[set].tiers.yield, velocity: vp }) : yieldSp;
    const xCh = { prop: 'x', spring: sp, from, to: 0, delay: moving ? 0 : tYield, timeScale: rate };
    const r = el.getBoundingClientRect();
    reg.run(el, { channels: [xCh, ...cont], size: { w: r.width, h: r.height } });
    lastX = xCh;
  }
  const hand = tierOf(set, 'hand'), inertia = tierOf(set, 'inertia');
  const rot = st.rot[street] != null ? st.rot[street] : 0;
  added.forEach((el, i) => {
    reg.stop(el);
    const r = el.getBoundingClientRect();
    const tCard = tYield + (st.cardLag + i * st.sweepStagger) / rate;
    const channels = [
      { prop: 'opacity', ramp: { from: 0, to: 1, delay: tCard, duration: st.appear / rate } },
      { prop: 'y', spring: hand, from: -st.placeDrop * r.height, to: 0, delay: tCard, timeScale: rate },
      { prop: 'scale', spring: hand, from: st.placeScale, to: 1, delay: tCard, timeScale: rate },
      { prop: 'rotate', spring: inertia, from: rot, to: 0, delay: tCard, timeScale: rate },
    ];
    // A pitch right of the last card on every frame: the same channel, so the gap never changes.
    if (lastX) channels.push({ ...lastX });
    reg.run(el, { channels, size: { w: r.width, h: r.height } });
  });
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
 */
export function pushOut(reg, { set, rate = 1, el, dir, pushPx, addOn = false }) {
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
  const sp = tierOf(set, 'flick', vp);
  const r = el.getBoundingClientRect();
  return reg.run(el, {
    channels: [
      { prop: 'x', spring: sp, from: from.x, to: 0, timeScale: rate },
      { prop: 'y', spring: sp, from: from.y, to: 0, timeScale: rate },
    ],
    size: { w: r.width, h: r.height },
    prefix: 'translate(-50%, -50%)',
  });
}

/**
 * The street's wagers swept into the pot. Each wager that was on the felt becomes a ghost — a copy
 * of the same stack, starting where it was SEEN — created in the commit that unmounts the wagers.
 * They leave in the street's action order, 40ms apart (compressed so any number are gone within
 * 160ms); the amount fades as the chips depart so no text flies over the board; the chips travel
 * straight to the pot on the hand spring, lifted a little mid-flight so they pass over the board;
 * and at arrival (progress 0.98) the pot takes that wager and the ghost touches down, squashing
 * once as it fades out.
 *
 * @param {object} p
 * @param {Element} p.layer                         the motion layer (the table's padding box)
 * @param {{el:Element, amount:number, seat:number}[]} p.wagers   the wagers' elements from the previous commit, in collect order
 * @param {{x:number,y:number}} p.target            the pot chips' centre, client px
 * @param {(amount:number) => void} p.onArrive
 * @returns {number} how long the sweep lasts (ms)
 */
export function sweepWagers(reg, { set, rate = 1, layer, wagers, target, onArrive }) {
  const st = stageOf(set);
  const n = wagers.length;
  if (!n) return 0;
  const stagger = n > 1 ? Math.min(st.sweepStagger, st.sweepCap / (n - 1)) : 0;
  let last = 0;
  wagers.forEach((w, i) => {
    const g = w.el.cloneNode(true);
    g.classList.add('replayer-chip-ghost');
    g.classList.remove('animate-chips');
    g.removeAttribute('data-seat');
    g.setAttribute('aria-hidden', 'true');
    // Everything but the chips is the label that fades as they leave.
    const label = document.createElement('span');
    label.className = 'replayer-chip-ghost-label';
    [...g.childNodes].forEach(nd => {
      if (!(nd.nodeType === 1 && nd.classList.contains('chip-stack-visual'))) label.appendChild(nd);
    });
    g.appendChild(label);
    g.style.transform = 'translate(-50%, -50%)';
    layer.appendChild(g);
    /* The wager's dark pill is the label's ground, not part of the chips: it moves onto a child
       that fades with the amount, so what flies to the pot is the stack alone. Copied from the
       ghost's own computed style, so every theme's pill comes along exactly. */
    const cs = getComputedStyle(g);
    const pill = document.createElement('span');
    pill.className = 'replayer-chip-ghost-pill';
    pill.style.inset = '-' + cs.borderTopWidth;
    pill.style.border = `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`;
    pill.style.borderRadius = cs.borderTopLeftRadius;
    pill.style.backgroundColor = cs.backgroundColor;
    pill.style.backgroundImage = cs.backgroundImage;
    pill.style.boxShadow = cs.boxShadow;
    g.insertBefore(pill, g.firstChild);
    g.style.background = 'none';
    g.style.borderColor = 'transparent';
    g.style.boxShadow = 'none';
    const r = g.getBoundingClientRect();
    const c = centre(r);
    // Where it was seen: a push-out still running hands over its offset and its velocity.
    const s = reg.state(w.el);
    const ox = s ? s.val.x : 0, oy = s ? s.val.y : 0;
    const vx = s ? s.vel.x : 0, vy = s ? s.vel.y : 0;
    if (s) reg.stop(w.el);
    const tx = target.x - c.x, ty = target.y - c.y;
    const dX = tx - ox, dY = ty - oy, travel = Math.hypot(dX, dY);
    const vAlong = travel > 0.5 ? (vx * dX + vy * dY) / travel : 0;
    const hand = tierOf(set, 'hand', travel > 0.5 ? (vAlong / travel) / rate : 0);
    const flick = tierOf(set, 'flick');
    const d = (i * stagger) / rate;
    const arrive = d + timeTo(hand, 0.98) / rate;
    const fade = st.arrivalFade / rate;
    const lift = st.sweepLift;
    const channels = [
      { prop: 'x', spring: hand, from: ox, to: tx, delay: d, timeScale: rate },
      { prop: 'y', spring: hand, from: oy, to: ty, delay: d, timeScale: rate },
      { prop: 'scale', fn: (t) => { const p = t <= d ? 0 : hand.at((t - d) * rate); return 1 + lift * 4 * p * (1 - p); }, end: arrive + fade },
      { prop: 'scaleX', spring: flick, from: st.squash[0], to: 1, before: 1, delay: arrive, timeScale: rate },
      { prop: 'scaleY', spring: flick, from: st.squash[1], to: 1, before: 1, delay: arrive, timeScale: rate },
      { prop: 'opacity', ramp: { from: 1, to: 0, delay: arrive, duration: fade } },
    ];
    // Own style is the end state: invisible. fill: backwards holds the first keyframe until it leaves.
    g.style.opacity = '0';
    label.style.opacity = '0';
    pill.style.opacity = '0';
    const leave = (el) => ({
      el,
      frames: [{ opacity: 1, easing: EASE_LEAVE }, { opacity: 0 }],
      options: { duration: st.labelFade / rate, delay: d, fill: 'backwards' },
    });
    const entry = reg.run(g, {
      channels, size: { w: r.width, h: r.height }, prefix: 'translate(-50%, -50%)', end: arrive + fade, transient: true,
      extras: [leave(label), leave(pill)],
    });
    if (!entry) { g.remove(); onArrive(w.amount, i === n - 1); return; }
    reg.tick(arrive, () => onArrive(w.amount, i === n - 1), entry);
    last = Math.max(last, arrive + fade);
  });
  return last;
}

/**
 * The pot shipped to the winner on the arm spring: five gold chips per winner (ten at most in all,
 * split pots in parallel), from the pot chips' measured centre to the winner's stack figure, 35ms
 * apart, lifted over the board and set down a little smaller, fully opaque for the whole flight.
 * At each arrival the chip fades and the stack takes a fifth of the award.
 *
 * @param {{seat:number, x:number, y:number}[]} p.dests  stack figure centres, client px
 * @param {(seat:number, k:number, n:number) => void} p.onArrive  the k-th of n chips to that seat
 */
export function shipPot(reg, { set, rate = 1, layer, origin, dests, onArrive }) {
  const st = stageOf(set);
  if (!dests.length) return 0;
  const per = Math.max(1, Math.min(5, Math.floor(10 / dests.length)));
  const L = layer.getBoundingClientRect();
  const arm = tierOf(set, 'arm');
  const tArrive = timeTo(arm, 0.98) / rate;
  const fade = st.arrivalFade / rate;
  let last = 0, k = 0;
  for (const dest of dests) {
    for (let i = 0; i < per; i++) {
      const chip = document.createElement('div');
      chip.className = 'replayer-flying-chip to-winner is-spring';
      chip.setAttribute('aria-hidden', 'true');
      chip.dataset.fly = String(k++);   // a stable name for a measuring harness; they leave one by one
      chip.style.left = ((origin.x - L.left) / L.width * 100).toFixed(4) + '%';
      chip.style.top = ((origin.y - L.top) / L.height * 100).toFixed(4) + '%';
      chip.style.transform = 'translate(-50%, -50%)';
      layer.appendChild(chip);
      const r = chip.getBoundingClientRect();
      const c = centre(r);
      const dx = dest.x - c.x, dy = dest.y - c.y;
      const d = (i * st.shipStagger) / rate;
      const arrive = d + tArrive;
      const lift = st.shipLift, shrink = st.shipShrink;
      const channels = [
        { prop: 'x', spring: arm, from: 0, to: dx, delay: d, timeScale: rate },
        { prop: 'y', spring: arm, from: 0, to: dy, delay: d, timeScale: rate },
        { prop: 'scale', fn: (t) => { const p = t <= d ? 0 : arm.at((t - d) * rate); return (1 + lift * 4 * p * (1 - p)) * (1 + (shrink - 1) * p); }, end: arrive + fade },
        { prop: 'opacity', ramp: { from: 1, to: 0, delay: arrive, duration: fade } },
      ];
      chip.style.opacity = '0';
      const entry = reg.run(chip, { channels, size: { w: r.width, h: r.height }, prefix: 'translate(-50%, -50%)', end: arrive + fade, transient: true });
      if (!entry) { chip.remove(); onArrive(dest.seat, i, per); continue; }
      reg.tick(arrive, () => onArrive(dest.seat, i, per), entry);
      last = Math.max(last, arrive + fade);
    }
  }
  return last;
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
