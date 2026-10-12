// ── The home screen's arithmetic (the Dashboard tab) ─────────────────────────────────────────
// Pure and dependency-free: no utils.js, which reads localStorage at import, so this runs under
// `node --test` (src/utils/__tests__/home.test.mjs; `npm run test:home` from the repo root).
//
// MONEY. A tournament result has one rule everywhere in the app: the combined ledger's
// (lib/ledger-sources/tournaments.js), lib/analytics.js normaliseRow() and the Results tab's:
//
//     net = (cashed ? cash_amount : 0) - buyin x max(1, num_entries)
//
// in the event's OWN currency, taken from the ROW. GET /api/tracking joins t.buyin and t.venue
// onto every result, so nothing is looked up in GET /api/tournaments. That list keeps a 3-day
// grace window and never carries 'Personal' events, which is how every older result and every
// imported one used to count as a $0 buy-in under "Other" on the home.

/** One result's money in its own currency: bullets, what they cost, what came back, the net. */
export function resultMoney(row) {
  const r = row || {};
  const units = Math.max(1, Number(r.num_entries) || 1);
  const buyin = Math.max(0, Number(r.buyin) || 0);
  // A stray cash_amount on an entry that did not cash (an edit that unticked Cashed, an import)
  // is not money won.
  const cash = Number(r.cashed) ? Math.max(0, Number(r.cash_amount) || 0) : 0;
  const cost = buyin * units;
  return { units, cost, cash, net: cash - cost };
}

/**
 * `amount` from one currency into another with GET /api/exchange-rates's `rates` (units per USD;
 * USD itself is 1 whether or not it is listed). null when it cannot be done honestly: no rates
 * yet, or no rate for either side. utils.js convertAmount reads a missing rate as 1, which
 * silently counts a euro as a dollar; a total built from this never does.
 */
export function convertMoney(amount, from, to, rates) {
  const a = Number(amount) || 0;
  const f = from || 'USD', t = to || 'USD';
  if (f === t || a === 0) return a;
  if (!rates) return null;
  const rate = (c) => (c === 'USD' ? 1 : Number(rates[c]));
  const rf = rate(f), rt = rate(t);
  if (!(rf > 0) || !(rt > 0)) return null;
  return (a / rf) * rt;
}

/**
 * Totals over GET /api/tracking rows, every row converted from its own currency into `currency`.
 * There is no "native" total: adding euros to dollars gives a number in no currency at all.
 *
 *   opts.currency    the display currency (default 'USD')
 *   opts.rates       GET /api/exchange-rates `rates`, or null while they load
 *   opts.currencyOf  row -> its currency (the app's nativeCurrency(row.venue))
 *   opts.groupOf     row -> a group key for byGroup (the venue strip's abbreviation), optional
 *
 * Returns { currency, count, bullets, cashes, cost, cash, net, roi, byGroup, unconverted }.
 * roi is a percentage, or null when nothing was spent (an empty figure, never 0%). When any row
 * cannot be converted, cost / cash / net / roi and every byGroup figure are null and
 * `unconverted` counts those rows: a part-total presented as the whole is the bug this replaces.
 */
export function tournamentTotals(rows, opts = {}) {
  const currency = opts.currency || 'USD';
  const rates = opts.rates || null;
  const currencyOf = opts.currencyOf || (() => 'USD');
  const groupOf = opts.groupOf || null;
  let count = 0, bullets = 0, cashes = 0, cost = 0, cash = 0, unconverted = 0;
  const groups = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const m = resultMoney(row);
    count += 1;
    bullets += m.units;
    if (Number(row && row.cashed)) cashes += 1;
    const from = currencyOf(row) || 'USD';
    const c = convertMoney(m.cost, from, currency, rates);
    const w = convertMoney(m.cash, from, currency, rates);
    if (c == null || w == null) { unconverted += 1; continue; }
    cost += c;
    cash += w;
    if (groupOf) {
      const k = groupOf(row) || 'Other';
      const g = groups[k] || (groups[k] = { cost: 0, cash: 0, count: 0 });
      g.cost += c; g.cash += w; g.count += 1;
    }
  }
  if (unconverted) {
    const byGroup = {};
    for (const k of Object.keys(groups)) byGroup[k] = { cost: null, cash: null, count: groups[k].count };
    return { currency, count, bullets, cashes, cost: null, cash: null, net: null, roi: null, byGroup, unconverted };
  }
  const net = cash - cost;
  return {
    currency, count, bullets, cashes, cost, cash, net,
    roi: cost > 0 ? (net / cost) * 100 : null,
    byGroup: groups, unconverted: 0,
  };
}

