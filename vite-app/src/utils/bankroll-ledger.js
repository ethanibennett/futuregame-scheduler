// ── The bankroll dashboard's arithmetic (beta, app admins) ─────────────────────────────────
// Pure and dependency-free (runs under `node --test`). Everything here works on the rows of
// GET /api/bankrolls/ledger (lib/bankroll-ledger.js): sorted, each with amount_display and the
// running total_display, in the dashboard's currency. See docs/bankrolls.md "The combined ledger".

// Money moved between pockets or in/out of poker — not won or lost. Mirrors MOVE_KINDS server-side.
// `correction` and `settlement` (the bankroll merge's two adjustment kinds) move a balance and are never profit.
export const MOVE_KINDS = new Set(['deposit', 'withdrawal', 'transfer_in', 'transfer_out', 'correction', 'settlement']);
// Sources whose entries are sessions played (for volume goals). Names per the source contract.
export const GAME_SOURCES = new Set(['tournaments', 'cash-sessions']);

const SOURCE_LABELS = {
  tournaments: 'Tournaments',
  adjustments: 'Deposits & transfers',
  'cash-sessions': 'Cash games',
  transactions: 'Expenses & income',
};
export function sourceLabel(name) {
  if (SOURCE_LABELS[name]) return SOURCE_LABELS[name];
  const s = String(name || '').replace(/[-_]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Other';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

/** The window a period selector value covers, ending today. 'all' has no bounds. */
export function periodWindow(period, today) {
  const [y, m] = today.split('-').map(Number);
  if (period === 'month') {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
  }
  if (period === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
  return { from: null, to: null };
}

/** How far through the period `today` is, 0..1 (for a goal's pace). */
export function periodElapsed(period, today) {
  const w = periodWindow(period, today);
  if (!w.from) return 1;
  const t = (s) => Date.parse(s + 'T00:00:00Z');
  const span = (t(w.to) - t(w.from)) / 864e5 + 1;
  return Math.min(1, Math.max(0, ((t(today) - t(w.from)) / 864e5 + 1) / span));
}

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

const inWindow = (e, w) => (!w.from || e.date >= w.from) && (!w.to || e.date <= w.to);
const isMove = (e) => MOVE_KINDS.has(e.kind);

/**
 * Balance over time for the chart: one point per day that moved, value = the closing running
 * total that day, starting from the opening total at the window's start.
 * Returns [{ date, value }] (at least the opening point when there is one).
 */
export function balanceSeries(entries, { opening = 0, from = null } = {}) {
  // The opening point is kept even when the first entry falls on the same day (a step up from it).
  const pts = [{ date: from || (entries[0] ? entries[0].date : null), value: opening, start: true }];
  for (const e of entries) {
    const last = pts[pts.length - 1];
    if (last.date === e.date && !last.start) last.value = e.total_display;
    else pts.push({ date: e.date, value: e.total_display });
  }
  return pts;
}

/**
 * Drawdown from the running peak, point by point: { peak, dd } per point, the largest drawdown
 * (amount and the dates it spans) and the current one. The first point counts as a peak.
 */
export function drawdowns(points) {
  let peak = -Infinity, peakDate = null;
  let max = { amount: 0, from: null, to: null };
  const per = points.map((p) => {
    if (p.value > peak) { peak = p.value; peakDate = p.date; }
    const dd = peak - p.value;
    if (dd > max.amount) max = { amount: dd, from: peakDate, to: p.date };
    return { peak, dd };
  });
  const lastP = per[per.length - 1];
  return { per, max, current: lastP ? { amount: lastP.dd, from: lastP.dd > 0 ? peakDate : null } : { amount: 0, from: null } };
}

/** Net per month ('month' buckets) or per year, newest first: { key, label, results, moved, net, count }. */
export function periodTable(entries, bucket) {
  const map = new Map();
  for (const e of entries) {
    const key = bucket === 'year' ? e.date.slice(0, 4) : e.date.slice(0, 7);
    if (!map.has(key)) map.set(key, { key, label: bucket === 'year' ? key : monthLabel(key), results: 0, moved: 0, net: 0, count: 0 });
    const r = map.get(key);
    const a = Number(e.amount_display) || 0;
    if (isMove(e)) r.moved += a; else r.results += a;
    r.net += a;
    r.count++;
  }
  return [...map.values()].sort((a, b) => b.key.localeCompare(a.key));
}

/** Per source within the window: { source, label, results, moved, net, count }, largest first. */
export function bySource(entries) {
  const map = new Map();
  for (const e of entries) {
    if (!map.has(e.source)) map.set(e.source, { source: e.source, label: sourceLabel(e.source), results: 0, moved: 0, net: 0, count: 0 });
    const r = map.get(e.source);
    const a = Number(e.amount_display) || 0;
    if (isMove(e)) r.moved += a; else r.results += a;
    r.net += a;
    r.count++;
  }
  return [...map.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.label.localeCompare(b.label));
}

/** Entries inside a window. */
export function within(entries, w) { return entries.filter((e) => inWindow(e, w)); }

/**
 * A goal's progress in its current period. profit = every non-move entry (results from every
 * source, expenses included); volume = sessions played (tournament entries count their bullets).
 */
export function goalProgress(goal, entries, today) {
  const w = periodWindow(goal.period, today);
  let done = 0;
  for (const e of entries) {
    if (!inWindow(e, w)) continue;
    if (goal.metric === 'profit') { if (!isMove(e)) done += Number(e.amount_display) || 0; }
    else if (GAME_SOURCES.has(e.source)) done += Number(e.units) > 0 ? Number(e.units) : 1;
  }
  const target = Number(goal.target) || 0;
  const fraction = target > 0 ? done / target : 0;
  const elapsed = periodElapsed(goal.period, today);
  return { done, target, fraction, elapsed, window: w, ahead: fraction >= elapsed };
}

// ── The overview (the dashboard's first tab) ──────────────────────────────────────────────
// A trailing range ending today, as a tracker's chart picker: 1M, 3M, YTD, 1Y, All.
export const RANGES = [['1m', '1M'], ['3m', '3M'], ['ytd', 'YTD'], ['1y', '1Y'], ['all', 'All']];
export const RANGE_NOUN = { '1m': 'last month', '3m': 'last 3 months', ytd: 'this year', '1y': 'last 12 months', all: 'all time' };

/** YYYY-MM-DD n months before `iso`, the day clamped to that month's length. */
function monthsBefore(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const idx = y * 12 + (m - 1) - n;
  const yy = Math.floor(idx / 12), mm = idx - yy * 12 + 1;
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return `${yy}-${pad(mm)}-${pad(Math.min(d, last))}`;
}
function dayAfter(iso) { return new Date(Date.parse(iso + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10); }

/** The window a range covers: { from, to } with to = today; 'all' has no bounds. */
export function rangeWindow(range, today) {
  if (range === 'ytd') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  const n = { '1m': 1, '3m': 3, '1y': 12 }[range];
  if (n) return { from: dayAfter(monthsBefore(today, n)), to: today };
  return { from: null, to: null };
}

/**
 * Cumulative RESULTS (won or lost; money moved left out) for the chart's profit mode: starts at 0
 * on the window's first day, one point per day that had a result, value = the running sum at that
 * day's close. Same shape as balanceSeries.
 */
export function profitSeries(entries, { from = null } = {}) {
  const res = entries.filter((e) => !isMove(e));
  const pts = [{ date: from || (res[0] ? res[0].date : null), value: 0, start: true }];
  let run = 0;
  for (const e of res) {
    run += Number(e.amount_display) || 0;
    const last = pts[pts.length - 1];
    if (last.date === e.date && !last.start) last.value = run;
    else pts.push({ date: e.date, value: run });
  }
  for (const p of pts) p.value = Math.round(p.value * 100) / 100;
  return pts;
}

// ── The trend graph's lines (Overview, Profit mode) ───────────────────────────────────────
// Three lines over one date axis, as a poker tracker's trend chart draws them: Total (every
// result: the hero's profit), Tournaments and Cash. Whatever is neither (expenses & income, any
// future source) is `other`: inside Total, without a line of its own.
export const SERIES = [['total', 'Total'], ['tourn', 'Tournaments'], ['cash', 'Cash']];
export const SERIES_KEYS = SERIES.map((s) => s[0]);
const seriesOf = (e) => (e.source === 'tournaments' ? 'tourn' : e.source === 'cash-sessions' ? 'cash' : 'other');

/**
 * Cumulative results per game type, on one date axis. The first row is the window's start, every
 * series at 0; then one row per day that had a result, each series at its running sum at that
 * day's close. Total is every non-move entry (the rule overviewStats.results uses), tourn the
 * 'tournaments' source, cash 'cash-sessions', other the rest, so tourn + cash + other === total on
 * every row. Sums run in integer cents (amount_display is to the cent), so that identity is exact.
 * Returns [{ date, total, tourn, cash, other }] (the first row also has start: true).
 */
export function gameSeries(entries, { from = null } = {}) {
  const res = entries.filter((e) => !isMove(e));
  const rows = [{ date: from || (res[0] ? res[0].date : null), total: 0, tourn: 0, cash: 0, other: 0, start: true }];
  const c = { total: 0, tourn: 0, cash: 0, other: 0 };
  for (const e of res) {
    const a = Math.round((Number(e.amount_display) || 0) * 100);
    c.total += a;
    c[seriesOf(e)] += a;
    let row = rows[rows.length - 1];
    if (row.start || row.date !== e.date) { row = { date: e.date }; rows.push(row); }
    for (const k of ['total', 'tourn', 'cash', 'other']) row[k] = c[k] / 100;
  }
  return rows;
}

/** One series of gameSeries rows as chart points: the start, then every row where it moved. */
export function seriesLine(rows, key) {
  const pts = [];
  rows.forEach((r, i) => {
    if (i === 0) pts.push({ date: r.date, value: r[key], start: true });
    else if (r[key] !== rows[i - 1][key]) pts.push({ date: r.date, value: r[key] });
  });
  return pts;
}

/**
 * The graph's date axis for a range: { start, end }. `w` is rangeWindow's window and `win` the
 * entries inside it, sorted. start = the window's first day (All: the first entry's date; today
 * when there is none). end = the window's last day, today, except for All, which has no last day
 * and keeps every entry (as the hero and the tables do), so when the ledger holds one dated after
 * today (a prepaid hotel, a result logged ahead of the event) All runs to that entry's date and its
 * step lands on its own day, not piled up at today. The other ranges end today and `within`
 * leaves later entries out, so no point ever falls past the end.
 */
export function chartSpan(w, win, today) {
  const first = win.length ? win[0].date : null;
  const last = win.length ? win[win.length - 1].date : null;
  const start = w.from || first || today;
  const end = w.to || (last && last > today ? last : today);
  return { start, end: end < start ? start : end };
}

/**
 * The drawdown band under the running peak, point by point: [{ date, peak, bottom, edge }]. The band
 * always runs its full depth, from the running peak (drawdowns) down to the line (bottom = the
 * line's value), so peak − bottom is the drawdown there, whether or not the line is filled.
 * `floor` is the value the line's fill runs to (0, or the scale's nearer edge), and `edge` the far
 * edge that fill keeps so it gives way under the band: the line where the line stands at or above
 * the floor (the band is above it), else the nearer of the peak and the floor. Fill [floor, edge]
 * and band [bottom, peak] then share at most one value: stacked, the fill's colour and the band's
 * red mix to a neutral grey and both are lost. So a profit line below 0 (always in drawdown there,
 * since its first point, 0, is a peak) is red from the peak to the line and has no fill under 0.
 * Without a floor, edge is the line.
 */
export function drawdownBand(points, { floor = null } = {}) {
  const { per } = drawdowns(points);
  return points.map((p, i) => {
    const peak = per[i].peak;
    const edge = floor == null || p.value >= floor ? p.value : Math.min(peak, floor);
    return { date: p.date, peak, bottom: p.value, edge };
  });
}

/** The stored choice of lines ('total,tourn,cash'): known keys only, in order; never empty. */
export function parseSeriesPref(v) {
  const got = new Set(String(v == null ? '' : v).split(',').map((s) => s.trim()));
  const keys = SERIES_KEYS.filter((k) => got.has(k));
  return keys.length ? keys : [...SERIES_KEYS];
}

/**
 * The graph's gridlines: a "nice" step (1, 2, 2.5 or 5 × 10^n) and the extent rounded OUT to it,
 * in exactly n steps where n is one of `counts`. The chart's plot is 24r tall and each count
 * divides 24, so every gridline lands on an r line. With `zero` (the profit graph) the extent
 * takes in 0, and 0 is a tick. The smallest step that fits wins (the tightest scale).
 * A flat extent (span 0) has one tick and step 0 — the chart draws it across the middle.
 * `minStep` skips any step finer than it (the chart coarsens a scale whose labels would not fit
 * their gutter: a balance of MX$1,000,000 moving by MX$15 would want MX$999,985 … MX$1,000,000).
 * Returns { lo, hi, step, ticks } with ticks from lo to hi.
 */
export function niceTicks(lo, hi, { counts = [2, 3, 4], zero = true, minStep = 0 } = {}) {
  lo = Number(lo); hi = Number(hi);
  if (!Number.isFinite(lo) && !Number.isFinite(hi)) { lo = 0; hi = 0; }
  else if (!Number.isFinite(lo)) lo = hi;
  else if (!Number.isFinite(hi)) hi = lo;
  if (lo > hi) [lo, hi] = [hi, lo];
  if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (!(hi > lo)) return { lo, hi, step: 0, ticks: [lo] };
  const ns = [...counts].sort((a, b) => a - b);
  const maxN = ns[ns.length - 1];
  const tidy = (v) => Number(v.toPrecision(12)) || 0; // and -0 to 0
  const floorStep = Number(minStep) > 0 ? Number(minStep) : 0;
  const p0 = Math.max(Math.floor(Math.log10((hi - lo) / maxN)), floorStep ? Math.floor(Math.log10(floorStep)) : -Infinity) - 1;
  for (let p = p0; p < p0 + 40; p++) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * 10 ** p;
      if (step < floorStep * (1 - 1e-9)) continue;
      let a = Math.floor(lo / step + 1e-9), b = Math.ceil(hi / step - 1e-9);
      const n = ns.find((c) => c >= Math.max(1, b - a));
      if (n == null) continue;
      // Any spare steps go on the side the data lean to (above for a rise, below for a fall).
      const spare = n - (b - a);
      if (Math.abs(hi) >= Math.abs(lo)) b += spare; else a -= spare;
      const ticks = [];
      for (let i = a; i <= b; i++) ticks.push(tidy(i * step));
      return { lo: ticks[0], hi: ticks[ticks.length - 1], step: tidy(step), ticks };
    }
  }
  return { lo, hi, step: 0, ticks: [lo] };
}

const MINUS = '−'; // as utils.js MINUS: plus-width, so signed labels align
/** The fewest decimals that write x exactly (x a multiple of 1/2/2.5/5 × 10^n), at most 8. */
function decimalsOf(x) {
  x = Math.abs(x);
  if (!x) return 0;
  for (let d = 0; d < 8; d++) {
    const s = x * 10 ** d, r = Math.round(s);
    if (r && Math.abs(s - r) <= 1e-9 * s) return d; // r && : 0.000001 is not 0 to the unit
  }
  return 8;
}
const UNITS = [[1e6, 'M'], [1e3, 'k'], [1, '']];
/**
 * An axis label: compact money in a currency's own form — { symbol, pos } as utils.js
 * CURRENCY_CONFIG — "$5k", "−$2.5k", "¥1.2M", "5k kr", "−C$750". Thousands as k, millions as M, no
 * trailing zeros, grouped as the locale groups (formatCurrencyAmount's toLocaleString); the minus
 * sign is U+2212.
 *
 * `step` (the gridlines' spacing) sets the precision, so that every gridline reads as its own exact
 * value: the label takes the largest unit, no larger than itself, in which the step needs at most
 * two decimals ($1.25k from a step of 250), and writes it with as many as that needs. A finer step
 * steps down a unit: a balance from 9,985 to 10,000 in steps of 5 reads $9,985 … $10,000, not
 * $9.98k, $9.99k, $9.99k, $10k (a fixed two decimals of k repeated labels, and named a gridline
 * after a value 5 away). Below the dollar the step's own decimals are kept ($0.025). With no step
 * (one gridline, or a lone value) the value itself sets the precision.
 */
export function compactMoney(v, { symbol = '$', pos = 'pre', step = null, locale } = {}) {
  const n = Number(v) || 0, a = Math.abs(n);
  const q = Number(step) > 0 ? Number(step) : a; // what the label has to tell apart
  let unit = 1, suffix = '', dec = decimalsOf(q);
  for (const [u, s] of UNITS) {
    if (u > 1 && a < u) continue;
    const d = decimalsOf(q / u);
    if (d <= 2 || u === 1) { unit = u; suffix = s; dec = d; break; }
  }
  const x = Number((a / unit).toFixed(dec));
  const num = x.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: dec }) + suffix;
  const sign = n < 0 && x !== 0 ? MINUS : '';
  return pos === 'suf' ? `${sign}${num} ${symbol}` : `${sign}${symbol}${num}`;
}

