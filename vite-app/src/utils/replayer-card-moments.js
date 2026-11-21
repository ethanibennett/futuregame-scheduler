/**
 * The cards' moments (Replayer animations, 2026-11-11: picks 1, 4-7, 10-23, 25): a card turned over in place, a
 * card dealt from the dealer spot, a card lifted once, a card set to a standing pose (raised, sunk, dimmed), a
 * pat hand rapped, a folded hand leaving toward the muck. Every one is a spring on the one family
 * (utils/spring.js), a Web Animation on transform / the separate translate, rotate and scale properties /
 * opacity, made through the table's MotionRegistry, so Back, a second Forward, a scrub, 2x and an export treat
 * it as they treat the board deal. Nothing here measures the DOM: the caller reads, then hands the numbers in.
 */
import { SPRING_SETS, tierSpring, timeTo } from './spring.js';

/* One registry key per element and kind of motion: a card can turn (transform) while it lifts (translate). */
const KEYS = new WeakMap();
export function keyOf(el, kind) {
  let m = KEYS.get(el);
  if (!m) { m = {}; KEYS.set(el, m); }
  if (!m[kind]) m[kind] = { el, kind };
  return m[kind];
}

const stage = (set) => SPRING_SETS[set].stage;
const settle = (sp) => sp.settleMs(1e-3);
const arrive = (sp) => timeTo(sp, 0.98);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** The motion's clock values a caller lays moments out with (ms, at rate 1). */
export function cardTimes(set) {
  const hand = tierSpring(set, 'hand');
  const flick = tierSpring(set, 'flick');
  return {
    turn: settle(hand), turnHalf: timeTo(hand, 0.5), handArrive: arrive(hand),
    flickArrive: arrive(flick), beat: stage(set).beat, cardLag: stage(set).cardLag, place: stage(set).place,
  };
}

/**
 * A card turned over in place: scaleX 1 to 0 to 1 on the hand spring, the face swapped in at the half turn,
 * lifted `lift` px at the half. The element is the FACE (the commit already shows it); until the half turn it is
 * drawn as a back (its image moved out of its box, the back's own paint behind it), so a seat waiting for its turn
 * shows backs. `prefix` is the card's own transform (a fan's matrix), `back` the back's paint read off a back on
 * the table: { image, color, ring, size, position, repeat }.
 */
export function turnOver(reg, { set, rate = 1, el, prefix = '', delay = 0, lift = 0, size, back }) {
  const sp = tierSpring(set, 'hand');
  const half = timeTo(sp, 0.5) / rate;
  const end = delay + settle(sp) / rate;
  const at = (t) => sp.at((t - delay) * rate);
  const channels = [
    { prop: 'scaleX', fn: (t) => (t < delay ? 1 : Math.max(0.002, Math.abs(1 - 2 * at(t)))), start: delay, end, key: 'turnX:' + set + ':' + rate + ':' + delay },
  ];
  if (lift) channels.push({ prop: 'y', fn: (t) => (t < delay ? 0 : -lift * Math.sin(Math.PI * clamp01(at(t)))), start: delay, end, key: 'turnY:' + set + ':' + rate + ':' + delay + ':' + lift });
  const swap = delay + half;
  const backFrame = {
    objectFit: 'none', objectPosition: '-999em -999em',
    backgroundImage: back && back.image ? back.image : 'linear-gradient(180deg, #243b5c 0%, #1a2744 40%, #152238 100%)',
    backgroundColor: back && back.color ? back.color : '#1a2744',
    /* Its size, place and repeat as well (2026-11-16): the BTG back is one logo, centred at 62% of the card, and with
       only its image copied it tiled across the card for the first half of the turn. */
    backgroundSize: back && back.size ? back.size : 'auto',
    backgroundPosition: back && back.position ? back.position : '0% 0%',
    backgroundRepeat: back && back.repeat ? back.repeat : 'repeat',
    boxShadow: 'inset 0 0 0 1px ' + (back && back.ring ? back.ring : '#3a5a8a'),
  };
  const faceFrame = { objectFit: 'fill', objectPosition: '50% 50%', backgroundImage: 'none', backgroundColor: 'transparent', backgroundSize: 'auto', backgroundPosition: '0% 0%', backgroundRepeat: 'repeat', boxShadow: 'none' };
  return reg.run(el, {
    key: keyOf(el, 'turn'), channels, size, prefix, tolPx: 0.25,
    extras: [{
      el,
      frames: [{ ...backFrame, offset: 0 }, { ...backFrame, offset: 0.999 }, { ...faceFrame, offset: 1 }],
      options: { duration: Math.max(1, swap), delay: 0, fill: 'none', easing: 'linear' },
    }],
  });
}

