// The bankroll dashboard's Sessions tab (beta, app admins): every tournament result and every
// finished cash session of the selected bankroll in ONE list, newest first, under a pill per year —
// the session list of a dedicated bankroll tracker, in this app's own type and grid.
//
// Dependency-free (no utils.js: it touches localStorage at import), so node --test runs it as is.
// The component (components/BankrollSessions.jsx) passes in what it needs from the app: the
// currency table and the venue -> native currency rule.
//
// DATA. Three existing routes, joined here; no route of its own:
//   GET /api/bankrolls/reports?bankroll=&currency=   one FACT per tournament result and ENDED cash
//       session (and expense / income, which are not sessions and are dropped). Facts carry what
//       the list shows and what the routes below do not: the date already normalised to
//       YYYY-MM-DD (a tournament stored as "May 28, 2026" too), the room's raw material (see
//       tournamentPlace: an online event's is the site KEY), and the result in the dashboard's currency — the ledger's
//       own arithmetic, (cashed ? cash : 0) - buy-in x max(1, bullets), and cash_out - buy_in -
//       tips - expenses, a EUR result converted at the server's rates.
//   GET /api/tracking?bankroll=            joined on 't' + id: finish place, field size, notes,
//       the event's own buy-in and venue (its native currency), start time, event number, and the
//       ROOM (property: "WSOP.com", "GGPoker" for an online event).
//   GET /api/cash-sessions?bankroll=       joined on 'c' + id: start / end, rebuys, cash-out, tips,
//       expenses, currency, notes, tags. The live session is not a fact, so it never appears.
// Without the two joins (a failed request) every row still shows; the detail has fewer fields.
//
// DATES. A row's day is the fact's: a tournament's event date, a cash session's session_date (the
// player's LOCAL day it started — a session begun at 23:30 on Dec 31 belongs to that year even
// though its UTC start is Jan 1). Day labels are built from the Y-M-D parts, never from
// new Date('YYYY-MM-DD'), which is UTC midnight and the previous day west of Greenwich.

import { sessionBbHr } from './bb-hr.js';

export const CHUNK = 150;                       // rows rendered before "Show more"
export const SESSION_TYPES = [['all', 'All'], ['tournament', 'Tournaments'], ['cash', 'Cash']];
export const MINUS = '−';                  // the app's minus sign (utils.js MINUS)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const MONTH_NAMED = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/;

