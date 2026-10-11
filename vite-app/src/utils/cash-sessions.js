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

// ── The session list ────────────────────────────────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** '2026-10' -> 'October 2026'. */
export function monthLabel(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(key || '');
  return m && MONTHS[Number(m[2]) - 1] ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(key || '');
}

/**
 * Sessions (newest first, as the server sends them) -> [{ key: 'YYYY-MM', sessions }], newest month
 * first, each month's sessions in the order given. The headers' totals come from the server's
 * stats.byMonth (converted to one currency); `monthTotals` is the fallback when that is missing.
 */
export function groupByMonth(sessions) {
  const out = [];
  const at = new Map();
  for (const s of sessions || []) {
    const key = String(s.session_date || '').slice(0, 7);
    let g = at.get(key);
    if (!g) { g = { key, sessions: [] }; at.set(key, g); out.push(g); }
    g.sessions.push(s);
  }
  return out.sort((a, b) => b.key.localeCompare(a.key));
}
/** { net, hours } of a month's sessions in their own units (one currency assumed). */
export function monthTotals(sessions) {
  let net = 0, hours = 0;
  for (const s of sessions || []) { net += Number(s.net) || 0; hours += Number(s.hours) || 0; }
  return { net, hours };
}

/** Net per hour of one session, or null under 15 minutes (a rate over minutes is noise). */
export function sessionHourly(s) {
  return s && s.hours >= 0.25 && s.net != null ? s.net / s.hours : null;
}

/**
 * What a new session form starts with: the most recent ENDED session's room, game, stakes, buy-in
 * and its local start/end times, so a regular's second session is three taps. Nothing -> plain
 * defaults (NLH, 19:00 to 23:00).
 */
export function sessionDefaults(sessions) {
  const last = (sessions || []).find((s) => s && !s.live && s.ended_at);
  if (!last) return { room: '', venueSlug: null, game: 'NLH', stakes: '', buyIn: '', start: '19:00', end: '23:00' };
  return {
    room: last.room || '', venueSlug: last.venue_slug || null, game: last.game || 'NLH', stakes: last.stakes || '',
    buyIn: last.buy_in ? String(last.buy_in) : '', start: localTime(last.started_at) || '19:00', end: localTime(last.ended_at) || '23:00',
  };
}

/** Hours between two HH:MM times on a session (an end at or before the start is the next day). */
export function hoursBetweenTimes(start, end) {
  const r = sessionInstants('2000-01-03', start, end);
  return r ? (Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 3600e3 : null;
}
/** HH:MM plus a length in hours -> the HH:MM it ends (wrapping past midnight). */
export function endTimeAfter(start, hours) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(start || '');
  const h = Number(hours);
  if (!m || !Number.isFinite(h) || h <= 0) return null;
  const mins = (Number(m[1]) * 60 + Number(m[2]) + Math.round(h * 60)) % 1440;
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}
/** The form's local day + start time + a length in hours -> { startedAt, endedAt }, or null. */
export function instantsFromHours(day, start, hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0 || h > 72) return null;
  const r = sessionInstants(day, start, start);
  if (!r) return null;
  const s = Date.parse(r.startedAt);
  return { startedAt: r.startedAt, endedAt: new Date(s + Math.round(h * 60) * 60e3).toISOString() };
}
/** A length typed as "4.5", "4,5", "4:30" or "4h 30m" -> hours, or null. */
export function parseHours(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  let m = /^(\d+):(\d{1,2})$/.exec(t);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  m = /^(?:(\d+(?:[.,]\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(t);
  if (m && (m[1] || m[2])) return (m[1] ? Number(m[1].replace(',', '.')) : 0) + (m[2] ? Number(m[2]) / 60 : 0);
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}
/** Hours for the form's hours field: 4 -> '4', 4.5 -> '4.5', 4.333 -> '4.33'. */
export function hoursInput(h) {
  return h == null || !Number.isFinite(h) ? '' : String(Math.round(h * 100) / 100);
}

// ── In-session stack ────────────────────────────────────────────────────────

/**
 * A session's swing: where it stood over time, as [{ t (ms), v (result) }], oldest first. Starts at
 * 0 when it started; each stack update is amount - invested (the buy-in when it was recorded); an
 * ended session closes on cash_out - buy_in; a live one is carried flat to `nowMs`.
 */
export function swingSeries(session, stacks, nowMs = Date.now()) {
  if (!session || !session.started_at) return [];
  const t0 = Date.parse(session.started_at);
  const pts = [{ t: t0, v: 0 }];
  for (const s of stacks || []) {
    const t = Date.parse(s.at);
    if (Number.isFinite(t)) pts.push({ t: Math.max(t0, t), v: (Number(s.amount) || 0) - (Number(s.invested) || 0) });
  }
  pts.sort((a, b) => a.t - b.t);
  if (session.ended_at && session.cash_out != null) {
    pts.push({ t: Math.max(pts[pts.length - 1].t, Date.parse(session.ended_at)), v: (session.cash_out || 0) - (session.buy_in || 0) });
  } else if (Number.isFinite(nowMs) && nowMs > pts[pts.length - 1].t) {
    pts.push({ t: nowMs, v: pts[pts.length - 1].v });
  }
  return pts;
}

/** High and low of a swing, and the last stack recorded (null without one). */
export function swingSummary(stacks) {
  const list = stacks || [];
  if (!list.length) return { last: null, high: null, low: null };
  const vals = list.map((s) => s.result ?? (s.amount - s.invested));
  return { last: list[list.length - 1], high: Math.max(...vals), low: Math.min(...vals) };
}

/**
 * Points -> SVG path data in a W x H viewBox (x by `x`, y by `v`; the value range always includes
 * 0 so the zero line is on the chart). -> { d, zeroY, lastY } or null with fewer than two points.
 * `x` picks the abscissa: 't' (time) or 'i' (index, the chip graph's one step per session).
 */
export function chartPath(points, { W = 1000, H = 300, x = 't', pad = 0.08 } = {}) {
  if (!points || points.length < 2) return null;
  const xs = points.map((p, i) => (x === 'i' ? i : p.t));
  const vs = points.map((p) => p.v);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let lo = Math.min(0, ...vs), hi = Math.max(0, ...vs);
  if (hi === lo) { hi += 1; lo -= 1; }
  const span = hi - lo;
  lo -= span * pad; hi += span * pad;
  const X = (v) => (x1 === x0 ? 0 : ((v - x0) / (x1 - x0)) * W);
  const Y = (v) => H - ((v - lo) / (hi - lo)) * H;
  const r = (n) => Math.round(n * 10) / 10;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${r(X(xs[i]))} ${r(Y(p.v))}`).join(' ');
  return { d, zeroY: r(Y(0)), lastY: r(Y(vs[vs.length - 1])) };
}
