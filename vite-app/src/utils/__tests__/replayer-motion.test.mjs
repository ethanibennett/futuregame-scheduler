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

/* ── Round 1 of review ── */
import { planSweep, seatLanding, segmentInRect, unionRect, shipFirstArrival, yieldBoard, shipStartAfterSweep, emptyPile, settlePile } from '../replayer-motion.js';
import { SPRING_SETS } from '../spring.js';
import { keyframes as kfOf, timeTo as timeToOf, channelEnd } from '../spring.js';

function delayedEl() {
  // An element whose animations start only when the test says so (a long press frame).
  const el = fakeEl();
  const base = el.animate;
  el.animate = function (frames, options) {
    const a = base.call(this, frames, options);
    a.startTime = null;
    a.ready = new Promise(res => { a._start = () => { a.startTime = 0; res(a); }; });
    return a;
  };
  return el;
}

test('timers count from the animation\'s real start, not from its creation', async () => {
  const reg = new MotionRegistry();
  const parent = { removed: [], removeChild(c) { this.removed.push(c); c.parentNode = null; } };
  const ghost = delayedEl(); ghost.parentNode = parent;
  const sp = tierSpring('A', 'hand');
  const entry = reg.run(ghost, {
    channels: [{ prop: 'x', spring: sp, from: 0, to: 200 }, { prop: 'opacity', ramp: { from: 1, to: 0, delay: 40, duration: 20 } }],
    size: { w: 30, h: 20 }, end: 60, transient: true,
  });
  let landed = 0;
  reg.tick(40, () => { landed++; }, entry);
  // The press frame runs long: 150ms pass before the animation gets its start time.
  await new Promise(r => setTimeout(r, 150));
  assert.equal(landed, 0, 'no arrival before the flight has started');
  assert.equal(parent.removed.length, 0, 'no removal before the flight has started');
  ghost.anims[0]._start();
  await new Promise(r => setTimeout(r, 15));
  assert.equal(landed, 0, 'not at 15ms of a 40ms flight');
  await new Promise(r => setTimeout(r, 60));
  assert.equal(landed, 1, 'landed at its time from the real start');
  await new Promise(r => setTimeout(r, 80));
  assert.equal(parent.removed.length, 1, 'removed after its end, from the real start');
});

test('sweep plan: chips land on their own colour\'s stack of the pile as it will be', () => {
  const reg = new MotionRegistry();
  // Two stacks after the first wager lands: [orange, yellow], pitch 10, centred on 200.
  const stacksFor = (amt) => (amt >= 18000 ? [{ color: 'O' }, { color: 'Y' }] : [{ color: 'Y' }]);
  const geo = { cx: 200, cy: 400, w: 60, h: 20, chip: { dx: -20, dy: 0, w: 12, h: 14 } };
  const plan = planSweep(reg, {
    set: 'A', wagers: [{ seat: 0, amount: 15000, el: fakeEl(), geo, topColor: 'O' }],
    pile: { cx: 200, cy: 150, bottom: 160, pitch: 10, base: 3000, stacksFor },
  });
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0].start, { x: 180, y: 400 }, 'from the chips, not the pill');
  assert.equal(plan[0].target.x, 195, 'the orange stack: left of centre by half a pitch');
  assert.equal(plan[0].target.y, 153, 'chips bottom on the pile bottom');
  assert.ok(Math.abs(plan[0].arrive - timeToOf(tierSpring('A', 'hand'), 0.98)) < 1e-9);
});

