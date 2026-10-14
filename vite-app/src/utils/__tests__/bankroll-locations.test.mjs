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
  metaLine, resultWhat, fmtDay, rowsPage, bbItems, NO_ROOM, NO_ROOM_LABEL, MINUS, SORTS, FIRST_ROWS, PAGE_ROWS, WON_WORDS,
} from '../bankroll-locations.js';
import { sessionsTable } from '../bankroll-overview.js';
import { segmentWidths, fitsDivided, revealScroll, keyStep, pageScroll, wheelToStrip } from '../tab-strip.js';

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

test('a mixed room: entries count bullets, hours are cash only, won/ITM is (winning sessions + cashes) per entry', () => {
  const b = byKey(buildLocations(F)).get('borgata');
  assert.equal(b.total, -200 + 900 - 100 + 300);
  assert.equal(b.entries, 1 + 1 + 2 + 1, 'one cash session + four bullets');
  assert.equal(b.hours, 5);
  assert.equal(b.hourly, 300 / 5);
  assert.equal(b.roi, (-200 + 900 - 100) / (200 + 200 + 400));
  assert.equal(b.wonKind, 'mixed');
  assert.equal(b.won, (1 + 2) / 5, 'the winning session and two cashes (the 900 score, the 2-bullet min-cash), of five entries');
  assert.deepEqual(b.kinds, { tournament: true, cash: true });
  assert.equal(b.format, 'live');
  assert.deepEqual(b.tournament.cashes, 2);
});

test('a cash room: winning sessions; no ROI', () => {
  const p = byKey(buildLocations(F)).get('parx');
  assert.deepEqual([p.entries, p.hours, p.roi, p.wonKind, p.won], [3, 15, null, 'cash', 2 / 3]);
  assert.equal(p.hourly, (-150 + 600 + 250) / 15);
});

test('a tournament room: ITM per entry, no hours, no per hour; online', () => {
  const g = byKey(buildLocations(F)).get('ggpoker');
  assert.deepEqual([g.entries, g.hours, g.hourly, g.wonKind, g.won, g.format], [2, null, null, 'itm', 0.5, 'online']);
  assert.equal(g.roi, (32000 - 1100) / 2200);
  const items = statItems(g, { symbol: '$', pos: 'pre' });
  assert.deepEqual(items.map((i) => i.key), ['entries', 'roi', 'won'], 'no hours item (not "0 h") and no per hour');
  assert.equal(items.find((i) => i.key === 'won').text, '50% ITM');
});

