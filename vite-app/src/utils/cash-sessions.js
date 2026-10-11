// ── Cash game sessions (beta, app admins) ────────────────────────────────────
// The client half of lib/cash-sessions.js: pure, dependency-free helpers (no utils.js, which
// reads localStorage at import) so they run under `node --test`.
//
// A session from the server: { id, bankroll_id ('main' | n), started_at, ended_at (null = live),
// session_date (YYYY-MM-DD, the player's local day), room, venue_slug, game, stakes, buy_in
// (total, rebuys included), rebuys (count), cash_out, tips, expenses, currency, notes, tags[],
// live, hours, result, net }.

export const CASH_GAMES = ['NLH', 'PLO', 'PLO5', 'PLO6', 'PLO8', 'Big O', 'LHE', 'O8', 'Stud Hi', 'Stud 8', 'Razz', 'Mixed'];

const pad = (n) => String(n).padStart(2, '0');

/** Running clock for a live session: "0:07:05", "12:30:00". Negative (clock skew) reads 0:00:00. */
export function formatClock(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** A length in hours, for rows and stats: "45m", "6h", "6h 30m". */
export function formatHours(h) {
  const mins = Math.round((Number(h) || 0) * 60);
  if (mins < 60) return `${mins}m`;
  const hh = Math.floor(mins / 60), mm = mins % 60;
  return mm ? `${hh}h ${mm}m` : `${hh}h`;
}

/** Milliseconds a live session has been running, corrected by the server's clock skew. */
export function liveElapsed(session, nowMs = Date.now(), skewMs = 0) {
  if (!session || !session.started_at) return 0;
  return Math.max(0, nowMs + skewMs - Date.parse(session.started_at));
}

/** The LOCAL calendar day of a Date (or now) as YYYY-MM-DD — the day a session belongs to. */
export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The local HH:MM of an ISO instant (for the edit form). */
export function localTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The form's local date + start/end times -> { startedAt, endedAt } as ISO instants. An end time
 * at or before the start time is the next morning (a session from 22:00 to 04:00).
 * Returns null when anything is missing or malformed.
 */
export function sessionInstants(day, start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !/^\d{1,2}:\d{2}$/.test(start || '') || !/^\d{1,2}:\d{2}$/.test(end || '')) return null;
  const [y, m, d] = day.split('-').map(Number);
  const at = (hm, plusDays) => { const [h, mi] = hm.split(':').map(Number); return new Date(y, m - 1, d + plusDays, h, mi, 0, 0); };
  const s = at(start, 0);
  let e = at(end, 0);
  if (e <= s) e = at(end, 1);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  return { startedAt: s.toISOString(), endedAt: e.toISOString() };
}

/** "NLH 2/5" — what a session was. */
export function sessionGame(s) {
  return [s && s.game, s && s.stakes].filter(Boolean).join(' ');
}

/** Tags typed as "deep, reg table" -> ['deep', 'reg table'] (the server dedupes and caps too). */
export function parseTagInput(text) {
  return String(text || '').split(',').map((t) => t.trim()).filter(Boolean);
}

/** A whole-unit amount from a form field ('' -> undefined, so optional fields stay unsent). */
export function amountOrUndefined(v) {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/**
 * Rooms to suggest in the room field: the cash watcher's rooms (`venues`, from /api/cash/current:
 * [{ slug, name }]) first, then rooms from the player's own past sessions, deduped by name
 * (case-insensitive). -> [{ name, slug|null }]
 */
export function roomSuggestions(venues, sessions) {
  const out = [];
  const seen = new Set();
  const add = (name, slug) => {
    const n = String(name || '').trim();
    if (!n || seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    out.push({ name: n, slug: slug || null });
  };
  for (const v of venues || []) add(v && v.name, v && v.slug);
  for (const s of sessions || []) add(s && s.room, s && s.venue_slug);
  return out;
}

/** The venue slug for a room name typed or picked, if it is one the suggestions know. */
export function slugForRoom(name, suggestions) {
  const n = String(name || '').trim().toLowerCase();
  const hit = (suggestions || []).find((r) => r.name.toLowerCase() === n);
  return hit ? hit.slug : null;
}