test('sweep plan: a path over the board holds the board until the chips have cleared it', () => {
  const reg = new MotionRegistry();
  const geo = { cx: 200, cy: 500, w: 60, h: 20, chip: { dx: 0, dy: 0, w: 12, h: 14 } };
  const board = { left: 120, right: 280, top: 300, bottom: 360 };
  const [p] = planSweep(reg, {
    set: 'A', wagers: [{ seat: 0, amount: 5000, el: fakeEl(), geo, topColor: 'O' }],
    pile: { cx: 200, cy: 150 }, board,
  });
  assert.ok(p.crosses, 'straight up through the board');
  // It clears the board's top (plus half a chip) at y = 293: progress (500 - 293) / 350.
  const want = timeToOf(tierSpring('A', 'hand'), (500 - 293) / 350);
  assert.ok(Math.abs(p.clear - want) < 0.5, `clears at ${p.clear} (want ${want})`);
  const [q] = planSweep(reg, {
    set: 'A', wagers: [{ seat: 1, amount: 5000, el: fakeEl(), geo: { ...geo, cx: 40, cy: 120 }, topColor: 'O' }],
    pile: { cx: 200, cy: 150 }, board,
  });
  assert.equal(q.crosses, false, 'a top seat\'s path never meets the board');
});

test('seat landing: on the plaque edge nearest the pile, clear of the cards, the button and the name', () => {
  const disk = (c, r, b) => c.x + r > b.left && c.x - r < b.right && c.y + r > b.top && c.y - r < b.bottom;
  const pile = { x: 200.6, y: 277.6 };
  // The hero at 402x874 (8-max seat 5), measured: the cards hang over the middle of the plaque's top
  // edge and the button sits on its top-left corner.
  const plaque = { left: 149.5, top: 650, right: 252.2, bottom: 693.1 };
  const cards = [{ left: 168.9, top: 602.8, right: 214.1, bottom: 664.1 }, { left: 187, top: 602.8, right: 234.5, bottom: 667.2 }];
  const button = { left: 142, top: 642.5, right: 159.4, bottom: 659.9 };
  const name = { left: 189.4, top: 653.1, right: 212.2, bottom: 668.1 };
  const cardsBox = unionRect(cards);
  const hero = seatLanding(pile, plaque, { cards, button, name, chipD: 12, covers: [cardsBox, button] });
  assert.equal(hero.edge, 'top');
  assert.ok(hero.contact.x > 234.5 + 6 && hero.contact.x <= 252.2 - 6, 'the free shoulder right of the cards: ' + hero.contact.x);
  assert.ok(Math.abs(hero.y - (650 + 6)) < 1e-9, 'half a chip under the edge');
  for (const c of cards) assert.ok(!disk(hero.contact, 6, c), 'touches no card');
  assert.ok(!disk({ x: hero.x, y: hero.y }, 6, name), 'never on the name');
  // The straight path to it (until it reaches the edge) never runs under the cards.
  const reach = { x: hero.contact.x, y: hero.contact.y - 7 };
  const span = segmentInRect(pile, reach, { left: cardsBox.left - 6, right: cardsBox.right + 6, top: cardsBox.top - 6, bottom: cardsBox.bottom + 6 });
  assert.ok(!span || (span[1] - span[0]) * Math.hypot(reach.x - pile.x, reach.y - pile.y) < 1.5, 'clear of the cards on the way');
  // A right-hand seat below the pile (8-max seat 4): the plaque's corner nearest the pile, beside
  // the cards, on the edge facing it.
  const p4 = { left: 304.1, top: 512.6, right: 391, bottom: 552.1 };
  const c4 = [{ left: 321.4, top: 473.9, right: 358.4, bottom: 524.2 }, { left: 336.3, top: 473.9, right: 375.2, bottom: 526.6 }];
  const s4 = seatLanding(pile, p4, { cards: c4, chipD: 12, covers: [unionRect(c4)], name: { left: 333.6, top: 515.7, right: 361.6, bottom: 530.7 } });
  assert.ok(s4.edge === 'top' || s4.edge === 'left', s4.edge);
  assert.ok(s4.contact.x < 321.4 - 6 + 1e-9, 'left of the cards: ' + JSON.stringify(s4.contact));
  // A top seat (8-max seat 1): the hand's name hangs under the bottom edge's middle, so the chip
  // lands on the bottom edge beside it.
  const p1 = { left: 157.5, top: 72.6, right: 244.4, bottom: 112.2 };
  const hn = { left: 179, top: 114.1, right: 223, bottom: 134.8 };
  const c1 = [{ left: 174.7, top: 33.9, right: 211.8, bottom: 84.2 }, { left: 189.7, top: 33.9, right: 228.6, bottom: 86.7 }];
  const s1 = seatLanding(pile, p1, { cards: c1, chipD: 12, covers: [unionRect(c1), hn], name: { left: 187, top: 75.7, right: 214.9, bottom: 90.7 } });
  assert.equal(s1.edge, 'bottom');
  assert.ok(s1.contact.x + 6 <= hn.left + 0.5 || s1.contact.x - 6 >= hn.right - 0.5, 'beside the hand name: ' + s1.contact.x);
  assert.deepEqual(segmentInRect({ x: 0, y: 0 }, { x: 10, y: 0 }, { left: 2, right: 4, top: -1, bottom: 1 }), [0.2, 0.4]);
  assert.equal(segmentInRect({ x: 0, y: 5 }, { x: 10, y: 5 }, { left: 2, right: 4, top: -1, bottom: 1 }), null);
  assert.deepEqual(unionRect([{ left: 0, right: 2, top: 0, bottom: 2 }, { left: 1, right: 5, top: -1, bottom: 1 }, { left: 3, right: 3, top: 0, bottom: 0 }]),
    { left: 0, right: 5, top: -1, bottom: 2 });
});

