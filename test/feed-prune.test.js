// lib/feed-prune.js: which feed rows a prune may delete — a past event stays 14 days (owner).
'use strict';
const assert = require('assert');
const { RETAIN_DAYS, eventDayKey, todayKey, dayKeyIn, isPastFeedRow, retainsPastFeedRow } = require('../lib/feed-prune');
let passed = 0;
const eq = (label, a, b) => { assert.deepStrictEqual(a, b, label); passed++; };

eq('retention is 14 days', RETAIN_DAYS, 14);
eq('feed dates', [eventDayKey('October 22, 2026'), eventDayKey('October 5, 2026'), eventDayKey('2026-10-22'), eventDayKey('10/22/2026'), eventDayKey(''), eventDayKey('TBD')],
  ['2026-10-22', '2026-10-05', '2026-10-22', '2026-10-22', null, null]);
// 01:30 ET on Oct 23 is 05:30Z on Oct 23 and 22:30 PT on Oct 22.
const now = Date.parse('2026-10-23T05:30:00Z');
eq('today in New York', todayKey('America/New_York', now), '2026-10-23');
eq('today in Los Angeles', todayKey('America/Los_Angeles', now), '2026-10-22');
eq('a bad zone falls back to New York', todayKey('Mars/Olympus', now), '2026-10-23');
eq('14 days ago in New York', dayKeyIn('America/New_York', now, 14), '2026-10-09');
eq("yesterday's Turning Stone row is past", isPastFeedRow({ date: 'October 22, 2026', timezone: 'America/New_York' }, now), true);
eq("Lake Tahoe's Oct 22 row is still today there", isPastFeedRow({ date: 'October 22, 2026', timezone: 'America/Los_Angeles' }, now), false);
// What a prune must keep.
const keep = (date, tz = 'America/New_York') => retainsPastFeedRow({ date, timezone: tz }, now);
eq("yesterday's row is retained", keep('October 22, 2026'), true);
eq('a row from 13 days ago is retained', keep('October 10, 2026'), true);
eq('a row from 14 days ago is retained (its last day)', keep('October 9, 2026'), true);
eq('a row from 15 days ago has fallen out', keep('October 8, 2026'), false);
eq("today's row is not retained (the source dropped it)", keep('October 23, 2026'), false);
eq('an upcoming row is not retained', keep('October 25, 2026'), false);
eq("Lake Tahoe's Oct 22 row is today there, so not retained", keep('October 22, 2026', 'America/Los_Angeles'), false);
eq('no zone reads as New York', retainsPastFeedRow({ date: 'October 22, 2026' }, now), true);
eq('an unreadable date is not retained (the old rule applies)', retainsPastFeedRow({ date: 'TBD' }, now), false);
console.log(`feed-prune.test.js — ${passed} assertions passed`);
