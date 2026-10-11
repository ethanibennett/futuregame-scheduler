// ── Expenses, non-game income and trips (beta, app admins) ──────────────────
// The client half of lib/bankroll-transactions.js. Pure and dependency-free except for the CSV
// cell escaping shared with the tax report, so it runs under `node --test`
// (src/utils/__tests__/transactions.test.mjs). Money is summed in integer cents.
//
// A transaction's `amount` is always positive; `kind` gives the sign (expense = out, income = in).
// Results (tracking entries) are in each venue's native currency and transactions in their own,
// so every total here takes a `convert(amount, from, to)` and a target currency.
import { csvCell } from './tax-report.js';

// Keys must match lib/bankroll-transactions.js CATEGORIES (the server test checks it).
export const EXPENSE_CATEGORIES = [
  { key: 'travel', label: 'Travel' },
  { key: 'lodging', label: 'Lodging' },
  { key: 'food', label: 'Food' },
  { key: 'entry_fees', label: 'Entry fees' },
  { key: 'coaching', label: 'Coaching' },
  { key: 'software', label: 'Software' },
  { key: 'tips', label: 'Dealer tips' },
  { key: 'other', label: 'Other' },
];
export const INCOME_CATEGORIES = [
  { key: 'rakeback', label: 'Rakeback' },
  { key: 'bonus', label: 'Bonus' },
  { key: 'staking', label: 'Staking' },
  { key: 'sponsorship', label: 'Sponsor' },
  { key: 'coaching', label: 'Coaching' },
  { key: 'other', label: 'Other' },
];
// Longer names where there is room (lists, CSV, the tax report).
const LONG = {
  expense: { entry_fees: 'Entry / registration fees', software: 'Software / subscriptions', tips: 'Dealer tips' },
  income: { bonus: 'Bonus / promotion', staking: 'Staking settlement received', sponsorship: 'Prop / sponsorship', coaching: 'Coaching income', other: 'Other income' },
};

export function categoriesFor(kind) {
  return kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}
export function categoryLabel(kind, key, { long = false } = {}) {
  if (long && LONG[kind] && LONG[kind][key]) return LONG[kind][key];
  const c = categoriesFor(kind).find((x) => x.key === key);
  return c ? c.label : String(key || '');
}

const toC = (v) => Math.round((Number(v) || 0) * 100);
const fromC = (c) => c / 100;
export const signedAmount = (t) => (t && t.kind === 'expense' ? -1 : 1) * (Number(t && t.amount) || 0);

// A transaction's amount in `target`, via convert(amount, from, to). Same currency: as is.
function inTarget(amount, currency, target, convert) {
  const cur = currency || 'USD';
  if (cur === target || typeof convert !== 'function') return Number(amount) || 0;
  const v = convert(Number(amount) || 0, cur, target);
  return Number.isFinite(v) ? v : 0;
}

/**
 * Totals by category, in one currency.
 *   -> { expense: [{ key, label, amount, count }], income: [...], expenses, income, net, count }
 * Categories with nothing logged are left out; each list is largest first.
 */
export function totalsByCategory(transactions, { currency = 'USD', convert } = {}) {
  const acc = { expense: new Map(), income: new Map() };
  for (const t of transactions || []) {
    if (!t || !acc[t.kind]) continue;
    const m = acc[t.kind];
    const prev = m.get(t.category) || { c: 0, count: 0 };
    prev.c += toC(inTarget(t.amount, t.currency, currency, convert));
    prev.count++;
    m.set(t.category, prev);
  }
  const list = (kind) => [...acc[kind].entries()]
    .map(([key, v]) => ({ key, label: categoryLabel(kind, key, { long: true }), amount: fromC(v.c), count: v.count }))
    .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
  const sum = (kind) => [...acc[kind].values()].reduce((s, v) => s + v.c, 0);
  const e = sum('expense'), i = sum('income');
  return {
    currency,
    expense: list('expense'),
    income: list('income'),
    expenses: fromC(e),
    income_total: fromC(i),
    net: fromC(i - e),
    count: [...acc.expense.values(), ...acc.income.values()].reduce((s, v) => s + v.count, 0),
  };
}

/** Transactions whose occurred_on is in `year` (string compare; no Date, no zone shift). */
export function inYear(transactions, year) {
  const y = String(year);
  return (transactions || []).filter((t) => t && typeof t.occurred_on === 'string' && t.occurred_on.slice(0, 4) === y);
}

