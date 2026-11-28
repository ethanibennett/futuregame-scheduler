// The Fold Motion styles (utils/replayer-card-moments.js foldAway, owner 2026-11-27): every style, played on a stub
// registry, starts each card where it was, moves without a jump, and is gone (opacity 0) at its end; the landing styles
// come to rest near where they were sent; Each their own gives a player one style, never itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOLD_STYLES, foldAway, foldStyleOf, normalizeFoldStyle, studFlipUnder } from '../replayer-card-moments.js';

const fakeEl = () => ({
  style: {}, className: '', tagName: 'DIV', children: [],
  removeAttribute() {}, appendChild(c) { this.children.push(c); }, querySelector() { return null; },
  cloneNode() { return fakeEl(); },
});
globalThis.document = { createElement: fakeEl };

const runs = [];
const reg = { run: (el, spec) => { runs.push(spec); return spec; } };
const val = (spec, prop, t) => {
  let v = prop === 'x' || prop === 'y' || prop === 'rotate' ? 0 : 1;
  for (const c of spec.channels) if (c.prop === prop) v = c.fn(t);
  return v;
};

// A splayed four-card hand at a bottom seat, its pivot under the cards.
const hand = [-15, -5, 5, 15].map((a) => {
  const r = 60, P = { x: 200, y: 760 };
  const rad = (a * Math.PI) / 180;
  return { node: fakeEl(), cx: P.x + r * Math.sin(rad), cy: P.y - r * Math.cos(rad), w: 40, h: 56, angle: a };
});
const layer = fakeEl();
const layerRect = { left: 0, top: 0 };
const pts = { middle: { x: 200, y: 430 }, muck: { x: 150, y: 520 }, line: { x: 200, y: 600 }, seat: { x: 200, y: 740 }, pot: { x: 205, y: 330 } };

for (const { id } of FOLD_STYLES.filter((s) => s.id !== 'each')) {
  test(`${id}: from the hand, smooth, gone at the end`, () => {
    runs.length = 0;
    const out = foldAway(reg, { style: id, set: 'B', rate: 0.5, layer, layerRect, cards: hand, ...pts, seed: 'h1:0:3:2' });
    assert.equal(out.length, hand.length, 'a ghost a card');
    for (const spec of runs) {
      const end = spec.end;
      assert.ok(end > 300 && end < 6000, `${id} lasts ${end}ms`);
      assert.ok(Math.abs(val(spec, 'x', 0)) < 0.5 && Math.abs(val(spec, 'y', 0)) < 0.5, `${id} starts where the card was`);
      assert.ok(val(spec, 'opacity', 0) > 0.99, `${id} starts opaque`);
      assert.ok(val(spec, 'opacity', end) < 0.01, `${id} is gone at the end`);
      // No jump: at 60 frames a second no frame moves a card more than 40px or turns it more than 25 degrees.
      let px = 0, deg = 0, sc = 0;
      for (let t = 0; t + 16.7 <= end; t += 16.7) {
        px = Math.max(px, Math.hypot(val(spec, 'x', t + 16.7) - val(spec, 'x', t), val(spec, 'y', t + 16.7) - val(spec, 'y', t)));
        deg = Math.max(deg, Math.abs(val(spec, 'rotate', t + 16.7) - val(spec, 'rotate', t)));
        sc = Math.max(sc, Math.abs(val(spec, 'scale', t + 16.7) - val(spec, 'scale', t)));
      }
      assert.ok(px < 40, `${id}: ${px.toFixed(1)}px in a frame`);
      assert.ok(deg < 25, `${id}: ${deg.toFixed(1)} degrees in a frame`);
      assert.ok(sc < 0.08, `${id}: scale ${sc.toFixed(3)} in a frame`);
    }
  });
}

test('the landing styles come to rest where they were sent', () => {
  const near = { spread: pts.pot, drop: pts.line, lob: pts.muck, flick: pts.pot, throw: pts.pot };
  for (const [id, to] of Object.entries(near)) {
    runs.length = 0;
    foldAway(reg, { style: id, set: 'B', rate: 0.5, layer, layerRect, cards: hand, ...pts, seed: 's' });
    runs.forEach((spec, i) => {
      // Just before the fade: the card's centre near the target (a spread, a skid or a scatter apart).
      const t = spec.end * 0.7;
      const x = hand[i].cx + val(spec, 'x', t), y = hand[i].cy + val(spec, 'y', t);
      assert.ok(Math.hypot(x - to.x, y - to.y) < 2 * 56, `${id} card ${i} rests ${Math.hypot(x - to.x, y - to.y).toFixed(0)}px off`);
    });
  }
});

