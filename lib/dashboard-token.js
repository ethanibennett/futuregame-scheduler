// The DASHBOARD_TOKEN check, with an overlap window for rotation.
//
// DASHBOARD_TOKEN is one shared secret that gates both dashboard seams, in both
// directions: the scheduler presents it to pull the backer roster, and the
// dashboard presents it to read the departures board. Both ends compare it
// byte-for-byte against a single env var.
//
// That made it effectively UNROTATABLE. There are seven copies — two Render
// envs, the local ecosystem.config.cjs, a GitHub secret, the cash watcher, the
// screensaver config, and, worst of all, DashboardSecret.swift COMPILED INTO
// every installed iOS and Watch build. Change the value and every consumer that
// has not caught up is locked out until it does, which for the phone means
// waiting on a TestFlight build. So the honest options were "never rotate" or
// "break the apps", and the first one is how a token stays live after it leaks.
//
// A second accepted value fixes that. DASHBOARD_TOKEN_PREVIOUS is accepted for
// INBOUND checks only — never presented outbound, so a rotation always pushes
// the new value forward rather than settling back on the old one. The sequence
// becomes: set PREVIOUS to the current value, roll the new value through all
// seven, ship the app, then delete PREVIOUS. Nothing is ever locked out.
//
// `via` says WHICH value matched, so a caller can log when something is still
// using the old one. That log is the signal that the rotation is finished: when
// it stops appearing, every consumer has caught up and PREVIOUS can go.

const crypto = require('crypto');

/** Same shape both services already enforced: a malformed token must not reach
 *  the compare at all. */
const TOKEN_SHAPE = /^[A-Za-z0-9]{6,64}$/;

/** timingSafeEqual throws on unequal-length buffers, so the length is checked
 *  first. That leaks the token's LENGTH, which is the posture both services
 *  already had and is not worth changing: the secret is 64 chars of entropy. */
function constantTimeEquals(candidate, expected) {
  if (!expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * @returns {{ok: boolean, via: 'current'|'previous'|null}}
 */
function checkDashboardToken(token, env = process.env) {
  const t = String(token == null ? '' : token);
  if (!TOKEN_SHAPE.test(t)) return { ok: false, via: null };

  /* Both compared before either is acted on. Returning early on a match would
     make the response time say which value matched, which is exactly the thing
     a constant-time compare is for. */
  const isCurrent = constantTimeEquals(t, env.DASHBOARD_TOKEN || '');
  const isPrevious = constantTimeEquals(t, env.DASHBOARD_TOKEN_PREVIOUS || '');

  if (isCurrent) return { ok: true, via: 'current' };
  if (isPrevious) return { ok: true, via: 'previous' };
  return { ok: false, via: null };
}

/** The value to PRESENT when calling the other service. Always the current one:
 *  a rotation has to move forward, and an outbound call that fell back to the
 *  previous value would keep the old secret alive indefinitely. */
function outboundDashboardToken(env = process.env) {
  return env.DASHBOARD_TOKEN || '';
}

/** Warn that something is still on the old token, at most once an hour so an
 *  unrotated consumer polling every minute cannot flood the log. */
function makePreviousTokenWarner(log = console.warn, intervalMs = 60 * 60 * 1000) {
  let last = 0;
  return (label) => {
    const now = Date.now();
    if (now - last < intervalMs) return;
    last = now;
    log(`[dashboard-token] ${label} authenticated with DASHBOARD_TOKEN_PREVIOUS — a consumer has not been rotated yet. Once this stops appearing, unset DASHBOARD_TOKEN_PREVIOUS.`);
  };
}

module.exports = { checkDashboardToken, outboundDashboardToken, makePreviousTokenWarner, TOKEN_SHAPE };