test('capture: a moment\'s clock starts at 0, whatever the last moment was seeked to', () => {
  const reg = new MotionRegistry();
  reg.setCapture(true, { rate: 1, fps: 24 });
  const hand = tierSpring('A', 'hand');
  // The flop: seeked to 625ms, then finished as the step's still.
  reg.beginMoment('street');
  const a = fakeEl();
  reg.run(a, { channels: [{ prop: 'x', spring: hand, from: -73, to: 0, delay: 210 }], size: { w: 35, h: 42 } });
  for (let t = 0; t <= 625; t += 1000 / 24) reg.seek(t);
  reg.finishAll();
  // The turn: a second moment. Its springs start at 0 on its own clock.
  reg.beginMoment('street');
  const b = fakeEl();
  const e = reg.run(b, { channels: [{ prop: 'x', spring: tierSpring('A', 'yield'), from: 18, to: 0, delay: 40 }], size: { w: 35, h: 42 } });
  assert.equal(e.t0, 0);
  assert.ok(reg.extentMs() < 320, 'its own extent: ' + reg.extentMs());
  reg.seek(100);
  assert.equal(b.anims[0].currentTime, 100);
});

test('capture: finishing lands springs that arrivals start, and a seek lands arrivals first', () => {
  const reg = new MotionRegistry();
  reg.setCapture(true, { rate: 1 });
  reg.beginMoment('street');
  const ghost = fakeEl();
  ghost.parentNode = { removeChild(c) { c.parentNode = null; } };
  const sp = tierSpring('A', 'hand');
  const entry = reg.run(ghost, { channels: [{ prop: 'x', spring: sp, from: 0, to: 100 }], size: { w: 12, h: 12 }, end: 243, transient: true });
  const stack = fakeEl();
  let born = null;
  reg.tick(193, () => {
    // The pile makes room for the landed wager: a spring born at the arrival.
    born = reg.run(stack, { channels: [{ prop: 'x', spring: tierSpring('A', 'yield'), from: 9, to: 0 }], size: { w: 12, h: 30 } });
  }, entry);
  reg.seek(250);
  assert.ok(born, 'the arrival ran');
  assert.equal(born.t0, 193, 'born at the arrival');
  assert.ok(Math.abs(stack.anims[0].currentTime - 57) < 1e-9, 'positioned at 250 - 193 in the same seek');
  reg.finishAll();
  assert.equal(reg.entries.size, 0, 'nothing left paused');
  assert.ok(stack.anims[0].cancelled, 'the stack is at rest');
});