test('ITM is cashes per ENTRY, as Analytics and the Overview count it: a re-entered event that cashed is one cash in its bullets', () => {
  const raw = [
    T(1, '2026-05-01', { bullets: 2, cost: 400, cash: 900, profit: 500, room: 'Wynn' }),
    T(2, '2026-05-02', { profit: -200, room: 'Wynn' }),
    T(3, '2026-05-03', { bullets: 3, cost: 600, profit: -600, room: 'Wynn' }),
  ];
  const w = buildLocations(prepareFacts(raw, { localHour }))[0];
  assert.equal(w.entries, 6, 'six bullets are six entries');
  assert.equal(w.won, 1 / 6, 'one cash in six bullets, not one of three events');
  assert.equal(statItems(w, { symbol: '$', pos: 'pre' }).find((i) => i.key === 'won').text, '17% ITM');
  // The Overview's Sessions table (utils/bankroll-overview.js, ITM = cashes / bullets) over the
  // same results, as ledger entries, reads the same.
  const asEntry = (f) => (f.type === 'cash'
    ? { ...f, source: 'cash-sessions', kind: 'cash', amount_display: f.profit, fx_display: 1 }
    : { ...f, source: 'tournaments', kind: 'tournament', amount_display: f.profit, units: f.bullets, fx_display: 1 });
  assert.equal(sessionsTable(raw.map(asEntry)).tournaments.won, w.won);
  // A mixed room: each side's own rate, weighted by its entries. One winning session joins the
  // six bullets: (1 + 1) / 7 — the Sessions table's cash won % and ITM, blended by entries.
  const rawMixed = [...raw, C(1, '2026-05-04', { profit: 100, room: 'Wynn' })];
  const mixed = buildLocations(prepareFacts(rawMixed, { localHour }))[0];
  assert.equal(mixed.entries, 7);
  assert.equal(mixed.won, 2 / 7);
  const st = sessionsTable(rawMixed.map(asEntry));
  assert.equal(mixed.won, (st.cash.won * st.cash.count + st.tournaments.won * st.tournaments.bullets) / mixed.entries);
  assert.equal(st.total.won, null, 'the Overview leaves its Total blank where the two differ; a room card shows the blend');
  // One kind only: the blend is that kind's own rate exactly.
  const two = [C(1, '2026-05-04', { profit: 100 }), C(2, '2026-05-05', { profit: -50 })];
  assert.equal(buildLocations(prepareFacts(two, { localHour }))[0].won, sessionsTable(two.map(asEntry)).cash.won);
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
  assert.deepEqual(items.map((i) => i.text), ['5 entries', '5', '+$60/h', 'ROI +75%', '60% won/ITM']);
  assert.deepEqual(items.map((i) => i.tone), [0, 0, 1, 1, 0], 'won/ITM has no 50% line: plain, at any rate');
  assert.equal(items[4].label, '60% of entries won or in the money');
  assert.equal(items[1].icon, 'clock');
  const p = statItems(byKey(buildLocations(F)).get('parx'), $);
  assert.deepEqual(p.map((i) => [i.key, i.tone]), [['entries', 0], ['hours', 0], ['hourly', 1], ['won', 1]]);
  // The word decides the tone, the same rule on every card: "won" green from 50%, red below; ITM and
  // won/ITM plain whatever the rate (a 60% ITM room is not judged, nor a 20% one).
  assert.deepEqual(Object.entries(WON_WORDS).map(([k, w]) => [k, w.word, w.judged]),
    [['cash', 'won', true], ['itm', 'ITM', false], ['mixed', 'won/ITM', false]]);
  const tone = (wonKind, won) => statItems({ entries: 10, hours: null, hourly: null, roi: null, won, wonKind }, $).find((i) => i.key === 'won').tone;
  assert.deepEqual([tone('cash', 0.5), tone('cash', 0.49), tone('cash', 0.9)], [1, -1, 1]);
  assert.deepEqual([tone('itm', 0.6), tone('itm', 0.2), tone('mixed', 0.7), tone('mixed', 0.1)], [0, 0, 0, 0]);
  for (const loc of buildLocations(F)) {
    const it = statItems(loc, $).find((i) => i.key === 'won');
    assert.equal(it.tone !== 0, / won$/.test(it.text), `${loc.key}: toned exactly when the word is "won"`);
  }
  const loser = buildLocations(prepareFacts([C(1, '2026-01-01', { profit: -90, hours: 2 }), C(2, '2026-01-02', { profit: 10, hours: 1 })], { localHour }))[0];
  assert.deepEqual(statItems(loser, $).map((i) => [i.text, i.tone]),
    [['2 entries', 0], ['3', 0], [MINUS + '$27/h', -1], ['50% won', 1]]);
  assert.equal(statItems(loser, $).find((i) => i.key === 'won').label, '50% of sessions won');
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

test("an open card's rows: ten, then fifty more a tap, the last tap 'Show all'; a count for a big room", () => {
  assert.deepEqual([FIRST_ROWS, PAGE_ROWS], [10, 50]);
  assert.deepEqual(rowsPage(10, 7), { rows: 7, more: null, fewer: false, count: null }, 'ten or fewer: no pager');
  assert.deepEqual(rowsPage(10, 10), { rows: 10, more: null, fewer: false, count: null });
  assert.deepEqual(rowsPage(10, 23), { rows: 10, more: { label: 'Show all 23', next: 23 }, fewer: false, count: null });
  assert.deepEqual(rowsPage(23, 23), { rows: 23, more: null, fewer: true, count: null });
  assert.deepEqual(rowsPage(10, 60), { rows: 10, more: { label: 'Show all 60', next: 60 }, fewer: false, count: null }, 'one page left');
  assert.deepEqual(rowsPage(10, 1030), { rows: 10, more: { label: 'Show 50 more', next: 60 }, fewer: false, count: '10 of 1,030' });
  assert.deepEqual(rowsPage(60, 1030), { rows: 60, more: { label: 'Show 50 more', next: 110 }, fewer: true, count: '60 of 1,030' });
  assert.deepEqual(rowsPage(1010, 1030), { rows: 1010, more: { label: 'Show all 1,030', next: 1030 }, fewer: true, count: '1,010 of 1,030' });
  assert.deepEqual(rowsPage(1030, 1030), { rows: 1030, more: null, fewer: true, count: null });
  assert.equal(rowsPage(0, 30).rows, 10, 'never under the first ten');
  assert.equal(rowsPage(5000, 30).rows, 30, 'never over the total');
  assert.deepEqual(rowsPage(10, 0), { rows: 0, more: null, fewer: false, count: null });
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

test('tab strip: a chevron pages by the view less both fades, to whole g, within the strip', () => {
  const base = { viewWidth: 350, contentWidth: 610, edge: 30, g: 10 };
  assert.equal(pageScroll({ ...base, scrollLeft: 0, dir: 1 }), 260, '350 - 60 = 290, but the end is 260');
  assert.equal(pageScroll({ ...base, contentWidth: 2000, scrollLeft: 0, dir: 1 }), 290, '350 - 60');
  assert.equal(pageScroll({ ...base, scrollLeft: 260, dir: -1 }), 0, 'no further than the start');
  assert.equal(pageScroll({ ...base, contentWidth: 2000, scrollLeft: 123, dir: 1 }), 410, '413 to whole g');
  assert.equal(pageScroll({ ...base, contentWidth: 2000, scrollLeft: 600, dir: -1 }), 310);
  assert.equal(pageScroll({ ...base, viewWidth: 355, contentWidth: 2000, scrollLeft: 0, dir: 1 }), 290, 'the step itself whole g: 295 down to 290');
  assert.equal(pageScroll({ ...base, viewWidth: 50, contentWidth: 2000, scrollLeft: 0, dir: 1 }), 10, 'at least a g');
  assert.equal(pageScroll({ ...base, contentWidth: 300, scrollLeft: 0, dir: 1 }), 0, 'nothing to scroll');
});

test('tab strip: a vertical wheel scrolls the strip sideways while it can move, else the page', () => {
  const at = (scrollLeft) => ({ scrollLeft, viewWidth: 350, contentWidth: 610 });
  assert.equal(wheelToStrip({ deltaY: 100 }, at(0)), 100);
  assert.equal(wheelToStrip({ deltaY: 100 }, at(200)), 60, 'only as far as the end');
  assert.equal(wheelToStrip({ deltaY: 100 }, at(260)), 0, 'at the end: the page scrolls');
  assert.equal(wheelToStrip({ deltaY: -100 }, at(0)), 0, 'at the start: the page scrolls');
  assert.equal(wheelToStrip({ deltaY: -100 }, at(40)), -40);
  assert.equal(wheelToStrip({ deltaY: 3, deltaMode: 1 }, at(0)), 48, 'lines');
  assert.equal(wheelToStrip({ deltaY: 1, deltaMode: 2 }, at(0)), 260, 'a page, clamped');
  assert.equal(wheelToStrip({ deltaX: 40, deltaY: 10 }, at(0)), 0, 'a sideways swipe scrolls natively');
  assert.equal(wheelToStrip({ deltaY: 100, ctrlKey: true }, at(0)), 0, 'a pinch is not a scroll');
  assert.equal(wheelToStrip({ deltaY: 100 }, { scrollLeft: 0, viewWidth: 350, contentWidth: 350 }), 0, 'nothing to scroll');
});

// ── bb/hr on the cards (utils/bb-hr.js) ───────────────────────────────────────────────────────
test('bb/hr: a cash room divides each session by its OWN big blind, the net in its own money', () => {
  const facts = prepareFacts([
    C(1, '2026-10-01', { room: 'Parx', profit: 500, native_profit: 500, hours: 4, stakes: '2/5', game: 'NLH' }),   // +100 bb
    C(2, '2026-10-02', { room: 'Parx', profit: -200, native_profit: -200, hours: 2, stakes: '1/2', game: 'NLH' }), // -100 bb
    C(3, '2026-10-03', { room: 'Parx', profit: 100, native_profit: 100, hours: 3, stakes: '', game: 'NLH' }),       // no blind: out of bb/hr, in $/h
  ], { localHour });
  const [loc] = buildLocations(facts);
  assert.equal(loc.bbhr.BB, null);
  assert.equal(loc.bbhr.bb.n, 2);
  assert.ok(Math.abs(loc.bbhr.bb.rate - 0) < 1e-9, '(+100 - 100) bb over 6 h');
  assert.equal(loc.hourly, 400 / 9, '$/h still counts all three');
  assert.deepEqual(bbItems(loc).map((i) => [i.key, i.text, i.tone]), [['bb-bb', '0.0 bb/hr', 0]]);
});

test('bb/hr: a EUR room uses the native net, not the converted profit', () => {
  const facts = prepareFacts([
    // EUR 1/2, +EUR 200 in 4 h = +100 bb = 25 bb/hr. The display profit (USD, converted) would give another answer.
    C(1, '2026-10-01', { room: 'Dublin', profit: 216, native_profit: 200, native_currency: 'EUR', hours: 4, stakes: '€1/€2', game: 'NLH' }),
  ], { localHour });
  const [loc] = buildLocations(facts);
  assert.ok(Math.abs(loc.bbhr.bb.rate - 25) < 1e-9);
  assert.deepEqual(bbItems(loc).map((i) => i.text), ['+25.0 bb/hr']);
});

test('bb/hr: limit games are in big bets and sit beside, never inside, the big blinds', () => {
  const facts = prepareFacts([
    C(1, '2026-10-01', { room: 'Parx', native_profit: 250, profit: 250, hours: 5, stakes: '2/5', game: 'NLH' }),  // +50 bb / 5 h
    C(2, '2026-10-02', { room: 'Parx', native_profit: 160, profit: 160, hours: 4, stakes: '4/8', game: 'LHE' }),  // +20 BB / 4 h
  ], { localHour });
  const [loc] = buildLocations(facts);
  assert.deepEqual(bbItems(loc).map((i) => [i.text, i.tone]), [['+10.0 bb/hr', 1], ['+5.0 BB/hr', 1]]);
});

test('bb/hr: tournaments never get one; a tournament-only room has no bbhr and no line; unreadable stakes draw no line', () => {
  const [t] = buildLocations(prepareFacts([T(1, '2026-10-01', { room: 'Borgata', profit: 100 })], { localHour }));
  assert.equal(t.bbhr, null);
  assert.deepEqual(bbItems(t), []);
  const [c] = buildLocations(prepareFacts([C(1, '2026-10-01', { room: 'Parx', profit: 100, native_profit: 100, stakes: 'NL200' })], { localHour }));
  assert.deepEqual(c.bbhr, { bb: null, BB: null });
  assert.deepEqual(bbItems(c), [], 'nothing qualifies: no line, and never a 0');
  // A mixed room: the cash part only.
  const [m] = buildLocations(prepareFacts([
    T(1, '2026-10-01', { room: 'Borgata', profit: 100 }),
    C(1, '2026-10-02', { room: 'Borgata', profit: 100, native_profit: 100, hours: 2, stakes: '1/2' }),
  ], { localHour }));
  assert.deepEqual(bbItems(m).map((i) => i.text), ['+25.0 bb/hr']);
});
