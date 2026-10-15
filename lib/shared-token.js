'use strict';
/*
 * One constant-time check for every shared secret two services hold (docs/bankroll-merge.md §11.1):
 * DASHBOARD_TOKEN (lib/dashboard-token.js, a thin wrapper now) and LEDGER_TOKEN (the owner API,
 * lib/owner-api). The same shape both services always enforced; a malformed value never reaches the
 * compare. Both the current and the previous value are compared before either is acted on, so the
 * response time does not say which one matched.
 */
const crypto = require('crypto');

const TOKEN_SHAPE = /^[A-Za-z0-9]{6,64}$/;

function constantTimeEquals(candidate, expected) {
  if (!expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** -> { ok, via: 'current' | 'previous' | null } */
function checkSharedToken(token, { current, previous } = {}) {
  const t = String(token == null ? '' : token);
  if (!TOKEN_SHAPE.test(t)) return { ok: false, via: null };
  const isCurrent = constantTimeEquals(t, String(current || '').trim());
  const isPrevious = constantTimeEquals(t, String(previous || '').trim());
  if (isCurrent) return { ok: true, via: 'current' };
  if (isPrevious) return { ok: true, via: 'previous' };
  return { ok: false, via: null };
}

/** The bearer value of an Authorization header, or ''. */
function bearerOf(req) {
  const h = String((req && req.headers && req.headers.authorization) || '');
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : '';
}

module.exports = { TOKEN_SHAPE, constantTimeEquals, checkSharedToken, bearerOf };
