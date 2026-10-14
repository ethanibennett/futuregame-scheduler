// node --test src/utils/__tests__/bankroll-reports.test.mjs  (from vite-app/)
// The bankroll Reports tab's filter model (utils/bankroll-filters.js) and its breakdowns
// (utils/bankroll-reports.js), on facts shaped like GET /api/bankrolls/reports.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareFacts, emptyFilters, normaliseFilters, applyFilters, facetCounts, rangeCounts, optionsFor, toggle, setRange,
  clearDim, clearAll, activeCount, summaryParts, fixedLabel, rangeWindow, rangeLabel, yearOptions, weekdayOf, daypartOf,
  hourLabel, buyinBand, kindOf,
} from '../bankroll-filters.js';
import { buildReport, summaryStats, barLayout, rateKindFor, reportAvailability, REPORTS } from '../bankroll-reports.js';

// The local hour of a cash session's start is read in the viewer's zone; the tests fix it by
// reading the hour straight out of the ISO string.
const localHour = (iso) => Number(iso.slice(11, 13));
const T = (id, date, o = {}) => ({ id: 't' + id, type: 'tournament', bankroll: 'main', date, label: 'Event', profit: 0, room: 'Borgata',
  game: 'NLH', online: false, hour: 12, started_at: null, hours: null, stakes: '', buyin: 200, buyin_usd: 200, bullets: 1, cost: 200, cash: 0, category: '', ...o });
const C = (id, date, o = {}) => ({ id: 'c' + id, type: 'cash', bankroll: 'main', date, label: 'Cash', profit: 0, room: 'Parx', game: 'NLH',
  online: false, hour: null, started_at: `${date}T19:00:00`, hours: 4, stakes: '2/5', buyin: null, buyin_usd: null, bullets: null, cost: null, cash: null, category: '', ...o });
const X = (id, date, o = {}) => ({ id: 'x' + id, type: 'expense', bankroll: 'main', date, label: 'Hotel', profit: -100, room: '', game: '',
  online: false, hour: null, started_at: null, hours: null, stakes: '', buyin: null, buyin_usd: null, bullets: null, cost: null, cash: null, category: 'lodging', ...o });

const RAW = [
  T(1, '2026-10-03', { profit: -200 }),                                                  // Sat, noon
  T(2, '2026-10-04', { profit: 900, cash: 1100, room: 'Parx', hour: 19 }),               // Sun, 7 PM
  T(3, '2026-09-28', { profit: -400, bullets: 2, cost: 400, game: 'PLO', hour: 11 }),    // Mon
  T(4, '2025-06-02', { profit: -1100, buyin: 1100, buyin_usd: 1100, cost: 1100, online: true, room: 'GGPoker', hour: 20, bankroll: 7 }),
  C(1, '2026-10-02', { profit: 300, hours: 5 }),                                         // Fri, 7 PM
  C(2, '2026-10-05', { profit: -150, hours: 3, room: 'Borgata', stakes: '1/3', started_at: '2026-10-05T23:30:00' }), // Mon, 11 PM
  C(3, '2026-08-15', { profit: 600, hours: 9.5, stakes: '5/10', game: 'PLO', bankroll: 7 }),
  X(1, '2026-10-02', { profit: -250 }),
  X(2, '2026-09-30', { type: 'income', profit: 340, category: 'rakeback' }),
];
const TODAY = '2026-10-11';
const F = prepareFacts(RAW, { localHour });

test('prepareFacts derives the dimensions', () => {
  const t2 = F.find((f) => f.id === 't2'), c2 = F.find((f) => f.id === 'c2'), x2 = F.find((f) => f.id === 'x2');
  assert.deepEqual([t2.kind, t2.weekday, t2.hour, t2.daypart, t2.month, t2.year, t2.roomKey, t2.format, t2.stakesKey],
    ['tournament', 6, 19, 'evening', '2026-10', '2026', 'parx', 'live', 'bi:b1']);
  assert.deepEqual([c2.kind, c2.weekday, c2.hour, c2.daypart, c2.stakesKey, c2.stakesLabel], ['cash', 0, 23, 'night', 'cs:1/3', '1/3']);
  assert.deepEqual([x2.kind, x2.format, x2.roomKey, x2.daypart], ['expenses', null, null, null]);
  assert.equal(F.find((f) => f.id === 't4').format, 'online');
  assert.equal(RAW[0].kind, undefined, 'input untouched');
  // Stakes order: cash small to large, then tournament bands.
  const ord = (id) => F.find((f) => f.id === id).stakesOrd;
  assert.ok(ord('c2') < ord('c1') && ord('c1') < ord('c3') && ord('c3') < ord('t1') && ord('t1') < ord('t4'));
});

