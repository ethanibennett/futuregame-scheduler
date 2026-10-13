// node --test src/utils/__tests__/bankroll-overview.test.mjs  (from vite-app/)
// The bankroll Overview's tables (utils/bankroll-overview.js): Summary, Sessions, Games / Rooms,
// Bankroll, the formatting, the open / closed state, and whose figures the ledger in hand holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DASH, SECTIONS, parseOpen, fmtMoney, moneySign, fmtPct, fmtCount, fmtHours, fmtRatio,
  summaryTable, sessionsTable, groupTable, bankrollFigures, overviewTables, ledgerScope, sameScope,
} from '../bankroll-overview.js';
import { overviewStats, rangeWindow, within } from '../bankroll-ledger.js';

const MINUS = '−';
const USD = { symbol: '$', pos: 'pre' };

// A ledger as GET /api/bankrolls/ledger returns it: sorted, display amounts, running totals.
function ledger(rows, opening = 0) {
  let total = opening;
  return rows.map(([date, source, kind, amount, extra = {}], i) => {
    total = Math.round((total + amount) * 100) / 100;
    return {
      date, source, kind, amount, amount_display: amount, total_display: total, balance_display: total,
      fx_display: 1, bankroll: 'main', currency: 'USD', label: `${kind} ${i}`, ref: { table: source, id: i }, ...extra,
    };
  });
}
const cashRow = (date, buyIn, cashOut, { tips = 0, expenses = 0, rebuys = 0, hours = 4 } = {}) =>
  [date, 'cash-sessions', 'cash_session', cashOut - buyIn - tips - expenses, { buy_in: buyIn, cash_out: cashOut, tips, expenses, rebuys, hours }];
const tournRow = (date, buyin, bullets, cash) =>
  [date, 'tournaments', 'tournament', cash - buyin * bullets, { units: bullets, cost: buyin * bullets, cash, buyin_per_entry: buyin }];

const L = ledger([
  ['2026-01-02', 'adjustments', 'deposit', 5000],
  tournRow('2026-01-10', 300, 2, 0),            // -600
  tournRow('2026-01-17', 200, 1, 1400),         // +1200
  cashRow('2026-02-01', 1000, 1650, { tips: 30, expenses: 20, hours: 5 }), // +600
  cashRow('2026-02-08', 1000, 300, { rebuys: 1, hours: 3 }),              // -700
  ['2026-02-09', 'transactions', 'expense', -125.5],
  tournRow('2026-03-01', 500, 1, 0),            // -500
  ['2026-03-04', 'transactions', 'income', 340],
  ['2026-03-10', 'adjustments', 'withdrawal', -1000],
  cashRow('2026-03-12', 500, 900, { hours: 0 }), // +400, untimed
], 1000);

test('Summary: each column adds up, and Total = Cash + Tournaments (+ expenses, + money moved)', () => {
  const s = summaryTable(L);
  // Cash: cash-outs − buy-ins + tips & costs = net, every session.
  assert.deepEqual(s.cash, { buyins: 2500, cashouts: 2850, costs: -50, net: 300, result: 300 });
  assert.equal(s.cash.cashouts - s.cash.buyins + s.cash.costs, s.cash.net);
  // Tournaments: cost is buy-in x bullets; the cash counts once.
  assert.deepEqual(s.tournaments, { buyins: 1300, cashouts: 1400, costs: null, net: 100, result: 100 });
  assert.equal(s.tournaments.cashouts - s.tournaments.buyins, s.tournaments.net);
  const t = s.total;
  assert.equal(t.buyins, s.cash.buyins + s.tournaments.buyins);
  assert.equal(t.cashouts, s.cash.cashouts + s.tournaments.cashouts);
  assert.equal(t.net, s.cash.net + s.tournaments.net);
  assert.equal(t.other, 214.5);
  assert.equal(t.result, s.cash.result + s.tournaments.result + t.other);
  assert.equal(t.moved, 4000);
  assert.equal(t.change, t.result + t.moved);
  assert.equal(s.showCosts, true);
  // The balance change is what the running total did.
  assert.equal(t.change, L[L.length - 1].total_display - 1000);
});