test('Flicked gathers into a centred stack, then slides each card under the pot without turning it', () => {
  runs.length = 0;
  foldAway(reg, { style: 'flick', set: 'B', rate: 0.5, layer, layerRect, cards: hand, ...pts, seed: 'f' });
  // Gathered first (owner, 2026-11-28: "gather them together centered before the flicks"): a moment where all four are
  // one stack at the hand's middle (x 200), before any has gone.
  let stack = null;
  for (let t = 0; t <= runs[0].end && !stack; t += 4) {
    const ps = runs.map((spec, i) => ({ x: hand[i].cx + val(spec, 'x', t), y: hand[i].cy + val(spec, 'y', t) }));
    if (ps.every((p) => Math.hypot(p.x - ps[0].x, p.y - ps[0].y) < 1)) stack = { t, ...ps[0] };
  }
  assert.ok(stack && Math.abs(stack.x - 200) < 1, `one stack, centred (${stack && stack.x.toFixed(1)})`);
  runs.forEach((spec, i) => {
    // From the stack on, one tilt (the stack's), never turning on the way in.
    for (let t = stack.t; t <= spec.end; t += 16.7) assert.ok(Math.abs(val(spec, 'rotate', t) - val(spec, 'rotate', spec.end)) < 1, `card ${i} turned at ${t.toFixed(0)}ms`);
    const x = hand[i].cx + val(spec, 'x', spec.end * 0.7), y = hand[i].cy + val(spec, 'y', spec.end * 0.7);
    assert.ok(Math.abs(x - pts.pot.x) <= 0.25 * 40 + 0.5 && Math.abs(y - pts.pot.y) <= 0.15 * 56 + 0.5, `card ${i} rests on the pot (${x.toFixed(0)}, ${y.toFixed(0)})`);
  });
});

test('Spread: one flow, no pause, the row opening on the way, its top card ending on the pot, nothing turning', () => {
  runs.length = 0;
  foldAway(reg, { style: 'spread', set: 'B', rate: 0.5, layer, layerRect, cards: hand, ...pts, seed: 'sp' });
  const end = runs[0].end, at = (i, t) => ({ x: hand[i].cx + val(runs[i], 'x', t), y: hand[i].cy + val(runs[i], 'y', t) });
  const ends = runs.map((spec) => val(spec, 'rotate', spec.end));
  runs.forEach((spec, i) => {
    // From the stack (the gather has all but settled a third of the way in) to the end, one tilt, the same for every card.
    for (let t = spec.end / 3; t <= spec.end; t += 16.7) assert.ok(Math.abs(val(spec, 'rotate', t) - ends[0]) < 0.25, `card ${i} turned at ${t.toFixed(0)}ms`);
  });
  // The top card comes to rest on the pot (owner, 2026-11-28: "finish with the farthest card under the pot").
  const top = at(3, end * 0.7);
  assert.ok(Math.hypot(top.x - pts.pot.x, top.y - pts.pot.y) < 4, `the top card rests on the pot (${top.x.toFixed(0)}, ${top.y.toFixed(0)})`);
  // No pause ("a natural flow where the stack moves together and then spreads smoothly"): once the bottom card has set
  // off, it keeps moving until it is all but there, and the row is already opening while it travels.
  const rest = at(0, end * 0.7);
  let started = false, stalled = null, openWhileMoving = false;
  for (let t = 0; t + 16.7 <= end * 0.7; t += 16.7) {
    const a = at(0, t), b = at(0, t + 16.7), moved = Math.hypot(b.x - a.x, b.y - a.y), left = Math.hypot(rest.x - b.x, rest.y - b.y);
    if (!started && moved > 0.5) started = true;
    if (started && left > 3 && moved < 0.2 && stalled == null) stalled = t;
    if (started && left > 8) { const r3 = at(3, t); if (Math.hypot(r3.x - a.x, r3.y - a.y) > 6) openWhileMoving = true; }
  }
  assert.equal(stalled, null, `the stack stalls at ${stalled}ms before it is there`);
  assert.ok(openWhileMoving, 'the row opens while the stack is still travelling');
});

