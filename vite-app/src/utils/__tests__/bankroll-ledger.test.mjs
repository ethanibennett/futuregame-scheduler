// node --test src/utils/__tests__/bankroll-ledger.test.mjs  (from vite-app/)
// The bankroll dashboard's pure helpers (utils/bankroll-ledger.js), the CSV import's parsing and
// presets (utils/bankroll-csv.js), and balancesFromSummary (utils/bankrolls.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  periodWindow, periodElapsed, balanceSeries, drawdowns, periodTable, bySource, within, goalProgress,
  ledgerToCsv, fmtRule, sourceLabel,
  RANGES, rangeWindow, profitSeries, peakOf, overviewStats, recentResults,
  SERIES_KEYS, gameSeries, seriesLine, parseSeriesPref, niceTicks, compactMoney, chartSpan, drawdownBand,
} from '../bankroll-ledger.js';
import { parseCsv, parseNumber, parseDate, detectPreset, applyPreset, guessMapping, applyMapping } from '../bankroll-csv.js';
import { balancesFromSummary, BANKROLL_ALL, BANKROLL_MAIN } from '../bankrolls.js';

// A ledger as GET /api/bankrolls/ledger returns it (opening 1000).
const E = (date, source, kind, amount, total, extra = {}) => ({
  date, source, kind, amount, amount_display: amount, total_display: total, balance_display: total,
  bankroll: 'main', currency: 'USD', label: `${kind} ${date}`, ref: { table: source, id: date }, ...extra,
});
const ledger = [
  E('2025-11-20', 'adjustments', 'deposit', 500, 1500),
  E('2026-01-05', 'tournaments', 'tournament', -200, 1300, { units: 2 }),
  E('2026-01-05', 'tournaments', 'tournament', 900, 2200, { units: 1 }),
  E('2026-02-10', 'tournaments', 'tournament', -600, 1600, { units: 1 }),
  E('2026-02-11', 'adjustments', 'withdrawal', -300, 1300),
  E('2026-03-01', 'cash-sessions', 'cash', 400, 1700),
];

