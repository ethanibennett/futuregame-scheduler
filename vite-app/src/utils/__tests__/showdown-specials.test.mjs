// Special showdowns: which win earns which moment, and the flush flood's simulation (utils/showdown-specials.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { showdownSpecial, simulateFlood, floodAt } from '../showdown-specials.js';
import { parseCardNotation as P, gameEvalFor } from '../poker-engine.js';

const special = (game, hero, others, board, heroPaid = true) =>
  showdownSpecial({ cfg: gameEvalFor(game), hero: P(hero), others: others.map(P), board: P(board), heroPaid });

test('a flush the hero wins at a showdown floods its suit', () => {
  assert.deepEqual(special('NLH', 'AhJh', ['KdQc'], 'Th9h4h2cJd'), { kind: 'flush', suit: 'h', name: 'Flush, Ace-high' });
  // Hi-lo: the high half is the flush's, the low went elsewhere.
  assert.equal(special('O8', 'AsKs9d9c', ['2c3dQhJh'], '7s4s8sKd5c').suit, 's');
  // Stud: seven cards, no board.
  assert.equal(special('Stud Hi', 'Ac9c4c7c2cKdKh', ['QsQdQh8d3s5d6h'], '').suit, 'c');
  // Omaha plays two from the hand: two diamonds and three on the board.
  assert.equal(special('PLO', 'AdKd2s3s', ['QcQs7h7c'], 'Td6d2dJh9c').suit, 'd');
});

test('no flood: not the hero, not a showdown, not better than every hand shown, or not a plain flush', () => {
  assert.equal(special('NLH', 'AhJh', ['KdQc'], 'Th9h4h2cJd', false), null, 'the hero was not paid');
  assert.equal(special('NLH', 'AhJh', [], 'Th9h4h2cJd'), null, 'everyone else folded: no showdown');
  assert.equal(special('NLH', 'AhJh', ['4d4c'], 'Th9h4h2c4s'), null, 'a full house shown beats it');
  assert.equal(special('NLH', '2c3d', ['5c6d'], 'AhKhQh9h7h'), null, 'the board\'s flush, chopped');
  assert.equal(special('NLH', '8h7h', ['AcAd'], '6h5h4h2c2d'), null, 'a straight flush is not a flush');
  // Omaha's one heart in hand cannot use the board's four.
  assert.equal(special('PLO', 'AhKs2c3d', ['QcQs7d7c'], 'Th6h2h5h9c'), null);
  assert.equal(special('Razz', 'Ac2c3c4c5cKdKh', ['QsQdQh8d3s5d6h'], ''), null, 'a low game');
  // A mucked hand (no cards) is beaten by any flush.
  assert.equal(special('NLH', 'AhJh', [''], 'Th9h4h2cJd').suit, 'h');
});

const TABLES = [
  { name: 'phone portrait', w: 330, h: 560, size: 30 },
  { name: 'desktop pane', w: 800, h: 470, size: 44 },
  { name: 'short landscape', w: 600, h: 360, size: 36 },
];

test('the flood is the same for the same hand and differs between hands', () => {
  const a = simulateFlood({ w: 330, h: 560, size: 30, seed: 'hand-1' });
  const b = simulateFlood({ w: 330, h: 560, size: 30, seed: 'hand-1' });
  const c = simulateFlood({ w: 330, h: 560, size: 30, seed: 'hand-2' });
  assert.deepEqual(a.bodies.map((x) => [x.born, ...x.x]), b.bodies.map((x) => [x.born, ...x.x]));
  assert.notDeepEqual(a.bodies.map((x) => x.x[10]), c.bodies.map((x) => x.x[10]));
});

for (const T of TABLES) {
  test(`the flood on a ${T.name} table stays inside the rail, moves smoothly and comes to rest`, () => {
    const sim = simulateFlood({ ...T, seed: T.name });
    const R = Math.min(T.w, T.h) / 2;
    assert.ok(sim.bodies.length >= 40, 'a flood: ' + sim.bodies.length);
    assert.ok(sim.settledAt != null && sim.settledAt < sim.fadeAt, 'at rest before the fade: ' + sim.settledAt);
    const frame = 1000 / 60;
    for (const b of sim.bodies) {
      const r = b.d * 0.46;
      let prev = floodAt(sim, b, b.born);
      for (let t = b.born + frame; t <= sim.end; t += frame) {
        const p = floodAt(sim, b, t);
        const move = Math.hypot(p.x - prev.x, p.y - prev.y);
        // The smooth audit's jump is 24px a frame and its fast start 10px from rest.
        assert.ok(move < 18, `${T.name}: ${move.toFixed(1)}px in a frame at ${t.toFixed(0)}ms`);
        assert.ok(Math.abs(p.a - prev.a) < 3.5, `${T.name}: turned ${Math.abs(p.a - prev.a).toFixed(1)} degrees in a frame`);
        if (sim.settledAt != null && t > sim.settledAt + frame) assert.equal(move, 0, `${T.name}: moved after the flood came to rest`);
        // Inside the pill: the centre is within the box less the radius, corners rounded.
        const qx = Math.abs(p.x - T.w / 2) - (T.w / 2 - R), qy = Math.abs(p.y - T.h / 2) - (T.h / 2 - R);
        const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - (R - r);
        assert.ok(out < 0.75, `${T.name}: ${out.toFixed(2)}px past the rail`);
        prev = p;
      }
    }
    // At rest, no symbol sits in another.
    const fin = sim.bodies.map((b) => ({ ...floodAt(sim, b, sim.end), r: b.d * 0.46 }));
    for (let i = 0; i < fin.length; i++) for (let j = i + 1; j < fin.length; j++) {
      const over = fin[i].r + fin[j].r - Math.hypot(fin[i].x - fin[j].x, fin[i].y - fin[j].y);
      assert.ok(over < 1.5, `${T.name}: two symbols overlap by ${over.toFixed(2)}px`);
    }
  });
}
