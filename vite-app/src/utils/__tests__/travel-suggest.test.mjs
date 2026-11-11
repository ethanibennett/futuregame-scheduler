// The travel day the schedule implies (utils/travel-suggest.js; UX pick 33).
import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestTravelDay, clockMinutes, pickerTime } from '../travel-suggest.js';

const PLACES = { Borgata: { lat: 39.378, lng: -74.433 }, 'Maryland Live!': { lat: 39.157, lng: -76.727 }, 'Ocean Casino': { lat: 39.366, lng: -74.420 } };
const opts = { todayIso: '2026-11-10', dateOf: (t) => t.d, placeOf: (t) => t.venue, coordsOf: (t) => PLACES[t.venue] || null };
const ev = (d, time, venue, name = 'NLH') => ({ d, time, venue, event_name: name });

test('a move between rooms far apart: the day of the next event, arriving an hour early', () => {
  const s = suggestTravelDay([
    ev('2026-11-10', '11:15 AM', 'Borgata', 'Flight C'),
    ev('2026-11-10', '5:15 PM', 'Borgata', 'Flight D'),
    ev('2026-11-11', '10:15 AM', 'Maryland Live!', 'NLH Live! Cup VIII, Flight A'),
  ], opts);
  assert.equal(s.date, '2026-11-11');
  assert.deepEqual(s.arrive, { hour: 9, minute: 15, amPm: 'AM' });
  assert.deepEqual(s.depart, { hour: 6, minute: 15, amPm: 'AM' });
  assert.match(s.note, /^Before NLH Live! Cup VIII, Flight A · Maryland Live! · 10:15 AM · from Borgata$/);
});

test('rooms within 30 miles, or a travel day already there: nothing', () => {
  assert.equal(suggestTravelDay([ev('2026-11-10', '1:00 PM', 'Borgata'), ev('2026-11-11', '1:00 PM', 'Ocean Casino')], opts), null);
  const planned = [ev('2026-11-10', '1:00 PM', 'Borgata'), { d: '2026-11-11', venue: 'Personal', event_name: 'Travel Day' }, ev('2026-11-11', '6:00 PM', 'Maryland Live!')];
  assert.equal(suggestTravelDay(planned, opts), null);
});

test('times: the picker\'s quarter hours', () => {
  assert.equal(clockMinutes('12:00 PM'), 720);
  assert.equal(clockMinutes('12:30 AM'), 30);
  assert.deepEqual(pickerTime(13 * 60 + 50), { hour: 1, minute: 45, amPm: 'PM' });
});
