'use strict';
/*
 * The bell's own items (Features 4, 8, 26, 48; 2026-11-11). The bell listed group invites, requests,
 * accepted requests and swap offers, each read from its own table. Everything the Features add to it
 * (a saved event that moved, a new series at a followed room, a hand sent to you, the owner's reply to a
 * problem you reported) is one row here, written when it happens and shown until it is dismissed.
 *
 *   player_notices (id, user_id, kind, title, body, url, ref, created_at, dismissed_at)
 *
 * `ref` makes a notice idempotent per player and kind: writing the same ref again updates it in place.
 * Notices older than 30 days are not listed.
 */

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS player_notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    url TEXT,
    ref TEXT,
    created_at INTEGER NOT NULL,
    dismissed_at INTEGER
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_player_notices_user ON player_notices(user_id, dismissed_at)');
}

function add(db, userId, { kind, title, body = null, url = null, ref = null }) {
  if (!userId || !kind || !title) return null;
  const now = Date.now();
  if (ref) {
    const r = db.exec('SELECT id FROM player_notices WHERE user_id = ? AND kind = ? AND ref = ?', [Number(userId), kind, String(ref)]);
    if (r.length && r[0].values.length) {
      const id = r[0].values[0][0];
      db.run('UPDATE player_notices SET title = ?, body = ?, url = ?, created_at = ?, dismissed_at = NULL WHERE id = ?', [title, body, url, now, id]);
      return id;
    }
  }
  db.run('INSERT INTO player_notices (user_id, kind, title, body, url, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [Number(userId), kind, String(title).slice(0, 160), body == null ? null : String(body).slice(0, 400), url, ref == null ? null : String(ref), now]);
  const r = db.exec('SELECT last_insert_rowid()');
  return r.length ? r[0].values[0][0] : null;
}

function list(db, userId) {
  const st = db.prepare(`SELECT id, kind, title, body, url, created_at FROM player_notices
    WHERE user_id = ? AND dismissed_at IS NULL AND created_at > ? ORDER BY created_at DESC LIMIT 50`);
  const out = [];
  try {
    st.bind([Number(userId), Date.now() - 30 * 864e5]);
    while (st.step()) out.push(st.getAsObject());
  } finally { st.free(); }
  return out;
}

function dismiss(db, userId, id) {
  db.run('UPDATE player_notices SET dismissed_at = ? WHERE id = ? AND user_id = ?', [Date.now(), Number(id), Number(userId)]);
}

function dismissRef(db, userId, kind, ref) {
  db.run('UPDATE player_notices SET dismissed_at = ? WHERE user_id = ? AND kind = ? AND ref = ? AND dismissed_at IS NULL',
    [Date.now(), Number(userId), kind, String(ref)]);
}

function mountRoutes(app, { getDb, saveDatabase, authenticateToken, requireRegistered }) {
  app.delete('/api/notices/:id', authenticateToken, requireRegistered, async (req, res) => {
    try {
      dismiss(getDb(), req.user.id, req.params.id);
      await saveDatabase();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Could not dismiss it' });
    }
  });
}

module.exports = { migrate, add, list, dismiss, dismissRef, mountRoutes };