/** The highest point of a series, and the first day it was reached. */
export function peakOf(points) {
  let best = null;
  for (const p of points) if (!best || p.value > best.value) best = p;
  return best ? { value: best.value, date: best.date } : { value: 0, date: null };
}

// Display units per one unit of the entry's own currency (the server's fx_display; 1 if absent).
const fx = (e) => (e.fx_display != null && Number.isFinite(Number(e.fx_display)) ? Number(e.fx_display) : 1);

/**
 * Everything the overview's statistics show, over ledger rows already cut to the range.
 *   results      every result (tournaments, cash, expenses / income, any other source); moved
 *   bySource     results per group: tournaments, cash, other
 *   mtt          tournaments: profit, cost and cashes on the display scale (fx_display), roi
 *                (profit / cost), events (rows), bullets (units), cashes (rows that cashed), itm
 *                (cashes / bullets: per entry), avgBuyin (cost / bullets)
 *   cash         cash sessions: profit, sessions, hours (sessions with both ends), hourly (the
 *                timed sessions' profit / their hours), wins, winRate, avgHours
 *   biggestWin / biggestLoss   the single best and worst game entry (tournament or cash session)
 * A ratio with nothing under it is null, never 0.
 */
export function overviewStats(entries) {
  const out = {
    results: 0, moved: 0, bySource: { tournaments: 0, cash: 0, other: 0 },
    mtt: { profit: 0, cost: 0, cashed: 0, roi: null, events: 0, bullets: 0, cashes: 0, itm: null, avgBuyin: null },
    cash: { profit: 0, sessions: 0, hours: 0, hourly: null, wins: 0, winRate: null, avgHours: null },
    biggestWin: null, biggestLoss: null,
  };
  let timedProfit = 0, timed = 0;
  for (const e of entries) {
    const a = Number(e.amount_display) || 0;
    if (isMove(e)) { out.moved += a; continue; }
    out.results += a;
    if (e.source === 'tournaments') {
      const m = out.mtt;
      out.bySource.tournaments += a;
      m.profit += a; m.events++;
      m.cost += (Number(e.cost) || 0) * fx(e);
      m.cashed += (Number(e.cash) || 0) * fx(e);
      m.bullets += Number(e.units) > 0 ? Number(e.units) : 1;
      if (Number(e.cash) > 0) m.cashes++;
    } else if (e.source === 'cash-sessions') {
      const c = out.cash;
      out.bySource.cash += a;
      c.profit += a; c.sessions++;
      if (a > 0) c.wins++;
      if (Number(e.hours) > 0) { c.hours += Number(e.hours); timedProfit += a; timed++; }
    } else {
      out.bySource.other += a;
      continue;
    }
    if (a > 0 && (!out.biggestWin || a > out.biggestWin.amount_display)) out.biggestWin = e;
    if (a < 0 && (!out.biggestLoss || a < out.biggestLoss.amount_display)) out.biggestLoss = e;
  }
  const { mtt: m, cash: c } = out;
  if (m.cost > 0) m.roi = m.profit / m.cost;
  // ITM per ENTRY, the owner's rule (2026-10-13): a cash over the bullets fired, as Locations and
  // the Overview tables count it, so a re-entered event that cashed once is 1 of its bullets.
  if (m.bullets > 0) m.itm = m.cashes / m.bullets;
  if (m.bullets > 0 && m.cost > 0) m.avgBuyin = m.cost / m.bullets;
  if (c.hours > 0) c.hourly = timedProfit / c.hours;
  if (c.sessions > 0) c.winRate = c.wins / c.sessions;
  if (timed > 0) c.avgHours = c.hours / timed;
  const r2 = (v) => Math.round(v * 100) / 100;
  for (const o of [out, out.bySource, m, c]) {
    for (const k of ['results', 'moved', 'tournaments', 'cash', 'other', 'profit', 'cost', 'cashed', 'hours']) {
      if (typeof o[k] === 'number') o[k] = r2(o[k]);
    }
  }
  return out;
}

