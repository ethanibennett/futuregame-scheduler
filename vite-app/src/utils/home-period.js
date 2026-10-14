// ── The home's NUMBERS: the bankroll line and the period block (verdict sections 4 and 5) ─────
// Pure and dependency-free past the two pure modules it builds on (bankroll-ledger.js, the
// Overview's arithmetic, and home.js), so it runs under `node --test`
// (src/utils/__tests__/home-period.test.mjs; `npm run test:home`).
//
// THE PERIOD BLOCK. One block whose window follows what is running:
//   trip    a trip covering today (admins: trips are part of the bankroll beta). Its P&L is the
//           trip page's own (GET /trips/:id through utils/transactions.js tripPnl): the results
//           and cash sessions dated inside it, in its bankroll scope, plus the expenses and income
//           tagged to it: "Net after expenses", the same figure as the page the block opens.
//   series  else a series detected with confidence (currentSeries): the user's own events of one
//           feed series, today inside them, nothing else competing. Tournaments only.
//   month   else the calendar month to date, beside the same days of last month (like for like)
//           and all of last month.
// Admins' month figures run the Overview's own function (overviewStats) on the combined ledger,
// and a trip's the trip page's, so the app has one Net; everyone else's are their tournament results with the ledger's
// formula (home.js tournamentTotals). The honesty rules hold for every figure: a rate carries its
// sample, an empty figure is a dash with a reason (never $0 or 0%), money is whole dollars and
// $12.4k from $10k, profit gets no arrow and no trend colour.
import { overviewStats, goalProgress, periodWindow, fmtRule, MOVE_KINDS } from './bankroll-ledger.js';
import { tournamentTotals, convertMoney, isoDay, eventNo } from './home.js';
import { tripPnl } from './transactions.js';

const MS_DAY = 864e5;
const MINUS = '−';
const pad2 = (n) => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GAME = new Set(['tournaments', 'cash-sessions']);

const t0 = (iso) => Date.parse(iso + 'T00:00:00Z');
/** YYYY-MM-DD plus n days. */
export function addDays(iso, n) { return new Date(t0(iso) + n * MS_DAY).toISOString().slice(0, 10); }
/** Whole days from a to b (b - a). */
export function daysBetween(a, b) { return Math.round((t0(b) - t0(a)) / MS_DAY); }
const lastOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based

/** YYYY-MM-DD n months before `iso`, the day clamped to that month's length (Mar 31 -> Feb 28). */
export function monthsBack(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const idx = y * 12 + (m - 1) - n;
  const yy = Math.floor(idx / 12), mm = idx - yy * 12 + 1;
  return `${yy}-${pad2(mm)}-${pad2(Math.min(d, lastOfMonth(yy, mm)))}`;
}

/** A span of days as the home writes it: 'Sep 1–12', 'Sep 1', 'Sep 28 – Oct 3'. */
export function dayRange(from, to) {
  const [, fm, fd] = from.split('-').map(Number);
  const [, tm, td] = (to || from).split('-').map(Number);
  if (!to || to === from) return `${MON3[fm - 1]} ${fd}`;
  if (fm === tm) return `${MON3[fm - 1]} ${fd}–${td}`;
  return `${MON3[fm - 1]} ${fd} – ${MON3[tm - 1]} ${td}`;
}

/**
 * The month's windows: this month to date (cur), the same days of last month (prev: Oct 1–12 against
 * Sep 1–12, the day clamped so Mar 1–31 meets Feb 1–28) and all of last month (prevFull). A partial
 * month beside a whole one makes every month start as a collapse; the same days are the fair test.
 */
