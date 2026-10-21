// node --test src/utils/__tests__/home-layout.test.mjs   (from vite-app/; or `npm run test:home` from the root)
// Edit home: which sections the Dashboard shows and in what order (utils/home-layout.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOME_SECTIONS, available, normalise, fullOrder, resolve, move, moveTo, toggle, isDefault,
  bankrollAbovePeriod, reconcile, cacheKey, sheetRows, defaultDoc, isSwitchedOn,
} from '../home-layout.js';

const ADMIN = { admin: true, registered: true };
const USER = { admin: false, registered: true };
const GUEST = { admin: false, registered: false };
const doc = (...ids) => ({ v: 1, sections: ids.map((x) => (typeof x === 'string' ? { id: x, on: true } : x)) });
const ids = (d) => d.sections.map((e) => e.id);
// friends and scanner (2026-10-20) start off and sit at the end; the older cases below keep their
// original lists by leaving them out, and the default-off test at the foot covers them.
const LATE = new Set(['friends', 'scanner']);
const only = (a) => a.filter((id) => !LATE.has(id));
const top = (d) => only(fullOrder(d));

test('defaults per viewer: admin 7 entries, registered 4, a guest Up Next and the period block', () => {
  assert.deepEqual(only(available(ADMIN).map((s) => s.id)), ['upnext', 'tolog', 'last', 'bankroll', 'period', 'noise', 'goals']);
  assert.deepEqual(only(available(USER).map((s) => s.id)), ['upnext', 'tolog', 'last', 'period']);
  assert.deepEqual(available(GUEST).map((s) => s.id), ['upnext', 'period']);
  // The default home resolves to the registry's order, split by pane.
  const r = resolve(null, ADMIN);
  assert.deepEqual(r.phone, ['upnext', 'tolog', 'last', 'bankroll', 'period']);
  assert.deepEqual(r.now, ['upnext', 'tolog', 'last']);
  assert.deepEqual(r.numbers, ['bankroll', 'period']);
  assert.ok(r.on.has('noise') && r.on.has('goals'));
  assert.deepEqual(resolve(null, GUEST).phone, ['upnext', 'period']);
  assert.ok(!resolve(null, USER).on.has('noise'), 'parts are admin-only');
  assert.equal(HOME_SECTIONS.filter((s) => s.locked).map((s) => s.id).join(), 'upnext');
});

test('normalise: anything malformed is null; bad entries dropped; duplicates and extra keys stripped', () => {
  assert.equal(normalise(null), null);
  assert.equal(normalise('{"v":1,"sections":[{"id":"upnext","on":true}]}'), null, 'a string is not a document');
  assert.equal(normalise({ v: 2, sections: [{ id: 'upnext', on: true }] }), null);
  assert.equal(normalise({ v: 1 }), null);
  assert.equal(normalise({ v: 1, sections: [] }), null);
  assert.equal(normalise([1, 2]), null);
  assert.deepEqual(normalise({ v: 1, sections: [{ id: 'tolog', on: false }, { id: 'tolog', on: true }, { id: 'last', on: true, x: 1 }] }),
    { v: 1, sections: [{ id: 'tolog', on: false }, { id: 'last', on: true }] });
  assert.deepEqual(normalise({ v: 1, sections: [{ id: 'tolog', on: 'yes' }, { id: 'last', on: true }] }).sections, [{ id: 'last', on: true }]);
  const many = Array.from({ length: 33 }, (_, i) => ({ id: `s${i}`, on: true }));
  assert.equal(normalise({ v: 1, sections: many }), null, '33 entries');
  assert.equal(normalise({ v: 1, sections: many.slice(0, 32) }).sections.length, 32);
  for (const bad of ['Upnext', '1abc', 'a_b', 'a b', '', 'x'.repeat(25), 'é']) {
    assert.deepEqual(normalise({ v: 1, sections: [{ id: bad, on: true }, { id: 'last', on: true }] }).sections.map((e) => e.id), ['last'], bad);
  }
  assert.equal(normalise({ v: 1, sections: [{ id: 'last', on: true }], updatedAt: '2026-10-13T20:00:00.000Z' }).updatedAt, '2026-10-13T20:00:00.000Z');
});

test('fullOrder: a section the document does not mention lands after its nearest predecessor present', () => {
  assert.deepEqual(top(doc('period', 'upnext', 'last')), ['period', 'upnext', 'tolog', 'last', 'bankroll']);
  // Nothing before it present: the front.
  assert.deepEqual(top(doc('last')), ['upnext', 'tolog', 'last', 'bankroll', 'period']);
  // Unknown ids keep their places; parts are not top-level.
  assert.deepEqual(top(doc('trend', 'upnext', 'noise', 'period')), ['trend', 'upnext', 'tolog', 'last', 'bankroll', 'period']);
  assert.deepEqual(top(null), ['upnext', 'tolog', 'last', 'bankroll', 'period']);
});

