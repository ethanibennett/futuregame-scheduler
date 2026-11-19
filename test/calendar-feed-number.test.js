'use strict';
// node test/calendar-feed-number.test.js: the calendar feed's titles carry only a real event number
// (lib/calendar-feed.js shortEventNumber, the cards' rule), never the feed's own id (owner, 2026-11-19).
const assert = require('assert');
const { shortEventNumber } = require('../lib/calendar-feed');

const cases = [
  ['PA-310117-20261212', null, "PokerAtlas's id"],
  ['12', '12', 'a number'],
  ['12H', '12H', 'a number with a flight'],
  ['2, 6, 8, 10', '2, 6, 8, 10', 'a combined-flight list'],
  ['37-aria-20261212', '37', 'a number with the uniqueness suffix'],
  ['WSOP-circuit-202611-7-20261120', '7', 'the WSOP.com Online Circuit'],
  ['PHENOM-psop-i-37-20261101', '37', 'a Phenom series event'],
  ['', null, 'none'],
];
for (const [v, want, why] of cases) assert.strictEqual(shortEventNumber(v), want, `${v}: ${why}`);
console.log(`calendar-feed number: ${cases.length} passed`);