/** 'YYYY-MM-DD' from an ISO date or a "May 28, 2026" style date; null when neither. */
export function isoDay(s) {
  const t = String(s || '').trim();
  const iso = ISO_DAY.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = MONTH_NAMED.exec(t);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

/** "Sat, May 30, 2026" — the app's date idiom, from the day's own parts (no time zone). */
export function dayLabel(ymd) {
  const m = ISO_DAY.exec(String(ymd || ''));
  if (!m) return String(ymd || '');
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return `${DOW[dow]}, ${MONTHS[mo - 1]} ${d}, ${y}`;
}

/** Minutes after midnight from "11:00 AM", "7:30 pm", "14:00"; null when it does not parse. */
export function clockMinutes(time) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?\s*$/.exec(String(time || ''));
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (m[3]) { if (h < 1 || h > 12) return null; h %= 12; if (/p/i.test(m[3])) h += 12; }
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

/** 1 -> '1st', 12 -> '12th', 23 -> '23rd'. */
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const group3 = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const withSymbol = (body, cfg) => (cfg && cfg.pos === 'suf' ? `${body} ${cfg.symbol}` : `${(cfg && cfg.symbol) || '$'}${body}`);

/**
 * A result as the list shows it: whole units with separators under 10,000 ("2,410"), compact from
 * there ("12.9k", "125k", "1.2M"). cfg: { symbol, pos } (utils.js CURRENCY_CONFIG[code]).
 * signed: '+' before a win (the app's money grammar); a loss always carries U+2212.
 */
export function compactMoney(v, cfg, { signed = false } = {}) {
  const n = Math.round(Number(v) || 0);
  const a = Math.abs(n);
  let body;
  const k1 = Math.round(a / 100) / 10;           // thousands, one decimal, half up
  const k0 = Math.round(a / 1000);               // thousands, whole
  if (a < 10000) body = group3(a);
  else if (k1 < 100) body = `${k1}k`;
  else if (k0 < 1000) body = `${k0}k`;
  else body = `${Math.round(a / 1e5) / 10}M`;
  const sign = n < 0 ? MINUS : signed && n > 0 ? '+' : '';
  return sign + withSymbol(body, cfg);
}

/** A buy-in for a title: "$1.5k", "$400", "€1.1k", "$10k", "$25.5k". Zero (a freeroll) -> ''. */
export function shortBuyin(v, cfg) {
  const n = Math.round(Number(v) || 0);
  if (n <= 0) return '';
  if (n < 1000) return withSymbol(String(n), cfg);
  const k = Math.round(n / 100) / 10;
  return withSymbol((k >= 100 ? String(Math.round(k)) : String(k)) + 'k', cfg);
}

// "$1,500 NLH ..." / "€1,100 - Monster Stack" / "$1.5k Mystery Bounty": an amount the event name
// leads with. A k / M suffix only straight after the digits and not running on into a word, so
// "$1,500 Mystery Bounty" keeps its M and "$400 Knockout Turbo" its K.
const LEADING_AMOUNT = /^\s*(?:[$€£¥]|[A-Z]{1,3}\$)\s?(\d[\d,.]*)([kKmM](?![A-Za-z]))?\s*(?:[-–:]\s*)?/;
// What follows an amount that is a guarantee, not a buy-in ("$20,000 GTD").
const GUARANTEE = /^(?:gtd|gtee|g'tee|guarantee[ds]?)\b/i;

/** The money a leading amount spells: "1,500" 1500, "1.5" + k 1500, "1.500" (thousands dots) 1500. */
function amountOf(digits, suffix) {
  const d = digits.replace(/[.,]+$/, '');
  const n = !suffix && /^\d{1,3}(?:\.\d{3})+$/.test(d) ? Number(d.replace(/\./g, '')) : Number(d.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return suffix ? n * (/m/i.test(suffix) ? 1e6 : 1e3) : n;
}

/**
 * The event name without the buy-in it leads with, so the title does not say it twice. Only an
 * amount that IS the entry's buy-in (the same once rounded as the title rounds it: "$1,500" for
 * 1500, "$1.5k" for 1520) and is not a guarantee; any other amount is part of the name ("$20,000
 * GTD" on a $215 event stays whole).
 */
export function eventName(name, buyin) {
  const ev = String(name || '').trim();
  const m = LEADING_AMOUNT.exec(ev);
  if (!m) return ev;
  const rest = ev.slice(m[0].length);
  const a = amountOf(m[1], m[2]);
  const b = Math.round(Number(buyin) || 0);
  if (a == null || b <= 0 || GUARANTEE.test(rest)) return ev;
  const same = Math.abs(a - b) < 1 || shortBuyin(a) === shortBuyin(b);
  return same ? rest.trim() : ev;
}

/** A cash session's title: "$2/5 NLH", "€1/2 PLO", "PL 5 Card Omaha/Big O"; 'Cash game' when bare. */
export function cashTitle(stakes, game, cfg) {
  const st = String(stakes || '').trim();
  const g = String(game || '').trim();
  const s = st ? (/^\d/.test(st) ? (cfg && cfg.pos === 'suf' ? `${st} ${cfg.symbol}` : `${(cfg && cfg.symbol) || '$'}${st}`) : st) : '';
  return [s, g].filter(Boolean).join(' ') || 'Cash game';
}

/** A tournament's title: compact buy-in + event name ("$1.5k Limit Badugi"). */
export function tournamentTitle(name, buyin, cfg) {
  const ev = eventName(name, buyin) || 'Tournament';
  const b = shortBuyin(buyin, cfg);
  return b ? `${b} ${ev}` : ev;
}

/** "12th / 845", "5th", or '' — only for an entry that cashed and recorded its place. */
export function finishLabel(place, field) {
  const p = Number(place);
  if (!(p > 0)) return '';
  const f = Number(field);
  return f > 0 ? `${ordinal(p)} / ${group3(f)}` : ordinal(p);
}

// A private event's venue (the app's "Personal" events, and every result a bankroll import writes):
// a label, not a room, so such a row has no room (or series), and no game of that name.
export const PERSONAL = 'Personal';

/**
 * A tournament's room ('' when none was recorded) and series (its venue, when not the room).
 *
 * The reports fact's room is the analytics' room: the feed's `property`; for an ONLINE event the
 * site key ("wsop_com", "ggpoker"); else the venue, which for a feed row IS the series title. The
 * list wants the poker room the app itself names, so, in this order:
 *   1. the tracking join's `property` ("WSOP.com", "GGPoker", "Horseshoe Las Vegas");
 *   2. a fact room that is an online site key, by the site's name (opts.siteName(key) -> name | '');
 *   3. when the feed named no room (the fact fell back to the series title), the room the app's
 *      curated VENUE_MAP names for that series (opts.roomOf(venue) -> longName | ''), the series
 *      staying the series;
 *   4. otherwise the fact room, or the venue.
 * opts come from the component: utils.js cannot load under node --test.
 */
export function tournamentPlace(fact, entry, opts = {}) {
  const venue = entry ? String(entry.venue || '').trim() : '';
  const property = entry ? String(entry.property || '').trim() : '';
  const factRoom = String((fact && fact.room) || '').trim();
  const personal = venue === PERSONAL || (!entry && factRoom === PERSONAL);
  let room = property || (opts.siteName && opts.siteName(factRoom)) || factRoom || venue;
  if (!personal && !property && venue && factRoom === venue && opts.roomOf) room = opts.roomOf(venue) || room;
  if (personal && room === PERSONAL) room = '';
  const series = venue && !personal && venue !== room ? venue : '';
  return { room, series, personal };
}

const localMinutesOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getHours() * 60 + d.getMinutes();
};

/**
 * The rows, newest first.
 *   facts     GET /api/bankrolls/reports .facts (any order; expense / income dropped)
 *   tracking  GET /api/tracking rows (joined by id), or []
 *   sessions  GET /api/cash-sessions .sessions (joined by id; a live one is ignored), or []
 *   opts      { currency: the facts' display currency, config: code -> { symbol, pos },
 *               nativeOf: venue -> currency code, localMinutes: ISO -> minutes (tests fix the zone),
 *               siteName: online site key -> its name, roomOf: series title -> its curated room }
 * Each row: { key, id, type, date, year, dateLabel, minutes, title, room ('' when none), series
 *             (a tournament's venue when it is not the room, else ''), result, finish, fact,
 *             entry (tracking row | null), session (cash session | null), currency (native) }.
 * Order: date desc, then start time desc (a tournament's scheduled start, a session's local start;
 * none last), then id desc.
 */
export function buildSessions(facts, tracking = [], sessions = [], opts = {}) {
  const config = opts.config || {};
  const cfgOf = (code) => config[code] || config.USD || { symbol: '$', pos: 'pre' };
  const nativeOf = opts.nativeOf || (() => 'USD');
  const localMinutes = opts.localMinutes || localMinutesOf;
  const display = opts.currency || 'USD';
  const byT = new Map((tracking || []).map((e) => [Number(e.id), e]));
  const byC = new Map((sessions || []).filter((s) => s && !s.live && s.ended_at).map((s) => [Number(s.id), s]));
  const rows = [];
  for (const f of facts || []) {
    if (!f || (f.type !== 'tournament' && f.type !== 'cash')) continue;
    const id = Number(String(f.id).slice(1));
    const date = isoDay(f.date);
    if (!date) continue;
    if (f.type === 'tournament') {
      const e = byT.get(id) || null;
      const native = e ? nativeOf(e.venue) : display;
      const cashed = e ? !!Number(e.cashed) : Number(f.cash) > 0;
      const t = e ? clockMinutes(e.time) : null;
      const place = tournamentPlace(f, e, opts);
      rows.push({
        key: f.id, id, type: 'tournament', date, year: date.slice(0, 4), dateLabel: dayLabel(date),
        minutes: t != null ? t : (f.hour != null ? f.hour * 60 : null),
        title: tournamentTitle(e ? e.event_name : f.label, e ? e.buyin : f.buyin, cfgOf(e ? native : display)),
        room: place.room, series: place.series,
        result: Number(f.profit) || 0,
        finish: e && cashed ? finishLabel(e.finish_place, e.total_entries) : '',
        fact: f, entry: e, session: null, currency: native,
      });
    } else {
      const s = byC.get(id) || null;
      const native = s ? s.currency || 'USD' : display;
      rows.push({
        key: f.id, id, type: 'cash', date, year: date.slice(0, 4), dateLabel: dayLabel(date),
        minutes: f.started_at ? localMinutes(f.started_at) : null,
        title: cashTitle(f.stakes, f.game, cfgOf(native)),
        room: String(f.room || (s && s.room) || '').trim(), series: '',
        result: Number(f.profit) || 0,
        finish: '',
        fact: f, entry: null, session: s, currency: native,
      });
    }
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)
    || ((b.minutes == null ? -1 : b.minutes) - (a.minutes == null ? -1 : a.minutes))
    || (a.type === b.type ? b.id - a.id : a.type === 'cash' ? -1 : 1));
  return rows;
}

/** The rows of one type ('all' | 'tournament' | 'cash'). */
export function filterSessions(rows, type) {
  return type === 'tournament' || type === 'cash' ? rows.filter((r) => r.type === type) : rows;
}

/** Consecutive rows (already newest first) grouped by year: [{ year, rows }]. */
export function groupByYear(rows) {
  const out = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.year === r.year) last.rows.push(r); else out.push({ year: r.year, rows: [r] });
  }
  return out;
}

