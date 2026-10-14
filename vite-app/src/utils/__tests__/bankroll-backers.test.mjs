// node --test src/utils/__tests__/bankroll-backers.test.mjs  (from vite-app/)
// The bankroll Backers tab (utils/bankroll-backers.js) on a response shaped like
// GET /api/staking/standing/backers: the formatting it adds to the server's figures, and that it
// adds up and recomputes nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalise, displayName, stakesLine, statItems, deliveryText, shareRow, moreLine, listSummary, toneClass, fmtPct,
  NO_NAME, NO_STAKES,
} from '../bankroll-backers.js';

const SHARE = { date: '2026-10-12', game: '5/5/10 PLO', venue: 'Bellagio', hours: 8, sessionResultCents: -120000, pct: 20, shareCents: -24000 };
const B = (o = {}) => ({
  id: 'demo-full', name: 'Sam Okafor', stakes: '20% PLO · 10% NLH (online)', openingCents: 50000, cumulativeCents: 123456,
  sessions: 40, hours: 212.5, shares: [SHARE], delivery: { sms: false, email: true }, link: 'https://futurega.me/b/DemoSam7Kq2Vx', ...o,
});

test('normalise: the server\'s figures pass through untouched, in cents', () => {
  const [b] = normalise({ backers: [B()] });
  assert.deepEqual(b, B());
});

test('normalise: a malformed answer is an empty list, and a half-filled backer gets quiet defaults', () => {
  assert.deepEqual(normalise(null), []);
  assert.deepEqual(normalise({}), []);
  assert.deepEqual(normalise({ backers: 'x' }), []);
  assert.deepEqual(normalise({ backers: [null, 3, 'a'] }), []);
  const [b] = normalise({ backers: [{ name: '  ', shares: [null, { date: '2026-01-02', pct: '12.5' }], delivery: null, link: 'javascript:alert(1)' }] });
  assert.equal(b.id, 'backer-0');
  assert.equal(b.name, null);
  assert.equal(b.stakes, '');
  assert.deepEqual([b.openingCents, b.cumulativeCents, b.sessions, b.hours], [0, 0, 0, 0]);
  assert.equal(b.shares.length, 1);
  assert.equal(b.shares[0].pct, 12.5);
  assert.deepEqual(b.delivery, { sms: false, email: false });
  assert.equal(b.link, '', 'only an https link goes into an href');
});

test('names and stakes: a record with no name or no stakes in force gets a stand-in', () => {
  assert.equal(displayName(B()), 'Sam Okafor');
  assert.equal(displayName(B({ name: null })), NO_NAME);
  assert.equal(stakesLine(B()), '20% PLO · 10% NLH (online)');
  assert.equal(stakesLine(B({ stakes: '' })), NO_STAKES);
});

test('statItems: sessions, hours and the opening, worded as the backer\'s page words them', () => {
  assert.deepEqual(statItems(B()).map((i) => i.text), ['40 sessions', '212.5 h', 'Opening $500']);
  assert.deepEqual(statItems(B({ sessions: 1, hours: 5, openingCents: -25000 })).map((i) => i.text), ['1 session', '5 h', 'Opening −$250']);
  assert.deepEqual(statItems(B({ sessions: 0, hours: 0, openingCents: 0 })).map((i) => i.text), ['0 sessions', '0 h', 'Opening $0']);
  assert.deepEqual(statItems(B({ sessions: 1234 })).map((i) => i.text)[0], '1,234 sessions');
});

test('toneClass: green up, red down, nothing at a displayed $0', () => {
  assert.equal(toneClass(100), ' an-pos');
  assert.equal(toneClass(-100), ' an-neg');
  assert.equal(toneClass(0), '');
  assert.equal(toneClass(49), '', '49 cents reads "$0": not coloured');
  assert.equal(toneClass(-49), '');
  assert.equal(toneClass(50), ' an-pos');
});

test('deliveryText: each of the four states, and the long form a screen reader gets', () => {
  assert.equal(deliveryText({ sms: true, email: true }).short, 'SMS • Email');
  assert.equal(deliveryText({ sms: true, email: false }).short, 'SMS only');
  assert.equal(deliveryText({ sms: false, email: true }).short, 'Email only');
  assert.equal(deliveryText({ sms: false, email: false }).short, 'No delivery');
  assert.equal(deliveryText(undefined).short, 'No delivery');
  assert.match(deliveryText({ sms: true, email: true }).long, /Texts and the weekly email/);
});

test('shareRow: date (the year only when it is not this one), hours, game, venue, the cut and what it was a cut of', () => {
  const r = shareRow(SHARE, 2026);
  assert.deepEqual(r, { date: 'Oct 12', hours: '8 h', game: '5/5/10 PLO', venue: 'Bellagio', share: '−$240', shareTone: ' an-neg', of: '20% of −$1,200' });
  assert.equal(shareRow({ ...SHARE, date: '2025-10-12' }, 2026).date, 'Oct 12, 2025');
  const win = shareRow({ ...SHARE, hours: 6.5, sessionResultCents: 84000, pct: 12.5, shareCents: 10500 }, 2026);
  assert.deepEqual([win.hours, win.share, win.shareTone, win.of], ['6.5 h', '+$105', ' an-pos', '12.5% of +$840']);
  const bare = shareRow({ date: '2026-01-02', game: '', venue: '', hours: 0, sessionResultCents: 0, pct: 10, shareCents: 0 }, 2026);
  assert.deepEqual([bare.game, bare.venue, bare.hours, bare.share, bare.shareTone, bare.of], ['Session', '', '', '$0', '', '10% of $0']);
});

test('fmtPct: whole and half percentages, no float noise', () => {
  assert.equal(fmtPct(20), '20%');
  assert.equal(fmtPct(12.5), '12.5%');
  assert.equal(fmtPct(0.1 + 0.2), '0.3%');
  assert.equal(fmtPct('7'), '7%');
});

test('moreLine: only when the history is longer than the rows shown', () => {
  assert.equal(moreLine(B({ sessions: 250, shares: Array(10).fill(SHARE) })), 'Last 10 of 250 sessions');
  assert.equal(moreLine(B({ sessions: 1, shares: [SHARE] })), null);
  assert.equal(moreLine(B({ sessions: 10, shares: Array(10).fill(SHARE) })), null);
  assert.equal(moreLine(B({ sessions: 5, shares: [] })), null, 'no rows, no "last 0 of 5"');
});

test('listSummary: counts and the plain sum of the running totals the server sent (nothing is recomputed)', () => {
  assert.deepEqual(listSummary([]), { count: 0, sessions: 0, totalCents: 0 });
  assert.deepEqual(listSummary([B(), B({ cumulativeCents: -50000, sessions: 2 })]), { count: 2, sessions: 42, totalCents: 73456 });
});
