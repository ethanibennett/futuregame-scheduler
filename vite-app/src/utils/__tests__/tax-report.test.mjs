// Unit tests for the tax-ready year-end report math (src/utils/tax-report.js).
//   node --test src/utils/__tests__/tax-report.test.mjs      (from vite-app/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  w2gThreshold, isLikelyW2G, lossDeductionRate, parseIsoDate, defaultTaxYear, availableYears,
  buildTaxReport, filingComparison, sessionsToCsv, CSV_COLUMNS,
} from '../tax-report.js';

const row = (o) => ({ id: Math.random(), event_name: 'NLH', venue: 'Some Casino', buyin: 100, num_entries: 1, cashed: 0, cash_amount: 0, ...o });

test('W-2G threshold: $5,000 strict through 2025, $2,000 inclusive from 2026', () => {
  assert.deepEqual([w2gThreshold(2025).amount, w2gThreshold(2025).inclusive], [5000, false]);
  assert.deepEqual([w2gThreshold(2018).amount, w2gThreshold(2018).inclusive], [5000, false]);
  assert.deepEqual([w2gThreshold(2026).amount, w2gThreshold(2026).inclusive], [2000, true]);
  assert.equal(w2gThreshold(2026).provisional, false);
  assert.equal(w2gThreshold(2027).provisional, true, 'inflation-indexed years beyond the table are flagged');
});

test('W-2G edge: 2025 needs MORE than $5,000 net of the buy-in', () => {
  assert.equal(isLikelyW2G(6000, 1000, 2025), false, 'net exactly 5,000 is not more than 5,000');
  assert.equal(isLikelyW2G(6001, 1000, 2025), true, 'net 5,001');
  assert.equal(isLikelyW2G(5500, 600, 2025), false, 'gross over 5,000 but net 4,900');
  assert.equal(isLikelyW2G(5000.01, 0, 2025), true, 'a cent over');
});

test('W-2G edge: 2026 is met at exactly $2,000 net of the buy-in', () => {
  assert.equal(isLikelyW2G(2400, 400, 2026), true, 'net exactly 2,000 meets the threshold');
  assert.equal(isLikelyW2G(2399, 400, 2026), false, 'net 1,999');
  assert.equal(isLikelyW2G(0, 0, 2026), false, 'no cash, no form');
  assert.equal(isLikelyW2G(2000, 0, 2026), true);
});

test('loss deduction: 100% through 2025, 90% from 2026', () => {
  assert.equal(lossDeductionRate(2025), 1);
  assert.equal(lossDeductionRate(2026), 0.9);
  assert.equal(lossDeductionRate(2030), 0.9);
});

test('ISO dates are read by hand, never through Date', () => {
  assert.deepEqual(parseIsoDate('2025-01-01'), { y: 2025, m: 1, d: 1 });
  assert.deepEqual(parseIsoDate('2025-12-31T23:59:00Z'), { y: 2025, m: 12, d: 31 });
  assert.equal(parseIsoDate('Jan 1, 2025'), null);
  assert.equal(parseIsoDate('2025-13-01'), null);
  assert.equal(parseIsoDate(null), null);
  assert.equal(defaultTaxYear('2026-10-10'), 2025);
  assert.equal(defaultTaxYear('2026-01-01'), 2025);
});

test('year boundaries: Jan 1 and Dec 31 land in their own year, whatever the local zone', () => {
  const prevTZ = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles'; // west of UTC: new Date('2025-01-01') would be Dec 31, 2024
  try {
    const entries = [
      row({ id: 1, date: '2024-12-31', buyin: 10 }),
      row({ id: 2, date: '2025-01-01', buyin: 20 }),
      row({ id: 3, date: '2025-12-31', buyin: 30 }),
      row({ id: 4, date: '2026-01-01', buyin: 40 }),
    ];
    const r = buildTaxReport(entries, { year: 2025 });
    assert.deepEqual(r.sessions.map((s) => s.id), [2, 3]);
    assert.equal(r.totals.totalBuyins, 50);
    assert.equal(r.months[0].buyins, 20, 'January');
    assert.equal(r.months[11].buyins, 30, 'December');
  } finally {
    if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ;
  }
});