/** "176 sessions" / "152 tournaments" / "1 session". */
export function countLabel(n, type) {
  const noun = type === 'tournament' ? (n === 1 ? 'tournament' : 'tournaments') : (n === 1 ? 'session' : 'sessions');
  return `${group3(n)} ${noun}`;
}

/**
 * A tournament's figures for the detail, in the EVENT's currency (what was paid): per-bullet
 * buy-in, bullets, cost, the cash (0 unless it cashed — a row with an amount but no cash flag is a
 * bubble), net, ROI (null without a cost: a freeroll), finish and field. `display` is the result
 * in the dashboard's currency, from the fact.
 */
export function tournamentFigures(row) {
  const f = row.fact || {};
  const e = row.entry;
  const bullets = Math.max(1, Number(e ? e.num_entries : f.bullets) || 1);
  const buyin = Math.max(0, Number(e ? e.buyin : f.buyin) || 0);
  const cashed = e ? !!Number(e.cashed) : Number(f.cash) > 0;
  const cash = cashed ? Math.max(0, Number(e ? e.cash_amount : f.cash) || 0) : 0;
  const cost = buyin * bullets;
  const net = cash - cost;
  return {
    currency: row.currency, buyin, bullets, cost, cashed, cash, net,
    roi: cost > 0 ? net / cost : null,
    place: cashed && e && Number(e.finish_place) > 0 ? Number(e.finish_place) : null,
    field: e && Number(e.total_entries) > 0 ? Number(e.total_entries) : null,
    notes: (e && e.notes) || '',
    eventNumber: (e && String(e.event_number || '').trim()) || '',
    time: (e && e.time) || '',
    game: [f.game, e && e.game_variant].map((g) => String(g || '').trim()).find((g) => g && g !== PERSONAL) || '',
    display: Number(f.profit) || 0,
  };
}

