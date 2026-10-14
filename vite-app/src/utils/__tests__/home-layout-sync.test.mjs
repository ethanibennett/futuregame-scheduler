// node --test src/utils/__tests__/home-layout-sync.test.mjs   (from vite-app/; or `npm run test:home` from the root)
// Edit home: the hook that loads, caches and saves the layout (hooks/useHomeLayout.js), run for real
// under React with a stand-in window / document / localStorage / fetch whose answers the test
// releases one at a time. What it pins: an answer that arrives late is never allowed to undo a
// change made after its request went out (the review's "a slow GET can undo a saved change").
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── A bare DOM: an event hub, localStorage, a document with the few members React reads ──
const hub = () => {
  const m = new Map();
  return {
    addEventListener(t, f) { (m.get(t) || m.set(t, new Set()).get(t)).add(f); },
    removeEventListener(t, f) { m.get(t)?.delete(f); },
    emit(t, ev = {}) { for (const f of [...(m.get(t) || [])]) f({ type: t, ...ev }); },
  };
};
const doc = Object.assign(hub(), {
  visibilityState: 'visible', activeElement: null, body: null, nodeType: 9,
  createElement: () => ({ style: {}, setAttribute() {} }), documentElement: { style: {} },
});
const win = Object.assign(hub(), { document: doc, location: { origin: 'http://t.test' }, HTMLIFrameElement: class {} });
doc.defaultView = win;
const store = new Map();
globalThis.window = win;
globalThis.document = doc;
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { default: useHomeLayout } = await import('../../hooks/useHomeLayout.js');
const { cacheKey } = await import('../home-layout.js');

const UID = 7;
const KEY = cacheKey(UID);
const A = { v: 1, sections: [{ id: 'upnext', on: true }, { id: 'tolog', on: true }, { id: 'last', on: true }, { id: 'bankroll', on: true }, { id: 'period', on: true }] };
const B = { v: 1, sections: [{ id: 'upnext', on: true }, { id: 'last', on: true }, { id: 'tolog', on: true }, { id: 'bankroll', on: true }, { id: 'period', on: true }] };
const C = { v: 1, sections: [{ id: 'upnext', on: true }, { id: 'last', on: true }, { id: 'tolog', on: false }, { id: 'bankroll', on: true }, { id: 'period', on: true }] };
const ids = (l) => (l ? l.sections.map((e) => e.id + (e.on ? '' : '!')).join() : null);
const cached = () => { const raw = store.get(KEY); return raw ? JSON.parse(raw) : null; };

// ── fetch: each request is parked until the test answers it ──
let calls;
const tick = () => new Promise((r) => setImmediate(r));
function park() {
  calls = [];
  globalThis.fetch = (url, init = {}) => new Promise((resolve, reject) => {
    const call = { method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, settled: false };
    call.reply = (layout, status = 200) => {
      call.settled = true;
      resolve({ ok: status < 400, status, json: async () => ({ layout }) });
    };
    call.fail = () => { call.settled = true; reject(new Error('network')); };
    calls.push(call);
  });
}
const pending = (method) => calls.filter((c) => c.method === method && !c.settled);

// ── Mount the hook for one signed-in user ──
let root, seen;
async function mount() {
  seen = null;
  const Probe = () => { seen = useHomeLayout({ token: 'tok', isGuest: false, userId: UID }); return null; };
  const container = Object.assign(hub(), { nodeType: 1, tagName: 'DIV', ownerDocument: doc, appendChild() {}, removeChild() {}, childNodes: [], textContent: '' });
  root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(Probe)); });
}
const unmount = async () => { if (root) await React.act(async () => { root.unmount(); }); root = null; };
const settle = async () => { await React.act(async () => { await tick(); await tick(); }); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  await unmount();
  store.clear();
  park();
});

test('mount: the cache paints, the server answers, and the server\'s layout is adopted when nothing is unsaved', async () => {
  store.set(KEY, JSON.stringify({ layout: A, dirty: false }));
  await mount();
  assert.equal(ids(seen.layout), ids(A), 'the cached layout paints before the server answers');
  assert.equal(pending('GET').length, 1);
  await React.act(async () => { pending('GET')[0].reply(B); await tick(); });
  assert.equal(ids(seen.layout), ids(B), 'the server\'s copy replaces the cache');
  assert.equal(ids(cached().layout), ids(B));
  assert.equal(cached().dirty, false);
});

