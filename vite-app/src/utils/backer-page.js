/* The backer's private page (/b/<token>, components/BackerPage.jsx): its pure arithmetic and
 * formatting, kept free of the DOM and of utils.js (which reads localStorage at load) so node can
 * test it (utils/__tests__/backer-page.test.mjs).
 *
 * The feed (GET /api/backer/:token/feed) carries the backer's name, a stakes summary, their
 * opening balance (carry-in), their running total (cumulativeCents = every recorded share + the
 * opening), the session and hour totals, and up to 200 sessions newest first by session date:
 *   { ts, date: 'YYYY-MM-DD', game, venue, hours, sessionResultCents, pct, shareCents }
 */

import { bbHourly, sessionBbHr, bbFigures, fmtBbHr, bbTone } from './bb-hr.js';

// The token is the backer's whole authentication; the server holds the same pattern
// (server.js BACKER_TOKEN_RE): short base62 codes and the legacy 32-hex ones.
export const BACKER_TOKEN_RE = /^[A-Za-z0-9]{6,64}$/;

/** The token in a /b/<token> path (a trailing slash allowed), else null. */
export function backerTokenFromPath(pathname) {
  const m = /^\/b\/([^/]+)\/?$/.exec(String(pathname || ''));
  return m && BACKER_TOKEN_RE.test(m[1]) ? m[1] : null;
}

// ── Formatting ───────────────────────────────────────────────────────────
const MINUS = '−';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const whole = (cents) => Math.round((Number(cents) || 0) / 100);
const group = (n) => Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

/** Whole dollars, no sign: 124000 -> "$1,240". */
export function fmtCents(cents) {
  const v = whole(cents);
  return (v < 0 ? MINUS : '') + '$' + group(v);
}

/** Whole dollars, always signed unless zero: "+$1,240", "−$380", "$0". */
export function fmtSignedCents(cents) {
  const v = whole(cents);
  if (v === 0) return '$0';
  return (v < 0 ? MINUS : '+') + '$' + group(v);
}

/** The tone class a signed figure takes: 'is-pos', 'is-neg' or '' (zero). By whole dollars, so a
 *  figure that reads "$0" is never coloured. */
export function tone(cents) {
  const v = whole(cents);
  return v > 0 ? 'is-pos' : v < 0 ? 'is-neg' : '';
}

/** Hours to one decimal, a whole number without its ".0": 4.5 -> "4.5 h", 5 -> "5 h". */
export function fmtHours(h) {
  const v = Math.round((Number(h) || 0) * 10) / 10;
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + ' h';
}

export const plural = (n, one, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

const parts = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
};

/** "2026-10-11" -> "Sat, Oct 11" (the day of week from the calendar date, no time zone). */
export function fmtDay(iso) {
  const p = parts(iso);
  if (!p) return String(iso || '');
  const dow = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
  return `${DOW[dow]}, ${MONTHS[p.mo - 1]} ${p.d}`;
}

/** "2026-10-11" -> "Oct 11", with the year when it is not `thisYear`: "Oct 11, 2025". */
export function fmtShort(iso, thisYear) {
  const p = parts(iso);
  if (!p) return String(iso || '');
  return `${MONTHS[p.mo - 1]} ${p.d}` + (thisYear && p.y !== thisYear ? `, ${p.y}` : '');
}

/** "2026-10" -> { mon: 'Oct', year: '2026' }. */
export function monthLabel(key) {
  const p = parts(key + '-01');
  return p ? { mon: MONTHS[p.mo - 1], year: String(p.y) } : { mon: String(key || ''), year: '' };
}

// ── Sessions ─────────────────────────────────────────────────────────────

/** Oldest first: by session date, then by when it was recorded (the feed's own tie-break). */
export function chronological(events) {
  return [...(events || [])].filter(Boolean).sort((a, b) =>
    String(a.date || '').localeCompare(String(b.date || '')) || (Number(a.ts) || 0) - (Number(b.ts) || 0));
}

/** Newest first (the list's order), the reverse of chronological. */
export function newestFirst(events) {
  return chronological(events).reverse();
}

/**
 * The headline: running total, sessions, hours, the opening balance, and the value the chart's
 * full history starts from. The feed carries totals over every recorded session (sessions,
 * hours); a feed from before those fields falls back to the sessions it holds. Only the newest
 * 200 sessions are sent, so the curve starts from what the older ones left (`base`, "carried
 * in"), which is the opening balance whenever every session is present.
 */