test('resolve: the phone order splits into the two desktop panes in the same relative order', () => {
  const d = doc('bankroll', 'upnext', 'period', 'tolog', 'last');
  const r = resolve(d, ADMIN);
  assert.deepEqual(r.phone, ['bankroll', 'upnext', 'period', 'tolog', 'last']);
  assert.deepEqual(r.now, ['upnext', 'tolog', 'last']);
  assert.deepEqual(r.numbers, ['bankroll', 'period']);
  // Hidden sections are absent; a non-admin never gets the bankroll line.
  const off = doc('bankroll', 'upnext', 'period', { id: 'tolog', on: false }, 'last');
  assert.deepEqual(resolve(off, ADMIN).phone, ['bankroll', 'upnext', 'period', 'last']);
  assert.deepEqual(resolve(off, USER).phone, ['upnext', 'period', 'last']);
  assert.deepEqual(resolve(off, USER).numbers, ['period']);
  // Up Next is locked on, whatever the document says.
  assert.ok(resolve(doc({ id: 'upnext', on: false }), USER).phone.includes('upnext'));
});

test('move is slot-preserving: an unknown id never moves', () => {
  const d = doc('upnext', 'xsec', 'tolog', 'last');
  const out = move(d, 'last', -1, USER);
  assert.deepEqual(top(out).slice(0, 4), ['upnext', 'xsec', 'last', 'tolog']);
  assert.deepEqual(top(out), ['upnext', 'xsec', 'last', 'tolog', 'bankroll', 'period']);
  // The unknown id is still in the stored document, in place.
  assert.equal(ids(out)[1], 'xsec');
  // The ends: no move past the first or the last.
  assert.equal(move(d, 'upnext', -1, USER), d);
  // A section this viewer cannot see does not move, and moves around it keep its slot.
  const a = doc('upnext', 'tolog', 'bankroll', 'last', 'period');
  assert.deepEqual(top(move(a, 'last', -1, USER)), ['upnext', 'last', 'bankroll', 'tolog', 'period']);
  assert.equal(move(a, 'bankroll', 1, USER), a);
});

test('a desktop group move rewrites only that group\'s slots', () => {
  const d = doc('bankroll', 'upnext', 'period', 'tolog', 'last');
  const out = move(d, 'period', -1, ADMIN, { group: 'numbers' });
  assert.deepEqual(top(out), ['period', 'upnext', 'bankroll', 'tolog', 'last']);
  // moveTo within a group, and the same move on the phone list for comparison.
  assert.deepEqual(top(moveTo(d, 'last', 0, ADMIN, { group: 'now' })), ['bankroll', 'last', 'period', 'upnext', 'tolog']);
  assert.deepEqual(top(moveTo(d, 'last', 0, ADMIN)), ['last', 'bankroll', 'upnext', 'period', 'tolog']);
  // A move clamps to its list.
  // (friends and scanner, unmentioned, sit after period and take two of the NOW slots, so the group's
  // order lands one slot later than it did without them.)
  assert.deepEqual(top(moveTo(d, 'upnext', 99, ADMIN, { group: 'now' })), ['bankroll', 'period', 'tolog', 'last', 'upnext']);
});

test('toggle: a locked section is a no-op; parts follow their parent', () => {
  assert.equal(toggle(null, 'upnext', false, ADMIN), null);
  const d = toggle(null, 'tolog', false, ADMIN);
  assert.equal(isSwitchedOn(d, 'tolog'), false);
  assert.deepEqual(resolve(d, ADMIN).phone, ['upnext', 'last', 'bankroll', 'period']);
  // Hiding the period block hides its noise line and goals whatever their own switches say.
  const p = toggle(null, 'period', false, ADMIN);
  const r = resolve(p, ADMIN);
  assert.ok(!r.on.has('period') && !r.on.has('noise') && !r.on.has('goals'));
  assert.equal(isSwitchedOn(p, 'noise'), true, 'the part keeps its own switch');
  // A part on its own.
  const n = toggle(null, 'noise', false, ADMIN);
  assert.ok(resolve(n, ADMIN).on.has('goals') && !resolve(n, ADMIN).on.has('noise'));
  // A non-admin cannot switch an admin part.
  assert.equal(toggle(null, 'goals', false, USER), null);
  // The sheet's rows: the parts under This month, disabled while it is off.
  const rows = sheetRows(p, ADMIN);
  const period = rows.all.find((x) => x.id === 'period');
  assert.deepEqual(period.parts.map((x) => [x.id, x.enabled]), [['noise', false], ['goals', false]]);
  assert.deepEqual(only(rows.now.map((x) => x.id)), ['upnext', 'tolog', 'last']);
  assert.deepEqual(only(sheetRows(null, USER).all.map((x) => x.id)), ['upnext', 'tolog', 'last', 'period']);
  assert.deepEqual(sheetRows(null, USER).all.find((x) => x.id === 'period').parts, []);
});

