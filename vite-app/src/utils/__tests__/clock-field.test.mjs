// The field on a live clock's row: what clockFieldLabel says for each thing a room publishes.
import assert from 'node:assert';
globalThis.localStorage = globalThis.localStorage || { getItem() { return null; }, setItem() {} };
globalThis.window = globalThis.window || globalThis;
globalThis.location = globalThis.location || { origin: 'http://localhost' };
const { clockFieldLabel, lateRegOver } = await import('../live-clocks.js');
const cases = [
  [{ entries: 412, playersLeft: 187 }, '187 left of 412'],
  [{ entries: 12345, playersLeft: 1204 }, '1,204 left of 12,345'],
  [{ entries: 95, playersLeft: null }, '95 entries'],
  [{ entries: 1 }, '1 entry'],
  [{ entries: null, playersLeft: 63 }, '63 left'],
  [{ entries: 88, playersLeft: 88 }, '88 entries'],      // nobody out yet
  [{ entries: 50, playersLeft: 60 }, '50 entries'],      // a left above the entries is not believed
  [{ entries: 0, playersLeft: 0 }, null],                // 0 is "not reported yet", as a not-started flight sends
  [{ entries: 40, playersLeft: 0 }, '40 entries'],
  [{ source: 'bravo', entries: 18, playersLeft: 5 }, '5 left of 18'],
  [{ source: 'pokeratlas', entries: 178, playersLeft: 134 }, '134 left of 178'],
  [{ source: 'wsop', entries: 68, playersLeft: 57 }, '57 left of 68'],
  [{}, null],
  [null, null],
];
for (const [c, want] of cases) assert.strictEqual(clockFieldLabel(c, true), want, JSON.stringify(c));

// Before late reg is over: the entries alone, whatever the room says is left, on every provider.
for (const source of ['bravo', 'pokeratlas', 'wsop']) {
  assert.strictEqual(clockFieldLabel({ source, entries: 218, playersLeft: 63 }), '218 entries', source);
  assert.strictEqual(clockFieldLabel({ source, entries: 218, playersLeft: 63 }, false), '218 entries', source);
  assert.strictEqual(clockFieldLabel({ source, playersLeft: 63 }, false), null, source);
}

// Whether it is over: the clock's own close first, then the event's; unknown is not over.
const NOW = Date.parse('2026-11-05T20:00:00Z');
const live = (o) => ({ level: 5, remaining: 600, levelSecs: 1800, ...o });
assert.strictEqual(lateRegOver({ date: '2026-11-05' }, live({ regEndsAt: '2026-11-05T19:00:00Z' }), NOW), true, 'the clock says closed');
assert.strictEqual(lateRegOver({ date: '2026-11-05' }, live({ regEndsAt: '2026-11-05T21:00:00Z' }), NOW), false, 'the clock says open');
assert.strictEqual(lateRegOver({ date: '2026-11-05', late_reg_end: '4' }, live({}), NOW), true, 'past the close level');
assert.strictEqual(lateRegOver({ date: '2026-11-05', late_reg_end: '9', level_duration: '30 min' }, live({}), NOW), false, 'before the close level');
assert.strictEqual(lateRegOver({ date: '2026-11-05' }, live({}), NOW), false, 'nobody can say');
console.log(`clock field: ${cases.length + 14} passed`);