export function summarize(feed) {
  const f = feed || {};
  const events = Array.isArray(f.events) ? f.events : [];
  const shown = events.reduce((a, e) => a + (Number(e.shareCents) || 0), 0);
  const opening = Math.round(Number(f.openingCents) || 0);
  const total = Number.isFinite(Number(f.cumulativeCents)) ? Math.round(Number(f.cumulativeCents)) : opening + shown;
  const sessions = Number.isFinite(Number(f.sessions)) ? Number(f.sessions) : events.length;
  const hours = Number.isFinite(Number(f.hours)) ? Number(f.hours) : events.reduce((a, e) => a + (Number(e.hours) || 0), 0);
  const base = total - shown;
  return { total, sessions, hours, opening, base, complete: sessions <= events.length && base === opening };
}

// ── bb/hr, the player's ────────────────────────────────────────────────────────────────────
// Worked out in the browser from what the feed already carries: each event's `game` is the whole
// text ("2/5 NLH", "5/5/10 PLO", "4/8 LHE", "NLH MTT"), the big blind is read from it, the result is
// the PLAYER's session result (not the backer's share), the length is `hours`. Nothing is added to
// the feed. A tournament line has no blind in it and is left out, like any session whose text names
// none. See utils/bb-hr.js and docs/bankrolls.md "bb/hr".
const asRow = (e) => ({
  game: e && e.game, stakes: e && e.game,
  net: e && e.sessionResultCents != null && e.sessionResultCents !== '' && Number.isFinite(Number(e.sessionResultCents)) ? Number(e.sessionResultCents) / 100 : null,
  hours: e && e.hours,
});

/** The player's bb/hr over the events: { bb, BB } (each null when no session qualifies). */
export function playerBbHr(events) {
  return bbHourly((events || []).map(asRow));
}

/** One session's rate: { unit, rate, ... } or null (no blind in the text, or under a quarter hour). */
export function eventBbHr(e) {
  return sessionBbHr(asRow(e));
}

/** One session line's rate as the card shows it: { text: "+12.3 bb/hr", tone: 'is-pos'|'is-neg'|'' } or null. */
export function eventBb(e) {
  const r = eventBbHr(e);
  if (!r) return null;
  const t = bbTone(r.rate);
  return { text: fmtBbHr(r.rate, r.unit), tone: t > 0 ? 'is-pos' : t < 0 ? 'is-neg' : '' };
}

/** The same figures as the page's stats line shows them: [{ unit, text, full, tone: 'is-pos'|'is-neg'|'', basis }]. */
export function bbStats(events) {
  const res = playerBbHr(events);
  return bbFigures(res).map((f) => ({
    unit: f.unit, text: f.text, full: f.full, tone: f.tone > 0 ? 'is-pos' : f.tone < 0 ? 'is-neg' : '', n: res[f.unit].n, hours: f.hours,
  }));
}

/** Sessions grouped by calendar month, newest month first and newest session first inside it,
 *  each with the month's share and hours: [{ key: 'YYYY-MM', events, shareCents, hours }]. */
export function groupByMonth(events) {
  const out = [];
  const byKey = new Map();
  for (const e of newestFirst(events)) {
    const key = String(e.date || '').slice(0, 7) || 'undated';
    let g = byKey.get(key);
    if (!g) { g = { key, events: [], shareCents: 0, hours: 0 }; byKey.set(key, g); out.push(g); }
    g.events.push(e);
    g.shareCents += Number(e.shareCents) || 0;
    g.hours += Number(e.hours) || 0;
  }
  return out;
}

// ── The graph ────────────────────────────────────────────────────────────

export const RANGES = [['1m', '1M'], ['3m', '3M'], ['ytd', 'YTD'], ['all', 'All']];
export const RANGE_NOUN = { '1m': 'last month', '3m': 'last 3 months', ytd: 'this year', all: 'all sessions' };

