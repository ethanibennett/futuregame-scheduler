'use strict';
/*
 * Sign in with Apple (Features 41, 2026-11-11): one tap to an account in the iPhone, iPad and Mac apps.
 *
 * The app's AppleSignIn plugin (ios/App/App/AppDelegate.swift) returns Apple's identity token; POST
 * /api/auth/apple checks it here against Apple's published keys (https://appleid.apple.com/auth/keys,
 * kept an hour), its issuer, its audience (the app's bundle id; APPLE_SIGNIN_AUDIENCES, comma-separated,
 * adds a web Services ID when one exists) and its expiry. Then:
 *   - users.apple_sub already holds Apple's user id: that account signs in;
 *   - else an account has the address Apple vouches for (email_verified): Apple is added to it;
 *   - else a new account is made with the name Apple shares (only on the first sign-in, Apple sends it
 *     once) and a username made from it, as Create Account does. Its email may be Apple's relay address.
 * An account made here has no password of its own (users.apple_only = 1) until one is set in Settings,
 * which then does not ask for a current one.
 */

const crypto = require('crypto');

const KEYS_URL = 'https://appleid.apple.com/auth/keys';
const ISSUER = 'https://appleid.apple.com';
let keyCache = { at: 0, keys: [] };

function migrate(db) {
  const info = db.exec('PRAGMA table_info(users)');
  const have = new Set(info.length ? info[0].values.map((r) => r[1]) : []);
  if (!have.has('apple_sub')) db.run('ALTER TABLE users ADD COLUMN apple_sub TEXT');
  if (!have.has('apple_only')) db.run('ALTER TABLE users ADD COLUMN apple_only INTEGER DEFAULT 0');
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_apple_sub ON users(apple_sub) WHERE apple_sub IS NOT NULL');
}

function audiences(env = process.env) {
  const list = String(env.APPLE_SIGNIN_AUDIENCES || '').split(',').map((s) => s.trim()).filter(Boolean);
  const bundle = env.APNS_BUNDLE_ID || 'app.futurega.me.beta';
  return [...new Set([bundle, ...list])];
}

async function appleKeys(fetchImpl) {
  if (Date.now() - keyCache.at < 3600e3 && keyCache.keys.length) return keyCache.keys;
  const r = await (fetchImpl || fetch)(KEYS_URL, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Apple keys: HTTP ${r.status}`);
  const j = await r.json();
  keyCache = { at: Date.now(), keys: Array.isArray(j.keys) ? j.keys : [] };
  return keyCache.keys;
}

/** The verified claims of an Apple identity token, or throws with a reason. */
async function verifyIdentityToken(jwt, token, { keys = null, fetchImpl = null, aud = audiences() } = {}) {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || !decoded.header || !decoded.header.kid) throw new Error('not an Apple identity token');
  const list = keys || await appleKeys(fetchImpl);
  const jwk = list.find((k) => k.kid === decoded.header.kid);
  if (!jwk) throw new Error('signed with a key Apple does not list');
  const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  return jwt.verify(token, pub, { algorithms: ['RS256'], issuer: ISSUER, audience: aud });
}

function mountRoutes(app, { getDb, saveDatabase, jwt, issueSession, deriveUsername, bcrypt, growth, limiter, setSessionCookie, parseOnboarding, acceptInvite }) {
  const lim = limiter || ((req, res, next) => next());
  app.post('/api/auth/apple', lim, async (req, res) => {
    try {
      const b = req.body || {};
      let claims;
      try { claims = await verifyIdentityToken(jwt, String(b.identityToken || '')); }
      catch (e) { return res.status(401).json({ error: 'Apple could not confirm this sign-in. Please try again.', why: e.message }); }
      const sub = String(claims.sub || '');
      if (!sub) return res.status(401).json({ error: 'Apple could not confirm this sign-in.' });
      const db = getDb();
      const one = (sql, p) => { const st = db.prepare(sql); try { st.bind(p); return st.step() ? st.getAsObject() : null; } finally { st.free(); } };
      let user = one('SELECT * FROM users WHERE apple_sub = ?', [sub]);
      let created = false;
      const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
      const verified = claims.email_verified === true || claims.email_verified === 'true';
      if (!user && email && verified) {
        user = one('SELECT * FROM users WHERE LOWER(email) = ? ORDER BY id', [email]);
        if (user) db.run('UPDATE users SET apple_sub = ? WHERE id = ?', [sub, user.id]);
      }
      if (!user) {
        const name = [b.givenName, b.familyName].filter((x) => typeof x === 'string' && x.trim()).join(' ').trim().slice(0, 40)
          || (email ? email.split('@')[0] : 'Player');
        const username = deriveUsername(name);
        const pw = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
        db.run('INSERT INTO users (username, email, password, real_name, apple_sub, apple_only) VALUES (?, ?, ?, ?, ?, 1)',
          [username, email || `${sub.slice(0, 12)}@apple.invalid`, pw, name, sub]);
        user = one('SELECT * FROM users WHERE apple_sub = ?', [sub]);
        created = true;
        // From an invite link (Features 37): connected to the inviter, as Create Account would be.
        let inviter = null;
        if (user && b.invite && acceptInvite) { try { inviter = acceptInvite(db, user.id, b.invite); } catch (_) { /* the account stands */ } }
        if (growth && user) { try { growth.recordSignup(db, user.id, inviter ? { ...(b.source || {}), src: 'invite', inviter } : { ...(b.source || {}), src: 'apple' }); } catch (_) { /* counted or not, the account stands */ } }
        if (inviter) user.invitedBy = inviter;
      }
      await saveDatabase();
      const token = issueSession(user, req);
      if (setSessionCookie) setSessionCookie(res, token);
      res.status(created ? 201 : 200).json({
        token, username: user.username, userId: user.id, avatar: user.avatar || null, realName: user.real_name || null,
        handReplayerAccess: !!user.hand_replayer_access, onboarding: created ? null : (parseOnboarding ? parseOnboarding(user.onboarding) : undefined),
        created, invitedBy: user.invitedBy || null,
      });
    } catch (err) {
      console.error('[apple] sign-in failed:', err.message);
      res.status(500).json({ error: 'Sign in with Apple failed. Please try again.' });
    }
  });
}

module.exports = { migrate, audiences, verifyIdentityToken, mountRoutes, ISSUER };
