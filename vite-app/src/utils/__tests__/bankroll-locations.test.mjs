// node --test src/utils/__tests__/bankroll-locations.test.mjs  (from vite-app/)
// The bankroll Locations tab (utils/bankroll-locations.js) on facts shaped like
// GET /api/bankrolls/reports, prepared as the tab prepares them; and the tab strip's arithmetic
// (utils/tab-strip.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareFacts } from '../bankroll-filters.js';
import { buildReport } from '../bankroll-reports.js';
import {
  buildLocations, sortLocations, locationsSummary, normaliseSort, compactMoney, fmtHours, fmtPct, fmtSignedPct, statItems,
  metaLine, resultWhat, fmtDay, NO_ROOM, NO_ROOM_LABEL, MINUS, SORTS,
} from '../bankroll-locations.js';
import { segmentWidths, fitsDivided, revealScroll, keyStep } from '../tab-strip.js';

const localHour = (iso) => Number(iso.slice(11, 13));
const T = (id, date, o = {}) => ({ id: 't' + id, type: 'tournament', bankroll: 'main', date, label: 'Event', profit: 0, room: 'Borgata',
  game: 'NLH', online: false, hour: 12, started_at: null, hours: null, stakes: '', buyin: 200, buyin_usd: 200, bullets: 1, cost: 200, cash: 0,
  category: '', native_currency: 'USD', ...o });
const C = (id, date, o = {}) => ({ id: 'c' + id, type: 'cash', bankroll: 'main', date, label: 'Cash', profit: 0, room: 'Parx', game: 'NLH',
  online: false, hour: null, started_at: `${date}T19:00:00`, hours: 4, stakes: '2/5', buyin: null, buyin_usd: null, bullets: null, cost: null,
  cash: null, category: '', native_currency: 'USD', ...o });
const X = (id, date, o = {}) => ({ id: 'x' + id, type: 'expense', bankroll: 'main', date, label: 'Hotel', profit: -100, room: '', game: '',
  online: false, hour: null, started_at: null, hours: null, stakes: '', buyin: null, buyin_usd: null, bullets: null, cost: null, cash: null,
  category: 'lodging', native_currency: 'USD', ...o });

const RAW = [
  // Borgata: tournaments and cash (a mixed room), spelled two ways.
  T(1, '2026-10-03', { profit: -200 }),
  T(2, '2026-10-04', { profit: 900, cash: 1100 }),
  T(3, '2026-09-28', { profit: -100, bullets: 2, cost: 400, cash: 300, room: 'borgata ' }),   // a min-cash that lost money
  C(1, '2026-10-02', { profit: 300, hours: 5, room: 'Borgata' }),
  // Parx: cash only.
  C(2, '2026-10-05', { profit: -150, hours: 3 }),
  C(3, '2026-08-15', { profit: 600, hours: 9.5, stakes: '5/10', game: 'PLO' }),
  C(4, '2026-08-16', { profit: 250, hours: 2.5 }),
  // GGPoker: online tournaments only.
  T(4, '2025-06-02', { profit: -1100, cost: 1100, online: true, room: 'GGPoker' }),
  T(5, '2025-06-03', { profit: 32000, cost: 1100, cash: 33100, online: true, room: 'GGPoker' }),
  // Dublin: a EUR room.
  T(6, '2026-03-20', { profit: -625, cost: 625, room: 'Irish Poker Open', native_currency: 'EUR' }),
  // No room at all.
  T(7, '2026-01-10', { profit: 50, cash: 250, room: '' }),
  // Expenses and income: never a location.
  X(1, '2026-10-02'),
  X(2, '2026-09-30', { type: 'income', profit: 340, category: 'rakeback' }),
];
const F = prepareFacts(RAW, { localHour });
const byKey = (list) => new Map(list.map((l) => [l.key, l]));

test('one location per room, with the Reports Room report\'s grouping exactly', () => {
  const locs = buildLocations(F);
  const keys = locs.map((l) => l.key).sort();
  assert.deepEqual(keys, ['', 'borgata', 'ggpoker', 'irish poker open', 'parx']);
  // The same rooms as the Room report (which leaves the room-less fact out as "missing").
  const rep = buildReport(F, 'room');
  assert.deepEqual(rep.rows.map((r) => r.key).sort(), keys.filter(Boolean));
  for (const r of rep.rows) assert.equal(Math.round(byKey(locs).get(r.key).total), Math.round(r.profit), r.key);
  assert.equal(byKey(locs).get('borgata').label, 'Borgata', 'the first spelling seen (facts are oldest first)');
  assert.equal(byKey(locs).get('').label, NO_ROOM_LABEL);
});