/** A card dealt from the dealer spot: (dx, dy) px from where it rests, travelling on the hand spring, landing
    from 1.05 scale, opaque within the arrival fade. On the separate properties, so a fanned card keeps its tilt. */
export function dealIn(reg, { set, rate = 1, el, dx, dy, delay = 0, size, tier = 'hand' }) {
  const st = stage(set);
  const sp = tierSpring(set, tier, st.placeVelocity || 0);
  return reg.run(el, {
    key: keyOf(el, 'move'), property: 'individual', size, tolPx: 0.25,
    channels: [
      { prop: 'opacity', ramp: { from: 0, to: 1, delay, duration: (st.arrivalFade || 40) / rate } },
      { prop: 'x', spring: sp, from: dx, to: 0, delay, timeScale: rate },
      { prop: 'y', spring: sp, from: dy, to: 0, delay, timeScale: rate },
      { prop: 'scale', spring: sp, from: st.placeScale || 1.05, to: 1, delay, timeScale: rate },
    ],
  });
}

/** 10: a drawn card dealt from the dealer spot (`from`, px from its slot) into the gap a thrown card left (`gap`,
    px from its slot, still raised), held there, then sliding into its sorted slot at `sortAt` on the slide spring. */
export function drawIn(reg, { set, rate = 1, el, from, gap, delay = 0, sortAt, size }) {
  const st = stage(set);
  const sp = tierSpring(set, 'hand', st.placeVelocity || 0), slide = tierSpring(set, 'slide');
  const channels = [
    { prop: 'opacity', ramp: { from: 0, to: 1, delay, duration: (st.arrivalFade || 40) / rate } },
    { prop: 'x', spring: sp, from: from.x, to: gap.x, delay, timeScale: rate },
    { prop: 'y', spring: sp, from: from.y, to: gap.y, delay, timeScale: rate },
    { prop: 'scale', spring: sp, from: st.placeScale || 1.05, to: 1, delay, timeScale: rate },
  ];
  if (Math.abs(gap.x) >= 0.25) channels.push({ prop: 'x', spring: slide, from: 0, to: -gap.x, delay: sortAt, timeScale: rate, before: 0 });
  if (Math.abs(gap.y) >= 0.25) channels.push({ prop: 'y', spring: slide, from: 0, to: -gap.y, delay: sortAt, timeScale: rate, before: 0 });
  return reg.run(el, { key: keyOf(el, 'move'), property: 'individual', size, channels, tolPx: 0.25 });
}

/** Up `dy` px (negative is up) on the flick spring, held `hold` ms, back on the yield spring: once. `base` is the
    card's standing offset (its pose), which the motion plays on top of. */
export function liftOnce(reg, { set, rate = 1, el, dy, delay = 0, hold, base = 0, size }) {
  const flick = tierSpring(set, 'flick'), yieldSp = tierSpring(set, 'yield');
  const h = hold != null ? hold : stage(set).beat;
  const back = delay + (arrive(flick) + h) / rate;
  const channels = [
    { prop: 'y', spring: flick, from: 0, to: dy, delay, timeScale: rate },
    { prop: 'y', spring: yieldSp, from: 0, to: -dy, delay: back, timeScale: rate, before: 0 },
  ];
  if (base) channels.push({ prop: 'y', fn: () => base, start: delay, end: delay, key: 'base:' + base });
  return reg.run(el, { key: keyOf(el, 'pose'), property: 'individual', size, channels, tolPx: 0.25 });
}

/** From one standing pose to another: y from `fromY` to `toY` px (rising on flick, sinking on yield), opacity from
    `fromO` to `toO` on yield. The card's own style already is the new pose. */
