// node --test src/utils/__tests__/native-insets.test.mjs  (from vite-app/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { insetsCss, applyInsets, startNativeInsets } from '../native-insets.js';

function fakeDoc() {
  const byId = new Map();
  const head = { children: [], appendChild(el) { this.children.push(el); byId.set(el.id, el); } };
  const listeners = {};
  return {
    head, hidden: false,
    getElementById: (id) => byId.get(id) || null,
    createElement: () => { const el = { id: '', textContent: '', remove() { byId.delete(this.id); head.children = head.children.filter((c) => c !== this); } }; return el; },
    addEventListener: (k, fn) => { (listeners[k] = listeners[k] || []).push(fn); },
    fire: (k) => (listeners[k] || []).forEach((fn) => fn()),
  };
}

test('an iPhone in portrait: top and bottom written, the sides left to env()', () => {
  assert.equal(insetsCss({ top: 62, bottom: 34, left: 0, right: 0 }), 'html:root{--sa-t:62px;--sa-b:34px}');
  assert.equal(insetsCss({ top: 0, bottom: 21, left: 62, right: 62 }), 'html:root{--sa-b:21px;--sa-l:62px;--sa-r:62px}');
  assert.equal(insetsCss({ top: 47.333333 }), 'html:root{--sa-t:47.33px}');
});

test('nothing above 0 (a Mac window, a window not laid out yet) writes nothing', () => {
  assert.equal(insetsCss({ top: 0, bottom: 0, left: 0, right: 0 }), '');
  assert.equal(insetsCss({}), '');
  assert.equal(insetsCss(null), '');
  assert.equal(insetsCss({ top: NaN, bottom: -3 }), '');
});

test('one style element, updated in place, removed when the insets go', () => {
  const doc = fakeDoc();
  applyInsets(doc, { top: 62, bottom: 34 });
  assert.equal(doc.head.children.length, 1);
  assert.equal(doc.getElementById('native-insets').textContent, 'html:root{--sa-t:62px;--sa-b:34px}');
  applyInsets(doc, { top: 0, bottom: 21, left: 62, right: 62 });
  assert.equal(doc.head.children.length, 1);
  assert.equal(doc.getElementById('native-insets').textContent, 'html:root{--sa-b:21px;--sa-l:62px;--sa-r:62px}');
  applyInsets(doc, {});
  assert.equal(doc.head.children.length, 0);
});

test('only in the iOS app with the plugin; it asks at once, on return to the page and on every change', async () => {
  const doc = fakeDoc();
  const winListeners = {};
  let answer = { top: 0, bottom: 0 };
  let onChange = null;
  let asked = 0;
  const plugin = { get: async () => { asked += 1; return answer; }, addListener: (k, fn) => { if (k === 'change') onChange = fn; } };
  const win = {
    document: doc,
    addEventListener: (k, fn) => { (winListeners[k] = winListeners[k] || []).push(fn); },
    Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios', isPluginAvailable: (n) => n === 'SafeArea', registerPlugin: (n) => (n === 'SafeArea' ? plugin : null) },
  };
  assert.equal(startNativeInsets({ ...win, Capacitor: { ...win.Capacitor, getPlatform: () => 'android' } }), false);
  assert.equal(startNativeInsets({ ...win, Capacitor: { ...win.Capacitor, isPluginAvailable: () => false } }), false);
  assert.equal(startNativeInsets({ document: doc, addEventListener() {} }), false);

  assert.equal(startNativeInsets(win), true);
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(asked >= 1);
  assert.equal(doc.getElementById('native-insets'), null);   // the window said 0: env() keeps it
  answer = { top: 62, bottom: 34, left: 0, right: 0 };
  doc.fire('visibilitychange');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(doc.getElementById('native-insets').textContent, 'html:root{--sa-t:62px;--sa-b:34px}');
  onChange({ top: 0, bottom: 21, left: 59, right: 59 });
  assert.equal(doc.getElementById('native-insets').textContent, 'html:root{--sa-b:21px;--sa-l:59px;--sa-r:59px}');
  assert.ok(winListeners.resize && winListeners.orientationchange);
});
