'use strict';
/*
 * Cash game alerts: tell me when my game opens or the list gets short (Features 14, 2026-11-11).
 *
 *   cash_alerts (id, user_id, kind, game, min_bb, rooms JSON, threshold, on, created_at)
 *     kind 'opens'     a game of `game` at `min_bb` or bigger goes from no tables to one or more
 *          'short'     its list drops under `threshold`
 *          'interest'  an interest list starts for it
 *   cash_alert_state (alert_id, key, value, streak, fired): what the last snapshot showed per room and game
 *
 * The watcher sees a room about every 10 minutes and a game can flicker open and closed, so a change counts
 * once two snapshots in a row show it; one push per alert per opening (it re-arms when the game closes
 * again), and the Cash kind's daily cap (lib/player-push.js). Polls only where player delivery is on.
 */

function migrate(db) {
  db.run(`CREATE TABLE IF NOT EXISTS cash_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'opens',
    game TEXT NOT NULL,
    min_bb REAL,
    rooms TEXT,
    threshold INTEGER,
    on_ INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS cash_alert_state (
    alert_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value INTEGER,
    streak INTEGER NOT NULL DEFAULT 0,
    fired INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (alert_id, key)
  )`);
}

function all(db, sql, p) {
  const st = db.prepare(sql);
  try { st.bind(p || []); const out = []; while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); }
}

/** The big blind of "2/5", "1/2/5", "$5/$10 NL"; null when it does not say. */
function bigBlind(stakes) {
  const nums = String(stakes || '').replace(/[$,]/g, '').match(/\d+(?:\.\d+)?/g);
  return nums && nums.length >= 2 ? Number(nums[1]) : (nums ? Number(nums[0]) : null);
}

function gameMatches(alert, g) {
  const want = String(alert.game || '').toLowerCase();
  const have = `${g.gameType || ''} ${g.gameRaw || ''}`.toLowerCase();
  if (want && !have.includes(want)) return false;
  if (alert.min_bb != null) { const bb = bigBlind(g.stakes); if (bb == null || bb < Number(alert.min_bb)) return false; }
  return true;
}

/** What a snapshot says for an alert: the current value per room and game, and whether it meets the alert. */
function readings(alert, venues) {
  let rooms = null;
  try { rooms = alert.rooms ? JSON.parse(alert.rooms) : null; } catch (_) { rooms = null; }
  const out = [];
  for (const v of venues || []) {
    if (rooms && rooms.length && !rooms.includes(v.slug)) continue;
    for (const g of v.games || []) {
      if (!gameMatches(alert, g)) continue;
      const key = `${v.slug}|${g.gameType}|${g.stakes}`;
      const name = v.name || v.title || v.slug;
      const tables = Number(g.tablesRunning) || 0, wl = Number(g.waitlistLen) || 0;
      let hit = false;
      if (alert.kind === 'opens') hit = tables > 0;
      else if (alert.kind === 'short') hit = tables > 0 && wl < (Number(alert.threshold) || 1);
      else if (alert.kind === 'interest') hit = tables === 0 && (!!g.isInterest || wl > 0);
      out.push({ key, hit, room: name, stakes: g.stakes, game: g.gameType, tables, wl });
    }
  }
  return out;
}

/**
 * One snapshot through every alert. Returns [{ userId, alert, reading }] to send. `venues` is one board for every
 * alert, or a function of the alert's user id giving that player's board (null: none this time, the alert is left
 * as it was): a player's alerts watch the rooms near their own cash location (lib/cash-locations.js).
 */
function evaluate(db, venues) {
  const send = [];
  for (const a of all(db, 'SELECT * FROM cash_alerts WHERE on_ = 1', [])) {
    const board = typeof venues === 'function' ? venues(a.user_id) : venues;
    if (!board) continue;
    for (const r of readings(a, board)) {
      const st = all(db, 'SELECT * FROM cash_alert_state WHERE alert_id = ? AND key = ?', [a.id, r.key])[0] || { value: 0, streak: 0, fired: 0 };
      const now = r.hit ? 1 : 0;
      const streak = now === Number(st.value) ? Number(st.streak) + 1 : 1;
      let fired = Number(st.fired);
      if (now && streak >= 2 && !fired) { send.push({ userId: a.user_id, alert: a, reading: r }); fired = 1; }
      if (!now && streak >= 2) fired = 0;   // closed for two snapshots: armed again
      db.run('INSERT OR REPLACE INTO cash_alert_state (alert_id, key, value, streak, fired) VALUES (?, ?, ?, ?, ?)', [a.id, r.key, now, streak, fired]);
    }
  }
  return send;
}

const words = (a, r) => (a.kind === 'opens' ? `${r.stakes} ${r.game} is running at ${r.room}${r.tables > 1 ? ` (${r.tables} tables)` : ''}`
  : a.kind === 'short' ? `${r.stakes} ${r.game} at ${r.room}: the list is down to ${r.wl}`
    : `An interest list started for ${r.stakes} ${r.game} at ${r.room}`);