/**
 * A cash session's figures for the detail, in the SESSION's currency: buy-in (total, rebuys
 * included) and their count, cash-out, tips, expenses, net, hours (end - start; 0 for a session
 * logged with no length), per hour (null under a quarter hour, as the Cash view) and bb (its
 * bb/hr, or BB/hr for a limit game, in blinds: the net over the big blind in the stakes).
 */
export function cashFigures(row) {
  const f = row.fact || {};
  const s = row.session;
  if (!s) {
    // No session in hand (its route failed): the fact's net in the session's OWN money is
    // native_profit; `profit` is converted and cannot be divided by a blind written in the session's.
    const bb = sessionBbHr({ game: f.game, stakes: f.stakes, net: f.native_profit, hours: f.hours });
    return { currency: row.currency, partial: true, hours: Number(f.hours) || 0, net: Number(f.profit) || 0,
      hourly: Number(f.hours) >= 0.25 ? (Number(f.profit) || 0) / Number(f.hours) : null, bb, display: Number(f.profit) || 0,
      startedAt: f.started_at || null, endedAt: null, notes: '', tags: [], stakes: f.stakes || '', game: f.game || '', room: f.room || '' };
  }
  const ms = Date.parse(s.ended_at) - Date.parse(s.started_at);
  const hours = Number.isFinite(ms) && ms > 0 ? ms / 36e5 : 0;
  const buyIn = Number(s.buy_in) || 0, cashOut = Number(s.cash_out) || 0;
  const tips = Number(s.tips) || 0, expenses = Number(s.expenses) || 0;
  const net = cashOut - buyIn - tips - expenses;
  return {
    currency: row.currency, partial: false, buyIn, rebuys: Number(s.rebuys) || 0, cashOut, tips, expenses,
    result: cashOut - buyIn, net, hours, hourly: hours >= 0.25 ? net / hours : null,
    // bb/hr of this one session (utils/bb-hr.js): { unit, rate, blinds, hours } or null (no readable
    // big blind in the stakes, under a quarter hour, or no length).
    bb: sessionBbHr({ game: s.game, stakes: s.stakes, net, hours }),
    startedAt: s.started_at, endedAt: s.ended_at, notes: s.notes || '', tags: Array.isArray(s.tags) ? s.tags : [],
    stakes: s.stakes || '', game: s.game || '', room: s.room || '',
    display: Number(f.profit) || 0,
  };
}