test('race: a slow load GET that answers after a change was made and saved does not undo it', async () => {
  await mount();                       // no cache: the default home; GET #1 is in flight
  const slowGet = pending('GET')[0];
  assert.ok(slowGet, 'the load GET is parked');
  await React.act(async () => { seen.set(B); });
  assert.equal(ids(seen.layout), ids(B));
  assert.equal(cached().dirty, true);
  await React.act(async () => { await wait(700); });            // the 600 ms debounce: the PUT goes
  const put = pending('PUT')[0];
  assert.ok(put, 'the change is being saved');
  await React.act(async () => { put.reply(B); await tick(); }); // and the server has it
  assert.equal(cached().dirty, false, 'saved');
  assert.equal(ids(seen.layout), ids(B));
  // The load GET finally answers, with what the server held BEFORE the change.
  await React.act(async () => { slowGet.reply(null); await tick(); });
  await settle();
  assert.equal(ids(seen.layout), ids(B), 'the home keeps the change');
  assert.equal(ids(cached().layout), ids(B), 'and so does the cache');
  assert.equal(cached().dirty, false);
  assert.equal(pending('PUT').length, 0, 'nothing is re-sent: the server already has it');
});

test('race: the same on the foreground re-pull (a GET started after 5 minutes away)', async () => {
  store.set(KEY, JSON.stringify({ layout: A, dirty: false }));
  await mount();
  await React.act(async () => { pending('GET')[0].reply(A); await tick(); });
  // Back in the foreground long after: the staleness clock is read off Date.now().
  const realNow = Date.now;
  Date.now = () => realNow() + 6 * 60 * 1000;
  try {
    await React.act(async () => { doc.emit('visibilitychange'); await tick(); });
  } finally { Date.now = realNow; }
  const slowGet = pending('GET')[0];
  assert.ok(slowGet, 'the foreground GET is parked');
  await React.act(async () => { seen.set(C); });
  await React.act(async () => { await wait(700); });
  await React.act(async () => { pending('PUT')[0].reply(C); await tick(); });
  await React.act(async () => { slowGet.reply(A); await tick(); });   // the old answer, late
  await settle();
  assert.equal(ids(seen.layout), ids(C));
  assert.equal(ids(cached().layout), ids(C));
});

test('race: a change still unsaved when the old GET answers is kept and pushed', async () => {
  await mount();
  const slowGet = pending('GET')[0];
  await React.act(async () => { seen.set(B); });                // dirty, the PUT not yet sent
  await React.act(async () => { slowGet.reply(A); await tick(); });
  await settle();
  assert.equal(ids(seen.layout), ids(B), 'the unsaved change wins over the server\'s older copy');
  const put = pending('PUT')[0];
  assert.ok(put, 'and it is pushed');
  assert.equal(ids(put.body.layout), ids(B));
  await React.act(async () => { put.reply(B); await tick(); });
  assert.equal(cached().dirty, false);
  assert.equal(ids(seen.layout), ids(B));
});

test('a change whose save failed stays unsaved: a late GET does not replace it, and the retry sends it', async () => {
  await mount();
  const slowGet = pending('GET')[0];
  await React.act(async () => { seen.set(B); });
  await React.act(async () => { await wait(700); });
  await React.act(async () => { pending('PUT')[0].reply(null, 500); await tick(); });
  assert.equal(cached().dirty, true, 'a 500 leaves it to be retried');
  await React.act(async () => { slowGet.reply(A); await tick(); });
  await settle();
  assert.equal(ids(seen.layout), ids(B));
  const retry = pending('PUT');
  assert.equal(retry.length, 1, 'the late GET reconciles to a push of the unsaved change');
  assert.equal(ids(retry[0].body.layout), ids(B));
});

test('no change since the request: a GET answer is adopted (another device changed it)', async () => {
  store.set(KEY, JSON.stringify({ layout: A, dirty: false }));
  await mount();
  await React.act(async () => { pending('GET')[0].reply(C); await tick(); });
  assert.equal(ids(seen.layout), ids(C));
  assert.equal(pending('PUT').length, 0);
});

test('race: another tab\'s change (storage event) while the GET is out is not undone by that GET', async () => {
  await mount();
  const slowGet = pending('GET')[0];
  // The other tab saved B and wrote its cache; this tab hears about it.
  const next = JSON.stringify({ layout: B, dirty: false });
  store.set(KEY, next);
  await React.act(async () => { win.emit('storage', { key: KEY, newValue: next }); });
  assert.equal(ids(seen.layout), ids(B));
  await React.act(async () => { slowGet.reply(A); await tick(); });
  await settle();
  assert.equal(ids(seen.layout), ids(B), 'the GET read the server before the other tab\'s save');
  assert.equal(pending('PUT').length, 0, 'this tab does not save what the other tab saved');
});