test('periodWindow and periodElapsed', () => {
  assert.deepEqual(periodWindow('month', '2026-02-14'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(periodWindow('year', '2026-02-14'), { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(periodWindow('all', '2026-02-14'), { from: null, to: null });
  assert.equal(periodElapsed('month', '2026-02-14'), 14 / 28);
  assert.equal(periodElapsed('all', '2026-02-14'), 1);
});

test('balanceSeries: one point per day (the day\'s close), opening first', () => {
  const pts = balanceSeries(within(ledger, periodWindow('year', '2026-03-05')), { opening: 1500, from: '2026-01-01' });
  assert.deepEqual(pts.map((p) => [p.date, p.value]), [
    ['2026-01-01', 1500], ['2026-01-05', 2200], ['2026-02-10', 1600], ['2026-02-11', 1300], ['2026-03-01', 1700]]);
  // All time, starting from the first entry's day: the opening point is kept beside that day's close.
  const all = balanceSeries(ledger, { opening: 1000 });
  assert.deepEqual(all.slice(0, 2).map((p) => p.value), [1000, 1500]);
});

test('drawdowns: from the running peak; max and current', () => {
  const pts = [{ date: 'a', value: 1500 }, { date: 'b', value: 2200 }, { date: 'c', value: 1600 }, { date: 'd', value: 1300 }, { date: 'e', value: 1700 }];
  const d = drawdowns(pts);
  assert.deepEqual(d.per.map((p) => p.dd), [0, 0, 600, 900, 500]);
  assert.deepEqual(d.max, { amount: 900, from: 'b', to: 'd' });
  assert.deepEqual(d.current, { amount: 500, from: 'b' });
  assert.deepEqual(drawdowns([{ date: 'a', value: 1 }, { date: 'b', value: 2 }]).current, { amount: 0, from: null });
});

test('periodTable and bySource: results vs moved', () => {
  const months = periodTable(ledger, 'month');
  assert.deepEqual(months.map((m) => [m.key, m.label, m.results, m.moved, m.net]), [
    ['2026-03', 'Mar 2026', 400, 0, 400], ['2026-02', 'Feb 2026', -600, -300, -900],
    ['2026-01', 'Jan 2026', 700, 0, 700], ['2025-11', 'Nov 2025', 0, 500, 500]]);
  const years = periodTable(ledger, 'year');
  assert.deepEqual(years.map((y) => [y.key, y.net]), [['2026', 200], ['2025', 500]]);
  const src = bySource(ledger);
  assert.deepEqual(src.map((s) => [s.source, s.net]), [['cash-sessions', 400], ['adjustments', 200], ['tournaments', 100]]);
  assert.equal(sourceLabel('cash-sessions'), 'Cash games');
  assert.equal(sourceLabel('some_new-source'), 'Some new source');
});

test('goalProgress: profit excludes money moved; volume counts bullets and sessions', () => {
  const p = goalProgress({ period: 'year', metric: 'profit', target: 1000 }, ledger, '2026-03-05');
  assert.equal(p.done, 500);
  assert.equal(p.fraction, 0.5);
  const v = goalProgress({ period: 'year', metric: 'volume', target: 10 }, ledger, '2026-03-05');
  assert.equal(v.done, 5, '2 + 1 + 1 bullets and one cash session');
  const m = goalProgress({ period: 'month', metric: 'profit', target: 100 }, ledger, '2026-02-20');
  assert.equal(m.done, -600);
});

test('ledgerToCsv: header, running balance, quoting and formula-safe text', () => {
  const rows = [E('2026-01-05', 'tournaments', 'tournament', -200, 1300), { ...E('2026-01-06', 'adjustments', 'deposit', 50, 1350), label: '=HYPERLINK("x"), a "quote"' }];
  const csv = ledgerToCsv(rows, { currency: 'USD', bankrollName: () => 'Main' });
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], 'Date,Bankroll,Source,Kind,Description,Amount,Currency,Amount (USD),Bankroll balance (USD),Running total (USD),Reference');
  assert.equal(lines[1], '2026-01-05,Main,Tournaments,tournament,tournament 2026-01-05,-200.00,USD,-200.00,1300.00,1300.00,tournaments:2026-01-05');
  assert.ok(lines[2].includes(`"'=HYPERLINK(""x""), a ""quote"""`), lines[2]);
});

test('fmtRule', () => {
  assert.deepEqual([fmtRule(100), fmtRule(40), fmtRule(300)], ['1%', '2.5%', '0.33%']);
});

test('balancesFromSummary: the switcher\'s Map from the server summary', () => {
  const m = balancesFromSummary({
    currency: 'USD',
    bankrolls: [{ id: 'main', start: 0, moved: 500, results: 100, balance: 600, count: 4, currency: 'USD' },
                { id: 7, start: 1000, moved: 0, results: -50, balance: 950, count: 1, currency: 'EUR' }],
    all: { start: 1250, moved: 500, results: 37.5, balance: 1787.5, count: 5 },
  });
  assert.deepEqual(m.get(BANKROLL_MAIN), { start: 0, adjustments: 500, results: 100, balance: 600, entries: 4, currency: 'USD' });
  assert.equal(m.get(7).currency, 'EUR');
  assert.equal(m.get(BANKROLL_ALL).balance, 1787.5);
  assert.equal(balancesFromSummary(null).size, 0);
});

// ── CSV ──────────────────────────────────────────────────────────────────────────────────
test('parseCsv: quotes, doubled quotes, CRLF, BOM, ; separator, blank lines', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n1,2'), [['a', 'b'], ['x, y', 'say "hi"'], ['1', '2']]);
  assert.deepEqual(parseCsv('a;b\n1,5;2'), [['a', 'b'], ['1,5', '2']]);
  assert.deepEqual(parseCsv('a,b\n"multi\nline",2\n'), [['a', 'b'], ['multi\nline', '2']]);
});

test('parseNumber: decimal commas, thousands, symbols, parentheses', () => {
  assert.deepEqual(['1,234.50', '1.234,50', '0,5', '$1,200', '(100)', '-75', '€ 30', '', 'abc', '+5'].map(parseNumber),
    [1234.5, 1234.5, 0.5, 1200, -100, -75, 30, null, NaN, 5]);
});

test('parseDate: ISO with time, dotted, slashed month- or day-first, invalid', () => {
  assert.equal(parseDate('2024-09-20 18:51:57'), '2024-09-20');
  assert.equal(parseDate('2024/9/2'), '2024-09-02');
  assert.equal(parseDate('20.09.2024'), '2024-09-20');
  assert.equal(parseDate('03/04/2025'), '2025-03-04');
  assert.equal(parseDate('03/04/2025', { dayFirst: true }), '2025-04-03');
  assert.equal(parseDate('25/04/2025'), '2025-04-25');
  assert.equal(parseDate('2025-02-30'), null);
  assert.equal(parseDate('soon'), null);
});

// The vendor's published sample file (pokerbankrolltracker.net/PBT_Bankroll_CSV_example.csv), verbatim.
const PBT = fs.readFileSync(new URL('./fixtures/pbt-example.csv', import.meta.url), 'utf8');

test('PBT preset: detected from the vendor sample; tournament, deposit, cash-game rows', () => {
  const rows = parseCsv(PBT);
  const det = detectPreset(rows);
  assert.equal(det.preset.id, 'pbt');
  assert.equal(det.headerRow, 1);
  const out = applyPreset(rows, det);
  assert.equal(out.length, 4);
  assert.match(out[0].skip, /Cash game/);
  assert.match(out[1].skip, /Cash game/);
  const { note, ...t } = out[2].row;
  assert.deepEqual(t, {
    type: 'tournament', date: '2024-08-17', name: 'Super Freezeout', game: 'No Limit Holdem',
    buyin: 130, entries: 1, cash: 0, place: 98, field: 171, currency: 'EUR',
  });
  assert.match(note, /^Grand Casino A/, 'the location rides along as the note');
  assert.deepEqual(out[3].row, { type: 'deposit', date: '2024-05-28', amount: 1060, currency: 'EUR', note: 'Poker Bankroll Tracker' });
});

test('PBT preset: rebuys and add-ons become entries and cost', () => {
  const head = 'id,starttime,variant,mttname,currency,buyin,cashout,rebuys,rebuycosts,addoncosts,bounties,place,player';
  const rows = parseCsv(`${head}\n,2025-01-02 12:00:00,Tournament,Daily,USD,100,450,2,200,0,25,3,80\n,2025-01-03 12:00:00,Tournament,Turbo,USD,100,0,2,200,50,0,,`);
  const det = detectPreset(rows);
  assert.equal(det.headerRow, 0, 'the sentinel line is optional');
  const [a, b] = applyPreset(rows, det).map((x) => x.row);
  assert.deepEqual([a.entries, a.buyin, a.cash], [3, 100, 475], 'two rebuys at the buy-in: three entries of 100');
  assert.deepEqual([b.entries, b.buyin], [1, 350], 'an add-on that does not split evenly: one entry of the whole cost');
  assert.match(b.note, /folded/);
});

test('Pokerbase Custom Sheet preset', () => {
  const head = 'currency_code,location,stake,table_size,game,type,tournament_name,is_online,start,end,buyin_amount,total_rebuy_amount,number_of_rebuys,total_addon_amount,number_of_addons,total_bounties_amount,number_of_bounties,expenses_amount,expenses_from_stack_amount,cashout,total_break_minutes,tournament_position,total_tournament_entries,note';
  const rows = parseCsv(`${head}\nUSD,Borgata,,9,NLH,tournament,Deepstack,,2025-03-01 11:00:00,,400,,0,,,,,,,1500,,7,212,bagged\nUSD,Borgata,1/2,9,NLH,cashgame,,,2025-03-02 20:00:00,,300,,,,,,,,,500,,,,`);
  const det = detectPreset(rows);
  assert.equal(det.preset.id, 'pokerbase-custom');
  const out = applyPreset(rows, det);
  assert.deepEqual(out[0].row, { type: 'tournament', date: '2025-03-01', name: 'Deepstack', game: 'NLH', buyin: 400, entries: 1, cash: 1500, place: 7, field: 212, currency: 'USD', note: 'Borgata · bagged' });
  assert.match(out[1].skip, /Cash game/);
});

test('generic mapping: guessed columns, results and signed deposits', () => {
  const rows = parseCsv('Date,Event,Buy-in,Winnings,Place\n2025-04-01,Sunday Major,"$1,050",0,\n04/02/2025,Daily,200,"1.234,00",3\nbad,x,1,0,');
  const map = guessMapping(rows[0]);
  assert.deepEqual([map.date, map.name, map.buyin, map.cash, map.place], [0, 1, 2, 3, 4]);
  const out = applyMapping(rows, map, { rowsAre: 'tournament', currency: 'EUR' });
  assert.deepEqual(out[0].row, { type: 'tournament', date: '2025-04-01', name: 'Sunday Major', game: '', buyin: 1050, entries: 1, cash: 0, place: null, field: null, currency: 'EUR', note: '' });
  assert.deepEqual([out[1].row.date, out[1].row.cash, out[1].row.place], ['2025-04-02', 1234, 3]);
  assert.match(out[2].error, /Unreadable date/);
  const adj = applyMapping(parseCsv('date,amount,note\n2025-01-01,500,in\n2025-01-02,-120,out\n2025-01-03,0,'),
    { date: 0, amount: 1, note: 2 }, { rowsAre: 'adjustment' });
  assert.deepEqual(adj.map((a) => a.row ? [a.row.type, a.row.amount] : a.skip), [['deposit', 500], ['withdrawal', 120], 'Amount of 0']);
});

// ── The overview tab ──────────────────────────────────────────────────────────────────────
test('rangeWindow: trailing windows ending today, YTD from Jan 1, month ends clamped', () => {
  assert.deepEqual(RANGES.map((r) => r[0]), ['1m', '3m', 'ytd', '1y', 'all']);
  assert.deepEqual(rangeWindow('1m', '2026-10-11'), { from: '2026-09-12', to: '2026-10-11' });
  assert.deepEqual(rangeWindow('3m', '2026-10-11'), { from: '2026-07-12', to: '2026-10-11' });
  assert.deepEqual(rangeWindow('ytd', '2026-10-11'), { from: '2026-01-01', to: '2026-10-11' });
  assert.deepEqual(rangeWindow('1y', '2026-10-11'), { from: '2025-10-12', to: '2026-10-11' });
  assert.deepEqual(rangeWindow('all', '2026-10-11'), { from: null, to: null });
  // 31 March less a month is 28 February (clamped), so the window opens on 1 March.
  assert.deepEqual(rangeWindow('1m', '2026-03-31'), { from: '2026-03-01', to: '2026-03-31' });
  assert.deepEqual(rangeWindow('1m', '2026-01-15'), { from: '2025-12-16', to: '2026-01-15' });
});

test('profitSeries: cumulative results from 0, money moved left out, one point per day', () => {
  const pts = profitSeries(within(ledger, { from: '2026-01-01', to: null }), { from: '2026-01-01' });
  assert.deepEqual(pts.map((p) => [p.date, p.value]), [
    ['2026-01-01', 0], ['2026-01-05', 700], ['2026-02-10', 100], ['2026-03-01', 500]]);
  assert.deepEqual(peakOf(pts), { value: 700, date: '2026-01-05' });
  assert.deepEqual(profitSeries([], {}).map((p) => p.value), [0]);
});

// Tournament rows carry cost / cash in their own currency, scaled by fx_display; cash rows hours.
const T = (date, amount, cost, cash, extra = {}) => E(date, 'tournaments', 'tournament', amount, 0, { cost, cash, units: 1, ...extra });
const C = (date, amount, hours) => E(date, 'cash-sessions', 'cash_session', amount, 0, { hours });
const rows = [
  E('2026-01-01', 'adjustments', 'deposit', 1000, 0),
  T('2026-01-02', -200, 200, 0),
  T('2026-01-03', 1300, 300, 1600, { units: 2 }),
  // A EUR event in a USD view: 100 EUR buy-in at 1.25 USD per EUR -> cost 125, net -125.
  T('2026-01-04', -125, 100, 0, { currency: 'EUR', fx_display: 1.25 }),
  C('2026-01-05', 400, 4),
  C('2026-01-06', -150, 2),
  C('2026-01-07', 50, null), // no end time: a session, but not in the hourly rate
  E('2026-01-08', 'transactions', 'expense', -80, 0),
  E('2026-01-09', 'adjustments', 'withdrawal', -300, 0),
];

test('overviewStats: results split by source, tournament ROI / ITM on the display scale, cash hourly', () => {
  const s = overviewStats(rows);
  assert.equal(s.results, -200 + 1300 - 125 + 400 - 150 + 50 - 80);
  assert.equal(s.moved, 700);
  assert.deepEqual(s.bySource, { tournaments: 975, cash: 300, other: -80 });
  assert.deepEqual([s.mtt.events, s.mtt.bullets, s.mtt.cashes, s.mtt.cost, s.mtt.cashed], [3, 4, 1, 625, 1600]);
  assert.equal(s.mtt.roi, 975 / 625);
  assert.equal(s.mtt.itm, 1 / 3);
  assert.equal(s.mtt.avgBuyin, 625 / 4);
  assert.deepEqual([s.cash.sessions, s.cash.hours, s.cash.wins], [3, 6, 2]);
  assert.equal(s.cash.hourly, (400 - 150) / 6, 'the timed sessions only');
  assert.equal(s.cash.winRate, 2 / 3);
  assert.equal(s.cash.avgHours, 3);
  assert.equal(s.biggestWin.amount_display, 1300);
  assert.equal(s.biggestLoss.amount_display, -200, 'an expense is not a session lost');
});

test('overviewStats: an empty range has null ratios, not zeros', () => {
  const s = overviewStats([]);
  assert.equal(s.results, 0);
  assert.deepEqual([s.mtt.roi, s.mtt.itm, s.mtt.avgBuyin, s.cash.hourly, s.cash.winRate, s.cash.avgHours], [null, null, null, null, null, null]);
  assert.equal(s.biggestWin, null);
});

test('recentResults: newest game entries first, deposits and expenses skipped', () => {
  assert.deepEqual(recentResults(rows, 4).map((e) => e.date), ['2026-01-07', '2026-01-06', '2026-01-05', '2026-01-04']);
  assert.equal(recentResults(rows, 50).length, 6);
});

// ── The trend graph: Total / Tournaments / Cash on one date axis ─────────────────────────
const KEYS4 = ['total', 'tourn', 'cash', 'other'];
const sumOk = (r) => Math.round((r.tourn + r.cash + r.other) * 100) === Math.round(r.total * 100);

test('gameSeries: rows on the union of dates, from 0 at the start, tourn + cash + other == total', () => {
  const g = gameSeries(rows, { from: '2026-01-01' });
  assert.deepEqual(g[0], { date: '2026-01-01', total: 0, tourn: 0, cash: 0, other: 0, start: true });
  // One row per day with a result; the deposit (1 Jan) and the withdrawal (9 Jan) make none.
  assert.deepEqual(g.map((r) => r.date), ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05',
    '2026-01-06', '2026-01-07', '2026-01-08']);
  for (const r of g) assert.ok(sumOk(r), `identity on ${r.date}`);
  const last = g[g.length - 1];
  const s = overviewStats(rows);
  assert.deepEqual([last.total, last.tourn, last.cash, last.other],
    [s.results, s.bySource.tournaments, s.bySource.cash, s.bySource.other], 'the ends are the Results rows');
  // A series holds between its own entries: cash is 0 until 5 Jan, tournaments flat after 4 Jan.
  assert.deepEqual(g.map((r) => r.cash), [0, 0, 0, 0, 400, 250, 300, 300]);
  assert.deepEqual(g.map((r) => r.tourn), [0, -200, 1100, 975, 975, 975, 975, 975]);
});

