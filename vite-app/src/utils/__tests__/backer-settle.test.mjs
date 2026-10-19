// node --test vite-app/src/utils/__tests__/backer-settle.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { settleView } from '../backer-settle.js';

test('nothing owed and never settled: nothing shown', () => {
  assert.equal(settleView({ settlement: null, totalCents: 0, side: 'backer' }), null);
});

test('a balance with nothing pressed: Settled, worded by who pays', () => {
  const b = settleView({ settlement: null, totalCents: 25000, side: 'backer' });
  assert.equal(b.button.label, 'Settled');
  assert.equal(b.status, 'Once Ethan has paid you $250');
  const o = settleView({ settlement: null, totalCents: 25000, side: 'owner', backer: 'Alex' });
  assert.equal(o.status, 'Once you have sent Alex $250');
  assert.match(o.confirm, /^Confirm you have paid Alex \$250\?/);
  const owes = settleView({ settlement: null, totalCents: -1050, side: 'backer' });
  assert.equal(owes.status, 'Once you have sent Ethan $11', 'whole dollars, as the page reads');
});

test('one side pressed: that side can undo, the other confirms', () => {
  const settlement = { open: { amountCents: 25000, backerAt: '2026-10-19T15:00:00Z', ownerAt: null }, last: null };
  const b = settleView({ settlement, totalCents: 25000, side: 'backer' });
  assert.deepEqual(b.button, { label: 'Undo', action: 'undo', primary: false });
  assert.equal(b.status, 'You marked $250 settled · waiting for Ethan');
  const o = settleView({ settlement, totalCents: 25000, side: 'owner', backer: 'Alex' });
  assert.equal(o.button.label, 'Confirm');
  assert.equal(o.status, 'Alex marked $250 settled');
});

test('settled: the date, no button', () => {
  const v = settleView({ settlement: { open: null, last: { amountCents: 25000, at: '2026-10-19T16:00:00Z' } }, totalCents: 0, side: 'backer' });
  assert.equal(v.button, null);
  assert.equal(v.status, 'Settled Oct 19');
});
