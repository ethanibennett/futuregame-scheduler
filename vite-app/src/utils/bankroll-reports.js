// ── The bankroll Reports breakdowns (beta, app admins) ────────────────────────────────────
// Pure and dependency-free (runs under `node --test`). Input: facts already prepared
// (bankroll-filters.js prepareFacts) and filtered (applyFilters). Output: the tables the Reports
// tab draws — one row per group with its count, profit and a rate — and the whole-g bar layout.
//
// Rate, per report (one kind for the whole table, so the column means one thing):
//   every played fact a cash session   → hourly   profit / hours
//   every played fact a tournament     → ROI      profit / cost (cost-weighted, as lib/analytics.js)
//   both                               → average  profit / count
//   expense categories                 → share    the row's share of the money in the table
// Expenses and income only enter the Month table (its Net) and their own Category table: a dinner
// has no room, game, stake or start time.

import { WEEKDAYS, DAYPARTS, hourLabel, monthLabel, BUYIN_BANDS } from './bankroll-filters.js';

const PLAYED = ['tournament', 'cash'];

// Profit by session length (cash), in hours.
export const LENGTH_BANDS = [
  { key: 'l0', label: 'Under 2 h', min: 0, max: 2 },
  { key: 'l1', label: '2–4 h', min: 2, max: 4 },
  { key: 'l2', label: '4–6 h', min: 4, max: 6 },
  { key: 'l3', label: '6–8 h', min: 6, max: 8 },
  { key: 'l4', label: '8–10 h', min: 8, max: 10 },
  { key: 'l5', label: '10 h+', min: 10, max: Infinity },
];
function lengthBand(h) {
  if (!(h > 0)) return null;
  const i = LENGTH_BANDS.findIndex((b) => h >= b.min && h < b.max);
  return i < 0 ? null : { key: LENGTH_BANDS[i].key, label: LENGTH_BANDS[i].label, order: i };
}

const CATEGORY_LABELS = {
  travel: 'Travel', lodging: 'Lodging', food: 'Food', entry_fees: 'Entry fees', coaching: 'Coaching', software: 'Software',
  tips: 'Tips', other: 'Other', rakeback: 'Rakeback', bonus: 'Bonus', staking: 'Staking', sponsorship: 'Sponsorship',
};
const catLabel = (c) => CATEGORY_LABELS[c] || (c ? c[0].toUpperCase() + c.slice(1).replace(/_/g, ' ') : 'Other');

/**
 * The reports, in picker order. kinds: which facts a report reads. group(f) → { key, label, order }
 * or null (the fact has no value: counted as `missing`). ordered: rows keep `order`; otherwise
 * most played first.
 */
export const REPORTS = [
  { key: 'room', label: 'Room', kinds: PLAYED, group: (f) => f.roomKey && { key: f.roomKey, label: f.room.trim() } },
  { key: 'game', label: 'Game', kinds: PLAYED, group: (f) => f.gameKey && { key: f.gameKey, label: f.game.trim() } },
  { key: 'stakes', label: 'Cash stakes', kinds: ['cash'], ordered: true,
    group: (f) => f.stakesKey && { key: f.stakesKey, label: f.stakesLabel, order: f.stakesOrd } },
  { key: 'buyin', label: 'Buy-in', kinds: ['tournament'], ordered: true,
    group: (f) => f.stakesKey && { key: f.stakesKey, label: f.stakesLabel, order: f.stakesOrd } },
  { key: 'weekday', label: 'Day of week', kinds: PLAYED, ordered: true,
    group: (f) => (f.weekday >= 0 ? { key: String(f.weekday), label: WEEKDAYS[f.weekday], order: f.weekday } : null) },
  // By start hour, the day read from 6 AM so a late night stays after the evening.
  { key: 'hour', label: 'Start time', kinds: PLAYED, ordered: true,
    group: (f) => (f.hour == null ? null : { key: String(f.hour), label: hourLabel(f.hour), order: (f.hour + 18) % 24 }) },
  { key: 'length', label: 'Session length', kinds: ['cash'], ordered: true, group: (f) => lengthBand(f.hours) },
  // Newest month first; Net includes expenses and income.
  { key: 'month', label: 'Month', kinds: [...PLAYED, 'expenses'], ordered: true,
    group: (f) => f.month && { key: f.month, label: monthLabel(f.month), order: -Number(f.month.replace('-', '')) } },
  { key: 'category', label: 'Expenses', kinds: ['expenses'], group: (f) => ({ key: f.category || 'other', label: catLabel(f.category) }) },
];
const REPORT = new Map(REPORTS.map((r) => [r.key, r]));
export { DAYPARTS, BUYIN_BANDS };

/** Which kind the rate column is for a set of played facts. */
export function rateKindFor(facts) {
  let t = 0, c = 0;
  for (const f of facts) { if (f.kind === 'tournament') t++; else if (f.kind === 'cash') c++; }
  if (!t && !c) return null;
  return t && c ? 'avg' : c ? 'hourly' : 'roi';
}
function rateOf(kind, g) {
  if (kind === 'hourly') return g.hours > 0 ? g.played / g.hours : null;
  if (kind === 'roi') return g.cost > 0 ? g.played / g.cost : null;
  if (kind === 'avg') return g.n > 0 ? g.played / g.n : null;
  return null;
}