export function poseTo(reg, { set, rate = 1, el, fromY = 0, toY = 0, fromO = 1, toO = 1, delay = 0, size }) {
  if (Math.abs(fromY - toY) < 0.25 && Math.abs(fromO - toO) < 0.01) return null;
  const up = toY < fromY;
  const sp = tierSpring(set, up ? 'flick' : 'yield');
  const channels = [{ prop: 'y', spring: sp, from: fromY, to: toY, delay, timeScale: rate }];
  if (Math.abs(fromO - toO) >= 0.01) channels.push({ prop: 'opacity', spring: tierSpring(set, 'yield'), from: fromO, to: toO, delay, timeScale: rate });
  return reg.run(el, { key: keyOf(el, 'pose'), property: 'individual', size, channels, tolPx: 0.25 });
}

/** A pat hand rapped once: its row (dx, dy) px toward the table's centre on flick and back on yield, no hold. */
export function rap(reg, { set, rate = 1, el, dx, dy, delay = 0, size }) {
  const flick = tierSpring(set, 'flick'), yieldSp = tierSpring(set, 'yield');
  const back = delay + arrive(flick) / rate;
  return reg.run(el, {
    key: keyOf(el, 'rap'), property: 'individual', size, tolPx: 0.25,
    channels: [
      { prop: 'x', spring: flick, from: 0, to: dx, delay, timeScale: rate },
      { prop: 'y', spring: flick, from: 0, to: dy, delay, timeScale: rate },
      { prop: 'x', spring: yieldSp, from: 0, to: -dx, delay: back, timeScale: rate, before: 0 },
      { prop: 'y', spring: yieldSp, from: 0, to: -dy, delay: back, timeScale: rate, before: 0 },
    ],
  });
}

/**
 * Ghosts of cards the commit no longer draws (a fold), in a layer over the table: each a copy of the card as it
 * was seen, placed at its centre with its tilt, travelling (tx, ty) px with a turn of `turn` degrees, a scale to
 * `scaleTo` and a fade, on `tier`, `lag` ms apart. Returns the ghosts. `cards`: [{ node, cx, cy, w, h, angle }].
 */
export function ghostsAway(reg, { set, rate = 1, layer, layerRect, cards, tx, ty, turn = 14, scaleTo = 0.94, tier = 'yield', lag, fadeTo = 0, delay = 0 }) {
  if (!layer || !layerRect || !cards.length) return [];
  const sp = tierSpring(set, tier);
  const st = stage(set);
  const step = lag != null ? lag : st.cardLag;
  let host = layer.querySelector(':scope > .replayer-ghost-row');
  if (!host) {
    host = document.createElement('div');
    host.className = 'card-row replayer-ghost-row';
    layer.appendChild(host);
  }
  return cards.map((c, i) => {
    const g = c.node.cloneNode(true);
    g.removeAttribute('data-ck');
    g.removeAttribute('data-slot');
    g.style.cssText = '';
    g.className = c.node.className;
    Object.assign(g.style, {
      position: 'absolute', left: (c.cx - layerRect.left - c.w / 2) + 'px', top: (c.cy - layerRect.top - c.h / 2) + 'px',
      width: c.w + 'px', height: c.h + 'px', margin: '0', transformOrigin: '50% 50%', zIndex: String(i + 1),
      transform: 'rotate(' + (c.angle || 0).toFixed(2) + 'deg)', pointerEvents: 'none',
    });
    host.appendChild(g);
    const d = delay + (i * step) / rate;
    const dir = (tx >= 0 ? 1 : -1);
    reg.run(g, {
      transient: true, size: { w: c.w, h: c.h }, tolPx: 0.25,
      channels: [
        { prop: 'x', spring: sp, from: 0, to: tx, delay: d, timeScale: rate },
        { prop: 'y', spring: sp, from: 0, to: ty, delay: d, timeScale: rate },
        { prop: 'rotate', spring: sp, from: c.angle || 0, to: (c.angle || 0) + dir * turn, delay: d, timeScale: rate },
        { prop: 'scale', spring: sp, from: 1, to: scaleTo, delay: d, timeScale: rate },
        { prop: 'opacity', spring: sp, from: 1, to: fadeTo, delay: d, timeScale: rate },
      ],
    });
    return g;
  });
}

