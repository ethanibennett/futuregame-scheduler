'use strict';
/*
 * The pay ladder in the money (Features 13, 2026-11-11). A player deep in an event types the payouts board
 * (place ranges and amounts, up to 40 rows) once; the Dashboard's card then says what the next player out
 * takes, how far the next jump is and how many more must go first, the final table and first.
 *
 *   event_payouts (user_id, tournament_id, rows JSON [{ from, to, amount }], updated_at)
 *
 * Rooms revise payouts after late reg, so the board keeps when it was typed and the card says so. The
 * room clock's players left (or the player's own count) places them on it. WSOP+ publishes the structure
 * on its hub; reading it is left for when a WSOP-run event needs it (docs/wsop-live-clock.md).
 */

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS event_payouts (
    user_id INTEGER NOT NULL,
    tournament_id INTEGER NOT NULL,
    rows TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, tournament_id)
  )`);
}

/** Cleans a typed board: whole places 1..10000, from <= to, amounts > 0, sorted by place; null if empty. */
function cleanRows(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const r of input.slice(0, 40)) {
    const from = Math.round(Number(r && r.from));
    const to = Math.round(Number(r && (r.to != null && r.to !== '' ? r.to : r.from)));
    const amount = Math.round(Number(r && r.amount));
    if (!(from >= 1 && to >= from && to <= 10000 && amount > 0)) continue;
    out.push({ from, to, amount });
  }
  out.sort((a, b) => a.from - b.from);
  return out.length ? out : null;
}

function mountRoutes(app, { getDb, saveDatabase, authenticateToken, requireRegistered }) {
  app.get('/api/event-payouts/:tid', authenticateToken, requireRegistered, (req, res) => {
    const r = getDb().exec('SELECT rows, updated_at FROM event_payouts WHERE user_id = ? AND tournament_id = ?', [req.user.id, Number(req.params.tid)]);
    if (!r.length || !r[0].values.length) return res.json({ rows: null });
    let rows = null;
    try { rows = JSON.parse(r[0].values[0][0]); } catch (_) { rows = null; }
    res.json({ rows, updatedAt: r[0].values[0][1] });
  });
  app.put('/api/event-payouts/:tid', authenticateToken, requireRegistered, async (req, res) => {
    const rows = cleanRows(req.body && req.body.rows);
    const db = getDb();
    if (!rows) {
      db.run('DELETE FROM event_payouts WHERE user_id = ? AND tournament_id = ?', [req.user.id, Number(req.params.tid)]);
    } else {
      db.run('INSERT OR REPLACE INTO event_payouts (user_id, tournament_id, rows, updated_at) VALUES (?, ?, ?, ?)',
        [req.user.id, Number(req.params.tid), JSON.stringify(rows), Date.now()]);
    }
    await saveDatabase();
    res.json({ rows, updatedAt: rows ? Date.now() : null });
  });
}

module.exports = { migrate, cleanRows, mountRoutes };
