// Unit tests for the expenses / income / trips helpers (src/utils/transactions.js).
//   node --test src/utils/__tests__/transactions.test.mjs      (from vite-app/; npm run test:transactions)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  EXPENSE_CATEGORIES, INCOME_CATEGORIES, categoryLabel, totalsByCategory, inYear, tripPnl,
  transactionsToCsv, TX_CSV_COLUMNS, parseAmount, shortDay, tripRange, signedAmount,
} from '../transactions.js';

const require = createRequire(import.meta.url);
const server = require('../../../../lib/bankroll-transactions.js');

const tx = (o) => ({ id: 1, kind: 'expense', category: 'food', amount: 10, currency: 'USD', occurred_on: '2026-06-02', bankroll_id: 'main', ...o });
// 1 USD = 0.5 EUR, for round numbers.
const rates = { USD: 1, EUR: 0.5 };
const convert = (v, from, to) => (from === to ? v : (from === 'USD' ? v : v / rates[from]) * (to === 'USD' ? 1 : rates[to]));

test('category keys match the server', () => {
  assert.deepEqual(EXPENSE_CATEGORIES.map((c) => c.key), server.CATEGORIES.expense);
  assert.deepEqual(INCOME_CATEGORIES.map((c) => c.key), server.CATEGORIES.income);
});

test('labels: short and long', () => {
  assert.equal(categoryLabel('expense', 'tips'), 'Dealer tips');
  assert.equal(categoryLabel('income', 'staking'), 'Staking');
  assert.equal(categoryLabel('income', 'staking', { long: true }), 'Staking settlement received');
  assert.equal(categoryLabel('expense', 'nope'), 'nope');
});

test('signedAmount: expenses negative, income positive', () => {
  assert.equal(signedAmount(tx({ amount: 12.5 })), -12.5);
  assert.equal(signedAmount(tx({ kind: 'income', amount: 12.5 })), 12.5);
});

test('totals by category, converted, in cents', () => {
  const t = totalsByCategory([
    tx({ category: 'food', amount: 0.1 }), tx({ category: 'food', amount: 0.2 }),
    tx({ category: 'lodging', amount: 100, currency: 'EUR' }),
    tx({ kind: 'income', category: 'rakeback', amount: 50 }),
  ], { currency: 'USD', convert });
  assert.equal(t.expenses, 200.3, '0.1 + 0.2 is 0.3 here, and 100 EUR is 200 USD');
  assert.equal(t.income_total, 50);
  assert.equal(t.net, -150.3);
  assert.deepEqual(t.expense.map((c) => [c.key, c.amount, c.count]), [['lodging', 200, 1], ['food', 0.3, 2]]);
  assert.equal(t.count, 4);
  assert.equal(totalsByCategory([]).net, 0);
});

test('inYear reads the year off the string', () => {
  const rows = [tx({ occurred_on: '2025-12-31' }), tx({ occurred_on: '2026-01-01' })];
  assert.deepEqual(inYear(rows, 2026).map((r) => r.occurred_on), ['2026-01-01']);
});

test('trip P&L: results (native currency) + income - expenses', () => {
  const data = {
    results: [
      { venue: 'Vegas', buyin: 500, num_entries: 2, cashed: 1, cash_amount: 3000 },
      { venue: 'Dublin', buyin: 100, num_entries: 1, cashed: 0, cash_amount: 0 },
    ],
    transactions: [tx({ category: 'lodging', amount: 600 }), tx({ kind: 'income', category: 'bonus', amount: 25 })],
  };
  const p = tripPnl(data, { currency: 'USD', convert, nativeCurrency: (v) => (v === 'Dublin' ? 'EUR' : 'USD') });
  assert.equal(p.events, 2);
  assert.equal(p.cashes, 1);
  assert.equal(p.buyins, 1200, '1,000 + 100 EUR (= 200 USD)');
  assert.equal(p.cashed, 3000);
  assert.equal(p.results, 1800);
  assert.equal(p.expenses, 600);
  assert.equal(p.income, 25);
  assert.equal(p.net, 1225);
  const empty = tripPnl({ results: [], transactions: [] });
  assert.equal(empty.net, 0);
  assert.equal(empty.cash.sessions, 0);
  assert.equal(empty.cash.hourly, null);
});