/** A whole row moved from `dy` px to where it rests on the slide spring (13: the run's boards parting). */
export function slideRow(reg, { set, rate = 1, el, dx = 0, dy = 0, delay = 0, size }) {
  const sp = tierSpring(set, 'slide');
  const channels = [];
  if (Math.abs(dx) >= 0.25) channels.push({ prop: 'x', spring: sp, from: dx, to: 0, delay, timeScale: rate });
  if (Math.abs(dy) >= 0.25) channels.push({ prop: 'y', spring: sp, from: dy, to: 0, delay, timeScale: rate });
  if (!channels.length) return null;
  return reg.run(el, { key: keyOf(el, 'row'), property: 'individual', size, channels, tolPx: 0.25 });
}

/* A card placed on the board (the board deal's own placement): opaque in two frames, dropped, scaled down,
   squared, on the hand and inertia springs. */
function placement(set, rate, t, height, rot) {
  const st = stage(set);
  const hit = tierSpring(set, 'hand', st.placeVelocity || 0), inertia = tierSpring(set, 'inertia');
  return [
    { prop: 'opacity', ramp: { from: 0, to: 1, delay: t, duration: st.appear / rate } },
    { prop: 'y', spring: hit, from: -st.placeDrop * height, to: 0, delay: t, timeScale: rate },
    { prop: 'scale', spring: hit, from: st.placeScale, to: 1, delay: t, timeScale: rate },
    { prop: 'rotate', spring: inertia, from: rot, to: 0, delay: t, timeScale: rate },
  ];
}

/** When each street's cards are placed in a run-out (14): the flop as the deal places it, then a street every three
    beats; a run that starts at the turn places it as a turn is placed. ms, at rate 1. */
export function runOutTimes(set, groups) {
  const st = stage(set);
  const out = [];
  let t = groups[0] >= 3 ? st.place : st.yieldAfterSweep + st.cardLag;
  groups.forEach((n, k) => {
    out.push(t);
    t += k === 0 && n >= 3 ? 430 : 3 * st.beat;
  });
  return out;
}

/**
 * 14: the board run out in one press. `stayed`: the cards on the board before it ({ el, rect, from }: from = where
 * it was seen less its new slot); `groups`: each street's new cards in slot order ({ cards: [{ el, rect }], t }).
 * The row is centred, so with n of N cards out every card sits (N - n) / 2 pitches right of its last slot: each
 * street's arrival moves the row on the yield spring as a turn's does, and the flop lands stacked and spreads.
 */
export function runOutBoard(reg, { set, rate = 1, stayed = [], groups, pitch }) {
  const st = stage(set);
  const yieldSp = tierSpring(set, 'yield'), slide = tierSpring(set, 'slide');
  const N = stayed.length + groups.reduce((n, g) => n + g.cards.length, 0);
  const off = (n) => ((N - n) * pitch) / 2;
  const counts = [];
  let n = stayed.length;
  groups.forEach((g) => { n += g.cards.length; counts.push(n); });
  const shifts = (fromK, start) => {
    const chs = [];
    let prev = start;
    for (let k = fromK; k < groups.length; k++) {
      const to = off(counts[k]);
      if (Math.abs(to - prev) >= 0.25) chs.push({ prop: 'x', spring: yieldSp, from: 0, to: to - prev, delay: groups[k].t / rate, timeScale: rate, before: 0 });
      prev = to;
    }
    return chs;
  };
  stayed.forEach(({ el, rect, from }) => {
    reg.stop(el);
    const channels = [{ prop: 'x', fn: () => from, start: 0, end: 0, key: 'from:' + from.toFixed(2) }, ...shifts(0, from)];
    reg.run(el, { channels, size: { w: rect.width, h: rect.height }, tolPx: 0.1 });
  });
  groups.forEach((g, k) => {
    const rot = st.rot[k === 0 && g.cards.length >= 3 ? 'flop' : (counts[k] >= 5 ? 'river' : 'turn')] || 0;
    const x0 = g.cards[0].rect.left;
    const flop = g.cards.length >= 3;
    const spread = g.cards.map((_, i) => i).filter((i) => Math.abs(x0 - g.cards[i].rect.left) > 0.5)
      .sort((a, b) => Math.abs(x0 - g.cards[b].rect.left) - Math.abs(x0 - g.cards[a].rect.left));
    g.cards.forEach(({ el, rect }, i) => {
      reg.stop(el);
      const t = g.t / rate + (flop ? 0 : (i * st.sweepStagger) / rate);
      const channels = placement(set, rate, t, rect.height, rot);
      const base = off(counts[k]);
      if (Math.abs(base) >= 0.25) channels.push({ prop: 'x', fn: () => base, start: t, end: t, key: 'base:' + base.toFixed(2) });
      channels.push(...shifts(k + 1, base));
      const q = spread.indexOf(i);
      if (flop && q >= 0) channels.push({ prop: 'x', spring: slide, from: x0 - rect.left, to: 0, delay: t + (st.beat + q * st.midLag) / rate, timeScale: rate });
      reg.run(el, { channels, size: { w: rect.width, h: rect.height }, tolPx: 0.1 });
    });
  });
}