test('settle: the one render waits until nothing is moving', async () => {
  const reg = new MotionRegistry();
  let settled = 0;
  reg.onSettled = () => { settled++; };
  const card = fakeEl();
  reg.run(card, { channels: [{ prop: 'x', spring: tierSpring('A', 'slide'), from: -70, to: 0, delay: 200 }], size: { w: 35, h: 42 } });
  reg.tick(0, () => {});
  await new Promise(r => setTimeout(r, 20));
  assert.equal(settled, 0, 'the arrival landed, but a card is still spreading');
  card.anims[0].onfinish();
  assert.equal(settled, 1, 'one render once the board is still');
});

test('yield: one start for the row; a moving card takes the whole row with it', () => {
  const reg = new MotionRegistry();
  const rect = { width: 35, height: 49 };
  const [k, s, n, t] = [fakeEl(), fakeEl(), fakeEl(), fakeEl()];
  // The flop's middle card is still spreading: it has a running spring.
  reg.run(s, { channels: [{ prop: 'x', spring: tierSpring('A', 'slide'), from: -36, to: 0 }], size: { w: 35, h: 49 } });
  s.anims[0].currentTime = 60;
  const t0 = yieldBoard(reg, {
    set: 'A', tYield: 90,
    stayed: [{ el: k, rect, from: 18.3 }, { el: s, rect, from: 18.3 - 20 }, { el: n, rect, from: 18.3 }],
    added: [{ el: t, rect }],
  });
  assert.equal(t0, 0, 'no wait while a card moves');
  for (const el of [k, n]) assert.equal(el.anims[el.anims.length - 1].options.delay || 0, 0, 'every card starts at once');
  // At rest, the row waits for the crossing chips, all of it.
  const reg2 = new MotionRegistry();
  const [a, b, c] = [fakeEl(), fakeEl(), fakeEl()];
  const t1 = yieldBoard(reg2, { set: 'A', tYield: 90, stayed: [{ el: a, rect, from: 18.3 }, { el: b, rect, from: 18.3 }], added: [{ el: c, rect }] });
  assert.equal(t1, 90);
  for (const el of [a, b]) assert.equal(el.anims[0].options.delay, 90);
});

test('sweep plan: a wager crossing the board leaves first', () => {
  const reg = new MotionRegistry();
  const board = { left: 120, right: 280, top: 300, bottom: 360 };
  const top = { cx: 100, cy: 120, w: 60, h: 20, chip: { dx: 0, dy: 0, w: 12, h: 14 } };
  const bottom = { cx: 200, cy: 500, w: 60, h: 20, chip: { dx: 0, dy: 0, w: 12, h: 14 } };
  const plan = planSweep(reg, {
    set: 'A', board, pile: { cx: 200, cy: 150 },
    wagers: [{ seat: 1, amount: 5000, el: fakeEl(), geo: top, topColor: 'O' }, { seat: 5, amount: 5000, el: fakeEl(), geo: bottom, topColor: 'O' }],
  });
  assert.equal(plan[0].w.seat, 5, 'the bottom seat, whose path crosses the board, goes first');
  assert.ok(plan[0].crosses && !plan[1].crosses);
  assert.equal(plan[0].d, 0);
});

test('the ship leaves once the river\'s wagers have landed and faded', () => {
  assert.equal(shipStartAfterSweep('A', 1, 0), 0);
  const two = shipStartAfterSweep('A', 1, 2);
  near(two, 40 + timeToOf(tierSpring('A', 'hand'), 0.98) + 50, 1e-9, 'two wagers');
  near(shipStartAfterSweep('A', 2, 2), two / 2, 1e-9, 'at 4x');
});