export function paceWindows(today) {
  const [y, m] = today.split('-').map(Number);
  const cur = { from: `${y}-${pad2(m)}-01`, to: today };
  const prevTo = monthsBack(today, 1);
  const [py, pm] = prevTo.split('-').map(Number);
  const prev = { from: `${py}-${pad2(pm)}-01`, to: prevTo };
  const prevFull = { from: prev.from, to: `${py}-${pad2(pm)}-${pad2(lastOfMonth(py, pm))}` };
  return {
    cur, prev, prevFull,
    name: MONTHS[m - 1], prevName: MON3[pm - 1], prevNameLong: MONTHS[pm - 1],
    curLabel: dayRange(cur.from, cur.to), prevLabel: dayRange(prev.from, prev.to),
  };
}

/** The first day the home's ledger has to reach back to: last month's first, a yearly goal's Jan 1, a trip's start. */
export function ledgerFrom(today, { goals = [], trip = null } = {}) {
  let from = paceWindows(today).prev.from;
  if ((goals || []).some((g) => g && g.period === 'year')) from = `${today.slice(0, 4)}-01-01` < from ? `${today.slice(0, 4)}-01-01` : from;
  if (trip && trip.start_date && trip.start_date < from) from = trip.start_date;
  return from;
}

/**
 * The trip covering today (GET /api/bankrolls/trips rows: start_date..end_date inclusive), or null.
 * Two at once: the one that started last, then the shorter.
 */
export function currentTrip(trips, today) {
  const on = (Array.isArray(trips) ? trips : []).filter((t) => t && t.start_date && t.end_date && t.start_date <= today && today <= t.end_date);
  on.sort((a, b) => (a.start_date < b.start_date ? 1 : a.start_date > b.start_date ? -1 : 0)
    || (daysBetween(a.start_date, a.end_date) - daysBetween(b.start_date, b.end_date))
    || ((Number(b.id) || 0) - (Number(a.id) || 0)));
  return on[0] || null;
}

/**
 * The series the user is in the middle of, or null when that cannot be said with confidence (the
 * block then shows the month: a guess would put the wrong window on the home).
 *
 * A series row is a schedule row from a feed or import (a source_pdf tag: the feed's venue IS the
 * series title) that is live, not online (the online feed is a running site, not a trip), not a
 * Personal entry and not a restart row. The user's rows of one venue, within opts.spanDays (45) of
 * today, are a running series when
 *   - there are at least 3, at least half of them numbered (series events carry event numbers),
 *     and they span at most spanDays;
 *   - at least one is behind the user (before today, or already logged) and one is still ahead
 *     (today or later, not logged): today is inside the series, not on its first day;
 *   - the venue is not just the room's name (a series has a title of its own).
 * It is confident only when exactly ONE venue is running (two series at once is ambiguous) and it
 * holds at least two thirds of everything the user played or scheduled from its first day to today
 * (else the week was mostly elsewhere, and the series is not the unit to count it in).
 * A row whose plan resolved off (opts.plans: home-upnext.js resolveConditions, as Up Next and To
 * log read them) was never played, so it counts like one marked Didn't play: not at all.
 *
 * results: GET /api/tracking rows (tournament_id, venue, date). Returns
 *   { venue, from, to, events, behind, ahead, ids }   from..to = the user's first and last day of it,
 *   ids its schedule rows' tournament ids (a result belongs to the series by its event, or its venue).
 */