test('gameSeries: same-day entries merge, a start on an entry day keeps its 0 row, cents add exactly', () => {
  const eur = [
    E('2026-02-01', 'tournaments', 'tournament', 153.53, 0),
    E('2026-02-01', 'cash-sessions', 'cash_session', -162.46, 0),
    E('2026-02-01', 'transactions', 'income', 0.1, 0),
    E('2026-02-02', 'transactions', 'income', 0.2, 0),
    E('2026-02-02', 'tournaments', 'tournament', -562.36, 0),
  ];
  const g = gameSeries(eur, { from: '2026-02-01' });
  assert.equal(g.length, 3);
  assert.deepEqual(g[0], { date: '2026-02-01', total: 0, tourn: 0, cash: 0, other: 0, start: true });
  assert.deepEqual(g[1], { date: '2026-02-01', total: -8.83, tourn: 153.53, cash: -162.46, other: 0.1 });
  assert.deepEqual(g[2], { date: '2026-02-02', total: -570.99, tourn: -408.83, cash: -162.46, other: 0.3 });
  for (const r of g) assert.ok(sumOk(r));
  assert.notEqual(0.1 + 0.2, 0.3, 'which is why the sums run in cents');
});

test('gameSeries: empty, a single entry, a negative-only series', () => {
  assert.deepEqual(gameSeries([], { from: '2026-03-01' }), [{ date: '2026-03-01', total: 0, tourn: 0, cash: 0, other: 0, start: true }]);
  assert.equal(gameSeries([], {})[0].date, null);
  assert.equal(gameSeries([E('2026-01-01', 'adjustments', 'deposit', 500, 0)], { from: '2026-01-01' }).length, 1, 'money moved is no result');
  const one = gameSeries([C('2026-03-04', 75, 2)], { from: '2026-03-01' });
  assert.deepEqual(one.map((r) => [r.date, r.total, r.tourn, r.cash]), [['2026-03-01', 0, 0, 0], ['2026-03-04', 75, 0, 75]]);
  // No from: the first row is dated at the first result.
  assert.equal(gameSeries([C('2026-03-04', 75, 2)])[0].date, '2026-03-04');
  const neg = gameSeries([T('2026-04-01', -100, 100, 0), T('2026-04-02', -50, 50, 0), C('2026-04-03', 20, 1)], { from: '2026-04-01' });
  assert.deepEqual(neg.map((r) => r.tourn), [0, -100, -150, -150]);
  assert.ok(neg.every((r) => r.tourn <= 0));
  assert.ok(neg.every(sumOk));
});