/** The home's display currency from the shared 'trackingCurrency' setting: never Native. */
export function homeCurrency(stored, supported) {
  const c = String(stored || '').toUpperCase();
  if (!c || c === 'NATIVE') return 'USD';
  if (supported && !supported.includes(c)) return 'USD';
  return c;
}

// ── To log and the last result (verdict sections 2 and 3) ───────────────────────────────────

const MS_DAY = 864e5;
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * A row's day as YYYY-MM-DD: utils.js normaliseDate, here so this file stays importable under
 * node. Stored dates come in several shapes ('2026-10-09', 'Oct 9, 2026', 'Fri Oct 9 2026'), so
 * text order is not date order and the server's ORDER BY t.date is not trusted for "newest".
 */
export function isoDay(d) {
  if (!d) return '';
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dt = new Date(s + ' 12:00:00');
  if (isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/** Minutes after midnight of '7:00 PM', '19:00' or '7 PM'; 0 for 'TBD', '' or anything else. */
export function minutesOf(time) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?\s*$/.exec(String(time || ''));
  if (!m) return 0;
  let h = Number(m[1]) % 24;
  const min = Number(m[2] || 0);
  if (m[3]) { const pm = /p/i.test(m[3]); if (h === 12) h = 0; if (pm) h += 12; }
  return h * 60 + min;
}

/** A sortable key for when a result happened: its day, then its start time. '' without a day. */
export function whenKey(row) {
  const day = isoDay(row && row.date);
  if (!day) return '';
  const mins = minutesOf(row.time);
  return `${day}T${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
}

// Sort comparator, newest first: the event's day and time, then when it was logged, then id.
function newer(a, b) {
  const ka = whenKey(a), kb = whenKey(b);
  if (ka !== kb) return ka < kb ? 1 : -1;
  const ca = String((a && a.created_at) || ''), cb = String((b && b.created_at) || '');
  if (ca !== cb) return ca < cb ? 1 : -1;
  return (Number(b && b.id) || 0) - (Number(a && a.id) || 0);
}

/** GET /api/tracking rows newest first, by the event's own day and time (then logged order). */
export function newestFirst(rows) {
  return (Array.isArray(rows) ? rows : []).filter((r) => r && whenKey(r)).sort(newer);
}

/**
 * Bullets a bust used, from the event's latest live update (GET /api/live-updates/active).
 * `bust_count` counts every bust update for the event, the final one included, so after a bust it
 * IS the number of bullets (one bust, one bullet; a rebuy and a second bust, two). While the event
 * is still running the latest update is not a bust and the bullet in play is bust_count + 1, which
 * is what the live-update Finish counts from (LiveUpdatePanel: the update before the final bust).
 */
export function bulletsFromUpdate(u) {
  if (!u) return 1;
  const n = Math.max(0, Number(u.bust_count) || 0);
  return Number(u.is_busted) ? Math.max(1, n) : n + 1;
}

/**
 * The scheduled events whose result is missing: the home's To log (and Results' "Awaiting
 * result" card), newest first. An event waits for a result when
 *   - it is on the schedule, is not a Personal entry (a travel day, a day off) and not a restart
 *     row (a Day 2's result is its flight's);
 *   - nothing is logged for it (a result with its tournament_id, or an id in opts.logged: rows the
 *     home has just logged that the next fetch has not brought back yet), and it was not marked
 *     "Didn't play" (user_schedules.not_played);
 *   - it is over as far as the app can tell: its latest live update is a bust, or it has no live
 *     update and its day is before today, or the room's clock showed it ended (clock_ended_at).
 *     A bagged event, or one still being played (latest update not a bust), waits until it busts
 *     or ends; today's events stay on Up Next until then;
 *   - its day is within opts.lookbackDays (default 30) of today, so a schedule nobody logged long
 *     ago does not sit on the home for ever.
 *
 *   opts.today    YYYY-MM-DD (utils.js getToday)
 *   opts.startOf  event -> epoch ms of its start (utils.js parseTournamentTime, venue-zone aware);
 *                 without it, events order by whenKey
 *
 * Each item: { id, event, update, busted, bullets, place, payout, field }.
 */
export function awaitingResults(schedule, results, updates, opts = {}) {
  const today = opts.today || '';
  const lookback = opts.lookbackDays == null ? 30 : opts.lookbackDays;
  const logged = new Set((Array.isArray(results) ? results : []).map((r) => Number(r && r.tournament_id)));
  for (const id of opts.logged || []) logged.add(Number(id));
  const latest = new Map();
  for (const u of Array.isArray(updates) ? updates : []) {
    if (!u) continue;
    const k = Number(u.tournament_id);
    const prev = latest.get(k);
    if (!prev || (Number(u.id) || 0) > (Number(prev.id) || 0)) latest.set(k, u);
  }
  const floor = today && lookback > 0
    ? new Date(Date.parse(today + 'T12:00:00Z') - lookback * MS_DAY).toISOString().slice(0, 10)
    : '';
  const out = [];
  for (const e of Array.isArray(schedule) ? schedule : []) {
    if (!e || e.venue === 'Personal' || Number(e.is_restart) || Number(e.not_played)) continue;
    const id = Number(e.id);
    if (!Number.isInteger(id) || logged.has(id)) continue;
    const day = isoDay(e.date);
    if (!day || (today && day > today) || (floor && day < floor)) continue;
    const u = latest.get(id) || null;
    if (u && !Number(u.is_busted)) continue;          // playing, or bagged: not over yet
    const over = u ? true : (!!today && day < today) || !!e.clock_ended_at;
    if (!over) continue;
    out.push({
      id, event: e, update: u, busted: !!u,
      bullets: bulletsFromUpdate(u),
      // What the bust's own update said, for the result form: the place (the Finish tab posts it
      // as places_left), a deal's place and payout, the field.
      place: u ? (Number(u.deal_place) || Number(u.places_left) || null) : null,
      payout: u ? (Number(u.deal_payout) || null) : null,
      field: (u && Number(u.total_entries)) || Number(e.total_entries) || null,
    });
  }
  const startOf = opts.startOf;
  const at = (x) => {
    if (!startOf) return null;
    const v = startOf(x.event);
    return Number.isFinite(v) ? v : null;
  };
  return out.sort((a, b) => {
    const ta = at(a), tb = at(b);
    if (ta != null && tb != null && ta !== tb) return tb - ta;
    return newer(a.event, b.event);
  });
}

// ── Money and labels ──
const MINUS = '−';
function trim1(x) {
  const r = Math.round(x * 10) / 10;
  return r % 1 === 0 ? String(r) : r.toFixed(1);
}

/**
 * Money for the home: whole units, and from 10,000 one decimal of thousands ($12.4k; $1.2M from a
 * million). `cur` is { symbol, pos } (utils.js CURRENCY_CONFIG[code]; default '$' in front).
 * opts.signed puts '+' on a gain (never on zero). An empty figure is not this function's business:
 * the caller shows a dash with a reason, never '$0'.
 */
export function fmtMoney(v, cur = null, opts = {}) {
  const n = Number(v);
  if (v == null || !Number.isFinite(n)) return '—';
  const c = cur || { symbol: '$', pos: 'pre' };
  const a = Math.abs(n);
  let body;
  if (a >= 1e6) body = `${trim1(a / 1e6)}M`;
  else if (a >= 1e4) body = `${trim1(a / 1e3)}k`;
  else body = Math.round(a).toLocaleString('en-US');
  const zero = Math.round(a) === 0;
  const sign = n < 0 && !zero ? MINUS : (opts.signed && n > 0 && !zero ? '+' : '');
  return c.pos === 'suf' ? `${sign}${body} ${c.symbol}` : `${sign}${c.symbol}${body}`;
}

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st ... */
export function ordinal(n) {
  const v = Math.abs(Math.round(Number(n) || 0));
  const s = (v % 100 >= 11 && v % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th');
  return `${v}${s}`;
}

/** The 'top 4.2%' figure: one decimal under 10%, whole above; null when it cannot be said. */
export function topPercent(place, field) {
  const p = Number(place), f = Number(field);
  if (!(p >= 1) || !(f >= 1) || p > f) return null;
  const pct = (p / f) * 100;
  return pct < 10 ? `${Math.max(0.1, Math.round(pct * 10) / 10).toFixed(1)}%` : `${Math.round(pct)}%`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/**
 * A day as the home names it: 'Today', 'Yesterday', the weekday within the last week ('Wed'),
 * else 'Oct 3' ('Oct 3, 2025' in another year). `today` is YYYY-MM-DD.
 */
export function dayName(day, today) {
  const d = isoDay(day);
  if (!d) return '';
  const [y, m, dd] = d.split('-').map(Number);
  const t = Date.UTC(y, m - 1, dd);
  if (today) {
    const [ty, tm, td] = today.split('-').map(Number);
    const diff = Math.round((Date.UTC(ty, tm - 1, td) - t) / MS_DAY);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff > 1 && diff < 7) return WEEKDAYS[new Date(t).getUTCDay()];
    if (ty !== y) return `${MONTHS3[m - 1]} ${dd}, ${y}`;
  }
  return `${MONTHS3[m - 1]} ${dd}`;
}

/** An event number as shown: '#12', the feed's 'MTT-' style prefix dropped; '' when there is none. */
export function eventNo(n) {
  const s = String(n == null ? '' : n).replace(/^[A-Za-z]+-/, '').trim();
  return s ? `#${s}` : '';
}

/**
 * One tournament result's receipt (a GET /api/tracking row): its money (resultMoney), its finish,
 * and the three facts of the card's fact bar (11g | 11g | 13g), each { key, value, label, muted?,
 * title? }:
 *   entry   '2 × $600' BULLETS, or '$600' BUY-IN
 *   cash    '$2,400' CASHED, or 'No cash'
 *   finish  '34th of 812' TOP 4.2% | '34th' PLACE | (cashed, no place) '4×' BUY-IN |
 *           (no place, field known) '812' ENTRIES | '—' NO FINISH LOGGED (a dash with its reason)
 * `money(v)` formats an amount in the row's own currency (fmtMoney with its symbol).
 */
export function tournamentReceipt(row, money = (v) => fmtMoney(v)) {
  const r = row || {};
  const m = resultMoney(r);
  const buyin = Math.max(0, Number(r.buyin) || 0);
  const cashed = !!Number(r.cashed);
  const place = Number(r.finish_place) >= 1 ? Math.round(Number(r.finish_place)) : null;
  const field = Number(r.total_entries) >= 1 ? Math.round(Number(r.total_entries)) : null;
  const top = place && field ? topPercent(place, field) : null;
  const facts = [];
  facts.push(m.units > 1
    ? { key: 'entry', value: `${m.units} × ${money(buyin)}`, label: 'Bullets' }
    : { key: 'entry', value: buyin > 0 ? money(buyin) : 'Free', label: buyin > 0 ? 'Buy-in' : 'Entry' });
  facts.push(cashed
    ? { key: 'cash', value: money(m.cash), label: 'Cashed' }
    : { key: 'cash', value: 'No cash', label: '', muted: true });
  if (place && field && top) facts.push({ key: 'finish', value: `${ordinal(place)} of ${field.toLocaleString('en-US')}`, label: `Top ${top}` });
  else if (place) facts.push({ key: 'finish', value: ordinal(place), label: 'Place' });
  else if (cashed && buyin > 0) facts.push({ key: 'finish', value: `${trim1(m.cash / buyin)}×`, label: 'Buy-in' });
  else if (field) facts.push({ key: 'finish', value: field.toLocaleString('en-US'), label: 'Entries' });
  else facts.push({ key: 'finish', value: '—', label: 'No finish logged', muted: true, title: 'No finishing place was logged for this result' });
  return { ...m, buyin, cashed, place, field, top, facts };
}

/**
 * An ended cash session's receipt (a GET /api/cash-sessions row): the net after tips and
 * expenses, then hours, the hourly rate to the whole unit, stakes and game. No ROI: a cash
 * session has none.
 */
export function cashReceipt(s, money = (v) => fmtMoney(v)) {
  const x = s || {};
  const net = Number(x.net) || 0;
  const hours = Number(x.hours) > 0 ? Number(x.hours) : null;
  const facts = [
    hours ? { key: 'hours', value: trim1(hours), label: hours === 1 ? 'Hour' : 'Hours' }
      : { key: 'hours', value: '—', label: 'No time', muted: true, title: 'The session has no end time' },
    hours ? { key: 'rate', value: money(net / hours), label: 'Per hour' }
      : { key: 'rate', value: '—', label: 'Per hour', muted: true, title: 'No hours to divide by' },
    x.stakes ? { key: 'game', value: String(x.stakes), label: String(x.game || '') }
      : { key: 'game', value: String(x.game || 'Cash'), label: 'Game' },
  ];
  return { net, hours, facts };
}

/**
 * The milestone a result set, if any: 'Biggest cash' (its cash beats every earlier one, and there
 * was an earlier one) or 'Back to break-even' (the running net crossed from below zero to zero or
 * above with it). `rows` are tournament results; `value(row, 'cost' | 'cash')` puts a row's money
 * in one currency, or returns null when it cannot, and then nothing is claimed.
 */
export function receiptMilestone(rows, last, value = (r, f) => resultMoney(r)[f]) {
  if (!last) return null;
  const before = newestFirst(rows).filter((r) => r !== last && newer(r, last) > 0);
  let net = 0, best = 0;
  for (const r of before) {
    const c = value(r, 'cost'), w = value(r, 'cash');
    if (c == null || w == null) return null;
    net += w - c;
    if (w > best) best = w;
  }
  const c = value(last, 'cost'), w = value(last, 'cash');
  if (c == null || w == null) return null;
  if (w > 0 && best > 0 && w > best) return 'Biggest cash';
  if (net < 0 && net + w - c >= 0) return 'Back to break-even';
  return null;
}

/**
 * The last result, for the receipt: the newest tournament result or, for admins, the newest
 * ended cash session when that is newer. `cashSessions` are GET /api/cash-sessions rows.
 * Returns { kind: 'tournament', row } | { kind: 'cash', session } | null.
 */
export function lastResult(results, cashSessions) {
  const t = newestFirst(results)[0] || null;
  const keyOf = (s) => {
    const d = new Date(s.started_at);
    return `${isoDay(s.session_date)}T${isNaN(d.getTime()) ? '00:00' : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`}`;
  };
  let c = null;
  for (const s of Array.isArray(cashSessions) ? cashSessions : []) {
    if (!s || s.live || !isoDay(s.session_date)) continue;
    if (!c || keyOf(s) > keyOf(c)) c = s;
  }
  if (c && (!t || keyOf(c) > whenKey(t))) return { kind: 'cash', session: c };
  return t ? { kind: 'tournament', row: t } : null;
}