/** The latest n game entries (tournaments and cash sessions), newest first. */
export function recentResults(entries, n = 6) {
  const out = [];
  for (let i = entries.length - 1; i >= 0 && out.length < n; i--) if (GAME_SOURCES.has(entries[i].source)) out.push(entries[i]);
  return out;
}

// ── Rules ──────────────────────────────────────────────────────────────────────────────────
/** A rule's per-entry share, as written: 100 buy-ins → "1%", 40 → "2.5%", 300 → "0.33%". */
export function fmtRule(buyins) { return `${parseFloat((100 / buyins).toFixed(2))}%`; }

// ── CSV export ───────────────────────────────────────────────────────────────────────────
// A cell that opens with = + - @ is a formula to a spreadsheet; text cells get a leading '.
function cell(v, { text = false } = {}) {
  let s = v == null ? '' : String(v);
  if (text && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const money = (v) => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2);

/** The whole ledger as CSV, one row per entry, with the running balance. */
export function ledgerToCsv(entries, { currency = 'USD', bankrollName = (id) => String(id) } = {}) {
  const head = ['Date', 'Bankroll', 'Source', 'Kind', 'Description', 'Amount', 'Currency',
    `Amount (${currency})`, `Bankroll balance (${currency})`, `Running total (${currency})`, 'Reference'];
  const lines = [head.join(',')];
  for (const e of entries) {
    lines.push([
      e.date, cell(bankrollName(e.bankroll), { text: true }), cell(sourceLabel(e.source), { text: true }), e.kind,
      cell(e.label, { text: true }), money(e.amount), e.currency, money(e.amount_display), money(e.balance_display),
      money(e.total_display), cell(e.ref ? `${e.ref.table}:${e.ref.id}` : '', { text: true }),
    ].join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