export function currentSeries(schedule, results, today, opts = {}) {
  const span = opts.spanDays == null ? 45 : opts.spanDays;
  const off = planIsOff(opts.plans);
  const lo = addDays(today, -span), hi = addDays(today, span);
  const logged = new Set((Array.isArray(results) ? results : []).map((r) => Number(r && r.tournament_id)));
  const groups = new Map();
  const seen = new Set();
  const activity = []; // { day, venue } of every live row, for the share test
  for (const e of Array.isArray(schedule) ? schedule : []) {
    if (!e || e.venue === 'Personal' || Number(e.is_restart) || Number(e.is_online)) continue;
    const day = isoDay(e.date);
    if (!day || day < lo || day > hi) continue;
    const id = Number(e.id);
    seen.add(id);
    if ((Number(e.not_played) || off(id)) && !logged.has(id)) continue;
    activity.push({ day, venue: e.venue });
    const tag = String(e.source_pdf || '');
    if (!tag || tag === 'online-feed' || !e.venue) continue;
    if (e.property && String(e.property).trim().toLowerCase() === String(e.venue).trim().toLowerCase()) continue;
    const g = groups.get(e.venue) || { venue: e.venue, rows: [] };
    g.rows.push({ id, day, numbered: !!eventNo(e.event_number), logged: logged.has(id) });
    groups.set(e.venue, g);
  }
  // Results whose event is not on the schedule still count as activity elsewhere.
  for (const r of Array.isArray(results) ? results : []) {
    if (!r || seen.has(Number(r.tournament_id)) || r.venue === 'Personal') continue;
    const day = isoDay(r.date);
    if (day && day >= lo && day <= today) activity.push({ day, venue: r.venue });
  }
  const running = [];
  for (const g of groups.values()) {
    const days = g.rows.map((x) => x.day).sort();
    const from = days[0], to = days[days.length - 1];
    const behind = g.rows.filter((x) => x.day < today || x.logged).length;
    const ahead = g.rows.filter((x) => x.day >= today && !x.logged).length;
    const numbered = g.rows.filter((x) => x.numbered).length;
    if (g.rows.length < 3 || numbered * 2 < g.rows.length) continue;
    if (daysBetween(from, to) > span || !(from <= today && today <= to)) continue;
    if (behind < 1 || ahead < 1) continue;
    running.push({ venue: g.venue, from, to, events: g.rows.length, behind, ahead, ids: g.rows.map((x) => x.id) });
  }
  if (running.length !== 1) return null;
  const s = running[0];
  const window = activity.filter((a) => a.day >= s.from && a.day <= today);
  const mine = window.filter((a) => a.venue === s.venue).length;
  if (mine * 3 < window.length * 2) return null;
  return s;
}

// ── Stats ─────────────────────────────────────────────────────────────────────────────────
const inWindow = (d, w) => !!d && (!w.from || d >= w.from) && (!w.to || d <= w.to);
const EMPTY_CASH = { profit: 0, sessions: 0, hours: 0, hourly: null };

/**
 * Admins: a window of the combined ledger (GET /api/bankrolls/ledger entries, in the display
 * currency), through the Overview's overviewStats. keep(e) narrows it (a trip's games, its scope).
 * -> { net, count, mtt, cash, other: { net, count }, unconverted: 0 }; net and the figures are
 *    results only (deposits, withdrawals and transfers are money moved, not won).
 */
export function ledgerStats(entries, w, keep = null) {
  const rows = (Array.isArray(entries) ? entries : []).filter((e) => e && inWindow(e.date, w) && (!keep || keep(e)));
  const s = overviewStats(rows);
  let count = 0, other = 0;
  for (const e of rows) {
    if (MOVE_KINDS.has(e.kind)) continue;
    count++;
    if (!GAME.has(e.source)) other++;
  }
  return { net: s.results, count, mtt: s.mtt, cash: s.cash, other: { net: s.bySource.other, count: other }, unconverted: 0 };
}

/**
 * Everyone's tournaments (and every series): GET /api/tracking rows in a window, the ledger formula,
 * each row converted from its own currency (opts as home.js tournamentTotals, plus keep(row)).
 * Same shape as ledgerStats; with a row that cannot be converted, every money figure is null.
 */
export function resultStats(rows, w, opts = {}) {
  const keep = opts.keep || null;
  const inW = (Array.isArray(rows) ? rows : []).filter((r) => r && inWindow(isoDay(r.date), w) && (!keep || keep(r)));
  const t = tournamentTotals(inW, opts);
  return {
    net: t.net, count: t.count, unconverted: t.unconverted,
    mtt: {
      profit: t.net, cost: t.cost, roi: t.roi == null ? null : t.roi / 100,
      events: t.count, bullets: t.bullets, cashes: t.cashes, itm: t.count ? t.cashes / t.count : null,
    },
    cash: { ...EMPTY_CASH },
    other: { net: 0, count: 0 },
  };
}