test('trip P&L: the cash sessions played inside it count, at the ledger amount', () => {
  const data = {
    results: [{ venue: 'Vegas', buyin: 600, num_entries: 2, cashed: 0, cash_amount: 0 }],
    cash_sessions: [
      { amount: 430, currency: 'USD', hours: 5 },
      { amount: -100, currency: 'EUR', hours: 2.5 }, // -200 USD
      { amount: 50, currency: 'USD', hours: null },   // no end time: in the profit, not the hourly
    ],
    transactions: [tx({ category: 'lodging', amount: 300 })],
  };
  const p = tripPnl(data, { currency: 'USD', convert, nativeCurrency: () => 'USD' });
  assert.deepEqual(p.tournaments, { events: 1, bullets: 2, cashes: 0, cost: 1200, cashed: 0, profit: -1200 });
  assert.equal(p.cash.sessions, 3);
  assert.equal(p.cash.profit, 280);
  assert.equal(p.cash.hours, 7.5);
  assert.equal(p.cash.hourly, 230 / 7.5, 'the timed sessions over their hours');
  assert.equal(p.results, -920, 'tournaments + cash');
  assert.equal(p.net, -1220, 'results - lodging');
  assert.equal(p.unconverted, 0);
  // A rate it cannot find is counted, so the home can show a dash instead of a part-total.
  const q = tripPnl(data, { currency: 'USD', convert: (v, f, t) => (f === t ? v : NaN), nativeCurrency: () => 'USD' });
  assert.equal(q.unconverted, 1);
});

test('CSV: columns, sign, formula guard, BOM, CRLF, oldest first', () => {
  const csv = transactionsToCsv([
    tx({ id: 2, occurred_on: '2026-06-03', kind: 'income', category: 'rakeback', amount: 55.5, note: '=SUM(A1)' }),
    tx({ id: 1, occurred_on: '2026-06-02', category: 'lodging', amount: 412.37, note: 'Rio, "3" nights', trip_name: 'Vegas' }),
  ], { bankrollName: (id) => (id === 'main' ? 'Main' : 'X') });
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], TX_CSV_COLUMNS.join(','));
  assert.equal(lines[1], '2026-06-02,Expense,Lodging,412.37,USD,-412.37,Main,Vegas,,,"Rio, ""3"" nights"');
  assert.equal(lines[2], "2026-06-03,Income,Rakeback,55.5,USD,55.5,Main,,,,'=SUM(A1)");
  assert.equal(lines[3], '');
});

test('parseAmount: what a thumb types', () => {
  assert.equal(parseAmount('12'), 12);
  assert.equal(parseAmount(' $1,250.75 '), 1250.75);
  assert.equal(parseAmount('12,50'), 12.5);
  assert.equal(parseAmount('.5'), 0.5);
  assert.equal(parseAmount('19.999'), 20);
  for (const bad of ['', '0', '-5', 'abc', '1.2.3', '.', null]) assert.equal(parseAmount(bad), null, String(bad));
});

test('dates by hand', () => {
  assert.equal(shortDay('2026-06-04'), 'Jun 4');
  assert.equal(shortDay('2026-06-04', { year: true }), 'Jun 4, 2026');
  assert.equal(tripRange('2026-06-01', '2026-06-10'), 'Jun 1 – 10, 2026');
  assert.equal(tripRange('2026-06-28', '2026-07-03'), 'Jun 28 – Jul 3, 2026');
  assert.equal(tripRange('2026-12-30', '2027-01-02'), 'Dec 30, 2026 – Jan 2, 2027');
  assert.equal(tripRange('2026-06-01', '2026-06-01'), 'Jun 1, 2026');
});