/**
 * One report over prepared, filtered facts.
 * → { key, label, rateKind, rows: [{ key, label, n, count, profit, played, hours, cost, rate, share?, best, worst }],
 *     total: { n, profit, played, hours, cost, rate }, missing, empty }
 * n counts sessions + events (expenses are not "played"), count every row; profit includes expenses where the
 * report reads them (Month); played is the games' part alone, which the rate is built on.
 */
export function buildReport(facts, reportKey) {
  const rep = REPORT.get(reportKey);
  if (!rep) throw new Error('unknown report ' + reportKey);
  const use = facts.filter((f) => rep.kinds.includes(f.kind));
  const rateKind = rep.key === 'category' ? 'share' : rateKindFor(use);
  const groups = new Map();
  let missing = 0;
  const blank = () => ({ n: 0, count: 0, profit: 0, played: 0, hours: 0, cost: 0 });
  const total = blank();
  for (const f of use) {
    const k = rep.group(f);
    if (!k) { missing++; continue; }
    let g = groups.get(k.key);
    if (!g) { g = { key: k.key, label: k.label, order: k.order || 0, ...blank() }; groups.set(k.key, g); }
    for (const t of [g, total]) {
      t.profit += f.profit || 0;
      t.count++;
      if (f.kind !== 'expenses') {
        t.n++;
        t.played += f.profit || 0;
        if (f.kind === 'cash') t.hours += f.hours || 0;
        if (f.kind === 'tournament') t.cost += f.cost || 0;
      }
    }
  }
  let rows = [...groups.values()];
  if (rep.ordered) rows.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  else if (rep.key === 'category') rows.sort((a, b) => Math.abs(b.profit) - Math.abs(a.profit) || a.label.localeCompare(b.label));
  else rows.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  const moneyIn = rows.reduce((s, r) => s + Math.abs(r.profit), 0);
  rows = rows.map(({ order, ...r }) => ({
    ...r,
    rate: rateKind === 'share' ? (moneyIn > 0 ? Math.abs(r.profit) / moneyIn : null) : rateOf(rateKind, r),
    best: false, worst: false,
  }));
  // Best and worst by profit, when there is a choice to make.
  if (rows.length >= 2 && rep.key !== 'category') {
    let hi = 0, lo = 0;
    rows.forEach((r, i) => { if (r.profit > rows[hi].profit) hi = i; if (r.profit < rows[lo].profit) lo = i; });
    if (rows[hi].profit !== rows[lo].profit) { rows[hi].best = true; rows[lo].worst = true; }
  }
  return {
    key: rep.key, label: rep.label, rateKind, rows, missing, empty: rows.length === 0,
    total: { ...total, rate: rateKind === 'share' ? null : rateOf(rateKind, total) },
  };
}

/** Which reports have anything to show under the current facts (the picker hides none, it marks). */
export function reportAvailability(facts) {
  const out = {};
  for (const r of REPORTS) out[r.key] = facts.some((f) => r.kinds.includes(f.kind) && r.group(f));
  return out;
}

/**
 * The headline figures over prepared, filtered facts.
 * net: everything (expenses included). Tournaments: events, bullets, cost, profit, roi, itm.
 * Cash: sessions, hours, profit, hourly. Expenses: rows, net (income less spend).
 */
export function summaryStats(facts) {
  const s = {
    net: 0, played: 0,
    tournament: { n: 0, bullets: 0, cost: 0, profit: 0, cashes: 0, roi: null },
    cash: { n: 0, hours: 0, profit: 0, hourly: null, wins: 0 },
    expenses: { n: 0, net: 0 },
  };
  for (const f of facts) {
    const p = f.profit || 0;
    s.net += p;
    if (f.kind === 'tournament') {
      const t = s.tournament; t.n++; t.bullets += f.bullets || 1; t.cost += f.cost || 0; t.profit += p; if (f.cash > 0) t.cashes++;
      s.played++;
    } else if (f.kind === 'cash') {
      const c = s.cash; c.n++; c.hours += f.hours || 0; c.profit += p; if (p > 0) c.wins++;
      s.played++;
    } else {
      s.expenses.n++; s.expenses.net += p;
    }
  }
  s.tournament.roi = s.tournament.cost > 0 ? s.tournament.profit / s.tournament.cost : null;
  s.cash.hourly = s.cash.hours > 0 ? s.cash.profit / s.cash.hours : null;
  return s;
}

/**
 * Horizontal bars in WHOLE g across `width` g: a zero line at `zero` g, a positive row's bar from
 * there to the right, a negative row's to the left, length proportional to |profit| over the
 * table's span (largest gain + largest loss). Every non-zero row gets at least 1g; the zero line
 * sits at least 1g in from an edge that has bars beyond it. → { zero, bars: [{ start, width }] }
 */
export function barLayout(values, width = 35) {
  const maxPos = Math.max(0, ...values);
  const maxNeg = Math.max(0, ...values.map((v) => -v));
  const span = maxPos + maxNeg;
  if (!(span > 0)) return { zero: 0, bars: values.map(() => ({ start: 0, width: 0 })) };
  let zero = Math.round((width * maxNeg) / span);
  if (maxNeg > 0) zero = Math.max(1, zero);
  if (maxPos > 0) zero = Math.min(width - 1, zero);
  const bars = values.map((v) => {
    if (!v) return { start: zero, width: 0 };
    const room = v > 0 ? width - zero : zero;
    const w = Math.min(room, Math.max(1, Math.round((Math.abs(v) / span) * width)));
    return v > 0 ? { start: zero, width: w } : { start: zero - w, width: w };
  });
  return { zero, bars };
}