/**
 * Admins' trip: GET /api/bankrolls/trips/:id ({ results, cash_sessions, transactions }) through
 * the trip page's own tripPnl (utils/transactions.js), in the display currency with the app's
 * exchange rates (GET /api/exchange-rates, as the trip page converts). One definition of a trip's
 * net, so the home's 'Net after expenses' is the 'Trip net' its tap opens. Same shape as
 * ledgerStats; an amount that cannot be converted makes every money figure null.
 *   opts: { currency, rates, currencyOf: row -> its currency (utils.js nativeCurrency(row.venue)) }
 */
export function tripStats(data, opts = {}) {
  const currency = opts.currency || 'USD';
  const currencyOf = opts.currencyOf || (() => 'USD');
  const convert = (v, from, to) => {
    const x = convertMoney(v, from || 'USD', to, opts.rates || null);
    return x == null ? NaN : x;
  };
  const p = tripPnl(data, { currency, convert, nativeCurrency: (venue) => currencyOf({ venue }) });
  const bad = p.unconverted > 0;
  const txCount = p.byCategory.count;
  const t = p.tournaments, c = p.cash;
  return {
    net: bad ? null : p.net,
    count: t.events + c.sessions + txCount,
    unconverted: p.unconverted,
    mtt: {
      profit: bad ? null : t.profit, cost: bad ? null : t.cost,
      roi: bad || !(t.cost > 0) ? null : t.profit / t.cost,
      events: t.events, bullets: t.bullets, cashes: t.cashes, itm: t.events ? t.cashes / t.events : null,
    },
    cash: { profit: bad ? null : c.profit, sessions: c.sessions, hours: c.hours, hourly: bad ? null : c.hourly },
    other: { net: bad ? null : Math.round((p.income - p.expenses) * 100) / 100, count: txCount },
  };
}

// ── Words ─────────────────────────────────────────────────────────────────────────────────
export function plural(n, one, many = `${one}s`) { return `${Number(n).toLocaleString('en-US')} ${n === 1 ? one : many}`; }
function trim1(x) { const r = Math.round(x * 10) / 10; return r % 1 === 0 ? String(r) : r.toFixed(1); }
/** ROI as a whole percent with its sign ('+12%', '−36%', '0%'); a half rounds away from zero. */
export function fmtPct(frac) {
  const x = Number(frac) * 100;
  const p = Math.sign(x) * Math.round(Math.abs(x));
  return `${p > 0 ? '+' : p < 0 ? MINUS : ''}${Math.abs(p)}%`;
}

/** The lead's sample line: '9 events · 3 sessions · 19 h' (only what happened); '' with nothing. */
export function leadSample(s) {
  const parts = [];
  if (s.mtt && s.mtt.events > 0) parts.push(plural(s.mtt.events, 'event'));
  if (s.cash && s.cash.sessions > 0) {
    parts.push(plural(s.cash.sessions, 'session'));
    if (s.cash.hours > 0) parts.push(`${trim1(s.cash.hours)} h`);
  }
  return parts.join(' · ');
}

/**
 * The block's label/value rows, only for what happened, in the verdict's three groups and never
 * repeating the lead: each { key, label, sample, value, title?, muted? }. The sample sits beside
 * its label in muted ink; an empty figure is a dash whose REASON is that visible sample ('no
 * buy-ins', 'waiting for exchange rates'), the title the longer text (a title alone never shows on
 * a phone). money(v, signed) formats an amount in the display currency.
 *   Tournaments  its net, only beside another source (alone it is the lead's net again)
 *   ROI          '−34%', sample '11 bullets · cashed 2 of 8' (the ITM fact folded in)
 *   Cash games   '+$77 · $15/h', sample '1 session · 5 h' (the net and the rate in one row)
 *   Expenses & income
 */