test('gameSeries over the 1M and YTD windows: each series restarts at 0 on the range\'s first day', () => {
  const led = [
    T('2025-12-20', 500, 100, 600),
    C('2026-01-10', -80, 3),
    T('2026-09-01', -300, 300, 0),
    C('2026-09-20', 120, 4),
    E('2026-09-25', 'transactions', 'expense', -40, 0),
    T('2026-10-02', 1000, 200, 1200),
  ];
  const today = '2026-10-11';
  for (const [range, want] of [['1m', { total: 1080, tourn: 1000, cash: 120, other: -40 }],
    ['ytd', { total: 700, tourn: 700, cash: 40, other: -40 }]]) {
    const w = rangeWindow(range, today);
    const win = within(led, w);
    const g = gameSeries(win, { from: w.from });
    assert.equal(g[0].date, w.from);
    for (const k of KEYS4) assert.equal(g[0][k], 0);
    assert.ok(g.every(sumOk));
    const last = g[g.length - 1];
    assert.deepEqual({ total: last.total, tourn: last.tourn, cash: last.cash, other: last.other }, want, range);
    assert.equal(last.total, overviewStats(win).results, `${range}: Total ends at the hero`);
    // The Total line is profitSeries (the hero's own series), point for point.
    assert.deepEqual(seriesLine(g, 'total').map((p) => [p.date, p.value]), profitSeries(win, { from: w.from }).map((p) => [p.date, p.value]));
  }
});

