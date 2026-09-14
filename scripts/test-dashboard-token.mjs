// The DASHBOARD_TOKEN check and its rotation overlap window.
//
//   node scripts/test-dashboard-token.mjs
//
// Imports the real module rather than mirroring it, so this cannot drift from
// what the server does. The identical file ships in wsop-console
// (server/lib/dashboard-token.js) — two ends of one handshake, deployed
// separately — and that copy has its own test.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { checkDashboardToken, outboundDashboardToken, makePreviousTokenWarner } =
  require('../lib/dashboard-token.js');

let pass = 0, fail = 0;
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + ' — expected ' + e + ', got ' + a); }
};
const ok = (label, cond) => eq(label, !!cond, true);

const CUR = 'a'.repeat(64);
const PREV = 'b'.repeat(64);
const env = (o) => o;

console.log('the current token, with no rotation in progress');
eq('accepted', checkDashboardToken(CUR, env({ DASHBOARD_TOKEN: CUR })), { ok: true, via: 'current' });
eq('a wrong token of the same length', checkDashboardToken('c'.repeat(64), env({ DASHBOARD_TOKEN: CUR })).ok, false);
eq('a wrong token of a different length', checkDashboardToken('c'.repeat(32), env({ DASHBOARD_TOKEN: CUR })).ok, false);

console.log('during a rotation, both are accepted');
const rotating = env({ DASHBOARD_TOKEN: CUR, DASHBOARD_TOKEN_PREVIOUS: PREV });
eq('the new token', checkDashboardToken(CUR, rotating), { ok: true, via: 'current' });
/* The whole point: a consumer that has not been updated yet — an installed iOS
   build, the screensaver, the cash watcher — keeps working. */
eq('and the old one, flagged as such', checkDashboardToken(PREV, rotating), { ok: true, via: 'previous' });
eq('something else still is not', checkDashboardToken('d'.repeat(64), rotating).ok, false);

console.log('after the rotation is finished');
const done = env({ DASHBOARD_TOKEN: CUR });
eq('the new token still works', checkDashboardToken(CUR, done).ok, true);
eq('and the old one is dead', checkDashboardToken(PREV, done).ok, false);

console.log('the guards that keep an unset variable from being a skeleton key');
// An unset DASHBOARD_TOKEN must never make an empty or absent token valid.
eq('empty token, empty env', checkDashboardToken('', env({})).ok, false);
eq('empty token, real env', checkDashboardToken('', env({ DASHBOARD_TOKEN: CUR })).ok, false);
eq('real token, empty env', checkDashboardToken(CUR, env({})).ok, false);
eq('null token', checkDashboardToken(null, env({ DASHBOARD_TOKEN: CUR })).ok, false);
eq('undefined token', checkDashboardToken(undefined, env({ DASHBOARD_TOKEN: CUR })).ok, false);
// An empty PREVIOUS is not a wildcard either.
eq('empty PREVIOUS matches nothing', checkDashboardToken('', env({ DASHBOARD_TOKEN: CUR, DASHBOARD_TOKEN_PREVIOUS: '' })).ok, false);
// Shape gate: a malformed token never reaches the compare.
eq('punctuation is refused', checkDashboardToken('abc-def', env({ DASHBOARD_TOKEN: 'abc-def' })).ok, false);
eq('too short is refused', checkDashboardToken('abc', env({ DASHBOARD_TOKEN: 'abc' })).ok, false);
eq('too long is refused', checkDashboardToken('a'.repeat(65), env({ DASHBOARD_TOKEN: 'a'.repeat(65) })).ok, false);

console.log('outbound always presents the CURRENT token');
/* If an outbound call fell back to the previous value the old secret would stay
   in use forever and the rotation would never actually finish. */
eq('during a rotation', outboundDashboardToken(rotating), CUR);
eq('with no rotation', outboundDashboardToken(done), CUR);
eq('with nothing set', outboundDashboardToken(env({})), '');
ok('never the previous value', outboundDashboardToken(rotating) !== PREV);

console.log('the previous-token warning is throttled');
{
  const seen = [];
  const warn = makePreviousTokenWarner((m) => seen.push(m), 60_000);
  warn('a'); warn('b'); warn('c');
  eq('a consumer polling every minute cannot flood the log', seen.length, 1);
  ok('and the message says what to do', /unset DASHBOARD_TOKEN_PREVIOUS/.test(seen[0]));
}
{
  const seen = [];
  const warn = makePreviousTokenWarner((m) => seen.push(m), 0);
  warn('a'); warn('b');
  eq('with no interval, every call warns', seen.length, 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