export function periodRows(s, money) {
  const rows = [];
  const waiting = 'waiting for exchange rates';
  const m = s.mtt && s.mtt.events > 0 ? s.mtt : null;
  const c = s.cash && s.cash.sessions > 0 ? s.cash : null;
  const o = s.other && s.other.count > 0 ? s.other : null;
  const sources = (m ? 1 : 0) + (c ? 1 : 0) + (o ? 1 : 0);
  if (m) {
    if (sources > 1) {
      rows.push(m.profit == null
        ? { key: 'mtt', label: 'Tournaments', sample: waiting, value: '—', muted: true, title: 'Waiting for exchange rates to add these up' }
        : { key: 'mtt', label: 'Tournaments', sample: '', value: money(m.profit, true) });
    }
    const itm = `cashed ${Number(m.cashes).toLocaleString('en-US')} of ${Number(m.events).toLocaleString('en-US')}`;
    if (m.roi == null) {
      const why = s.unconverted ? waiting : 'no buy-ins';
      rows.push({
        key: 'roi', label: 'ROI', sample: `${why} · ${itm}`, value: '—', muted: true,
        title: s.unconverted ? 'Waiting for exchange rates to add the buy-ins up' : 'No buy-ins to measure it against (freerolls only)',
      });
    } else {
      rows.push({ key: 'roi', label: 'ROI', sample: `${plural(m.bullets, 'bullet')} · ${itm}`, value: fmtPct(m.roi) });
    }
  }
  if (c) {
    const timed = c.hours > 0;
    if (c.profit == null) {
      rows.push({ key: 'cash', label: 'Cash games', sample: `${plural(c.sessions, 'session')} · ${waiting}`, value: '—', muted: true, title: 'Waiting for exchange rates to add these up' });
    } else {
      rows.push({
        key: 'cash', label: 'Cash games', sample: `${plural(c.sessions, 'session')} · ${timed ? `${trim1(c.hours)} h` : 'no end times'}`,
        value: `${money(c.profit, true)}${c.hourly != null ? ` · ${money(c.hourly)}/h` : ''}`,
        ...(c.hourly == null ? { title: 'No session has an end time to divide by, so there is no hourly rate' } : {}),
      });
    }
  }
  if (o) {
    rows.push(o.net == null
      ? { key: 'other', label: 'Expenses & income', sample: `${plural(o.count, 'entry', 'entries')} · ${waiting}`, value: '—', muted: true, title: 'Waiting for exchange rates to add these up' }
      : { key: 'other', label: 'Expenses & income', sample: plural(o.count, 'entry', 'entries'), value: money(o.net, true) });
  }
  return rows;
}

// opts.plans (Map: event id -> { state }) -> id -> whether that event's plan resolved off.
function planIsOff(plans) {
  if (!plans || typeof plans.get !== 'function') return () => false;
  return (id) => { const p = plans.get(id); return !!p && p.state === 'off'; };
}

/**
 * What a series still holds on the user's schedule: its events from today on that are not logged,
 * not busted (a bust waits in To log), not marked Didn't play, not a plan's branch that resolved
 * off (opts.plans, the resolution Up Next and To log use: "If seat #7" after #7 missed is never
 * played) and not restart rows, and the most they can cost (buy-in x planned entries,
 * ScheduleExportModal's totalMax), converted.
 * -> { count, upTo } (upTo null when a buy-in cannot be converted), or null when none are left.
 */
