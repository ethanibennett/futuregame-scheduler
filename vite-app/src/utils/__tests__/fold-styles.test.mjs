// The Fold Motion styles (utils/replayer-card-moments.js foldAway, owner 2026-11-27): every style, played on a stub
// registry, starts each card where it was, moves without a jump, and is gone (opacity 0) at its end; the landing styles
// come to rest near where they were sent; Each their own gives a player one style, never itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOLD_STYLES, foldAway, foldStyleOf, normalizeFoldStyle } from '../replayer-card-moments.js';

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
const pts = { middle: { x: 200, y: 430 }, muck: { x: 150, y: 520 }, line: { x: 200, y: 600 }, seat: { x: 200, y: 740 } };

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
  const near = { spread: pts.muck, drop: pts.line, lob: pts.muck, flick: pts.muck, throw: pts.muck };
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
