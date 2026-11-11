'use strict';
/*
 * An invite link, futurega.me/i/<token> (Features 37), and the code shown at the table (Features 36),
 * which is the same link drawn as a QR code (2026-11-11).
 *
 *   invite_tokens (token, user_id, created_at, revoked_at, uses): one live token per player; New code
 *     revokes it and makes another, so a photographed code stops working.
 *
 * Opened signed out, Create Account shows who invited you, and the new account is connected to the
 * inviter when it is made (a share_requests row, accepted): the card says so before the account exists.
 * Opened signed in (or scanned in the app), it sends the inviter a connection request, which they accept
 * as any other; nobody is connected silently. A token is good for 180 days from when it was made.
 */

const crypto = require('crypto');
const TTL_MS = 180 * 864e5;

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS invite_tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER,
    uses INTEGER NOT NULL DEFAULT 0
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_invite_tokens_user ON invite_tokens(user_id)');
}

const clean = (t) => String(t || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);

function liveToken(db, userId) {
  const r = db.exec('SELECT token, created_at FROM invite_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1', [Number(userId)]);
  if (r.length && r[0].values.length && r[0].values[0][1] > Date.now() - TTL_MS) return r[0].values[0][0];
  return null;
}

function mint(db, userId) {
  db.run('UPDATE invite_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [Date.now(), Number(userId)]);
  const token = crypto.randomBytes(9).toString('base64url');
  db.run('INSERT INTO invite_tokens (token, user_id, created_at) VALUES (?, ?, ?)', [token, Number(userId), Date.now()]);
  return token;
}

/** The inviter's id for a live token, or null. */
function ownerOf(db, token) {
  const t = clean(token);
  if (!t) return null;
  const r = db.exec('SELECT user_id, created_at, revoked_at FROM invite_tokens WHERE token = ?', [t]);
  if (!r.length || !r[0].values.length) return null;
  const [uid, created, revoked] = r[0].values[0];
  if (revoked || created < Date.now() - TTL_MS) return null;
  return Number(uid);
}

/** At sign-up: connects the new account to the inviter. Returns the inviter's id, or null. */
function acceptAtSignup(db, newUserId, token) {
  const inviter = ownerOf(db, token);
  if (!inviter || inviter === Number(newUserId)) return null;
  db.run("INSERT INTO share_requests (from_user_id, to_user_id, status, responded_at) VALUES (?, ?, 'accepted', CURRENT_TIMESTAMP)", [inviter, Number(newUserId)]);
  db.run('UPDATE invite_tokens SET uses = uses + 1 WHERE token = ?', [clean(token)]);
  return inviter;
}

function mountRoutes(app, { getDb, saveDatabase, authenticateToken, requireRegistered, siteUrl, isBlocked, onRequest, publicLimiter }) {
  const lim = publicLimiter || ((req, res, next) => next());
  const url = (t) => `${siteUrl()}/i/${t}`;

  app.get('/api/invite', authenticateToken, requireRegistered, async (req, res) => {
    const db = getDb();
    let token = liveToken(db, req.user.id);
    if (!token) { token = mint(db, req.user.id); await saveDatabase(); }
    res.json({ token, url: url(token) });
  });

  app.post('/api/invite/rotate', authenticateToken, requireRegistered, async (req, res) => {
    const token = mint(getDb(), req.user.id);
    await saveDatabase();
    res.json({ token, url: url(token) });
  });

  app.delete('/api/invite', authenticateToken, requireRegistered, async (req, res) => {
    getDb().run('UPDATE invite_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [Date.now(), req.user.id]);
    await saveDatabase();
    res.json({ ok: true });
  });

  // What Create Account shows above the form: the inviter's name and picture, nothing else.
  app.get('/api/invite/:token/info', lim, (req, res) => {
    const db = getDb();
    const uid = ownerOf(db, req.params.token);
    if (!uid) return res.status(404).json({ error: 'This invite has expired' });
    const r = db.exec('SELECT username, real_name, avatar FROM users WHERE id = ?', [uid]);
    if (!r.length || !r[0].values.length) return res.status(404).json({ error: 'This invite has expired' });
    const [username, realName, avatar] = r[0].values[0];
    res.set('Cache-Control', 'no-store');
    res.json({ username, name: realName || username, avatar: avatar || null });
  });

  // Signed in: a connection request to the inviter (they accept it as any other).
  app.post('/api/invite/:token/connect', authenticateToken, requireRegistered, async (req, res) => {
    const db = getDb();
    const inviter = ownerOf(db, req.params.token);
    if (!inviter) return res.status(404).json({ error: 'This code has expired. Ask for a new one.' });
    if (inviter === req.user.id) return res.status(400).json({ error: 'That is your own code' });
    const r = db.exec('SELECT username FROM users WHERE id = ?', [inviter]);
    const name = r.length && r[0].values.length ? r[0].values[0][0] : 'them';
    if (isBlocked && isBlocked(db, req.user.id, inviter)) return res.json({ status: 'sent', username: name });
    const ex = db.exec('SELECT status FROM share_requests WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)',
      [req.user.id, inviter, inviter, req.user.id]);
    const st = ex.length && ex[0].values.length ? ex[0].values[0][0] : null;
    if (st === 'accepted') return res.json({ status: 'connected', username: name });
    if (st === 'pending') return res.json({ status: 'pending', username: name });
    db.run("INSERT INTO share_requests (from_user_id, to_user_id, status) VALUES (?, ?, 'pending')", [req.user.id, inviter]);
    await saveDatabase();
    if (onRequest) onRequest(inviter, req.user);
    res.json({ status: 'sent', username: name });
  });
}

module.exports = { migrate, liveToken, mint, ownerOf, acceptAtSignup, mountRoutes, TTL_MS };