test('Spread lays its row on the way the stack went, from the seat toward the pot', () => {
  // An upright hand at the upper left, the pot down and to its right: the row must run on along the stack's own way out
  // (owner, 2026-11-28: "3 should spread in the direction that they leave the seat box toward the pot"), down and right,
  // its top card furthest along; it lay flat along the cards' width at first, then pointed at the middle.
  const corner = [0, 1, 2, 3].map((i) => ({ node: fakeEl(), cx: 40 + i * 14, cy: 300, w: 40, h: 56, angle: 0 }));
  const at = { ...pts, line: { x: 110, y: 340 } };
  runs.length = 0;
  foldAway(reg, { style: 'spread', set: 'B', rate: 0.5, layer, layerRect, cards: corner, ...at, seed: 'diag' });
  const rest = runs.map((spec, i) => ({ x: corner[i].cx + val(spec, 'x', spec.end * 0.7), y: corner[i].cy + val(spec, 'y', spec.end * 0.7) }));
  const row = { x: rest[3].x - rest[0].x, y: rest[3].y - rest[0].y };
  // The way out: from the stack (between the two middle cards, 61,300) to the pot (205,330).
  const out = { x: pts.pot.x - 61, y: pts.pot.y - 300 };
  const cos = (row.x * out.x + row.y * out.y) / (Math.hypot(row.x, row.y) * Math.hypot(out.x, out.y));
  assert.ok(cos > 0.99, `the row runs the way the stack went (cos ${cos.toFixed(4)})`);
  assert.ok(row.x > 10 && row.y > 3, `down and right, a diagonal (${row.x.toFixed(0)}, ${row.y.toFixed(0)})`);
  for (let i = 1; i < 4; i++) {
    const along = (r) => r.x * out.x + r.y * out.y;
    assert.ok(along(rest[i]) > along(rest[i - 1]), `card ${i} is further along than card ${i - 1}`);
  }
  // Only on, never back: the bottom card is on the way out, and the top card ends on the pot.
  const d = Math.hypot(out.x, out.y), off = (r) => Math.abs((r.x - 61) * out.y - (r.y - 300) * out.x) / d;
  assert.ok(off(rest[0]) < 4, `the bottom card is on the way out (${off(rest[0]).toFixed(1)}px off it)`);
  assert.ok(Math.hypot(rest[3].x - pts.pot.x, rest[3].y - pts.pot.y) < 4, `the top card is on the pot (${rest[3].x.toFixed(0)}, ${rest[3].y.toFixed(0)})`);
});

test('Lift and drop: the stack makes one half turn in the air', () => {
  runs.length = 0;
  foldAway(reg, { style: 'drop', set: 'B', rate: 0.5, layer, layerRect, cards: hand, ...pts, seed: 'half' });
  runs.forEach((spec, i) => {
    const r = val(spec, 'rotate', spec.end);
    // The hand's middle tilt is 0; the drop's own rest tilt is under 4 degrees.
    assert.ok(Math.abs(Math.abs(r) - 180) < 6, `card ${i} ends ${r.toFixed(1)} degrees round`);
    // And it turns while off the cloth: none of it once it has landed (from 85% of its time on).
    assert.ok(Math.abs(val(spec, 'rotate', spec.end * 0.85) - r) < 1, `card ${i} still turning after it landed`);
  });
});

