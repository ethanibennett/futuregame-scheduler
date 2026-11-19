// Friends' breaks and dinner breaks against yours (owner, 2026-11-19): utils/break-align.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { breakWindows, alignBreaks, breakNote, breakTimeline, DINNER_MINS } from '../break-align.js';

const MIN = 60000;
const NOW = Date.parse('2026-11-19T22:00:00Z');
const fmt = (ms) => `+${Math.round((ms - NOW) / MIN)}m`;
const wsop = (breaks, extra = {}) => ({ state: 'running', receivedAt: NOW, onBreak: false, breaks, ...extra });

test('a WSOP clock: every break ahead with its length; a long one is dinner', () => {
  const w = breakWindows(wsop([{ inMins: 20, mins: 20 }, { inMins: 120, mins: 60 }]), NOW);
  assert.equal(w.length, 2);
  assert.deepEqual([w[0].start, w[0].end, w[0].dinner], [NOW + 20 * MIN, NOW + 40 * MIN, false]);
  assert.deepEqual([w[1].mins, w[1].dinner], [60, true]);
  assert.ok(DINNER_MINS === 45);
});

test('PokerAtlas and Bravo: only the next start, its length unknown and not guessed', () => {
  const w = breakWindows({ state: 'running', receivedAt: NOW, onBreak: false, minsToBreak: 35 }, NOW);
  assert.deepEqual(w, [{ start: NOW + 35 * MIN, end: null, mins: null, dinner: false, now: false }]);
});

test('a break on now ends when its time runs out; a clock not running has none', () => {
  const w = breakWindows({ state: 'running', receivedAt: NOW - 2 * MIN, onBreak: true, remainingSecs: 14 * 60, breakMins: 60, breaks: [] }, NOW);
  assert.equal(w.length, 1);
  assert.equal(w[0].now, true);
  assert.equal(w[0].end, NOW + 12 * MIN);
  assert.equal(w[0].dinner, true);
  assert.deepEqual(breakWindows({ state: 'not-started', minsToBreak: 10 }, NOW), []);
  assert.deepEqual(breakWindows(null, NOW), []);
});

test('aligned: the whole break together, part of it, the same start, or apart', () => {
  const mine = breakWindows(wsop([{ inMins: 20, mins: 20 }, { inMins: 120, mins: 60 }]), NOW);
  const same = alignBreaks(mine, breakWindows(wsop([{ inMins: 20, mins: 20 }]), NOW));
  assert.equal(breakNote(same, NOW, fmt), 'break +20m, with yours');
  const part = alignBreaks(mine, breakWindows(wsop([{ inMins: 135, mins: 60 }]), NOW));
  assert.equal(part.kind, 'overlap');
  assert.equal(breakNote(part, NOW, fmt), 'dinner +135m, 45 min with yours');
  const start = alignBreaks(mine, breakWindows({ state: 'running', receivedAt: NOW, minsToBreak: 22 }, NOW));
  assert.equal(breakNote(start, NOW, fmt), 'break +22m, as yours');
  const apart = alignBreaks(mine, breakWindows(wsop([{ inMins: 55, mins: 15 }]), NOW));
  assert.equal(breakNote(apart, NOW, fmt), 'break +55m, 35 min after yours');
});

test('a friend on break now, and a friend when you are not playing', () => {
  const theirs = breakWindows({ state: 'running', receivedAt: NOW, onBreak: true, remainingSecs: 12 * 60, breakMins: 20 }, NOW);
  assert.equal(breakNote(alignBreaks([], theirs), NOW, fmt), 'on break, 12 min left');
  assert.equal(breakNote(alignBreaks([], breakWindows(wsop([{ inMins: 90, mins: 75 }]), NOW)), NOW, fmt), 'dinner +90m');
  assert.equal(alignBreaks([], []), null);
});

test('the timeline: blocks in percent, shared time marked, stretched to take in dinner', () => {
  const me = { key: 'me', name: 'You', me: true, windows: breakWindows(wsop([{ inMins: 30, mins: 20 }, { inMins: 200, mins: 60 }]), NOW) };
  const sam = { key: 7, name: 'Sam', windows: breakWindows(wsop([{ inMins: 30, mins: 20 }, { inMins: 215, mins: 60 }]), NOW) };
  const pat = { key: 8, name: 'Pat', windows: breakWindows({ state: 'running', receivedAt: NOW, minsToBreak: 50 }, NOW) };
  const tl = breakTimeline([me, sam, pat], NOW, { fmt });
  assert.equal(tl.hours, Math.round((260 + 15) / 60)); // to the end of the first dinner, plus a quarter hour
  assert.deepEqual(tl.rows.map((r) => r.name), ['You', 'Sam', 'Pat']);
  const span = (260 + 15) * MIN;
  assert.ok(Math.abs(tl.rows[1].blocks[0].left - (30 * MIN / span) * 100) < 1e-9);
  assert.equal(tl.rows[1].shared.length, 2, 'the first break whole and 45 minutes of dinner');
  assert.equal(tl.rows[2].blocks[0].open, true, 'a break of unknown length is a mark');
  assert.ok(tl.rows[0].blocks[1].dinner);
  assert.equal(breakTimeline([{ key: 1, name: 'x', windows: [] }], NOW), null);
});