test('isDefault and bankrollAbovePeriod', () => {
  assert.equal(isDefault(null, ADMIN), true);
  assert.equal(isDefault(defaultDoc(), ADMIN), true);
  assert.equal(isDefault({ v: 9 }, ADMIN), true, 'junk is the default');
  assert.equal(isDefault(toggle(null, 'goals', false, ADMIN), ADMIN), false);
  // A switch this viewer cannot see does not make their home non-default.
  assert.equal(isDefault(toggle(null, 'goals', false, ADMIN), USER), true);
  assert.equal(isDefault(doc('period', 'upnext'), USER), false);
  assert.equal(isDefault(doc('bankroll', 'upnext', 'tolog', 'last', 'period'), USER), true, 'the bankroll line is not theirs');
  assert.equal(bankrollAbovePeriod(['upnext', 'bankroll', 'period']), true);
  assert.equal(bankrollAbovePeriod(['bankroll', 'upnext', 'period']), false);
  assert.equal(bankrollAbovePeriod(['period', 'bankroll']), false);
  assert.equal(bankrollAbovePeriod(['period']), false);
  assert.equal(bankrollAbovePeriod(null), false);
});

test('reconcile: every branch', () => {
  const L = doc('period', 'upnext');
  const S = doc('last', 'upnext');
  // The request failed (or a guest): the local copy stays.
  assert.deepEqual(reconcile({ local: { layout: L, dirty: true }, server: undefined }), { doc: L, push: false });
  assert.deepEqual(reconcile({ local: null, server: undefined }), { doc: null, push: false });
  // A local change not yet saved wins, and is pushed.
  assert.deepEqual(reconcile({ local: { layout: L, dirty: true }, server: S }), { doc: L, push: true });
  assert.deepEqual(reconcile({ local: { layout: null, dirty: true }, server: S }), { doc: null, push: true }, 'a reset made offline');
  // Otherwise the server's, null being the default.
  assert.deepEqual(reconcile({ local: { layout: L, dirty: false }, server: S }).doc, S);
  assert.deepEqual(reconcile({ local: { layout: L, dirty: false }, server: null }), { doc: null, push: false });
  assert.deepEqual(reconcile({ local: null, server: { v: 2 } }), { doc: null, push: false }, 'junk from the server is the default');
  assert.equal(cacheKey(42), 'homeLayout:u42');
});

test('a layout from a newer build keeps its unknown ids in place on save; an older one gains the new section', () => {
  const newer = doc('upnext', { id: 'trend', on: true }, 'period', 'tolog', 'last');
  assert.deepEqual(resolve(newer, USER).phone, ['upnext', 'period', 'tolog', 'last'], 'unknown ids are not rendered');
  const saved = toggle(newer, 'tolog', false, USER);
  assert.deepEqual(ids(saved).slice(0, 2), ['upnext', 'trend']);
  assert.deepEqual(saved.sections.find((e) => e.id === 'trend'), { id: 'trend', on: true });
  // An older layout (no 'last'): the section appears, on, at its default position.
  const older = doc('period', 'upnext', 'tolog');
  assert.deepEqual(resolve(older, USER).phone, ['period', 'upnext', 'tolog', 'last']);
});

test('friends and scanner start off: hidden on a default home, shown once switched on, and the home stays default', () => {
  assert.deepEqual(available(GUEST).map((s) => s.id).filter((id) => LATE.has(id)), [], 'registered only');
  assert.ok(!resolve(null, USER).phone.includes('friends') && !resolve(null, USER).phone.includes('scanner'));
  assert.equal(isSwitchedOn(null, 'friends'), false);
  // A layout saved before they existed does not mention them: still off.
  assert.ok(!resolve(doc('upnext', 'tolog', 'last', 'period'), USER).phone.includes('scanner'));
  assert.equal(isDefault(null, USER), true);
  const on = toggle(null, 'friends', true, USER);
  assert.equal(isSwitchedOn(on, 'friends'), true);
  assert.ok(resolve(on, USER).now.includes('friends'));
  assert.equal(isDefault(on, USER), false);
});
