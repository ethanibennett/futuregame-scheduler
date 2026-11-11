'use strict';
/*
 * Report a problem from inside the app, with the screen attached (Features 48, 2026-11-11).
 *
 *   feedback (id, user_id, text, image, version, platform, view, created_at, status, reply, replied_at)
 *
 * `image` is one JPEG data URL of the screen the sheet was opened from, only when the player left
 * "Attach this screen" ticked, capped at 900 KB. The owner hears of each report (sendPushToAdmin) and
 * reads them in Admin; a reply goes into the player's bell (lib/notices.js) and, where they allow
 * pushes, to their phone. Five reports an hour per account.
 */

const MAX_IMAGE = 900 * 1024;
const recent = new Map();

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    image TEXT,
    version TEXT,
    platform TEXT,
    view TEXT,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    reply TEXT,
    replied_at INTEGER
  )`);
}

function q(db, sql, params) {
  const st = db.prepare(sql);
  try { st.bind(params || []); const out = []; while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); }
}

function mountRoutes(app, { getDb, saveDatabase, authenticateToken, requireRegistered, isAppAdmin, sendPushToAdmin, notify }) {
  app.post('/api/feedback', authenticateToken, requireRegistered, async (req, res) => {
    try {
      const uid = req.user.id;
      const now = Date.now();
      const times = (recent.get(uid) || []).filter((t) => t > now - 3600e3);
      if (times.length >= 5) return res.status(429).json({ error: 'That is five this hour. Please try again later.' });
      const b = req.body || {};
      const text = typeof b.text === 'string' ? b.text.trim().slice(0, 4000) : '';
      if (!text) return res.status(400).json({ error: 'Say what went wrong' });
      let image = null;
      if (typeof b.image === 'string' && b.image) {
        if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(b.image)) return res.status(400).json({ error: 'The picture must be a JPEG' });
        if (b.image.length > MAX_IMAGE * 1.37) return res.status(413).json({ error: 'The picture is too large' });
        image = b.image;
      }
      const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
      getDb().run('INSERT INTO feedback (user_id, text, image, version, platform, view, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [uid, text, image, s(b.version, 40), s(b.platform, 20), s(b.view, 40), now]);
      await saveDatabase();
      times.push(now);
      recent.set(uid, times);
      if (sendPushToAdmin) sendPushToAdmin('A problem reported', `${req.user.username}: ${text.slice(0, 100)}`, '/?view=admin').catch(() => {});
      res.status(201).json({ ok: true });
    } catch (err) {
      console.error('[feedback] save failed:', err.message);
      res.status(500).json({ error: 'Could not send it. Please try again.' });
    }
  });

  const adminOnly = (req, res, next) => (isAppAdmin(req) ? next() : res.status(403).json({ error: 'Admins only' }));

  app.get('/api/admin/feedback', authenticateToken, requireRegistered, adminOnly, (req, res) => {
    res.json({ feedback: q(getDb(), `SELECT f.id, f.user_id, u.username, f.text, f.version, f.platform, f.view, f.created_at, f.status,
      f.reply, f.replied_at, (f.image IS NOT NULL) AS has_image FROM feedback f LEFT JOIN users u ON u.id = f.user_id
      ORDER BY (f.status = 'open') DESC, f.created_at DESC LIMIT 200`, []) });
  });

  app.get('/api/admin/feedback/:id/image', authenticateToken, requireRegistered, adminOnly, (req, res) => {
    const r = q(getDb(), 'SELECT image FROM feedback WHERE id = ?', [Number(req.params.id)])[0];
    if (!r || !r.image) return res.status(404).json({ error: 'No picture' });
    res.json({ image: r.image });
  });

  app.put('/api/admin/feedback/:id', authenticateToken, requireRegistered, adminOnly, async (req, res) => {
    const db = getDb();
    const f = q(db, 'SELECT id, user_id, text FROM feedback WHERE id = ?', [Number(req.params.id)])[0];
    if (!f) return res.status(404).json({ error: 'No such report' });
    const reply = typeof req.body.reply === 'string' ? req.body.reply.trim().slice(0, 2000) : '';
    const status = req.body.status === 'closed' ? 'closed' : (reply ? 'replied' : 'open');
    db.run('UPDATE feedback SET reply = COALESCE(?, reply), replied_at = CASE WHEN ? IS NULL THEN replied_at ELSE ? END, status = ? WHERE id = ?',
      [reply || null, reply || null, Date.now(), status, f.id]);
    await saveDatabase();
    if (reply && notify) {
      await notify(f.user_id, 'feedback', { title: 'A reply to your report', body: reply.slice(0, 300), url: '/#/home', ref: `fb:${f.id}`, pushKind: 'support' });
      await saveDatabase();
    }
    res.json({ ok: true, status });
  });
}

module.exports = { migrate, mountRoutes, MAX_IMAGE };