test('availableYears: newest first, always offers the default year', () => {
  const entries = [row({ date: '2023-05-01' }), row({ date: '2025-02-02' }), row({ date: 'garbage' })];
  assert.deepEqual(availableYears(entries, '2026-10-10'), [2025, 2023]);
  assert.deepEqual(availableYears([], '2026-10-10'), [2025]);
});

test('totals, per-month subtotals and the per-session view', () => {
  const entries = [
    row({ date: '2025-03-04', buyin: 1000, num_entries: 2, cashed: 1, cash_amount: 9000 }), // net +7000
    row({ date: '2025-03-20', buyin: 500 }),                                                 // net -500
    row({ date: '2025-07-01', buyin: 300, cashed: 1, cash_amount: 200 }),                    // net -100
  ];
  const r = buildTaxReport(entries, { year: 2025 });
  assert.equal(r.totals.sessions, 3);
  assert.equal(r.totals.cashes, 2);
  assert.equal(r.totals.grossWinnings, 9200);
  assert.equal(r.totals.totalBuyins, 2800);
  assert.equal(r.totals.net, 6400);
  assert.equal(r.totals.sessionWinnings, 7000);
  assert.equal(r.totals.sessionLosses, 600);
  assert.deepEqual(
    [r.months[2].sessions, r.months[2].cashes, r.months[2].winnings, r.months[2].buyins, r.months[2].net],
    [2, 1, 9000, 2500, 6500],
  );
  assert.equal(r.months[6].net, -100);
  assert.equal(r.months.reduce((s, m) => s + m.net, 0), r.totals.net, 'months sum to the year');
  // W-2G: 9000 - ONE 1000 buy-in = 8000 > 5000. The 200 cash is not.
  assert.equal(r.w2g.length, 1);
  assert.equal(r.w2g[0].w2gNet, 8000);
});

test('a cashed row with no amount counts as no cash', () => {
  const r = buildTaxReport([row({ date: '2025-01-05', cashed: 1, cash_amount: 0, buyin: 100 })], { year: 2025 });
  assert.equal(r.totals.cashes, 0);
  assert.equal(r.sessions[0].net, -100);
  assert.equal(r.w2g.length, 0);
});

test('online rows carry the site and no location; live rows carry city/state, else region', () => {
  const r = buildTaxReport([
    row({ date: '2025-02-01', is_online: 1, site: 'WSOP.com', venue: 'WSOP Online', city_state: 'x' }),
    row({ date: '2025-02-02', city_state: 'Bensalem, PA', region: 'PA' }),
    row({ date: '2025-02-03', region: 'NV' }),
  ], { year: 2025 });
  assert.deepEqual(r.sessions.map((s) => [s.online, s.site, s.location]),
    [[true, 'WSOP.com', ''], [false, '', 'Bensalem, PA'], [false, '', 'NV']]);
});

test('non-USD rows: excluded from totals without a converter, converted with one, never W-2G', () => {
  const entries = [
    row({ date: '2025-04-01', currency: 'EUR', buyin: 1000, cashed: 1, cash_amount: 20000 }),
    row({ date: '2025-04-02', buyin: 100 }),
  ];
  const a = buildTaxReport(entries, { year: 2025 });
  assert.equal(a.totals.sessions, 1);
  assert.equal(a.totals.totalBuyins, 100);
  assert.equal(a.notes.unconverted, 1);
  assert.equal(a.w2g.length, 0, 'a foreign payer issues no W-2G');
  const b = buildTaxReport(entries, { year: 2025, toUSD: (v) => v * 1.1 });
  assert.equal(b.totals.sessions, 2);
  assert.equal(b.totals.grossWinnings, 22000);
  assert.equal(b.totals.totalBuyins, 1200);
  assert.equal(b.notes.converted, 1);
  assert.equal(b.w2g.length, 0);
});