/** A standing pose that changes more than once in one moment (16 in a run-out): `steps` [{ t, toY }] in order. */
export function poseSequence(reg, { set, rate = 1, el, fromY = 0, steps, size }) {
  const flick = tierSpring(set, 'flick'), yieldSp = tierSpring(set, 'yield');
  const channels = [{ prop: 'y', fn: () => fromY, start: 0, end: 0, key: 'y0:' + fromY.toFixed(2) }];
  let prev = fromY;
  steps.forEach(({ t, toY }) => {
    if (Math.abs(toY - prev) < 0.25) return;
    channels.push({ prop: 'y', spring: toY < prev ? flick : yieldSp, from: 0, to: toY - prev, delay: t, timeScale: rate, before: 0 });
    prev = toY;
  });
  if (channels.length < 2) return null;
  return reg.run(el, { key: keyOf(el, 'pose'), property: 'individual', size, channels, tolPx: 0.25 });
}

/**
 * 7: a stud fold's up cards travel to their places in the Dead cards strip, squaring and shrinking to the strip's
 * size, on the arm spring, `lag` ms apart. The strip may lie outside the table, so the ghosts fly in a layer fixed
 * over the whole window. cards: [{ node, cx, cy, w, h, angle, to: { cx, cy, w } }]. Returns when each lands (ms).
 */
export function ghostsTo(reg, { set, rate = 1, cards, lag, delay = 0 }) {
  if (!cards.length || typeof document === 'undefined') return [];
  const sp = tierSpring(set, 'arm');
  const st = stage(set);
  const step = lag != null ? lag : st.place;
  let host = document.querySelector('body > .replayer-ghost-fixed');
  if (!host) {
    host = document.createElement('div');
    host.className = 'card-row replayer-ghost-fixed';
    document.body.appendChild(host);
  }
  const lands = [];
  cards.forEach((c, i) => {
    const g = c.node.cloneNode(true);
    g.removeAttribute('data-ck');
    g.removeAttribute('data-pose');
    g.style.cssText = '';
    Object.assign(g.style, {
      position: 'absolute', left: (c.cx - c.w / 2) + 'px', top: (c.cy - c.h / 2) + 'px', width: c.w + 'px', height: c.h + 'px',
      margin: '0', transformOrigin: '50% 50%', transform: 'rotate(' + (c.angle || 0).toFixed(2) + 'deg)', pointerEvents: 'none',
    });
    host.appendChild(g);
    const d = delay + (i * step) / rate;
    const s = c.to.w && c.w ? c.to.w / c.w : 1;
    reg.run(g, {
      transient: true, size: { w: c.w, h: c.h }, tolPx: 0.25,
      channels: [
        { prop: 'x', spring: sp, from: 0, to: c.to.cx - c.cx, delay: d, timeScale: rate },
        { prop: 'y', spring: sp, from: 0, to: c.to.cy - c.cy, delay: d, timeScale: rate },
        { prop: 'rotate', spring: sp, from: c.angle || 0, to: 0, delay: d, timeScale: rate },
        { prop: 'scale', spring: sp, from: 1, to: s, delay: d, timeScale: rate },
      ],
    });
    lands.push(d + arrive(sp) / rate);
  });
  return lands;
}

/** An element unseen until `at` ms, then shown in two frames (a dead strip's card under the ghost that lands on
    it), or slid from `dx` px on the yield spring (a strip card making room). */
