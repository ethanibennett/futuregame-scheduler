// Plans in common (Features 40): together, only them (another flight noted), only you.
import assert from 'node:assert';
import test from 'node:test';
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis.window || globalThis;
const { plansInCommon } = await import('../plans-in-common.js');

test('the same event, another flight, and theirs alone', () => {
  const theirs = [
    { id: 1, venue: 'Borgata Fall Open', event_number: '5', event_name: 'NLH Main - Day 1B', date: '2099-01-02' },
    { id: 2, venue: 'Borgata Fall Open', event_number: '7', event_name: 'PLO', date: '2099-01-03' },
    { id: 3, venue: 'Parx Big Stax', event_number: '1', event_name: 'NLH', date: '2099-01-04' },
  ];
  const mine = [
    { id: 9, venue: 'Borgata Fall Open', event_number: '5', event_name: 'NLH Main - Day 1A', date: '2099-01-01' },
    { id: 2, venue: 'Borgata Fall Open', event_number: '7', event_name: 'PLO', date: '2099-01-03' },
    { id: 8, venue: 'Wynn', event_number: '3', event_name: 'NLH', date: '2099-01-05' },
  ];
  const r = plansInCommon(theirs, mine, '2099-01-01');
  assert.strictEqual(r.together, 1);
  assert.strictEqual(r.mark.get(1), 'flight');
  assert.strictEqual(r.note.get(1), 'you play Day 1A');
  assert.strictEqual(r.mark.get(3), 'theirs');
  assert.deepStrictEqual(r.onlyMine.map((t) => t.id), [8]);
});
