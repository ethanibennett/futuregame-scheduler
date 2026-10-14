// node --test src/utils/__tests__/bankroll-fab.test.mjs   (from vite-app/)
// The floating "+" on the bankroll pages: its choices by role and live session, and the hold store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fabItems, fabHasMenu, holdFab, fabHeld, subscribeFab } from '../bankroll-fab.js';

test('an admin with no live session is offered all four choices, in the Log menu order', () => {
  const items = fabItems({ isAdmin: true, live: false });
  assert.deepEqual(items.map((i) => i.label), ['Tournament result', 'Cash session', 'Start live session', 'Expense or income']);
  assert.deepEqual(items.map((i) => i.intent.kind), ['tournament', 'cash-add', 'cash-start', 'expense']);
  assert.ok(fabHasMenu(items));
});

test('a running live session takes Start live session off the menu and nothing else', () => {
  const items = fabItems({ isAdmin: true, live: true });
  assert.deepEqual(items.map((i) => i.key), ['tournament', 'cash-add', 'expense']);
  assert.ok(items.every((i) => i.intent.kind !== 'cash-start'));
});

test('everyone else has only the tournament result, so there is no menu to open', () => {
  for (const live of [false, true]) {
    const items = fabItems({ isAdmin: false, live });
    assert.deepEqual(items.map((i) => i.intent), [{ kind: 'tournament' }]);
    assert.equal(fabHasMenu(items), false);
  }
});

test('the intents are the kinds Results already understands (TrackingView, CashSessions, Expenses)', () => {
  const known = new Set(['tournament', 'cash-add', 'cash-start', 'cash-live', 'cash-end', 'cash-session', 'expense', 'trip']);
  for (const live of [false, true]) for (const i of fabItems({ isAdmin: true, live })) assert.ok(known.has(i.intent.kind), i.intent.kind);
});

test('holds are counted: the + returns only when every view has let go', () => {
  assert.equal(fabHeld('page'), false);
  const a = holdFab('page');
  const b = holdFab('page');
  assert.equal(fabHeld('page'), true);
  a();
  assert.equal(fabHeld('page'), true);
  b();
  assert.equal(fabHeld('page'), false);
});

test('releasing twice does not release another view\'s hold', () => {
  const a = holdFab('page');
  const b = holdFab('page');
  a(); a();
  assert.equal(fabHeld('page'), true);
  b();
  assert.equal(fabHeld('page'), false);
});

test('the page and the sheet are held separately; an unknown scope is the page', () => {
  const s = holdFab('sheet');
  assert.equal(fabHeld('sheet'), true);
  assert.equal(fabHeld('page'), false);
  s();
  const p = holdFab('whatever');
  assert.equal(fabHeld('page'), true);
  assert.equal(fabHeld('sheet'), false);
  p();
  assert.equal(fabHeld('page'), false);
});

test('subscribers hear every hold and release, and stop when unsubscribed', () => {
  let n = 0;
  const off = subscribeFab(() => { n += 1; });
  const r = holdFab('page');
  r();
  assert.equal(n, 2);
  off();
  holdFab('page')();
  assert.equal(n, 2);
});
