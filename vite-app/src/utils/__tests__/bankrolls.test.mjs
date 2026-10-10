// node --test src/utils/__tests__/bankrolls.test.mjs   (from vite-app/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BANKROLL_ALL, BANKROLL_MAIN, entryBankrollKey, toBankrollKey, filterByBankroll, bankrollQuery,
  entryNet, computeBalances, defaultBankrollFor,
} from '../bankrolls.js';

const entries = [
  { id: 1, bankroll_id: null, buyin: 100, num_entries: 1, cash_amount: 0, venue: 'Vegas' },
  { id: 2, bankroll_id: 7, buyin: 200, num_entries: 2, cash_amount: 1000, venue: 'Vegas' },
  { id: 3, bankroll_id: 9, buyin: 100, num_entries: 1, cash_amount: 0, venue: 'Irish Poker Open' },
  { id: 4, buyin: 50, num_entries: 1, cash_amount: 150, venue: 'Vegas' },  // predates the column
];

test('keys: NULL and a missing column are Main; ids are numbers', () => {
  assert.equal(entryBankrollKey(entries[0]), BANKROLL_MAIN);
  assert.equal(entryBankrollKey(entries[3]), BANKROLL_MAIN);
  assert.equal(entryBankrollKey({ bankroll_id: 'main' }), BANKROLL_MAIN);
  assert.equal(entryBankrollKey(entries[1]), 7);
  assert.equal(toBankrollKey('7'), 7);
  assert.equal(toBankrollKey('main'), BANKROLL_MAIN);
  assert.equal(toBankrollKey(undefined), BANKROLL_ALL);
  assert.equal(toBankrollKey('nonsense'), BANKROLL_ALL);
  assert.equal(toBankrollKey('-3'), BANKROLL_ALL);
});

test('filter: all is the identity; main and id select', () => {
  assert.equal(filterByBankroll(entries, 'all'), entries);
  assert.deepEqual(filterByBankroll(entries, 'main').map((e) => e.id), [1, 4]);
  assert.deepEqual(filterByBankroll(entries, 7).map((e) => e.id), [2]);
  assert.deepEqual(filterByBankroll(entries, '9').map((e) => e.id), [3]);
  assert.deepEqual(filterByBankroll(null, 7), []);
});

test('query: All adds nothing, so an unfiltered fetch is unchanged', () => {
  assert.equal(bankrollQuery('all'), '');
  assert.equal(bankrollQuery('main'), '?bankroll=main');
  assert.equal(bankrollQuery(7, '&'), '&bankroll=7');
});

test('balances: start + adjustments + results, results converted into the bankroll currency', () => {
  const bankrolls = [
    { id: 'main', currency: 'USD', starting_balance: 0, adjustments_net: 700 },
    { id: 7, currency: 'USD', starting_balance: 10000, adjustments_net: 1500 },
    { id: 9, currency: 'EUR', starting_balance: 500, adjustments_net: 91 },
  ];
  const rates = { USD: 1, EUR: 0.5 };
  const convert = (v, from, to) => (from === to ? v : (v / rates[from]) * rates[to]);
  const nativeCurrency = (venue) => (venue === 'Irish Poker Open' ? 'EUR' : 'USD');
  const m = computeBalances(bankrolls, entries, { convert, nativeCurrency });
  assert.equal(entryNet(entries[1]), 600);
  assert.deepEqual(m.get('main'), { start: 0, adjustments: 700, results: -100 + 100, balance: 700, entries: 2, currency: 'USD' });
  assert.deepEqual(m.get(7), { start: 10000, adjustments: 1500, results: 600, balance: 12100, entries: 1, currency: 'USD' });
  assert.deepEqual(m.get(9), { start: 500, adjustments: 91, results: -100, balance: 491, entries: 1, currency: 'EUR' });
  // All, in USD: 700 + 12100 + 491 EUR (= 982 USD)
  assert.equal(m.get('all').balance, 700 + 12100 + 982);
  assert.equal(m.get('all').entries, 4);
});

test('a result filed under a bankroll the list does not have is ignored, not crashed on', () => {
  const m = computeBalances([{ id: 'main', currency: 'USD', starting_balance: 0, adjustments_net: 0 }], entries);
  assert.equal(m.get('main').entries, 2);
});

test('new results default to the bankroll being viewed, never an archived one', () => {
  const list = [{ id: 'main' }, { id: 7, archived: false }, { id: 9, archived: true }];
  assert.equal(defaultBankrollFor('all', list), 'main');
  assert.equal(defaultBankrollFor(7, list), 7);
  assert.equal(defaultBankrollFor(9, list), 'main');
  assert.equal(defaultBankrollFor(42, list), 'main');
});