test('expenses and income are not locations and add nothing', () => {
  const locs = buildLocations(F);
  const total = locs.reduce((s, l) => s + l.total, 0);
  const played = F.filter((f) => f.kind !== 'expenses').reduce((s, f) => s + f.profit, 0);
  assert.equal(total, played);
  assert.equal(buildLocations(prepareFacts([X(9, '2026-01-01')], { localHour })).length, 0);
});

test('a mixed room: entries count bullets, hours are cash only, won % is results up over entries', () => {
  const b = byKey(buildLocations(F)).get('borgata');
  assert.equal(b.total, -200 + 900 - 100 + 300);
  assert.equal(b.entries, 1 + 1 + 2 + 1, 'one cash session + four bullets');
  assert.equal(b.hours, 5);
  assert.equal(b.hourly, 300 / 5);
  assert.equal(b.roi, (-200 + 900 - 100) / (200 + 200 + 400));
  assert.equal(b.wonKind, 'mixed');
  assert.equal(b.won, 2 / 5, 'the 900 score and the winning session, of five entries; the losing min-cash is not a win');
  assert.deepEqual(b.kinds, { tournament: true, cash: true });
  assert.equal(b.format, 'live');
  assert.deepEqual(b.tournament.cashes, 2);
});

test('a cash room: winning sessions; no ROI', () => {
  const p = byKey(buildLocations(F)).get('parx');
  assert.deepEqual([p.entries, p.hours, p.roi, p.wonKind, p.won], [3, 15, null, 'cash', 2 / 3]);
  assert.equal(p.hourly, (-150 + 600 + 250) / 15);
});

test('a tournament room: ITM by bullets, no hours, no per hour; online', () => {
  const g = byKey(buildLocations(F)).get('ggpoker');
  assert.deepEqual([g.entries, g.hours, g.hourly, g.wonKind, g.won, g.format], [2, null, null, 'itm', 0.5, 'online']);
  assert.equal(g.roi, (32000 - 1100) / 2200);
  const items = statItems(g, { symbol: '$', pos: 'pre' });
  assert.deepEqual(items.map((i) => i.key), ['entries', 'roi', 'won'], 'no hours item (not "0 h") and no per hour');
  assert.equal(items.find((i) => i.key === 'won').text, '50% ITM');
});

test('currencies: the room\'s own, most used first', () => {
  const locs = byKey(buildLocations(F));
  assert.deepEqual(locs.get('irish poker open').currencies, ['EUR']);
  assert.equal(metaLine(locs.get('irish poker open')), 'Live • EUR');
  assert.equal(metaLine(locs.get('ggpoker')), 'Online • USD');
  const mixed = buildLocations(prepareFacts([
    T(1, '2026-01-01', { native_currency: 'EUR' }), T(2, '2026-01-02', { native_currency: 'USD' }), T(3, '2026-01-03', { native_currency: 'EUR', online: true }),
  ], { localHour }))[0];
  assert.deepEqual(mixed.currencies, ['EUR', 'USD']);
  assert.equal(metaLine(mixed), 'Live and online • EUR, USD');
  // Facts from before the field existed have no currency: the line is just the format.
  assert.equal(metaLine(buildLocations(prepareFacts([T(1, '2026-01-01', { native_currency: undefined })], { localHour }))[0]), 'Live');
});