export function appearAt(reg, { set, rate = 1, el, at = 0, dx = 0, size }) {
  const channels = [{ prop: 'opacity', ramp: { from: 0, to: 1, delay: at, duration: stage(set).appear / rate } }];
  return reg.run(el, { key: keyOf(el, 'move'), property: 'individual', size, channels, tolPx: 0.25 });
}
export function makeRoom(reg, { set, rate = 1, el, dx, size }) {
  if (Math.abs(dx) < 0.25) return null;
  return reg.run(el, { key: keyOf(el, 'move'), property: 'individual', size, tolPx: 0.25,
    channels: [{ prop: 'x', spring: tierSpring(set, 'yield'), from: dx, to: 0, timeScale: rate }] });
}

/** A transform matrix's rotation, degrees. */
export function angleOf(matrix) {
  const m = /matrix\(([^)]+)\)/.exec(matrix || '');
  if (!m) return 0;
  const [a, b] = m[1].split(',').map(Number);
  return Math.atan2(b, a) * 180 / Math.PI;
}

/**
 * 25, as the owner asked it (2026-11-21: "When splayed, they should just slide together around the arc into a single
 * stack, then that whole stack should spin into the middle. Same with non-splayed, but they should just slide
 * laterally"). Ghost copies of the folded cards in the flight layer, each starting where its card was:
 *   gather   every card slides to the middle card of the hand on the slide spring. A fan's cards travel round the fan's
 *            own arc (its pivot and radius fitted to the cards' centres and tilts), turning as they go, so they meet at
 *            the middle card's tilt; a flat row's cards slide straight along it.
 *            They dim as they close (owner, 2026-11-21: "dim the folded cards as they combine into a stack. The dimming
 *            should also be animated and smooth"): brightness 1 to `dimTo` (a dead card's 0.42) on an ease-out over
 *            the gather, held through the spin.
 *   spin     a beat after they meet, the stack goes to `target` (px, the layer's frame) on the inertia spring, turning a
 *            whole turn (toward the side it travels), shrinking to 0.6 and fading over its last 40%.
 * cards: [{ node, cx, cy, w, h, angle }] in page px (angle in degrees); returns the ghosts.
 */
