// utils/money.js (UX pick 73): one reading of an amount, whatever field it is typed into.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, moneyEcho, formatMoney } from '../money.js';
import { parseAmount } from '../transactions.js';
import { partCents } from '../backer-settle.js';

const READS = [
  ['1200', 1200], ['$1,200', 1200], ['1,200.50', 1200.5], ['1.2k', 1200], ['1.2K', 1200], [' $ 5,800 ', 5800],
  ['12,50', 12.5], ['.5', 0.5], ['€300', 300], ['£40', 40], ['25k', 25000], ['19.999', 20], ['0', 0],
];
const REFUSED = ['', 'abc', '500 dollars', '1.2.3', '.', '1,2345', '12,5,0', 'k', '-5', '$-5', '1.2kk', '5 k k'];

test('every way of writing an amount reads the same', () => {
  for (const [t, v] of READS) {
    const r = parseMoney(t);
    assert.equal(r.error, undefined, `${t}: ${r.error}`);
    assert.equal(r.value, v, t);
    assert.equal(r.cents, Math.round(v * 100), t);
  }
});

test('anything else is refused with a reason, never half read', () => {
  for (const t of REFUSED) assert.ok(parseMoney(t).error, `${t} should be refused`);
});

test('a minus only where the field allows one', () => {
  assert.equal(parseMoney('-40', { allowNegative: true }).value, -40);
  assert.equal(parseMoney('−$1,000', { allowNegative: true }).value, -1000);
  assert.equal(parseMoney('$-12.5', { allowNegative: true }).value, -12.5);
  assert.ok(parseMoney('--5', { allowNegative: true }).error);
});

test('the echo shows the reading only when it is not what was typed', () => {
  assert.equal(moneyEcho('1200', 1200), null);
  assert.equal(moneyEcho('1.2k', 1200), '$1,200');
  assert.equal(moneyEcho('12,50', 12.5), '$12.50');
  assert.equal(formatMoney(-7349), '−$7,349');
});

test('the old parsers read through it: expenses and the backer page agree', () => {
  assert.equal(parseAmount('1.2k'), 1200);
  assert.equal(parseAmount('12,50'), 12.5);
  assert.equal(parseAmount('0'), null);
  assert.equal(partCents('1.2k', 734900), 120000, 'was $1.20');
  assert.equal(partCents('12,50', 734900), 1250, 'was $1,250');
  assert.equal(partCents('500 dollars', 734900), null, 'refused, not $500');
  assert.equal(partCents('$7,349', 734900), 734900);
  assert.equal(partCents('8000', 734900), null, 'more than the balance');
  assert.equal(partCents('100', -50000), -10000, 'the sign follows the balance');
});