test('seriesLine: the start, then only the rows where that series moved', () => {
  const g = gameSeries(rows, { from: '2026-01-01' });
  assert.deepEqual(seriesLine(g, 'cash').map((p) => [p.date, p.value]),
    [['2026-01-01', 0], ['2026-01-05', 400], ['2026-01-06', 250], ['2026-01-07', 300]]);
  assert.deepEqual(seriesLine(g, 'tourn').map((p) => p.value), [0, -200, 1100, 975]);
  assert.equal(seriesLine(gameSeries([], { from: '2026-01-01' }), 'cash').length, 1);
});

test('parseSeriesPref: known keys in order, junk and empty fall back to all three', () => {
  assert.deepEqual(SERIES_KEYS, ['total', 'tourn', 'cash']);
  assert.deepEqual(parseSeriesPref('cash,total'), ['total', 'cash']);
  assert.deepEqual(parseSeriesPref('cash,cash'), ['cash']);
  for (const bad of [null, undefined, '', '[]', 'junk', ',,', 'other']) assert.deepEqual(parseSeriesPref(bad), SERIES_KEYS, String(bad));
  assert.deepEqual(parseSeriesPref(' tourn , junk '), ['tourn']);
});

// Every gridline must land on an r line of the 24r plot: n steps, n dividing 24.
const checkTicks = (lo, hi, t, zero = true) => {
  assert.ok([2, 3, 4].includes(t.ticks.length - 1), `${lo}..${hi}: ${t.ticks.length - 1} steps`);
  assert.ok(t.lo <= Math.min(lo, zero ? 0 : lo) && t.hi >= Math.max(hi, zero ? 0 : hi), `${lo}..${hi} inside ${t.lo}..${t.hi}`);
  const e = Math.floor(Math.log10(t.step));
  const mant = Number((t.step / 10 ** e).toPrecision(6));
  assert.ok([1, 2, 2.5, 5].includes(mant), `nice step ${t.step}`);
  t.ticks.forEach((v, i) => assert.ok(Math.abs(v - (t.lo + i * t.step)) < t.step * 1e-9, `tick ${i} = ${v}`));
  if (zero) assert.ok(t.ticks.includes(0), `${lo}..${hi}: 0 is a gridline`);
};

test('niceTicks: nice steps, 3 to 5 gridlines, the extent rounded out to them, 0 among them', () => {
  assert.deepEqual(niceTicks(-7930, 0), { lo: -8000, hi: 0, step: 2000, ticks: [-8000, -6000, -4000, -2000, 0] });
  // A positive-only Cash and a negative-only Total drawn together: both inside the gridlines.
  const both = niceTicks(-7930, 1600);
  checkTicks(-7930, 1600, both);
  assert.deepEqual(both.ticks, [-10000, -5000, 0, 5000]);
  checkTicks(-16216, 2574, niceTicks(-16216, 2574));
  checkTicks(0, 5287, niceTicks(0, 5287));
  assert.deepEqual(niceTicks(0, 1234).ticks, [0, 500, 1000, 1500]);
  // Negative-only: 0 on top.
  const neg = niceTicks(-1550, -10);
  assert.equal(neg.hi, 0);
  checkTicks(-1550, -10, neg);
  // Cents (an EUR bankroll's small range) stay tidy: no 0.30000000000000004.
  const small = niceTicks(-0.7, 0.35);
  checkTicks(-0.7, 0.35, small);
  assert.ok(small.ticks.every((v) => String(v).length <= 5), small.ticks.join(','));
});

