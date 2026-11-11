'use strict';
/*
 * Tickets: a satellite seat or tournament chips kept, valued and used on an entry (Features 16, 2026-11-11).
 *
 *   tickets (id, user_id, kind 'seat'|'chips'|'voucher', value, currency, target, expires_on, source_entry_id,
 *            counted, used_entry_id, used_at, created_at)
 *
 * The money: a seat won is winnings at its value, so a ticket made from a satellite's result can count as that
 * result's cash (counted = 1: the result's cash_amount grows by the value, through the same follow the result
 * form uses, so a notified backer share follows it). The entry the ticket pays for keeps its buy-in: the
 * ledger counts the seat as won at the satellite and spent at the entry, net zero across the two, and the tax
 * report reads it the same way. Deleting a counted ticket takes its value back off the result.
 */

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'seat',
    value REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    target TEXT,
    expires_on TEXT,
    source_entry_id INTEGER,
    counted INTEGER NOT NULL DEFAULT 0,
    used_entry_id INTEGER,
    used_at INTEGER,
    created_at INTEGER NOT NULL
  )`);
}

function all(db, sql, p) {
  const st = db.prepare(sql);
  try { st.bind(p || []); const out = []; while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); }
}

function mountRoutes(app, { getDb, saveDatabase, authenticateToken, requireRegistered, followShares }) {
  const ownsEntry = (db, uid, id) => all(db, 'SELECT id, cash_amount, cashed FROM tracking_entries WHERE id = ? AND user_id = ?', [Number(id), uid])[0];

  app.get('/api/tickets', authenticateToken, requireRegistered, (req, res) => {
    const rows = all(getDb(), `SELECT k.*, s.tournament_id AS source_tid, ts.event_name AS source_event, u.tournament_id AS used_tid, tu.event_name AS used_event
      FROM tickets k
      LEFT JOIN tracking_entries s ON s.id = k.source_entry_id LEFT JOIN tournaments ts ON ts.id = s.tournament_id
      LEFT JOIN tracking_entries u ON u.id = k.used_entry_id LEFT JOIN tournaments tu ON tu.id = u.tournament_id
      WHERE k.user_id = ? ORDER BY (k.used_entry_id IS NULL) DESC, k.created_at DESC`, [req.user.id]);
    res.json({ tickets: rows });
  });

  app.post('/api/tickets', authenticateToken, requireRegistered, async (req, res) => {
    const db = getDb();
    const b = req.body || {};
    const kind = ['seat', 'chips', 'voucher'].includes(b.kind) ? b.kind : 'seat';
    const value = Math.round(Number(b.value) * 100) / 100;
    if (!(value > 0)) return res.status(400).json({ error: 'What is it worth?' });
    const currency = /^[A-Z]{3}$/.test(String(b.currency || '')) ? b.currency : 'USD';
    const target = typeof b.target === 'string' ? b.target.trim().slice(0, 120) : null;
    const expires = /^\d{4}-\d{2}-\d{2}$/.test(String(b.expiresOn || '')) ? b.expiresOn : null;
    let source = null, counted = 0;
    if (b.sourceEntryId) {
      const e = ownsEntry(db, req.user.id, b.sourceEntryId);
      if (!e) return res.status(404).json({ error: 'That result is not yours' });
      source = e.id;
      if (b.countAsCash) {
        db.run('UPDATE tracking_entries SET cashed = 1, cash_amount = COALESCE(cash_amount, 0) + ? WHERE id = ? AND user_id = ?', [value, e.id, req.user.id]);
        counted = 1;
        if (followShares) followShares('tracking_entries', [e.id]);
      }
    }
    db.run('INSERT INTO tickets (user_id, kind, value, currency, target, expires_on, source_entry_id, counted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.user.id, kind, value, currency, target, expires, source, counted, Date.now()]);
    await saveDatabase();
    res.status(201).json({ ok: true, counted: !!counted });
  });

  app.post('/api/tickets/:id/use', authenticateToken, requireRegistered, async (req, res) => {
    const db = getDb();
    const t = all(db, 'SELECT * FROM tickets WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id])[0];
    if (!t) return res.status(404).json({ error: 'No such ticket' });
    const entryId = req.body && req.body.entryId != null ? Number(req.body.entryId) : null;
    if (entryId && !ownsEntry(db, req.user.id, entryId)) return res.status(404).json({ error: 'That result is not yours' });
    db.run('UPDATE tickets SET used_entry_id = ?, used_at = ? WHERE id = ?', [entryId, entryId ? Date.now() : null, t.id]);
    await saveDatabase();
    res.json({ ok: true });
  });

  app.delete('/api/tickets/:id', authenticateToken, requireRegistered, async (req, res) => {
    const db = getDb();
    const t = all(db, 'SELECT * FROM tickets WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id])[0];
    if (!t) return res.status(404).json({ error: 'No such ticket' });
    if (t.counted && t.source_entry_id) {
      const e = ownsEntry(db, req.user.id, t.source_entry_id);
      if (e) {
        const left = Math.max(0, Math.round((Number(e.cash_amount) - Number(t.value)) * 100) / 100);
        db.run('UPDATE tracking_entries SET cash_amount = ?, cashed = ? WHERE id = ?', [left, left > 0 ? 1 : 0, e.id]);
        if (followShares) followShares('tracking_entries', [e.id]);
      }
    }
    db.run('DELETE FROM tickets WHERE id = ?', [t.id]);
    await saveDatabase();
    res.json({ ok: true });
  });
}

module.exports = { migrate, mountRoutes };
