// node --test src/utils/__tests__/cash-sessions.test.mjs   (from vite-app/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatClock, formatHours, liveElapsed, localDay, sessionInstants, sessionGame, parseTagInput,
  amountOrUndefined, roomSuggestions, slugForRoom, monthLabel, groupByMonth, monthTotals, sessionHourly, sessionDefaults,
  hoursBetweenTimes, endTimeAfter, instantsFromHours, parseHours, hoursInput, swingSeries, swingSummary, chartPath,
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

test('month groups: newest month first, labels, fallback totals', () => {
  const s = [
    { id: 3, session_date: '2026-10-02', net: 100, hours: 2 },
    { id: 2, session_date: '2026-10-01', net: -40, hours: 3 },
    { id: 1, session_date: '2026-09-28', net: 5, hours: 1 },
  ];
  const g = groupByMonth(s);
  assert.deepEqual(g.map((m) => [m.key, m.sessions.map((x) => x.id)]), [['2026-10', [3, 2]], ['2026-09', [1]]]);
  assert.equal(monthLabel('2026-10'), 'October 2026');
  assert.equal(monthLabel('bad'), 'bad');
  assert.deepEqual(monthTotals(g[0].sessions), { net: 60, hours: 5 });
});

test('hourly: none under 15 minutes', () => {
  assert.equal(sessionHourly({ hours: 4, net: 200 }), 50);
  assert.equal(sessionHourly({ hours: 0.2, net: 200 }), null);
  assert.equal(sessionHourly({ hours: 3, net: null }), null);
});

test('defaults: the last ENDED session (not the live one), else plain defaults', () => {
  const last = { live: false, ended_at: '2026-10-02T03:30:00', started_at: '2026-10-01T19:15:00', room: 'Borgata', venue_slug: 'borgata', game: 'PLO', stakes: '2/5', buy_in: 1000 };
  const d = sessionDefaults([{ live: true, ended_at: null, room: 'Live' }, last]);
  assert.deepEqual(d, { room: 'Borgata', venueSlug: 'borgata', game: 'PLO', stakes: '2/5', buyIn: '1000', start: '19:15', end: '03:30' });
  assert.equal(sessionDefaults([]).game, 'NLH');
});

test('length: by end time or by hours, linked both ways', () => {
  assert.equal(hoursBetweenTimes('19:00', '23:30'), 4.5);
  assert.equal(hoursBetweenTimes('22:00', '04:00'), 6);
  assert.equal(endTimeAfter('22:00', 6.5), '04:30');
  assert.equal(endTimeAfter('19:00', 0), null);
  const r = instantsFromHours('2026-10-01', '22:00', 6);
  assert.equal(Date.parse(r.endedAt) - Date.parse(r.startedAt), 6 * 3600e3);
  assert.equal(instantsFromHours('2026-10-01', '22:00', 80), null);
  assert.equal(instantsFromHours('2026-10-01', '22:00', ''), null);
  for (const [t, h] of [['4.5', 4.5], ['4,5', 4.5], ['4:30', 4.5], ['4h 30m', 4.5], ['45m', 0.75], ['6h', 6], ['', null], ['x', null]]) {
    assert.equal(parseHours(t), h, t);
  }
  assert.equal(hoursInput(4), '4');
  assert.equal(hoursInput(13 / 3), '4.33');
  assert.equal(hoursInput(null), '');
});

test('swing: from 0 at the start, each update against its own buy-in, closing on the cash-out', () => {
  const live = { started_at: '2026-10-11T18:00:00Z', ended_at: null, buy_in: 900 };
  const stacks = [
    { at: '2026-10-11T19:00:00Z', amount: 650, invested: 800 },
    { at: '2026-10-11T18:30:00Z', amount: 900, invested: 800 },
  ];
  const now = Date.parse('2026-10-11T20:00:00Z');
  assert.deepEqual(swingSeries(live, stacks, now).map((p) => p.v), [0, 100, -150, -150]);
  const ended = { ...live, ended_at: '2026-10-11T21:00:00Z', cash_out: 1300 };
  const pts = swingSeries(ended, stacks, now);
  assert.deepEqual(pts.map((p) => p.v), [0, 100, -150, 400]);
  assert.equal(pts[3].t, Date.parse('2026-10-11T21:00:00Z'));
  assert.deepEqual(swingSeries(null, stacks), []);
  const sum = swingSummary([{ amount: 900, invested: 800, result: 100 }, { amount: 650, invested: 800, result: -150 }]);
  assert.deepEqual([sum.high, sum.low, sum.last.amount], [100, -150, 650]);
  assert.equal(swingSummary([]).last, null);
});

test('chart path: zero always in range, x by time or by index', () => {
  const p = chartPath([{ t: 0, v: 0 }, { t: 10, v: 100 }], { W: 100, H: 100, pad: 0 });
  assert.equal(p.d, 'M0 100 L100 0');
  assert.equal(p.zeroY, 100);
  const q = chartPath([{ v: 50 }, { v: -50 }, { v: 50 }], { W: 100, H: 100, x: 'i', pad: 0 });
  assert.equal(q.d, 'M0 0 L50 100 L100 0');
  assert.equal(q.zeroY, 50);
  assert.equal(chartPath([{ t: 0, v: 1 }]), null);
});