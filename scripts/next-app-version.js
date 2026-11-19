#!/usr/bin/env node
'use strict';
// The version an iOS upload takes (ios-testflight.sh; owner, 2026-11-19: "next should be 1.01 etc", then "only bump
// the nightly push").
//
//   node scripts/next-app-version.js <appStoreConnectHighest> <committed> <bump: true|false>
//
// Starts from the later of App Store Connect's highest version and the committed MARKETING_VERSION (compared number
// by number, so 1.10 is after 1.09), unchanged unless bump is "true", which takes the next minor in two digits:
// 1.0 → 1.01, 1.09 → 1.10, 1.99 → 1.100. Prints the version and nothing else. Tested by test/next-app-version.test.js.

const parts = (s) => String(s || '').split('.').map((x) => parseInt(x, 10) || 0);

function later(a, b) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? a : b;
  }
  return a;
}

function nextAppVersion(apple, committed, bump) {
  const base = /^\d+(\.\d+){0,2}$/.test(String(apple || '')) && apple !== '0' ? later(apple, committed) : committed;
  if (!bump) return base;
  const [major, minor = 0] = parts(base);
  return `${major}.${String(minor + 1).padStart(2, '0')}`;
}

module.exports = { nextAppVersion };

if (require.main === module) {
  const [apple, committed, bump] = process.argv.slice(2);
  console.log(nextAppVersion(apple, committed, bump === 'true' || bump === '1'));
}