test('Stud flip under: the up cards stack, turn face down, go under the down cards, and all go behind the seat', () => {
  // Sixth street as a row: two down, three up, a down; the up cards are faces (IMG), the down ones backs.
  const row = [0, 1, 2, 3, 4, 5].map((i) => ({ node: { ...fakeEl(), tagName: i >= 2 && i <= 4 ? 'IMG' : 'DIV' }, cx: 120 + i * 16, cy: 700, w: 40, h: 56, angle: 0 }));
  const up = row.slice(2, 5), down = [row[0], row[1], row[5]];
  runs.length = 0;
  const { ghosts, faceDownAt, flipAt } = studFlipUnder(reg, { set: 'B', rate: 0.5, layer, layerRect, up, down, seat: pts.seat });
  // flipAt is when the turn starts (the Dead cards strip turns its copies face up from then, on the same turn).
  assert.ok(flipAt > 0 && flipAt < faceDownAt && val(runs[0], 'scaleX', flipAt) === 1 && val(runs[0], 'scaleX', flipAt + 40) < 1, `the turn starts at flipAt (${flipAt.toFixed(0)}ms)`);
  assert.equal(ghosts.length, 6, 'a ghost a card');
  assert.ok(Math.max(...ghosts.slice(0, 3).map((g) => +g.style.zIndex)) < Math.min(...ghosts.slice(3).map((g) => +g.style.zIndex)), 'the up cards are drawn under the down ones');
  const all = [...up, ...down];
  runs.forEach((spec, i) => {
    const isUp = i < 3;
    // An up card turns over once, edge on at the half turn, and from then on is drawn as the back; a down card never.
    let minX = 1, at = 0;
    for (let t = 0; t <= spec.end; t += 4) { const v = val(spec, 'scaleX', t); if (v < minX) { minX = v; at = t; } }
    if (isUp) {
      assert.ok(minX < 0.05 && Math.abs(at - faceDownAt) < 12, `up card ${i} edge on (${minX.toFixed(3)}) at ${at}ms, the half turn at ${faceDownAt.toFixed(0)}`);
      const swap = spec.extras.find((x) => x.options.duration === faceDownAt);
      assert.ok(swap && swap.options.fill === 'forwards' && swap.frames[swap.frames.length - 1].objectPosition === '-999em -999em', `up card ${i} keeps the back from the half turn`);
    } else {
      assert.equal(minX, 1, `down card ${i} never turns`);
      assert.ok(!spec.extras.some((x) => x.options.duration === faceDownAt), `down card ${i} keeps its own face`);
    }
    // Gone behind the seat.
    const x = all[i].cx + val(spec, 'x', spec.end), y = all[i].cy + val(spec, 'y', spec.end);
    assert.ok(Math.hypot(x - pts.seat.x, y - pts.seat.y) < 2, `card ${i} ends on the seat`);
    assert.ok(val(spec, 'opacity', spec.end) < 0.01 && val(spec, 'scale', spec.end) < 0.1, `card ${i} shrunk to nothing`);
  });
  // Between the slide under and the tuck, the six are one stack.
  let together = false;
  for (let t = faceDownAt; t <= runs[0].end && !together; t += 8) {
    const ps = runs.map((spec, i) => ({ x: all[i].cx + val(spec, 'x', t), y: all[i].cy + val(spec, 'y', t) }));
    together = ps.every((p) => Math.hypot(p.x - ps[5].x, p.y - ps[5].y) < 2) && val(runs[0], 'opacity', t) > 0.95
      ? ps[0] : false;
  }
  assert.ok(together, 'the turned stack ends under the down stack, as one, before it goes');
  // At the seat's centre across (owner, 2026-11-28: "in the center of the seat box, not off to the left"): the seat is
  // at x 200, the hand's own middle at 152, the down cards' at 136.
  assert.ok(Math.abs(together.x - pts.seat.x) < 2, `they meet across from the seat's centre (x ${together.x.toFixed(1)})`);
  // The down cards wait (owner, 2026-11-28: "Don't push the downcards together until the upcard stack combines"): still
  // through the up cards' gather and turn, then moving from the same instant as the turned stack, closing as it slides in.
  const moved = (spec, t, from) => Math.hypot(val(spec, 'x', t) - val(spec, 'x', from), val(spec, 'y', t) - val(spec, 'y', from)) > 0.02;
  const firstMove = (spec, from) => { for (let t = from; t <= spec.end; t += 2) if (moved(spec, t, from)) return t; return Infinity; };
  for (const i of [3, 4, 5]) {
    for (let t = 0; t <= faceDownAt; t += 8) {
      assert.ok(Math.hypot(val(runs[i], 'x', t), val(runs[i], 'y', t)) < 0.01 && val(runs[i], 'rotate', t) === all[i].angle, `down card ${i} still at ${t}ms`);
    }
  }
  // The middle up card is the stack's own place (it does not move in the gather): its first move is the slide's.
  const tUp = firstMove(runs[1], faceDownAt + 1);
  // Card 5 sits where they meet (x 200) and has nowhere to go until the tuck; the other two set off with the stack.
  for (const i of [3, 4]) assert.ok(Math.abs(firstMove(runs[i], faceDownAt + 1) - tUp) <= 4, `down card ${i} starts with the turned stack (${tUp}ms)`);
});

