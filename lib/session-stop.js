'use strict';
/*
 * Your stop: a time and a loss line for a cash session, kept for you (Features 15, 2026-11-11). Nothing
 * ends by itself: at either line the live bar turns and asks once, Cash out or Move the line. A line the
 * player moved is their call; every move is kept with its time.
 *
 *   cash_session_stops (session_id, user_id, stop_at, loss_amount, moves JSON, updated_at)
 *
 * GET/PUT /api/cash-sessions/:id/stop { stopAt: ISO | null, stopMinutes, loss | null }; the loss line is in
 * the session's own units, as its buy-in and stacks are.
 */

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS cash_session_stops (
    session_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    stop_at TEXT,
    loss_amount INTEGER,
    moves TEXT,
    updated_at INTEGER NOT NULL
  )`);
}

function one(db, sql, p) {
  const st = db.prepare(sql);
  try { st.bind(p || []); return st.step() ? st.getAsObject() : null; } finally { st.free(); }
}

function shape(r) {
  if (!r) return null;
  let moves = [];
  try { moves = JSON.parse(r.moves || '[]'); } catch (_) { moves = []; }
  return { stopAt: r.stop_at || null, loss: r.loss_amount == null ? null : Number(r.loss_amount), moves };
}

function mountRoutes(app, { getDb, saveDatabase, authenticateToken, requireRegistered }) {
  const own = (db, uid, id) => one(db, 'SELECT id, started_at FROM cash_sessions WHERE id = ? AND user_id = ?', [Number(id), uid]);
  app.get('/api/cash-sessions/:id/stop', authenticateToken, requireRegistered, (req, res) => {
    const db = getDb();
    if (!own(db, req.user.id, req.params.id)) return res.status(404).json({ error: 'No such session' });
    res.json({ stop: shape(one(db, 'SELECT * FROM cash_session_stops WHERE session_id = ?', [Number(req.params.id)])) });
  });
  app.put('/api/cash-sessions/:id/stop', authenticateToken, requireRegistered, async (req, res) => {
    const db = getDb();
    const s = own(db, req.user.id, req.params.id);
    if (!s) return res.status(404).json({ error: 'No such session' });
    const b = req.body || {};
    let stopAt = null;
    if (b.stopMinutes != null && b.stopMinutes !== '') {
      const m = Math.round(Number(b.stopMinutes));
      if (!(m > 0 && m <= 48 * 60)) return res.status(400).json({ error: 'A length from 1 minute to 48 hours' });
      stopAt = new Date(Date.parse(s.started_at) + m * 60e3).toISOString();
    } else if (b.stopAt) {
      const t = Date.parse(b.stopAt);
      if (!Number.isFinite(t)) return res.status(400).json({ error: 'That is not a time' });
      stopAt = new Date(t).toISOString();
    }
    let loss = null;
    if (b.loss != null && b.loss !== '') {
      loss = Math.round(Math.abs(Number(b.loss)));
      if (!(loss > 0)) return res.status(400).json({ error: 'A loss line above zero' });
    }
    const prev = shape(one(db, 'SELECT * FROM cash_session_stops WHERE session_id = ?', [Number(req.params.id)]));
    const moves = prev ? prev.moves.slice(-20) : [];
    if (prev && (prev.stopAt !== stopAt || prev.loss !== loss)) moves.push({ at: new Date().toISOString(), from: { stopAt: prev.stopAt, loss: prev.loss }, to: { stopAt, loss: loss } });
    if (!stopAt && loss == null) db.run('DELETE FROM cash_session_stops WHERE session_id = ?', [Number(req.params.id)]);
    else db.run('INSERT OR REPLACE INTO cash_session_stops (session_id, user_id, stop_at, loss_amount, moves, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [Number(req.params.id), req.user.id, stopAt, loss, JSON.stringify(moves), Date.now()]);
    await saveDatabase();
    res.json({ stop: !stopAt && loss == null ? null : { stopAt, loss: loss, moves } });
  });
}

module.exports = { migrate, mountRoutes, shape };