test('niceTicks: flat, single-point and junk extents never loop or return NaN', () => {
  assert.deepEqual(niceTicks(0, 0), { lo: 0, hi: 0, step: 0, ticks: [0] });
  assert.deepEqual(niceTicks(5, 5, { zero: false }), { lo: 5, hi: 5, step: 0, ticks: [5] });
  checkTicks(0, 250, niceTicks(250, 250)); // one point at 250, with 0 taken in
  assert.deepEqual(niceTicks(NaN, NaN), { lo: 0, hi: 0, step: 0, ticks: [0] });
  assert.deepEqual(niceTicks(Infinity, -Infinity), { lo: 0, hi: 0, step: 0, ticks: [0] });
  checkTicks(-300, 0, niceTicks(-Infinity, -300));
  checkTicks(-200, 900, niceTicks(900, -200)); // ends swapped
});

test('niceTicks: the balance graph (zero off) keeps 0 out and still lands on whole steps', () => {
  const b = niceTicks(40120, 41257, { zero: false });
  checkTicks(40120, 41257, b, false);
  assert.ok(b.lo > 0, 'no 0 forced into a balance scale');
  assert.deepEqual(b.ticks, [40000, 40500, 41000, 41500]);
});

test('niceTicks: minStep coarsens a scale (the chart\'s label gutter), still on whole steps', () => {
  // MX$1,000,000 less a MX$15 expense: in steps of 5 the labels are MX$999,985 … MX$1,000,000.
  assert.deepEqual(niceTicks(999985, 1000000, { zero: false }).step, 5);
  const c1 = niceTicks(999985, 1000000, { zero: false, minStep: 50 });
  checkTicks(999985, 1000000, c1, false);
  assert.equal(c1.step, 50);
  assert.deepEqual(c1.ticks, [999950, 1000000, 1000050], "two steps at least: the spare one on top");
  const c2 = niceTicks(999985, 1000000, { zero: false, minStep: 500 });
  checkTicks(999985, 1000000, c2, false);
  assert.ok(c2.step >= 500 && c2.ticks.length >= 3, c2.ticks.join(','));
  // A minStep finer than the fit changes nothing; one far coarser still returns whole steps.
  assert.deepEqual(niceTicks(-7930, 1600, { minStep: 1 }), niceTicks(-7930, 1600));
  const far = niceTicks(-7930, 1600, { minStep: 1e6 });
  checkTicks(-7930, 1600, far);
  assert.equal(far.step, 1e6);
});

test('niceTicks: the tightest fit, over a sweep of extents', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const steps = [1, 2, 2.5, 5].flatMap((m) => [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7].map((p) => m * 10 ** p));
  for (let i = 0; i < 2000; i++) {
    const mag = 10 ** Math.floor(rnd() * 7 - 1);
    const lo = rnd() < 0.3 ? 0 : -rnd() * mag, hi = rnd() < 0.3 ? 0 : rnd() * mag;
    if (hi === lo) continue;
    const t = niceTicks(lo, hi);
    checkTicks(lo, hi, t);
    // No smaller nice step would have fitted in 4 steps.
    for (const s of steps.filter((x) => x < t.step * 0.999)) {
      const need = Math.ceil(Math.max(hi, 0) / s - 1e-9) - Math.floor(Math.min(lo, 0) / s + 1e-9);
      assert.ok(need > 4, `${lo}..${hi}: step ${s} would fit (${need}) under ${t.step}`);
    }
  }
});

test('chartSpan: the window\'s days; All from the first entry to today, or to an entry dated after today', () => {
  const today = '2026-10-13';
  const led = [T('2025-01-07', -150, 150, 0), C('2026-09-20', 120, 4), E('2026-11-15', 'transactions', 'expense', -400, 0)];
  // All keeps the future-dated expense (as the hero and the tables do), so the axis runs to its day.
  const all = rangeWindow('all', today);
  assert.deepEqual(chartSpan(all, within(led, all), today), { start: '2025-01-07', end: '2026-11-15' });
  // Every entry in the past: All ends today, not at the last entry.
  assert.deepEqual(chartSpan(all, within(led.slice(0, 2), all), today), { start: '2025-01-07', end: today });
  // The trailing ranges end today and leave the future entry out, so nothing falls past the end.
  for (const r of ['1m', '3m', 'ytd', '1y']) {
    const w = rangeWindow(r, today);
    const win = within(led, w);
    const span = chartSpan(w, win, today);
    assert.deepEqual(span, { start: w.from, end: today }, r);
    assert.ok(win.every((e) => e.date >= span.start && e.date <= span.end), `${r}: every entry inside the axis`);
  }
  // A clock running behind the ledger (today 28 Feb, entries to October): All spreads them to October.
  assert.deepEqual(chartSpan(all, within(led.slice(0, 2), all), '2026-02-28'), { start: '2025-01-07', end: '2026-09-20' });
  // Empty: today to today. Only future entries: from the first to the last.
  assert.deepEqual(chartSpan(all, [], today), { start: today, end: today });
  assert.deepEqual(chartSpan(all, within(led.slice(2), all), today), { start: '2026-11-15', end: '2026-11-15' });
});

