'use strict';
/*
 * Change email and password in Settings, and sign out the other devices (Features 42, 2026-11-11).
 *
 *   user_sessions (sid, user_id, device, created_at, last_seen, revoked_at): one row per sign-in made
 *     since this shipped. The JWT carries `sid`; a revoked sid is refused on its next request
 *     (server.js sessionRefusal). A token signed before this has no sid and is not listed; "Sign out
 *     others" bumps users.token_version as well, which ends those too, and hands this device a fresh
 *     token with the new version.
 *   email_changes (user_id, new_email, token, expires_at, used): a new address replaces the old only
 *     once the link sent TO it is opened; the old address is told of the change.
 *
 * Password and email changes need the current password and go through the sign-in limiter.
 */

const crypto = require('crypto');

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS user_sessions (
    sid TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    device TEXT,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    revoked_at INTEGER
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id)');
  db.run(`CREATE TABLE IF NOT EXISTS email_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    new_email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  )`);
}

/** "iPhone app", "Mac · Safari", "Windows · Chrome" from the client's hint or the User-Agent. */
function deviceLabel(ua, hint) {
  const h = typeof hint === 'string' ? hint.replace(/[^\w .·()+-]/g, '').trim().slice(0, 40) : '';
  if (h) return h;
  const s = String(ua || '');
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android'
    : /Macintosh|Mac OS X/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : 'A device';
  const br = /Edg\//.test(s) ? 'Edge' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome'
    : /Safari\//.test(s) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}

function newSession(db, userId, device) {
  const sid = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  db.run('INSERT INTO user_sessions (sid, user_id, device, created_at, last_seen) VALUES (?, ?, ?, ?, ?)',
    [sid, Number(userId), device || null, now, now]);
  return sid;
}

const lastTouch = new Map();
/** undefined: unknown sid (a test DB, a wiped table) — not refused; true: revoked; false: live. */
function sessionRevoked(db, sid, userId) {
  try {
    const r = db.exec('SELECT revoked_at, user_id FROM user_sessions WHERE sid = ?', [String(sid)]);
    if (!r.length || !r[0].values.length) return undefined;
    const [revoked, owner] = r[0].values[0];
    if (userId != null && Number(owner) !== Number(userId)) return true;
    if (revoked) return true;
    // last_seen, at most once a minute per session; saved with the next write.
    const now = Date.now();
    if ((lastTouch.get(sid) || 0) < now - 60e3) {
      lastTouch.set(sid, now);
      db.run('UPDATE user_sessions SET last_seen = ? WHERE sid = ?', [now, String(sid)]);
    }
    return false;
  } catch (_) {
    return undefined;
  }
}

function revoke(db, userId, sid) {
  db.run('UPDATE user_sessions SET revoked_at = ? WHERE sid = ? AND user_id = ? AND revoked_at IS NULL', [Date.now(), String(sid), Number(userId)]);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function mountRoutes(app, deps) {
  const { getDb, saveDatabase, authenticateToken, requireRegistered, bcrypt, signSession, sendMail, appUrl, limiter } = deps;
  const limit = limiter || ((req, res, next) => next());

  const userRow = (id) => {
    const st = getDb().prepare('SELECT * FROM users WHERE id = ?');
    try { st.bind([Number(id)]); return st.step() ? st.getAsObject() : null; } finally { st.free(); }
  };

  app.get('/api/account/security', authenticateToken, requireRegistered, (req, res) => {
    const db = getDb();
    const u = userRow(req.user.id);
    if (!u) return res.status(404).json({ error: 'Account not found' });
    const st = db.prepare('SELECT sid, device, created_at, last_seen FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen DESC');
    const sessions = [];
    try {
      st.bind([u.id]);
      while (st.step()) {
        const s = st.getAsObject();
        sessions.push({ id: s.sid.slice(0, 8), device: s.device || 'A device', createdAt: s.created_at, lastSeen: s.last_seen, current: s.sid === req.user.sid });
      }
    } finally { st.free(); }
    const pending = db.exec('SELECT new_email FROM email_changes WHERE user_id = ? AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 1', [u.id, Date.now()]);
    res.json({
      email: u.email,
      hasPassword: !u.apple_only,
      pendingEmail: pending.length && pending[0].values.length ? pending[0].values[0][0] : null,
      sessions,
      // A sign-in from before sessions were kept carries no sid and is not in the list.
      currentListed: !!req.user.sid,
    });
  });

  app.put('/api/account/password', limit, authenticateToken, requireRegistered, async (req, res) => {
    try {
      const { current, next } = req.body || {};
      const u = userRow(req.user.id);
      if (!u) return res.status(404).json({ error: 'Account not found' });
      // An account made with Sign in with Apple has no password of its own yet (Features 41): its first
      // one needs no current one.
      if (!u.apple_only && (typeof current !== 'string' || !(await bcrypt.compare(current, u.password)))) {
        return res.status(400).json({ error: 'The current password is not right' });
      }
      if (typeof next !== 'string' || next.length < 8) return res.status(400).json({ error: 'The new password needs at least 8 characters' });
      if (req.authLimit) req.authLimit.refund();
      const db = getDb();
      const hash = await bcrypt.hash(next, 10);
      // A new password ends every other session, as a reset does; this device gets a fresh token.
      db.run('UPDATE users SET password = ?, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?', [hash, u.id]);
      if (u.apple_only) db.run('UPDATE users SET apple_only = 0 WHERE id = ?', [u.id]);
      db.run('UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND sid != ?', [Date.now(), u.id, String(req.user.sid || '')]);
      const sid = req.user.sid || newSession(db, u.id, deviceLabel(req.headers['user-agent'], req.body && req.body.device));
      await saveDatabase();
      res.json({ token: signSession(u, '90d', { sid }) });
    } catch (err) {
      console.error('[account] password change failed:', err.message);
      res.status(500).json({ error: 'Could not change the password' });
    }
  });

  app.post('/api/account/email', limit, authenticateToken, requireRegistered, async (req, res) => {
    try {
      const { email, password } = req.body || {};
      const u = userRow(req.user.id);
      if (!u) return res.status(404).json({ error: 'Account not found' });
      if (u.apple_only) return res.status(400).json({ error: 'Set a password first; then the address can be changed' });
      if (typeof password !== 'string' || !(await bcrypt.compare(password, u.password))) {
        return res.status(400).json({ error: 'The password is not right' });
      }
      if (req.authLimit) req.authLimit.refund();
      const next = typeof email === 'string' ? email.trim().toLowerCase() : '';
      if (!EMAIL_RE.test(next)) return res.status(400).json({ error: 'That is not an email address' });
      if (next === String(u.email || '').toLowerCase()) return res.status(400).json({ error: 'That is already your address' });
      const db = getDb();
      const taken = db.exec('SELECT 1 FROM users WHERE LOWER(email) = ? AND id != ?', [next, u.id]);
      if (taken.length && taken[0].values.length) return res.status(409).json({ error: 'That address belongs to another account' });
      db.run('UPDATE email_changes SET used = 1 WHERE user_id = ? AND used = 0', [u.id]);
      const token = crypto.randomBytes(24).toString('hex');
      db.run('INSERT INTO email_changes (user_id, new_email, token, expires_at) VALUES (?, ?, ?, ?)', [u.id, next, token, Date.now() + 24 * 3600e3]);
      await saveDatabase();
      const link = `${appUrl()}/api/account/email/confirm/${token}`;
      sendMail(next, 'Confirm your new email - futuregame',
        `<div style="font-family:sans-serif;max-width:480px;margin:0 auto"><h2>Confirm your new email</h2>
         <p>Open this link to make ${next} the address of your futuregame account (@${u.username}).</p>
         <p><a href="${link}" style="display:inline-block;padding:12px 24px;background:#555;color:#fff;text-decoration:none;border-radius:6px">Confirm</a></p>
         <p style="color:#888;font-size:.85em">The link lasts 24 hours. If you did not ask for this, ignore it: nothing changes.</p></div>`,
        link).catch((e) => console.error('[account] confirm email failed:', e.message));
      res.json({ ok: true, pendingEmail: next });
    } catch (err) {
      console.error('[account] email change failed:', err.message);
      res.status(500).json({ error: 'Could not start the change' });
    }
  });

  app.get('/api/account/email/confirm/:token', async (req, res) => {
    const db = getDb();
    const st = db.prepare('SELECT id, user_id, new_email, expires_at, used FROM email_changes WHERE token = ?');
    let row = null;
    try { st.bind([String(req.params.token)]); row = st.step() ? st.getAsObject() : null; } finally { st.free(); }
    const done = (state) => res.redirect(302, `/#/settings?email=${state}`);
    if (!row || row.used || row.expires_at < Date.now()) return done('expired');
    const taken = db.exec('SELECT 1 FROM users WHERE LOWER(email) = ? AND id != ?', [row.new_email, row.user_id]);
    if (taken.length && taken[0].values.length) return done('taken');
    const old = userRow(row.user_id);
    db.run('UPDATE users SET email = ? WHERE id = ?', [row.new_email, row.user_id]);
    db.run('UPDATE email_changes SET used = 1 WHERE id = ?', [row.id]);
    await saveDatabase();
    if (old && old.email) {
      sendMail(old.email, 'Your futuregame email was changed',
        `<div style="font-family:sans-serif;max-width:480px;margin:0 auto"><p>The address of your futuregame account (@${old.username}) is now ${row.new_email}.</p>
         <p style="color:#888;font-size:.85em">If this was not you, reset your password from the sign-in screen and write to us.</p></div>`).catch(() => {});
    }
    done('changed');
  });

  app.post('/api/account/sessions/sign-out-others', authenticateToken, requireRegistered, async (req, res) => {
    try {
      const db = getDb();
      const u = userRow(req.user.id);
      if (!u) return res.status(404).json({ error: 'Account not found' });
      const sid = req.user.sid || newSession(db, u.id, deviceLabel(req.headers['user-agent'], req.body && req.body.device));
      db.run('UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND sid != ?', [Date.now(), u.id, sid]);
      db.run('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?', [u.id]);
      await saveDatabase();
      res.json({ token: signSession(u, '90d', { sid }) });
    } catch (err) {
      console.error('[account] sign out others failed:', err.message);
      res.status(500).json({ error: 'Could not sign the other devices out' });
    }
  });

  app.delete('/api/account/sessions/:id', authenticateToken, requireRegistered, async (req, res) => {
    const db = getDb();
    const prefix = String(req.params.id || '').replace(/[^a-f0-9]/g, '');
    if (prefix.length < 8) return res.status(400).json({ error: 'No such session' });
    const r = db.exec("SELECT sid FROM user_sessions WHERE user_id = ? AND sid LIKE ? AND revoked_at IS NULL", [req.user.id, prefix + '%']);
    if (!r.length || !r[0].values.length) return res.status(404).json({ error: 'No such session' });
    revoke(db, req.user.id, r[0].values[0][0]);
    await saveDatabase();
    res.json({ ok: true });
  });
}

module.exports = { migrate, deviceLabel, newSession, sessionRevoked, revoke, mountRoutes };
