// ── The bankroll Locations tab (beta, app admins) ─────────────────────────────────────────
// Pure and dependency-free (runs under `node --test`). Input: the facts of GET /api/bankrolls/reports
// (lib/bankroll-reports.js), prepared by bankroll-filters.js prepareFacts — so a room's key is the
// Reports "Room" breakdown's key exactly (the room trimmed and case-folded) and its label the first
// spelling seen. Output: one location per room, with what the Locations cards show.
//
// What counts: tournament results and ENDED cash sessions (the facts carry no live session).
// Expenses and income are not sessions and have no room: they are left out.
//
//   entries   cash sessions + tournament BULLETS (a re-entry is an entry, as the trackers count)
//   hours     cash hours only (a tournament fact has no length); null when the room has no cash
//   hourly    cash profit / cash hours
//   roi       tournament profit / tournament cost (buy-ins, re-entries included)
//   won       cash only: winning sessions / sessions; tournaments only: cashes / events (ITM, as
//             the Overview's "In the money" counts it — a re-entered event that cashed is one
//             cash of one event); both: results with profit > 0 / results. Results, not bullets,
//             on both sides: a re-entry is one more entry but not one more chance to cash.
//   total     every result, in the display currency (the facts are already converted)

export const MINUS = '−';
export const SORTS = [['result', 'Result'], ['entries', 'Entries'], ['hours', 'Hours'], ['name', 'Name']];
const SORT_KEYS = new Set(SORTS.map((s) => s[0]));
/** The key of the facts that name no room. Its card is always last. */
export const NO_ROOM = '';
export const NO_ROOM_LABEL = 'Room not recorded';

const isPlayed = (f) => f.kind === 'tournament' || f.kind === 'cash';
const inWindow = (date, from, to) => (!from || date >= from) && (!to || date <= to);

/**
 * Group prepared facts by room. `from` / `to` (YYYY-MM-DD, inclusive, null = open) bound the dates.
 * → [{ key, label, total, entries, hours, hourly, roi, won, wonKind, format, currencies, kinds,
 *      cash: { n, hours, profit, wins }, tournament: { n, bullets, cost, profit, cashes, up }, results }]
 * in no particular order (sortLocations orders them). `results` are the room's facts, newest first.
 */
export function buildLocations(facts, { from = null, to = null } = {}) {
  const groups = new Map();
  for (const f of facts || []) {
    if (!isPlayed(f) || !f.date || !inWindow(f.date, from, to)) continue;
    const key = f.roomKey || NO_ROOM;
    let g = groups.get(key);
    if (!g) {
      g = {
        key, label: key ? String(f.room).trim() : NO_ROOM_LABEL, total: 0,
        cash: { n: 0, hours: 0, profit: 0, wins: 0 },
        tournament: { n: 0, bullets: 0, cost: 0, profit: 0, cashes: 0, up: 0 },
        live: 0, online: 0, cur: new Map(), results: [],
      };
      groups.set(key, g);
    }
    const p = Number(f.profit) || 0;
    g.total += p;
    if (f.kind === 'cash') {
      const c = g.cash;
      c.n++; c.hours += Number(f.hours) > 0 ? Number(f.hours) : 0; c.profit += p; if (p > 0) c.wins++;
    } else {
      const t = g.tournament;
      const bullets = Number(f.bullets) > 0 ? Number(f.bullets) : 1;
      t.n++; t.bullets += bullets; t.cost += Number(f.cost) || 0; t.profit += p;
      if (Number(f.cash) > 0) t.cashes++;
      if (p > 0) t.up++;
    }
    if (f.online) g.online++; else g.live++;
    const cur = f.native_currency || null;
    if (cur) g.cur.set(cur, (g.cur.get(cur) || 0) + 1);
    g.results.push(f);
  }
  return [...groups.values()].map((g) => {
    const c = g.cash, t = g.tournament;
    const entries = c.n + t.bullets;
    let won = null, wonKind = null;
    if (c.n && !t.n) { won = c.wins / c.n; wonKind = 'cash'; }
    else if (t.n && !c.n) { won = t.cashes / t.n; wonKind = 'itm'; }
    else if (c.n + t.n > 0) { won = (c.wins + t.up) / (c.n + t.n); wonKind = 'mixed'; }
    const results = g.results.slice().sort(newestFirst);
    return {
      key: g.key, label: g.label, total: g.total, entries,
      hours: c.n ? c.hours : null,
      hourly: c.hours > 0 ? c.profit / c.hours : null,
      roi: t.n && t.cost > 0 ? t.profit / t.cost : null,
      won, wonKind,
      format: g.live && g.online ? 'mixed' : g.online ? 'online' : 'live',
      currencies: [...g.cur.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k),
      kinds: { tournament: t.n > 0, cash: c.n > 0 },
      cash: { ...c }, tournament: { ...t }, results,
    };
  });
}

