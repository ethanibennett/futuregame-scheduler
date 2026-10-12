// ── The home's NUMBERS: the bankroll line and the period block (verdict sections 4 and 5) ─────
// Pure and dependency-free past the two pure modules it builds on (bankroll-ledger.js, the
// Overview's arithmetic, and home.js), so it runs under `node --test`
// (src/utils/__tests__/home-period.test.mjs; `npm run test:home`).
//
// THE PERIOD BLOCK. One block whose window follows what is running:
//   trip    a trip covering today (admins: trips are part of the bankroll beta). Its P&L is the
//           games played inside its dates, in its bankroll scope, plus the expenses and income
//           tagged to it: "Net after expenses".
//   series  else a series detected with confidence (currentSeries): the user's own events of one
//           feed series, today inside them, nothing else competing. Tournaments only.
//   month   else the calendar month to date, beside the same days of last month (like for like)
//           and all of last month.
// Admins' month and trip figures run the Overview's own function (overviewStats) on the combined
// ledger, so the app has one Net; everyone else's are their tournament results with the ledger's
// formula (home.js tournamentTotals). The honesty rules hold for every figure: a rate carries its
// sample, an empty figure is a dash with a reason (never $0 or 0%), money is whole dollars and
// $12.4k from $10k, profit gets no arrow and no trend colour.
import { overviewStats, goalProgress, periodWindow, fmtRule, MOVE_KINDS } from './bankroll-ledger.js';
import { tournamentTotals, convertMoney, isoDay, eventNo } from './home.js';

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
    name: MONTHS[m - 1], prevName: MON3[pm - 1],
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
 *
 * results: GET /api/tracking rows (tournament_id, venue, date). Returns
 *   { venue, from, to, events, behind, ahead, ids }   from..to = the user's first and last day of it,
 *   ids its schedule rows' tournament ids (a result belongs to the series by its event, or its venue).
 */
export function currentSeries(schedule, results, today, opts = {}) {
  const span = opts.spanDays == null ? 45 : opts.spanDays;
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
    if (Number(e.not_played) && !logged.has(id)) continue;
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
 * The block's label/value rows, only for what happened. Each { key, label, sample, value, title?,
 * muted? }: the sample sits beside its label ('ROI' '14 bullets'), and an empty figure is a dash
 * whose title gives the reason. money(v, signed) formats an amount in the display currency.
 */
export function periodRows(s, money) {
  const rows = [];
  const waiting = 'Waiting for exchange rates';
  const dash = (title) => ({ value: '—', title, muted: true });
  const amount = (v) => (v == null ? dash(waiting) : { value: money(v, true) });
  if (s.mtt && s.mtt.events > 0) {
    rows.push({ key: 'mtt', label: 'Tournaments', sample: plural(s.mtt.events, 'event'), ...amount(s.mtt.profit) });
    rows.push({
      key: 'roi', label: 'ROI', sample: plural(s.mtt.bullets, 'bullet'),
      ...(s.mtt.roi == null ? dash(s.unconverted ? waiting : 'No buy-ins to measure it against') : { value: fmtPct(s.mtt.roi) }),
    });
    rows.push({ key: 'itm', label: 'In the money', sample: '', value: `${s.mtt.cashes} of ${s.mtt.events}` });
  }
  if (s.cash && s.cash.sessions > 0) {
    rows.push({ key: 'cash', label: 'Cash games', sample: plural(s.cash.sessions, 'session'), ...amount(s.cash.profit) });
    rows.push({
      key: 'hourly', label: 'Per hour', sample: s.cash.hours > 0 ? `${trim1(s.cash.hours)} h` : 'no end times',
      ...(s.cash.hourly == null ? dash('No session has an end time to divide by') : { value: money(s.cash.hourly, true) }),
    });
  }
  if (s.other && s.other.count > 0) {
    rows.push({ key: 'other', label: 'Expenses & income', sample: plural(s.other.count, 'entry', 'entries'), ...amount(s.other.net) });
  }
  return rows;
}

/**
 * What a series still holds on the user's schedule: its events from today on that are not logged,
 * not busted (a bust waits in To log), not marked Didn't play and not restart rows, and the most
 * they can cost (buy-in x planned entries, ScheduleExportModal's totalMax), converted.
 * -> { count, upTo } (upTo null when a buy-in cannot be converted), or null when none are left.
 */
export function scheduleAhead(schedule, results, updates, venue, today, opts = {}) {
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
    if (!day || day < today || logged.has(id)) continue;
    const u = latest.get(id);
    if (u && Number(u.is_busted)) continue;
    count++;
    const v = convertMoney((Number(e.buyin) || 0) * Math.max(1, Number(e.planned_entries) || 1), currencyOf(e), opts.currency || 'USD', opts.rates || null);
    if (v == null) unconverted = true; else total += v;
  }
  return count ? { count, upTo: unconverted ? null : total } : null;
}

