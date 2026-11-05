// The field on a live clock's row: what clockFieldLabel says for each thing a room publishes.
import assert from 'node:assert';
globalThis.localStorage = globalThis.localStorage || { getItem() { return null; }, setItem() {} };
globalThis.window = globalThis.window || globalThis;
globalThis.location = globalThis.location || { origin: 'http://localhost' };
const { clockFieldLabel } = await import('../live-clocks.js');
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
  [{ source: 'bravo', entries: 218, playersLeft: 63 }, '218 entries'],   // Bravo's remaining is not who is left
  [{ source: 'bravo', playersLeft: 63 }, null],
  [{ source: 'pokeratlas', entries: 178, playersLeft: 134 }, '134 left of 178'],
  [{ source: 'wsop', entries: 68, playersLeft: 57 }, '57 left of 68'],
  [{}, null],
  [null, null],
];
for (const [c, want] of cases) assert.strictEqual(clockFieldLabel(c), want, JSON.stringify(c));
console.log(`clock field: ${cases.length} passed`);
