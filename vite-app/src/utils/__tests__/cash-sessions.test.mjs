// node --test src/utils/__tests__/cash-sessions.test.mjs   (from vite-app/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatClock, formatHours, liveElapsed, localDay, sessionInstants, sessionGame, parseTagInput,
  amountOrUndefined, roomSuggestions, slugForRoom,
} from '../cash-sessions.js';

test('clock: h:mm:ss, never negative', () => {
  assert.equal(formatClock(0), '0:00:00');
  assert.equal(formatClock(425e3), '0:07:05');
  assert.equal(formatClock(12.5 * 3600e3), '12:30:00');
  assert.equal(formatClock(-5000), '0:00:00');
});

test('hours: minutes under an hour, h and m above', () => {
  assert.equal(formatHours(0.75), '45m');
  assert.equal(formatHours(6), '6h');
  assert.equal(formatHours(6.5), '6h 30m');
});

test('elapsed: from started_at, corrected by the server clock skew', () => {
  const s = { started_at: '2026-10-11T18:00:00.000Z' };
  const now = Date.parse('2026-10-11T19:00:00.000Z');
  assert.equal(liveElapsed(s, now), 3600e3);
  assert.equal(liveElapsed(s, now, 60e3), 3660e3);
  assert.equal(liveElapsed(null, now), 0);
});

test('instants: local day + times; an end at or before the start is the next morning', () => {
  const r = sessionInstants('2026-10-01', '22:00', '04:00');
  assert.equal(Date.parse(r.endedAt) - Date.parse(r.startedAt), 6 * 3600e3);
  assert.equal(localDay(new Date(r.startedAt)), '2026-10-01');
  const same = sessionInstants('2026-10-01', '18:00', '21:30');
  assert.equal(Date.parse(same.endedAt) - Date.parse(same.startedAt), 3.5 * 3600e3);
  assert.equal(sessionInstants('2026-10-01', '', '04:00'), null);
  assert.equal(sessionInstants('10/01/2026', '18:00', '19:00'), null);
});

test('small formatters', () => {
  assert.equal(sessionGame({ game: 'NLH', stakes: '2/5' }), 'NLH 2/5');
  assert.equal(sessionGame({ game: 'PLO', stakes: '' }), 'PLO');
  assert.deepEqual(parseTagInput(' deep, reg table ,,'), ['deep', 'reg table']);
  assert.equal(amountOrUndefined(''), undefined);
  assert.equal(amountOrUndefined('12.6'), 13);
  assert.equal(amountOrUndefined('x'), undefined);
});

test('rooms: watcher rooms first, then past sessions, deduped; slug lookup by name', () => {
  const rooms = roomSuggestions(
    [{ slug: 'borgata', name: 'Borgata' }, { slug: 'live-philly', name: 'Live! Philadelphia' }],
    [{ room: 'borgata', venue_slug: null }, { room: 'Home game' }, { room: '' }],
  );
  assert.deepEqual(rooms.map((r) => r.name), ['Borgata', 'Live! Philadelphia', 'Home game']);
  assert.equal(slugForRoom(' borgata ', rooms), 'borgata');
  assert.equal(slugForRoom('Home game', rooms), null);
  assert.equal(slugForRoom('Nowhere', rooms), null);
});