test('Summary: Total result is the Overview hero\'s profit (overviewStats) for every range', () => {
  for (const range of ['1m', '3m', 'ytd', '1y', 'all']) {
    const win = within(L, rangeWindow(range, '2026-03-20'));
    const s = summaryTable(win);
    const hero = overviewStats(win).results;
    if (win.some((e) => !['deposit', 'withdrawal'].includes(e.kind))) assert.equal(s.total.result, hero, range);
  }
});

test('Summary: an empty column is null (a dash), never 0', () => {
  const onlyCash = summaryTable(L.filter((e) => e.source === 'cash-sessions'));
  assert.deepEqual(onlyCash.tournaments, { buyins: null, cashouts: null, costs: null, net: null, result: null });
  assert.equal(onlyCash.total.other, null);
  assert.equal(onlyCash.total.moved, null);
  assert.equal(onlyCash.total.result, 300);
  const empty = summaryTable([]);
  for (const col of [empty.cash, empty.tournaments, empty.total]) for (const v of Object.values(col)) assert.equal(v, null);
  assert.equal(fmtMoney(empty.total.result, USD), DASH);
  assert.equal(empty.showCosts, false);
  // No tips or costs anywhere: the row is not shown.
  assert.equal(summaryTable(L.filter((e) => e.source === 'tournaments')).showCosts, false);
});

test('Summary: a cash session without the money fields (an older server) leaves buy-ins unknown, not short', () => {
  const old = L.map((e) => (e.source === 'cash-sessions' ? { ...e, buy_in: undefined, cash_out: undefined } : e));
  const s = summaryTable(old);
  assert.equal(s.cash.buyins, null);
  assert.equal(s.cash.net, 300);
  assert.equal(s.total.buyins, null);
  assert.equal(s.total.net, 400);
});

test('Summary: other currencies come onto the display scale through fx_display', () => {
  const eur = ledger([tournRow('2026-01-10', 100, 1, 300)]).map((e) => ({ ...e, amount_display: 220, fx_display: 1.1 }));
  const s = summaryTable(eur);
  assert.equal(s.tournaments.buyins, 110);
  assert.equal(s.tournaments.cashouts, 330);
  assert.equal(s.tournaments.cashouts - s.tournaments.buyins, s.tournaments.net);
});

test('Sessions: counts, cash-only hours and $/h, tournament ROI and ITM, averages, extremes', () => {
  const s = sessionsTable(L);
  assert.equal(s.cash.count, 3);
  assert.equal(s.cash.hours, 8);                          // the untimed session adds no hours
  assert.equal(s.cash.hourly, (600 - 700) / 8);           // nor profit to the hourly
  assert.equal(s.cash.roi, null);
  assert.equal(s.cash.won, 2 / 3);
  assert.equal(s.cash.avgBuyin, Math.round(2500 / 3 * 100) / 100);
  assert.equal(s.cash.avgProfit, 100);
  assert.equal(s.cash.avgRebuys, 1 / 3);
  assert.equal(s.tournaments.count, 3);
  assert.equal(s.tournaments.bullets, 4);
  assert.equal(s.tournaments.hours, null);                 // no playing time on a result: never guessed
  assert.equal(s.tournaments.hourly, null);
  assert.equal(s.tournaments.roi, 100 / 1300);
  assert.equal(s.tournaments.won, 1 / 4);                 // ITM per entry: 1 cash in 4 bullets
  assert.equal(s.tournaments.avgBuyin, Math.round(1300 / 3 * 100) / 100);
  assert.equal(s.tournaments.avgRebuys, 1 / 3);           // 4 bullets over 3 events
  assert.deepEqual([s.tournaments.best.amount, s.tournaments.worst.amount], [1200, -600]);
  assert.deepEqual([s.cash.best.amount, s.cash.worst.amount], [600, -700]);
  // Total: counts and averages over both; extremes of both; per-type ratios refused when mixed.
  assert.equal(s.total.count, 6);
  assert.equal(s.total.avgProfit, Math.round((300 + 100) / 6 * 100) / 100);
  assert.equal(s.total.avgBuyin, Math.round((2500 + 1300) / 6 * 100) / 100);
  assert.equal(s.total.avgRebuys, (1 + 1) / 6);
  assert.deepEqual([s.total.best.amount, s.total.worst.amount], [1200, -700]);
  for (const k of ['hours', 'hourly', 'roi', 'won', 'bullets']) assert.equal(s.total[k], null, k);
});

