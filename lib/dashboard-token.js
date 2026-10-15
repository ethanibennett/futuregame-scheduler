// The DASHBOARD_TOKEN check, with an overlap window for rotation.
//
// DASHBOARD_TOKEN is one shared secret that gates the dashboard's read seams: the
// dashboard presents it to read the scheduler's departures board, and the
// screensaver, widget and apps present it to read the dashboard. Both ends compare
// it byte-for-byte against a single env var.
//
// It no longer guards the backer roster. Because it is compiled into the iOS
// builds, anyone who extracts it could have pulled every backer's /b/ token, phone
// and email; the roster now has a server-only ROSTER_TOKEN of its own, sent as an
// Authorization: Bearer header (dashboard: server/lib/roster-token.js; scheduler:
// syncBackerRoster). DASHBOARD_TOKEN does not unlock it.
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

const { checkSharedToken, TOKEN_SHAPE: SHAPE } = require('./shared-token');

/** Same shape both services already enforced: a malformed token must not reach
 *  the compare at all. */
const TOKEN_SHAPE = SHAPE;

/** timingSafeEqual throws on unequal-length buffers, so the length is checked
 *  first. That leaks the token's LENGTH, which is the posture both services
 *  already had and is not worth changing: the secret is 64 chars of entropy. */
const constantTimeEquals = require('./shared-token').constantTimeEquals;

/**
 * @returns {{ok: boolean, via: 'current'|'previous'|null}}
 */
function checkDashboardToken(token, env = process.env) {
  // lib/shared-token.js: the same constant-time check the owner API and the ledger pull use.
  return checkSharedToken(token, { current: env.DASHBOARD_TOKEN || '', previous: env.DASHBOARD_TOKEN_PREVIOUS || '' });
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
