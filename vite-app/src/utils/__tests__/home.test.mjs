// node --test src/utils/__tests__/home.test.mjs   (from vite-app/; or `npm run test:home` from the root)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resultMoney, convertMoney, tournamentTotals, homeCurrency } from '../home.js';

// GET /api/tracking rows: each carries its own buyin and venue (joined from tournaments).
const VENUE_CURRENCY = { 'Irish Poker Open': 'EUR', 'WSOP Europe': 'EUR' };
const currencyOf = (r) => VENUE_CURRENCY[r.venue] || 'USD';
const groupOf = (r) => r.venue;
const rates = { USD: 1, EUR: 0.5, GBP: 0.8 };

test('one result: the ledger rule, from the row alone', () => {
  assert.deepEqual(resultMoney({ buyin: 600, num_entries: 2, cashed: 1, cash_amount: 3000 }),
    { units: 2, cost: 1200, cash: 3000, net: 1800 });
  // num_entries 0 / null / missing is one bullet, as the ledger and analytics read it.
  assert.equal(resultMoney({ buyin: 300, num_entries: 0, cashed: 0 }).cost, 300);
  assert.equal(resultMoney({ buyin: 300, num_entries: null, cashed: 0 }).cost, 300);
  assert.equal(resultMoney({ buyin: 300, cashed: 0 }).units, 1);
  // A missing buy-in is free, not NaN.
  assert.deepEqual(resultMoney({ cashed: 1, cash_amount: 50 }), { units: 1, cost: 0, cash: 50, net: 50 });
});

test('uncashed with a stray cash_amount: the cash does not count', () => {
  const m = resultMoney({ buyin: 400, num_entries: 1, cashed: 0, cash_amount: 2500 });
  assert.equal(m.cash, 0);
  assert.equal(m.net, -400);
  const t = tournamentTotals([
    { buyin: 400, num_entries: 1, cashed: 0, cash_amount: 2500, venue: 'Borgata' },
    { buyin: 400, num_entries: 1, cashed: 1, cash_amount: 1000, venue: 'Borgata' },
  ], { rates, currencyOf });
  assert.equal(t.cash, 1000);
  assert.equal(t.net, 1000 - 800);
  assert.equal(t.cashes, 1);
});

test('old results and imports count their real buy-in (no lookup in the 3-day tournaments feed)', () => {
  const rows = [
    // Logged two years ago: GET /api/tournaments no longer returns this event at all.
    { tournament_id: 11, date: '2024-06-02', buyin: 1500, num_entries: 1, cashed: 0, venue: 'Horseshoe / Paris Las Vegas' },
    // A CSV import: a private 'Personal' event, never in GET /api/tournaments.
    { tournament_id: 12, date: '2025-03-09', buyin: 215, num_entries: 3, cashed: 1, cash_amount: 900, venue: 'Personal' },
  ];
  const t = tournamentTotals(rows, { rates, currencyOf, groupOf });
  assert.equal(t.count, 2);
  assert.equal(t.bullets, 4);
  assert.equal(t.cost, 1500 + 645);
  assert.equal(t.cash, 900);
  assert.equal(t.net, 900 - 2145);
  assert.equal(Math.round(t.roi * 10) / 10, Math.round(((900 - 2145) / 2145) * 1000) / 10);
  assert.deepEqual(t.byGroup['Personal'], { cost: 645, cash: 900, count: 1 });
  assert.deepEqual(t.byGroup['Horseshoe / Paris Las Vegas'], { cost: 1500, cash: 0, count: 1 });
  assert.equal(t.byGroup.Other, undefined, 'nothing falls into "Other" for want of a lookup');
});

test('mixed currencies: each row converted from its own currency, never summed raw', () => {
  const rows = [
    { buyin: 1000, num_entries: 1, cashed: 1, cash_amount: 5000, venue: 'Irish Poker Open' }, // EUR
    { buyin: 500, num_entries: 1, cashed: 0, venue: 'Borgata' },                              // USD
  ];
  const usd = tournamentTotals(rows, { currency: 'USD', rates, currencyOf });
  assert.equal(usd.cost, 2000 + 500);   // EUR 1000 at 0.5 EUR/USD = $2000
  assert.equal(usd.cash, 10000);
  assert.equal(usd.net, 7500);
  const eur = tournamentTotals(rows, { currency: 'EUR', rates, currencyOf });
  assert.equal(eur.cost, 1000 + 250);
  assert.equal(eur.cash, 5000);
  // Display currency neither side's: both legs convert.
  const gbp = tournamentTotals(rows, { currency: 'GBP', rates, currencyOf });
  assert.equal(gbp.cost, 2000 * 0.8 + 500 * 0.8);
});

test('rates not loaded: a mixed total is withheld (null), not added up wrong', () => {
  const rows = [
    { buyin: 1000, num_entries: 1, cashed: 0, venue: 'Irish Poker Open' },
    { buyin: 500, num_entries: 1, cashed: 0, venue: 'Borgata' },
  ];
  const t = tournamentTotals(rows, { currency: 'USD', rates: null, currencyOf, groupOf });
  assert.equal(t.count, 2);
  assert.equal(t.unconverted, 1);
  assert.equal(t.cost, null);
  assert.equal(t.net, null);
  assert.equal(t.roi, null);
  // One currency throughout needs no rates.
  const same = tournamentTotals([rows[1]], { currency: 'USD', rates: null, currencyOf });
  assert.equal(same.cost, 500);
  assert.equal(same.unconverted, 0);
  // A currency the rates do not list is unconvertible too (utils.js would read it as 1:1).
  assert.equal(convertMoney(100, 'EUR', 'USD', { USD: 1 }), null);
  assert.equal(convertMoney(100, 'USD', 'USD', null), 100);
  assert.equal(convertMoney(0, 'EUR', 'USD', null), 0);
});

test('nothing spent: ROI is empty (null), never 0%', () => {
  assert.equal(tournamentTotals([], {}).roi, null);
  assert.equal(tournamentTotals([], {}).count, 0);
  const freeroll = tournamentTotals([{ buyin: 0, cashed: 1, cash_amount: 100 }], {});
  assert.equal(freeroll.roi, null);
  assert.equal(freeroll.net, 100);
});

test('the home never totals in Native', () => {
  assert.equal(homeCurrency('NATIVE'), 'USD');
  assert.equal(homeCurrency(null), 'USD');
  assert.equal(homeCurrency('eur', ['USD', 'EUR']), 'EUR');
  assert.equal(homeCurrency('XYZ', ['USD', 'EUR']), 'USD');
});