test('the winner\'s plaque takes its gold at the first shipped chip\'s arrival, at any rate', () => {
  near(shipFirstArrival('A', 1), timeToOf(tierSpring('A', 'arm'), 0.98), 1e-9, 'A at 1x');
  near(shipFirstArrival('A', 2), shipFirstArrival('A', 1) / 2, 1e-9, 'A at 4x');
});

test('keyframes end exactly at rest, and a small channel settles to its own tolerance', () => {
  const inertia = tierSpring('A', 'inertia');
  const ch = [{ prop: 'rotate', spring: inertia, from: 2.5, to: 0 }, { prop: 'x', spring: tierSpring('A', 'hand'), from: 18, to: 0 }];
  const k = kfOf(ch, { size: { w: 35, h: 49 }, tolPx: 0.1, reducedMotion: false });
  const last = k.keyframes[k.keyframes.length - 1].transform;
  assert.equal(last, 'translate(0px, 0px) rotate(0deg)', 'exact rest: ' + last);
  // 2.5 degrees on a 35x49 card is 0.66px at its corners: settled to 0.1px, not ridden to 1%.
  const w = Math.hypot(35, 49) / 2 * Math.PI / 180;
  const endRot = channelEnd(ch[0], w, 0.1);
  assert.ok(endRot < 420, 'the squaring is done by ' + endRot.toFixed(0) + 'ms');
});

