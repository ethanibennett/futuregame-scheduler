// Events that start while an earlier one is still in late reg (utils/overlaps.js; UX pick 21).
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectOverlaps } from '../overlaps.js';

const H = 3600e3;
const T0 = Date.UTC(2026, 10, 10, 16, 15); // 11:15 AM Eastern
const ev = (id, startH, o = {}) => ({ id, venue: 'Borgata', event_name: 'E' + id, start: T0 + startH * H, ...o });
const opts = {
  startOf: (t) => t.start,
  regCloseOf: (t) => (t.regH != null ? t.start + t.regH * H : NaN),
  hasConditions: (t) => !!t.plan,
};

test('an event starting inside an earlier one\'s late reg is flagged against it', () => {
  const flightC = ev(1, 0, { regH: 6.5 });         // late reg until 5:45 PM
  const o8 = ev(2, 1, { regH: 2 });                 // 12:15 PM
  const flightD = ev(3, 6, { regH: 0.5 });          // 5:15 PM, still inside
  const later = ev(4, 7);                           // 6:15 PM, after the close
  const m = detectOverlaps([later, o8, flightC, flightD], opts);
  assert.deepEqual([...m.keys()].sort(), [2, 3]);
  assert.equal(m.get(2).parent.id, 1);
  assert.equal(m.get(3).parent.id, 1);
});

test('no stated close: four hours, each event against the earliest it overlaps', () => {
  const m = detectOverlaps([ev(1, 0), ev(2, 3.5), ev(3, 4.5)], opts);
  assert.deepEqual([...m.keys()].sort(), [2, 3]);
  assert.equal(m.get(2).parent.id, 1);
  assert.equal(m.get(3).parent.id, 2); // past 1's four hours, inside 2's
});

test('the same instant, a restart, a plan, and a travel day are not this clash', () => {
  const m = detectOverlaps([
    ev(1, 0, { regH: 6 }), ev(2, 0),                          // same instant: detectConflicts
    ev(3, 2, { plan: true }),                                 // already planned
    { id: 9, venue: 'Personal', event_name: 'Travel Day', start: T0 + 2 * H },
  ], opts);
  assert.deepEqual([...m.keys()], []);
  const r = detectOverlaps([ev(5, 0, { is_restart: 1, regH: 6 }), ev(6, 1)], opts);
  assert.deepEqual([...r.keys()], []);
});
