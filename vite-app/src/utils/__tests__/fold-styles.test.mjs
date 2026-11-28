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
  const near = { spread: pts.line, drop: pts.line, lob: pts.muck, flick: pts.pot, throw: pts.pot };
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

test('Flicked slides each card under the pot without turning it', () => {
  runs.length = 0;
  foldAway(reg, { style: 'flick', set: 'B', rate: 0.5, layer, layerRect, cards: hand, ...pts, seed: 'f' });
  runs.forEach((spec, i) => {
    for (let t = 0; t <= spec.end; t += 16.7) assert.equal(val(spec, 'rotate', t), hand[i].angle, 'its own tilt throughout');
    const x = hand[i].cx + val(spec, 'x', spec.end * 0.7), y = hand[i].cy + val(spec, 'y', spec.end * 0.7);
    assert.ok(Math.abs(x - pts.pot.x) <= 0.25 * 40 + 0.5 && Math.abs(y - pts.pot.y) <= 0.15 * 56 + 0.5, `card ${i} rests on the pot (${x.toFixed(0)}, ${y.toFixed(0)})`);
  });
});

test('Spread stays on its own side and turns nothing once the stack is made', () => {
  runs.length = 0;
  foldAway(reg, { style: 'spread', set: 'B', rate: 0.5, layer, layerRect, cards: hand, ...pts, seed: 'sp' });
  const ends = runs.map((spec) => val(spec, 'rotate', spec.end));
  runs.forEach((spec, i) => {
    // From the stack (the gather has all but settled a third of the way in) to the end, one tilt, the same for every card.
    for (let t = spec.end / 3; t <= spec.end; t += 16.7) assert.ok(Math.abs(val(spec, 'rotate', t) - ends[0]) < 0.25, `card ${i} turned at ${t.toFixed(0)}ms`);
    const y = hand[i].cy + val(spec, 'y', spec.end * 0.7);
    assert.ok(y > pts.middle.y, `card ${i} crossed the middle (y ${y.toFixed(0)})`);
  });
});

test('Spread lays its row toward the middle, diagonally from a corner seat', () => {
  // An upright hand at the upper left, its betting line down and in from it: the row must run down and right, at the
  // middle, its top card nearest; it lay flat along the cards' width before.
  const corner = [0, 1, 2, 3].map((i) => ({ node: fakeEl(), cx: 40 + i * 14, cy: 300, w: 40, h: 56, angle: 0 }));
  const at = { ...pts, line: { x: 110, y: 340 } };
  runs.length = 0;
  foldAway(reg, { style: 'spread', set: 'B', rate: 0.5, layer, layerRect, cards: corner, ...at, seed: 'diag' });
  const rest = runs.map((spec, i) => ({ x: corner[i].cx + val(spec, 'x', spec.end * 0.7), y: corner[i].cy + val(spec, 'y', spec.end * 0.7) }));
  const row = { x: rest[3].x - rest[0].x, y: rest[3].y - rest[0].y };
  const C = { x: (rest[0].x + rest[3].x) / 2, y: (rest[0].y + rest[3].y) / 2 };
  const toMid = { x: pts.middle.x - C.x, y: pts.middle.y - C.y };
  const cos = (row.x * toMid.x + row.y * toMid.y) / (Math.hypot(row.x, row.y) * Math.hypot(toMid.x, toMid.y));
  assert.ok(cos > 0.97, `the row points at the middle (cos ${cos.toFixed(3)})`);
  assert.ok(row.x > 10 && row.y > 10, `and runs down and right, a diagonal (${row.x.toFixed(0)}, ${row.y.toFixed(0)})`);
  for (let i = 1; i < 4; i++) {
    const d = Math.hypot(pts.middle.x - rest[i].x, pts.middle.y - rest[i].y), d0 = Math.hypot(pts.middle.x - rest[i - 1].x, pts.middle.y - rest[i - 1].y);
    assert.ok(d < d0, `card ${i} is nearer the middle than card ${i - 1}`);
  }
  // Only toward the middle, never back: the bottom card rests where the stack lands, three quarters of the way from
  // the stack (between the two middle cards, 61,300) to the line.
  const land = { x: 61 + 0.75 * (110 - 61), y: 300 + 0.75 * (340 - 300) };
  assert.ok(Math.hypot(rest[0].x - land.x, rest[0].y - land.y) < 4, `the bottom card stays where the stack landed (${rest[0].x.toFixed(1)}, ${rest[0].y.toFixed(1)})`);
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
  const { ghosts, faceDownAt } = studFlipUnder(reg, { set: 'B', rate: 0.5, layer, layerRect, up, down, seat: pts.seat });
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
    together = ps.every((p) => Math.hypot(p.x - ps[5].x, p.y - ps[5].y) < 2) && val(runs[0], 'opacity', t) > 0.95;
  }
  assert.ok(together, 'the turned stack ends under the down stack, as one, before it goes');
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