test('a USD cash at a room outside the US is not a W-2G candidate', () => {
  const big = { date: '2026-01-10', buyin: 1000, cashed: 1, cash_amount: 50000 };
  const r = buildTaxReport([
    row({ ...big, country: 'BS' }),          // WSOP Paradise, Bahamas, paid in USD
    row({ ...big, region: 'PANAMA' }),
    row({ ...big, region: 'NV' }),
    row({ ...big }),                          // unknown location: assume US
    row({ ...big, country: 'US', region: 'LA' }),
  ], { year: 2026 });
  assert.deepEqual(r.sessions.map((s) => s.likelyW2G), [false, false, true, true, true]);
  assert.equal(r.totals.grossWinnings, 250000, 'still income, just no form');
});

test('bankroll filter (optional, unwired): one bankroll, or all when omitted', () => {
  const entries = [
    row({ date: '2025-05-01', buyin: 100, bankroll_id: 1 }),
    row({ date: '2025-05-02', buyin: 200, bankroll_id: 2 }),
    row({ date: '2025-05-03', buyin: 400 }),
  ];
  assert.equal(buildTaxReport(entries, { year: 2025 }).totals.totalBuyins, 700);
  assert.equal(buildTaxReport(entries, { year: 2025, bankrollId: 2 }).totals.totalBuyins, 200);
  assert.equal(buildTaxReport(entries, { year: 2025, bankrollId: '1' }).totals.totalBuyins, 100);
});

test('filing comparison 2025: losses deductible in full, up to winnings', () => {
  const f = filingComparison(10000, 4000, 2025);
  assert.equal(f.allowedLoss, 4000);
  assert.equal(f.recreational.income, 10000);
  assert.equal(f.recreational.taxableIfItemizing, 6000);
  assert.equal(f.recreational.taxableIfStandard, 10000);
  assert.equal(f.recreational.agiAdded, 10000);
  assert.equal(f.professional.netProfit, 6000);
  assert.equal(f.professional.agiAdded, 6000);
  const capped = filingComparison(3000, 8000, 2025);
  assert.equal(capped.allowedLoss, 3000, 'capped at winnings');
  assert.equal(capped.professional.netProfit, 0, 'no net loss from wagering');
  assert.equal(capped.disallowedLoss, 5000);
});

test('filing comparison 2026: 90% of losses FIRST, then the cap at winnings', () => {
  const f = filingComparison(100000, 100000, 2026);
  assert.equal(f.allowedLoss, 90000, 'break-even year still leaves $10,000 of income');
  assert.equal(f.recreational.taxableIfItemizing, 10000);
  assert.equal(f.professional.netProfit, 10000);
  // 90% of 120,000 = 108,000, then capped at 100,000 (not 90% of the capped 100,000).
  assert.equal(filingComparison(100000, 120000, 2026).allowedLoss, 100000);
  assert.equal(filingComparison(0, 5000, 2026).allowedLoss, 0, 'no winnings, no deduction');
  assert.equal(filingComparison(1000, 333.33, 2026).allowedLoss, 300, 'rounded to the cent');
});

test('report carries both bases and the year rule', () => {
  const r = buildTaxReport([row({ date: '2026-02-01', buyin: 1000, cashed: 1, cash_amount: 3000 })], { year: 2026 });
  assert.equal(r.lossRate, 0.9);
  assert.equal(r.filing.gross.winnings, 3000);
  assert.equal(r.filing.gross.losses, 1000);
  assert.equal(r.filing.gross.allowedLoss, 900);
  assert.equal(r.filing.session.winnings, 2000);
  assert.equal(r.filing.session.losses, 0);
  assert.equal(r.w2g.length, 1, '3000 - 1000 = 2000 meets the 2026 threshold');
});

test('CSV: header, escaping, formula guard, BOM and CRLF', () => {
  const r = buildTaxReport([
    row({ date: '2025-06-01', event_name: 'NLH, "Big" Stack', venue: '=HYPERLINK("x")', buyin: 250, cashed: 1, cash_amount: 7000, finish_place: 3 }),
  ], { year: 2025 });
  const csv = sessionsToCsv(r);
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], CSV_COLUMNS.join(','));
  assert.ok(lines[1].includes('"NLH, ""Big"" Stack"'));
  assert.ok(lines[1].includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(lines[1].endsWith(',likely'));
  assert.ok(lines[1].includes(',250,1,250,7000,6750,3,'));
  assert.equal(lines[2], '');
});
