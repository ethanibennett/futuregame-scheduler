// node --test src/utils/__tests__/bankroll-ledger.test.mjs  (from vite-app/)
// The bankroll dashboard's pure helpers (utils/bankroll-ledger.js), the CSV import's parsing and
// presets (utils/bankroll-csv.js), and balancesFromSummary (utils/bankrolls.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  periodWindow, periodElapsed, balanceSeries, drawdowns, periodTable, bySource, within, goalProgress,
  ledgerToCsv, rollShare, fmtShare, fmtRule, sourceLabel,
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

test('rollShare / fmtShare', () => {
  const guide = { balance: 20000, rules: { mtt: { buyins: 100 } } };
  assert.deepEqual(rollShare(guide, 150), { share: 0.0075, over: false, cap: 200, buyins: 100, empty: false });
  assert.equal(rollShare(guide, 400).over, true);
  assert.equal(rollShare({ ...guide, balance: 0 }, 10).empty, true);
  assert.equal(rollShare(guide, 0), null);
  assert.deepEqual([fmtShare(0.0075), fmtShare(0.024), fmtShare(0.25)], ['0.75%', '2.4%', '25%']);
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