test('Sessions: one kind only, the Total carries its ratios; nothing at all is all null', () => {
  const cashOnly = sessionsTable(L.filter((e) => e.source === 'cash-sessions'));
  assert.equal(cashOnly.total.hourly, cashOnly.cash.hourly);
  assert.equal(cashOnly.total.won, cashOnly.cash.won);
  assert.equal(cashOnly.tournaments.count, null);
  const tOnly = sessionsTable(L.filter((e) => e.source === 'tournaments'));
  assert.equal(tOnly.total.roi, tOnly.tournaments.roi);
  assert.equal(tOnly.total.hours, null);
  const none = sessionsTable([]);
  for (const col of [none.cash, none.tournaments, none.total]) for (const v of Object.values(col)) assert.equal(v, null);
});

test('Games and rooms: one row per name per side, case-folded, in the window, best first, unnamed last', () => {
  const facts = [
    { type: 'cash', date: '2026-02-01', game: 'NLH', room: 'Borgata', profit: 600, hours: 5 },
    { type: 'cash', date: '2026-02-08', game: 'nlh ', room: 'Parx', profit: -700, hours: 3 },
    { type: 'cash', date: '2026-03-12', game: 'PLO', room: 'Borgata', profit: 400, hours: 0 },
    { type: 'tournament', date: '2026-01-10', game: 'NLH', room: 'Borgata', profit: -600, cost: 600, bullets: 2 },
    { type: 'tournament', date: '2026-01-17', game: '', room: 'Parx', profit: 1200, cost: 200, bullets: 1 },
    { type: 'tournament', date: '2026-03-01', game: 'NLH', room: 'Borgata', profit: -500, cost: 500, bullets: 1 },
    { type: 'expense', date: '2026-02-09', game: '', room: '', profit: -125.5 },
    { type: 'cash', date: '2025-12-01', game: 'NLH', room: 'Borgata', profit: 9999, hours: 1 }, // outside
  ];
  const w = { from: '2026-01-01', to: '2026-03-20' };
  const g = groupTable(facts, 'game', w);
  assert.deepEqual(g.cash.map((r) => [r.label, r.n, r.hours, r.rate, r.total]), [
    ['PLO', 1, null, null, 400],            // untimed: no hours, no $/h
    ['NLH', 2, 8, -100 / 8, -100],
  ]);
  assert.deepEqual(g.tournament.map((r) => [r.label, r.n, r.hours, r.total]), [
    ['NLH', 2, null, -1100],
    [null, 1, null, 1200],                  // not recorded: last, whatever its total
  ]);
  assert.equal(g.tournament[0].rate, -1100 / 1100);
  assert.equal(g.named, 2);
  // Each side's rows add up to that column's net in the Summary over the same rows.
  const s = summaryTable(L);
  assert.equal(g.cash.reduce((a, r) => a + r.total, 0), s.cash.net);
  assert.equal(g.tournament.reduce((a, r) => a + r.total, 0), s.tournaments.net);
  const r = groupTable(facts, 'room', w);
  assert.deepEqual(r.cash.map((x) => [x.label, x.total]), [['Borgata', 1000], ['Parx', -700]]);
  assert.deepEqual(r.tournament.map((x) => [x.label, x.total]), [['Parx', 1200], ['Borgata', -1100]]);
  assert.equal(r.named, 2);
  assert.equal(groupTable([], 'room').empty, true);
});

test('Bankroll: balance, all-time peak and how far below it, the drawdown in the range, money moved', () => {
  const d = { entries: L, opening: { total_display: 1000 }, closing: { total_display: L[L.length - 1].total_display } };
  const all = bankrollFigures(d, 'all', '2026-03-20');
  assert.equal(all.balance, 5614.5);
  assert.deepEqual(all.peak, { value: 7200, date: '2026-02-01' });
  assert.equal(all.below, 7200 - 5614.5);
  assert.equal(all.drawdown.amount, 7200 - 5214.5);              // to the trough before the last session
  assert.equal(all.moved, 4000);
  // 1M: only the March rows; the peak stays all time; the drawdown is measured inside the range.
  const m = bankrollFigures(d, '1m', '2026-03-20');
  assert.deepEqual(m.peak, all.peak);
  assert.equal(m.moved, -1000);
  assert.deepEqual(m.drawdown, { amount: 6374.5 - 5214.5, from: '2026-02-21', to: '2026-03-10' });
});

