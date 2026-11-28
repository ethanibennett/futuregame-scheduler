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
/** How long a card takes to turn over (turnOver), in the replay's own ms: 2.2 beats (308ms in set B). */
const turnMs = (set) => 2.2 * stage(set).beat;

/** The motion's clock values a caller lays moments out with (ms, at rate 1). */
export function cardTimes(set) {
  const hand = tierSpring(set, 'hand');
  const flick = tierSpring(set, 'flick');
  return {
    turn: turnMs(set), turnHalf: turnMs(set) / 2, handArrive: arrive(hand), armArrive: arrive(tierSpring(set, 'arm')),
    flickArrive: arrive(flick), beat: stage(set).beat, cardLag: stage(set).cardLag, place: stage(set).place,
  };
}

/* A face card drawn as a back (its image moved out of its box, the back's paint behind it), and drawn as its face: the
   keyframes a turn swaps between at its half turn. `back` is the back's paint read off a back on the table. */
function backFrameOf(back) {
  return {
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
}
const FACE_FRAME = { objectFit: 'fill', objectPosition: '50% 50%', backgroundImage: 'none', backgroundColor: 'transparent', backgroundSize: 'auto', backgroundPosition: '0% 0%', backgroundRepeat: 'repeat', boxShadow: 'none' };

/**
 * A card turned over in place: scaleX 1 to 0 to 1 on the hand spring, the face swapped in at the half turn,
 * lifted `lift` px at the half. The element is the FACE (the commit already shows it); until the half turn it is
 * drawn as a back (its image moved out of its box, the back's own paint behind it), so a seat waiting for its turn
 * shows backs. `prefix` is the card's own transform (a fan's matrix), `back` the back's paint read off a back on
 * the table: { image, color, ring, size, position, repeat }.
 */
export function turnOver(reg, { set, rate = 1, el, prefix = '', delay = 0, lift = 0, size, back }) {
  /* An even turn: an ease in and out over turnMs (owner, 2026-11-21: "Every single animation should be ultra smooth").
     On the hand spring the card lost half its width in the first 90ms and crept through the rest, 7px a frame at the
     start. Swapped at the half turn, as before. */
  const dur = turnMs(set) / rate;
  const half = dur / 2;
  const end = delay + dur;
  const at = (t) => { const p = clamp01((t - delay) / dur); return p * p * (3 - 2 * p); };
  const channels = [
    { prop: 'scaleX', fn: (t) => (t < delay ? 1 : Math.max(0.002, Math.abs(1 - 2 * at(t)))), start: delay, end, key: 'turnX:' + set + ':' + rate + ':' + delay },
  ];
  if (lift) channels.push({ prop: 'y', fn: (t) => (t < delay ? 0 : -lift * Math.sin(Math.PI * clamp01(at(t)))), start: delay, end, key: 'turnY:' + set + ':' + rate + ':' + delay + ':' + lift });
  const swap = delay + half;
  const backFrame = backFrameOf(back);
  const faceFrame = FACE_FRAME;
  return reg.run(el, {
    key: keyOf(el, 'turn'), channels, size, prefix, tolPx: 0.25,
    extras: [{
      el,
      frames: [{ ...backFrame, offset: 0 }, { ...backFrame, offset: 0.999 }, { ...faceFrame, offset: 1 }],
      options: { duration: Math.max(1, swap), delay: 0, fill: 'none', easing: 'linear' },
    }],
  });
}

/** A card dealt from the dealer spot: (dx, dy) px from where it rests, travelling on the arm spring, landing
    from 1.05 scale, opaque within the arrival fade. On the separate properties, so a fanned card keeps its tilt.
    The arm since 2026-11-21 (owner: "Every single animation should be ultra smooth"): on the hand spring a stud card
    crossed the felt at 26px a frame. Its landing is cardTimes().armArrive. */
export function dealIn(reg, { set, rate = 1, el, dx, dy, delay = 0, size, tier = 'arm' }) {
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

/**
 * Copies of cards the commit no longer draws and no moment takes away (a draw game's thrown cards, gone as the new
 * ones come), each where it lay with its tilt, fading out from how strongly it was drawn (`o`: a thrown card's 0.4).
 * They went in a frame (owner, 2026-11-21: "Every single animation should be ultra smooth").
 * `cards`: [{ node, cx, cy, w, h, angle, o }]; `duration` in the replay's own ms.
 */
export function cardsAway(reg, { rate = 1, layer, layerRect, cards, duration }) {
  if (!layer || !layerRect || !cards.length) return [];
  let host = layer.querySelector(':scope > .replayer-ghost-row');
  if (!host) {
    host = document.createElement('div');
    host.className = 'card-row replayer-ghost-row';
    layer.appendChild(host);
  }
  const ease = (p) => p * p * (3 - 2 * p);
  return cards.map((c, i) => {
    const g = c.node.cloneNode(true);
    ['data-ck', 'data-slot', 'data-pose'].forEach((a) => g.removeAttribute(a));
    g.style.cssText = '';
    g.className = c.node.className;
    Object.assign(g.style, {
      position: 'absolute', left: (c.cx - layerRect.left - c.w / 2) + 'px', top: (c.cy - layerRect.top - c.h / 2) + 'px',
      width: c.w + 'px', height: c.h + 'px', margin: '0', transformOrigin: '50% 50%', zIndex: String(i + 1),
      transform: 'rotate(' + (c.angle || 0).toFixed(2) + 'deg)', pointerEvents: 'none',
    });
    host.appendChild(g);
    reg.run(g, {
      transient: true, property: 'individual', size: { w: c.w, h: c.h },
      channels: [{ prop: 'opacity', ramp: { from: c.o != null && Number.isFinite(c.o) ? c.o : 1, to: 0, delay: 0, duration: duration / rate, ease } }],
    });
    return g;
  });
}

/**
 * Copies of the action labels the commit no longer draws (the last street's at a new street, a seat's at the result),
 * in a layer over the table, each drawn exactly as it was seen and fading out where it stood: no move, no turn, no
 * size change (owner, 2026-11-21: "the fold action buttons should fade away, not violently disappear"). They had sunk
 * by their own height on the yield spring and gone in about 100ms, and each copy also lost what its plaque did to it:
 * a folded plaque's 0.88 and its grey, and a check's or fold's 0.85 or an earlier answer's 0.4 (the copy started at
 * 1), so every label first brightened and grew, then dropped away.
 * `labels`: [{ node, cx, cy, w, h, scale, filter, opacity, plaque }] (opacity: the plaque's, multiplied into the
 * label's own; plaque: where the label stood, to read its look from).
 * The copy is a plain element with the label's look written on it, not a clone with the label's classes: the layer is
 * inside the table, and every placement pass (labels, readouts, wagers, the pill) and the stale dimming find labels by
 * that class, so for its half second a cloned copy was an obstacle they placed things round, and a stale one dimmed.
 * `duration` and `stagger` are in ms of the replay's own time (divided by `rate` here).
 */
const LABEL_LOOK = ['display', 'alignItems', 'justifyContent', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch',
  'fontVariantNumeric', 'letterSpacing', 'textTransform', 'lineHeight', 'whiteSpace', 'color', 'backgroundColor', 'backgroundImage',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopStyle', 'borderRightStyle', 'borderBottomStyle',
  'borderLeftStyle', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'borderTopLeftRadius',
  'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius', 'paddingTop', 'paddingRight', 'paddingBottom',
  'paddingLeft', 'textShadow', 'boxShadow', 'textAlign'];
export function labelsAway(reg, { rate = 1, layer, layerRect, labels, duration, stagger = 0, delay = 0 }) {
  if (!layer || !layerRect || !labels.length) return [];
  let host = layer.querySelector(':scope > .replayer-ghost-row');
  if (!host) {
    host = document.createElement('div');
    host.className = 'card-row replayer-ghost-row';
    layer.appendChild(host);
  }
  const ease = (p) => p * p * (3 - 2 * p);
  return labels.map((c, i) => {
    // The label's look, read from a hidden copy put back where it stood (its plaque), so every rule that styles it
    // there (its action, a stale answer's 0.4, the table's card count, the theme) applies.
    const probe = c.node.cloneNode(true);
    probe.removeAttribute('data-act-seat');
    probe.style.visibility = 'hidden';
    (c.plaque && c.plaque.isConnected ? c.plaque : host).appendChild(probe);
    const cs = getComputedStyle(probe);
    const look = {};
    LABEL_LOOK.forEach((k) => { look[k] = cs[k]; });
    const own = Number(cs.opacity);
    probe.remove();
    const g = document.createElement('div');
    g.className = 'replayer-label-copy';
    g.setAttribute('aria-hidden', 'true');
    g.textContent = c.node.textContent;
    Object.assign(g.style, look, {
      position: 'absolute', boxSizing: 'border-box', left: (c.cx - layerRect.left - c.w / 2) + 'px', top: (c.cy - layerRect.top - c.h / 2) + 'px',
      width: c.w + 'px', height: c.h + 'px', margin: '0', transformOrigin: '50% 50%', zIndex: String(i + 1),
      transform: 'scale(' + (c.scale || 1).toFixed(4) + ')', filter: c.filter || 'none', pointerEvents: 'none',
    });
    host.appendChild(g);
    const from = (Number.isFinite(own) ? own : 1) * (c.opacity != null ? c.opacity : 1);
    // A label replaced by its seat's next answer leaves at once, over its own `duration` (the new one's fade-in).
    const d = c.duration != null ? 0 : (delay + i * stagger) / rate;
    // On the individual properties, so the copy's own transform (its plaque's scale) stands: the registry's frames
    // carry a transform even for a fade.
    reg.run(g, {
      transient: true, property: 'individual', size: { w: c.w, h: c.h },
      channels: [{ prop: 'opacity', ramp: { from, to: 0, delay: d, duration: (c.duration != null ? c.duration : duration) / rate, ease } }],
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
    const land = d + arrive(sp) / rate;
    /* No flicker at the hand-over (owner, 2026-11-22: "dead cards sometimes flickering in brightness in stud replays,
       we need to get rid of ALL flickers and pulses"): the ghost dims on the way to the strip card's own opacity
       (`to.opacity`, the strip draws its cards at 0.85), and is gone in the frame its card is shown (appearAt, the same
       instant). It used to land at full and stay on top of the card through its settle. */
    const toOp = c.to.opacity != null ? c.to.opacity : 1;
    reg.run(g, {
      transient: true, size: { w: c.w, h: c.h }, tolPx: 0.25,
      channels: [
        { prop: 'x', spring: sp, from: 0, to: c.to.cx - c.cx, delay: d, timeScale: rate },
        { prop: 'y', spring: sp, from: 0, to: c.to.cy - c.cy, delay: d, timeScale: rate },
        { prop: 'rotate', spring: sp, from: c.angle || 0, to: 0, delay: d, timeScale: rate },
        { prop: 'scale', spring: sp, from: 1, to: s, delay: d, timeScale: rate },
        ...(toOp < 1 ? [{ prop: 'opacity', ramp: { from: 1, to: toOp, delay: d, duration: Math.max(1, land - d) } }] : []),
        { prop: 'opacity', ramp: { from: 1, to: 0, delay: land, duration: 1 } },
      ],
    });
    lands.push(land);
  });
  return lands;
}

/** An element unseen until `at` ms, then shown at once at its own opacity (a dead strip's card under the ghost that
    lands on it, the ghost gone in the same frame). It faded in to 1 over two frames and then fell back to its own
    0.85 when the fade ended: a flicker. */
export function appearAt(reg, { set, rate = 1, el, at = 0, dx = 0, size, duration = 1 }) {
  // Its own opacity, read with any earlier motion of it stopped (an animation would be read instead).
  const key = keyOf(el, 'move');
  try { reg.stop(key); } catch (e) { /* nothing running */ }
  let own = 1;
  try { own = parseFloat(getComputedStyle(el).opacity); if (!(own >= 0)) own = 1; } catch (e) { own = 1; }
  /* `duration` > 1 fades it in to its own opacity, never past it (a card with no ghost landing on it: Stud flip under). */
  const channels = [{ prop: 'opacity', ramp: { from: 0, to: own, delay: at, duration } }];
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
 *            whole turn (toward the side it travels), shrinking to 0.6 and fading out as it goes (owner, 2026-11-21: "fade
 *            the cards out as they spin toward the middle"): opacity follows the spin's own progress, 1 to 0.
 * cards: [{ node, cx, cy, w, h, angle }] in page px (angle in degrees); returns the ghosts.
 */
export function foldToStack(reg, { set, rate = 1, layer, layerRect, cards, target, spin = 360, scaleTo = 0.6, back = null, dimTo = 0.42 }) {
  if (!layer || !layerRect || !cards.length) return [];
  const gather = tierSpring(set, 'slide'), go = tierSpring(set, 'inertia');
  const geo = stackGeometry(cards);
  const S = geo.S;
  const tMeet = timeTo(gather, 0.985) / rate;
  const tGo = tMeet + stage(set).beat / rate * 0.5;
  const end = tGo + settle(go) / rate;
  const g = (t) => (t <= 0 ? 0 : gather.at(t * rate));
  const h = (t) => (t <= tGo ? 0 : go.at((t - tGo) * rate));
  const T = { x: target.x + layerRect.left, y: target.y + layerRect.top };
  const dir = T.x >= S.x ? 1 : -1;
  const host = ghostHost(layer);
  return cards.map((c, i) => {
    const ghost = ghostOf(host, c, layerRect, back, i);
    const a0 = c.angle || 0;
    const pos = (t) => { const q = g(t), k = h(t), p = geo.at(c, q); return { x: p.x + (T.x - S.x) * k, y: p.y + (T.y - S.y) * k }; };
    return reg.run(ghost, {
      transient: true, size: { w: c.w, h: c.h }, tolPx: 0.25, end,
      extras: [{ el: ghost, frames: [{ filter: 'brightness(1)' }, { filter: 'brightness(' + dimTo + ')' }],
        options: { duration: Math.max(1, tMeet), delay: 0, fill: 'forwards', easing: 'cubic-bezier(0.33, 0, 0.2, 1)' } }],
      channels: [
        { prop: 'x', fn: (t) => pos(Math.min(t, end)).x, start: 0, end, key: 'fsx:' + i + ':' + c.cx + ':' + c.cy + ':' + T.x },
        { prop: 'y', fn: (t) => pos(Math.min(t, end)).y, start: 0, end, key: 'fsy:' + i + ':' + c.cx + ':' + c.cy + ':' + T.y },
        { prop: 'rotate', fn: (t) => { const q = g(Math.min(t, end)), k = h(Math.min(t, end)); return a0 + (geo.aS - a0) * q + dir * spin * k; }, start: 0, end, key: 'fsr:' + i + ':' + a0 + ':' + geo.aS + ':' + dir },
        { prop: 'scale', fn: (t) => 1 + (scaleTo - 1) * clamp01(h(Math.min(t, end))), start: 0, end, key: 'fss:' + scaleTo + ':' + tGo },
        { prop: 'opacity', fn: (t) => 1 - clamp01(h(Math.min(t, end))), start: 0, end, key: 'fso2:' + tGo },
      ],
    }) && ghost;
  }).filter(Boolean);
}

/* Where a hand's cards meet when it is gathered into one stack (25): a fan's pivot P and radius are fitted to the cards'
   centres and tilts (least squares on c = P + R * unit(angle), unknowns Px, Py, R), and the stack forms on the middle
   card (on the arc between the two middle cards for an even count). `at(c, q)` is where card c's centre is at gather
   progress q, relative to where it started; `angleAt(c, q)` its tilt. A flat row slides straight along. */
function stackGeometry(cards) {
  const n = cards.length;
  const rad = (d) => (d * Math.PI) / 180;
  const unit = (d) => ({ x: Math.sin(rad(d)), y: -Math.cos(rad(d)) });
  const angles = cards.map((c) => c.angle || 0);
  const fanned = Math.max(...angles) - Math.min(...angles) > 1;
  let P = null;
  if (fanned) {
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
  const mid = (n - 1) / 2;
  const lo = cards[Math.floor(mid)], hi = cards[Math.ceil(mid)];
  const aS = ((lo.angle || 0) + (hi.angle || 0)) / 2;
  const radiusOf = (c) => (P ? (c.cx - P.x) * unit(c.angle || 0).x + (c.cy - P.y) * unit(c.angle || 0).y : 0);
  const rS = (radiusOf(lo) + radiusOf(hi)) / 2;
  const S = P ? { x: P.x + rS * unit(aS).x, y: P.y + rS * unit(aS).y } : { x: (lo.cx + hi.cx) / 2, y: (lo.cy + hi.cy) / 2 };
  const at = (c, q) => {
    if (!P) return { x: (S.x - c.cx) * q, y: (S.y - c.cy) * q };
    const a0 = c.angle || 0, r0 = radiusOf(c);
    const th = a0 + (aS - a0) * q, r = r0 + (rS - r0) * q, u = unit(th);
    return { x: P.x + r * u.x - c.cx, y: P.y + r * u.y - c.cy };
  };
  const angleAt = (c, q) => (c.angle || 0) + (aS - (c.angle || 0)) * q;
  return { S, aS, at, angleAt };
}

/* The fold layer's row of ghosts (one per layer, made on first use). */
function ghostHost(layer) {
  let host = layer.querySelector(':scope > .replayer-ghost-row');
  if (!host) {
    host = document.createElement('div');
    host.className = 'card-row replayer-ghost-row';
    layer.appendChild(host);
  }
  return host;
}

/* A ghost of card c in `host`, drawn where the card is (its centre at c.cx, c.cy in the page), untransformed. */
function ghostOf(host, c, layerRect, back, i) {
  const ghost = c.node.cloneNode(true);
  ghost.removeAttribute('data-ck');
  ghost.removeAttribute('data-slot');
  ghost.style.cssText = '';
  ghost.className = c.node.className;
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
  return ghost;
}

/**
 * The ways a folded hand can leave the table (owner, 2026-11-27: "Let's make a few more folding motions other than the
 * helicopter into the muck and the shrink behind the box"), the Replayer setting Fold Motion. Spin in and Behind the
 * seat are foldToStack's two (25, and the stud fold's down cards); Spread, Lift and drop and Flicked are the owner's
 * three; the rest were offered with them. Each their own gives every player one of them, fixed by their name.
 */
export const FOLD_STYLES = [
  { id: 'spin', label: 'Spin in' },
  { id: 'tuck', label: 'Behind the seat' },
  { id: 'spread', label: 'Spread' },
  { id: 'drop', label: 'Lift and drop' },
  { id: 'flick', label: 'Flicked' },
  { id: 'push', label: 'Pushed' },
  { id: 'lob', label: 'Lobbed' },
  { id: 'throw', label: 'Thrown' },
  { id: 'coin', label: 'Coin spin' },
  { id: 'each', label: 'Each their own' },
  /* Stud's own (owner, 2026-11-27: "Let's add one specifically for stud"): studFlipUnder. Last, so the others keep their
     numbers; in a game with no up cards it plays as Behind the seat. */
  { id: 'flipunder', label: 'Stud flip under' },
];
const FOLD_IDS = new Set(FOLD_STYLES.map((s) => s.id));
export const normalizeFoldStyle = (v) => (FOLD_IDS.has(v) ? v : 'spin');

const hashStr = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
/* A small seeded generator (mulberry32): the same fold scatters the same way every time it is played or exported. */
function seeded(seed) {
  let a = hashStr(String(seed)) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The style a fold plays: the setting's, or under Each their own the player's own, by `who` (their name). */
export function foldStyleOf(setting, who = '') {
  const s = normalizeFoldStyle(setting);
  if (s !== 'each') return s;
  // Not Stud flip under: added after, it would have moved every name to another style.
  const pool = FOLD_STYLES.map((x) => x.id).filter((id) => id !== 'each' && id !== 'flipunder');
  return pool[hashStr('fold:' + String(who).trim().toLowerCase()) % pool.length];
}

/* Ghosts of `cards` each on its own pose over the moment's clock: pose(i, t) gives { x, y } (px from where the card
   was), rotate (deg, absolute), scale, scaleX and opacity, every one a function of t, so Back, a jump and an export
   seek it like any spring. `filter(i)` is an optional per-card filter track ({ frames, duration, delay }). */
function flyPoses(reg, { layer, layerRect, cards, back, end, pose, filter, more }) {
  const host = ghostHost(layer);
  return cards.map((c, i) => {
    const ghost = ghostOf(host, c, layerRect, back, i);
    let lastT = NaN, lastV = null;
    const at = (t) => {
      const tt = Math.max(0, Math.min(t, end));
      if (tt !== lastT) { lastT = tt; lastV = pose(i, tt); }
      return lastV;
    };
    // `more(i)`: further keyframe tracks of card i ({ frames, duration, delay, fill }), a face swapped for its back.
    const f = filter ? filter(i) : null;
    const tracks = [f, ...(more ? more(i) || [] : [])].filter(Boolean);
    return reg.run(ghost, {
      transient: true, size: { w: c.w, h: c.h }, tolPx: 0.25, end,
      extras: tracks.map((x) => ({ el: ghost, frames: x.frames, options: { duration: Math.max(1, x.duration), delay: x.delay || 0, fill: x.fill || 'both', easing: x.easing || 'linear' } })),
      channels: ['x', 'y', 'rotate', 'scale', 'scaleX', 'opacity'].map((prop) => ({ prop, fn: (t) => at(t)[prop], start: 0, end })),
    }) && ghost;
  }).filter(Boolean);
}

const smooth = (p) => { const q = clamp01(p); return q * q * (3 - 2 * q); };
/* A card's filter while it goes: dimmed as a folded hand is (to dimTo over `dimMs` from `delay`), with a drop shadow
   that grows with its height off the felt (`lift(t)`, 0 on the cloth, 1 at the top of a toss), sampled into keyframes. */
function dimTrack({ dimTo, dimMs, delay = 0, end, h, lift = null, steps = 28 }) {
  if (!lift) {
    return { frames: [{ filter: 'brightness(1)' }, { filter: 'brightness(' + dimTo + ')' }], duration: dimMs, delay, easing: 'cubic-bezier(0.33, 0, 0.2, 1)' };
  }
  const frames = [];
  for (let k = 0; k <= steps; k++) {
    const t = (end * k) / steps;
    const b = 1 + (dimTo - 1) * smooth((t - delay) / dimMs);
    const L = clamp01(lift(t));
    const dy = (0.03 + 0.16 * L) * h, blur = (0.04 + 0.22 * L) * h, a = 0.34 - 0.14 * L;
    frames.push({ offset: k / steps, filter: 'brightness(' + b.toFixed(3) + ') drop-shadow(0 ' + dy.toFixed(1) + 'px ' + blur.toFixed(1) + 'px rgba(0,0,0,' + a.toFixed(3) + '))' });
  }
  return { frames, duration: end, delay: 0 };
}

/**
 * A folded hand leaving in one of FOLD_STYLES: ghost copies of its cards in the fold layer, under every seat. Points
 * are in the layer's px: `middle` the felt's middle (Spin in), `muck` the dealer's muck beside the deck (where a hand
 * thrown in lands), `line` just past the seat's betting line (Lift and drop), `seat` its plaque's centre (Behind the
 * seat), `pot` the pot's graphic (Flicked). `seed` fixes the scatter, so a fold plays the same way every time.
 *   spin    gathered into one stack, which spins into the middle and fades (25).
 *   tuck    gathered, then shrinks to nothing behind the seat's plaque (the stud fold's down cards).
 *   spread  gathered, the stack goes straight to just past the seat's betting line (its own side of the table) and, as
 *           it lands, its cards slide apart into a row running toward the middle of the felt; nothing turns but the
 *           gather.
 *   drop    gathered, the stack is picked up (it grows, its shadow lengthening), makes one half turn in the air and is
 *           dropped just past the betting line.
 *   flick   the cards are flicked in one at a time from the top, each sliding straight in without turning and coming to
 *           rest under the pot's graphic (owner, 2026-11-27: "For 5 let's have them land under the pot graphic, and
 *           slide without spinning").
 *   push    the hand, as it is held, pushed forward across the cloth, slowing as it goes, and fades.
 *   lob     gathered, the stack is tossed in an arc to the muck (rising and falling), lands and skids.
 *   throw   the whole hand thrown in at once, every card spinning its own way and skidding apart under the pot.
 *   coin    gathered, the stack spins on its edge like a coin, slowing, and falls flat as it fades.
 */
export function foldAway(reg, { style, set, rate = 1, layer, layerRect, cards, back = null, dimTo = 0.42, middle, muck, line, seat, pot, seed = '' }) {
  if (!layer || !layerRect || !cards.length) return [];
  const id = normalizeFoldStyle(style);
  // Stud flip under is studFlipUnder, given the up cards apart; a hand with none (any flop game) goes behind the seat.
  if ((id === 'tuck' || id === 'flipunder') && seat) return foldToStack(reg, { set, rate, layer, layerRect, cards, target: seat, back, dimTo, spin: 0, scaleTo: 0.05 });
  if (id === 'spin' || id === 'tuck' || id === 'each' || id === 'flipunder') return foldToStack(reg, { set, rate, layer, layerRect, cards, target: middle, back, dimTo });
  const B = stage(set).beat / rate;
  const R = seeded(seed + ':' + id);
  const n = cards.length;
  const page = (p) => ({ x: p.x + layerRect.left, y: p.y + layerRect.top });
  const sprAt = (sp, t0) => (t) => (t <= t0 ? 0 : sp.at((t - t0) * rate));
  const fadeFrom = (tFade, dur) => (t) => 1 - smooth((t - tFade) / dur);
  const gather = tierSpring(set, 'slide');
  const tMeet = timeTo(gather, 0.985) / rate;
  const gq = sprAt(gather, 0);
  const geo = stackGeometry(cards);
  const S = geo.S;
  const towards = (from, to) => { const dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy) || 1; return { dx, dy, d, ux: dx / d, uy: dy / d }; };
  const H = Math.max(...cards.map((c) => c.h)), W = Math.max(...cards.map((c) => c.w));
  const rad = (d) => (d * Math.PI) / 180;
  const LAND = 0.8;
  /* A hand that lands and lies on the cloth a moment is dimmed less than one that goes at once (0.42): at 0.42 a
     face-down hand on the dark felt could hardly be seen landing. */
  dimTo = Math.max(dimTo, 0.7);

  if (id === 'spread') {
    /* On the folding player's own side of the table, just past their betting line, and never turning (owner, 2026-11-27:
       "for 3 let's have them come to rest on the same side of the table that they start, and also not spin at all"):
       the stack goes straight there and, as it lands, its cards slide apart into a row, each keeping the stack's tilt.
       They went across the table to the dealer's muck before, turning on the way and fanning as they landed. */
    // Three quarters of the way to the line: the row (almost two cards wide) stays clear of the pot from a side seat.
    const L0 = page(line || muck || middle), M = { x: S.x + (L0.x - S.x) * 0.75, y: S.y + (L0.y - S.y) * 0.75 }, v = towards(S, M);
    const fly = tierSpring(set, 'arm'), fan = tierSpring(set, 'yield');
    const tGo = tMeet + 0.3 * B;
    const k = sprAt(fly, tGo);
    const tLand = tGo + timeTo(fly, 0.8) / rate;
    const sp = sprAt(fan, tLand);
    const tFade = tLand + timeTo(fan, 0.99) / rate + 1.5 * B;
    const end = tFade + 2 * B;
    const fade = fadeFrom(tFade, 2 * B);
    /* The row runs from where the stack lands toward the middle of the felt (owner, 2026-11-27: "Make #3 spread
       diagonally toward the center"), the top card furthest in; from a side or corner seat that line is a diagonal. It
       lay along the cards' own width before, flat beside the seat. A step is a share of the card's extent along that
       line, so the cards overlap alike whether it runs across them or down them. */
    const C = page(middle || muck || L0), u = towards(M, C);
    const a0 = rad(geo.aS), along = Math.abs(u.ux * Math.cos(a0) + u.uy * Math.sin(a0)) * W + Math.abs(-u.ux * Math.sin(a0) + u.uy * Math.cos(a0)) * H;
    const step = 0.38 * along;
    /* Only toward the middle, never back (owner, 2026-11-27: "3 should expand only toward the middle, not backward"):
       the bottom card stays where the stack lands and each card above it slides one step further in. */
    const spreads = cards.map((c, i) => ({ on: i * step, off: (R() - 0.5) * 0.08 * W }));
    return flyPoses(reg, { layer, layerRect, cards, back, end,
      filter: () => dimTrack({ dimTo, dimMs: tMeet, end, h: H }),
      pose: (i, t) => {
        const c = cards[i], q = gq(t), p = geo.at(c, q), kk = k(t), s = sp(t);
        const ang = geo.angleAt(c, q), sc = 1 + (LAND - 1) * clamp01(kk);
        const on = s * spreads[i].on * sc, off = s * spreads[i].off * sc;
        return { x: p.x + v.dx * kk + on * u.ux - off * u.uy, y: p.y + v.dy * kk + on * u.uy + off * u.ux,
          rotate: ang, scale: sc, scaleX: 1, opacity: fade(t) };
      } });
  }

  if (id === 'drop') {
    const Lp = page(line || muck || middle), v = towards(S, Lp), dir = v.dx >= 0 ? 1 : -1;
    const fly = tierSpring(set, 'hand');
    const tGo = tMeet + 0.2 * B;
    const F = timeTo(fly, 0.97) / rate;
    const k = sprAt(fly, tGo);
    // Up slowly, down fast: the top of the lift at 60% of the way, the drop in the last 40%.
    const lift = (t) => (t <= tGo ? 0 : Math.sin(Math.PI * Math.pow(clamp01((t - tGo) / F), 1.4)));
    const tDown = tGo + F, thud = 0.9 * B;
    const dip = (t) => (t <= tDown ? 0 : Math.sin(Math.PI * clamp01((t - tDown) / thud)));
    const tFade = tDown + thud + 1.6 * B;
    const end = tFade + 2 * B;
    const fade = fadeFrom(tFade, 2 * B);
    const restAngle = dir * (R() - 0.5) * 12;
    /* One half turn while it is off the cloth (owner, 2026-11-27: "Make #4 have the stack do one half turn in the
       air"): from the lift to just before it lands, slow to start and to finish, toward the side it is going. */
    const halfTurn = (t) => dir * 180 * smooth((t - tGo) / (0.92 * F));
    return flyPoses(reg, { layer, layerRect, cards, back, end,
      filter: () => dimTrack({ dimTo, dimMs: tMeet, end, h: H, lift }),
      pose: (i, t) => {
        const c = cards[i], q = gq(t), p = geo.at(c, q), kk = k(t);
        const ang = geo.angleAt(c, q) + (restAngle - geo.aS) * kk * 0.6 + halfTurn(t);
        return { x: p.x + v.dx * kk, y: p.y + v.dy * kk, rotate: ang,
          scale: (1 + (0.92 - 1) * clamp01(kk)) * (1 + 0.2 * lift(t) - 0.035 * dip(t)), scaleX: 1, opacity: fade(t) };
      } });
  }

  if (id === 'flick') {
    // Under the pot's graphic (the fold layer is under it), a little apart; each slides straight, its tilt kept.
    const M = page(pot || muck || middle);
    const fly = tierSpring(set, 'flick');
    const F = timeTo(fly, 0.98) / rate;
    const stag = 0.75 * B;
    // From the top of the hand (the last card dealt sits over the rest) to the first.
    const slots = cards.map((c, i) => {
      const j = n - 1 - i, t0 = 0.2 * B + j * stag;
      const to = { x: M.x + (R() - 0.5) * 0.5 * W, y: M.y + (R() - 0.5) * 0.3 * H };
      const v = towards({ x: c.cx, y: c.cy }, to);
      return { t0, v, spin: 0, bow: 0, k: sprAt(fly, t0) };
    });
    const last = Math.max(...slots.map((s) => s.t0)) + F;
    const tFade = last + 1.0 * B;
    const end = tFade + 2 * B;
    const fade = fadeFrom(tFade, 2 * B);
    return flyPoses(reg, { layer, layerRect, cards, back, end,
      filter: (i) => dimTrack({ dimTo, dimMs: F, delay: slots[i].t0, end, h: H }),
      pose: (i, t) => {
        const c = cards[i], s = slots[i], kk = s.k(t), b = s.bow * Math.sin(Math.PI * clamp01(kk));
        return { x: s.v.dx * kk - s.v.uy * b, y: s.v.dy * kk + s.v.ux * b, rotate: (c.angle || 0) + s.spin * kk,
          scale: 1 + (LAND - 1) * clamp01(kk), scaleX: 1, opacity: fade(t) };
      } });
  }

  if (id === 'push') {
    const C = { x: cards.reduce((a, c) => a + c.cx, 0) / n, y: cards.reduce((a, c) => a + c.cy, 0) / n };
    const v = towards(C, page(middle || muck));
    const d = Math.min(0.42 * v.d, 5 * H);
    const fly = tierSpring(set, 'inertia');
    const tGo = 0.15 * B;
    const k = sprAt(fly, tGo);
    const tFade = tGo + timeTo(fly, 0.6) / rate;
    const end = tFade + 2.5 * B;
    const fade = fadeFrom(tFade, 2.5 * B);
    return flyPoses(reg, { layer, layerRect, cards, back, end,
      filter: () => dimTrack({ dimTo, dimMs: 2 * B, end, h: H }),
      pose: (i, t) => {
        const c = cards[i], kk = k(t);
        return { x: v.ux * d * kk, y: v.uy * d * kk, rotate: c.angle || 0, scale: 1 + (0.9 - 1) * clamp01(kk), scaleX: 1, opacity: fade(t) };
      } });
  }

  if (id === 'lob') {
    const M = page(muck || middle), v = towards(S, M), dir = v.dx >= 0 ? 1 : -1;
    const tGo = tMeet + 0.25 * B;
    const F = Math.max(3.2 * B, 1.1 * B + v.d / (0.55 * W) * B * 0.35);
    // Nearly even speed across the felt (a thrown thing keeps its way), up and down as it goes.
    const prog = (t) => { const p = clamp01((t - tGo) / F); return 0.5 * p + 0.5 * smooth(p); };
    const lift = (t) => (t <= tGo ? 0 : Math.sin(Math.PI * clamp01((t - tGo) / F)));
    // Landing still moving: it skids on, slowing on the cloth (the speed it landed with, decaying).
    const tLand = tGo + F, v0 = (0.5 * v.d) / F, tau = 0.7 * B;
    const skid = (t) => (t <= tLand ? 0 : v0 * tau * (1 - Math.exp(-(t - tLand) / tau)));
    const tFade = tLand + 3 * tau + 0.6 * B;
    const end = tFade + 2 * B;
    const fade = fadeFrom(tFade, 2 * B);
    const turn = dir * (30 + 25 * R());
    return flyPoses(reg, { layer, layerRect, cards, back, end,
      filter: () => dimTrack({ dimTo, dimMs: tMeet, end, h: H, lift }),
      pose: (i, t) => {
        const c = cards[i], q = gq(t), p = geo.at(c, q), kk = prog(t), sk = skid(t);
        return { x: p.x + v.dx * kk + v.ux * sk, y: p.y + v.dy * kk + v.uy * sk,
          rotate: geo.angleAt(c, q) + turn * kk + dir * 0.4 * sk,
          scale: (1 + (LAND - 1) * kk) * (1 + 0.3 * lift(t)), scaleX: 1, opacity: fade(t) };
      } });
  }

  if (id === 'throw') {
    // Under the pot's graphic (owner, 2026-11-27: "Make #8 land under the pot"); it was the dealer's muck.
    const M = page(pot || muck || middle);
    /* Less violent (owner, 2026-11-27: "Make 8 less violent"): the arm's spring, not the flick's; each card turns 35 to
       65 degrees, not 140 to 240; half the bow and two thirds of the scatter, the cards a little further apart in time. */
    const fly = tierSpring(set, 'arm');
    const F = timeTo(fly, 0.98) / rate;
    const slots = cards.map((c, i) => {
      const t0 = 0.15 * B + i * 0.12 * B;
      const to = { x: M.x + (R() - 0.5) * 0.7 * W, y: M.y + (R() - 0.5) * 0.5 * H };
      const v = towards({ x: c.cx, y: c.cy }, to);
      return { t0, v, spin: (R() < 0.5 ? -1 : 1) * (35 + 30 * R()), bow: (i % 2 ? -1 : 1) * (0.03 + 0.04 * R()) * v.d, k: sprAt(fly, t0) };
    });
    const last = Math.max(...slots.map((s) => s.t0)) + F;
    const tFade = last + 0.8 * B;
    const end = tFade + 2 * B;
    const fade = fadeFrom(tFade, 2 * B);
    return flyPoses(reg, { layer, layerRect, cards, back, end,
      filter: () => dimTrack({ dimTo, dimMs: F, delay: 0.15 * B, end, h: H }),
      pose: (i, t) => {
        const c = cards[i], s = slots[i], kk = s.k(t), b = s.bow * Math.sin(Math.PI * clamp01(kk));
        return { x: s.v.dx * kk - s.v.uy * b, y: s.v.dy * kk + s.v.ux * b, rotate: (c.angle || 0) + s.spin * kk,
          scale: 1 + (LAND - 1) * clamp01(kk), scaleX: 1, opacity: fade(t) };
      } });
  }

  if (id === 'coin') {
    const v = towards(S, page(middle || muck));
    const d = Math.min(0.25 * v.d, 2.5 * H);
    const slide = tierSpring(set, 'inertia');
    const tGo = tMeet + 0.2 * B;
    const k = sprAt(slide, tGo);
    // Two whole turns on its edge, slowing as a spun coin does, ending flat (|cos| back to 1).
    const tau = 1.6 * B, span = 5 * tau, PHI = 4 * Math.PI, norm = 1 - Math.exp(-span / tau);
    const phase = (t) => (t <= tGo ? 0 : PHI * (1 - Math.exp(-Math.min(t - tGo, span) / tau)) / norm);
    const tFade = tGo + span - 1.2 * B;
    const end = tFade + 2 * B;
    const fade = fadeFrom(tFade, 2 * B);
    return flyPoses(reg, { layer, layerRect, cards, back, end,
      filter: () => dimTrack({ dimTo, dimMs: tMeet, end, h: H }),
      pose: (i, t) => {
        const c = cards[i], q = gq(t), p = geo.at(c, q), kk = k(t);
        return { x: p.x + v.ux * d * kk, y: p.y + v.uy * d * kk, rotate: geo.angleAt(c, q),
          scale: 1 + (0.85 - 1) * clamp01(kk), scaleX: Math.max(0.03, Math.abs(Math.cos(phase(t)))), opacity: fade(t) };
      } });
  }
  return foldToStack(reg, { set, rate, layer, layerRect, cards, target: middle, back, dimTo });
}

/**
 * Stud flip under, stud's own fold (owner, 2026-11-27: "Let's add one specifically for stud: any upcards slide together
 * in a stack, flip over, and slide under the downcards before shrinking behind the seat"). Ghosts in the fold layer, the
 * up cards' drawn under the down cards':
 *   gather  the up cards slide together into one stack round their arc (stackGeometry), dimming as they close; the down
 *           cards stay where they are;
 *   flip    a beat later the up stack turns over where it is (scaleX 1 to 0 to 1, an even ease over turnMs, as turnOver
 *           turns a card), its faces swapped for the back at the half turn;
 *   under   the turned stack slides in beneath the down cards AS they close into their stack, on the one spring, so all
 *           of them become one stack together (owner, 2026-11-28: "Don't push the downcards together until the upcard
 *           stack combines, it should slide under as they all combine into one stack"), taking the down stack's tilt;
 *   tuck    the one stack goes to the seat's plaque, under it, shrinking to nothing and fading, without turning.
 * up and down: [{ node, cx, cy, w, h, angle }] in page px; seat in the layer's px. Returns { ghosts, faceDownAt }: the
 * half turn (ms), from which the Dead cards strip shows the up cards. With no up cards, or no down ones, it is Behind
 * the seat.
 */
export function studFlipUnder(reg, { set, rate = 1, layer, layerRect, up = [], down = [], seat, back = null, dimTo = 0.7 }) {
  const all = [...up, ...down];
  if (!layer || !layerRect || !all.length || !seat) return { ghosts: [], faceDownAt: 0 };
  if (!up.length || !down.length) {
    return { ghosts: foldToStack(reg, { set, rate, layer, layerRect, cards: all, target: seat, back, dimTo: 0.42, spin: 0, scaleTo: 0.05 }), faceDownAt: 0 };
  }
  const B = stage(set).beat / rate;
  const gather = tierSpring(set, 'slide'), slide = tierSpring(set, 'arm'), go = tierSpring(set, 'inertia');
  const gu = stackGeometry(up), gd = stackGeometry(down);
  const tMeet = timeTo(gather, 0.985) / rate;
  const g = (t) => (t <= 0 ? 0 : gather.at(t * rate));
  const tFlip = tMeet + 0.3 * B, dFlip = turnMs(set) / rate, faceDownAt = tFlip + dFlip / 2;
  const flip = (t) => (t <= tFlip ? 0 : smooth((t - tFlip) / dFlip));
  const tUnder = tFlip + dFlip + 0.25 * B;
  const k = (t) => (t <= tUnder ? 0 : slide.at((t - tUnder) * rate));
  const tGo = tUnder + timeTo(slide, 0.97) / rate + 0.4 * B;
  const h = (t) => (t <= tGo ? 0 : go.at((t - tGo) * rate));
  const end = tGo + settle(go) / rate;
  const T = { x: seat.x + layerRect.left, y: seat.y + layerRect.top };
  const nu = up.length, H = Math.max(...all.map((c) => c.h));
  const ghosts = flyPoses(reg, { layer, layerRect, cards: all, back, end,
    // Each dims as it closes: the up cards in their gather, the down cards in theirs.
    filter: (i) => (i < nu ? dimTrack({ dimTo, dimMs: tMeet, end, h: H }) : dimTrack({ dimTo, dimMs: timeTo(slide, 0.97) / rate, delay: tUnder, end, h: H })),
    // An up card's face swapped for the back at the half turn, and kept.
    more: (i) => (i < nu && all[i].node && all[i].node.tagName === 'IMG'
      ? [{ frames: [{ ...FACE_FRAME, offset: 0 }, { ...FACE_FRAME, offset: 0.999 }, { ...backFrameOf(back), offset: 1 }], duration: faceDownAt, fill: 'forwards' }]
      : []),
    pose: (i, t) => {
      // The down cards close on the slide's own spring, from its start: still until then.
      const c = all[i], isUp = i < nu, geo = isUp ? gu : gd, q = isUp ? g(t) : k(t), p = geo.at(c, q), hh = clamp01(h(t));
      const kk = isUp ? k(t) : 0;
      const x = p.x + (gd.S.x - gu.S.x) * kk + (T.x - gd.S.x) * h(t), y = p.y + (gd.S.y - gu.S.y) * kk + (T.y - gd.S.y) * h(t);
      return { x, y, rotate: geo.angleAt(c, q) + (isUp ? (gd.aS - gu.aS) * kk : 0), scale: 1 + (0.05 - 1) * hh,
        scaleX: isUp && t > tFlip ? Math.max(0.002, Math.abs(1 - 2 * flip(t))) : 1, opacity: 1 - hh };
    } });
  return { ghosts, faceDownAt };
}