/**
 * A trip's whole P&L, in one currency. `data` is GET /api/bankrolls/trips/:id
 * ({ trip, transactions, results }); results are tracking rows with the event's venue, buyin,
 * num_entries, cashed, cash_amount.
 *   nativeCurrency(venue) -> the venue's currency (utils.js); convert(amount, from, to).
 *   -> { currency, events, cashes, buyins, cashed, results, expenses, income, net, byCategory }
 * results = cashes - buy-ins (the Results tab's profit); net = results + income - expenses.
 */
export function tripPnl(data, { currency = 'USD', convert, nativeCurrency } = {}) {
  let buy = 0, cash = 0, cashes = 0, events = 0;
  for (const e of (data && data.results) || []) {
    const from = typeof nativeCurrency === 'function' ? nativeCurrency(e.venue) : 'USD';
    const cost = (Number(e.buyin) || 0) * Math.max(1, Number(e.num_entries) || 1);
    buy += toC(inTarget(cost, from, currency, convert));
    if (e.cashed && Number(e.cash_amount) > 0) { cash += toC(inTarget(e.cash_amount, from, currency, convert)); cashes++; }
    events++;
  }
  const tx = totalsByCategory((data && data.transactions) || [], { currency, convert });
  const resultsC = cash - buy;
  return {
    currency,
    events,
    cashes,
    buyins: fromC(buy),
    cashed: fromC(cash),
    results: fromC(resultsC),
    expenses: tx.expenses,
    income: tx.income_total,
    net: fromC(resultsC + toC(tx.income_total) - toC(tx.expenses)),
    byCategory: tx,
  };
}

// ── CSV ─────────────────────────────────────────────────────────────────────
export const TX_CSV_COLUMNS = [
  'Date', 'Type', 'Category', 'Amount', 'Currency', 'Signed amount', 'Bankroll', 'Trip', 'Event', 'Series / venue', 'Note',
];
/**
 * rows: transactions as the API returns them. bankrollName(id) names a bankroll ('main' | id).
 * Text cells are formula-escaped (csvCell); BOM + CRLF so Excel reads UTF-8.
 */
export function transactionsToCsv(rows, { bankrollName } = {}) {
  const out = [TX_CSV_COLUMNS];
  const sorted = [...(rows || [])].sort((a, b) => (a.occurred_on < b.occurred_on ? -1 : a.occurred_on > b.occurred_on ? 1 : (a.id || 0) - (b.id || 0)));
  for (const t of sorted) {
    out.push([
      t.occurred_on,
      t.kind === 'expense' ? 'Expense' : 'Income',
      categoryLabel(t.kind, t.category, { long: true }),
      Number(t.amount) || 0,
      t.currency || 'USD',
      fromC(toC(signedAmount(t))),
      typeof bankrollName === 'function' ? bankrollName(t.bankroll_id) : (t.bankroll_id == null ? 'main' : String(t.bankroll_id)),
      t.trip_name || '',
      t.tournament_name || '',
      t.series || '',
      t.note || '',
    ]);
  }
  return '﻿' + out.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ── Quick-add ───────────────────────────────────────────────────────────────
/** Reads a typed amount: '12', '12.5', '$1,250.75', '12,50' (a lone comma as decimal). */
export function parseAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[\s$€£¥]/g, '');
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  s = s.replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  const n = Math.round(Number(s) * 100) / 100;
  return n > 0 && Number.isFinite(n) ? n : null;
}

/** 'YYYY-MM-DD' -> 'Jun 4' (by hand, no Date). With `year`, 'Jun 4, 2026'. */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDay(iso, { year = false } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  return `${MON[Number(m[2]) - 1]} ${Number(m[3])}${year ? `, ${m[1]}` : ''}`;
}
/** A trip's range: 'Jun 1 – 10, 2026', 'Jun 28 – Jul 3, 2026', 'Dec 30, 2026 – Jan 2, 2027'. */
export function tripRange(start, end) {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(start || ''), b = /^(\d{4})-(\d{2})-(\d{2})/.exec(end || '');
  if (!a || !b) return '';
  if (a[1] !== b[1]) return `${shortDay(start, { year: true })} – ${shortDay(end, { year: true })}`;
  if (a[2] === b[2]) return a[3] === b[3] ? shortDay(start, { year: true }) : `${shortDay(start)} – ${Number(b[3])}, ${a[1]}`;
  return `${shortDay(start)} – ${shortDay(end)}, ${a[1]}`;
}