/**
 * Everything the period block shows. input:
 *   today, isAdmin, currency, money(v, signed)
 *   results, schedule, updates            (GET /api/tracking, /api/my-schedule, live updates)
 *   rates, currencyOf                     (for the tournament rows: exchange rates, venue -> currency)
 *   ledger                                (admins: ledger entries in `currency`; null while loading)
 *   trip, tripTx, tripScopeName           (admins: the current trip, its tagged transactions as
 *                                          { signed, currency } in their own currency, its scope's name)
 *   txRates                               (rates for those transactions: the summary's)
 * -> null while an admin's ledger loads, else
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

  // Trip mode (admins).
  if (isAdmin && input.trip) {
    if (!input.ledger) return null;
    const trip = input.trip;
    const w = { from: trip.start_date, to: today < trip.end_date ? today : trip.end_date };
    const scope = trip.bankroll == null || trip.bankroll === 'all' ? null : String(trip.bankroll);
    const s = ledgerStats(input.ledger, w, (e) => GAME.has(e.source) && (!scope || String(e.bankroll) === scope));
    let txNet = 0, txCount = 0, txBad = false;
    for (const tx of Array.isArray(input.tripTx) ? input.tripTx : []) {
      const v = convertMoney(tx.signed, tx.currency || 'USD', currency, input.txRates || null);
      txCount++;
      if (v == null) txBad = true; else txNet += v;
    }
    s.other = { net: txBad ? null : Math.round(txNet * 100) / 100, count: txCount };
    const count = s.count + txCount;
    const net = count ? (txBad ? null : s.net + txNet) : null;
    const n = daysBetween(trip.start_date, trip.end_date) + 1, k = daysBetween(trip.start_date, today) + 1;
    return {
      mode: 'trip', title: trip.name || 'This trip',
      scope: `${scope ? (input.tripScopeName || 'One bankroll') : 'All bankrolls'} · ${currency}`,
      net, sample: count ? (leadSample(s) || plural(txCount, 'entry', 'entries')) : 'Nothing logged on this trip yet',
      side: [{ text: 'Net after expenses' }, { text: `${dayRange(trip.start_date, trip.end_date)} · day ${k} of ${n}` }],
      rows: periodRows(s, money), ahead: null,
      window: { from: w.from, to: w.to, venue: null, scope: scope || 'all' }, stats: s,
    };
  }

  // Series mode (anyone): tournaments only.
  const series = currentSeries(input.schedule, results, today);
  if (series) {
    const w = { from: series.from, to: today };
    const ids = new Set(series.ids);
    const s = resultStats(results, w, { ...tOpts, keep: (r) => ids.has(Number(r.tournament_id)) || r.venue === series.venue });
    const ahead = scheduleAhead(input.schedule, results, input.updates, series.venue, today, tOpts);
    const rows = periodRows(s, money);
    if (ahead) {
      rows.push({
        key: 'ahead', label: 'Still on your schedule', sample: plural(ahead.count, 'event'),
        ...(ahead.upTo == null ? { value: '—', title: 'Waiting for exchange rates', muted: true } : { value: `up to ${money(ahead.upTo)}` }),
      });
    }
    const n = daysBetween(series.from, series.to) + 1, k = daysBetween(series.from, today) + 1;
    return {
      mode: 'series', title: series.venue, scope: `Tournaments · ${currency}`,
      net: s.count ? s.net : null,
      sample: s.count ? leadSample(s) : 'Nothing logged in this series yet',
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
  const fig = (s, nothing) => (!s.count ? { v: '—', title: nothing } : s.net == null ? { v: '—', title: 'Waiting for exchange rates' } : { v: signed(s.net) });
  const a = fig(prev, `Nothing logged ${pw.prevLabel}`), b = fig(prevFull, `Nothing logged in ${pw.prevName}`);
  return {
    mode: 'month', title: pw.name,
    scope: `${isAdmin ? 'All bankrolls' : 'Tournaments'} · ${currency}`,
    net: cur.count ? cur.net : null,
    sample: cur.count ? leadSample(cur) : `Nothing logged in ${pw.name} yet`,
    side: [{ text: `${pw.prevLabel} ${a.v}`, title: a.title }, { text: `all ${pw.prevName} ${b.v}`, title: b.title }],
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
      value: volume ? `${Math.round(p.done).toLocaleString('en-US')} of ${Number(p.target).toLocaleString('en-US')} played` : `${empty ? '—' : money(p.done)} of ${money(p.target)}`,
      ...(empty ? { title: `Nothing logged ${g.period === 'year' ? 'this year' : 'this month'} yet` } : {}),
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
    : { value: '—', title: 'No balance to size a bullet from' };
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