const pad = (n) => String(n).padStart(2, '0');
function monthsBefore(iso, n) {
  const p = parts(iso);
  const idx = p.y * 12 + (p.mo - 1) - n;
  const y = Math.floor(idx / 12), mo = idx - y * 12 + 1;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${y}-${pad(mo)}-${pad(Math.min(p.d, last))}`;
}
const dayAfter = (iso) => new Date(Date.parse(iso + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);

/** The first date a range takes in (inclusive), or null for every session. */
export function rangeFrom(range, today) {
  if (range === 'ytd') return `${String(today).slice(0, 4)}-01-01`;
  const n = { '1m': 1, '3m': 3 }[range];
  return n ? dayAfter(monthsBefore(today, n)) : null;
}

/**
 * The ranges worth offering. A shorter range earns its pill only when it shows something All
 * does not: it leaves out at least one session and still holds two or more. When none does, the
 * history is too short for a switch and the page draws just the curve (an empty list).
 */
export function rangeOptions(events, today) {
  const list = chronological(events);
  const shorter = RANGES.filter(([k]) => k !== 'all').filter(([k]) => {
    const from = rangeFrom(k, today);
    const n = list.filter((e) => String(e.date) >= from).length;
    return n >= 2 && n < list.length;
  });
  return shorter.length ? [...shorter, ['all', 'All']] : [];
}

/**
 * The curve for a range: the running total carried into the window, then one point per session
 * in date order (the value after it). `base` is where the full history starts (summarize().base).
 *   { start, points: [{ date, value }], lo, hi, end, change, first, last, n }
 * or null with no session in the window.
 */
export function shareSeries(events, { base = 0, range = 'all', today = null } = {}) {
  const list = chronological(events);
  const from = range === 'all' || !today ? null : rangeFrom(range, today);
  let start = base;
  const points = [];
  let run = base;
  for (const e of list) {
    const inWindow = !from || String(e.date) >= from;
    if (!inWindow) { run += Number(e.shareCents) || 0; start = run; continue; }
    run += Number(e.shareCents) || 0;
    // share and game: what the graph shows for a session the backer taps (BackerChart).
    points.push({ date: e.date, value: run, share: Number(e.shareCents) || 0, game: e.game || null });
  }
  if (!points.length) return null;
  const values = [start, ...points.map((p) => p.value)];
  const lo = Math.min(...values), hi = Math.max(...values);
  const end = points[points.length - 1].value;
  return { start, points, lo, hi, end, change: end - start, first: points[0].date, last: points[points.length - 1].date, n: points.length };
}

/**
 * The curve's geometry in grid units: x in g across `w`, y in r down `h`, values mapped between
 * `inset` r from the top and bottom so the line and the last point's dot never sit on the edge.
 * A step line: each session's jump at the middle of its 1/n of the width, the total held flat
 * between (results are discrete; a diagonal would draw totals that never existed). Returns the
 * vertices of the line, the baseline's y (the window's starting total) and the last point.
 */
export function stepGeometry(series, { w = 35, h = 16, inset = 1 } = {}) {
  if (!series) return null;
  const { start, points, lo, hi } = series;
  const span = hi - lo;
  const y = (v) => (span === 0 ? h / 2 : inset + (1 - (v - lo) / span) * (h - 2 * inset));
  const n = points.length;
  const line = [[0, y(start)]];
  let prev = start;
  points.forEach((p, i) => {
    const x = ((i + 0.5) / n) * w;
    line.push([x, y(prev)], [x, y(p.value)]);
    prev = p.value;
  });
  line.push([w, y(prev)]);
  return { line, baseY: y(start), last: [w, y(prev)], w, h };
}

// ── Venue strips ─────────────────────────────────────────────────────────

/* A room is online when its name names an online site. The bankroll reports guess the same way
   (lib/bankroll-reports.js ONLINE_ROOM); this adds the sites Ethan's own sessions use (BetRivers,
   BetMGM, Borgata Poker online, WPT Global, Phenom). */
export const ONLINE_ROOM = /\b(acr|americas ?cardroom|winning ?poker|gg ?poker|ggpoker|natural ?8|pokerstars|wsop\.com|wsop online|club ?wpt|wpt ?global|partypoker|party ?poker|bovada|ignition|bet ?online|betrivers|bet ?mgm|borgata ?poker|888 ?poker|coinpoker|global ?poker|phenom|online)\b/i;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * The strip a session's room gets: the room's name as it was logged (the backer knows the room;
 * a curated series name such as "Borgata Spring Poker Open" would misname a cash game), in the
 * room's colour when the venue list knows it, else neutral. Online rooms say so.
 *   venueMap: { [seriesOrRoom]: { abbr, color, longName } } (utils.js VENUE_MAP)
 * Returns { name, label, abbr|null, online }: abbr names a curated colour (getVenueBrandColor);
 * null is the neutral strip.
 */
export function stripFor(venue, venueMap = {}) {
  const name = String(venue || '').trim();
  const online = !!name && ONLINE_ROOM.test(name);
  let abbr = null;
  if (name) {
    const key = norm(name);
    for (const [k, v] of Object.entries(venueMap)) {
      if (!v || !v.abbr) continue;
      if (norm(k) === key || norm(v.abbr) === key || norm(v.longName) === key) { abbr = v.abbr; break; }
    }
  }
  const label = !name ? 'Room not given'
    : online && !/online/i.test(name) ? `${name} · Online` : name;
  return { name, label, abbr, online };
}
