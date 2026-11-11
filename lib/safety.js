'use strict';
/*
 * Report a message, block a person (Features 38, 2026-11-11): what App Store guideline 1.2 asks of an app
 * with a chat — a way to report content, to block an abusive user, and to act on reports.
 *
 *   user_blocks (user_id, blocked_id, created_at): one direction each; every check is EITHER way.
 *     Blocking ends the connection (share_requests between the two, any status), drops pending group
 *     invites and swap offers between them, and from then on refuses their requests, invites and offers
 *     without telling them. Their group messages are hidden from each other, and a group's schedule
 *     leaves the other's events out. Nothing tells the blocked person.
 *   reports (id, reporter_id, kind, ref_id, target_user_id, group_id, snapshot, text, status,
 *     created_at, resolved_at, resolved_by): kind 'message' (a group message) or 'user'. The message is
 *     copied into `snapshot` when reported, so a later edit or delete leaves the report readable.
 *     status 'open' | 'removed' | 'dismissed'. The owner hears of each new report (sendPushToAdmin).
 */

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS user_blocks (
    user_id INTEGER NOT NULL,
    blocked_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, blocked_id)
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id)');
  db.run(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    ref_id INTEGER,
    target_user_id INTEGER,
    group_id INTEGER,
    snapshot TEXT,
    text TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by INTEGER
  )`);
}

function q(db, sql, params) {
  const st = db.prepare(sql);
  try {
    st.bind(params || []);
    const out = [];
    while (st.step()) out.push(st.getAsObject());
    return out;
  } finally { st.free(); }
}

/** Every account blocked by, or blocking, `userId`. */
function blockSet(db, userId) {
  const id = Number(userId);
  const out = new Set();
  if (!id) return out;
  for (const r of q(db, 'SELECT blocked_id AS o FROM user_blocks WHERE user_id = ? UNION SELECT user_id AS o FROM user_blocks WHERE blocked_id = ?', [id, id])) {
    out.add(Number(r.o));
  }
  return out;
}

function isBlocked(db, a, b) {
  if (!a || !b) return false;
  return q(db, 'SELECT 1 FROM user_blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?) LIMIT 1',
    [Number(a), Number(b), Number(b), Number(a)]).length > 0;
}

function block(db, userId, targetId) {
  const a = Number(userId), b = Number(targetId);
  db.run('INSERT OR IGNORE INTO user_blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)', [a, b, Date.now()]);
  db.run('DELETE FROM share_requests WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)', [a, b, b, a]);
  try {
    db.run(`UPDATE group_invites SET status = 'declined' WHERE status = 'pending'
      AND ((invited_by = ? AND invited_user_id = ?) OR (invited_by = ? AND invited_user_id = ?))`, [a, b, b, a]);
  } catch (_) { /* no invites table on a bare test DB */ }
  try {
    db.run(`UPDATE swap_suggestions SET status = 'declined' WHERE status = 'pending'
      AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))`, [a, b, b, a]);
  } catch (_) { /* no swap table on a bare test DB */ }
}

function unblock(db, userId, targetId) {
  db.run('DELETE FROM user_blocks WHERE user_id = ? AND blocked_id = ?', [Number(userId), Number(targetId)]);
}

function mountRoutes(app, deps) {
  const { getDb, saveDatabase, authenticateToken, requireRegistered, isAppAdmin, sendPushToAdmin, onMessageRemoved } = deps;

  app.get('/api/blocks', authenticateToken, requireRegistered, (req, res) => {
    const rows = q(getDb(), `SELECT u.id, u.username, u.real_name, u.avatar, b.created_at FROM user_blocks b
      JOIN users u ON u.id = b.blocked_id WHERE b.user_id = ? ORDER BY b.created_at DESC`, [req.user.id]);
    // Only the people this player blocked are named; who blocked them is never said.
    res.json({ blocked: rows, hidden: [...blockSet(getDb(), req.user.id)] });
  });

  app.post('/api/blocks', authenticateToken, requireRegistered, async (req, res) => {
    const target = Number(req.body && req.body.userId);
    if (!target || target === req.user.id) return res.status(400).json({ error: 'Choose someone else to block' });
    const db = getDb();
    if (!q(db, 'SELECT 1 FROM users WHERE id = ?', [target]).length) return res.status(404).json({ error: 'User not found' });
    block(db, req.user.id, target);
    await saveDatabase();
    res.json({ ok: true });
  });

  app.delete('/api/blocks/:userId', authenticateToken, requireRegistered, async (req, res) => {
    unblock(getDb(), req.user.id, req.params.userId);
    await saveDatabase();
    res.json({ ok: true });
  });

  app.post('/api/reports', authenticateToken, requireRegistered, async (req, res) => {
    try {
      const db = getDb();
      const kind = String((req.body && req.body.kind) || '');
      const refId = Number(req.body && req.body.refId) || null;
      const text = typeof req.body.text === 'string' ? req.body.text.trim().slice(0, 500) : '';
      let target = null, groupId = null, snapshot = null;
      if (kind === 'message') {
        const m = q(db, 'SELECT id, group_id, user_id, message FROM group_messages WHERE id = ?', [refId])[0];
        if (!m) return res.status(404).json({ error: 'That message is no longer there' });
        if (!q(db, 'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [m.group_id, req.user.id]).length) {
          return res.status(403).json({ error: 'Not a member of this group' });
        }
        target = m.user_id; groupId = m.group_id; snapshot = String(m.message || '').slice(0, 500);
      } else if (kind === 'user') {
        target = refId;
        if (!target || !q(db, 'SELECT 1 FROM users WHERE id = ?', [target]).length) return res.status(404).json({ error: 'User not found' });
      } else {
        return res.status(400).json({ error: 'Report a message or a person' });
      }
      if (target === req.user.id) return res.status(400).json({ error: 'That is your own' });
      const dup = q(db, "SELECT id FROM reports WHERE reporter_id = ? AND kind = ? AND ref_id = ? AND status = 'open'", [req.user.id, kind, refId]);
      if (!dup.length) {
        db.run('INSERT INTO reports (reporter_id, kind, ref_id, target_user_id, group_id, snapshot, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [req.user.id, kind, refId, target, groupId, snapshot, text || null, Date.now()]);
        await saveDatabase();
        if (sendPushToAdmin) sendPushToAdmin('A report', kind === 'message' ? 'A group message was reported' : 'A person was reported', '/?view=admin').catch(() => {});
      }
      res.status(201).json({ ok: true });
    } catch (err) {
      console.error('[safety] report failed:', err.message);
      res.status(500).json({ error: 'Could not send the report' });
    }
  });

  const adminOnly = (req, res, next) => (isAppAdmin(req) ? next() : res.status(403).json({ error: 'Admins only' }));

  app.get('/api/admin/reports', authenticateToken, requireRegistered, adminOnly, (req, res) => {
    const rows = q(getDb(), `SELECT r.*, ru.username AS reporter, tu.username AS target, g.name AS group_name,
        (SELECT COUNT(*) FROM user_blocks b WHERE b.blocked_id = r.target_user_id) AS blocked_by
      FROM reports r
      LEFT JOIN users ru ON ru.id = r.reporter_id
      LEFT JOIN users tu ON tu.id = r.target_user_id
      LEFT JOIN groups g ON g.id = r.group_id
      ORDER BY (r.status = 'open') DESC, r.created_at DESC LIMIT 200`, []);
    res.json({ reports: rows });
  });

  app.put('/api/admin/reports/:id', authenticateToken, requireRegistered, adminOnly, async (req, res) => {
    const db = getDb();
    const r = q(db, 'SELECT * FROM reports WHERE id = ?', [Number(req.params.id)])[0];
    if (!r) return res.status(404).json({ error: 'No such report' });
    const action = req.body && req.body.action;
    if (action === 'remove' && r.kind === 'message') {
      db.run('DELETE FROM group_messages WHERE id = ?', [r.ref_id]);
      // Every open report of the same message is settled with it.
      db.run("UPDATE reports SET status = 'removed', resolved_at = ?, resolved_by = ? WHERE kind = 'message' AND ref_id = ? AND status = 'open'",
        [Date.now(), req.user.id, r.ref_id]);
      await saveDatabase();
      if (onMessageRemoved) onMessageRemoved(r.group_id, r.ref_id);
      return res.json({ ok: true, status: 'removed' });
    }
    if (action === 'dismiss') {
      db.run("UPDATE reports SET status = 'dismissed', resolved_at = ?, resolved_by = ? WHERE id = ?", [Date.now(), req.user.id, r.id]);
      await saveDatabase();
      return res.json({ ok: true, status: 'dismissed' });
    }
    res.status(400).json({ error: 'Remove the message or dismiss the report' });
  });
}

module.exports = { migrate, blockSet, isBlocked, block, unblock, mountRoutes };
