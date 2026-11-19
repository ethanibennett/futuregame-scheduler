import test from 'node:test';
import assert from 'node:assert/strict';
import { googleCalendarUrl, clockMinutes } from '../google-calendar.js';

const params = (url) => Object.fromEntries(new URL(url).searchParams);

test('an event fills Google\'s new-event page in the room\'s own time and zone', () => {
  const t = { event_number: '12', event_name: '$1,600 NLH', date: '2026-12-12', time: '11:00 AM', buyin: 1600,
    late_reg_end: 'Level 10', level_duration: '40', property: 'Wynn Las Vegas', venue: 'Wynn Winter Classic' };
  const url = googleCalendarUrl(t, { zone: 'America/Los_Angeles' });
  assert.ok(url.startsWith('https://calendar.google.com/calendar/render?'));
  const p = params(url);
  assert.equal(p.action, 'TEMPLATE');
  assert.equal(p.text, '#12 $1,600 NLH');
  assert.equal(p.dates, '20261212T110000/20261212T174000', 'to the close of late reg, level 10 of 40 minutes');
  assert.equal(p.ctz, 'America/Los_Angeles');
  assert.equal(p.location, 'Wynn Las Vegas · Wynn Winter Classic');
  assert.equal(p.details, 'Buy-in $1,600\nLate reg: Level 10\nFrom futurega.me');
});

test('late reg by the clock past midnight runs into the next day; nothing said is 8 hours', () => {
  const night = googleCalendarUrl({ event_name: 'Turbo', date: '2026-12-31', time: '7:00 PM', late_reg_end: '1:30 AM', venue: 'Borgata' });
  assert.equal(params(night).dates, '20261231T190000/20270101T013000');
  const plain = googleCalendarUrl({ event_name: 'NLH', date: '2026-12-12', time: '17:00', venue: 'Parx' });
  assert.equal(params(plain).dates, '20261212T170000/20261213T010000');
});

test('nothing to add: a Personal day, no time, no date', () => {
  assert.equal(googleCalendarUrl({ venue: 'Personal', event_name: 'Day Off', date: '2026-12-13', time: '12:00 PM' }), null);
  assert.equal(googleCalendarUrl({ event_name: 'NLH', date: '2026-12-13', time: 'TBD', venue: 'Parx' }), null);
  assert.equal(googleCalendarUrl({ event_name: 'NLH', date: '', time: '11 AM', venue: 'Parx' }), null);
  assert.equal(clockMinutes('11 AM'), 660);
});