// The band [bottom, peak] against the fill [floor, edge]: the length of value they share (<= 0: none).
const bandOverFill = (b, f) => Math.min(b.peak, Math.max(b.edge, f)) - Math.max(b.bottom, Math.min(b.edge, f));

test('drawdownBand: always the full drawdown, peak to line; the fill gives way under it', () => {
  // A profit line: up to 500, down through 0 to -300, back to 100.
  const pts = [0, 500, 200, -300, 100].map((value, i) => ({ date: `2026-01-0${i + 1}`, value }));
  const { per } = drawdowns(pts);
  // Fill on or off, the band runs from the peak to the line: its depth is the drawdown.
  for (const floor of [null, 0]) {
    const band = drawdownBand(pts, { floor });
    assert.deepEqual(band.map((b) => [b.peak, b.bottom]), [[0, 0], [500, 500], [500, 200], [500, -300], [500, 100]]);
    band.forEach((b, i) => assert.equal(b.peak - b.bottom, per[i].dd, `floor ${floor}, point ${i}`));
  }
  // Fill to 0: above 0 it still runs up to the line (the band is above it); at -300 the band takes
  // the whole ground from the peak to the line, so the fill there is empty (edge at the floor).
  const filled = drawdownBand(pts, { floor: 0 });
  assert.deepEqual(filled.map((b) => b.edge), [0, 500, 200, 0, 100]);
  for (const [i, b] of filled.entries()) assert.ok(bandOverFill(b, 0) <= 0, `point ${i}`);
  assert.deepEqual(drawdownBand(pts).map((b) => b.edge), [0, 500, 200, -300, 100], 'no floor: the edge is the line');
  // A line that never rises above its start: the band is the whole loss (it was once cut to
  // nothing at the fill's edge, so a losing range showed no drawdown at all) and the fill is empty.
  const under = drawdownBand([0, -100, -50, -400].map((value, i) => ({ date: `d${i}`, value })), { floor: 0 });
  assert.deepEqual(under.map((b) => b.peak - b.bottom), [0, 100, 50, 400]);
  assert.ok(under.every((b) => b.edge === 0));
  // A balance scale that does not reach 0 fills to its bottom gridline: band above the line, fill under it.
  const bal = [{ date: 'a', value: 41000 }, { date: 'b', value: 40200 }, { date: 'c', value: 40900 }];
  assert.deepEqual(drawdownBand(bal, { floor: 40000 }).map((b) => [b.peak, b.bottom, b.edge]),
    [[41000, 41000, 41000], [41000, 40200, 40200], [41000, 40900, 40900]]);
  // A balance below 0 against a floor of 0: the fill from 0 down to the peak, the band from the peak
  // down to the line; never inverted.
  const red = drawdownBand([{ date: 'a', value: -100 }, { date: 'b', value: -300 }], { floor: 0 });
  assert.deepEqual(red.map((b) => [b.peak, b.bottom, b.edge]), [[-100, -100, -100], [-100, -300, -100]]);
  assert.deepEqual(drawdownBand([]), []);
  // Random walks against floors above, inside and below them: the band is always the drawdown, and
  // band and fill never share more than one value.
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 300; k++) {
    let v = Math.round((rnd() - 0.5) * 2000);
    const walk = Array.from({ length: 2 + Math.floor(rnd() * 30) }, (_, i) => ({ date: `w${i}`, value: (v += Math.round((rnd() - 0.55) * 800)) }));
    const dd = drawdowns(walk).per;
    for (const floor of [0, Math.min(...walk.map((p) => p.value)), Math.round((rnd() - 0.5) * 3000)]) {
      const band = drawdownBand(walk, { floor });
      band.forEach((b, i) => {
        assert.equal(b.peak - b.bottom, dd[i].dd);
        assert.ok(bandOverFill(b, floor) <= 0, `walk ${k}, floor ${floor}, point ${i}`);
      });
    }
  }
});

// Currencies as utils.js CURRENCY_CONFIG, grouped as en-US groups (the labels follow the locale,
// as formatCurrencyAmount does; the tests pin it).
const USD = { symbol: '$', pos: 'pre', locale: 'en-US' }, EUR = { symbol: '€', pos: 'pre', locale: 'en-US' };
const SEK = { symbol: 'kr', pos: 'suf', locale: 'en-US' }, JPY = { symbol: '¥', pos: 'pre', locale: 'en-US' };
const CHF = { symbol: 'CHF', pos: 'pre', locale: 'en-US' };

test('compactMoney: the axis labels, in each currency\'s own form', () => {
  assert.equal(compactMoney(5000, USD), '$5k');
  assert.equal(compactMoney(-2000, USD), '−$2k');
  assert.equal(compactMoney(2500, USD), '$2.5k');
  assert.equal(compactMoney(-1250, EUR), '−€1.25k');
  assert.equal(compactMoney(750, USD), '$750');
  assert.equal(compactMoney(0, USD), '$0');
  assert.equal(compactMoney(-0, USD), '$0');
  assert.equal(compactMoney(5000, SEK), '5k kr');
  assert.equal(compactMoney(-20000, SEK), '−20k kr');
  assert.equal(compactMoney(2500000, JPY), '¥2.5M');
  assert.equal(compactMoney(-1500000, JPY), '−¥1.5M');
  assert.equal(compactMoney(15000, CHF), 'CHF15k');
  assert.equal(compactMoney(0.5, EUR), '€0.5');
  assert.equal(compactMoney(1000), '$1k', 'USD when no currency is given');
  // A lone value (no step) is written exactly: never rounded into a neighbour's label.
  assert.equal(compactMoney(9985.37, USD), '$9,985.37');
  assert.equal(compactMoney(1234, USD), '$1,234');
});