test('small helpers: weekday, dayparts across midnight, hour labels, bands, kinds', () => {
  assert.equal(weekdayOf('2026-10-11'), 6); // a Sunday
  assert.equal(weekdayOf('bad'), -1);
  assert.deepEqual([5, 6, 11, 12, 16, 17, 21, 22, 23, 0].map(daypartOf),
    ['night', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'night', 'night', 'night']);
  assert.equal(daypartOf(null), null);
  assert.deepEqual([0, 1, 11, 12, 13, 23].map(hourLabel), ['12 AM', '1 AM', '11 AM', '12 PM', '1 PM', '11 PM']);
  assert.deepEqual([buyinBand(0), buyinBand(99).key, buyinBand(100).key, buyinBand(25000).key], [null, 'b0', 'b1', 'b6']);
  assert.deepEqual(['tournament', 'cash', 'expense', 'income'].map((type) => kindOf({ type })), ['tournament', 'cash', 'expenses', 'expenses']);
});

test('date ranges: presets end today, a year is its calendar year', () => {
  assert.deepEqual(rangeWindow('30d', TODAY), { from: '2026-09-12', to: TODAY });
  assert.deepEqual(rangeWindow('90d', TODAY), { from: '2026-07-14', to: TODAY });
  assert.deepEqual(rangeWindow('12m', TODAY), { from: '2025-10-12', to: TODAY });
  assert.deepEqual(rangeWindow('y2025', TODAY), { from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(rangeWindow('all', TODAY), { from: null, to: null });
  assert.deepEqual([rangeLabel('90d'), rangeLabel('y2025'), rangeLabel('nope')], ['90 days', '2025', 'All time']);
  assert.deepEqual(yearOptions(F), [{ key: 'y2026', label: '2026' }, { key: 'y2025', label: '2025' }]);
});

test('no filter passes everything; OR within a dimension, AND across', () => {
  const none = emptyFilters();
  assert.equal(applyFilters(F, none, TODAY).length, F.length);
  let f = toggle(none, 'types', 'cash');
  assert.deepEqual(applyFilters(F, f, TODAY).map((x) => x.id), ['c1', 'c2', 'c3']);
  f = toggle(f, 'types', 'tournament');
  assert.equal(applyFilters(F, f, TODAY).length, 7);
  f = toggle(f, 'rooms', 'borgata');
  assert.deepEqual(applyFilters(F, f, TODAY).map((x) => x.id).sort(), ['c2', 't1', 't3']);
  f = setRange(f, '30d');
  assert.deepEqual(applyFilters(F, f, TODAY).map((x) => x.id).sort(), ['c2', 't1', 't3']);
  f = setRange(f, 'y2025');
  assert.deepEqual(applyFilters(F, f, TODAY), []);
  // Toggling a selected key removes it.
  assert.deepEqual(toggle(toggle(none, 'rooms', 'parx'), 'rooms', 'parx').rooms, []);
});

test('a fact with no value never matches an active filter on that dimension', () => {
  const f = toggle(emptyFilters(), 'dayparts', 'evening');
  const ids = applyFilters(F, f, TODAY).map((x) => x.id).sort();
  assert.deepEqual(ids, ['c1', 'c3', 't2', 't4']);
  assert.ok(!ids.some((id) => id.startsWith('x')), 'expenses have no start time');
  // Weekday applies to expenses (they have a date).
  const fri = applyFilters(F, toggle(emptyFilters(), 'weekdays', '4'), TODAY).map((x) => x.id).sort();
  assert.deepEqual(fri, ['c1', 'x1']);
});

test('bankroll and live/online filters', () => {
  assert.deepEqual(applyFilters(F, toggle(emptyFilters(), 'bankrolls', '7'), TODAY).map((x) => x.id).sort(), ['c3', 't4']);
  assert.deepEqual(applyFilters(F, toggle(emptyFilters(), 'formats', 'online'), TODAY).map((x) => x.id), ['t4']);
  assert.equal(applyFilters(F, toggle(emptyFilters(), 'formats', 'live'), TODAY).length, 6);
});

test('facet counts: each option counts under the OTHER filters, not its own', () => {
  let f = toggle(emptyFilters(), 'types', 'cash');
  // Rooms under "cash": Parx 2, Borgata 1.
  assert.deepEqual(facetCounts(F, f, 'rooms', TODAY), { parx: 2, borgata: 1 });
  // The type chips ignore the type filter itself.
  assert.deepEqual(facetCounts(F, f, 'types', TODAY), { tournament: 4, cash: 3, expenses: 2 });
  f = toggle(f, 'rooms', 'parx');
  assert.deepEqual(facetCounts(F, f, 'types', TODAY), { tournament: 1, cash: 2 });
  assert.deepEqual(facetCounts(F, f, 'stakes', TODAY), { 'cs:2/5': 1, 'cs:5/10': 1 });
  // Range chips: the dimension filters inside each range.
  assert.deepEqual(rangeCounts(F, f, TODAY, [{ key: 'all' }, { key: '30d' }, { key: 'y2025' }]), { all: 2, '30d': 1, y2025: 0 });
});

test('options: fixed lists keep their order, rooms most-played first, a stale selection stays', () => {
  assert.deepEqual(optionsFor(F, 'types').map((o) => o.key), ['tournament', 'cash', 'expenses']);
  assert.deepEqual(optionsFor(F, 'weekdays').map((o) => o.label), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.deepEqual(optionsFor(F, 'rooms').map((o) => o.label), ['Borgata', 'Parx', 'GGPoker']);
  assert.deepEqual(optionsFor(F, 'games').map((o) => [o.key, o.label]), [['nlh', 'NLH'], ['plo', 'PLO']]);
  assert.deepEqual(optionsFor(F, 'stakes').map((o) => o.label), ['1/3', '2/5', '5/10', '$100–299', '$800–1,999']);
  const names = new Map([['main', 'Main'], ['7', 'Staked']]);
  assert.deepEqual(optionsFor(F, 'bankrolls', { names }).map((o) => o.label), ['Main', 'Staked']);
  assert.deepEqual(optionsFor(F, 'rooms', { selected: ['gone'] }).pop(), { key: 'gone', label: 'gone' });
});

test('active count, summary parts, clearing', () => {
  let f = setRange(toggle(toggle(toggle(emptyFilters(), 'types', 'cash'), 'rooms', 'parx'), 'rooms', 'borgata'), '90d');
  f = toggle(toggle(toggle(f, 'weekdays', '5'), 'weekdays', '6'), 'weekdays', '0');
  assert.equal(activeCount(f), 4);
  const labelOf = (dim, key) => fixedLabel(dim, key) || ({ parx: 'Parx', borgata: 'Borgata' })[key] || key;
  assert.deepEqual(summaryParts(f, labelOf).map((p) => p.text), ['90 days', 'Cash', 'Parx, Borgata', '3 days']);
  assert.equal(activeCount(clearDim(f, 'rooms')), 3);
  assert.equal(clearDim(f, 'range').range, 'all');
  assert.deepEqual(clearAll(), emptyFilters());
  assert.equal(activeCount(emptyFilters()), 0);
});

test('normaliseFilters: whatever was stored becomes a whole, safe model', () => {
  assert.deepEqual(normaliseFilters(null), emptyFilters());
  const n = normaliseFilters({ range: 'y2024', rooms: ['a', 'a', 3], junk: 1, types: 'cash' });
  assert.deepEqual([n.range, n.rooms, n.types, 'junk' in n], ['y2024', ['a', '3'], [], false]);
  assert.equal(normaliseFilters({ range: 'forever' }).range, 'all');
});

test('report by room: counts, profit, average rate when cash and tournaments mix, best and worst', () => {
  const r = buildReport(F, 'room');
  assert.equal(r.rateKind, 'avg');
  assert.deepEqual(r.rows.map((x) => [x.label, x.n, x.profit]), [['Borgata', 3, -750], ['Parx', 3, 1800], ['GGPoker', 1, -1100]]);
  assert.deepEqual(r.rows.map((x) => [x.best, x.worst]), [[false, false], [true, false], [false, true]]);
  assert.equal(r.rows[1].rate, 600);
  assert.deepEqual([r.total.n, r.total.profit, r.missing], [7, -50, 0]);
});

test('rate kinds: hourly for cash alone, ROI for tournaments alone', () => {
  const cash = F.filter((f) => f.kind === 'cash');
  const s = buildReport(cash, 'stakes');
  assert.equal(s.rateKind, 'hourly');
  assert.deepEqual(s.rows.map((x) => [x.label, x.profit, x.hours, x.rate]), [['1/3', -150, 3, -50], ['2/5', 300, 5, 60], ['5/10', 600, 9.5, 600 / 9.5]]);
  const b = buildReport(F, 'buyin');
  assert.equal(b.rateKind, 'roi');
  assert.deepEqual(b.rows.map((x) => [x.label, x.n, x.cost, x.profit]), [['$100–299', 3, 800, 300], ['$800–1,999', 1, 1100, -1100]]);
  assert.equal(b.rows[0].rate, 300 / 800);
  assert.equal(rateKindFor([]), null);
});

test('profit by session length (cash), weekday and start hour orders', () => {
  const l = buildReport(F, 'length');
  assert.deepEqual(l.rows.map((x) => [x.label, x.n, x.profit]), [['2–4 h', 1, -150], ['4–6 h', 1, 300], ['8–10 h', 1, 600]]);
  const w = buildReport(F, 'weekday');
  assert.deepEqual(w.rows.map((x) => x.label), ['Mon', 'Fri', 'Sat', 'Sun']);
  assert.deepEqual(w.rows.find((x) => x.label === 'Mon').n, 3); // t3, t4 (2025-06-02) and c2
  const h = buildReport(F, 'hour');
  // Read from 6 AM: 11 AM, 12 PM, 7 PM (3), 8 PM, 11 PM.
  assert.deepEqual(h.rows.map((x) => [x.label, x.n]), [['11 AM', 1], ['12 PM', 1], ['7 PM', 3], ['8 PM', 1], ['11 PM', 1]]);
});

test('month: newest first, Net includes expenses and income, the rate is the games alone', () => {
  const m = buildReport(F, 'month');
  assert.deepEqual(m.rows.map((x) => x.label), ['Oct 2026', 'Sep 2026', 'Aug 2026', 'Jun 2025']);
  const oct = m.rows[0];
  assert.deepEqual([oct.n, oct.count, oct.profit, oct.played], [4, 5, 600, 850]);
  assert.equal(oct.rate, 850 / 4);
  const sep = m.rows[1];
  assert.deepEqual([sep.n, sep.profit, sep.played], [1, -60, -400]);
});

test('expense categories: share of the money, no best/worst', () => {
  const c = buildReport(F, 'category');
  assert.equal(c.rateKind, 'share');
  assert.deepEqual(c.rows.map((x) => [x.label, x.count, x.profit, x.rate, x.best]), [['Rakeback', 1, 340, 340 / 590, false], ['Lodging', 1, -250, 250 / 590, false]]);
});

test('empty input and availability', () => {
  const e = buildReport([], 'room');
  assert.deepEqual([e.empty, e.rows.length, e.rateKind, e.total.rate], [true, 0, null, null]);
  const cashOnly = F.filter((f) => f.kind === 'cash');
  const a = reportAvailability(cashOnly);
  assert.deepEqual([a.room, a.stakes, a.buyin, a.length, a.category], [true, true, false, true, false]);
  assert.equal(REPORTS.length, 9);
  assert.throws(() => buildReport(F, 'nope'));
});

test('summary stats', () => {
  const s = summaryStats(F);
  assert.equal(s.net, -200 + 900 - 400 - 1100 + 300 - 150 + 600 - 250 + 340);
  assert.deepEqual([s.played, s.tournament.n, s.tournament.bullets, s.tournament.cost, s.tournament.profit, s.tournament.cashes], [7, 4, 5, 1900, -800, 1]);
  assert.equal(s.tournament.roi, -800 / 1900);
  assert.deepEqual([s.cash.n, s.cash.hours, s.cash.profit, s.cash.wins], [3, 17.5, 750, 2]);
  assert.equal(s.cash.hourly, 750 / 17.5);
  assert.deepEqual(s.expenses, { n: 2, net: 90 });
});

test('bars: whole g, a zero line, proportional, at least 1g, never past an edge', () => {
  const all = (l) => l.bars.every((b) => Number.isInteger(b.start) && Number.isInteger(b.width) && b.start >= 0 && b.start + b.width <= 35);
  const pos = barLayout([100, 50, 0, 1]);
  assert.equal(pos.zero, 0);
  assert.deepEqual(pos.bars, [{ start: 0, width: 35 }, { start: 0, width: 18 }, { start: 0, width: 0 }, { start: 0, width: 1 }]);
  const mixed = barLayout([300, -100]);
  assert.equal(mixed.zero, 9); // 35 x 100/400 = 8.75
  assert.deepEqual(mixed.bars, [{ start: 9, width: 26 }, { start: 0, width: 9 }]);
  assert.ok(all(mixed));
  const neg = barLayout([-5, -10]);
  assert.equal(neg.zero, 35);
  assert.deepEqual(neg.bars, [{ start: 17, width: 18 }, { start: 0, width: 35 }]);
  // A tiny loss beside a huge win still gets a visible 1g bar, and the zero line moves in to fit it.
  const tiny = barLayout([10000, -1]);
  assert.deepEqual([tiny.zero, tiny.bars[1]], [1, { start: 0, width: 1 }]);
  assert.ok(all(tiny));
  assert.deepEqual(barLayout([0, 0]).bars, [{ start: 0, width: 0 }, { start: 0, width: 0 }]);
  const w20 = barLayout([7, -3, 2, -9, 11], 20);
  assert.ok(w20.bars.every((b) => b.start >= 0 && b.start + b.width <= 20));
});

// ── bb/hr beside $/h (utils/bb-hr.js) ─────────────────────────────────────────────────────────
test('reports: a per-hour table carries bb/hr per row and in the total, each session over its own big blind', () => {
  const facts = prepareFacts([
    C(1, '2026-10-01', { room: 'Parx', game: 'NLH', stakes: '2/5', hours: 4, profit: 500, native_profit: 500 }),    // +100 bb
    C(2, '2026-10-02', { room: 'Parx', game: 'NLH', stakes: '1/2', hours: 2, profit: -200, native_profit: -200 }),  // -100 bb
    C(3, '2026-10-03', { room: 'Borgata', game: 'NLH', stakes: '2/5', hours: 5, profit: 250, native_profit: 250 }), // +50 bb
  ], { localHour });
  const room = buildReport(facts, 'room');
  assert.equal(room.rateKind, 'hourly');
  const parx = room.rows.find((r) => r.label === 'Parx'), borg = room.rows.find((r) => r.label === 'Borgata');
  assert.ok(Math.abs(parx.bbhr.bb.rate - 0) < 1e-9 && parx.bbhr.bb.n === 2);
  assert.ok(Math.abs(borg.bbhr.bb.rate - 10) < 1e-9);
  assert.ok(Math.abs(room.total.bbhr.bb.rate - 50 / 11) < 1e-9, 'total: (+100 -100 +50) bb over 11 h');
  assert.equal(room.total.bbhr.BB, null);
  // By stakes the same hours: 2/5 is two sessions, 1/2 one.
  const st = buildReport(facts, 'stakes');
  assert.deepEqual(st.rows.map((r) => [r.label, r.bbhr.bb.n]), [['1/2', 1], ['2/5', 2]]);
  assert.ok(Math.abs(st.rows[0].bbhr.bb.rate - -50) < 1e-9, '1/2: -100 bb in 2 h');
  assert.ok(Math.abs(st.rows[1].bbhr.bb.rate - 150 / 9) < 1e-9, '2/5: +150 bb in 9 h');
});

test('reports: a row with no readable big blind has none (null, never 0); a limit row is in big bets, apart', () => {
  const facts = prepareFacts([
    C(1, '2026-10-01', { room: 'Parx', game: 'NLH', stakes: '', hours: 4, profit: 100, native_profit: 100 }),
    C(2, '2026-10-02', { room: 'Borgata', game: 'LHE', stakes: '4/8', hours: 4, profit: 80, native_profit: 80 }),
    C(3, '2026-10-03', { room: 'Borgata', game: 'NLH', stakes: '2/5', hours: 5, profit: 250, native_profit: 250 }),
  ], { localHour });
  const room = buildReport(facts, 'room');
  const parx = room.rows.find((r) => r.label === 'Parx'), borg = room.rows.find((r) => r.label === 'Borgata');
  assert.deepEqual(parx.bbhr, { bb: null, BB: null });
  assert.ok(Math.abs(borg.bbhr.bb.rate - 10) < 1e-9, '+50 bb in 5 h');
  assert.ok(Math.abs(borg.bbhr.BB.rate - 2.5) < 1e-9, '+10 BB in 4 h, apart from the bb');
  assert.equal(buildReport(facts, 'game').rows.find((r) => r.label === 'LHE').bbhr.bb, null);
});

test('summaryStats: cash bb/hr over the filtered facts; null without cash', () => {
  const facts = prepareFacts([
    C(1, '2026-10-01', { game: 'NLH', stakes: '2/5', hours: 4, profit: 500, native_profit: 500 }),
    T(1, '2026-10-02', { profit: 100 }),
  ], { localHour });
  const s = summaryStats(facts);
  assert.ok(Math.abs(s.cash.bbhr.bb.rate - 25) < 1e-9);
  assert.equal(summaryStats(prepareFacts([T(1, '2026-10-02', { profit: 100 })], { localHour })).cash.bbhr, null);
});

test('reports: the old shape (no native_profit) simply has no bb/hr', () => {
  const facts = prepareFacts([C(1, '2026-10-01', { game: 'NLH', stakes: '2/5', hours: 4, profit: 500 })], { localHour });
  assert.deepEqual(buildReport(facts, 'room').rows[0].bbhr, { bb: null, BB: null });
});
