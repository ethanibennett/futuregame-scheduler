// node --test src/utils/__tests__/hand-link-fetch.test.mjs  (from vite-app/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchHandLink } from '../hand-link-fetch.js';

const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => { if (body === undefined) throw new Error('not json'); return body; } });
function seq(...answers) {
  const calls = [];
  const fetchImpl = async () => { const a = answers[Math.min(calls.length, answers.length - 1)]; calls.push(a); if (a instanceof Error) throw a; return a; };
  const waits = [];
  return { calls, waits, opts: { fetchImpl, wait: async (ms) => { waits.push(ms); } } };
}
const HAND = { shorthand: 'N84.1000' };

test('a hand on the first answer', async () => {
  const s = seq(res(200, HAND));
  assert.deepEqual(await fetchHandLink('u', {}, s.opts), { kind: 'ok', data: HAND });
  assert.equal(s.calls.length, 1);
});

test('a deploy in the middle (502, then no answer, then the hand) still opens the hand', async () => {
  const s = seq(res(502), new TypeError('Load failed'), res(200, HAND));
  assert.deepEqual(await fetchHandLink('u', {}, s.opts), { kind: 'ok', data: HAND });
  assert.deepEqual(s.waits, [1000, 2000]);
});

test('only the server saying the hand is not there is "gone", at once', async () => {
  for (const a of [res(404), res(410), res(400), res(200, { error: 'x' })]) {
    const s = seq(a);
    assert.deepEqual(await fetchHandLink('u', {}, s.opts), { kind: 'gone' });
    assert.equal(s.calls.length, 1);
  }
});

test('no answer through every retry is "down", never "gone"', async () => {
  const s = seq(new TypeError('Load failed'));
  assert.deepEqual(await fetchHandLink('u', {}, s.opts), { kind: 'down' });
  assert.deepEqual(s.waits, [1000, 2000, 4000, 8000]);
  assert.equal(s.calls.length, 5);
  const t = seq(res(429), res(503), res(200, undefined), res(500), res(504));
  assert.deepEqual(await fetchHandLink('u', {}, t.opts), { kind: 'down' });
});
