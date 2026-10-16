'use strict';
/*
 * The backer page's live beacon (owner, 2026-10-16: "a beacon on the backer pages that shows when a
 * player is actively playing ... and what it is that they're playing"). Read-only, from what the app
 * already records:
 *
 *   cash        a live cash session (cash_sessions.ended_at NULL), started within CASH_MAX_HOURS
 *   tournament  an event whose latest live update is neither a bust nor a bag, made within
 *               TOURNAMENT_FRESH_HOURS, with no result logged for it and the room's clock not ended
 *
 * The newest-started of the two wins. A session older than its window is treated as forgotten
 * (an unended cash session, a run nobody busted out of), never as live for ever.
 *
 * What a backer sees: the kind, a title (stakes and game, or the event's name), the room, and when it
 * started. Nothing else: no stack, no amounts, no notes.
 */

const CASH_MAX_HOURS = 24;
const TOURNAMENT_FRESH_HOURS = 20;

function rows(db, sql, params) {
  const s = db.prepare(sql);
  const out = [];
  try { s.bind(params || []); while (s.step()) out.push(s.getAsObject()); } finally { s.free(); }
  return out;
}

/** A stored time as epoch ms: SQLite's 'YYYY-MM-DD HH:MM:SS' is UTC; ISO strings parse as given. */
function at(v) {
  if (v == null || v === '') return null;
  const s = String(v);
  const t = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? s.replace(' ', 'T') + 'Z' : s);
  return Number.isFinite(t) ? t : null;
}

function hasColumn(db, table, col) {
  try { return rows(db, `PRAGMA table_info(${table})`).some((r) => r.name === col); } catch { return false; }
}

/** The player's session right now, or null: { kind, title, room, since } (since: ISO). */
function liveSession(db, userId, now = Date.now()) {
  if (userId == null) return null;
  const found = [];

  try {
    const c = rows(db, `SELECT started_at, game, stakes, room FROM cash_sessions
      WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`, [userId])[0];
    const t = c ? at(c.started_at) : null;
    if (c && t != null && t <= now + 60000 && now - t < CASH_MAX_HOURS * 3600000) {
      found.push({
        kind: 'cash',
        title: [c.stakes, c.game].map((x) => String(x || '').trim()).filter(Boolean).join(' ') || 'Cash game',
        room: String(c.room || '').trim() || null,
        since: new Date(t).toISOString(),
      });
    }
  } catch { /* no cash sessions table on this database */ }

  try {
    const clock = hasColumn(db, 'tournaments', 'clock_ended_at') ? ', t.clock_ended_at' : '';
    const started = hasColumn(db, 'live_updates', 'play_started_at') ? ', lu.play_started_at' : '';
    const latest = rows(db, `SELECT lu.tournament_id, lu.created_at, lu.is_busted, lu.is_bagged${started},
        t.event_name, t.venue, t.property${clock}
      FROM live_updates lu JOIN tournaments t ON t.id = lu.tournament_id
      WHERE lu.user_id = ?
        AND lu.id = (SELECT MAX(id) FROM live_updates x WHERE x.user_id = lu.user_id AND x.tournament_id = lu.tournament_id)
      ORDER BY lu.id DESC LIMIT 8`, [userId]);
    for (const u of latest) {
      if (Number(u.is_busted) || Number(u.is_bagged) || u.clock_ended_at) continue;
      const t = at(u.created_at);
      if (t == null || now - t >= TOURNAMENT_FRESH_HOURS * 3600000) continue;
      const logged = rows(db, 'SELECT 1 AS x FROM tracking_entries WHERE user_id = ? AND tournament_id = ? LIMIT 1', [userId, u.tournament_id]).length > 0;
      if (logged) continue;
      const since = at(u.play_started_at) || t;
      found.push({
        kind: 'tournament',
        title: String(u.event_name || '').trim() || 'Tournament',
        room: String(u.property || u.venue || '').trim() || null,
        since: new Date(since).toISOString(),
      });
      break;
    }
  } catch { /* no live updates on this database */ }

  if (!found.length) return null;
  found.sort((a, b) => Date.parse(b.since) - Date.parse(a.since));
  return found[0];
}

module.exports = { liveSession, CASH_MAX_HOURS, TOURNAMENT_FRESH_HOURS };
