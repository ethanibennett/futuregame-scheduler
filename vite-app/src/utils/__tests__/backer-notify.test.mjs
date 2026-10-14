// The Backers block's wording (utils/backer-notify.js): it words what the server sent and never
// recomputes a figure.   node --test src/utils/__tests__/backer-notify.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalise, rowView, blockTitle, emptyText, notifyLabel, confirmText, footNote, sentToast, warningText, fmtPct, dayOfMs,
} from '../backer-notify.js';

const answer = (over = {}) => ({
  result: { refTable: 'tracking_entries', refId: 7, kind: 'tournament', date: '2026-10-11', game: 'PLO MTT', venue: 'Borgata', resultCents: -100000, currency: 'USD' },
  backers: [
    { key: 'r-dan', name: 'Dan Whitcombe', pct: 25, shareCents: -25000, resultCents: -100000, status: 'new', sentAt: null, updated: false,
      warnings: [{ kind: 'dashboard', date: '2026-10-11', game: 'PLO MTT', venue: 'Borgata', shareCents: -5000 }, { kind: 'series', series: ['Fall Series'] }] },
    { key: 'r-sam', name: 'Sam Okafor', pct: 20, shareCents: -20000, resultCents: -100000, status: 'new', sentAt: null, updated: false, warnings: [] },
  ],
  pending: 2, sent: 0, needsConfirm: true, state: 'preview', rosterSize: 4, delivery: 'off',
  ...over,
});
const NOON = Date.UTC(2026, 9, 14, 16, 0, 0); // mid-day in every US zone
const dayOf = () => '2026-10-14';

test('normalise: keeps the documented fields, drops what is not; a bad shape is null', () => {
  const b = normalise({ ...answer(), token: 'x' });
  assert.equal(b.backers.length, 2);
  assert.deepEqual(Object.keys(b.backers[0]).sort(), ['key', 'name', 'pct', 'resultCents', 'sentAt', 'shareCents', 'status', 'updated', 'warnings']);
  assert.equal(b.needsConfirm, true);
  assert.equal(b.state, 'preview');
  assert.equal(normalise(null), null);
  assert.equal(normalise({ error: 'Forbidden' }), null);
  assert.equal(normalise({ result: {}, backers: 'no' }), null);
  assert.equal(normalise({ ...answer(), state: 'odd', delivery: 'maybe' }).state, 'none');
  assert.equal(normalise({ ...answer(), delivery: 'maybe' }).delivery, 'off');
});

test('rowView: the share as the page writes it, "20% of −$1,000 · Not sent", and each warning on a line', () => {
  const b = normalise(answer());
  const dan = rowView(b.backers[0], { thisYear: 2026, dayOf });
  assert.equal(dan.name, 'Dan Whitcombe');
  assert.equal(dan.share, '−$250');
  assert.equal(dan.shareTone, 'is-neg');
  assert.equal(dan.detail, '25% of −$1,000 · Not sent');
  assert.deepEqual(dan.warnings, ['The dashboard sent −$50 on Oct 11 (PLO MTT)', 'Also backs this event in Fall Series']);
  const sam = rowView(b.backers[1], { thisYear: 2026, dayOf });
  assert.deepEqual(sam.warnings, []);
});

test('rowView: sent reads "Sent Oct 14", and "· Updated" once an edit moved the share; another year shows its year', () => {
  const sent = normalise(answer({ backers: [{ key: 'a', name: 'A', pct: 12.5, shareCents: 30000, resultCents: 240000, status: 'sent', sentAt: NOON, updated: true, warnings: [] }] }));
  assert.equal(rowView(sent.backers[0], { thisYear: 2026, dayOf }).detail, '12.5% of +$2,400 · Sent Oct 14 · Updated');
  assert.equal(rowView({ ...sent.backers[0], updated: false }, { thisYear: 2027, dayOf }).detail, '12.5% of +$2,400 · Sent Oct 14, 2026');
  assert.equal(rowView({ ...sent.backers[0], name: null }, { thisYear: 2026, dayOf }).name, 'Unnamed backer');
});

test('title, empty text, the Notify label', () => {
  const b = normalise(answer());
  assert.equal(blockTitle(b), 'Backers · PLO MTT');
  assert.equal(emptyText(normalise(answer({ backers: [], result: { ...answer().result, game: 'Razz MTT' } }))), 'No backers staked in Razz MTT.');
  assert.equal(notifyLabel(1), 'Notify 1 backer');
  assert.equal(notifyLabel(2), 'Notify 2 backers');
});

test('confirmText names who may be doubled and why, and how many shares go', () => {
  const b = normalise(answer());
  assert.equal(confirmText(b, { thisYear: 2026 }),
    'Dan Whitcombe may already have this night: the dashboard app sent a share on Oct 11, and a series agreement covers this event. Send all 2 shares anyway?');
  const one = normalise(answer({ backers: [answer().backers[0]], pending: 1 }));
  one.backers[0].warnings = one.backers[0].warnings.filter((w) => w.kind === 'series');
  assert.equal(confirmText(one), 'Dan Whitcombe may already have this night: a series agreement covers this event. Send the share anyway?');
  const two = normalise(answer());
  two.backers[1].warnings = [{ kind: 'dashboard', date: '2026-10-11', game: '', shareCents: 1 }];
  assert.equal(confirmText(two), 'Dan Whitcombe and Sam Okafor may already have this night: the lines under each name say why. Send all 2 shares anyway?');
});

test('footNote: what a tap does where delivery is off or on, and what an edit does once sent', () => {
  assert.match(footNote(normalise(answer())), /^Delivery is off on this server/);
  assert.match(footNote(normalise(answer({ delivery: 'on' }))), /^Nothing posts on save\./);
  assert.match(footNote(normalise(answer({ pending: 0, sent: 2, state: 'sent' }))), /without telling them\.$/);
  assert.equal(footNote(normalise(answer({ backers: [] }))), null);
});

test('sentToast: sent, recorded with delivery off, already sent, not on push', () => {
  assert.equal(sentToast({ already: true }), 'Already sent. Nothing new to send.');
  assert.equal(sentToast({ sentNow: 2, delivery: 'off' }), 'Recorded for 2 backers. Delivery is off on this server.');
  assert.equal(sentToast({ sentNow: 2, delivery: 'on', results: [{ subs: 1 }, { subs: 0 }] }), 'Sent to 2 backers · 1 not on push yet');
  assert.equal(sentToast({ sentNow: 1, delivery: 'on', results: [{ subs: 2 }] }), 'Sent to 1 backer');
});

test('small formatters', () => {
  assert.equal(fmtPct(12.5), '12.5%');
  assert.equal(fmtPct(0.1 + 0.2), '0.3%');
  assert.equal(warningText({ kind: 'series', series: [] }), 'Also backs this event in a series');
  assert.match(dayOfMs(NOON), /^2026-10-1[45]$/);
  assert.equal(dayOfMs('x'), '');
});
