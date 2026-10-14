'use strict';
/*
 * Map providers for the venue map (docs/venue-map.md): the server half.
 *
 * GET /api/mapkit-token         a short-lived MapKit JS token (Apple Maps), signed here with the
 *                               team's MapKit JS key. 404 { configured: false } until the owner
 *                               sets MAPKIT_TEAM_ID / MAPKIT_KEY_ID / MAPKIT_PRIVATE_KEY.
 * GET /api/google-maps-config   the Maps JavaScript API browser key (Android's provider), plus the
 *                               Map ID when one is set. 404 { configured: false } without
 *                               GOOGLE_MAPS_BROWSER_KEY.
 *
 * Both are public: a map of a casino is not sensitive, and the shared-schedule page has no session.
 * Neither ever logs a key. The browser key is public by nature (Google restricts it by referrer and
 * API); the MapKit private key never leaves this process — only tokens signed with it do.
 *
 * The token is MapKit JS's JWT: header { alg: ES256, kid: <key id>, typ: JWT }, payload
 * { iss: <team id>, iat, exp } with exp 30 minutes on. No `origin` claim by default, so one token
 * serves futurega.me, the Capacitor app (capacitor://localhost, https://localhost) and the Mac app.
 * Apple's current docs ask for `origin` (and `scope: mapkit_js`) on dynamically signed tokens;
 * MAPKIT_ORIGIN (e.g. "futurega.me,localhost") adds both, should Apple refuse a token without.
 * One token is cached for its lifetime and re-signed in its last 5 minutes, so the route costs a
 * Map lookup, not a signature, and needs no rate limit of its own.
 */
const jwt = require('jsonwebtoken');

const TOKEN_TTL_SEC = 30 * 60;
const REFRESH_BEFORE_SEC = 5 * 60;

/* The .p8's contents as an env var. Render and dotenv files often carry it on one line with
   literal "\n" escapes (or CRLFs); a body pasted without its PEM armour is wrapped. */
function normalisePrivateKey(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim().replace(/^["']|["']$/g, '').replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '').trim();
  if (!s) return null;
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(s)) {
    const body = s.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/=]+$/.test(body)) return null;
    s = `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;
  }
  return s;
}

function mapkitConfig(env = process.env) {
  const teamId = (env.MAPKIT_TEAM_ID || '').trim();
  const keyId = (env.MAPKIT_KEY_ID || '').trim();
  const privateKey = normalisePrivateKey(env.MAPKIT_PRIVATE_KEY);
  if (!teamId || !keyId || !privateKey) return null;
  const origin = (env.MAPKIT_ORIGIN || '').trim() || null;
  return { teamId, keyId, privateKey, origin };
}

/* A token issuer over one configuration. `now` (ms) is injectable for tests. Returns null when
   MapKit is not configured. get() throws if the key cannot sign (a malformed .p8): the route
   answers 500 without the error's text, which could echo key material. */
function createMapkitTokenIssuer(env = process.env, { now = () => Date.now(), ttlSec = TOKEN_TTL_SEC, refreshBeforeSec = REFRESH_BEFORE_SEC } = {}) {
  const cfg = mapkitConfig(env);
  if (!cfg) return null;
  let cached = null;
  return {
    keyId: cfg.keyId,
    teamId: cfg.teamId,
    get() {
      const t = Math.floor(now() / 1000);
      if (cached && cached.exp - t > refreshBeforeSec) return { token: cached.token, expiresAt: cached.exp };
      const payload = { iss: cfg.teamId, iat: t, exp: t + ttlSec };
      if (cfg.origin) { payload.origin = cfg.origin; payload.scope = 'mapkit_js'; }
      const token = jwt.sign(payload, cfg.privateKey, { algorithm: 'ES256', keyid: cfg.keyId, header: { typ: 'JWT' } });
      cached = { token, exp: payload.exp };
      return { token, expiresAt: payload.exp };
    },
  };
}

function googleMapsConfig(env = process.env) {
  const key = (env.GOOGLE_MAPS_BROWSER_KEY || '').trim();
  if (!key) return null;
  const mapId = (env.GOOGLE_MAPS_MAP_ID || '').trim() || null;
  return { key, mapId };
}

/* Mounts both routes. The configuration is read once, at boot: the env changes only with a
   restart (pm2 --update-env, a Render deploy). */
function mountMapRoutes(app, env = process.env, opts = {}) {
  const issuer = createMapkitTokenIssuer(env, opts);
  const google = googleMapsConfig(env);
  app.get('/api/mapkit-token', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!issuer) return res.status(404).json({ configured: false });
    try {
      const { token, expiresAt } = issuer.get();
      res.json({ configured: true, token, expiresAt });
    } catch (_) {
      console.error('[MapKit] could not sign a token — check MAPKIT_PRIVATE_KEY is the .p8 contents');
      res.status(500).json({ configured: true, error: 'token unavailable' });
    }
  });
  app.get('/api/google-maps-config', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!google) return res.status(404).json({ configured: false });
    res.json({ configured: true, key: google.key, mapId: google.mapId });
  });
  return { mapkit: !!issuer, google: !!google };
}

module.exports = {
  normalisePrivateKey, mapkitConfig, createMapkitTokenIssuer, googleMapsConfig, mountMapRoutes,
  TOKEN_TTL_SEC, REFRESH_BEFORE_SEC,
};