export function scheduleAhead(schedule, results, updates, venue, today, opts = {}) {
  const off = planIsOff(opts.plans);
  const logged = new Set((Array.isArray(results) ? results : []).map((r) => Number(r && r.tournament_id)));
  const latest = new Map();
  for (const u of Array.isArray(updates) ? updates : []) {
    if (!u) continue;
    const k = Number(u.tournament_id), prev = latest.get(k);
    if (!prev || (Number(u.id) || 0) > (Number(prev.id) || 0)) latest.set(k, u);
  }
  const currencyOf = opts.currencyOf || (() => 'USD');
  let count = 0, total = 0, unconverted = false;
  for (const e of Array.isArray(schedule) ? schedule : []) {
    if (!e || e.venue !== venue || Number(e.is_restart) || Number(e.not_played)) continue;
    const id = Number(e.id);
    const day = isoDay(e.date);
    if (!day || day < today || logged.has(id) || off(id)) continue;
    const u = latest.get(id);
    if (u && Number(u.is_busted)) continue;
    count++;
    const v = convertMoney((Number(e.buyin) || 0) * Math.max(1, Number(e.planned_entries) || 1), currencyOf(e), opts.currency || 'USD', opts.rates || null);
    if (v == null) unconverted = true; else total += v;
  }
  return count ? { count, upTo: unconverted ? null : total } : null;
}

/**
 * The month's comparison, the lead's right side: the same days of last month over all of it
 * ('Sep 1–12 −$3.1k' / 'all Sep −$5.2k'), muted. An empty side says why in words ('Sep 1–12:
 * nothing logged'); with nothing in last month at all it is one line ('Sep: nothing logged').
 * -> [{ text, title? }, { text, title? }]
 */
export function compareSide(pw, prev, prevFull, signed) {
  const fig = (s) => (!s.count ? null : s.net == null ? { v: null } : { v: signed(s.net) });
  const a = fig(prev), b = fig(prevFull);
  if (!b) {
    return [{ text: `${pw.prevName}: nothing logged`, title: `Nothing logged in ${pw.prevNameLong || pw.prevName}` }, { text: '' }];
  }
  const side = (label, f, nothing) => (!f ? { text: `${label}: nothing logged`, title: nothing }
    : f.v == null ? { text: `${label}: waiting for rates`, title: 'Waiting for exchange rates to add it up' }
      : { text: `${label} ${f.v}` });
  return [side(pw.prevLabel, a, `Nothing logged ${pw.prevLabel}`), side(`all ${pw.prevName}`, b, `Nothing logged in ${pw.prevNameLong || pw.prevName}`)];
}

/**
 * Everything the period block shows. input:
 *   today, isAdmin, currency, money(v, signed)
 *   results, schedule, updates            (GET /api/tracking, /api/my-schedule, live updates)
 *   plans                                 (the resolved plans, home-upnext.js resolveConditions:
 *                                          a branch that is off is not still on the schedule)
 *   rates, currencyOf                     (GET /api/exchange-rates, row -> its currency: the
 *                                          tournament rows' and the trip's conversions)
 *   ledger                                (admins: ledger entries in `currency`; null while loading)
 *   trip, tripData, tripScopeName         (admins: the current trip, its GET /trips/:id payload
 *                                          (null while it loads), its scope's name)
 * -> null while an admin's ledger (or trip) loads, else
 *   { mode, title, scope, net, sample, side: [{ text, title? }, { text, title? }], rows, ahead, window, stats }
 *   net is null for an empty window, and `sample` then gives the reason. window is the span the
 *   figures cover ({ from, to, venue: a series' title or null, scope: 'all' or a trip's bankroll })
 *   and stats its figures ({ mtt, cash, ... }), for the signal-or-noise line (home-noise.js).
 */