test('overviewTables: by month within a range, by year for All', () => {
  const d = { entries: L, opening: { total_display: 1000 }, closing: { total_display: L[L.length - 1].total_display } };
  assert.equal(overviewTables(d, 'ytd', '2026-03-20').bucket, 'month');
  assert.deepEqual(overviewTables(d, 'ytd', '2026-03-20').periods.map((p) => p.key), ['2026-03', '2026-02', '2026-01']);
  assert.deepEqual(overviewTables(d, 'all', '2026-03-20').periods.map((p) => p.key), ['2026']);
});

test('formatting: compact money from 10k, signs, dashes, the currency\'s own symbol and side', () => {
  assert.equal(fmtMoney(1239, USD), '$1,239');
  assert.equal(fmtMoney(9999.6, USD), '$10.0k');
  assert.equal(fmtMoney(403249, USD), '$403.2k');
  assert.equal(fmtMoney(-12345, USD, { sign: true }), `${MINUS}$12.3k`);
  assert.equal(fmtMoney(999960, USD), '$1.0M');
  assert.equal(fmtMoney(1234567, USD, { sign: true }), '+$1.2M');
  assert.equal(fmtMoney(0, USD, { sign: true }), '$0');
  assert.equal(fmtMoney(-0.4, USD, { sign: true }), '$0');
  assert.equal(fmtMoney(1500, { symbol: '€', pos: 'pre' }), '€1,500');
  assert.equal(fmtMoney(-25000, { symbol: 'kr', pos: 'suf' }, { sign: true }), `${MINUS}25.0k kr`);
  for (const bad of [null, undefined, NaN, Infinity]) assert.equal(fmtMoney(bad, USD), DASH);
  assert.equal(fmtPct(0.0769, { sign: true }), '+7.7%');
  assert.equal(fmtPct(-0.42, { sign: true }), `${MINUS}42%`);
  assert.equal(fmtPct(0), '0%');
  assert.equal(fmtPct(null), DASH);
  assert.equal(fmtCount(1234), '1,234');
  assert.equal(fmtCount(null), DASH);
  assert.equal(fmtHours(8), '8.0');
  assert.equal(fmtHours(412.4), '412');
  assert.equal(fmtHours(null), DASH);
  assert.equal(fmtRatio(1 / 3), '0.33');
  assert.equal(fmtRatio(null), DASH);
});

test('formatting: compact money rounds once, from the unrounded value', () => {
  // 13,349.63 (the seed's IPO Main Event, EUR 11,950 x 1.117124) is $13.3k, not $13.4k: rounding to
  // whole units first (13,350) and then to tenths of k pushed it over the .x5 edge.
  assert.equal(fmtMoney(13349.63, USD), '$13.3k');
  assert.equal(fmtMoney(13349.63, USD, { sign: true }), '+$13.3k');
  assert.equal(fmtMoney(-13349.63, USD, { sign: true }), `${MINUS}$13.3k`);
  assert.equal(fmtMoney(1249999.6, USD), '$1.2M');
  assert.equal(fmtMoney(999949.9, USD), '$999.9k');
  assert.equal(fmtMoney(999950, USD), '$1.0M');
  assert.equal(fmtMoney(9999.4, USD), '$9,999');
});

