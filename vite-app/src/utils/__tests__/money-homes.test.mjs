// node --test src/utils/__tests__/money-homes.test.mjs  (from vite-app/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseHomes, fundView, driftView, setAsideView } from '../money-homes.js';

const money = (v) => '$' + Math.round(v).toLocaleString('en-US');
test('the fund rows: progress, pace, so far, no target, short values only', () => {
  const h = normaliseHomes({ fund: { bankrollId: 7, name: 'WSOP fund', saved: 18000, target: 65000, targetDate: '2027-05-03', pace: { left: 47000, monthsLeft: 6.6, needPerMonth: 7121.21, perMonthSoFar: 3300, onTrack: false } } });
  const v = fundView(h.fund, money, (d) => (d === '2027-05-03' ? 'May 3, 2027' : d));
  assert.deepEqual([v.label, v.text, v.pct, v.note], ['WSOP fund', '$18,000 of $65,000', 28, '28% · by May 3, 2027']);
  assert.deepEqual(v.pace, { note: '$7,121 a month needed', text: 'Behind', tone: -1 });
  assert.deepEqual(v.soFar, { note: 'a month since its first entry', text: '$3,300' });
  assert.equal(fundView(normaliseHomes({ fund: { saved: 500, target: null } }).fund, money).note, 'no target set');
  const done = fundView(normaliseHomes({ fund: { saved: 70000, target: 65000, pace: { left: 0 } } }).fund, money);
  assert.deepEqual([done.pace, done.soFar], [{ note: 'the target is met', text: 'Reached', tone: 1 }, null]);
  assert.equal(fundView(null, money), null);
});
test('the drift line and the set-aside line', () => {
  assert.deepEqual(driftView(normaliseHomes({ locations: [], roll: 5000, wsopFund: 0, drift: -5000 }), money), { text: 'Not listed', note: 'the ledger: $5,000', tone: 0 });
  assert.deepEqual(driftView(normaliseHomes({ locations: [{ name: 'Safe', amount: 5000 }], roll: 5000, wsopFund: 0, drift: 0 }), money), { text: 'Adds up', note: 'the ledger: $5,000', tone: 1 });
  assert.deepEqual(driftView(normaliseHomes({ locations: [{ name: 'Safe', amount: 4000 }], roll: 5000, wsopFund: 1000, drift: -2000 }), money), { text: '−$2,000', note: 'the ledger: $6,000', tone: -1 });
  assert.deepEqual(setAsideView(12000, 30, money), { label: 'Set aside for tax (30%)', value: '$3,600', note: '30% of the net' });
  assert.deepEqual(setAsideView(-500, 30, money), { label: 'Set aside for tax (30%)', value: '$0', note: 'nothing to set aside on a losing year' });
  assert.equal(setAsideView(1000, undefined, money).label, 'Set aside for tax (30%)');
});