export function buildPeriod(input) {
  const { today, isAdmin, currency = 'USD', money } = input;
  const results = Array.isArray(input.results) ? input.results : [];
  const tOpts = { currency, rates: input.rates || null, currencyOf: input.currencyOf };
  const signed = (v) => money(v, true);

  // Trip mode (admins): the trip page's own figures (tripStats over GET /trips/:id), so the net the
  // home leads with is the 'Trip net' the block opens.
  if (isAdmin && input.trip) {
    if (!input.tripData) return null;
    const trip = input.trip;
    const scope = trip.bankroll == null || trip.bankroll === 'all' ? null : String(trip.bankroll);
    const s = tripStats(input.tripData, { currency, rates: input.rates || null, currencyOf: input.currencyOf });
    const n = daysBetween(trip.start_date, trip.end_date) + 1, k = daysBetween(trip.start_date, today) + 1;
    return {
      mode: 'trip', title: trip.name || 'This trip',
      scope: `${scope ? (input.tripScopeName || 'One bankroll') : 'All bankrolls'} · ${currency}`,
      net: s.count ? s.net : null,
      sample: !s.count ? 'Nothing logged on this trip yet' : s.net == null ? 'Waiting for exchange rates'
        : (leadSample(s) || plural(s.other.count, 'entry', 'entries')),
      side: [{ text: 'Net after expenses' }, { text: `${dayRange(trip.start_date, trip.end_date)} · day ${k} of ${n}` }],
      rows: periodRows(s, money), ahead: null,
      window: { from: trip.start_date, to: trip.end_date, venue: null, scope: scope || 'all' }, stats: s,
    };
  }

  // Series mode (anyone): tournaments only.
  const series = currentSeries(input.schedule, results, today, { plans: input.plans });
  if (series) {
    const w = { from: series.from, to: today };
    const ids = new Set(series.ids);
    const s = resultStats(results, w, { ...tOpts, keep: (r) => ids.has(Number(r.tournament_id)) || r.venue === series.venue });
    const ahead = scheduleAhead(input.schedule, results, input.updates, series.venue, today, { ...tOpts, plans: input.plans });
    const rows = periodRows(s, money);
    if (ahead) {
      rows.push(ahead.upTo == null
        ? { key: 'ahead', label: 'Still on your schedule', sample: `${plural(ahead.count, 'event')} · waiting for exchange rates`, value: '—', muted: true, title: 'Waiting for exchange rates to add the buy-ins up' }
        : { key: 'ahead', label: 'Still on your schedule', sample: plural(ahead.count, 'event'), value: `up to ${money(ahead.upTo)}` });
    }
    const n = daysBetween(series.from, series.to) + 1, k = daysBetween(series.from, today) + 1;
    return {
      mode: 'series', title: series.venue, scope: `Tournaments · ${currency}`,
      net: s.count ? s.net : null,
      sample: !s.count ? 'Nothing logged in this series yet' : s.net == null ? 'Waiting for exchange rates' : leadSample(s),
      side: [{ text: dayRange(series.from, series.to) }, { text: `day ${k} of ${n}` }],
      rows, ahead,
      window: { from: series.from, to: today, venue: series.venue, scope: 'all' }, stats: s,
    };
  }

  // Month mode.
  const pw = paceWindows(today);
  let cur, prev, prevFull;
  if (isAdmin) {
    if (!input.ledger) return null;
    cur = ledgerStats(input.ledger, pw.cur);
    prev = ledgerStats(input.ledger, pw.prev);
    prevFull = ledgerStats(input.ledger, pw.prevFull);
  } else {
    cur = resultStats(results, pw.cur, tOpts);
    prev = resultStats(results, pw.prev, tOpts);
    prevFull = resultStats(results, pw.prevFull, tOpts);
  }
  return {
    mode: 'month', title: pw.name,
    scope: `${isAdmin ? 'All bankrolls' : 'Tournaments'} · ${currency}`,
    net: cur.count ? cur.net : null,
    sample: !cur.count ? `Nothing logged in ${pw.name} yet` : cur.net == null ? 'Waiting for exchange rates' : leadSample(cur),
    side: compareSide(pw, prev, prevFull, signed),
    rows: periodRows(cur, money), ahead: null,
    window: { from: pw.cur.from, to: today, venue: null, scope: 'all' }, stats: cur,
  };
}

