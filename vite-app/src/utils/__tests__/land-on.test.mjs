// landOn (utils/land-on.js): a day sent to the top of the list lands exactly on its line though it moves while the
// scroll runs, stays there through later changes above it, and lets go the moment the user takes the scroll.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landOn, landMs } from '../land-on.js';

function world({ dayAt = 2000, line = 180, scrollHeight = 20000, reduced = false } = {}) {
  const s = { dayAt, line, clock: 0, frames: [], timers: [], ros: [], listeners: new Map() };
  s.scroller = { scrollTop: 0, scrollHeight, clientHeight: 900, children: [{ id: 'list' }] };
  s.target = () => (s.dayAt == null ? null : s.dayAt - s.line);
  s.env = {
    now: () => s.clock,
    raf: (f) => { s.frames.push(f); return s.frames.length; },
    caf: () => { s.frames.length = 0; },
    setTimeout: (f, ms) => { s.timers.push({ f, at: s.clock + ms }); return s.timers.length; },
    clearTimeout: (id) => { if (s.timers[id - 1]) s.timers[id - 1].f = null; },
    RO: class { constructor(cb) { this.cb = cb; this.on = true; s.ros.push(this); } observe() {} disconnect() { this.on = false; } },
    win: {
      addEventListener: (ev, f) => s.listeners.set(ev, f),
      removeEventListener: (ev) => s.listeners.delete(ev),
      matchMedia: () => ({ matches: reduced }),
    },
  };
  // One frame later: the clock moves 16.7 ms and the frame callbacks run.
  s.tick = (n = 1) => { for (let i = 0; i < n; i++) { s.clock += 16.7; const fs = s.frames.splice(0); fs.forEach((f) => f()); } };
  s.resize = () => s.ros.forEach((r) => r.on && r.cb([]));
  s.after = (ms) => { s.clock += ms; s.timers.forEach((t) => { if (t.f && t.at <= s.clock) { const f = t.f; t.f = null; f(); } }); };
  return s;
}

test('lands exactly on a day that moves while the scroll runs', () => {
  const s = world();
  landOn(s.scroller, { target: s.target, env: s.env });
  s.tick(5);
  assert.ok(s.scroller.scrollTop > 0 && s.scroller.scrollTop < 1820, 'under way');
  s.dayAt += 64;                       // a day above takes its rows: today is 64px further down
  s.tick(60);
  assert.equal(s.scroller.scrollTop, 2064 - 180, 'on the line, where the day is now');
  assert.equal(s.frames.length, 0, 'the animation is over');
});

test('the scroll takes landMs, a quarter second for a nudge, 0.6 s at most', () => {
  assert.equal(landMs(0), 240);
  assert.equal(landMs(5000), 600);
  const s = world({ dayAt: 280 });
  landOn(s.scroller, { target: s.target, env: s.env });
  let frames = 0;
  while (s.frames.length && frames < 100) { s.tick(); frames++; }
  assert.ok(Math.abs(frames * 16.7 - landMs(100)) < 34, `${frames} frames for 100px`);
});

test('holds the day on its line through a change above it, until the user takes the scroll', () => {
  const s = world();
  landOn(s.scroller, { target: s.target, env: s.env });
  s.tick(60);
  s.dayAt += 48;                       // yesterday's event takes its room clock row
  s.resize();
  assert.equal(s.scroller.scrollTop, 2048 - 180, 'followed');
  s.listeners.get('wheel')();          // the user scrolls
  s.dayAt += 48;
  s.resize();
  assert.equal(s.scroller.scrollTop, 2048 - 180, 'left where the user has it');
  assert.equal(s.listeners.size, 0, 'and no listener is left');
});

test('lets go after holdMs, and when the day is gone', () => {
  const s = world();
  landOn(s.scroller, { target: s.target, env: s.env, holdMs: 1000 });
  s.tick(60);
  s.after(1001);
  s.dayAt += 30; s.resize();
  assert.equal(s.scroller.scrollTop, 1820, 'not held after the time');
  const g = world();
  landOn(g.scroller, { target: g.target, env: g.env });
  g.tick(3);
  const at = g.scroller.scrollTop;
  g.dayAt = null; g.tick(3);
  assert.equal(g.scroller.scrollTop, at, 'stopped where it was when its day went');
  assert.equal(g.frames.length, 0);
});

test('no motion when smooth is off or the user asked for less motion: placed, then held', () => {
  for (const opts of [{ smooth: false }, {}]) {
    const s = world({ reduced: !('smooth' in opts) });
    landOn(s.scroller, { target: s.target, env: s.env, ...opts });
    assert.equal(s.scroller.scrollTop, 1820, 'there at once');
    s.dayAt += 10; s.resize();
    assert.equal(s.scroller.scrollTop, 1830, 'and held');
  }
});

test('a day past the end of the list lands at the end', () => {
  const s = world({ dayAt: 19900 });
  landOn(s.scroller, { target: s.target, env: s.env });
  s.tick(60);
  assert.equal(s.scroller.scrollTop, 20000 - 900);
});