test('sign as drawn: a figure that shows as 0 has no sign and no colour', () => {
  // moneySign is what the tables colour by: the sign of the whole units fmtMoney draws.
  assert.equal(moneySign(-0.375), 0);                 // a rate of -0.375/h draws "$0": not red
  assert.equal(fmtMoney(-0.375, USD, { sign: true }), '$0');
  assert.equal(moneySign(0.49), 0);
  assert.equal(moneySign(-0.5), 0);                   // Math.round(-0.5) is -0: "$0", unsigned
  assert.equal(fmtMoney(-0.5, USD, { sign: true }), '$0');
  assert.equal(moneySign(-0.51), -1);
  assert.equal(fmtMoney(-0.51, USD, { sign: true }), `${MINUS}$1`);
  assert.equal(moneySign(0.5), 1);
  assert.equal(fmtMoney(0.5, USD, { sign: true }), '+$1');
  assert.equal(moneySign(-13349.63), -1);
  for (const bad of [null, undefined, NaN]) assert.equal(moneySign(bad), 0);
  // Every value: the sign drawn and the colour agree.
  for (let v = -3; v <= 3; v += 0.01) {
    const text = fmtMoney(v, USD, { sign: true });
    const drawn = text.startsWith(MINUS) ? -1 : text.startsWith('+') ? 1 : 0;
    assert.equal(moneySign(v), drawn, String(v));
  }
  // Percentages likewise: -0.04% draws as 0%, not "-0.0%".
  assert.equal(fmtPct(-0.0004, { sign: true }), '0%');
  assert.equal(fmtPct(0.0004, { sign: true }), '0%');
  assert.equal(fmtPct(-0.0006, { sign: true }), `${MINUS}0.1%`);
});

test('open state: Summary and Sessions open by default; saved booleans win; junk is ignored', () => {
  assert.deepEqual(parseOpen(null), { summary: true, sessions: true, games: false, rooms: false, bankroll: false, periods: false });
  assert.deepEqual(parseOpen('{"games":true,"summary":false,"nope":true,"rooms":"yes"}'),
    { summary: false, sessions: true, games: true, rooms: false, bankroll: false, periods: false });
  assert.deepEqual(parseOpen('not json'), parseOpen(null));
  assert.deepEqual(parseOpen('[1,2]'), parseOpen(null));
  assert.equal(SECTIONS.length, 6);
});

test('scope: the figures name, format and fetch by the ledger in hand, stale until it is the one asked for', () => {
  const bankrolls = [{ id: 'main', name: 'Main' }, { id: 7, name: 'Euro' }, { id: 9, name: 'Online' }];
  // Settled: the ledger is the one asked for.
  assert.deepEqual(ledgerScope({ bankroll: 'all', currency: 'USD' }, { key: 'all', currency: 'USD', bankrolls }),
    { key: 'all', currency: 'USD', name: 'All bankrolls', stale: false });
  assert.deepEqual(ledgerScope({ bankroll: 7, currency: 'EUR' }, { key: 7, currency: 'EUR', bankrolls }),
    { key: '7', currency: 'EUR', name: 'Euro', stale: false });
  assert.equal(ledgerScope({ bankroll: 'main', currency: 'USD' }, { key: 'main', currency: 'USD', bankrolls }).name, 'Main');
  // The chip moved to Euro, the All ledger is still on screen: name and currency stay the ledger's.
  assert.deepEqual(ledgerScope({ bankroll: 'all', currency: 'USD' }, { key: 7, currency: 'EUR', bankrolls }),
    { key: 'all', currency: 'USD', name: 'All bankrolls', stale: true });
  // Same bankroll, another display currency: stale too.
  assert.equal(ledgerScope({ bankroll: 7, currency: 'USD' }, { key: 7, currency: 'EUR', bankrolls }).stale, true);
  // An older response without the fields falls back to what was asked for.
  assert.deepEqual(ledgerScope({}, { key: 9, currency: 'USD', bankrolls }), { key: '9', currency: 'USD', name: 'Online', stale: false });
  assert.equal(ledgerScope({ bankroll: 42, currency: 'USD' }, { key: 42, currency: 'USD', bankrolls }).name, 'Bankroll');

  // Risk and reports name their scope; a reply for another bankroll or currency is not this one's.
  const sc = ledgerScope({ bankroll: 7, currency: 'EUR' }, { key: 7, currency: 'EUR', bankrolls });
  assert.equal(sameScope({ bankroll: 7, currency: 'EUR' }, sc), true);
  assert.equal(sameScope({ bankroll: '7', currency: 'EUR' }, sc), true);
  assert.equal(sameScope({ bankroll: 'all', currency: 'EUR' }, sc), false);
  assert.equal(sameScope({ bankroll: 7, currency: 'USD' }, sc), false);
  for (const bad of [null, undefined, {}, { currency: 'EUR' }]) assert.equal(sameScope(bad, sc), false);
});