// ── Goals (admins) ────────────────────────────────────────────────────────────────────────
/**
 * The 'all' bankroll's goals (GET /api/bankrolls/summary guide.byKey.all.goals) against the ledger,
 * each with a pace bar: fill = done / target (0..1), tick = how much of the period has gone. A
 * volume goal is coloured ahead / behind its pace; a profit goal is muted, because profit pace is
 * mostly variance. A profit goal with nothing logged in its period shows a dash, not '$0' (a count
 * of 0 played is a fact and stays). -> [{ id, label, note, value, title?, fill, tick, tone }]
 */
export function goalLines(goals, entries, today, money) {
  return (Array.isArray(goals) ? goals : []).filter(Boolean).map((g) => {
    const p = goalProgress(g, Array.isArray(entries) ? entries : [], today);
    const volume = g.metric === 'volume';
    const reached = p.target > 0 && p.done >= p.target;
    const w = periodWindow(g.period, today);
    const empty = !volume && !(Array.isArray(entries) ? entries : [])
      .some((e) => e && !MOVE_KINDS.has(e.kind) && inWindow(e.date, w));
    return {
      id: g.id,
      label: `${g.period === 'year' ? 'Yearly' : 'Monthly'} ${volume ? 'volume' : 'profit'}`,
      note: volume ? (reached ? 'reached' : p.ahead ? 'ahead of pace' : 'behind pace') : 'pace is mostly variance',
      value: volume ? `${Math.round(p.done).toLocaleString('en-US')} of ${Number(p.target).toLocaleString('en-US')} played` : `${empty ? 'nothing yet' : money(p.done)} of ${money(p.target)}`,
      ...(empty ? { muted: true, title: `Nothing logged ${g.period === 'year' ? 'this year' : 'this month'} yet` } : {}),
      fill: Math.max(0, Math.min(1, p.fraction || 0)),
      tick: p.elapsed < 1 ? p.elapsed : null,
      tone: volume ? (reached || p.ahead ? 'ahead' : 'behind') : 'muted',
    };
  });
}

// ── The bankroll line (admins) ────────────────────────────────────────────────────────────
/**
 * One bar from GET /api/bankrolls/summary: the balance of every roll, the tournament cap a bullet
 * under the 'all' rule, and the rule's move signal as a pill. Under the guide's minimum of recent
 * entries there is no signal (no pill), never a '0'; a roll at or below zero has no cap (a dash).
 * money(v) formats in the summary's currency.
 * -> { currency, balance, cap: { value, title? }, rule: '1%', signal: { key, label, title } | null } | null
 */
export function bankrollLine(summary, money) {
  if (!summary || !summary.all || !Number.isFinite(Number(summary.all.balance))) return null;
  const g = summary.guide && summary.guide.byKey ? summary.guide.byKey.all : null;
  const m = g ? g.mtt : null;
  const balance = Number(summary.all.balance);
  const cap = m && m.cap > 0
    ? { value: money(m.cap) }
    : { value: '—', note: 'no balance', title: 'No balance to size a bullet from' };
  let signal = null;
  if (m && m.signal === 'hold') {
    signal = { key: 'hold', label: 'Hold', title: `Your last ${m.recentN} entries averaged ${money(m.recentAvg)}, inside the cap` };
  } else if (m && m.signal === 'down') {
    signal = { key: 'down', label: 'Move down', title: m.reason === 'empty' ? 'The roll is at or below zero' : `Your last ${m.recentN} entries averaged ${money(m.recentAvg)}, above the cap` };
  } else if (m && m.signal === 'up') {
    signal = {
      key: 'up', label: m.nextTier ? `Move up to ${money(m.nextTier.min)}+` : 'Move up',
      title: m.nextTier ? `The cap reaches the ${m.nextTier.label} tier` : 'The cap reaches the next tier',
    };
  }
  return { currency: summary.currency || 'USD', balance, cap, rule: m && m.buyins > 0 ? fmtRule(m.buyins) : null, signal };
}