// A label read back as a number: the symbol, the k / M and the grouping undone, U+2212 a minus.
const SYM = /^(?:\$|€|¥|CHF|C\$)|\s*kr$/;
const parseLabel = (s) => {
  let t = s.replace('−', '-'), neg = t.startsWith('-');
  if (neg) t = t.slice(1);
  t = t.replace(SYM, '').replace(/,/g, '');
  const mult = t.endsWith('M') ? 1e6 : t.endsWith('k') ? 1e3 : 1;
  const n = Number(mult === 1 ? t : t.slice(0, -1)) * mult;
  return neg ? -n : n;
};
const axisLabels = (lo, hi, cfg, zero = false) => {
  const t = niceTicks(lo, hi, { zero });
  return { t, labels: t.ticks.map((v) => compactMoney(v, { ...cfg, step: t.step })) };
};

test('compactMoney with the step: a balance moving little reads each gridline as its own value', () => {
  // The cases that once printed $9.98k | $9.99k | $9.99k | $10k (two of them the same, and the
  // bottom one, 9,985, named after a value 5 away): a fixed two decimals of k or M.
  assert.deepEqual(axisLabels(9985, 10000, USD).labels, ['$9,985', '$9,990', '$9,995', '$10,000']);
  assert.deepEqual(axisLabels(40100, 40120, USD).labels, ['$40,100', '$40,105', '$40,110', '$40,115', '$40,120']);
  assert.deepEqual(axisLabels(1234000, 1236000, JPY).labels, ['¥1,234k', '¥1,234.5k', '¥1,235k', '¥1,235.5k', '¥1,236k']);
  assert.deepEqual(axisLabels(3230.59, 3240, EUR).labels, ['€3,230', '€3,232.5', '€3,235', '€3,237.5', '€3,240']);
  assert.deepEqual(axisLabels(40120, 41257, USD).labels, ['$40k', '$40.5k', '$41k', '$41.5k'], 'k when the step allows');
  assert.deepEqual(axisLabels(19985, 20010, SEK).labels, ['19.98k kr', '19.99k kr', '20k kr', '20.01k kr'], 'two decimals of k at most');
  assert.deepEqual(axisLabels(-20500, -19980, SEK).labels, ['−20.6k kr', '−20.4k kr', '−20.2k kr', '−20k kr', '−19.8k kr']);
  // Cents: the step's own decimals.
  assert.deepEqual(axisLabels(0.01, 0.04, EUR).labels, ['€0.01', '€0.02', '€0.03', '€0.04']);
  assert.equal(compactMoney(0.025, { ...USD, step: 0.025 }), '$0.025');
  // The aria-label's step and ends, formatted with the same step.
  assert.equal(compactMoney(5, { ...USD, step: 5 }), '$5');
  assert.equal(compactMoney(2500, { ...USD, step: 2500 }), '$2.5k');
  // One gridline (a flat extent, step 0): the value's own precision.
  assert.equal(compactMoney(9985, { ...USD, step: 0 }), '$9,985');
});

test('compactMoney with the step: every gridline label unique and exact, over a sweep of scales', () => {
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const old = (v) => { // the fixed-precision labeller this replaced, for the Profit check below
    const a = Math.abs(v), tn = (x) => String(Number(x.toFixed(2)));
    const num = a >= 1e6 ? tn(a / 1e6) + 'M' : a >= 1e3 ? tn(a / 1e3) + 'k' : tn(a);
    return (v < 0 && num !== '0' ? '−' : '') + '$' + num;
  };
  for (let i = 0; i < 3000; i++) {
    const cfg = [USD, EUR, SEK, JPY, CHF][i % 5];
    // Balances from cents to hundreds of millions, moving from a cent to the whole balance.
    const mag = 10 ** (rnd() * 9 - 1);
    const lo = Math.round((rnd() < 0.15 ? -1 : 1) * mag * (0.5 + rnd()) * 100) / 100;
    const hi = Math.round((lo + Math.max(0.01, mag * 10 ** (-rnd() * 7))) * 100) / 100;
    for (const zero of [false, true]) {
      const { t, labels } = axisLabels(lo, hi, cfg, zero);
      assert.equal(new Set(labels).size, labels.length, `${lo}..${hi} (zero ${zero}): ${labels.join(' | ')}`);
      labels.forEach((s, j) => assert.ok(Math.abs(parseLabel(s) - t.ticks[j]) <= 1e-9 * Math.max(1, Math.abs(t.ticks[j])),
        `${lo}..${hi}: "${s}" reads ${parseLabel(s)}, the gridline is ${t.ticks[j]}`));
      // Profit (zero in the scale) in steps of a unit or more: the step is at least a quarter of
      // every label, so the labels are what they always were. (Under a unit they were cut to the
      // cent, and a step of 0.025 read $0, $0.03, $0.05, $0.07, $0.1.)
      if (zero && cfg === USD && t.step >= 1 && Math.max(Math.abs(t.lo), Math.abs(t.hi)) < 1e9) {
        assert.deepEqual(labels, t.ticks.map(old), `${lo}..${hi}`);
      }
    }
  }
});