export function foldToStack(reg, { set, rate = 1, layer, layerRect, cards, target, spin = 360, scaleTo = 0.6, back = null, dimTo = 0.42 }) {
  if (!layer || !layerRect || !cards.length) return [];
  const gather = tierSpring(set, 'slide'), go = tierSpring(set, 'inertia');
  const n = cards.length;
  const rad = (d) => (d * Math.PI) / 180;
  const unit = (d) => ({ x: Math.sin(rad(d)), y: -Math.cos(rad(d)) });
  // The fan's pivot P and radius: least squares on c = P + R * unit(angle), unknowns Px, Py, R.
  const angles = cards.map((c) => c.angle || 0);
  const fanned = Math.max(...angles) - Math.min(...angles) > 1;
  let P = null;
  if (fanned) {
    // Normal equations for [Px, Py, R].
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
    for (const c of cards) {
      const u = unit(c.angle || 0);
      const rows = [[1, 0, u.x, c.cx], [0, 1, u.y, c.cy]];
      for (const [a0, a1, a2, v] of rows) {
        const r = [a0, a1, a2];
        for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) A[i][j] += r[i] * r[j]; b[i] += r[i] * v; }
      }
    }
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(A);
    if (Math.abs(D) > 1e-9) {
      const col = (k) => A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)));
      const R = det(col(2)) / D;
      if (R > 0) P = { x: det(col(0)) / D, y: det(col(1)) / D };
    }
  }
  // The stack forms on the middle card (on the arc between the two middle cards for an even count).
  const mid = (n - 1) / 2;
  const lo = cards[Math.floor(mid)], hi = cards[Math.ceil(mid)];
  const aS = ((lo.angle || 0) + (hi.angle || 0)) / 2;
  const radiusOf = (c) => (P ? (c.cx - P.x) * unit(c.angle || 0).x + (c.cy - P.y) * unit(c.angle || 0).y : 0);
  const rS = (radiusOf(lo) + radiusOf(hi)) / 2;
  const S = P ? { x: P.x + rS * unit(aS).x, y: P.y + rS * unit(aS).y } : { x: (lo.cx + hi.cx) / 2, y: (lo.cy + hi.cy) / 2 };
  const tMeet = timeTo(gather, 0.985) / rate;
  const tGo = tMeet + stage(set).beat / rate * 0.5;
  const end = tGo + settle(go) / rate;
  const g = (t) => (t <= 0 ? 0 : gather.at(t * rate));
  const h = (t) => (t <= tGo ? 0 : go.at((t - tGo) * rate));
  const T = { x: target.x + layerRect.left, y: target.y + layerRect.top };
  const dir = T.x >= S.x ? 1 : -1;
  let host = layer.querySelector(':scope > .replayer-ghost-row');
  if (!host) {
    host = document.createElement('div');
    host.className = 'card-row replayer-ghost-row';
    layer.appendChild(host);
  }
  return cards.map((c, i) => {
    const ghost = c.node.cloneNode(true);
    ghost.removeAttribute('data-ck');
    ghost.removeAttribute('data-slot');
    ghost.style.cssText = '';
    ghost.className = c.node.className;
    const a0 = c.angle || 0;
    Object.assign(ghost.style, {
      position: 'absolute', left: (c.cx - layerRect.left - c.w / 2) + 'px', top: (c.cy - layerRect.top - c.h / 2) + 'px',
      width: c.w + 'px', height: c.h + 'px', margin: '0', transformOrigin: '50% 50%', zIndex: String(i + 1),
      transform: 'none', pointerEvents: 'none',
    });
    /* A face-down card is a placeholder the seat's own rules paint; out of the seat it is painted as the theme's back
       (`back`, read off a back on the table, as a turn-over is). */
    if (c.node.tagName !== 'IMG' && back) {
      Object.assign(ghost.style, {
        backgroundImage: back.image || 'none', backgroundColor: back.color || '#1a2744', backgroundSize: back.size || 'auto',
        backgroundPosition: back.position || '0% 0%', backgroundRepeat: back.repeat || 'repeat', borderRadius: back.radius || '',
        boxShadow: 'inset 0 0 0 1px ' + (back.ring || '#3a5a8a'),
      });
    }
    host.appendChild(ghost);
    const r0 = radiusOf(c);
    // Where the card's centre is at gather progress q, relative to where it started.
    const at = (q) => {
      if (!P) return { x: (S.x - c.cx) * q, y: (S.y - c.cy) * q };
      const th = a0 + (aS - a0) * q, r = r0 + (rS - r0) * q, u = unit(th);
      return { x: P.x + r * u.x - c.cx, y: P.y + r * u.y - c.cy };
    };
    const pos = (t) => { const q = g(t), k = h(t), p = at(q); return { x: p.x + (T.x - S.x) * k, y: p.y + (T.y - S.y) * k }; };
    return reg.run(ghost, {
      transient: true, size: { w: c.w, h: c.h }, tolPx: 0.25, end,
      extras: [{ el: ghost, frames: [{ filter: 'brightness(1)' }, { filter: 'brightness(' + dimTo + ')' }],
        options: { duration: Math.max(1, tMeet), delay: 0, fill: 'forwards', easing: 'cubic-bezier(0.33, 0, 0.2, 1)' } }],
      channels: [
        { prop: 'x', fn: (t) => pos(Math.min(t, end)).x, start: 0, end, key: 'fsx:' + i + ':' + c.cx + ':' + c.cy + ':' + T.x },
        { prop: 'y', fn: (t) => pos(Math.min(t, end)).y, start: 0, end, key: 'fsy:' + i + ':' + c.cx + ':' + c.cy + ':' + T.y },
        { prop: 'rotate', fn: (t) => { const q = g(Math.min(t, end)), k = h(Math.min(t, end)); return a0 + (aS - a0) * q + dir * spin * k; }, start: 0, end, key: 'fsr:' + i + ':' + a0 + ':' + aS + ':' + dir },
        { prop: 'scale', fn: (t) => 1 + (scaleTo - 1) * clamp01(h(Math.min(t, end))), start: 0, end, key: 'fss:' + scaleTo + ':' + tGo },
        { prop: 'opacity', fn: (t) => 1 - clamp01((h(Math.min(t, end)) - 0.6) / 0.4), start: 0, end, key: 'fso:' + tGo },
      ],
    }) && ghost;
  }).filter(Boolean);
}