test('stretch: a flight smears along its axis and nets no turn', () => {
  const k = kfOf([
    { prop: 'x', spring: tierSpring('A', 'arm'), from: 0, to: 300 },
    { prop: 'stretch', fn: (t) => (t > 0 && t < 200 ? 1.5 : 1), end: 250 },
  ], { size: { w: 12, h: 12 }, axis: 30, reducedMotion: false, end: 300 });
  const mid = k.keyframes.find(f => / scale\(1\.5, /.test(f.transform));
  assert.ok(mid, 'stretched mid-flight');
  assert.match(mid.transform, /rotate\(30deg\) scale\(1\.5, 0\.8165\) rotate\(-30deg\)$/);
});

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('sweep plan: every ghost lands on the pile as it will be, never on a composition in between', () => {
  const reg = new MotionRegistry();
  // The turn of the 8-max hand: 38,000 is [teal, orange, gold], 50,000 one stack, 62,000 the three
  // again. Following the running total, the first ghost aimed at a one-stack row.
  const stacksFor = (amt) => (amt === 50000 ? [{ color: 'T' }] : [{ color: 'T' }, { color: 'O' }, { color: 'G' }]);
  const geo = (cx, cy) => ({ cx, cy, w: 60, h: 20, chip: { dx: 0, dy: 0, w: 12, h: 14 } });
  const plan = planSweep(reg, {
    set: 'A', wagers: [
      { seat: 5, amount: 12000, el: fakeEl(), geo: geo(200, 500), topColor: 'O' },
      { seat: 2, amount: 12000, el: fakeEl(), geo: geo(320, 200), topColor: 'O' },
    ],
    pile: { cx: 200, cy: 150, bottom: 160, pitch: 10, base: 38000, stacksFor, colors: ['T', 'O', 'G'] },
  });
  assert.deepEqual(plan.final.colors, ['T', 'O', 'G']);
  assert.deepEqual(plan.final.fresh, [], 'nothing new on the pile');
  for (const p of plan) {
    assert.equal(p.target.x, 200, 'the orange stack, the middle of three: ' + p.target.x);
    assert.equal(p.color, 'O');
  }
});

test('sweep plan: a new stack never appears without a ghost under it when one can bring it', () => {
  const reg = new MotionRegistry();
  // 3,000 is one gold stack; 38,000 is [teal, orange, gold]. The wagers' top chips are orange and
  // red: red is not on the final pile, so that ghost brings the new teal stack.
  const stacksFor = (amt) => (amt >= 38000 ? [{ color: 'T' }, { color: 'O' }, { color: 'G' }] : [{ color: 'G' }]);
  const geo = { cx: 200, cy: 500, w: 60, h: 20, chip: { dx: 0, dy: 0, w: 12, h: 14 } };
  const plan = planSweep(reg, {
    set: 'A', wagers: [
      { seat: 1, amount: 20000, el: fakeEl(), geo, topColor: 'O' },
      { seat: 2, amount: 15000, el: fakeEl(), geo, topColor: 'R' },
    ],
    pile: { cx: 200, cy: 150, bottom: 160, pitch: 10, base: 3000, stacksFor, colors: ['G'] },
  });
  assert.deepEqual(plan.final.fresh, ['T', 'O']);
  assert.equal(plan[0].color, 'O');
  assert.equal(plan[0].target.x, 200);
  assert.equal(plan[1].color, 'T', 'the red ghost brings the teal stack');
  assert.equal(plan[1].target.x, 190);
  assert.deepEqual(plan.final.unclaimed, [], 'every new stack has a ghost');
});

test('seat landing: half a chip of room from the cards and the button, there and on the way in, where the plaque has it', () => {
  const pile = { x: 720, y: 330 };
  // Desktop hero (8-max at 1440x900, rounded): the button on the plaque's top-left corner leaves a
  // gap of exactly one chip before the first card; the top edge right of the cards is roomy.
  const plaque = { left: 640, top: 672, right: 800, bottom: 730 };
  const button = { left: 632, top: 660, right: 656, bottom: 684 };
  const cards = [{ left: 670, top: 600, right: 730, bottom: 690 }, { left: 700, top: 600, right: 762, bottom: 694 }];
  const name = { left: 690, top: 678, right: 750, bottom: 700 };
  const c = seatLanding(pile, plaque, { cards, button, name, chipD: 14, covers: [unionRect(cards), button] });
  assert.equal(c.edge, 'top');
  assert.ok(c.contact.x >= 762 + 14 - 1e-9, 'the roomy shoulder right of the cards, not the crevice: ' + c.contact.x);
  assert.ok(c.room >= 7 - 1e-9, 'half a chip of room: ' + c.room);
  // The phone hero: no landing has half a chip of room (the cards leave an 18px shoulder), so the
  // pot lands as far from the cards as the shoulder goes, its way in at most grazing the corner of
  // the last card.
  const ph = seatLanding({ x: 200.6, y: 277.6 }, { left: 149.5, top: 650, right: 252.2, bottom: 693.1 }, {
    cards: [{ left: 168.9, top: 602.8, right: 214.1, bottom: 664.1 }, { left: 187, top: 602.8, right: 234.5, bottom: 667.2 }],
    button: { left: 142, top: 642.5, right: 159.4, bottom: 659.9 }, name: { left: 189.4, top: 653.1, right: 212.2, bottom: 668.1 }, chipD: 12,
  });
  assert.ok(ph.contact.x >= 252.2 - 6 - 1e-9 && ph.contact.x - 6 - 234.5 >= 5, 'the far end of the shoulder: ' + JSON.stringify(ph));
  assert.ok(ph.room > -1, 'grazing the card on the way in by under a pixel: ' + ph.room);

});

test('the ship: a handful that leaves within 24ms and lands within 35ms, and each stack goes in a frame', () => {
  for (const set of ['A', 'B']) {
    const st = SPRING_SETS[set].stage;
    const arr = [0, 1, 2, 3, 4].map(i => i * st.shipStagger + timeToOf(tierSpring(set, st.shipTiers[i]), 0.98));
    assert.ok((4 * st.shipStagger) <= 24, set + ' all five leave within 24ms');
    assert.ok(Math.max(...arr) - Math.min(...arr) <= 35, set + ' land within 35ms: ' + arr.map(Math.round));
    for (const t of ['armLight', 'armHeavy']) near(tierSpring(set, t).zeta, tierSpring(set, 'arm').zeta, 0.005, set + ' ' + t + ' keeps the damping ratio');
  }
  const reg = new MotionRegistry();
  const els = [fakeEl(), fakeEl(), fakeEl()];
  emptyPile(reg, { set: 'A', stacks: els.map(el => ({ el, size: { w: 12, h: 20 } })) });
  els.forEach((el, j) => {
    const a = el.anims[0];
    assert.ok(Math.abs(a.options.delay - j * SPRING_SETS.A.stage.shipStagger) < 1e-9, 'leaves with its chip');
    assert.ok(a.options.duration <= 16 + 1e-9, 'in a frame: ' + a.options.duration);
  });
});

test('settlePile: a stack that moves and appears at once does both on one spring', () => {
  const reg = new MotionRegistry();
  const a = fakeEl(), b = fakeEl();
  settlePile(reg, { set: 'A', moves: [{ el: a, dx: -10, size: { w: 12, h: 20 } }], reveals: [{ el: a, size: { w: 12, h: 20 } }, { el: b, size: { w: 12, h: 20 } }] });
  assert.equal(a.anims.length, 1, 'one animation on the moving stack');
  const f0 = a.anims[0].frames[0];
  assert.equal(f0.opacity, 0);
  assert.match(f0.transform, /^translate\(-10px, 0px\)/);
  assert.equal(b.anims[0].frames[0].opacity, 0);
  assert.ok(b.anims[0].options.duration <= 34, 'in two frames');
});

test('sweep plan: a colour-up — a new stack no ghost\'s own colour brings is brought by a ghost that shares a stack', () => {
  const reg = new MotionRegistry();
  // The flop of the 8-max hand: 3,000 is one gold stack, 38,000 is [teal, orange, gold], and both
  // wagers' top chips are orange. The second to leave lands in the teal stack's place.
  const stacksFor = (amt) => (amt >= 38000 ? [{ color: 'T' }, { color: 'O' }, { color: 'G' }] : [{ color: 'G' }]);
  const geo = { cx: 200, cy: 500, w: 60, h: 20, chip: { dx: 0, dy: 0, w: 12, h: 14 } };
  const plan = planSweep(reg, {
    set: 'A', wagers: [
      { seat: 2, amount: 15000, el: fakeEl(), geo, topColor: 'O' },
      { seat: 5, amount: 15000, el: fakeEl(), geo, topColor: 'O' },
      { seat: 0, amount: 5000, el: fakeEl(), geo, topColor: 'O' },
    ],
    pile: { cx: 200, cy: 150, bottom: 160, pitch: 10, base: 3000, stacksFor, colors: ['G'] },
  });
  assert.deepEqual(plan.map(p => p.color), ['O', 'O', 'T'], 'the last to leave colours up');
  assert.equal(plan[2].target.x, 190);
  assert.deepEqual(plan.final.unclaimed, []);
  // One ghost and two new stacks: one is brought, the other appears with the landing.
  const one = planSweep(reg, {
    set: 'A', wagers: [{ seat: 2, amount: 35000, el: fakeEl(), geo, topColor: 'O' }],
    pile: { cx: 200, cy: 150, bottom: 160, pitch: 10, base: 3000, stacksFor, colors: ['G'] },
  });
  assert.deepEqual(one.final.unclaimed, ['T']);
});

test('settlePile: the row makes room after a delay, holding its old place until then', () => {
  const reg = new MotionRegistry();
  const a = fakeEl();
  settlePile(reg, { set: 'A', moves: [{ el: a, dx: -10, size: { w: 12, h: 20 } }], delay: 40 });
  const an = a.anims[0];
  assert.ok(an.options.delay >= 40 - 1e-9 || /translate\(-10px/.test(an.frames[0].transform), 'held at its old place');
  assert.equal(an.options.fill === 'backwards' || an.options.delay === 0, true);
});
