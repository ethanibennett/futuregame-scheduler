import test from 'node:test';
import assert from 'node:assert/strict';
import { tripRuns } from '../trip-runs.js';

// Rooms and where they are (the Orleans, Wynn and Green Valley Ranch in and around Las Vegas; Seminole Hard Rock in
// Hollywood FL; Borgata in Atlantic City; Parx outside Philadelphia).
const AT = {
  Orleans: { lat: 36.1027, lng: -115.2013 },
  Wynn: { lat: 36.1265, lng: -115.1658 },
  GVR: { lat: 36.0110, lng: -115.0636 },
  Seminole: { lat: 26.0516, lng: -80.2109 },
  Borgata: { lat: 39.3785, lng: -74.4349 },
  Parx: { lat: 40.1158, lng: -74.9513 },
};
const opts = { dateOf: (t) => t.d, placeOf: (t) => t.venue, coordsOf: (t) => AT[t.venue] || null, isOnline: (t) => !!t.online };
const ev = (id, d, venue, extra) => ({ id, d, venue, event_name: 'NLH', ...extra });
const travel = (id, d) => ({ id, d, venue: 'Personal', event_name: 'Travel Day' });
const dayOff = (id, d) => ({ id, d, venue: 'Personal', event_name: 'Day Off' });

test('a Vegas trip is every room in Vegas, to the Travel Day home (owner, 2026-11-19)', () => {
  const list = [travel(1, '2026-12-11'), ev(2, '2026-12-11', 'Orleans'), ev(3, '2026-12-12', 'Wynn'), dayOff(4, '2026-12-13'),
    ev(5, '2026-12-14', 'GVR'), ev(6, '2026-12-15', 'Orleans'), travel(7, '2026-12-16'), ev(8, '2026-12-18', 'Parx')];
  const t = tripRuns(list, '2026-11-19', opts).get(1);
  assert.deepEqual(t.events.map((e) => e.id), [2, 3, 5, 6]);
  assert.equal(t.start, '2026-12-11');
  assert.equal(t.end, '2026-12-16');
  assert.equal(t.homeDay, '2026-12-16');
  assert.equal(t.nights, 5);
  assert.deepEqual(t.rooms, ['Orleans', 'Wynn', 'GVR']);
});

test('an event placed somewhere else ends the trip', () => {
  const list = [travel(1, '2026-11-17'), ev(2, '2026-11-18', 'Seminole'), dayOff(3, '2026-11-19'), ev(4, '2026-11-20', 'Seminole'),
    ev(5, '2026-12-02', 'Borgata'), ev(6, '2027-03-25', 'Seminole')];
  const t = tripRuns(list, '2026-11-13', opts).get(1);
  assert.deepEqual(t.events.map((e) => e.id), [2, 4]);
  assert.equal(t.end, '2026-11-20');
  assert.equal(t.homeDay, null);
  assert.equal(t.nights, 4);
  assert.equal(t.room, 'Seminole');
});

test('Atlantic City and Philadelphia are two places', () => {
  const list = [travel(1, '2026-11-17'), ev(2, '2026-11-18', 'Borgata'), ev(3, '2026-11-19', 'Parx')];
  assert.deepEqual(tripRuns(list, '2026-11-13', opts).get(1).events.map((e) => e.id), [2]);
});

test('online events are neither in the trip nor end it; a room with no coordinates stays in', () => {
  const list = [travel(1, '2026-12-11'), ev(2, '2026-12-11', 'Orleans'), ev(3, '2026-12-11', 'WSOP.com', { online: true }),
    ev(4, '2026-12-12', 'Home game'), ev(5, '2026-12-13', 'Wynn')];
  assert.deepEqual(tripRuns(list, '2026-11-19', opts).get(1).events.map((e) => e.id), [2, 4, 5]);
});

test('a gap of more than a week ends the trip, and a Travel Day after it is not the way home', () => {
  const list = [travel(1, '2026-11-17'), ev(2, '2026-11-18', 'Seminole'), ev(3, '2026-11-25', 'Seminole'), ev(4, '2026-12-10', 'Seminole'),
    travel(5, '2026-12-11')];
  const t = tripRuns(list, '2026-11-13', opts).get(1);
  assert.deepEqual(t.events.map((e) => e.id), [2, 3]);
  assert.equal(t.end, '2026-11-25');
});

test('the next Travel Day ends it, and a past one opens none', () => {
  const list = [travel(1, '2026-11-01'), ev(2, '2026-11-02', 'Orleans'), travel(3, '2026-11-17'), ev(4, '2026-11-18', 'Wynn'), travel(5, '2026-11-19'), ev(6, '2026-11-20', 'Wynn')];
  const runs = tripRuns(list, '2026-11-13', opts);
  assert.equal(runs.has(1), false);
  assert.deepEqual(runs.get(3).events.map((e) => e.id), [4]);
  assert.equal(runs.get(3).end, '2026-11-19');
  assert.deepEqual(runs.get(5).events.map((e) => e.id), [6]);
});
