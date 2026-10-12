// node --test src/utils/__tests__/replayer-motion.test.mjs  (from vite-app/)
// The spring registry (utils/replayer-motion.js) against fake elements: one spring per element,
// a retarget continues from where the element is with its velocity, arrivals land on time or when
// the moment is finished early, capture mode waits for seeks, and a wager's push is shortened to
// clear its seat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionRegistry, clearPush } from '../replayer-motion.js';
import { tierSpring, composeAt } from '../spring.js';

// No browser: no CSS.supports, so the registry samples keyframes (the form every engine runs).
globalThis.window = { matchMedia: () => ({ matches: false }) };

function fakeEl() {
  const el = {
    anims: [],
    parentNode: null,
    animate(frames, options) {
      const a = {
        frames, options, currentTime: 0, paused: false, cancelled: false, onfinish: null,
        pause() { this.paused = true; }, cancel() { this.cancelled = true; },
      };
      el.anims.push(a);
      return a;
    },
  };
  return el;
}

test('run: one spring per element; a new one replaces the old', () => {
  const reg = new MotionRegistry();
  const el = fakeEl();
  const sp = tierSpring('A', 'yield');
  reg.run(el, { channels: [{ prop: 'x', spring: sp, from: 20, to: 0 }], size: { w: 35, h: 42 } });
  reg.run(el, { channels: [{ prop: 'x', spring: sp, from: 10, to: 0 }], size: { w: 35, h: 42 } });
  assert.equal(el.anims.length, 2);
  assert.ok(el.anims[0].cancelled, 'the first was cancelled');
  assert.equal(reg.entries.size, 1);
  // Never fill: forwards. Delayed starts fill backwards.
  assert.equal(el.anims[1].options.fill, 'none');
  reg.run(el, { channels: [{ prop: 'x', spring: sp, from: 10, to: 0, delay: 40 }], size: { w: 35, h: 42 } });
  assert.equal(el.anims[2].options.fill, 'backwards');
  assert.equal(el.anims[2].options.delay, 40);
});

test('state and continuation: a retarget starts where the element is, with its velocity', () => {
  const reg = new MotionRegistry();
  const el = fakeEl();
  const hand = tierSpring('A', 'hand');
  const chans = [
    { prop: 'x', spring: hand, from: -73.38, to: 0, delay: 220 },
    { prop: 'y', spring: hand, from: -6.2, to: 0 },
    { prop: 'scale', spring: hand, from: 1.08, to: 1 },
  ];
  reg.run(el, { channels: chans, size: { w: 35, h: 42 } });
  el.anims[0].currentTime = 300;      // 80ms into the spread
  const s = reg.state(el);
  const v = composeAt(chans, 300);
  assert.ok(Math.abs(s.val.x - v.x) < 1e-9 && Math.abs(s.val.y - v.y) < 1e-9);
  assert.ok(s.vel.x > 400, 'moving right fast: ' + s.vel.x.toFixed(0) + 'px/s');
  const cont = reg.continuation(el, ['x']);
  assert.deepEqual(cont.map(c => c.prop).sort(), ['scale', 'y']);
  for (const c of cont) {
    // Continuation channels start exactly at the current value and carry the current velocity.
    assert.ok(Math.abs(c.from - s.val[c.prop]) < 1e-9, c.prop + ' from');
    const vNow = (c.to - c.from) * c.spring.velocityAt(0);
    assert.ok(Math.abs(vNow - s.vel[c.prop]) < Math.max(0.05, Math.abs(s.vel[c.prop]) * 0.01), `${c.prop} velocity ${vNow} vs ${s.vel[c.prop]}`);
  }
  // Past its end it is at rest: nothing to hand over.
  el.anims[0].currentTime = 5000;
  assert.equal(reg.state(el), null);
});