test('the date window: inclusive bounds; nothing in range is an empty list', () => {
  const oct = buildLocations(F, { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(oct.map((l) => l.key).sort(), ['borgata', 'parx']);
  assert.equal(byKey(oct).get('borgata').entries, 3);
  assert.equal(buildLocations(F, { from: '2027-01-01', to: null }).length, 0);
  assert.equal(byKey(buildLocations(F, { from: '2026-10-05', to: '2026-10-05' })).get('parx').entries, 1);
});

test('results newest first (date, then start, then id)', () => {
  const b = byKey(buildLocations(F)).get('borgata');
  assert.deepEqual(b.results.map((f) => f.id), ['t2', 't1', 'c1', 't3']);
  const same = buildLocations(prepareFacts([
    C(1, '2026-01-01', { started_at: '2026-01-01T12:00:00' }), C(2, '2026-01-01', { started_at: '2026-01-01T20:00:00' }), T(10, '2026-01-01'), T(9, '2026-01-01'),
  ], { localHour }));
  assert.deepEqual(same.flatMap((l) => l.results.map((f) => f.id)).filter((id) => id[0] === 'c'), ['c2', 'c1']);
  assert.deepEqual(byKey(same).get('borgata').results.map((f) => f.id), ['t10', 't9'], 'ids numerically');
});

test('sorting: result, entries, hours, name; the room-less card always last', () => {
  const locs = buildLocations(F);
  const order = (s) => sortLocations(locs, s).map((l) => l.key);
  assert.deepEqual(order('result'), ['ggpoker', 'borgata', 'parx', 'irish poker open', NO_ROOM]);
  assert.deepEqual(order('entries'), ['borgata', 'parx', 'ggpoker', 'irish poker open', NO_ROOM]);
  assert.deepEqual(order('hours'), ['parx', 'borgata', 'ggpoker', 'irish poker open', NO_ROOM], 'no hours: by result after');
  assert.deepEqual(order('name'), ['borgata', 'ggpoker', 'irish poker open', 'parx', NO_ROOM]);
  assert.deepEqual(order('nonsense'), order('result'));
  assert.equal(normaliseSort('hours'), 'hours');
  assert.equal(normaliseSort(undefined), 'result');
  assert.deepEqual(SORTS.map((s) => s[0]), ['result', 'entries', 'hours', 'name']);
  assert.notEqual(sortLocations(locs, 'name'), locs, 'a new array');
});

test('summary: rooms (the room-less group is not one), entries, total', () => {
  const s = locationsSummary(buildLocations(F));
  assert.equal(s.rooms, 4);
  assert.equal(s.entries, 5 + 3 + 2 + 1 + 1);
  assert.equal(s.total, F.filter((f) => f.kind !== 'expenses').reduce((a, f) => a + f.profit, 0));
});

test('compact money: whole below 100,000 (as $15,590), then k and M ($294.5k); signs with U+2212', () => {
  const $ = { symbol: '$', pos: 'pre' };
  assert.equal(compactMoney(15590, $), '$15,590');
  assert.equal(compactMoney(99999, $), '$99,999');
  assert.equal(compactMoney(99999.6, $), '$100k', 'rounds to 100,000, so compact');
  assert.equal(compactMoney(294512, $), '$294.5k');
  assert.equal(compactMoney(100000, $), '$100k');
  assert.equal(compactMoney(999960, $), '$1M', 'not $1000k');
  assert.equal(compactMoney(1234567, $), '$1.2M');
  assert.equal(compactMoney(-6233, $), MINUS + '$6,233');
  assert.equal(compactMoney(6233, $, { sign: true }), '+$6,233');
  assert.equal(compactMoney(-0.4, $, { sign: true }), '$0', 'no sign on a zero');
  assert.equal(compactMoney(-250000, { symbol: 'kr', pos: 'suf' }), MINUS + '250k kr');
  assert.equal(compactMoney(1500, { symbol: '€', pos: 'pre' }, { sign: true }), '+€1,500');
});

test('hours, percentages', () => {
  assert.deepEqual([fmtHours(4.25), fmtHours(9.96), fmtHours(47.4), fmtHours(1234.2), fmtHours(3)], ['4.3', '10', '47', '1,234', '3']);
  assert.deepEqual([fmtPct(0.6), fmtPct(0.125)], ['60%', '13%']);
  assert.deepEqual([fmtSignedPct(0.45), fmtSignedPct(-0.12), fmtSignedPct(0.054), fmtSignedPct(0), fmtSignedPct(-0.0004)],
    ['+45%', MINUS + '12%', '+5.4%', '0%', '0%']);
});

test('the stats line: items, text and tone', () => {
  const $ = { symbol: '$', pos: 'pre' };
  const b = byKey(buildLocations(F)).get('borgata');
  const items = statItems(b, $);
  assert.deepEqual(items.map((i) => i.key), ['entries', 'hours', 'hourly', 'roi', 'won']);
  assert.deepEqual(items.map((i) => i.text), ['5 entries', '5', '+$60/h', 'ROI +75%', '40% won']);
  assert.deepEqual(items.map((i) => i.tone), [0, 0, 1, 1, 0], 'won % is judged only in a cash room');
  assert.equal(items[1].icon, 'clock');
  const p = statItems(byKey(buildLocations(F)).get('parx'), $);
  assert.deepEqual(p.map((i) => [i.key, i.tone]), [['entries', 0], ['hours', 0], ['hourly', 1], ['won', 1]]);
  const loser = buildLocations(prepareFacts([C(1, '2026-01-01', { profit: -90, hours: 2 }), C(2, '2026-01-02', { profit: 10, hours: 1 })], { localHour }))[0];
  assert.deepEqual(statItems(loser, $).map((i) => [i.text, i.tone]),
    [['2 entries', 0], ['3', 0], [MINUS + '$27/h', -1], ['50% won', 1]]);
  const one = buildLocations(prepareFacts([T(1, '2026-01-01', { profit: -200 })], { localHour }))[0];
  assert.equal(statItems(one, $)[0].text, '1 entry');
  // A cash room whose sessions have no length: no hours, no per hour.
  const noLen = buildLocations(prepareFacts([C(1, '2026-01-01', { hours: 0, profit: 50 })], { localHour }))[0];
  assert.deepEqual(statItems(noLen, $).map((i) => i.key), ['entries', 'won']);
});

test('a result row: what and when', () => {
  const [c1] = F.filter((f) => f.id === 'c1');
  assert.equal(resultWhat(c1), 'NLH 2/5 · 5 h');
  assert.equal(resultWhat({ kind: 'cash', game: '', stakes: '', hours: 0 }), 'Cash');
  assert.equal(resultWhat({ kind: 'tournament', label: 'Main Event', bullets: 2 }), 'Main Event ×2');
  assert.equal(resultWhat({ kind: 'tournament', label: 'Daily', bullets: 1 }), 'Daily');
  assert.equal(fmtDay('2026-10-03'), 'Oct 3, 2026');
  assert.equal(fmtDay(''), '');
});

// ── The tab strip ───────────────────────────────────────────────────────────────────────
test('tab strip: whole-g segments, the first ones wider', () => {
  assert.deepEqual(segmentWidths(4), [9, 9, 9, 8]);
  assert.deepEqual(segmentWidths(5), [7, 7, 7, 7, 7]);
  assert.deepEqual(segmentWidths(6), [6, 6, 6, 6, 6, 5]);
  assert.deepEqual(segmentWidths(7), [5, 5, 5, 5, 5, 5, 5]);
  assert.deepEqual(segmentWidths(8), [5, 5, 5, 4, 4, 4, 4, 4]);
  for (let n = 1; n <= 12; n++) assert.equal(segmentWidths(n).reduce((a, b) => a + b, 0), 35, `n=${n}`);
  assert.deepEqual(segmentWidths(0), []);
});

test('tab strip: divided while every label fits with a g of room, else scrolling', () => {
  // Five labels around 4-5.4g at 7g each: divided.
  assert.equal(fitsDivided([5.2, 4.1, 4.4, 3.2, 3.1]), true);
  // Seven tabs at 5g: "Locations" (about 5.4g) cannot fit, nor can a 4.1g label with its g of room.
  assert.equal(fitsDivided([5.2, 4.9, 5.4, 4.4, 3.2, 3.1, 3.6]), false);
  assert.equal(fitsDivided([4, 4, 4, 4, 4, 4, 4]), true, 'exactly 5g with the room');
  assert.equal(fitsDivided([4.01, 3, 3, 3, 3, 3, 3]), false);
  // Each label is held to ITS segment: the sixth of six is 5g.
  assert.equal(fitsDivided([5, 5, 5, 5, 5, 4]), true);
  assert.equal(fitsDivided([5, 5, 5, 5, 5, 4.5]), false);
  assert.equal(fitsDivided([]), false);
  assert.equal(fitsDivided(new Array(36).fill(0)), false, 'a segment under 1g');
  assert.equal(fitsDivided([NaN, 1]), false);
});

test('tab strip: revealing the selected pill scrolls to whole g, keeping the fade clear', () => {
  const g = 10;
  const base = { viewWidth: 350, contentWidth: 490, edge: 30, g };
  // Already in view: nothing to do.
  assert.equal(revealScroll({ ...base, itemLeft: 80, itemWidth: 70, scrollLeft: 0 }), null);
  // Off the right edge: scroll so its end + the fade is in view, rounded up to whole g.
  assert.equal(revealScroll({ ...base, itemLeft: 400, itemWidth: 50, scrollLeft: 0 }), 130);
  assert.equal(revealScroll({ ...base, itemLeft: 395, itemWidth: 52, scrollLeft: 0 }), 130, '447 + 30 - 350 = 127 → 130');
  // The last pill: no fade beyond it, and never past the end.
  assert.equal(revealScroll({ ...base, itemLeft: 440, itemWidth: 50, scrollLeft: 0 }), 140);
  // Off the left edge: scroll back to its start less the fade, rounded down; the first one to 0.
  assert.equal(revealScroll({ ...base, itemLeft: 100, itemWidth: 60, scrollLeft: 120 }), 70);
  assert.equal(revealScroll({ ...base, itemLeft: 0, itemWidth: 60, scrollLeft: 120 }), 0);
  assert.equal(revealScroll({ ...base, itemLeft: 104, itemWidth: 60, scrollLeft: 120 }), 70, '74 → 70');
  // No g given: exact.
  assert.equal(revealScroll({ ...base, g: 0, itemLeft: 395, itemWidth: 52, scrollLeft: 0 }), 127);
});

test('tab strip: arrow keys wrap, Home and End jump', () => {
  assert.deepEqual(['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'a'].map((k) => keyStep(k, 0, 7)),
    [1, 6, 1, 6, 0, 6, null]);
  assert.equal(keyStep('ArrowRight', 6, 7), 0);
  assert.equal(keyStep('ArrowRight', 0, 0), null);
});
