'use strict';
/*
 * Brute-force protection for the credential routes (login, register, password
 * reset). In memory, sliding window, no dependency — the same shape as
 * createRateLimiter in lib/quick-add.js, with two additions the auth routes need:
 *
 *   - a refund, so a SUCCESSFUL login does not count against its account, and
 *   - more than one key per request (the client IP AND the account), any one of
 *     which can refuse it.
 *
 * Attempts are taken BEFORE the password check, not recorded after a failure:
 * bcrypt is asynchronous, so a check-then-record limiter lets a burst of parallel
 * requests all pass the check before any of them has failed.
 *
 * State is per process. Render runs one instance, and a restart clearing the
 * windows is acceptable for a limiter whose window is 15 minutes.
 */

function createSlidingWindowLimiter({ limit, windowMs, now = Date.now, maxKeys = 50000 } = {}) {
  if (!(limit > 0) || !(windowMs > 0)) throw new Error('limit and windowMs are required');
  const hits = new Map(); // key -> ascending timestamps inside the window (never more than `limit`)
  let ops = 0;

  function live(key, t) {
    const list = hits.get(key);
    if (!list) return [];
    const kept = list.filter((x) => t - x < windowMs);
    if (kept.length) hits.set(key, kept); else hits.delete(key);
    return kept;
  }

  // Drop keys whose newest hit has left the window, so a stream of one-off keys
  // (attacker-chosen emails, rotating IPs) cannot grow the map without bound.
  function sweep(t) {
    for (const [key, list] of hits) {
      if (!list.length || t - list[list.length - 1] >= windowMs) hits.delete(key);
    }
  }

  return {
    /** Seconds until `key` may try again, or 0 if it may try now. */
    retryAfter(key) {
      const t = now();
      const list = live(key, t);
      if (list.length < limit) return 0;
      return Math.max(1, Math.ceil((list[0] + windowMs - t) / 1000));
    },
    /** Record one attempt for `key`. Returns the timestamp so it can be refunded. */
    hit(key) {
      const t = now();
      if (++ops % 1000 === 0 || hits.size > maxKeys) sweep(t);
      const list = live(key, t);
      list.push(t);
      hits.set(key, list);
      return t;
    },
    /** Remove one recorded attempt (the one stamped `stamp`, else the newest). */
    refund(key, stamp) {
      const list = hits.get(key);
      if (!list) return;
      const i = stamp == null ? list.length - 1 : list.lastIndexOf(stamp);
      if (i >= 0) list.splice(i, 1);
      if (!list.length) hits.delete(key);
    },
    /** Forget every attempt for `key`. */
    clear(key) { hits.delete(key); },
    reset() { hits.clear(); },
    size() { return hits.size; },
  };
}

/**
 * Express middleware factory. `keys(req)` returns the keys this request counts
 * against — e.g. ['ip:1.2.3.4', 'acct:a@b.c']. If ANY key is already at its
 * limit the request is refused with 429 + Retry-After and NOTHING is recorded
 * (a refused request must not extend its own lockout). Otherwise one attempt is
 * recorded on every key, and `req.authLimit.refund()` / `.clearAccount()` let
 * the route give it back when the attempt turns out to be legitimate.
 */
function authLimitMiddleware(limiter, keys, { label = 'auth', log = console } = {}) {
  return function authLimit(req, res, next) {
    if (log) logProxyChainOnce(req, log);
    const list = keys(req).filter(Boolean);
    let wait = 0;
    for (const k of list) wait = Math.max(wait, limiter.retryAfter(k));
    if (wait > 0) {
      res.set('Retry-After', String(wait));
      if (log) log.warn(`[auth-limit] ${label} 429 (${list.join(' ')}) retry in ${wait}s`);
      return res.status(429).json({ error: 'Too many attempts, please try again later.', retryAfter: wait });
    }
    const stamps = list.map((k) => [k, limiter.hit(k)]);
    req.authLimit = {
      /** Give back this request's attempt on every key. */
      refund() { for (const [k, s] of stamps) limiter.refund(k, s); },
      /** Forget all recorded attempts for one key (e.g. the account, after a correct password). */
      clear(k) { limiter.clear(k); },
    };
    next();
  };
}

/**
 * The client half of the key. IPv4 (and IPv4-mapped IPv6) is used whole; IPv6 is
 * cut to its /64, since a single host is routinely handed a whole /64 and could
 * otherwise rotate through addresses for free.
 */
function ipKey(req) {
  let ip = String((req && (req.ip || (req.socket && req.socket.remoteAddress))) || '');
  if (!ip) return null;
  if (ip.startsWith('::ffff:') && ip.includes('.')) ip = ip.slice(7);
  if (!ip.includes(':')) return 'ip:' + ip;
  const [head, tail = ''] = ip.split('%')[0].split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const full = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return 'ip6:' + full.slice(0, 4).map((x) => (parseInt(x, 16) || 0).toString(16)).join(':') + '::/64';
}

/**
 * The hop count `trust proxy` needs cannot be read off a document — it is the
 * number of proxies that actually append to X-Forwarded-For in front of this
 * process. Once per boot, on the first credential request, log the SHAPE of the
 * chain (entry counts and positions, no addresses) and, when Cloudflare's
 * CF-Connecting-IP is present, the TRUST_PROXY value that would make req.ip
 * equal it. Read it from the Render logs and set TRUST_PROXY if it disagrees.
 */
let proxyChainLogged = false;
function describeProxyChain(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  const cf = req.headers['cf-connecting-ip'] ? String(req.headers['cf-connecting-ip']).trim() : null;
  const j = cf ? xff.lastIndexOf(cf) : -1;
  return {
    xffEntries: xff.length,
    trustProxy: req.app ? req.app.get('trust proxy') : undefined,
    reqIpIsXffEntry: xff.length ? xff.lastIndexOf(req.ip) : -1,
    cfConnectingIp: cf ? (j >= 0 ? `XFF[${j}]` : 'not in XFF') : 'absent',
    suggestedTrustProxy: j >= 0 ? xff.length - j : null,
  };
}
function logProxyChainOnce(req, log) {
  if (proxyChainLogged) return;
  proxyChainLogged = true;
  try { log.log(`[auth-limit] proxy chain ${JSON.stringify(describeProxyChain(req))}`); } catch (_) {}
}

/** The account a credential request names, normalised the way lookups should be. */
function accountKey(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return v ? 'acct:' + v.slice(0, 254) : null;
}

/**
 * Resolve Express's `trust proxy` setting from the TRUST_PROXY env, defaulting to
 * one hop on Render (which sets RENDER=true) and none elsewhere.
 *
 * One hop means req.ip is the address that connected to Render's edge proxy —
 * the rightmost X-Forwarded-For entry, which that proxy appended and a client
 * cannot forge. Trusting more hops than actually exist would make req.ip the
 * client's own spoofable header, which is the one failure that defeats an IP
 * limiter outright; trusting too few only coarsens the key. Hence: default low,
 * override with TRUST_PROXY (a hop count, 'true'/'false', or a subnet list) once
 * the real chain is known.
 */
function resolveTrustProxy(env = process.env) {
  const raw = env.TRUST_PROXY;
  if (raw == null || raw === '') return env.RENDER ? 1 : false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw; // e.g. 'loopback, 10.0.0.0/8' — passed straight to Express
}

module.exports = {
  createSlidingWindowLimiter, authLimitMiddleware, ipKey, accountKey, resolveTrustProxy, describeProxyChain,
};