test('Stud flip under, a fanned hand: the stack they make stands upright at the top of the fan arc', () => {
  // A seven-card fan round a pivot under the plaque, leaning right as a stud hand's can (its middle card at +6 degrees):
  // the down cards (1st, 2nd, 7th) close round that arc, and the one stack stands at 0 degrees, straight above the pivot
  // (owner, 2026-11-28: "along the natural radius, so that when they are combined into one stack they are exactly vertical").
  const P = { x: 200, y: 820 }, R = 90;
  const fan = [-12, -6, 0, 6, 12, 18, 24].map((a, i) => {
    const r = (a * Math.PI) / 180;
    return { node: { ...fakeEl(), tagName: i >= 2 && i <= 5 ? 'IMG' : 'DIV' }, cx: P.x + R * Math.sin(r), cy: P.y - R * Math.cos(r), w: 40, h: 56, angle: a };
  });
  const up = fan.slice(2, 6), down = [fan[0], fan[1], fan[6]];
  runs.length = 0;
  studFlipUnder(reg, { set: 'B', rate: 0.5, layer, layerRect, up, down, seat: { x: 200, y: 760 } });
  const all = [...up, ...down];
  // The stack at rest: the last moment before it starts for the seat (still opaque).
  let t1 = 0;
  for (let t = 0; t <= runs[0].end; t += 4) if (val(runs[0], 'opacity', t) > 0.999) t1 = t;
  const met = runs.map((spec, i) => ({ x: all[i].cx + val(spec, 'x', t1), y: all[i].cy + val(spec, 'y', t1), r: val(spec, 'rotate', t1) }));
  assert.ok(met.every((p) => Math.hypot(p.x - met[0].x, p.y - met[0].y) < 1), 'they make one stack');
  met.forEach((p, i) => assert.ok(Math.abs(p.r) < 0.5, `card ${i} stands at ${p.r.toFixed(2)} degrees`));
  assert.ok(Math.abs(met[0].x - P.x) < 1.5 && Math.abs(met[0].y - (P.y - R)) < 1.5, `at the top of the arc (${met[0].x.toFixed(1)}, ${met[0].y.toFixed(1)})`);
  // The 7th card goes round the arc, not across it: its distance from the pivot stays the fan's radius.
  const seven = runs[6];
  for (let t = 0; t <= runs[0].end * 0.6; t += 16.7) {
    const d = Math.hypot(fan[6].cx + val(seven, 'x', t) - P.x, fan[6].cy + val(seven, 'y', t) - P.y);
    assert.ok(Math.abs(d - R) < 1.5, `the 7th card keeps to the arc (${d.toFixed(1)} from the pivot at ${t.toFixed(0)}ms)`);
  }
});

test('Spin in ends under the pot', () => {
  // Owner, 2026-11-28: "1 should go under the pot as well" (it went to the middle of the felt).
  runs.length = 0;
  foldAway(reg, { style: 'spin', set: 'B', rate: 0.5, layer, layerRect, cards: hand, ...pts, seed: 's1' });
  runs.forEach((spec, i) => {
    const x = hand[i].cx + val(spec, 'x', spec.end), y = hand[i].cy + val(spec, 'y', spec.end);
    assert.ok(Math.hypot(x - pts.pot.x, y - pts.pot.y) < 1, `card ${i} ends on the pot (${x.toFixed(1)}, ${y.toFixed(1)})`);
  });
});

test('the same fold plays the same way (seeded)', () => {
  const play = () => { runs.length = 0; foldAway(reg, { style: 'throw', set: 'B', rate: 0.5, layer, layerRect, cards: hand, ...pts, seed: 'same' }); return runs.map((s) => [val(s, 'x', 400), val(s, 'rotate', 400)]); };
  assert.deepEqual(play(), play());
});

test('Each their own: one style a player, never Each', () => {
  const names = ['Ethan', 'Opp 2', 'A. Vuilleumier', 'Chino', 'seat 4', 'Daniel', 'Phil', 'Jen', 'Maria', 'Kai'];
  const got = new Set();
  for (const n of names) {
    const s = foldStyleOf('each', n);
    assert.notEqual(s, 'each');
    assert.equal(foldStyleOf('each', n), s, 'fixed by the name');
    assert.equal(foldStyleOf('each', n.toUpperCase()), s, 'whatever the case');
    got.add(s);
  }
  assert.ok(got.size >= 4, 'ten players fold more than a few ways');
  assert.equal(foldStyleOf('lob', 'Ethan'), 'lob');
  assert.equal(normalizeFoldStyle('nonsense'), 'spin');
  assert.equal(normalizeFoldStyle(null), 'spin');
});