/*
 * Every signed-in player since 2026-11-24 (owner: the Cash tab for everyone, game alerts with it); admins only before.
 * `boardFor(db, userId)` names whose board an alert reads: undefined = the owner's (the admins' shared location), a
 * `near` string = a player's own rooms, null = the player has no cash location yet (nothing to watch).
 */
function mountRoutes(app, { getDb, saveDatabase, authenticateToken, requireRegistered, fetchCurrent, sendPush, deliveryOn, boardFor = () => undefined, onAlertsChanged = () => {} }) {
  app.get('/api/cash-alerts', authenticateToken, requireRegistered, (req, res) => {
    res.json({ alerts: all(getDb(), 'SELECT id, kind, game, min_bb, rooms, threshold, on_ AS "on", created_at FROM cash_alerts WHERE user_id = ? ORDER BY created_at', [req.user.id])
      .map((a) => ({ ...a, on: !!a.on, rooms: (() => { try { return a.rooms ? JSON.parse(a.rooms) : null; } catch (_) { return null; } })() })) });
  });
  app.post('/api/cash-alerts', authenticateToken, requireRegistered, async (req, res) => {
    const b = req.body || {};
    const kind = ['opens', 'short', 'interest'].includes(b.kind) ? b.kind : 'opens';
    const game = String(b.game || '').trim().slice(0, 30);
    if (!game) return res.status(400).json({ error: 'Which game?' });
    const minBb = b.minBb != null && b.minBb !== '' ? Number(b.minBb) : null;
    const rooms = Array.isArray(b.rooms) && b.rooms.length ? JSON.stringify(b.rooms.map(String).slice(0, 20)) : null;
    const threshold = kind === 'short' ? Math.max(1, Math.round(Number(b.threshold) || 3)) : null;
    const db = getDb();
    if (all(db, 'SELECT COUNT(*) AS n FROM cash_alerts WHERE user_id = ?', [req.user.id])[0].n >= 20) return res.status(409).json({ error: 'At most 20 alerts' });
    db.run('INSERT INTO cash_alerts (user_id, kind, game, min_bb, rooms, threshold, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.user.id, kind, game, minBb, rooms, threshold, Date.now()]);
    await saveDatabase();
    onAlertsChanged();
    res.status(201).json({ ok: true });
  });
  app.put('/api/cash-alerts/:id', authenticateToken, requireRegistered, async (req, res) => {
    getDb().run('UPDATE cash_alerts SET on_ = ? WHERE id = ? AND user_id = ?', [req.body && req.body.on ? 1 : 0, Number(req.params.id), req.user.id]);
    await saveDatabase();
    onAlertsChanged();
    res.json({ ok: true });
  });
  app.delete('/api/cash-alerts/:id', authenticateToken, requireRegistered, async (req, res) => {
    const db = getDb();
    db.run('DELETE FROM cash_alerts WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
    db.run('DELETE FROM cash_alert_state WHERE alert_id = ?', [Number(req.params.id)]);
    await saveDatabase();
    onAlertsChanged();
    res.json({ ok: true });
  });

  // The watcher's snapshot every 10 minutes, only where pushes can go out and someone has an alert on.
  if (deliveryOn && fetchCurrent) {
    const tick = async () => {
      try {
        const db = getDb();
        if (!all(db, 'SELECT 1 FROM cash_alerts WHERE on_ = 1 LIMIT 1', []).length) return;
        // One board per place: the owner's for the admins' alerts, and one per player location (near=), each
        // fetched once however many alerts read it.
        const boards = new Map();
        const users = [...new Set(all(db, 'SELECT user_id FROM cash_alerts WHERE on_ = 1', []).map((r) => r.user_id))];
        for (const uid of users) {
          const near = boardFor(db, uid);
          if (near === null) continue;
          const key = near || '';
          if (!boards.has(key)) {
            const cur = await fetchCurrent(near || undefined).catch(() => null);
            boards.set(key, cur && Array.isArray(cur.venues) ? cur.venues : null);
          }
        }
        const out = evaluate(db, (uid) => { const near = boardFor(db, uid); return near === null ? null : boards.get(near || '') || null; });
        await saveDatabase();
        for (const s of out) await sendPush(s.userId, 'cash', { title: 'Cash game alert', body: words(s.alert, s.reading), url: '/?view=cash', ref: `${s.alert.id}:${s.reading.key}:${Date.now()}` });
      } catch (err) { console.error('[cash-alerts] tick failed:', err.message); }
    };
    setInterval(tick, 10 * 60 * 1000);
    console.log('[cash-alerts] watching the cash board every 10 minutes');
  }
}

module.exports = { migrate, mountRoutes, evaluate, readings, bigBlind };