test('ticks: land at their time; finishing early lands them all, in order, and settles once', async () => {
  const reg = new MotionRegistry();
  const landed = [];
  let settled = 0;
  reg.onSettled = () => { settled++; };
  reg.tick(30, () => landed.push('a'));
  reg.tick(10, () => landed.push('b'));
  reg.tick(500, () => landed.push('c'));
  await new Promise(r => setTimeout(r, 60));
  assert.deepEqual(landed, ['b', 'a']);
  assert.equal(settled, 0, 'not settled while one is still in flight');
  reg.finishAll();
  assert.deepEqual(landed, ['b', 'a', 'c']);
  assert.equal(settled, 1, 'one render after the last arrival');
  assert.equal(reg.ticks.length, 0);
});

test('capture: springs are created paused, arrivals wait for a seek, finishAll removes ghosts', () => {
  const reg = new MotionRegistry();
  reg.setCapture(true, { rate: 1 });
  const parent = { removed: [], removeChild(c) { this.removed.push(c); c.parentNode = null; } };
  const ghost = fakeEl(); ghost.parentNode = parent;
  const sp = tierSpring('A', 'hand');
  const entry = reg.run(ghost, {
    channels: [{ prop: 'x', spring: sp, from: 0, to: 200 }, { prop: 'opacity', ramp: { from: 1, to: 0, delay: 193, duration: 80 } }],
    size: { w: 30, h: 20 }, end: 273, transient: true,
  });
  assert.ok(ghost.anims[0].paused, 'created paused');
  let pot = 0;
  reg.tick(193, () => { pot += 15000; }, entry);
  assert.equal(reg.extentMs(), 273);
  reg.seek(100);
  assert.equal(ghost.anims[0].currentTime, 100);
  assert.equal(pot, 0, 'not landed at 100ms');
  reg.seek(200);
  assert.equal(pot, 15000, 'landed by 200ms');
  reg.finishAll();
  assert.equal(parent.removed.length, 1, 'the ghost left the felt');
  assert.equal(reg.extentMs(), 0);
  reg.setCapture(false);
  assert.equal(reg.capture, false);
});

test('extent: an export spends frames to visible rest (0.5px), not to the 0.1% settle', () => {
  const reg = new MotionRegistry();
  const el = fakeEl();
  const flick = tierSpring('A', 'flick');
  // The push-out: 19.1px on flick. Its 1.5% overshoot is 0.3px, so it is at rest around t95.
  reg.run(el, { channels: [{ prop: 'x', spring: flick, from: 0, to: 0 }, { prop: 'y', spring: flick, from: 19.1, to: 0 }], size: { w: 60, h: 20 }, prefix: 'translate(-50%, -50%)' });
  const ext = reg.extentMs();
  assert.ok(ext >= 100 && ext <= 170, 'push-out at rest by ' + ext + 'ms');
  // The flop's window card: 73px on hand from 280ms, whose 1.1px overshoot is visible.
  const card = fakeEl();
  const hand = tierSpring('A', 'hand');
  reg.run(card, { channels: [{ prop: 'x', spring: hand, from: -73.38, to: 0, delay: 280 }], size: { w: 35, h: 42 } });
  const ext2 = reg.extentMs();
  assert.ok(ext2 >= 600 && ext2 <= 680, 'window card at rest by ' + ext2 + 'ms (spec: about 633)');
});

test('clearPush: full distance when clear, shortened when the start would touch the seat', () => {
  const box = { left: 100, right: 160, top: 300, bottom: 320 };
  const up = { x: 0, y: 1 };                       // toward a seat below
  assert.equal(clearPush(box, up, 19.1, [{ left: 90, right: 170, top: 400, bottom: 440 }]), 19.1);
  const cards = { left: 90, right: 170, top: 330, bottom: 380 };   // 10px below the wager
  const p = clearPush(box, up, 19.1, [cards]);
  assert.ok(p > 0 && p < 10, 'shortened to clear: ' + p);
  assert.equal(clearPush(box, up, 19.1, [{ left: 90, right: 170, top: 310, bottom: 380 }]), 0, 'already touching: no push');
});
