import test from 'node:test';
import assert from 'node:assert/strict';
import { tripRuns } from '../trip-runs.js';

const opts = { dateOf: (t) => t.d, placeOf: (t) => t.venue };
const ev = (id, d, venue) => ({ id, d, venue, event_name: 'NLH' });
const travel = (id, d) => ({ id, d, venue: 'Personal', event_name: 'Travel Day' });
const dayOff = (id, d) => ({ id, d, venue: 'Personal', event_name: 'Day Off' });

test('a trip is the run at the first room, not every saved event after it', () => {
  const list = [travel(1, '2026-11-17'), ev(2, '2026-11-18', 'Seminole'), dayOff(3, '2026-11-19'), ev(4, '2026-11-20', 'Seminole'),
    ev(5, '2026-12-02', 'Borgata'), ev(6, '2027-03-25', 'Seminole')];
  const t = tripRuns(list, '2026-11-13', opts).get(1);
  assert.deepEqual(t.events.map((e) => e.id), [2, 4]);
  assert.equal(t.start, '2026-11-17');
  assert.equal(t.end, '2026-11-20');
  assert.equal(t.room, 'Seminole');
});

test('a gap of more than a week at the same room ends the trip', () => {
  const list = [travel(1, '2026-11-17'), ev(2, '2026-11-18', 'Seminole'), ev(3, '2026-11-25', 'Seminole'), ev(4, '2026-12-10', 'Seminole')];
  assert.deepEqual(tripRuns(list, '2026-11-13', opts).get(1).events.map((e) => e.id), [2, 3]);
});

test('the next Travel Day ends it, and a past one opens none', () => {
  const list = [travel(1, '2026-11-01'), ev(2, '2026-11-02', 'A'), travel(3, '2026-11-17'), ev(4, '2026-11-18', 'B'), travel(5, '2026-11-19'), ev(6, '2026-11-20', 'B')];
  const runs = tripRuns(list, '2026-11-13', opts);
  assert.equal(runs.has(1), false);
  assert.deepEqual(runs.get(3).events.map((e) => e.id), [4]);
  assert.deepEqual(runs.get(5).events.map((e) => e.id), [6]);
});
