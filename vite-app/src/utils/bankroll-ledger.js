// ── The bankroll dashboard's arithmetic (beta, app admins) ─────────────────────────────────
// Pure and dependency-free (runs under `node --test`). Everything here works on the rows of
// GET /api/bankrolls/ledger (lib/bankroll-ledger.js): sorted, each with amount_display and the
// running total_display, in the dashboard's currency. See docs/bankrolls.md "The combined ledger".

// Money moved between pockets or in/out of poker — not won or lost. Mirrors MOVE_KINDS server-side.
export const MOVE_KINDS = new Set(['deposit', 'withdrawal', 'transfer_in', 'transfer_out']);
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

// ── "Of your roll" (event cards) ─────────────────────────────────────────────────────────
/**
 * One entry's buy-in against the roll and its MTT rule. `guide` = summary.guide.byKey[key]
 * (lib/bankroll-management.js guideFor); `buyin` already in the roll's currency.
 * → null when there is nothing to say, else { share (0..), over, cap, buyins, empty }.
 */
export function rollShare(guide, buyin) {
  if (!guide || !(buyin > 0)) return null;
  const buyins = guide.rules && guide.rules.mtt ? guide.rules.mtt.buyins : 100;
  if (!(guide.balance > 0)) return { share: null, over: true, cap: 0, buyins, empty: true };
  const cap = guide.balance / buyins;
  return { share: buyin / guide.balance, over: buyin > cap, cap, buyins, empty: false };
}

/** "1.2%", "0.35%", "12%": two significant figures, never "0%". */
export function fmtShare(x) {
  if (x == null) return '—';
  const p = x * 100;
  if (p >= 10) return `${Math.round(p)}%`;
  if (p >= 1) return `${p.toFixed(1)}%`;
  return `${p.toFixed(2)}%`;
}

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