function newestFirst(a, b) {
  return b.date.localeCompare(a.date)
    || String(b.started_at || '').localeCompare(String(a.started_at || ''))
    || String(b.id).localeCompare(String(a.id), undefined, { numeric: true });
}

export function normaliseSort(v) { return SORT_KEYS.has(v) ? v : 'result'; }

/**
 * Order the cards. result / entries / hours: highest first (ties by result, then name); name:
 * A to Z. The room-less card is always last.
 */
export function sortLocations(list, sort = 'result') {
  const s = normaliseSort(sort);
  const byName = (a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  const cmp = {
    result: (a, b) => b.total - a.total || byName(a, b),
    entries: (a, b) => b.entries - a.entries || b.total - a.total || byName(a, b),
    hours: (a, b) => (b.hours || 0) - (a.hours || 0) || b.total - a.total || byName(a, b),
    name: byName,
  }[s];
  return list.slice().sort((a, b) => (a.key === NO_ROOM) - (b.key === NO_ROOM) || cmp(a, b));
}

/** The whole set: rooms (room-less facts not counted as a room), entries, total. */
export function locationsSummary(list) {
  let entries = 0, total = 0, rooms = 0;
  for (const l of list) { entries += l.entries; total += l.total; if (l.key !== NO_ROOM) rooms++; }
  return { rooms, entries, total };
}

// ── Formatting ─────────────────────────────────────────────────────────────────────────
const trim1 = (x) => x.toFixed(1).replace(/\.0$/, '');

/**
 * Money as the cards show it, as Poker Bankroll Tracker's location cards do: whole units below
 * 100,000 ($15,590), compact from there ($294.5k, $1.2M). `cur` is the display currency's
 * { symbol, pos } (utils.js CURRENCY_CONFIG). `sign` puts + on a gain; a loss always reads with
 * U+2212 (plus-width in every bundled face, so signed columns align).
 */
export const COMPACT_FROM = 1e5;
export function compactMoney(v, cur = { symbol: '$', pos: 'pre' }, { sign = false } = {}) {
  const n = Number(v) || 0;
  const a = Math.round(Math.abs(n));
  let body;
  if (a >= COMPACT_FROM) {
    const k = Math.round(a / 100) / 10;            // thousands, one decimal
    body = k >= 1000 ? trim1(Math.round(a / 1e5) / 10) + 'M' : trim1(k) + 'k';
  } else {
    body = a.toLocaleString('en-US');
  }
  const s = a === 0 ? '' : n < 0 ? MINUS : sign ? '+' : '';
  const sym = cur && cur.symbol != null ? cur.symbol : '$';
  return cur && cur.pos === 'suf' ? `${s}${body} ${sym}` : `${s}${sym}${body}`;
}

/** Hours: one decimal under 10, whole from there. */
export function fmtHours(h) {
  const x = Number(h) || 0;
  return x < 10 ? trim1(x) : Math.round(x).toLocaleString('en-US');
}
export function fmtPct(x) { return `${Math.round(x * 100)}%`; }
export function fmtSignedPct(x) {
  const v = x * 100;
  const body = Math.abs(v).toFixed(Math.abs(x) < 0.1 && x !== 0 ? 1 : 0).replace(/\.0$/, '');
  return (body === '0' ? '' : x > 0 ? '+' : MINUS) + body + '%';
}
const toneOf = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

const FORMAT_LABEL = { live: 'Live', online: 'Online', mixed: 'Live and online' };
/** Line 2 of a card: "Live • USD". */
export function metaLine(loc) {
  return [FORMAT_LABEL[loc.format] || 'Live', loc.currencies.join(', ')].filter(Boolean).join(' • ');
}

/**
 * The stats line, item by item (the card joins them with " • "):
 *   entries · hours (cash rooms only; omitted, not 0, for a tournament-only room) · $/h (cash, when
 *   there are hours) · ROI (when the room has tournaments) · won %.
 * Each { key, text, tone (1 green, -1 red, 0 plain), label (for a screen reader, when the text
 * alone is not enough), icon ('clock' for hours) }. Signed figures are toned; won % is judged only
 * where 50% means something — a cash room's winning sessions — and plain for ITM and mixed rooms.
 */
export function statItems(loc, cur) {
  const out = [{ key: 'entries', text: `${loc.entries.toLocaleString('en-US')} ${loc.entries === 1 ? 'entry' : 'entries'}`, tone: 0 }];
  if (loc.hours != null && loc.hours > 0) {
    out.push({ key: 'hours', text: fmtHours(loc.hours), icon: 'clock', label: `${fmtHours(loc.hours)} hours`, tone: 0 });
  }
  if (loc.hourly != null) out.push({ key: 'hourly', text: `${compactMoney(loc.hourly, cur, { sign: true })}/h`, tone: toneOf(Math.round(loc.hourly)), label: `${compactMoney(loc.hourly, cur, { sign: true })} per hour` });
  if (loc.roi != null) out.push({ key: 'roi', text: `ROI ${fmtSignedPct(loc.roi)}`, tone: toneOf(Math.round(loc.roi * 1000)) });
  if (loc.won != null) {
    const what = loc.wonKind === 'itm' ? 'in the money' : 'won';
    out.push({ key: 'won', text: `${fmtPct(loc.won)} ${loc.wonKind === 'itm' ? 'ITM' : 'won'}`, label: `${fmtPct(loc.won)} ${what}`,
      tone: loc.wonKind === 'cash' ? (loc.won >= 0.5 ? 1 : -1) : 0 });
  }
  return out;
}

/**
 * An open card's rows, a page at a time: the first `first`, then `page` more per tap, so a room
 * with a thousand results never renders them all at once. → { rows (how many to draw), more (the
 * next button: { label, next } or null), fewer (whether "Show fewer" is offered), count ("60 of
 * 1,030" while a big room is part shown, else null) }. The last page reads "Show all N", so a room
 * with up to first + page results is one tap from all of them, as before.
 */
export const FIRST_ROWS = 10;
export const PAGE_ROWS = 50;
export function rowsPage(shown, total, { first = FIRST_ROWS, page = PAGE_ROWS } = {}) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  const rows = Math.min(n, Math.max(first, Math.floor(Number(shown) || 0)));
  const left = n - rows;
  const more = left <= 0 ? null
    : left <= page ? { label: `Show all ${n.toLocaleString('en-US')}`, next: n }
      : { label: `Show ${page} more`, next: rows + page };
  return {
    rows, more, fewer: rows > first,
    count: left > 0 && n > first + page ? `${rows.toLocaleString('en-US')} of ${n.toLocaleString('en-US')}` : null,
  };
}

/** One result row in an open card: what it was. Cash: game and stakes, and the length. */
export function resultWhat(f) {
  if (f.kind === 'cash') {
    const what = [f.game, f.stakes].filter(Boolean).join(' ') || 'Cash';
    return Number(f.hours) > 0 ? `${what} · ${fmtHours(f.hours)} h` : what;
  }
  const b = Number(f.bullets) || 1;
  return `${f.label || 'Tournament'}${b > 1 ? ` ×${b}` : ''}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'YYYY-MM-DD' → 'Oct 3, 2026' (the calendar date as written; no zone moves it). */
export function fmtDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : '';
}
