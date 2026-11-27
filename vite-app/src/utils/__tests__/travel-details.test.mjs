// A Travel Day's flights, stays and cars as the open card shows them (utils/travel-details.js; owner, 2026-11-27).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, fmtClock, fmtWhen, cellsOf, routeOf, timesOf, blankItem, cleanItem } from '../travel-details.js';

test('times read as the app writes them', () => {
  assert.equal(fmtClock('08:05'), '8:05 AM');
  assert.equal(fmtClock('00:30'), '12:30 AM');
  assert.equal(fmtClock('12:00'), '12:00 PM');
  assert.equal(fmtClock('23:45'), '11:45 PM');
  assert.equal(fmtClock('2026-12-08T15:00'), '3:00 PM');
  assert.equal(fmtClock('around noon'), 'around noon', 'anything else as typed');
  assert.equal(fmtWhen('2026-12-08T15:00'), 'Dec 8, 3:00 PM');
  assert.equal(fmtWhen('2026-01-31'), 'Jan 31');
  assert.equal(fmtWhen('16:20'), '4:20 PM');
});

test("a flight's cells: number, confirmation, its route as one cell, the times", () => {
  const cells = cellsOf({ kind: 'flight', number: 'AA 1234', conf: 'ABC123', from: 'PHL', to: 'LAS', departs: '08:00', arrives: '11:00' });
  assert.deepEqual(cells.map((c) => [c.label, c.value]), [
    ['Flight number', 'AA 1234'], ['Confirmation', 'ABC123'], ['Route', 'PHL → LAS'], ['Departs', '8:00 AM'], ['Arrives', '11:00 AM'],
  ]);
  assert.deepEqual(cellsOf({ kind: 'flight', number: 'AA 1' }).map((c) => c.label), ['Flight number'], 'only what has something');
});

test("a stay's name and address take the whole row; a car's places and times read in order", () => {
  const stay = cellsOf({ kind: 'stay', name: 'Wynn Las Vegas', address: '3131 Las Vegas Blvd S', checkIn: '2026-12-08T15:00', conf: '8123' });
  assert.deepEqual(stay.map((c) => [c.label, c.value, c.wide]), [
    ['Hotel', 'Wynn Las Vegas', true], ['Address', '3131 Las Vegas Blvd S', true], ['Check in', 'Dec 8, 3:00 PM', false], ['Confirmation', '8123', false],
  ]);
  const car = cellsOf({ kind: 'car', company: 'Hertz', pickUp: '2026-12-08T14:00', pickUpAt: 'LAS airport' });
  assert.deepEqual(car.map((c) => c.value), ['Hertz', 'Dec 8, 2:00 PM', 'LAS airport']);
  assert.deepEqual(cellsOf({ kind: 'boat' }), []);
});

test("the day's route goes flight by flight, a connection once", () => {
  assert.equal(routeOf([{ kind: 'flight', from: 'PHL', to: 'DFW' }, { kind: 'stay', name: 'x' }, { kind: 'flight', from: 'DFW', to: 'LAS' }]), 'PHL → DFW → LAS');
  assert.equal(routeOf([{ kind: 'flight', from: 'PHL' }]), null, 'one airport is no route');
  assert.equal(routeOf(null), null);
});

test("the picker's note reads back as the card's times", () => {
  assert.deepEqual(timesOf('Depart 8:00 AM → Arrive 2:00 PM'), { depart: '8:00 AM', arrive: '2:00 PM' });
  assert.equal(timesOf('6h flight LAX → LAS'), null);
  assert.equal(timesOf(''), null);
});

test('the form starts blank and sends only what was filled in', () => {
  for (const kind of Object.keys(KINDS)) {
    const b = blankItem(kind);
    assert.equal(b.kind, kind);
    assert.equal(cleanItem(b), null, `an untouched ${kind} sends nothing`);
  }
  assert.deepEqual(cleanItem({ ...blankItem('car'), company: ' Hertz ', conf: '' }), { kind: 'car', company: 'Hertz' });
});

test('no emoji in any label or placeholder (owner, 2026-11-27: "no emojis, ever")', () => {
  const text = JSON.stringify(KINDS);
  assert.ok(!/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(text));
});
