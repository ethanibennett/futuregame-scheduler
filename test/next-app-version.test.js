'use strict';
// node test/next-app-version.test.js — the version an iOS upload takes (scripts/next-app-version.js).
const assert = require('assert');
const { nextAppVersion } = require('../scripts/next-app-version');

const cases = [
  // [App Store Connect's highest, committed, bump, expected, why]
  ['1.0', '1.0', true, '1.01', 'the first nightly after 1.0'],
  ['1.01', '1.0', true, '1.02', 'the next nightly, past the committed value CI never updates'],
  ['1.09', '1.0', true, '1.10', 'two digits roll over'],
  ['1.10', '1.0', true, '1.11', '1.10 is after 1.09'],
  ['1.01', '1.0', false, '1.01', 'a push by hand joins the night\'s version'],
  ['1.0', '1.0', false, '1.0', 'nothing newer: unchanged'],
  ['1.0', '1.02', false, '1.02', 'never behind the committed value'],
  ['1.0', '1.02', true, '1.03', 'a nightly past the committed value when it is ahead'],
  ['2.0', '1.05', true, '2.01', 'a new major'],
  ['0', '1.0', false, '1.0', 'App Store Connect unreadable: the committed value'],
];
for (const [apple, committed, bump, want, why] of cases) {
  assert.strictEqual(nextAppVersion(apple, committed, bump), want, `${apple} / ${committed} / ${bump}: ${why}`);
}
console.log(`next-app-version: ${cases.length} passed`);
